import { describe, expect, it } from 'vitest';
import {
  getKaskadVaultLiquidationUnsupportedError,
  hasKaskadReadWrapper,
  isKaskadConfigured,
} from '../kaskad';
import type { ChainConfig } from '../types';

function createChain(overrides: Partial<ChainConfig> = {}): ChainConfig {
  return {
    name: 'Galleon Testnet',
    deployerKeyEnv: 'TEST_KEY',
    chainId: 38836,
    enabled: true,
    rpcUrl: 'http://127.0.0.1:8545',
    vaultAddress: '0x9999999999999999999999999999999999999999',
    aaveContracts: {
      pool: '0x1111111111111111111111111111111111111111',
      poolDataProvider: '0x2222222222222222222222222222222222222222',
      oracle: '0x3333333333333333333333333333333333333333',
      poolAddressesProvider: '0x4444444444444444444444444444444444444444',
    },
    ...overrides,
  };
}

describe('Kaskad liquidation safety helpers', () => {
  it('detects a complete Kaskad read-wrapper configuration', () => {
    const chain = createChain({
      kaskad: {
        priceOracle: '0x5555555555555555555555555555555555555555',
        router: '0x6666666666666666666666666666666666666666',
        uiDataProviderWrapper: '0x7777777777777777777777777777777777777777',
        enclaveApiUrl: 'https://oracle.kaskad.live',
      },
    });

    expect(isKaskadConfigured(chain)).toBe(true);
    expect(hasKaskadReadWrapper(chain)).toBe(true);
  });

  it('does not mark plain Aave chains as Kaskad-configured', () => {
    const chain = createChain();

    expect(isKaskadConfigured(chain)).toBe(false);
    expect(hasKaskadReadWrapper(chain)).toBe(false);
    expect(getKaskadVaultLiquidationUnsupportedError(chain)).toBeNull();
  });

  it('blocks AgentVaultV3 liquidation when Kaskad is configured', () => {
    const chain = createChain({
      kaskad: {
        router: '0x6666666666666666666666666666666666666666',
      },
    });

    expect(getKaskadVaultLiquidationUnsupportedError(chain)).toContain(
      'AgentVaultV3.liquidate calls Aave Pool.liquidationCall directly'
    );
  });
});
