import { describe, expect, it } from 'vitest';
import { HealthFactorMonitor } from '../health-monitor';
import type { ChainConfig } from '../types';

function createChainConfig(aaveContracts: ChainConfig['aaveContracts']): ChainConfig {
  return {
    name: 'Test Chain',
    chainId: 1,
    enabled: true,
    rpcUrl: 'http://127.0.0.1:8545',
    aaveContracts,
    strategy: {
      minProfitUsd: 50,
      maxGasPriceGwei: 100,
      healthFactorThreshold: 1.05,
      maxPositionsToMonitor: 50,
    },
  };
}

describe('HealthFactorMonitor', () => {
  it('throws if chain has no aaveContracts', () => {
    expect(() => new HealthFactorMonitor(createChainConfig(null))).toThrow(
      'Chain Test Chain has no Aave contracts configured'
    );
  });

  it('accepts a valid chain config', () => {
    const monitor = new HealthFactorMonitor(
      createChainConfig({
        pool: '0x1111111111111111111111111111111111111111',
        poolDataProvider: '0x2222222222222222222222222222222222222222',
        oracle: '0x3333333333333333333333333333333333333333',
      })
    );

    expect(monitor).toBeInstanceOf(HealthFactorMonitor);
  });

  it('returns the config passed to the constructor', () => {
    const chain = createChainConfig({
      pool: '0x1111111111111111111111111111111111111111',
      poolDataProvider: '0x2222222222222222222222222222222222222222',
      oracle: '0x3333333333333333333333333333333333333333',
    });
    const monitor = new HealthFactorMonitor(chain);

    expect(monitor.getChain()).toBe(chain);
  });
});
