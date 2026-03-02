import { formatUnits } from 'viem';
import { calcIL, calcLpValue } from './math';
import { LPPosition, PositionStore } from './positions';

export interface PairSnapshot {
  pairAddress: `0x${string}`;
  pairName: string;
  token0: `0x${string}`;
  token1: `0x${string}`;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  vaultLpBalance: bigint;
  vaultToken0Balance: bigint;
  vaultToken1Balance: bigint;
  price0in1: number;
  price1in0: number;
  timestamp: number;
}

export interface PairVolumeData {
  pairAddress: string;
  pairName?: string;
  dailyVolume: number;
  source: string;
}

export interface SmartLpDecision {
  type: 'add_liquidity' | 'enter_liquidity' | 'remove_liquidity' | 'hold' | 'none';
  pairAddress: string;
  pairName: string;
  reason: string;
  score: number;
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
  feeApr: number;
  impermanentLoss: number;
  feesEarned: number;
  position?: LPPosition;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROJECTED_IL_RATE = 0.05;

export class SmartLPManager {
  constructor(
    private readonly store: PositionStore,
    private readonly projectedIlFloor = DEFAULT_PROJECTED_IL_RATE
  ) {}

  async evaluate(pair: PairSnapshot, volume?: PairVolumeData): Promise<SmartLpDecision> {
    const now = Date.now();
    const position = await this.syncPosition(pair, volume, now);
    const pairVolume = volume?.dailyVolume ?? 0;

    if (!position) {
      if (pairVolume <= 0) {
        return this.noop(pair, 'No position and no observable volume');
      }

      const feeApr = this.estimateFeeApr(pair, pairVolume, 1);
      const projectedIlRate = this.projectedIlFloor;
      const deposit = this.calculateBalancedDeposit(pair, 0.15);

      if (deposit.amountA <= 0n || deposit.amountB <= 0n) {
        return this.noop(pair, 'No balanced inventory available for a new LP entry');
      }

      if (feeApr <= projectedIlRate) {
        return this.noop(
          pair,
          `Fee APR ${(feeApr * 100).toFixed(2)}% below projected IL ${(projectedIlRate * 100).toFixed(2)}%`
        );
      }

      return {
        type: 'enter_liquidity',
        pairAddress: pair.pairAddress,
        pairName: pair.pairName,
        reason: `Volume-backed LP entry, fee APR ${(feeApr * 100).toFixed(2)}%`,
        score: feeApr * Math.max(pairVolume, 1),
        amountA: deposit.amountA,
        amountB: deposit.amountB,
        liquidity: 0n,
        feeApr,
        impermanentLoss: 0,
        feesEarned: 0,
      };
    }

    const share = this.getShare(pair);
    const currentPrice = pair.price0in1;
    const priceRatio = position.entryPriceRatio > 0 ? currentPrice / position.entryPriceRatio : 1;
    const impermanentLoss = Math.abs(calcIL(priceRatio));
    const feesEarned = position.totalFeesEarned;
    const positionValue = this.getPositionValue(pair);
    const ilValue = positionValue * impermanentLoss;
    const daysHeld = Math.max((now - position.entryTimestamp) / DAY_MS, 1 / 24);
    const projectedIlRate = Math.max((impermanentLoss / daysHeld) * 365, this.projectedIlFloor);
    const feeApr = this.estimateFeeApr(pair, pairVolume, share);

    if (ilValue > feesEarned) {
      return {
        type: 'remove_liquidity',
        pairAddress: pair.pairAddress,
        pairName: pair.pairName,
        reason: `Net LP loss: IL ${ilValue.toFixed(4)} > fees ${feesEarned.toFixed(4)}`,
        score: ilValue - feesEarned,
        amountA: 0n,
        amountB: 0n,
        liquidity: pair.vaultLpBalance,
        feeApr,
        impermanentLoss,
        feesEarned,
        position,
      };
    }

    const deposit = this.calculateBalancedDeposit(pair, 0.2);
    if (pairVolume > 0 && feeApr > projectedIlRate && deposit.amountA > 0n && deposit.amountB > 0n) {
      return {
        type: 'add_liquidity',
        pairAddress: pair.pairAddress,
        pairName: pair.pairName,
        reason: `Position profitable: fees ${feesEarned.toFixed(4)} > IL ${ilValue.toFixed(4)}`,
        score: (feeApr - projectedIlRate) * Math.max(pairVolume, 1),
        amountA: deposit.amountA,
        amountB: deposit.amountB,
        liquidity: 0n,
        feeApr,
        impermanentLoss,
        feesEarned,
        position,
      };
    }

    return {
      type: 'hold',
      pairAddress: pair.pairAddress,
      pairName: pair.pairName,
      reason: `Holding LP: fees ${feesEarned.toFixed(4)}, IL ${ilValue.toFixed(4)}`,
      score: feesEarned - ilValue,
      amountA: 0n,
      amountB: 0n,
      liquidity: 0n,
      feeApr,
      impermanentLoss,
      feesEarned,
      position,
    };
  }

  async recordExit(pairAddress: string): Promise<void> {
    await this.store.remove(pairAddress);
  }

  private async syncPosition(
    pair: PairSnapshot,
    volume: PairVolumeData | undefined,
    now: number
  ): Promise<LPPosition | undefined> {
    const existing = await this.store.get(pair.pairAddress);

    if (pair.vaultLpBalance <= 0n) {
      if (existing) {
        await this.store.remove(pair.pairAddress);
      }
      return undefined;
    }

    const share = this.getShare(pair);
    const dailyFees = (volume?.dailyVolume ?? 0) * 0.01 * share;

    if (!existing) {
      const inferred: LPPosition = {
        pairAddress: pair.pairAddress,
        pairName: pair.pairName,
        lpTokens: pair.vaultLpBalance.toString(),
        entryPriceRatio: pair.price0in1,
        entryTimestamp: now,
        entryReserve0: pair.reserve0.toString(),
        entryReserve1: pair.reserve1.toString(),
        totalFeesEarned: 0,
        lastCheckedTimestamp: now,
      };
      await this.store.upsert(inferred);
      return inferred;
    }

    const elapsedDays = Math.max((now - existing.lastCheckedTimestamp) / DAY_MS, 0);
    const updated: LPPosition = {
      ...existing,
      pairName: pair.pairName,
      lpTokens: pair.vaultLpBalance.toString(),
      totalFeesEarned: existing.totalFeesEarned + dailyFees * elapsedDays,
      lastCheckedTimestamp: now,
    };
    await this.store.upsert(updated);
    return updated;
  }

  private calculateBalancedDeposit(
    pair: PairSnapshot,
    balanceFraction: number
  ): { amountA: bigint; amountB: bigint } {
    const scaledFraction = BigInt(Math.max(1, Math.floor(balanceFraction * 1000)));
    const target0 = (pair.vaultToken0Balance * scaledFraction) / 1000n;
    const target1 = (pair.vaultToken1Balance * scaledFraction) / 1000n;

    if (target0 <= 0n || target1 <= 0n || pair.reserve0 <= 0n || pair.reserve1 <= 0n) {
      return { amountA: 0n, amountB: 0n };
    }

    const optimal1 = (target0 * pair.reserve1) / pair.reserve0;
    if (optimal1 <= target1) {
      return { amountA: target0, amountB: optimal1 };
    }

    const optimal0 = (target1 * pair.reserve0) / pair.reserve1;
    return { amountA: optimal0, amountB: target1 };
  }

  private estimateFeeApr(pair: PairSnapshot, dailyVolume: number, share: number): number {
    if (dailyVolume <= 0 || share <= 0) return 0;

    const positionValue = this.getPositionValue(pair, share);
    if (positionValue <= 0) return 0;

    const feeIncome = dailyVolume * 0.01 * share;
    return (feeIncome * 365) / positionValue;
  }

  private getPositionValue(pair: PairSnapshot, share = this.getShare(pair)): number {
    if (share <= 0) return 0;

    const reserve0 = this.toDecimal(pair.reserve0);
    const reserve1 = this.toDecimal(pair.reserve1);
    const k = reserve0 * reserve1;

    return calcLpValue(k, pair.price0in1) * share;
  }

  private getShare(pair: PairSnapshot): number {
    if (pair.totalSupply <= 0n || pair.vaultLpBalance <= 0n) return 0;
    return Number(pair.vaultLpBalance) / Number(pair.totalSupply);
  }

  private toDecimal(value: bigint): number {
    return Number(formatUnits(value, 18));
  }

  private noop(pair: PairSnapshot, reason: string): SmartLpDecision {
    return {
      type: 'none',
      pairAddress: pair.pairAddress,
      pairName: pair.pairName,
      reason,
      score: 0,
      amountA: 0n,
      amountB: 0n,
      liquidity: 0n,
      feeApr: 0,
      impermanentLoss: 0,
      feesEarned: 0,
    };
  }
}
