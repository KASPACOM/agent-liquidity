import { unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PositionStore, type LPPosition } from '../positions';

describe('PositionStore', () => {
  let filePath: string;
  let store: PositionStore;

  const position: LPPosition = {
    pairAddress: '0xAbCdEf1234567890abcdef1234567890ABCDef12',
    pairName: 'TEST/WKAS',
    lpTokens: '1000',
    entryPriceRatio: 2,
    entryTimestamp: 1_700_000_000_000,
    entryReserve0: '100',
    entryReserve1: '200',
    totalFeesEarned: 1.25,
    lastCheckedTimestamp: 1_700_000_100_000,
  };

  beforeEach(() => {
    filePath = path.join(os.tmpdir(), `positions-${Date.now()}-${Math.random()}.json`);
    store = new PositionStore(filePath);
  });

  afterEach(async () => {
    await unlink(filePath).catch(() => undefined);
  });

  it('returns an empty array for a new store', async () => {
    await expect(store.getAll()).resolves.toEqual([]);
  });

  it('upserts and fetches a stored position', async () => {
    await store.upsert(position);

    await expect(store.get(position.pairAddress)).resolves.toEqual(position);
  });

  it('updates an existing position instead of duplicating it', async () => {
    await store.upsert(position);
    await store.upsert({
      ...position,
      pairAddress: position.pairAddress.toLowerCase(),
      totalFeesEarned: 4.5,
    });

    const positions = await store.getAll();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.totalFeesEarned).toBe(4.5);
  });

  it('removes a position by address', async () => {
    await store.upsert(position);
    await store.remove(position.pairAddress);

    await expect(store.get(position.pairAddress)).resolves.toBeUndefined();
    await expect(store.getAll()).resolves.toEqual([]);
  });

  it('matches addresses case-insensitively', async () => {
    await store.upsert(position);

    await expect(store.get(position.pairAddress.toLowerCase())).resolves.toEqual(position);
  });

  it('persists data across store instances', async () => {
    await store.upsert(position);

    const nextStore = new PositionStore(filePath);
    await expect(nextStore.getAll()).resolves.toEqual([position]);
  });
});
