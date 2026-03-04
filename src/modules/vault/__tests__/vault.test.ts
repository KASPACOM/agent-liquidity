import { describe, it, expect } from 'vitest';

// AgentVault v2 integration tests (unit-level, no on-chain calls)
// Tests the vault interaction logic: ABI encoding, parameter validation,
// slippage calculation, and safety checks before sending TXs

const BPS_DENOMINATOR = 10_000n;

// Helper: replicate vault's on-chain slippage check
function calculateMinOut(expectedOut: bigint, maxSlippageBps: bigint): bigint {
  return (expectedOut * (BPS_DENOMINATOR - maxSlippageBps)) / BPS_DENOMINATOR;
}

// Helper: check if trade exceeds max trade size
function validateTradeSize(amountIn: bigint, maxTradeSize: bigint): boolean {
  return amountIn <= maxTradeSize;
}

// Helper: check if trade exceeds daily volume
function validateDailyVolume(
  amountIn: bigint,
  dailyVolumeUsed: bigint,
  dailyVolumeLimit: bigint
): boolean {
  return dailyVolumeUsed + amountIn <= dailyVolumeLimit;
}

// Helper: check circuit breaker
function isCircuitBreakerTriggered(
  currentNAV: bigint,
  navAtDayStart: bigint,
  maxDrawdownBps: bigint
): boolean {
  if (navAtDayStart === 0n) return false;
  const threshold = (navAtDayStart * (BPS_DENOMINATOR - maxDrawdownBps)) / BPS_DENOMINATOR;
  return currentNAV < threshold;
}

// Helper: calculate LP token amounts for addLiquidity
function calculateLPAmounts(
  amountADesired: bigint,
  amountBDesired: bigint,
  reserveA: bigint,
  reserveB: bigint
): { amountA: bigint; amountB: bigint } {
  if (reserveA === 0n && reserveB === 0n) {
    return { amountA: amountADesired, amountB: amountBDesired };
  }
  const amountBOptimal = (amountADesired * reserveB) / reserveA;
  if (amountBOptimal <= amountBDesired) {
    return { amountA: amountADesired, amountB: amountBOptimal };
  }
  const amountAOptimal = (amountBDesired * reserveA) / reserveB;
  return { amountA: amountAOptimal, amountB: amountBDesired };
}

// Helper: detect arb opportunity between two pairs
function detectArbOpportunity(
  priceA: number,
  priceB: number,
  spreadThresholdBps: number = 200 // 2%
): { hasOpportunity: boolean; spreadBps: number; buyFrom: 'A' | 'B' } {
  const spread = Math.abs(priceA - priceB) / Math.min(priceA, priceB);
  const spreadBps = Math.round(spread * 10_000);
  const hasOpportunity = spreadBps >= spreadThresholdBps;
  const buyFrom = priceA < priceB ? 'A' : 'B';
  return { hasOpportunity, spreadBps, buyFrom };
}

describe('AgentVault v2 — interaction logic', () => {
  describe('slippage calculation', () => {
    it('calculates 1% slippage correctly', () => {
      const expectedOut = 100_000_000_000_000_000_000n; // 100 tokens
      const minOut = calculateMinOut(expectedOut, 100n); // 100 bps = 1%
      expect(minOut).toBe(99_000_000_000_000_000_000n); // 99 tokens
    });

    it('calculates 0.5% slippage correctly', () => {
      const expectedOut = 1_000_000_000_000_000_000n; // 1 token
      const minOut = calculateMinOut(expectedOut, 50n); // 50 bps = 0.5%
      expect(minOut).toBe(995_000_000_000_000_000n);
    });

    it('returns 0 for 100% slippage', () => {
      const expectedOut = 100n;
      const minOut = calculateMinOut(expectedOut, 10_000n); // 100%
      expect(minOut).toBe(0n);
    });

    it('returns full amount for 0% slippage', () => {
      const expectedOut = 100n;
      const minOut = calculateMinOut(expectedOut, 0n);
      expect(minOut).toBe(100n);
    });
  });

  describe('trade size validation', () => {
    const maxTradeSize = 100_000_000_000_000_000_000n; // 100 KAS

    it('allows trade within limit', () => {
      expect(validateTradeSize(50_000_000_000_000_000_000n, maxTradeSize)).toBe(true);
    });

    it('allows trade at exact limit', () => {
      expect(validateTradeSize(maxTradeSize, maxTradeSize)).toBe(true);
    });

    it('rejects trade exceeding limit', () => {
      expect(validateTradeSize(maxTradeSize + 1n, maxTradeSize)).toBe(false);
    });
  });

  describe('daily volume validation', () => {
    const dailyLimit = 5_000_000_000_000_000_000_000n; // 5000 KAS

    it('allows trade within remaining volume', () => {
      const used = 1_000_000_000_000_000_000_000n; // 1000 used
      expect(validateDailyVolume(100_000_000_000_000_000_000n, used, dailyLimit)).toBe(true);
    });

    it('rejects trade that would exceed daily limit', () => {
      const used = 4_950_000_000_000_000_000_000n; // 4950 used
      expect(validateDailyVolume(100_000_000_000_000_000_000n, used, dailyLimit)).toBe(false);
    });

    it('allows trade that exactly hits the limit', () => {
      const used = 4_900_000_000_000_000_000_000n;
      expect(validateDailyVolume(100_000_000_000_000_000_000n, used, dailyLimit)).toBe(true);
    });
  });

  describe('circuit breaker', () => {
    const maxDrawdownBps = 1_000n; // 10%

    it('does not trigger when NAV is above threshold', () => {
      const navStart = 1_000n;
      const navCurrent = 950n; // down 5%
      expect(isCircuitBreakerTriggered(navCurrent, navStart, maxDrawdownBps)).toBe(false);
    });

    it('triggers when NAV drops below threshold', () => {
      const navStart = 1_000n;
      const navCurrent = 899n; // down 10.1%
      expect(isCircuitBreakerTriggered(navCurrent, navStart, maxDrawdownBps)).toBe(true);
    });

    it('does not trigger at exact threshold', () => {
      const navStart = 1_000n;
      const navCurrent = 900n; // exactly 10%
      expect(isCircuitBreakerTriggered(navCurrent, navStart, maxDrawdownBps)).toBe(false);
    });

    it('does not trigger when navAtDayStart is 0 (no snapshot)', () => {
      expect(isCircuitBreakerTriggered(0n, 0n, maxDrawdownBps)).toBe(false);
    });
  });

  describe('LP amount calculation', () => {
    it('returns desired amounts for empty pool', () => {
      const result = calculateLPAmounts(100n, 200n, 0n, 0n);
      expect(result.amountA).toBe(100n);
      expect(result.amountB).toBe(200n);
    });

    it('adjusts amountB to match ratio', () => {
      // Pool ratio is 1:2, depositing 100 A should give 200 B
      const result = calculateLPAmounts(100n, 300n, 1000n, 2000n);
      expect(result.amountA).toBe(100n);
      expect(result.amountB).toBe(200n);
    });

    it('adjusts amountA when amountB is limiting', () => {
      // Pool ratio 1:2, but only 100 B available
      const result = calculateLPAmounts(200n, 100n, 1000n, 2000n);
      expect(result.amountA).toBe(50n);
      expect(result.amountB).toBe(100n);
    });
  });

  describe('arbitrage detection', () => {
    it('detects opportunity when spread exceeds threshold', () => {
      const result = detectArbOpportunity(0.010, 0.0125); // 25% spread
      expect(result.hasOpportunity).toBe(true);
      expect(result.buyFrom).toBe('A'); // A is cheaper
    });

    it('no opportunity when spread is below threshold', () => {
      const result = detectArbOpportunity(0.010, 0.0101); // 1% spread
      expect(result.hasOpportunity).toBe(false);
    });

    it('identifies correct buy direction', () => {
      const result = detectArbOpportunity(0.015, 0.010);
      expect(result.buyFrom).toBe('B'); // B is cheaper
    });

    it('respects custom threshold', () => {
      const result = detectArbOpportunity(0.010, 0.0108, 500); // 8% spread, 5% threshold
      expect(result.hasOpportunity).toBe(true);
    });
  });

  describe('vault token whitelist validation', () => {
    it('validates all tokens in swap path are whitelisted', () => {
      const whitelist = new Set(['0xAAA', '0xBBB', '0xCCC']);
      const path = ['0xAAA', '0xBBB'];
      const allWhitelisted = path.every(t => whitelist.has(t));
      expect(allWhitelisted).toBe(true);
    });

    it('rejects path with non-whitelisted token', () => {
      const whitelist = new Set(['0xAAA', '0xBBB']);
      const path = ['0xAAA', '0xDDD'];
      const allWhitelisted = path.every(t => whitelist.has(t));
      expect(allWhitelisted).toBe(false);
    });
  });

  describe('withdrawal delay validation', () => {
    it('allows execution after delay', () => {
      const requestedAt = 1000;
      const now = 1000 + 86400 + 1; // 24h + 1s
      const delay = 86400;
      expect(now >= requestedAt + delay).toBe(true);
    });

    it('blocks execution before delay', () => {
      const requestedAt = 1000;
      const now = 1000 + 3600; // only 1h
      const delay = 86400;
      expect(now >= requestedAt + delay).toBe(false);
    });
  });
});
