/**
 * @deprecated Use DexStrategyEngine instead.
 */
import { ethers } from 'ethers';
import { PairState } from './monitor';

export interface RebalanceAction {
  type: 'add_liquidity' | 'remove_liquidity' | 'swap' | 'none';
  pair: string;
  tokenA: string;
  tokenB: string;
  amountA: bigint;
  amountB: bigint;
  reason: string;
}

export class Rebalancer {
  constructor() {
    console.warn('Rebalancer is deprecated. Use DexStrategyEngine instead.');
  }

  /**
   * Analyze a pair and decide what action to take
   */
  evaluate(state: PairState, vaultBalances: { token0: bigint; token1: bigint }): RebalanceAction {
    const { reserve0, reserve1 } = state;

    // Check if reserves are critically low (thin liquidity)
    const minReserve = BigInt(ethers.parseEther('1').toString()); // 1 token minimum
    if (reserve0 < minReserve || reserve1 < minReserve) {
      // Pool needs liquidity — add if we have tokens
      if (vaultBalances.token0 > 0n && vaultBalances.token1 > 0n) {
        const addAmount0 = vaultBalances.token0 / 4n; // Add 25% of holdings
        const addAmount1 = vaultBalances.token1 / 4n;
        return {
          type: 'add_liquidity',
          pair: state.pairAddress,
          tokenA: state.token0,
          tokenB: state.token1,
          amountA: addAmount0,
          amountB: addAmount1,
          reason: 'Pool liquidity critically low',
        };
      }
    }

    // Check inventory balance — are we too heavy on one side?
    if (vaultBalances.token0 > 0n || vaultBalances.token1 > 0n) {
      const total = Number(vaultBalances.token0) + Number(vaultBalances.token1) * state.price1in0;
      if (total > 0) {
        const ratio0 = Number(vaultBalances.token0) / total;

        // If more than 60% in one token, swap to rebalance
        if (ratio0 > 0.6) {
          const excessAmount = vaultBalances.token0 / 10n; // Swap 10% of excess
          return {
            type: 'swap',
            pair: state.pairAddress,
            tokenA: state.token0,
            tokenB: state.token1,
            amountA: excessAmount,
            amountB: 0n,
            reason: `Token0 overweight (${(ratio0 * 100).toFixed(1)}%), rebalancing`,
          };
        }
        if (ratio0 < 0.4) {
          const excessAmount = vaultBalances.token1 / 10n;
          return {
            type: 'swap',
            pair: state.pairAddress,
            tokenA: state.token1,
            tokenB: state.token0,
            amountA: excessAmount,
            amountB: 0n,
            reason: `Token1 overweight (${((1 - ratio0) * 100).toFixed(1)}%), rebalancing`,
          };
        }

        // If balanced, add liquidity to deepen the pool
        if (vaultBalances.token0 > minReserve && vaultBalances.token1 > minReserve) {
          return {
            type: 'add_liquidity',
            pair: state.pairAddress,
            tokenA: state.token0,
            tokenB: state.token1,
            amountA: vaultBalances.token0 / 10n, // Add 10% of holdings
            amountB: vaultBalances.token1 / 10n,
            reason: 'Balanced inventory — deepening pool liquidity',
          };
        }
      }
    }

    return {
      type: 'none',
      pair: state.pairAddress,
      tokenA: state.token0,
      tokenB: state.token1,
      amountA: 0n,
      amountB: 0n,
      reason: 'No action needed',
    };
  }
}
