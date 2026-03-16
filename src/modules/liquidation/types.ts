/**
 * Liquidation Module Types
 */

// Re-export ChainConfig from the canonical config module to avoid duplication
export type { ChainConfig } from '../../config';

// User account data from Aave
export interface UserAccountData {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
  user: string;
}

// Asset details
export interface Asset {
  symbol: string;
  address: string;
  decimals: number;
  amount: bigint;
  amountUsd: number;
  lastUpdateTimestamp: number;
  priceSource?: string;
  liquidationBonus?: number;
  liquidationThreshold?: number;
}

// Position to potentially liquidate
export interface LiquidationTarget {
  user: string;
  healthFactor: bigint;
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  collateralAssets: Asset[];
  debtAssets: Asset[];
  eModeCategoryId: number;
}

// Price data from Aave oracle
export interface PriceData {
  assetAddress: string;
  aaveOraclePrice: bigint;
  timestamp: number;
}

// Profit calculation for a liquidation
export interface LiquidationProfitCalculation {
  target: LiquidationTarget;
  debtAsset: Asset;
  collateralAsset: Asset;
  debtToCover: bigint;
  estimatedDebtToCover: bigint;
  collateralToReceive: bigint;
  liquidationBonus: number;
  estimatedProfitUsd: number;
  estimatedGasCostUsd: number;
  netProfitUsd: number;
  profitable: boolean;
  executionPriority: number;
}

// Execution result
export interface ExecutionResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  gasUsed?: bigint;
  gasCostWei?: bigint;
  profitAmount?: bigint;
  profitUsd?: number;
  timestamp: number;
  chainId?: number;
}
