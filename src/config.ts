import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

export const CONFIG = {
  // Network — Kasplex Testnet
  rpcUrl: process.env.RPC_URL || 'https://rpc.kasplextest.xyz',
  chainId: 167012,

  // KaspaCom API (proxies subgraph data)
  apiBaseUrl: 'https://dev-api-defi.kaspa.com',
  network: 'kasplex',

  // DEX Contracts — Kasplex Testnet
  vaultAddress: process.env.VAULT_ADDRESS || '0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9',
  routerAddress: process.env.DEX_ROUTER || '0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e',
  factoryAddress: process.env.DEX_FACTORY || '0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E',
  wkasAddress: '0xf40178040278E16c8813dB20a84119A605812FB3',

  // LP fee (KaspaCom charges 1% not 0.3%)
  lpFeeBps: 100, // 1% = 100 basis points

  // Top 5 pairs by WKAS reserves — where the volume is
  pairs: [
    {
      name: 'TKCOM/WKAS',
      tokenA: '0x0837618e0f914192d05f039d2e394241189ab718', // TKCOM
      tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3', // WKAS
      pair: '0xc0d4db7b461f760ce1d7823fa715949f0e6e0bf3',
    },
    {
      name: 'TLFG/WKAS',
      tokenA: '0x7a2ce0f68ba02762cad0371f5b304fd9edbdc4b9', // TLFG
      tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3', // WKAS
      pair: '0x7ab1a8b1346103bd3deea425e59e1d818a952d43',
    },
    {
      name: 'SPRKAS/WKAS',
      tokenA: '0xea0eca00f964af8f0526c99c0ee4051c59a1dd42', // SPRKAS
      tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3', // WKAS
      pair: '0x2e3cabef509e3e1b457ef15e9ede4e97c9c3b66e',
    },
    {
      name: 'LFG/WKAS',
      tokenA: '0xaa6947db5fb150a207b85bf7f8718ff0120f60f8', // LFG
      tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3', // WKAS
      pair: '0xf8e2470742e46fdf0dd4e3a4347020b00d7bca52',
    },
    {
      name: 'KCOM/WKAS',
      tokenA: '0xbae24fdbd95d7b68ddbe9085ab512deed12ab0e9', // KCOM
      tokenB: '0xf40178040278E16c8813dB20a84119A605812FB3', // WKAS
      pair: '0xe22039fb01649641a2893520b7a290413b1a629b',
    },
  ],

  // Agent behavior
  checkIntervalMs: 30_000,       // check every 30s
  maxSlippageBps: 100,           // 1% max slippage on trades
  rebalanceThreshold: 0.6,       // swap if >60% in one token

  // Risk limits (must match vault on-chain values)
  maxTradeSizeKas: 100,          // 100 KAS per trade
  dailyVolumeLimitKas: 5_000,    // 5,000 KAS per day
};
