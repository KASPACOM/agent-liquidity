# Agent Liquidity Manager

AI-powered liquidity management agent for KaspaCom DEX. Autonomously monitors pools, rebalances inventory, and provides liquidity to optimize market depth and reduce slippage.

## Overview

This agent runs 24/7 and:
- **Monitors** DEX pair states (reserves, prices, liquidity depth)
- **Rebalances** vault inventory when token holdings become unbalanced
- **Adds liquidity** to pools when liquidity is thin or inventory is balanced
- **Swaps** tokens to maintain optimal inventory ratios

All operations execute through the **AgentVault** contract, which enforces:
- Daily volume limits (risk management)
- Approved token whitelist
- Emergency stop functionality
- Multi-sig governance

## Architecture

```
src/
  config.ts       - Network config, contract addresses, agent parameters
  monitor.ts      - PriceMonitor: reads on-chain pair state
  rebalancer.ts   - Rebalancer: evaluates state and decides actions
  index.ts        - Main loop: cycle → monitor → evaluate → execute
```

## Running

### Prerequisites
- Node.js 20+
- Private key for agent wallet with vault permissions
- `.env` file (see `.env.example`)

### Local Development
```bash
npm install
npm run dev     # Watch mode with auto-reload
```

### Production
```bash
npm start       # Run agent
```

### Docker
```bash
docker build -t agent-liquidity .
docker run --env-file .env agent-liquidity
```

## Configuration

See `src/config.ts` for:
- Network settings (RPC, chain ID)
- Contract addresses (vault, router, factory)
- Agent behavior (check interval, slippage, rebalance threshold)
- Risk limits (max trade size, daily volume cap)

## Security & OPSEC

⚠️ **NEVER commit `.env` or log private keys!**

The agent wallet private key is loaded from `process.env.DEPLOYER_PRIVATE_KEY` at runtime only. It is:
- Never logged, printed, or written to files
- Only referenced by variable name in code
- Protected by `.gitignore` (`.env` excluded from repo)

Best practices:
- Use a dedicated wallet for the agent (not your main deployer wallet)
- Fund only with necessary amounts for daily operations
- Monitor vault balances and transactions
- Keep `.env` with `chmod 600` permissions

## Deployment

Currently runs on:
- **Network:** IGRA Galleon Testnet (Chain ID 38836)
- **RPC:** `https://galleon-testnet.igralabs.com:8545`
- **Vault:** `0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9`

For production deployment, update `config.ts` with mainnet addresses.

## License

MIT
