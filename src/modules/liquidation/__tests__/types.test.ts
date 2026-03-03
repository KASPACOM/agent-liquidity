import { describe, expect, it } from 'vitest';
import type {
  Asset,
  ChainConfig,
  ExecutionResult,
  LiquidationProfitCalculation,
  LiquidationTarget,
} from '../types';

function createAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    symbol: 'USDC',
    address: '0x1111111111111111111111111111111111111111',
    decimals: 6,
    amount: 1_000_000n,
    amountUsd: 1,
    lastUpdateTimestamp: 1_700_000_000,
    ...overrides,
  };
}

function createTarget(): LiquidationTarget {
  return {
    user: '0x2222222222222222222222222222222222222222',
    healthFactor: 900000000000000000n,
    totalCollateralBase: 50_000_000_000n,
    totalDebtBase: 30_000_000_000n,
    collateralAssets: [
      createAsset({
        symbol: 'WKAS',
        address: '0x3333333333333333333333333333333333333333',
        decimals: 18,
        amount: 1_000n * 10n ** 18n,
        amountUsd: 100,
        liquidationBonus: 1.05,
        liquidationThreshold: 0.8,
      }),
    ],
    debtAssets: [createAsset()],
    eModeCategoryId: 0,
  };
}

describe('liquidation types', () => {
  it('constructs a valid ChainConfig with Aave contracts', () => {
    const chain: ChainConfig = {
      name: 'Kasplex',
      chainId: 167_000,
      enabled: true,
      rpcUrl: 'http://127.0.0.1:8545',
      aaveContracts: {
        pool: '0x4444444444444444444444444444444444444444',
        poolDataProvider: '0x5555555555555555555555555555555555555555',
        oracle: '0x6666666666666666666666666666666666666666',
      },
      strategy: {
        minProfitUsd: 50,
        maxGasPriceGwei: 100,
        healthFactorThreshold: 1.05,
        maxPositionsToMonitor: 100,
      },
      monitoring: {
        scanIntervalSeconds: 30,
        enablePerformanceMonitoring: true,
      },
    };

    expect(chain.aaveContracts?.pool).toBe('0x4444444444444444444444444444444444444444');
  });

  it('constructs a valid ChainConfig without Aave contracts', () => {
    const chain: ChainConfig = {
      name: 'NoAave',
      chainId: 999,
      enabled: true,
      rpcUrl: 'http://127.0.0.1:8545',
      aaveContracts: null,
    };

    expect(chain.aaveContracts).toBeNull();
  });

  it('constructs a valid LiquidationTarget with collateral and debt assets', () => {
    const target = createTarget();

    expect(target.collateralAssets).toHaveLength(1);
    expect(target.debtAssets).toHaveLength(1);
    expect(target.collateralAssets[0]?.symbol).toBe('WKAS');
    expect(target.debtAssets[0]?.symbol).toBe('USDC');
  });

  it('constructs a profitable LiquidationProfitCalculation', () => {
    const target = createTarget();
    const debtAsset = target.debtAssets[0]!;
    const collateralAsset = target.collateralAssets[0]!;
    const calculation: LiquidationProfitCalculation = {
      target,
      debtAsset,
      collateralAsset,
      debtToCover: 950_000n,
      collateralToReceive: 9_975n * 10n ** 18n,
      liquidationBonus: 1.05,
      estimatedProfitUsd: 65,
      estimatedGasCostUsd: 5,
      netProfitUsd: 60,
      profitable: true,
      executionPriority: 6,
    };

    expect(calculation.profitable).toBe(true);
    expect(calculation.netProfitUsd).toBeGreaterThan(50);
  });

  it('constructs a non-profitable LiquidationProfitCalculation', () => {
    const target = createTarget();
    const debtAsset = target.debtAssets[0]!;
    const collateralAsset = target.collateralAssets[0]!;
    const calculation: LiquidationProfitCalculation = {
      target,
      debtAsset,
      collateralAsset,
      debtToCover: 95_000n,
      collateralToReceive: 997n * 10n ** 18n,
      liquidationBonus: 1.05,
      estimatedProfitUsd: 10,
      estimatedGasCostUsd: 15,
      netProfitUsd: -5,
      profitable: false,
      executionPriority: 0,
    };

    expect(calculation.profitable).toBe(false);
    expect(calculation.netProfitUsd).toBeLessThanOrEqual(50);
  });

  it('constructs a successful ExecutionResult', () => {
    const result: ExecutionResult = {
      success: true,
      transactionHash: '0x7777777777777777777777777777777777777777777777777777777777777777',
      gasUsed: 500_000n,
      gasCostWei: 10_000_000_000_000_000n,
      profitAmount: 100n,
      profitUsd: 75,
      timestamp: Date.now(),
      chainId: 167_000,
    };

    expect(result.success).toBe(true);
    expect(result.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('constructs a failed ExecutionResult', () => {
    const result: ExecutionResult = {
      success: false,
      error: 'Gas price too high',
      timestamp: Date.now(),
      chainId: 167_000,
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Gas price too high');
  });
});
