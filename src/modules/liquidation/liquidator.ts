/**
 * Core Liquidator for Aave V3
 * Ported from ethers v5 to viem
 * Supports direct liquidation through the configured vault
 */
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AAVE_ORACLE_ABI, ERC20_ABI, VAULT_ABI } from '../../contracts/abis';
import { PriceMonitor } from './price-monitor';
import {
  ChainConfig,
  LiquidationTarget,
  Asset,
  LiquidationProfitCalculation,
  ExecutionResult,
} from './types';
import { getKaskadVaultLiquidationUnsupportedError } from './kaskad';


const MAX_UINT256 = 2n ** 256n - 1n;

export class Liquidator {
  private walletClients: Map<number, any> = new Map();
  private publicClients: Map<number, any> = new Map();
  private priceMonitor: PriceMonitor;

  constructor() {
    this.priceMonitor = new PriceMonitor();
  }

  /**
   * Initialize liquidator for a specific chain
   */
  public initChain(chain: ChainConfig, privateKey: string): void {
    if (!chain.aaveContracts) {
      console.log(`[${chain.name}] Skipping liquidator init — no Aave contracts`);
      return;
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const publicClient = createPublicClient({
      transport: http(chain.rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      transport: http(chain.rpcUrl),
    });

    this.publicClients.set(chain.chainId, publicClient);
    this.walletClients.set(chain.chainId, walletClient);
    this.priceMonitor.initChain(chain);

    console.log(`[${chain.name}] Liquidator initialized for wallet: ${account.address}`);
  }

  /**
   * Calculate profit potential for liquidating a position
   */
  public async calculateLiquidationProfit(
    chain: ChainConfig,
    target: LiquidationTarget,
    debtAsset: Asset,
    collateralAsset: Asset
  ): Promise<LiquidationProfitCalculation> {
    if (!chain.aaveContracts) {
      throw new Error(`Chain ${chain.name} has no Aave contracts`);
    }

    try {
      const publicClient = this.publicClients.get(chain.chainId);
      if (!publicClient) {
        throw new Error(`Public client not initialized for chain ${chain.chainId}`);
      }

      // Get latest prices
      const debtAssetPrice = await this.priceMonitor.getPriceData(chain, debtAsset.address);
      const collateralAssetPrice = await this.priceMonitor.getPriceData(
        chain,
        collateralAsset.address
      );

      // Get max debt to cover (either 50% or 100% depending on health factor)
      const closeFactorHfThreshold = parseUnits('0.95', 18);
      const closeFactorMultiplier = target.healthFactor < closeFactorHfThreshold ? 10000n : 5000n;

      // When HF < 0.95, Aave allows 100% close factor. Pass uint256.max to avoid
      // MustNotLeaveDust() revert — Aave will cap it to the full debt automatically.
      // When HF >= 0.95 (50% close factor), use 95% of half to stay safely under the limit.
      const isFullLiquidation = closeFactorMultiplier === 10000n;
      const estimatedDebtToCover = isFullLiquidation
        ? debtAsset.amount
        : (debtAsset.amount * closeFactorMultiplier * 95n) / (10000n * 100n);
      // For the actual contract call: use MAX_UINT256 for full liquidations to avoid dust revert
      const debtToCover = isFullLiquidation ? MAX_UINT256 : estimatedDebtToCover;

      // Get liquidation bonus
      const liquidationBonus = collateralAsset.liquidationBonus || 1.05;

      // Calculate collateral to receive (use estimatedDebtToCover for accurate math)
      // Formula: (debtAssetPrice * debtToCover * 10^collateralDecimals * liquidationBonus) / (collateralAssetPrice * 10^debtDecimals)
      const collateralToReceive =
        (debtAssetPrice.aaveOraclePrice *
          estimatedDebtToCover *
          BigInt(10 ** collateralAsset.decimals) *
          BigInt(Math.floor(liquidationBonus * 10000))) /
        (collateralAssetPrice.aaveOraclePrice *
          BigInt(10 ** debtAsset.decimals) *
          10000n);

      // Calculate USD values
      const debtAmountUsd =
        parseFloat(formatUnits(estimatedDebtToCover, debtAsset.decimals)) *
        parseFloat(formatUnits(debtAssetPrice.aaveOraclePrice, 8));

      const collateralAmountUsd =
        parseFloat(formatUnits(collateralToReceive, collateralAsset.decimals)) *
        parseFloat(formatUnits(collateralAssetPrice.aaveOraclePrice, 8));

      // Calculate profit
      const grossProfitUsd = collateralAmountUsd - debtAmountUsd;

      // Estimate gas cost using WKAS oracle price
      const estimatedGasPrice = chain.gasPriceWei ?? await publicClient.getGasPrice();
      const gasLimit = 500000n;
      const gasCostWei = estimatedGasPrice * gasLimit;

      // Get native token (iKAS/WKAS) price from oracle for accurate gas cost
      let nativeTokenPriceUsd = 0.03; // fallback
      if (chain.aaveContracts && chain.wkasAddress) {
        try {
          const wkasPrice = await publicClient.readContract({
            address: chain.aaveContracts.oracle as `0x${string}`,
            abi: AAVE_ORACLE_ABI,
            functionName: 'getAssetPrice',
            args: [chain.wkasAddress as `0x${string}`],
          });
          nativeTokenPriceUsd = parseFloat(formatUnits(wkasPrice, 8));
        } catch {
          // fallback to default
        }
      }
      const gasCostUsd = parseFloat(formatUnits(gasCostWei, 18)) * nativeTokenPriceUsd;

      // Calculate net profit
      const netProfitUsd = grossProfitUsd - gasCostUsd;
      const profitable = netProfitUsd > (chain.strategy?.minProfitUsd || 50);

      // Calculate execution priority (higher = more profitable)
      const executionPriority = profitable ? (netProfitUsd / debtAmountUsd) * 100 : 0;

      return {
        target,
        debtAsset,
        collateralAsset,
        debtToCover,
        estimatedDebtToCover,
        collateralToReceive,
        liquidationBonus,
        estimatedProfitUsd: grossProfitUsd,
        estimatedGasCostUsd: gasCostUsd,
        netProfitUsd,
        profitable,
        executionPriority,
      };
    } catch (error) {
      console.error(`Error calculating liquidation profit:`, error);
      throw error;
    }
  }

  /**
   * Check wallet balance for a specific token
   */
  public async checkBalance(chain: ChainConfig, tokenAddress: string): Promise<bigint> {
    const walletClient = this.walletClients.get(chain.chainId);
    const publicClient = this.publicClients.get(chain.chainId);

    if (!walletClient || !publicClient) {
      throw new Error(`Clients not initialized for chain ${chain.chainId}`);
    }

    const balance = (await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletClient.account.address],
    })) as bigint;

    return balance;
  }

  /**
   * Check vault balance for a specific token
   */
  public async checkVaultBalance(chain: ChainConfig, tokenAddress: string): Promise<bigint> {
    const publicClient = this.publicClients.get(chain.chainId);

    if (!publicClient) {
      throw new Error(`Public client not initialized for chain ${chain.chainId}`);
    }

    if (!chain.vaultAddress) {
      throw new Error(`Chain ${chain.name} has no vault configured`);
    }

    return (await publicClient.readContract({
      address: chain.vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'getTokenBalance',
      args: [tokenAddress as `0x${string}`],
    })) as bigint;
  }

  /**
   * Read on-chain liquidation stats from the vault
   */
  public async getLiquidationStats(
    chain: ChainConfig
  ): Promise<{ count: bigint; profit: bigint }> {
    const publicClient = this.publicClients.get(chain.chainId);

    if (!publicClient) {
      throw new Error(`Public client not initialized for chain ${chain.chainId}`);
    }

    if (!chain.vaultAddress) {
      throw new Error(`Chain ${chain.name} has no vault configured`);
    }

    const [count, profit] = (await publicClient.readContract({
      address: chain.vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'getLiquidationStats',
    })) as [bigint, bigint];

    return { count, profit };
  }

  /**
   * Execute direct liquidation (without flash loan)
   * This requires having the debt token already in the vault
   */
  public async executeDirectLiquidation(
    chain: ChainConfig,
    calculation: LiquidationProfitCalculation
  ): Promise<ExecutionResult> {
    if (!chain.aaveContracts) {
      return {
        success: false,
        error: 'Chain has no Aave contracts',
        timestamp: Date.now(),
        chainId: chain.chainId,
      };
    }

    try {
      const kaskadUnsupportedError = getKaskadVaultLiquidationUnsupportedError(chain);
      if (kaskadUnsupportedError) {
        console.error(`[${chain.name}] ${kaskadUnsupportedError}`);
        return {
          success: false,
          error: kaskadUnsupportedError,
          timestamp: Date.now(),
          chainId: chain.chainId,
        };
      }

      const { target, debtAsset, collateralAsset, debtToCover, estimatedDebtToCover } = calculation;

      const walletClient = this.walletClients.get(chain.chainId);
      const publicClient = this.publicClients.get(chain.chainId);

      if (!walletClient || !publicClient) {
        throw new Error(`Chain ${chain.chainId} not initialized`);
      }

      if (!chain.vaultAddress) {
        throw new Error(`Chain ${chain.name} has no vault configured`);
      }

      // Check if we have enough balance
      const debtTokenBalance = await this.checkVaultBalance(chain, debtAsset.address);

      if (debtTokenBalance < estimatedDebtToCover) {
        const balanceFormatted = formatUnits(debtTokenBalance, debtAsset.decimals);
        const neededFormatted = formatUnits(estimatedDebtToCover, debtAsset.decimals);

        console.error(
          `[${chain.name}] Insufficient balance for direct liquidation. ` +
            `Have: ${balanceFormatted} ${debtAsset.symbol}, Need: ${neededFormatted} ${debtAsset.symbol}`
        );

        return {
          success: false,
          error: 'Insufficient balance',
          timestamp: Date.now(),
          chainId: chain.chainId,
        };
      }

      console.log(
        `[${chain.name}] Executing liquidation:\n` +
          `  User: ${target.user}\n` +
          `  Debt Asset: ${debtAsset.symbol}\n` +
          `  Collateral Asset: ${collateralAsset.symbol}\n` +
          `  Debt to Cover: ${debtToCover === MAX_UINT256 ? `MAX (≈${formatUnits(estimatedDebtToCover, debtAsset.decimals)})` : formatUnits(debtToCover, debtAsset.decimals)}\n` +
          `  Expected Profit: $${calculation.netProfitUsd.toFixed(2)}`
      );

      // Determine gas price: use chain override or fetch from network
      const gasPrice = chain.gasPriceWei ?? await publicClient.getGasPrice();

      // Check gas price against maximum
      const networkGasPrice = await publicClient.getGasPrice();
      const effectiveGasPrice = chain.gasPriceWei ?? networkGasPrice;
      const maxGasPrice = parseUnits((chain.strategy?.maxGasPriceGwei || 100).toString(), 9);

      // Only check against max if using network gas price (not chain override)
      if (!chain.gasPriceWei && networkGasPrice > maxGasPrice) {
        console.warn(
          `[${chain.name}] Current gas price (${formatUnits(networkGasPrice, 9)} gwei) ` +
            `exceeds maximum (${chain.strategy?.maxGasPriceGwei || 100} gwei)`
        );
        return {
          success: false,
          error: 'Gas price too high',
          timestamp: Date.now(),
          chainId: chain.chainId,
        };
      }

      // Execute liquidation
      const gasLimit = BigInt(Math.floor(500000 * (chain.strategy?.gasLimitBuffer || 1.2)));

      const simulation = await publicClient.simulateContract({
        address: chain.vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'liquidate',
        args: [
          collateralAsset.address as `0x${string}`,
          debtAsset.address as `0x${string}`,
          target.user as `0x${string}`,
          debtToCover,
          false,
        ],
        gas: gasLimit,
        gasPrice,
        account: walletClient.account,
      });

      const collateralReceived = simulation.result as bigint;

      const txHash = await walletClient.writeContract({
        ...simulation.request,
        gas: gasLimit,
        gasPrice: effectiveGasPrice,
      });

      console.log(`[${chain.name}] Liquidation transaction sent: ${txHash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      const success = receipt.status === 'success';
      const gasUsed: bigint = receipt.gasUsed;
      const gasCostWei: bigint = gasUsed * receipt.effectiveGasPrice;

      if (success) {
        console.log(
          `[${chain.name}] ✅ Liquidation successful! Tx hash: ${receipt.transactionHash}`
        );

        console.log(
          `[${chain.name}] Received collateral: ${formatUnits(collateralReceived, collateralAsset.decimals)} ${collateralAsset.symbol}`
        );

        return {
          success: true,
          transactionHash: receipt.transactionHash,
          gasUsed,
          gasCostWei,
          profitAmount: collateralReceived,
          timestamp: Date.now(),
          chainId: chain.chainId,
        };
      } else {
        console.error(
          `[${chain.name}] ❌ Liquidation failed! Tx hash: ${receipt.transactionHash}`
        );
        return {
          success: false,
          transactionHash: receipt.transactionHash,
          error: 'Transaction failed',
          gasUsed,
          gasCostWei,
          timestamp: Date.now(),
          chainId: chain.chainId,
        };
      }
    } catch (error) {
      console.error(`[${chain.name}] Error executing liquidation:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        chainId: chain.chainId,
      };
    }
  }
}
