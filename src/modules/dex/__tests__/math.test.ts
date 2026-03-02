import { describe, expect, it } from 'vitest';
import { calcIL, calcLpValue, getAmountIn, getAmountOut } from '../math';

describe('math', () => {
  it('calculates getAmountOut with 1% fee using the v2 formula', () => {
    const amountIn = 10n * 10n ** 18n;
    const reserveIn = 100n * 10n ** 18n;
    const reserveOut = 200n * 10n ** 18n;
    const expected =
      ((amountIn * 990n) * reserveOut) / (reserveIn * 1000n + amountIn * 990n);

    expect(getAmountOut(amountIn, reserveIn, reserveOut)).toBe(expected);
  });

  it('returns zero output for zero input or zero reserves', () => {
    expect(getAmountOut(0n, 100n, 200n)).toBe(0n);
    expect(getAmountOut(1n, 0n, 200n)).toBe(0n);
    expect(getAmountOut(1n, 100n, 0n)).toBe(0n);
  });

  it('handles large reserve values in getAmountOut', () => {
    const amountIn = 1_000n * 10n ** 18n;
    const reserveIn = 200_000n * 10n ** 18n;
    const reserveOut = 100_000n * 10n ** 18n;
    const expected =
      ((amountIn * 990n) * reserveOut) / (reserveIn * 1000n + amountIn * 990n);

    expect(getAmountOut(amountIn, reserveIn, reserveOut)).toBe(expected);
  });

  it('computes getAmountIn as the reverse of getAmountOut with rounding up', () => {
    const amountIn = 7n * 10n ** 18n;
    const reserveIn = 500n * 10n ** 18n;
    const reserveOut = 750n * 10n ** 18n;
    const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);

    expect(amountOut).toBeGreaterThan(0n);
    expect(getAmountIn(amountOut, reserveIn, reserveOut)).toBeGreaterThanOrEqual(amountIn);
  });

  it('calculates impermanent loss for known price ratios', () => {
    expect(calcIL(1)).toBe(0);
    expect(calcIL(2)).toBeCloseTo(-0.0572, 4);
    expect(calcIL(4)).toBeCloseTo(-0.2, 10);
    expect(calcIL(0.5)).toBeCloseTo(calcIL(2), 10);
    expect(calcIL(0)).toBe(0);
    expect(calcIL(-1)).toBe(0);
  });

  it('calculates LP value and guards invalid inputs', () => {
    expect(calcLpValue(50_000, 2_000)).toBe(20_000);
    expect(calcLpValue(0, 2_000)).toBe(0);
    expect(calcLpValue(-1, 2_000)).toBe(0);
  });
});
