import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

export interface PairConfig {
  name: string;
  tokenA: string;
  tokenB: string;
}

const TOKENS = {
  WKAS: '0xf40178040278E16c8813dB20a84119A605812FB3',
  WBTC: '0x508B83AB67fEDcd1e8b6F8AE88F5Eb0B1670eFb6',
  WETH: '0x54319ceE10d537Dec6aa812d6f22eC3F31AC7ca6',
  DAI: '0x9E7edE66d39d9b69d817b7368CD9d66a7D6Dc468',
  USDC: '0xFC84a4b04E0074D08c4242A291bfC73840E5Ad14',
  USDT: '0xDaf8B68Cdf320727af105bCa68e174b5EDB3433E',
};

export const CONFIG = {
  // Network — IGRA Galleon Testnet
  rpcUrl: process.env.IGRA_RPC_URL || 'https://galleon-testnet.igralabs.com:8545',
  chainId: 38836,
  
  // KaspaCom API (proxies subgraph data — subgraph is k8s internal only)
  apiBaseUrl: 'https://dev-api-defi.kaspa.com',
  network: 'kasplex', // query param for API
  
  // LFG API (launchpad graduation events)
  lfgApiBaseUrl: 'https://api.dev-lfg.kaspa.com',
  
  // DEX Contracts — IGRA Galleon Testnet
  vaultAddress: process.env.VAULT_ADDRESS || '0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9',
  routerAddress: process.env.DEX_ROUTER || '0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e',
  factoryAddress: process.env.DEX_FACTORY || '0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E',
  wkasAddress: '0xf40178040278E16c8813dB20a84119A605812FB3',
  wrapperRouterAddress: '0x5B7e7830851816f8ad968B0e0c336bd50b4860Ad',
  
  // Tokens
  tokens: TOKENS,
  
  // Pairs to monitor and manage
  pairs: [
    { name: 'WKAS/USDC', tokenA: TOKENS.WKAS, tokenB: TOKENS.USDC },
    { name: 'WKAS/USDT', tokenA: TOKENS.WKAS, tokenB: TOKENS.USDT },
    { name: 'WBTC/WKAS', tokenA: TOKENS.WBTC, tokenB: TOKENS.WKAS },
  ] as PairConfig[],
  
  // Agent behavior
  checkIntervalMs: 30_000,
  maxSlippageBps: 100,
  targetSpreadBps: 200,
  rebalanceThreshold: 0.1,
  
  // Risk limits
  maxTradeSizeEth: '100',
  dailyVolumeLimitEth: '5000',
};
