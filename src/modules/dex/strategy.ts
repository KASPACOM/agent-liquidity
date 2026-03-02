import { getAddress } from 'viem';
import { CONFIG, type ChainConfig, type PairConfig } from '../../config';
import { PAIR_ABI } from '../../plugins/kaspacom-dex/abi/pair';
import { VAULT_ABI } from '../../plugins/kaspacom-dex/abi/vault';
import { ArbitrageEngine } from './arbitrage';
import { PositionStore } from './positions';
import { PairSnapshot, PairVolumeData, SmartLPManager } from './smart-lp';

interface PairApiRecord {
  pairAddress?: string;
  pairName?: string;
  dailyVolume: number;
}

export class DexStrategyEngine {
  private readonly positionStore = new PositionStore();
  private readonly smartLp = new SmartLPManager(this.positionStore);
  private readonly arbitrage = new ArbitrageEngine();

  constructor(
    private readonly client: any,
    private readonly chain: ChainConfig
  ) {}

  async cycle(): Promise<void> {
    if (!this.chain.vaultAddress || !this.chain.pairs?.length) return;

    const pairSnapshots = await this.loadPairSnapshots(this.chain.pairs);
    if (pairSnapshots.length === 0) {
      console.log('   ⚠️  [DEX] No live pair snapshots available');
      return;
    }

    const volumeMap = await this.fetchPairVolumes();

    const arb = this.arbitrage.findBestOpportunity(pairSnapshots);
    if (arb) {
      console.log(
        `   ⚡ [DEX] Arb ${arb.buyPairName} -> ${arb.sellPairName}: ${arb.reason}`
      );
      await this.executeArbitrage(arb);
      return;
    }

    const decisions = await Promise.all(
      pairSnapshots.map((pair) =>
        this.smartLp.evaluate(pair, this.getVolumeForPair(pair, volumeMap))
      )
    );

    const exits = decisions
      .filter((decision) => decision.type === 'remove_liquidity')
      .sort((left, right) => right.score - left.score);
    if (exits[0]) {
      console.log(`   🔴 [DEX] Exit ${exits[0].pairName}: ${exits[0].reason}`);
      await this.executeRemoveLiquidity(exits[0].pairAddress, exits[0].liquidity);
      await this.smartLp.recordExit(exits[0].pairAddress);
      return;
    }

    const adds = decisions
      .filter(
        (decision) =>
          decision.type === 'add_liquidity' || decision.type === 'enter_liquidity'
      )
      .sort((left, right) => right.score - left.score);
    if (adds[0]) {
      console.log(`   🟢 [DEX] Add ${adds[0].pairName}: ${adds[0].reason}`);
      const pair = pairSnapshots.find(
        (snapshot) => snapshot.pairAddress.toLowerCase() === adds[0].pairAddress.toLowerCase()
      );
      if (!pair) {
        throw new Error(`Missing pair snapshot for ${adds[0].pairName}`);
      }
      await this.executeAddLiquidity(pair, adds[0].amountA, adds[0].amountB);
      return;
    }

    decisions
      .filter((decision) => decision.type === 'hold')
      .forEach((decision) =>
        console.log(`   📦 [DEX] Hold ${decision.pairName}: ${decision.reason}`)
      );

    if (!decisions.some((decision) => decision.type === 'hold')) {
      console.log('   📦 [DEX] No profitable LP or arb action this cycle');
    }
  }

  private async loadPairSnapshots(pairs: PairConfig[]): Promise<PairSnapshot[]> {
    const snapshots = await Promise.all(
      pairs.map(async (pairConfig) => {
        try {
          const pairAddress = getAddress(pairConfig.pair) as `0x${string}`;
          const [token0, token1, reserves, totalSupply, vaultLpBalance] = await Promise.all([
            this.client.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'token0',
            }),
            this.client.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'token1',
            }),
            this.client.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'getReserves',
            }),
            this.client.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'totalSupply',
            }),
            this.client.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'balanceOf',
              args: [getAddress(this.chain.vaultAddress!)],
            }),
          ]);

          const vaultAddress = getAddress(this.chain.vaultAddress!) as `0x${string}`;
          const [vaultToken0Balance, vaultToken1Balance] = await Promise.all([
            this.client.readContract({
              address: vaultAddress,
              abi: VAULT_ABI,
              functionName: 'getTokenBalance',
              args: [token0],
            }),
            this.client.readContract({
              address: vaultAddress,
              abi: VAULT_ABI,
              functionName: 'getTokenBalance',
              args: [token1],
            }),
          ]);

          const reserve0 = reserves[0] as bigint;
          const reserve1 = reserves[1] as bigint;
          const price0in1 = reserve0 > 0n ? Number(reserve1) / Number(reserve0) : 0;
          const price1in0 = reserve1 > 0n ? Number(reserve0) / Number(reserve1) : 0;

          return {
            pairAddress,
            pairName: pairConfig.name,
            token0,
            token1,
            reserve0,
            reserve1,
            totalSupply: totalSupply as bigint,
            vaultLpBalance: vaultLpBalance as bigint,
            vaultToken0Balance: vaultToken0Balance as bigint,
            vaultToken1Balance: vaultToken1Balance as bigint,
            price0in1,
            price1in0,
            timestamp: Date.now(),
          } satisfies PairSnapshot;
        } catch (error) {
          console.error(`   ⚠️  [DEX] Failed to load ${pairConfig.name}:`, error);
          return null;
        }
      })
    );

    return snapshots.filter((snapshot): snapshot is PairSnapshot => snapshot !== null);
  }

  private async fetchPairVolumes(): Promise<Map<string, PairApiRecord>> {
    const url = `${CONFIG.apiBaseUrl}/dex/pairs?network=${CONFIG.network}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = (await response.json()) as any;
      const rawPairs: any[] = Array.isArray(body)
        ? body
        : Array.isArray(body?.pairs)
          ? body.pairs
          : Array.isArray(body?.data)
            ? body.data
            : [];

      const records = rawPairs.map((item) => this.normalizeApiPair(item));
      const volumeMap = new Map<string, PairApiRecord>();

      for (const record of records) {
        if (record.pairAddress) {
          volumeMap.set(record.pairAddress.toLowerCase(), record);
        }
        if (record.pairName) {
          volumeMap.set(record.pairName.toLowerCase(), record);
        }
      }

      return volumeMap;
    } catch (error) {
      console.error(`   ⚠️  [DEX] Failed to fetch pair volumes from ${url}:`, error);
      return new Map();
    }
  }

  private getVolumeForPair(
    pair: PairSnapshot,
    volumeMap: Map<string, PairApiRecord>
  ): PairVolumeData | undefined {
    const byAddress = volumeMap.get(pair.pairAddress.toLowerCase());
    const byName = volumeMap.get(pair.pairName.toLowerCase());
    const record = byAddress ?? byName;
    if (!record) return undefined;

    return {
      pairAddress: pair.pairAddress,
      pairName: pair.pairName,
      dailyVolume: record.dailyVolume,
      source: 'dev-api-defi.kaspa.com',
    };
  }

  private normalizeApiPair(item: Record<string, unknown>): PairApiRecord {
    const pairAddress = this.pickString(item, [
      'pairAddress',
      'pair',
      'address',
      'pair_address',
      'id',
    ]);
    const pairName = this.pickString(item, ['pairName', 'name', 'symbol', 'pair_name']);
    const dailyVolume = this.pickNumber(item, [
      'dailyVolume',
      'dayVolume',
      'volume24h',
      'volume_24h',
      'volume',
      'usdVolume24h',
    ]);

    return {
      pairAddress,
      pairName,
      dailyVolume,
    };
  }

  private pickString(
    item: Record<string, unknown>,
    keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private pickNumber(item: Record<string, unknown>, keys: string[]): number {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return 0;
  }

  private async executeArbitrage(opportunity: {
    tokenIn: `0x${string}`;
    intermediateToken: `0x${string}`;
    amountIn: bigint;
    expectedIntermediate: bigint;
    expectedProfit: bigint;
  }): Promise<void> {
    const initialBalance = (await this.client.readContract({
      address: getAddress(this.chain.vaultAddress!) as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'getTokenBalance',
      args: [opportunity.intermediateToken],
    })) as bigint;

    await this.executeSwap(
      opportunity.tokenIn,
      opportunity.intermediateToken,
      opportunity.amountIn,
      opportunity.expectedIntermediate
    );

    const postBuyBalance = (await this.client.readContract({
      address: getAddress(this.chain.vaultAddress!) as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'getTokenBalance',
      args: [opportunity.intermediateToken],
    })) as bigint;
    const acquired = postBuyBalance - initialBalance;
    if (acquired <= 0n) {
      throw new Error('Arbitrage buy leg did not increase the intermediate balance');
    }

    await this.executeSwap(
      opportunity.intermediateToken,
      opportunity.tokenIn,
      acquired,
      acquired + opportunity.expectedProfit
    );
  }

  private async executeAddLiquidity(
    pair: PairSnapshot,
    amountA: bigint,
    amountB: bigint
  ): Promise<void> {
    await this.writeVaultContract('addLiquidity', [
      pair.token0,
      pair.token1,
      amountA,
      amountB,
      this.applySlippage(amountA),
      this.applySlippage(amountB),
      this.deadline(),
    ]);
  }

  private async executeRemoveLiquidity(pairAddress: string, liquidity: bigint): Promise<void> {
    const pair = this.chain.pairs?.find(
      (candidate) => candidate.pair.toLowerCase() === pairAddress.toLowerCase()
    );
    if (!pair) {
      throw new Error(`Missing pair config for ${pairAddress}`);
    }

    await this.writeVaultContract('removeLiquidity', [
      getAddress(pair.tokenA) as `0x${string}`,
      getAddress(pair.tokenB) as `0x${string}`,
      liquidity,
      0n,
      0n,
      this.deadline(),
    ]);
  }

  private async executeSwap(
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint,
    expectedOut: bigint
  ): Promise<void> {
    await this.writeVaultContract('swap', [
      amountIn,
      this.applySlippage(expectedOut),
      [tokenIn, tokenOut],
      this.deadline(),
    ]);
  }

  private async writeVaultContract(functionName: string, args: readonly unknown[]): Promise<void> {
    const hash = await this.client.writeContract({
      address: getAddress(this.chain.vaultAddress!) as `0x${string}`,
      abi: VAULT_ABI,
      functionName,
      args,
      chain: this.client.chain,
      account: this.client.account,
    });

    await this.client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });
  }

  private applySlippage(amount: bigint): bigint {
    return (amount * BigInt(10_000 - CONFIG.maxSlippageBps)) / 10_000n;
  }

  private deadline(): bigint {
    return BigInt(Math.floor(Date.now() / 1000) + 600);
  }
}

