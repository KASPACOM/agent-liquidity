import { describe, expect, it } from 'vitest';
import { ArbitrageEngine } from '../arbitrage';
import { type PairSnapshot } from '../smart-lp';

function mockPair(overrides: Partial<PairSnapshot> = {}): PairSnapshot {
  return {
    pairAddress: '0x1111111111111111111111111111111111111111',
    pairName: 'PAIR-1',
    token0: '0x1111111111111111111111111111111111111111',
    token1: '0x9999999999999999999999999999999999999999',
    reserve0: 1_000n * 10n ** 18n,
    reserve1: 2_000n * 10n ** 18n,
    totalSupply: 1_000_000n * 10n ** 18n,
    vaultLpBalance: 0n,
    vaultToken0Balance: 0n,
    vaultToken1Balance: 1_000n * 10n ** 18n,
    price0in1: 2,
    price1in0: 0.5,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ArbitrageEngine', () => {
  const engine = new ArbitrageEngine();

  it('returns null when only one pool is available', () => {
    expect(engine.findBestOpportunity([mockPair()])).toBeNull();
  });

  it('returns null when pool prices are the same', () => {
    const opportunity = engine.findBestOpportunity([
      mockPair(),
      mockPair({
        pairAddress: '0x2222222222222222222222222222222222222222',
        pairName: 'PAIR-2',
      }),
    ]);

    expect(opportunity).toBeNull();
  });

  it('returns null when spread is below the 2 percent threshold', () => {
    const opportunity = engine.findBestOpportunity([
      mockPair(),
      mockPair({
        pairAddress: '0x2222222222222222222222222222222222222222',
        pairName: 'PAIR-2',
        reserve1: 2_030n * 10n ** 18n,
        price0in1: 2.03,
        price1in0: 1 / 2.03,
      }),
    ]);

    expect(opportunity).toBeNull();
  });

  it('finds an opportunity when spread is large enough', () => {
    const opportunity = engine.findBestOpportunity([
      mockPair(),
      mockPair({
        pairAddress: '0x2222222222222222222222222222222222222222',
        pairName: 'PAIR-2',
        reserve1: 2_400n * 10n ** 18n,
        price0in1: 2.4,
        price1in0: 1 / 2.4,
      }),
    ]);

    expect(opportunity).not.toBeNull();
    expect(opportunity?.spreadPct).toBeGreaterThan(2);
    expect(opportunity?.expectedProfit).toBeGreaterThan(0n);
  });

  it('chooses the correct buy and sell direction based on the cheaper pool', () => {
    const opportunity = engine.findBestOpportunity([
      mockPair({
        pairAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pairName: 'CHEAP',
        reserve1: 1_900n * 10n ** 18n,
        price0in1: 1.9,
        price1in0: 1 / 1.9,
      }),
      mockPair({
        pairAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pairName: 'RICH',
        reserve1: 2_400n * 10n ** 18n,
        price0in1: 2.4,
        price1in0: 1 / 2.4,
      }),
    ]);

    expect(opportunity?.buyPairName).toBe('CHEAP');
    expect(opportunity?.sellPairName).toBe('RICH');
  });
});
