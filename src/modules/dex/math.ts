const V2_FEE_DENOMINATOR = 1000n;
const DEFAULT_FEE_BPS = 10n;

export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps = DEFAULT_FEE_BPS
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;

  const amountInWithFee = amountIn * (V2_FEE_DENOMINATOR - feeBps);
  return (amountInWithFee * reserveOut) / (reserveIn * V2_FEE_DENOMINATOR + amountInWithFee);
}

export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps = DEFAULT_FEE_BPS
): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= amountOut) return 0n;

  return (
    (reserveIn * amountOut * V2_FEE_DENOMINATOR) /
      ((reserveOut - amountOut) * (V2_FEE_DENOMINATOR - feeBps)) +
    1n
  );
}

export function calcIL(priceRatio: number): number {
  if (!Number.isFinite(priceRatio) || priceRatio <= 0) return 0;
  return (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1;
}

export function calcLpValue(k: number, price: number): number {
  if (!Number.isFinite(k) || !Number.isFinite(price) || k <= 0 || price <= 0) return 0;
  return 2 * Math.sqrt(k * price);
}

