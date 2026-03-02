/**
 * Health Factor Monitor for Aave V3
 * Ported from ethers v5 to viem
 */
import { createPublicClient, http, PublicClient, parseUnits, formatUnits } from 'viem';
import { ChainConfig, UserAccountData, LiquidationTarget, Asset } from './types';

// ABIs for Aave contracts
const POOL_ABI = [
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserAccountData',
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getReservesList',
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserEMode',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const POOL_DATA_PROVIDER_ABI = [
  {
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    name: 'getUserReserveData',
    outputs: [
      { name: 'currentATokenBalance', type: 'uint256' },
      { name: 'currentStableDebt', type: 'uint256' },
      { name: 'currentVariableDebt', type: 'uint256' },
      { name: 'principalStableDebt', type: 'uint256' },
      { name: 'scaledVariableDebt', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'stableRateLastUpdated', type: 'uint40' },
      { name: 'usageAsCollateralEnabled', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'asset', type: 'address' }],
    name: 'getReserveConfigurationData',
    outputs: [
      { name: 'decimals', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'liquidationThreshold', type: 'uint256' },
      { name: 'liquidationBonus', type: 'uint256' },
      { name: 'reserveFactor', type: 'uint256' },
      { name: 'usageAsCollateralEnabled', type: 'bool' },
      { name: 'borrowingEnabled', type: 'bool' },
      { name: 'stableBorrowRateEnabled', type: 'bool' },
      { name: 'isActive', type: 'bool' },
      { name: 'isFrozen', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const ERC20_ABI = [
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

export class HealthFactorMonitor {
  private chain: ChainConfig;
  private client: PublicClient;
  private monitoredUsers: Map<string, LiquidationTarget> = new Map();
  private reservesList: string[] = [];
  private reservesData: Map<string, any> = new Map();
  private tokenSymbols: Map<string, string> = new Map();
  private tokenDecimals: Map<string, number> = new Map();

  constructor(chain: ChainConfig) {
    this.chain = chain;

    if (!chain.aaveContracts) {
      throw new Error(`Chain ${chain.name} has no Aave contracts configured`);
    }

    this.client = createPublicClient({
      transport: http(chain.rpcUrl),
    });
  }

  /**
   * Initialize by loading the reserves list
   */
  public async initialize(): Promise<void> {
    if (!this.chain.aaveContracts) return;

    try {
      this.reservesList = await this.client.readContract({
        address: this.chain.aaveContracts.pool as `0x${string}`,
        abi: POOL_ABI,
        functionName: 'getReservesList',
      }) as string[];

      console.log(`[${this.chain.name}] Loaded ${this.reservesList.length} reserves`);

      // Pre-fetch reserve configuration data and token info
      for (const asset of this.reservesList) {
        await this.getReserveInfo(asset);
      }
    } catch (error) {
      console.error(`[${this.chain.name}] Failed to initialize HealthFactorMonitor:`, error);
      throw error;
    }
  }

  /**
   * Get reserve info including token symbol, decimals, and configuration
   */
  private async getReserveInfo(asset: string): Promise<any> {
    if (!this.chain.aaveContracts) return null;

    // Check if we already have this data cached
    if (this.reservesData.has(asset)) {
      return this.reservesData.get(asset);
    }

    try {
      // Get reserve configuration data
      const configData = (await this.client.readContract({
        address: this.chain.aaveContracts.poolDataProvider as `0x${string}`,
        abi: POOL_DATA_PROVIDER_ABI,
        functionName: 'getReserveConfigurationData',
        args: [asset as `0x${string}`],
      })) as readonly [bigint, bigint, bigint, bigint, bigint, boolean, boolean, boolean, boolean, boolean];

      // Get token symbol and decimals
      const [symbol, decimals] = await Promise.all([
        this.client.readContract({
          address: asset as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }) as Promise<string>,
        this.client.readContract({
          address: asset as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }) as Promise<number>,
      ]);

      this.tokenSymbols.set(asset, symbol);
      this.tokenDecimals.set(asset, decimals);

      const reserveInfo = {
        symbol,
        decimals,
        ltv: configData[1],
        liquidationThreshold: configData[2],
        liquidationBonus: configData[3],
        usageAsCollateralEnabled: configData[5],
      };

      this.reservesData.set(asset, reserveInfo);
      return reserveInfo;
    } catch (error) {
      console.error(`[${this.chain.name}] Failed to get reserve info for ${asset}:`, error);
      throw error;
    }
  }

  /**
   * Get user account data from Aave
   */
  public async getUserAccountData(userAddress: string): Promise<UserAccountData> {
    if (!this.chain.aaveContracts) {
      throw new Error(`Chain ${this.chain.name} has no Aave contracts`);
    }

    try {
      const data = (await this.client.readContract({
        address: this.chain.aaveContracts.pool as `0x${string}`,
        abi: POOL_ABI,
        functionName: 'getUserAccountData',
        args: [userAddress as `0x${string}`],
      })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

      return {
        totalCollateralBase: data[0],
        totalDebtBase: data[1],
        availableBorrowsBase: data[2],
        currentLiquidationThreshold: data[3],
        ltv: data[4],
        healthFactor: data[5],
        user: userAddress,
      };
    } catch (error) {
      console.error(`[${this.chain.name}] Failed to get user account data for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed user position including collateral and debt assets
   */
  public async getUserDetailedPosition(userAddress: string): Promise<LiquidationTarget> {
    if (!this.chain.aaveContracts) {
      throw new Error(`Chain ${this.chain.name} has no Aave contracts`);
    }

    try {
      // Get basic account data first
      const accountData = await this.getUserAccountData(userAddress);

      // Get E-Mode category ID
      const eModeCategoryId = await this.client.readContract({
        address: this.chain.aaveContracts.pool as `0x${string}`,
        abi: POOL_ABI,
        functionName: 'getUserEMode',
        args: [userAddress as `0x${string}`],
      }) as bigint;

      // Initialize arrays for collateral and debt assets
      const collateralAssets: Asset[] = [];
      const debtAssets: Asset[] = [];

      // Check each reserve to see if the user has collateral or debt
      for (const asset of this.reservesList) {
        const userReserveData = (await this.client.readContract({
          address: this.chain.aaveContracts.poolDataProvider as `0x${string}`,
          abi: POOL_DATA_PROVIDER_ABI,
          functionName: 'getUserReserveData',
          args: [asset as `0x${string}`, userAddress as `0x${string}`],
        })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, boolean];

        const currentATokenBalance = userReserveData[0];
        const currentStableDebt = userReserveData[1];
        const currentVariableDebt = userReserveData[2];
        const usageAsCollateralEnabled = userReserveData[8];

        // If user has either collateral or debt in this asset
        if (currentATokenBalance > 0n || currentStableDebt > 0n || currentVariableDebt > 0n) {
          const reserveInfo = await this.getReserveInfo(asset);

          // If user has collateral
          if (currentATokenBalance > 0n && usageAsCollateralEnabled) {
            collateralAssets.push({
              symbol: reserveInfo.symbol,
              address: asset,
              decimals: reserveInfo.decimals,
              amount: currentATokenBalance,
              amountUsd: 0, // Will be calculated later with price data
              lastUpdateTimestamp: Date.now(),
              liquidationThreshold: Number(reserveInfo.liquidationThreshold) / 10000,
              liquidationBonus: Number(reserveInfo.liquidationBonus) / 10000,
            });
          }

          // If user has debt
          const totalDebt = currentStableDebt + currentVariableDebt;
          if (totalDebt > 0n) {
            debtAssets.push({
              symbol: reserveInfo.symbol,
              address: asset,
              decimals: reserveInfo.decimals,
              amount: totalDebt,
              amountUsd: 0, // Will be calculated later with price data
              lastUpdateTimestamp: Date.now(),
            });
          }
        }
      }

      return {
        user: userAddress,
        healthFactor: accountData.healthFactor,
        totalCollateralBase: accountData.totalCollateralBase,
        totalDebtBase: accountData.totalDebtBase,
        collateralAssets,
        debtAssets,
        eModeCategoryId: Number(eModeCategoryId),
      };
    } catch (error) {
      console.error(`[${this.chain.name}] Failed to get detailed position for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Scan for accounts with low health factors
   */
  public async scanForLowHealthFactors(addresses: string[]): Promise<LiquidationTarget[]> {
    const targets: LiquidationTarget[] = [];
    const healthFactorThreshold = parseUnits(
      (this.chain.strategy?.healthFactorThreshold || 1.05).toString(),
      18
    );

    for (const address of addresses) {
      try {
        const userData = await this.getUserAccountData(address);

        // If health factor is below our monitoring threshold, get detailed position
        if (userData.healthFactor < healthFactorThreshold) {
          const detailedPosition = await this.getUserDetailedPosition(address);
          targets.push(detailedPosition);

          // Also update our monitored users map
          this.monitoredUsers.set(address, detailedPosition);
        }
      } catch (error) {
        console.error(`[${this.chain.name}] Error scanning health factor for ${address}:`, error);
      }
    }

    return targets;
  }

  /**
   * Get users with health factor below liquidation threshold
   */
  public async getLiquidatablePositions(): Promise<LiquidationTarget[]> {
    const liquidatablePositions: LiquidationTarget[] = [];
    const healthFactorLiquidationThreshold = parseUnits('1', 18);

    // First update the health factors of already monitored users
    const monitoredAddresses = Array.from(this.monitoredUsers.keys());

    for (const address of monitoredAddresses) {
      try {
        const userData = await this.getUserAccountData(address);
        const currentTarget = this.monitoredUsers.get(address);

        if (currentTarget) {
          // Update the health factor
          currentTarget.healthFactor = userData.healthFactor;

          // If health factor is below liquidation threshold, add to liquidatable positions
          if (userData.healthFactor < healthFactorLiquidationThreshold) {
            // Refresh the detailed position to get the most up-to-date data
            const detailedPosition = await this.getUserDetailedPosition(address);
            liquidatablePositions.push(detailedPosition);
          }
        }
      } catch (error) {
        console.error(`[${this.chain.name}] Error updating health factor for ${address}:`, error);
      }
    }

    return liquidatablePositions;
  }

  /**
   * Get chain configuration
   */
  public getChain(): ChainConfig {
    return this.chain;
  }
}
