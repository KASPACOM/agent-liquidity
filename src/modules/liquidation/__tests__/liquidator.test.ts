import { describe, expect, it } from 'vitest';

type ProfitResult = {
  debtToCover: bigint;
  collateralToReceive: bigint;
  grossProfitUsd: number;
  netProfitUsd: number;
  profitable: boolean;
};

function pow10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function calculateExpectedProfit(
  debtPrice: bigint,
  collateralPrice: bigint,
  debtAmount: bigint,
  debtDecimals: number,
  collateralDecimals: number,
  liquidationBonus: number,
  healthFactor: bigint,
  gasCostUsd = 0,
  minProfitUsd = 50
): ProfitResult {
  const closeFactorHfThreshold = 950000000000000000n;
  const closeFactorMultiplier = healthFactor < closeFactorHfThreshold ? 10000n : 5000n;
  const maxDebtToCover = (debtAmount * closeFactorMultiplier) / 10000n;
  const debtToCover = (maxDebtToCover * 95n) / 100n;
  const collateralToReceive =
    (debtPrice *
      debtToCover *
      pow10(collateralDecimals) *
      BigInt(Math.floor(liquidationBonus * 10000))) /
    (collateralPrice * pow10(debtDecimals) * 10000n);

  const debtUsd = (Number(debtToCover) / 10 ** debtDecimals) * (Number(debtPrice) / 1e8);
  const collateralUsd =
    (Number(collateralToReceive) / 10 ** collateralDecimals) * (Number(collateralPrice) / 1e8);
  const grossProfitUsd = collateralUsd - debtUsd;
  const netProfitUsd = grossProfitUsd - gasCostUsd;

  return {
    debtToCover,
    collateralToReceive,
    grossProfitUsd,
    netProfitUsd,
    profitable: netProfitUsd > minProfitUsd,
  };
}

describe('liquidation profit math', () => {
  it('uses a 100% close factor below the 0.95 health factor threshold', () => {
    const result = calculateExpectedProfit(
      100000000n,
      10000000n,
      1_000n * pow10(6),
      6,
      18,
      1.05,
      900000000000000000n
    );

    expect(result.debtToCover).toBe(950n * pow10(6));
    expect(result.collateralToReceive).toBe(9_975n * pow10(18));
    expect(result.grossProfitUsd).toBeCloseTo(47.5, 8);
    expect(result.profitable).toBe(false);
  });

  it('uses a 50% close factor at or above the 0.95 health factor threshold', () => {
    const result = calculateExpectedProfit(
      100000000n,
      10000000n,
      1_000n * pow10(6),
      6,
      18,
      1.05,
      980000000000000000n
    );

    expect(result.debtToCover).toBe(475n * pow10(6));
    expect(result.collateralToReceive).toBe(4_987_500000000000000000n);
    expect(result.grossProfitUsd).toBeCloseTo(23.75, 8);
    expect(result.profitable).toBe(false);
  });

  it('marks a very small debt as not profitable under the default $50 threshold', () => {
    const result = calculateExpectedProfit(
      100000000n,
      10000000n,
      10n * pow10(6),
      6,
      18,
      1.05,
      900000000000000000n
    );

    expect(result.debtToCover).toBe(9500000n);
    expect(result.netProfitUsd).toBeCloseTo(0.475, 8);
    expect(result.profitable).toBe(false);
  });

  it('treats the liquidation bonus as the gross profit when assets have equal prices', () => {
    const result = calculateExpectedProfit(
      100000000n,
      100000000n,
      1_000n * pow10(6),
      6,
      6,
      1.05,
      900000000000000000n
    );

    expect(result.debtToCover).toBe(950n * pow10(6));
    expect(result.collateralToReceive).toBe(997500000n);
    expect(result.grossProfitUsd).toBeCloseTo(47.5, 8);
    expect(result.netProfitUsd).toBeCloseTo(47.5, 8);
  });

  it('becomes profitable when the bonus-driven gross profit exceeds the minimum threshold', () => {
    const result = calculateExpectedProfit(
      100000000n,
      10000000n,
      2_000n * pow10(6),
      6,
      18,
      1.05,
      900000000000000000n
    );

    expect(result.debtToCover).toBe(1_900n * pow10(6));
    expect(result.grossProfitUsd).toBeCloseTo(95, 8);
    expect(result.profitable).toBe(true);
  });
});
