# TASK: Tests + Architecture Cleanup

You are on branch `feature/smart-lp` in `/home/coder/projects/evm/agent-liquidity/`.

## Part 1: Add Vitest + Unit Tests

### Setup
1. Install vitest as dev dependency: `npm install -D vitest`
2. Add to package.json scripts: `"test": "vitest run", "test:watch": "vitest"`
3. Create `vitest.config.ts` at project root (ESM, resolve src/ paths)

### Tests to Write

#### `src/modules/dex/__tests__/math.test.ts`
Test all 4 functions:
- `getAmountOut`: verify swap output matches Uniswap V2 formula with 1% fee (feeBps=10)
  - Standard case: 1 ETH in, known reserves → expected output
  - Zero input → 0
  - Zero reserves → 0
  - Large numbers (realistic pool: 200K reserve0, 100K reserve1)
- `getAmountIn`: reverse of getAmountOut
  - Round-trip: getAmountIn(getAmountOut(x)) >= x (due to rounding)
- `calcIL`: 
  - priceRatio=1 → IL=0 (no price change)
  - priceRatio=2 → IL≈-0.0572 (5.72% loss)
  - priceRatio=4 → IL≈-0.1340 (13.4% loss)
  - priceRatio=0.5 → same as 2 (symmetric)
  - priceRatio=0 → 0 (guard)
  - negative → 0 (guard)
- `calcLpValue`:
  - k=50000, price=2000 → 2*sqrt(100000000) = 20000
  - k=0 → 0
  - negative → 0

#### `src/modules/dex/__tests__/positions.test.ts`
Test PositionStore with a temp file:
- `getAll` on empty store → []
- `upsert` then `get` → returns position
- `upsert` same address → updates (not duplicates)
- `remove` → position gone
- Case-insensitive address matching
- File persists across instances (create new PositionStore with same path)

#### `src/modules/dex/__tests__/smart-lp.test.ts`
Test SmartLPManager.evaluate() with mock data:
- No position + no volume → type='none'
- No position + high volume + good APR → type='enter_liquidity'
- Existing position + IL > fees → type='remove_liquidity'
- Existing position + fees > IL + high volume → type='add_liquidity'
- Existing position + fees > IL + low volume → type='hold'

Create mock PairSnapshot helper:
```typescript
function mockSnapshot(overrides?: Partial<PairSnapshot>): PairSnapshot {
  return {
    pairAddress: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
    pairName: 'TEST/WKAS',
    token0: '0xaaaa...' as `0x${string}`,
    token1: '0xbbbb...' as `0x${string}`,
    reserve0: 100000n * 10n**18n,
    reserve1: 200000n * 10n**18n,
    totalSupply: 1000000n * 10n**18n,
    vaultLpBalance: 100000n * 10n**18n,  // 10% share
    vaultToken0Balance: 5000n * 10n**18n,
    vaultToken1Balance: 10000n * 10n**18n,
    price0in1: 2.0,
    price1in0: 0.5,
    timestamp: Date.now(),
    ...overrides,
  };
}
```

#### `src/modules/dex/__tests__/arbitrage.test.ts`
Test ArbitrageEngine.findBestOpportunity():
- Two pools, same prices → no opportunity (null)
- Two pools, 3% spread → opportunity found
- Two pools, 1.5% spread → no opportunity (below 2% threshold)
- Verify correct buy/sell direction (buy from cheaper pool)
- Single pool → no opportunity

## Part 2: Architecture Cleanup

### 2a. Migrate monitor.ts from ethers to viem
- Replace `import { ethers } from 'ethers'` with viem imports
- Replace `ethers.JsonRpcProvider` with `createPublicClient` + `http` transport
- Replace `ethers.Contract` calls with `client.readContract()`
- Replace `ethers.ZeroAddress` with viem's `zeroAddress`
- Keep the same public interface (PairState, PriceMonitor class, same method signatures)
- Update `src/modules/dex/index.ts` exports if needed

### 2b. Deprecate rebalancer.ts
- Add `@deprecated` JSDoc comment at top of file
- Add console.warn in constructor: "Rebalancer is deprecated. Use DexStrategyEngine instead."
- Do NOT delete the file

### 2c. Fix `any` types in strategy.ts
- Replace `private readonly client: any` with proper viem type
- Import the correct type from viem:
```typescript
import { type WalletClient, type PublicClient } from 'viem';
// The client is a WalletClient extended with publicActions, so it has both interfaces
// Use intersection or just the methods we need
```
- Fix `private dexPlugin?: any` — give it a proper type or remove if unused
- Fix `private normalizeApiPair(item: Record<string, unknown>)` — already typed, just verify

### 2d. Clarify GOAT plugin vs strategy engine
- The GOAT plugin (`src/plugins/kaspacom-dex/`) is for EXTERNAL agent frameworks (LangChain, Vercel AI, MCP)
- The strategy engine (`src/modules/dex/strategy.ts`) is the INTERNAL execution path
- Add a comment block at top of `src/plugins/kaspacom-dex/index.ts` explaining this:
```typescript
/**
 * KaspaCom DEX Plugin for GOAT SDK
 * 
 * This plugin exposes DEX operations as GOAT SDK tools for use with
 * external agent frameworks (LangChain, Vercel AI, MCP, etc).
 * 
 * For the internal automated strategy engine, see src/modules/dex/strategy.ts
 * which calls the vault directly via viem for lower overhead.
 */
```

## Technical Notes
- vitest config: use `test.include: ['src/**/*.test.ts']`
- Tests should NOT make network calls — mock everything
- Use `import { describe, it, expect, beforeEach, afterEach } from 'vitest'`
- For positions.test.ts: use `os.tmpdir()` for temp file, clean up in afterEach
- Run `npx tsc --noEmit` after all changes to verify compilation
- Run `npx vitest run` to verify all tests pass
- Commit everything in a single commit

## Don't Do
- Don't modify liquidation module
- Don't add integration/fork tests yet (just unit tests)
- Don't change any business logic — only types, imports, and docs
- Don't remove rebalancer.ts
- Don't remove the GOAT plugin
