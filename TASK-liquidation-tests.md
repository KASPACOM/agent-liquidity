# TASK: Liquidation Module Unit Tests

You are on branch `feature/liquidation-tests` in `/home/coder/projects/evm/agent-liquidity/`.
Vitest is already installed (`npm test` runs `vitest run`).

## Unit Tests to Write

### `src/modules/liquidation/__tests__/types.test.ts`
Validate type interfaces work correctly by constructing mock objects:
- Create a valid `ChainConfig` with aaveContracts
- Create a valid `ChainConfig` with aaveContracts = null (no Aave)
- Create a valid `LiquidationTarget` with collateral + debt assets
- Create a valid `LiquidationProfitCalculation` — profitable
- Create a valid `LiquidationProfitCalculation` — not profitable
- Create a valid `ExecutionResult` — success
- Create a valid `ExecutionResult` — failure

### `src/modules/liquidation/__tests__/strategy.test.ts`
Test the StrategyManager logic:
- `cycle()` does nothing when `isRunning` is false
- `cycle()` skips chains with `enabled: false`
- `cycle()` skips chains with `aaveContracts: null`
- `start()` sets isRunning to true
- `stop()` sets isRunning to false
- `addAddressesToMonitor()` stores addresses, deduplicates
- `getExecutionHistory()` returns empty array initially
- Cooldown: execution skipped if last execution was < 60s ago

Note: StrategyManager.cycle() and scanForOpportunities() call chain RPC. For unit tests, you need to test the logic that doesn't require chain calls (start/stop/cooldown/filtering). For chain-dependent logic, just verify the methods exist and have correct signatures.

### `src/modules/liquidation/__tests__/health-monitor.test.ts`
- Constructor throws if chain has no aaveContracts
- Constructor accepts valid chain config
- `getChain()` returns the config passed to constructor

### `src/modules/liquidation/__tests__/liquidator.test.ts`
Test profit calculation math (the core logic):
- Create mock data and test `calculateLiquidationProfit` math manually:
  - Close factor: health < 0.95 → 100% (10000), health >= 0.95 → 50% (5000)
  - Max debt to cover = debtAmount * closeFactor / 10000
  - Safety margin: debtToCover = maxDebtToCover * 95 / 100
  - Collateral received = (debtPrice * debtToCover * 10^collDecimals * bonus) / (collPrice * 10^debtDecimals)
  - Net profit = collateral USD - debt USD - gas cost
  - Profitable if net profit > minProfitUsd (default $50)

Since Liquidator methods all call chain RPC, test the math formulas in isolation:

```typescript
// Extract the math into a testable pure function or test inline
function calculateExpectedProfit(
  debtPrice: bigint,        // 8 decimals (Aave oracle)
  collateralPrice: bigint,  // 8 decimals
  debtAmount: bigint,
  debtDecimals: number,
  collateralDecimals: number,
  liquidationBonus: number, // e.g., 1.05
  healthFactor: bigint,     // 18 decimals
): { debtToCover: bigint; collateralToReceive: bigint; profitUsd: number } {
  const closeFactorHfThreshold = 950000000000000000n; // 0.95 * 1e18
  const closeFactorMultiplier = healthFactor < closeFactorHfThreshold ? 10000n : 5000n;
  const maxDebtToCover = (debtAmount * closeFactorMultiplier) / 10000n;
  const debtToCover = (maxDebtToCover * 95n) / 100n;
  
  const collateralToReceive = (debtPrice * debtToCover * BigInt(10 ** collateralDecimals) * BigInt(Math.floor(liquidationBonus * 10000))) / (collateralPrice * BigInt(10 ** debtDecimals) * 10000n);
  
  // Calculate USD values
  const debtUsd = Number(debtToCover) / (10 ** debtDecimals) * Number(debtPrice) / 1e8;
  const collUsd = Number(collateralToReceive) / (10 ** collateralDecimals) * Number(collateralPrice) / 1e8;
  
  return { debtToCover, collateralToReceive, profitUsd: collUsd - debtUsd };
}
```

Test cases:
- USDC debt ($1 price), WKAS collateral ($0.10), 5% bonus, HF=0.9 → profitable
- USDC debt ($1 price), WKAS collateral ($0.10), 5% bonus, HF=0.98 → 50% close factor
- Very small debt → profit < $50 → not profitable
- Equal price assets → bonus is the profit

## Technical Notes
- Use `import { describe, it, expect, beforeEach } from 'vitest'`
- Do NOT make any network calls — these are pure unit tests
- HealthFactorMonitor constructor creates a publicClient even without network — that's fine for unit tests
- The liquidator math test can be a standalone function test (don't need to instantiate Liquidator)
- Run `npx tsc --noEmit` after — must pass
- Run `npx vitest run` after — all tests must pass (both new AND existing DEX tests)
- Single commit, do NOT push
