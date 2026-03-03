/**
 * Core Liquidator for Aave V3
 * Ported from ethers v5 to viem
 * Supports direct liquidation (requires debt token in wallet)
 */
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PriceMonitor } from './price-monitor';
import {
  ChainConfig,
  LiquidationTarget,
  Asset,
  LiquidationProfitCalculation,
  ExecutionResult,
} from './types';

// ABIs
const POOL_ABI = [
  {
    inputs: [
      { name: 'collateralAsset', type: 'address' },
      { name: 'debtAsset', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'debtToCover', type: 'uint256' },
      { name: 'receiveAToken', type: 'bool' },
    ],
    name: 'liquidationCall',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

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

      const maxDebtToCover = (debtAsset.amount * closeFactorMultiplier) / 10000n;

      // Use a smaller amount to be safe (e.g., 95% of max)
      const debtToCover = (maxDebtToCover * 95n) / 100n;

      // Get liquidation bonus
      const liquidationBonus = collateralAsset.liquidationBonus || 1.05;

      // Calculate collateral to receive
      // Formula: (debtAssetPrice * debtToCover * 10^collateralDecimals * liquidationBonus) / (collateralAssetPrice * 10^debtDecimals)
      const collateralToReceive =
        (debtAssetPrice.aaveOraclePrice *
          debtToCover *
          BigInt(10 ** collateralAsset.decimals) *
          BigInt(Math.floor(liquidationBonus * 10000))) /
        (collateralAssetPrice.aaveOraclePrice *
          BigInt(10 ** debtAsset.decimals) *
          10000n);

      // Calculate USD values
      const debtAmountUsd =
        parseFloat(formatUnits(debtToCover, debtAsset.decimals)) *
        parseFloat(formatUnits(debtAssetPrice.aaveOraclePrice, 8));

      const collateralAmountUsd =
        parseFloat(formatUnits(collateralToReceive, collateralAsset.decimals)) *
        parseFloat(formatUnits(collateralAssetPrice.aaveOraclePrice, 8));

      // Calculate profit
      const grossProfitUsd = collateralAmountUsd - debtAmountUsd;

      // Estimate gas cost
      const gasPrice = await publicClient.getGasPrice();
      const gasLimit = 500000n;
      const gasCostWei = gasPrice * gasLimit;

      // Get native token price for gas cost calculation (simplified - assume 2000 USD)
      const gasCostUsd = parseFloat(formatUnits(gasCostWei, 18)) * 2000;

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
   * Execute direct liquidation (without flash loan)
   * This requires having the debt token already in the wallet
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
      const { target, debtAsset, collateralAsset, debtToCover } = calculation;

      const walletClient = this.walletClients.get(chain.chainId);
      const publicClient = this.publicClients.get(chain.chainId);

      if (!walletClient || !publicClient) {
        throw new Error(`Chain ${chain.chainId} not initialized`);
      }

      // Check if we have enough balance
      const debtTokenBalance = await this.checkBalance(chain, debtAsset.address);

      if (debtTokenBalance < debtToCover) {
        const balanceFormatted = formatUnits(debtTokenBalance, debtAsset.decimals);
        const neededFormatted = formatUnits(debtToCover, debtAsset.decimals);

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
          `  Debt to Cover: ${formatUnits(debtToCover, debtAsset.decimals)}\n` +
          `  Expected Profit: $${calculation.netProfitUsd.toFixed(2)}`
      );

      // Approve tokens to be spent by the pool
      const approveHash = await walletClient.writeContract({
        address: debtAsset.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [chain.aaveContracts.pool as `0x${string}`, debtToCover],
      });

      console.log(`[${chain.name}] Approval transaction sent: ${approveHash}`);
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log(`[${chain.name}] Approval confirmed`);

      // Check gas price
      const currentGasPrice = await publicClient.getGasPrice();
      const maxGasPrice = parseUnits((chain.strategy?.maxGasPriceGwei || 100).toString(), 9);

      if (currentGasPrice > maxGasPrice) {
        console.warn(
          `[${chain.name}] Current gas price (${formatUnits(currentGasPrice, 9)} gwei) ` +
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

      const txHash = await walletClient.writeContract({
        address: chain.aaveContracts.pool as `0x${string}`,
        abi: POOL_ABI,
        functionName: 'liquidationCall',
        args: [
          collateralAsset.address as `0x${string}`,
          debtAsset.address as `0x${string}`,
          target.user as `0x${string}`,
          debtToCover,
          false,
        ],
        gas: gasLimit,
        gasPrice: currentGasPrice,
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

        // Check received collateral
        const collateralBalance = await this.checkBalance(chain, collateralAsset.address);

        console.log(
          `[${chain.name}] Received collateral: ${formatUnits(collateralBalance, collateralAsset.decimals)} ${collateralAsset.symbol}`
        );

        return {
          success: true,
          transactionHash: receipt.transactionHash,
          gasUsed,
          gasCostWei,
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
