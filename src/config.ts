import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

interface PairConfig {
  name: string;
  tokenA: string;
  tokenB: string;
  pair: string;
}

interface ChainConfig {
  name: string;
  chainId: number;
  enabled: boolean;
  rpcUrl: string;
  deployerKeyEnv: string; // env var name for this chain's deployer key

  // DEX contracts
  vaultAddress?: string;
  routerAddress?: string;
  factoryAddress?: string;
  wkasAddress?: string;
  pairs?: PairConfig[];

  // Aave contracts (null if not available on this chain)
  aaveContracts: {
    pool: string;
    poolDataProvider: string;
    oracle: string;
  } | null;

  // Strategy config for liquidations (only used if Aave exists)
  strategy?: {
    minProfitUsd: number;
    maxGasPriceGwei: number;
    healthFactorThreshold: number;
    maxPositionsToMonitor: number;
  };
}

export const CONFIG = {
  // Global settings
  checkIntervalMs: 30_000,       // check every 30s
  maxSlippageBps: 100,           // 1% max slippage on trades
  rebalanceThreshold: 0.6,       // swap if >60% in one token
  lpFeeBps: 100,                 // KaspaCom DEX fee: 1%

  // Risk limits (must match vault on-chain values)
  maxTradeSizeKas: 100,          // 100 KAS per trade
  dailyVolumeLimitKas: 5_000,    // 5,000 KAS per day

  // KaspaCom API
  apiBaseUrl: 'https://dev-api-defi.kaspa.com',
  network: 'kasplex',

  // Multi-chain config — reads from prefixed env vars (IGRA_*, KASPLEX_*)
  chains: [
    // IGRA Galleon Testnet — DEX + Aave
    {
      name: 'Galleon Testnet',
      chainId: 38836,
      enabled: !!(process.env.IGRA_RPC_URL || process.env.IGRA_VAULT_ADDRESS),
      rpcUrl: process.env.IGRA_RPC_URL || 'https://galleon-testnet.igralabs.com:8545',
      deployerKeyEnv: 'IGRA_DEPLOYER_PRIVATE_KEY',

      // DEX contracts
      vaultAddress: process.env.IGRA_VAULT_ADDRESS || '0xEB661B0baE5383c0789DF2C7FEc190C633c9D1c8',
      routerAddress: process.env.IGRA_DEX_ROUTER || '0x47F80b6D7071B7738D6DD9d973D7515ce753e9d9',
      factoryAddress: process.env.IGRA_DEX_FACTORY || '0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0',
      wkasAddress: '0x394C68684F9AFCEb9b804531EF07a864E8081738',
      pairs: [],

      // Aave contracts
      aaveContracts: {
        pool: '0xb265EA393A9297472628E21575AE5c7E6458A1F2',
        poolDataProvider: '0xc6b4592171EC79192f838E4050a2453D4D71fBAe',
        oracle: '0x5B83681E48f365cfD2A4Ee29E2B699e38e04EbD9',
      },

      // Liquidation strategy
      strategy: {
        minProfitUsd: 50,
        maxGasPriceGwei: 100,
        healthFactorThreshold: 1.05,
        maxPositionsToMonitor: 100,
      },
    },

    // Kasplex Testnet — DEX only (no Aave)
    {
      name: 'Kasplex Testnet',
      chainId: 167012,
      enabled: !!(process.env.KASPLEX_RPC_URL || process.env.KASPLEX_VAULT_ADDRESS),
      rpcUrl: process.env.KASPLEX_RPC_URL || 'https://rpc.kasplextest.xyz',
      deployerKeyEnv: 'KASPLEX_DEPLOYER_PRIVATE_KEY',

      // DEX contracts
      vaultAddress: process.env.KASPLEX_VAULT_ADDRESS || '0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9',
      routerAddress: process.env.KASPLEX_DEX_ROUTER || '0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e',
      factoryAddress: process.env.KASPLEX_DEX_FACTORY || '0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E',
      wkasAddress: '0xf40178040278E16c8813dB20a84119A605812FB3',

      // Top pairs
      pairs: [
        {
          name: 'TKCOM/WKAS',
          tokenA: '0x0837618e0f914192d05f039d2e394241189ab718',
          tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3',
          pair: '0xc0d4db7b461f760ce1d7823fa715949f0e6e0bf3',
        },
        {
          name: 'TLFG/WKAS',
          tokenA: '0x7a2ce0f68ba02762cad0371f5b304fd9edbdc4b9',
          tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3',
          pair: '0x7ab1a8b1346103bd3deea425e59e1d818a952d43',
        },
        {
          name: 'SPRKAS/WKAS',
          tokenA: '0xea0eca00f964af8f0526c99c0ee4051c59a1dd42',
          tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3',
          pair: '0x2e3cabef509e3e1b457ef15e9ede4e97c9c3b66e',
        },
        {
          name: 'LFG/WKAS',
          tokenA: '0xaa6947db5fb150a207b85bf7f8718ff0120f60f8',
          tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3',
          pair: '0xf8e2470742e46fdf0dd4e3a4347020b00d7bca52',
        },
        {
          name: 'KCOM/WKAS',
          tokenA: '0xbae24fdbd95d7b68ddbe9085ab512deed12ab0e9',
          tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3',
          pair: '0xe22039fb01649641a2893520b7a290413b1a629b',
        },
      ],

      // No Aave on Kasplex
      aaveContracts: null,
    },
  ] as ChainConfig[],

  // Backward compat: also check legacy DEPLOYER_PRIVATE_KEY
  getDeployerKey(chain: ChainConfig): string {
    const key = process.env[chain.deployerKeyEnv] || process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error(`${chain.deployerKeyEnv} (or DEPLOYER_PRIVATE_KEY) not set`);
    return key;
  },

  // Active chains (all enabled)
  get activeChains(): ChainConfig[] {
    return this.chains.filter(c => c.enabled);
  },

  // First active chain (backward compat)
  get activeChain(): ChainConfig {
    return this.activeChains[0] || this.chains[0];
  },

  // Liquidation enabled? (true if any active chain has Aave)
  get liquidationEnabled(): boolean {
    return this.chains.some(c => c.enabled && c.aaveContracts !== null);
  },

  // DEX enabled? (true if any active chain has DEX contracts)
  get dexEnabled(): boolean {
    return this.chains.some(
      c => c.enabled && c.vaultAddress && c.factoryAddress
    );
  },
};

export type { ChainConfig, PairConfig };
