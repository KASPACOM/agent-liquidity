import { unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PositionStore, type LPPosition } from '../positions';
import { type PairSnapshot, SmartLPManager, type PairVolumeData } from '../smart-lp';

function mockSnapshot(overrides: Partial<PairSnapshot> = {}): PairSnapshot {
  return {
    pairAddress: '0x1234567890abcdef1234567890abcdef12345678',
    pairName: 'TEST/WKAS',
    token0: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    token1: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    reserve0: 100_000n * 10n ** 18n,
    reserve1: 200_000n * 10n ** 18n,
    totalSupply: 1_000_000n * 10n ** 18n,
    vaultLpBalance: 100_000n * 10n ** 18n,
    vaultToken0Balance: 5_000n * 10n ** 18n,
    vaultToken1Balance: 10_000n * 10n ** 18n,
    price0in1: 2,
    price1in0: 0.5,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('SmartLPManager', () => {
  let filePath: string;
  let store: PositionStore;
  let manager: SmartLPManager;

  beforeEach(() => {
    filePath = path.join(os.tmpdir(), `smart-lp-${Date.now()}-${Math.random()}.json`);
    store = new PositionStore(filePath);
    manager = new SmartLPManager(store);
  });

  afterEach(async () => {
    await unlink(filePath).catch(() => undefined);
  });

  it('returns none when there is no position and no volume', async () => {
    const decision = await manager.evaluate(
      mockSnapshot({
        vaultLpBalance: 0n,
      })
    );

    expect(decision.type).toBe('none');
    expect(decision.reason).toContain('No position and no observable volume');
  });

  it('enters liquidity when there is no position, volume is high, and APR is favorable', async () => {
    const decision = await manager.evaluate(
      mockSnapshot({
        vaultLpBalance: 0n,
      }),
      {
        pairAddress: '0x1234567890abcdef1234567890abcdef12345678',
        dailyVolume: 50_000,
        source: 'test',
      }
    );

    expect(decision.type).toBe('enter_liquidity');
    expect(decision.feeApr).toBeGreaterThan(0.05);
    expect(decision.amountA).toBeGreaterThan(0n);
    expect(decision.amountB).toBeGreaterThan(0n);
  });

  it('removes liquidity when impermanent loss exceeds accumulated fees', async () => {
    const now = Date.now();
    const seeded: LPPosition = {
      pairAddress: '0x1234567890abcdef1234567890abcdef12345678',
      pairName: 'TEST/WKAS',
      lpTokens: (100_000n * 10n ** 18n).toString(),
      entryPriceRatio: 1,
      entryTimestamp: now - 7 * 24 * 60 * 60 * 1000,
      entryReserve0: (100_000n * 10n ** 18n).toString(),
      entryReserve1: (200_000n * 10n ** 18n).toString(),
      totalFeesEarned: 50,
      lastCheckedTimestamp: now - 24 * 60 * 60 * 1000,
    };
    await store.upsert(seeded);

    const decision = await manager.evaluate(mockSnapshot(), {
      pairAddress: seeded.pairAddress,
      dailyVolume: 10_000,
      source: 'test',
    });

    expect(decision.type).toBe('remove_liquidity');
    expect(decision.impermanentLoss).toBeGreaterThan(0);
    expect(decision.liquidity).toBe(100_000n * 10n ** 18n);
  });

  it('adds liquidity when fees dominate IL and current volume supports the position', async () => {
    const now = Date.now();
    await store.upsert({
      pairAddress: '0x1234567890abcdef1234567890abcdef12345678',
      pairName: 'TEST/WKAS',
      lpTokens: (100_000n * 10n ** 18n).toString(),
      entryPriceRatio: 2,
      entryTimestamp: now - 14 * 24 * 60 * 60 * 1000,
      entryReserve0: (100_000n * 10n ** 18n).toString(),
      entryReserve1: (200_000n * 10n ** 18n).toString(),
      totalFeesEarned: 5_000,
      lastCheckedTimestamp: now - 24 * 60 * 60 * 1000,
    });

    const decision = await manager.evaluate(mockSnapshot(), {
      pairAddress: '0x1234567890abcdef1234567890abcdef12345678',
      dailyVolume: 80_000,
      source: 'test',
    });

    expect(decision.type).toBe('add_liquidity');
    expect(decision.amountA).toBeGreaterThan(0n);
    expect(decision.amountB).toBeGreaterThan(0n);
  });

  it('holds when fees exceed IL but current volume is too low to justify adding', async () => {
    const now = Date.now();
    await store.upsert({
      pairAddress: '0x1234567890abcdef1234567890abcdef12345678',
      pairName: 'TEST/WKAS',
      lpTokens: (100_000n * 10n ** 18n).toString(),
      entryPriceRatio: 2,
      entryTimestamp: now - 14 * 24 * 60 * 60 * 1000,
      entryReserve0: (100_000n * 10n ** 18n).toString(),
      entryReserve1: (200_000n * 10n ** 18n).toString(),
      totalFeesEarned: 5_000,
      lastCheckedTimestamp: now - 24 * 60 * 60 * 1000,
    });

    const volume: PairVolumeData = {
      pairAddress: '0x1234567890abcdef1234567890abcdef12345678',
      dailyVolume: 0,
      source: 'test',
    };
    const decision = await manager.evaluate(mockSnapshot(), volume);

    expect(decision.type).toBe('hold');
    expect(decision.reason).toContain('Holding LP');
  });
});
