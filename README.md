# Agent Liquidity Manager

AI Agent Liquidity Manager for KaspaCom DEX on IGRA (EVM L2 for Kaspa).

## Overview

This service monitors token pairs on the KaspaCom DEX (Uniswap V2 fork) and autonomously executes liquidity management operations via the AgentVault contract.

**Key Features:**
- 🎯 **GOAT SDK Integration** — Plugin-based DEX interaction with type-safe tools
- 📊 **Pair Monitoring** — Real-time tracking of reserves, prices, and vault balances
- 🔄 **Auto-Rebalancing** — Evaluates market conditions and executes swaps/liquidity adds
- 🔐 **Vault-Managed** — All operations routed through AgentVault for safety and volume limits

## Architecture

```
┌─────────────────────────────────────────┐
│   Agent Liquidity Manager (this repo)  │
│  ┌────────────────────────────────────┐ │
│  │  PriceMonitor (DEX state reader)  │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │  Rebalancer (decision logic)      │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │  GOAT SDK + KaspaCom DEX Plugin   │ │
│  │  ┌──────────────────────────────┐ │ │
│  │  │  swap                        │ │ │
│  │  │  addLiquidity                │ │ │
│  │  │  removeLiquidity             │ │ │
│  │  │  getQuote                    │ │ │
│  │  │  getPairReserves             │ │ │
│  │  │  getTokenBalance             │ │ │
│  │  └──────────────────────────────┘ │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│      AgentVault (on-chain contract)     │
│  ┌────────────────────────────────────┐ │
│  │  swap()                            │ │
│  │  addLiquidity()                    │ │
│  │  removeLiquidity()                 │ │
│  │  (with daily volume limits)        │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│    KaspaCom DEX (Uniswap V2 fork)       │
│  ┌────────────────────────────────────┐ │
│  │  Router                            │ │
│  │  Factory                           │ │
│  │  Pairs                             │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## GOAT SDK Plugin

The `src/plugins/kaspacom-dex/` plugin provides a clean interface to the DEX:

**Files:**
- `kaspacom-dex.plugin.ts` — Plugin class, chain support
- `kaspacom-dex.service.ts` — Tools decorated with `@Tool` for AI agent interaction
- `parameters.ts` — Zod schemas for all tool parameters
- `types.ts` — TypeScript types
- `abi/` — Contract ABIs (Router, Factory, Pair, ERC20, Vault)

**Tools:**
- `swap` — Swap tokens via Router or Vault
- `addLiquidity` — Add liquidity to a pair
- `removeLiquidity` — Remove liquidity from a pair
- `getQuote` — Get swap quote without executing
- `getPairReserves` — Read current reserves
- `getTokenBalance` — Check ERC20 balance
- `getPairs` — List all pairs from Factory

**Usage:**
```typescript
import { kaspaComDex } from './plugins/kaspacom-dex';
import { ViemEVMWalletClient } from '@goat-sdk/wallet-viem';

const wallet = new ViemEVMWalletClient(viemClient);
const dexPlugin = kaspaComDex({
  chainId: 38836,
  vaultAddress: '0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9',
});
```

## Installation

```bash
npm install
```

**Dependencies:**
- `@goat-sdk/core` — GOAT SDK core
- `@goat-sdk/wallet-evm` — EVM wallet interface
- `@goat-sdk/wallet-viem` — Viem wallet adapter
- `viem@2.23.4` — Ethereum library (pinned for GOAT compatibility)
- `ethers` — Alternate Ethereum library (used by legacy code)

## Configuration

Set in `src/config.ts` or via environment variables:

```bash
# Network
IGRA_RPC_URL=https://galleon-testnet.igralabs.com:8545

# Contracts
VAULT_ADDRESS=0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9
DEX_ROUTER=0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e
DEX_FACTORY=0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E

# Private key (OPSEC: never commit)
DEPLOYER_PRIVATE_KEY=0x...
```

**Supported Chains (in plugin):**
- Kasplex Testnet (167012)
- IGRA Galleon Testnet (38836)
- _(Kasplex Mainnet, Galleon Mainnet — add when deployed)_

## Running

```bash
# Start with GOAT plugin (default)
npm start

# Start legacy mode (raw ethers.js)
npm run start:legacy

# Development mode (watch)
npm run dev
```

## Contract Addresses

**IGRA Galleon Testnet (Chain ID: 38836):**
- Router: `0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e`
- Factory: `0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E`
- WKAS: `0xf40178040278E16c8813dB20a84119A605812FB3`
- AgentVault: `0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9`

**Kasplex Testnet (Chain ID: 167012):**
- Router: `0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e`
- Factory: `0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E`
- WKAS: `0xf40178040278E16c8813dB20a84119A605812FB3`
- AgentVault: `0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9`

## Development

**Build:**
```bash
npm run build
```

**Type Check:**
```bash
npx tsc --noEmit
```

## Security

- **Private keys** are loaded from `DEPLOYER_PRIVATE_KEY` at runtime only (never logged or persisted)
- **All operations** go through AgentVault which enforces daily volume limits
- **Vault owner** controls the agent wallet address

## License

MIT
