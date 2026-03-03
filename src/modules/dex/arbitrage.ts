import { parseUnits } from 'viem';
import { getAmountOut } from './math';
import type { PairSnapshot } from './smart-lp';

export interface ArbitrageOpportunity {
  buyPairAddress: string;
  buyPairName: string;
  sellPairAddress: string;
  sellPairName: string;
  tokenIn: `0x${string}`;
  intermediateToken: `0x${string}`;
  amountIn: bigint;
  expectedIntermediate: bigint;
  expectedProfit: bigint;
  spreadPct: number;
  reason: string;
}

interface NormalizedPair {
  pair: PairSnapshot;
  assetToken: `0x${string}`;
  quoteToken: `0x${string}`;
  reserveAsset: bigint;
  reserveQuote: bigint;
  priceAssetInQuote: number;
  quoteBalance: bigint;
}

export class ArbitrageEngine {
  findBestOpportunity(pairs: PairSnapshot[]): ArbitrageOpportunity | null {
    const normalized = pairs.map((pair) => this.normalizePair(pair));
    let best: ArbitrageOpportunity | null = null;

    for (let i = 0; i < normalized.length; i += 1) {
      for (let j = i + 1; j < normalized.length; j += 1) {
        const first = normalized[i];
        const second = normalized[j];

        if (
          first.assetToken.toLowerCase() !== second.assetToken.toLowerCase() ||
          first.quoteToken.toLowerCase() !== second.quoteToken.toLowerCase()
        ) {
          continue;
        }

        const cheaper =
          first.priceAssetInQuote <= second.priceAssetInQuote ? first : second;
        const richer = cheaper === first ? second : first;
        const spreadPct =
          ((richer.priceAssetInQuote - cheaper.priceAssetInQuote) / cheaper.priceAssetInQuote) *
          100;

        if (!Number.isFinite(spreadPct) || spreadPct <= 2) {
          continue;
        }

        const amountIn = this.getOptimalInput(cheaper, richer);
        if (amountIn <= 0n) {
          continue;
        }

        const expectedIntermediate = getAmountOut(
          amountIn,
          cheaper.reserveQuote,
          cheaper.reserveAsset
        );
        const amountOut = getAmountOut(
          expectedIntermediate,
          richer.reserveAsset,
          richer.reserveQuote
        );
        const expectedProfit = amountOut - amountIn;

        if (expectedIntermediate <= 0n || expectedProfit <= 0n) {
          continue;
        }

        const candidate: ArbitrageOpportunity = {
          buyPairAddress: cheaper.pair.pairAddress,
          buyPairName: cheaper.pair.pairName,
          sellPairAddress: richer.pair.pairAddress,
          sellPairName: richer.pair.pairName,
          tokenIn: cheaper.quoteToken,
          intermediateToken: cheaper.assetToken,
          amountIn,
          expectedIntermediate,
          expectedProfit,
          spreadPct,
          reason: `Spread ${spreadPct.toFixed(2)}% exceeds 2% round-trip fees`,
        };

        if (!best || candidate.expectedProfit > best.expectedProfit) {
          best = candidate;
        }
      }
    }

    return best;
  }

  private normalizePair(pair: PairSnapshot): NormalizedPair {
    const token0 = pair.token0.toLowerCase();
    const token1 = pair.token1.toLowerCase();
    const token0IsAsset = token0 < token1;

    if (token0IsAsset) {
      return {
        pair,
        assetToken: pair.token0,
        quoteToken: pair.token1,
        reserveAsset: pair.reserve0,
        reserveQuote: pair.reserve1,
        priceAssetInQuote: pair.price0in1,
        quoteBalance: pair.vaultToken1Balance,
      };
    }

    return {
      pair,
      assetToken: pair.token1,
      quoteToken: pair.token0,
      reserveAsset: pair.reserve1,
      reserveQuote: pair.reserve0,
      priceAssetInQuote: pair.price1in0,
      quoteBalance: pair.vaultToken0Balance,
    };
  }

  private getOptimalInput(buyPair: NormalizedPair, sellPair: NormalizedPair): bigint {
    const maxBalance = buyPair.quoteBalance / 4n;
    if (
      buyPair.reserveQuote <= 0n ||
      buyPair.reserveAsset <= 0n ||
      sellPair.reserveQuote <= 0n ||
      sellPair.reserveAsset <= 0n ||
      maxBalance <= 0n
    ) {
      return 0n;
    }

    const reserveA1 = this.toDecimal(buyPair.reserveQuote);
    const reserveB1 = this.toDecimal(buyPair.reserveAsset);
    const reserveB2 = this.toDecimal(sellPair.reserveAsset);
    const reserveA2 = this.toDecimal(sellPair.reserveQuote);
    const feeMultiplier = 0.99;
    const numerator =
      feeMultiplier * Math.sqrt(reserveA1 * reserveA2 * reserveB1 * reserveB2) -
      reserveA1 * reserveB2;
    const denominator = feeMultiplier * (reserveB2 + feeMultiplier * reserveB1);

    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
      return 0n;
    }

    const optimal = numerator / denominator;
    if (optimal <= 0) return 0n;

    const capped = Math.min(optimal, this.toDecimal(maxBalance));
    if (capped <= 0) return 0n;

    return parseUnits(capped.toFixed(18), 18);
  }

  private toDecimal(value: bigint): number {
    return Number(value) / 1e18;
  }
}

