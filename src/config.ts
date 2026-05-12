import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

interface PairConfig {
  name: string;
  tokenA: string;
  tokenB: string;
  pair: string;
  tokenADecimals?: number;
  tokenBDecimals?: number;
}

export interface ChainConfig {
  name: string;
  chainId: number;
  enabled: boolean;
  rpcUrl: string;
  deployerKeyEnv: string; // env var name for this chain's deployer key

  // Gas price override (wei) — required for chains like Galleon that reject low gas prices
  gasPriceWei?: bigint;

  // DEX contracts
  vaultAddress?: string;
  routerAddress?: string;
  factoryAddress?: string;
  wkasAddress?: string;
  pairs?: PairConfig[];

  // Subgraph URLs (internal k8s Graph Node)
  graphNodeUrl?: string;       // DEX (Uniswap V2) subgraph
  tokenGraphUrl?: string;      // Token subgraph
  aaveSubgraphUrl?: string;    // Aave V3 subgraph (only chains with Aave)

  // Aave contracts (null if not available on this chain)
  aaveContracts: {
    pool: string;
    poolDataProvider: string;
    oracle: string;
    poolAddressesProvider?: string;
  } | null;

  // Kaskad oracle integration (Aave markets that require signed price updates)
  kaskad?: {
    priceOracle?: string;
    router?: string;
    uiDataProviderWrapper?: string;
    enclaveApiUrl?: string;
  };

  // Strategy config for liquidations (only used if Aave exists)
  strategy?: {
    minProfitUsd: number;
    maxGasPriceGwei: number;
    healthFactorThreshold: number;
    maxPositionsToMonitor: number;
    liquidationBonusThreshold?: number;
    gasLimitBuffer?: number;
  };
  monitoring?: {
    scanIntervalSeconds: number;
    enablePerformanceMonitoring: boolean;
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
      enabled: !!(process.env.IGRA_DEPLOYER_PRIVATE_KEY),
      rpcUrl: process.env.IGRA_RPC_URL || 'https://galleon-testnet.igralabs.com:8545',
      deployerKeyEnv: 'IGRA_DEPLOYER_PRIVATE_KEY',
      gasPriceWei: 2_000_000_000_001n, // 2 twei + 1 — Galleon requires strictly > 2 twei

      // DEX contracts
      vaultAddress: process.env.IGRA_VAULT_ADDRESS || '0x8c48623fA429DbF77b1D4788bfE6991e6237110e', // AgentVault V3 (NAV oracle fix) — supports liquidation, PnL tracking
      routerAddress: process.env.IGRA_DEX_ROUTER || '0x47F80b6D7071B7738D6DD9d973D7515ce753e9d9',
      factoryAddress: process.env.IGRA_DEX_FACTORY || '0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0',
      wkasAddress: '0x394C68684F9AFCEb9b804531EF07a864E8081738',
      pairs: [], // Discovered dynamically via subgraph

      // Subgraphs (internal k8s Graph Node)
      graphNodeUrl: process.env.IGRA_GRAPH_NODE_URL,
      tokenGraphUrl: process.env.IGRA_GRAPH_TOKEN_NODE_URL,
      aaveSubgraphUrl: process.env.AAVE_SUBGRAPH_URL,

      // Aave contracts
      aaveContracts: {
        pool: '0xb265EA393A9297472628E21575AE5c7E6458A1F2',
        poolDataProvider: '0xc6b4592171EC79192f838E4050a2453D4D71fBAe',
        oracle: '0x5B83681E48f365cfD2A4Ee29E2B699e38e04EbD9',
        poolAddressesProvider: '0x4f6110740149a550eE89B21Bc81893CB2B56f39f',
      },
      kaskad: {
        priceOracle: process.env.IGRA_KASKAD_PRICE_ORACLE || '0x869764619f0eDA0076Ece6eec2C3509ce01717E1',
        router: process.env.IGRA_KASKAD_ROUTER || '0x7F5712A982e09b4CE43f2B98d8ffE43Db61214aF',
        uiDataProviderWrapper: process.env.IGRA_UI_DATA_PROVIDER_WRAPPER || '0x7b7E99Bd96b99d47B72B08866c1cD16c678E5372',
        enclaveApiUrl: process.env.IGRA_KASKAD_ENCLAVE_API_URL || 'https://oracle.kaskad.live',
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
      enabled: !!(process.env.KASPLEX_DEPLOYER_PRIVATE_KEY),
      rpcUrl: process.env.KASPLEX_RPC_URL || 'https://rpc.kasplextest.xyz',
      deployerKeyEnv: 'KASPLEX_DEPLOYER_PRIVATE_KEY',

      // DEX contracts
      vaultAddress: process.env.KASPLEX_VAULT_ADDRESS || '0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9',
      routerAddress: process.env.KASPLEX_DEX_ROUTER || '0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e',
      factoryAddress: process.env.KASPLEX_DEX_FACTORY || '0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E',
      wkasAddress: '0xf40178040278E16c8813dB20a84119A605812FB3',
      pairs: [], // Discovered dynamically via subgraph

      // Subgraphs (internal k8s Graph Node)
      graphNodeUrl: process.env.KASPLEX_GRAPH_NODE_URL,
      tokenGraphUrl: process.env.KASPLEX_GRAPH_TOKEN_NODE_URL,

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

export type { PairConfig };
