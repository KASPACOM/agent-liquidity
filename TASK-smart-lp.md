# TASK: Smart LP + Cross-Pool Arbitrage

## Context
This is a Uniswap V2 market maker agent for KaspaCom DEX on IGRA/Kasplex chains.
The repo is at `/home/coder/projects/evm/agent-liquidity/` on branch `develop`.

Current state: basic ratio rebalancer in `src/modules/dex/rebalancer.ts` that just checks if inventory is >60% in one token and swaps. No IL tracking, no fee tracking, no cross-pool arb.

## What To Build

### 1. V2 Math Library — `src/modules/dex/math.ts`

Shared math used by all modules:

```typescript
// Constant product swap (KaspaCom 1% fee)
// feeBps = 10 (1%), so multiplier = 990/1000
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 10n): bigint {
  const amountInWithFee = amountIn * (1000n - feeBps);
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 10n): bigint {
  return (reserveIn * amountOut * 1000n) / ((reserveOut - amountOut) * (1000n - feeBps)) + 1n;
}

// IL formula
function calcIL(priceRatio: number): number {
  return 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;
}

// LP value given constant product
function calcLpValue(k: number, price: number): number {
  return 2 * Math.sqrt(k * price);
}
```

### 2. Position Store — `src/modules/dex/positions.ts`

Track LP positions persistently (save to `data/positions.json`):

```typescript
interface LPPosition {
  pairAddress: string;
  pairName: string;
  lpTokens: string;         // bigint as string for JSON
  entryPriceRatio: number;  // token0/token1 at entry
  entryTimestamp: number;
  entryReserve0: string;
  entryReserve1: string;
  totalFeesEarned: number;  // estimated from volume
  lastCheckedTimestamp: number;
}
```

### 3. Smart LP Module — `src/modules/dex/smart-lp.ts`

Replace the dumb rebalancer with an intelligent LP manager:

**Impermanent Loss Calculation (real-time):**
```
priceRatio = currentPrice / entryPrice
IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
// IL is always <= 0 (loss). e.g., 2x price move = -5.7% IL
```

**Fee Estimation:**
```
feeIncome = pairDailyVolume * 0.01 (1% KaspaCom fee)
feeAPR = (feeIncome * 365) / positionValue
```

Volume data from: `GET https://dev-api-defi.kaspa.com/dex/pairs?network=kasplex`

**Decision Logic:**
- Add LP: if fee APR > projected IL rate AND pair has volume
- Remove LP: if IL > accumulated fees (net loss)
- Hold: if position is profitable (fees > IL)
- Weight capital toward highest volume/fee pairs

### 4. Cross-Pool Arbitrage — `src/modules/dex/arbitrage.ts`

Same-chain ONLY. NOT cross-chain.

Compare implied prices of tokens across different pools on the same chain:
- If KCOM costs 0.5 WKAS in pool A but 0.6 WKAS in pool B → buy in A, sell in B
- Must overcome 2x fee (buy fee + sell fee = 2%)
- So only arb if spread > 2%

Optimal arb size (from degenbot quadratic formula):
```
// For 2-pool arb: buy tokenB in pool1, sell tokenB in pool2
// Pool1: reserveA1, reserveB1 (we send A, get B)
// Pool2: reserveB2, reserveA2 (we send B, get A)
// Profit = amountOut2 - amountIn1
// Optimize amountIn1 for max profit
```

No flash loans — use capital already in the vault/wallet.

### 5. Strategy Engine — `src/modules/dex/strategy.ts`

Orchestrates everything:

Priority order:
1. **Arb** (risk-free profit — always execute if found)
2. **Exit losing LPs** (protect capital — remove if IL > fees)
3. **Add to winning LPs** (compound — add more to profitable positions)
4. **Enter new LPs** (grow — add to high-volume pairs without positions)

### 6. Wire Into Main Loop

Update `index-goat.ts` to use strategy engine instead of basic rebalancer.

## Technical Notes

- **LP fee is 1%** (not 0.3%) — feeBps = 10 (i.e., 10/1000 = 1%)
- **Use viem** for all new code (not ethers.js)
- **API:** `GET https://dev-api-defi.kaspa.com/dex/pairs?network=kasplex`
- **Top 5 pairs** are in config.ts with addresses
- **Vault address** per chain in config — LP operations go through vault
- Keep `rebalancer.ts` for reference but don't use it in the main loop
- No new npm dependencies — use viem (already installed)

## Pair ABI (for reading reserves)
```
function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
function token0() external view returns (address)
function token1() external view returns (address)
function balanceOf(address) external view returns (uint256)
function totalSupply() external view returns (uint256)
```

## Files to Create
1. `src/modules/dex/math.ts`
2. `src/modules/dex/positions.ts`
3. `src/modules/dex/smart-lp.ts`
4. `src/modules/dex/arbitrage.ts`
5. `src/modules/dex/strategy.ts`
6. Update `src/modules/dex/index.ts` — export new modules
7. Update `src/index-goat.ts` — wire strategy engine

## Don't Do
- No new npm dependencies
- Don't modify liquidation module
- Don't remove existing files
- No flash loans
- No cross-chain arb
- Don't modify config.ts structure unless absolutely needed
