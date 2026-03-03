import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyManager } from '../strategy';
import type { ChainConfig, ExecutionResult } from '../types';

function createChain(overrides: Partial<ChainConfig> = {}): ChainConfig {
  return {
    name: 'Test Chain',
    chainId: 1,
    enabled: true,
    rpcUrl: 'http://127.0.0.1:8545',
    aaveContracts: {
      pool: '0x1111111111111111111111111111111111111111',
      poolDataProvider: '0x2222222222222222222222222222222222222222',
      oracle: '0x3333333333333333333333333333333333333333',
    },
    strategy: {
      minProfitUsd: 50,
      maxGasPriceGwei: 100,
      healthFactorThreshold: 1.05,
      maxPositionsToMonitor: 100,
    },
    ...overrides,
  };
}

describe('StrategyManager', () => {
  let manager: StrategyManager;

  beforeEach(() => {
    manager = new StrategyManager();
  });

  it('cycle() does nothing when isRunning is false', async () => {
    const scanSpy = vi.fn();
    const executeSpy = vi.fn();

    (manager as any).scanForOpportunities = scanSpy;
    (manager as any).executeStrategy = executeSpy;

    await manager.cycle([createChain()]);

    expect(scanSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('cycle() skips chains with enabled: false', async () => {
    const scanSpy = vi.fn();
    const executeSpy = vi.fn();

    manager.start();
    (manager as any).scanForOpportunities = scanSpy;
    (manager as any).executeStrategy = executeSpy;

    await manager.cycle([createChain({ enabled: false })]);

    expect(scanSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('cycle() skips chains with aaveContracts: null', async () => {
    const scanSpy = vi.fn();
    const executeSpy = vi.fn();

    manager.start();
    (manager as any).scanForOpportunities = scanSpy;
    (manager as any).executeStrategy = executeSpy;

    await manager.cycle([createChain({ aaveContracts: null })]);

    expect(scanSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('start() sets isRunning to true', () => {
    manager.start();

    expect((manager as any).isRunning).toBe(true);
  });

  it('stop() sets isRunning to false', () => {
    manager.start();
    manager.stop();

    expect((manager as any).isRunning).toBe(false);
  });

  it('addAddressesToMonitor() stores addresses and deduplicates', () => {
    manager.addAddressesToMonitor(1, ['0xaaa', '0xbbb']);
    manager.addAddressesToMonitor(1, ['0xbbb', '0xccc']);

    expect((manager as any).knownAddresses.get(1)).toEqual(['0xaaa', '0xbbb', '0xccc']);
  });

  it('getExecutionHistory() returns an empty array initially', () => {
    expect(manager.getExecutionHistory()).toEqual([]);
  });

  it('skips execution during cooldown if the last execution was less than 60 seconds ago', async () => {
    const chain = createChain();
    const getLiquidatablePositions = vi.fn();

    (manager as any).chainMonitors.set(chain.chainId, {
      getLiquidatablePositions,
    });
    (manager as any).lastExecutionTime.set(chain.chainId, Date.now() - 30_000);

    await (manager as any).executeStrategy(chain);

    expect(getLiquidatablePositions).not.toHaveBeenCalled();
  });

  it('exposes the chain-dependent methods with callable async signatures', async () => {
    expect(typeof manager.cycle).toBe('function');
    expect(typeof (manager as any).scanForOpportunities).toBe('function');

    const result = manager.cycle([]);

    await expect(result).resolves.toBeUndefined();
  });

  it('returns execution history entries after internal execution recording', () => {
    const record: ExecutionResult = {
      success: true,
      transactionHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      timestamp: Date.now(),
      chainId: 1,
    };

    (manager as any).executionHistory.push(record);

    expect(manager.getExecutionHistory()).toEqual([record]);
  });
});
