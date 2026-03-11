import { getAddress, type PublicClient, type WalletClient } from 'viem';
import { CONFIG, type ChainConfig, type PairConfig } from '../../config';
import { ERC20_ABI } from '../../plugins/kaspacom-dex/abi/erc20';
import { PAIR_ABI } from '../../plugins/kaspacom-dex/abi/pair';
import { VAULT_ABI } from '../../plugins/kaspacom-dex/abi/vault';
import { ArbitrageEngine } from './arbitrage';
import { PositionStore } from './positions';
import { PairSnapshot, PairVolumeData, SmartLPManager } from './smart-lp';
import { SubgraphClient, QUERIES } from '../subgraph';

interface PairApiRecord {
  pairAddress?: string;
  pairName?: string;
  dailyVolume: number;
}

/** Subgraph pair data shape */
interface SubgraphPair {
  id: string;
  token0: { id: string; symbol: string; decimals: string };
  token1: { id: string; symbol: string; decimals: string };
  reserveKAS: string;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  volumeKAS: string;
}

interface SubgraphPairDayData {
  pairAddress: string;
  date: number;
  dailyVolumeKAS: string;
  dailyTxns: string;
  reserveKAS: string;
}

/** Minimum liquidity (in KAS) to consider a pair for trading. */
const MIN_PAIR_LIQUIDITY_KAS = 1000;

/** How often to re-discover pairs (every N cycles = N * 30s). */
const PAIR_DISCOVERY_INTERVAL = 50; // ~25 minutes

type VaultWriteRequest =
  | {
      functionName: 'addLiquidity';
      args: readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint];
    }
  | {
      functionName: 'removeLiquidity';
      args: readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint];
    }
  | {
      functionName: 'swap';
      args: readonly [bigint, bigint, readonly `0x${string}`[], bigint];
    };

type DexClient = Pick<WalletClient, 'writeContract'> &
  Pick<PublicClient, 'readContract' | 'waitForTransactionReceipt'> & {
    account: NonNullable<WalletClient['account']>;
    chain: NonNullable<WalletClient['chain']>;
  };

export class DexStrategyEngine {
  private readonly positionStore = new PositionStore();
  private readonly smartLp = new SmartLPManager(this.positionStore);
  private readonly arbitrage = new ArbitrageEngine();

  // Subgraph-based pair discovery
  private dexSubgraphClient?: SubgraphClient;
  private discoveredPairs: PairConfig[] = [];
  private cyclesSincePairRefresh = PAIR_DISCOVERY_INTERVAL; // trigger on first cycle
  private subgraphVolumeCache: Map<string, number> = new Map(); // pairAddress -> dailyVolKAS

  constructor(
    private readonly client: DexClient,
    private readonly chain: ChainConfig
  ) {
    // Initialize subgraph client if URL is available
    if (chain.graphNodeUrl) {
      this.dexSubgraphClient = new SubgraphClient(chain.graphNodeUrl);
      console.log(`   📊 [DEX] Subgraph client initialized: ${chain.graphNodeUrl}`);
    }
  }

  async cycle(): Promise<void> {
    if (!this.chain.vaultAddress) return;

    // Discover/refresh pairs from subgraph
    await this.maybeDiscoverPairs();

    // Use discovered pairs if available, fall back to config
    const activePairs = this.discoveredPairs.length > 0
      ? this.discoveredPairs
      : (this.chain.pairs ?? []);

    if (activePairs.length === 0) {
      console.log('   ⚠️  [DEX] No pairs available (config empty, subgraph unavailable or no liquidity)');
      return;
    }

    const pairSnapshots = await this.loadPairSnapshots(activePairs);
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

          // Use decimals from subgraph discovery if available, otherwise RPC fallback
          let token0Decimals: number;
          let token1Decimals: number;
          if (pairConfig.tokenADecimals != null && pairConfig.tokenBDecimals != null) {
            // Subgraph-discovered pairs already carry decimals
            token0Decimals = pairConfig.tokenADecimals;
            token1Decimals = pairConfig.tokenBDecimals;
          } else {
            // Config-defined pairs: fetch from chain (2 RPC calls)
            const [d0, d1] = await Promise.all([
              this.client.readContract({
                address: token0 as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'decimals',
              }),
              this.client.readContract({
                address: token1 as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'decimals',
              }),
            ]);
            token0Decimals = Number(d0);
            token1Decimals = Number(d1);
          }

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
            token0Decimals,
            token1Decimals,
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
    // Prefer subgraph volume data if available
    if (this.subgraphVolumeCache.size > 0) {
      const volumeMap = new Map<string, PairApiRecord>();
      for (const [addr, volume] of this.subgraphVolumeCache) {
        volumeMap.set(addr.toLowerCase(), { pairAddress: addr, dailyVolume: volume });
      }
      return volumeMap;
    }

    // Fallback: external API
    const url = `${CONFIG.apiBaseUrl}/dex/pairs?network=${CONFIG.network}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = (await response.json()) as unknown;
      const rawPairs: Record<string, unknown>[] = Array.isArray(body)
        ? body
        : this.hasArrayField(body, 'pairs')
          ? body.pairs
          : this.hasArrayField(body, 'data')
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

  private hasArrayField<T extends string>(
    value: unknown,
    key: T
  ): value is Record<T, Record<string, unknown>[]> {
    return (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as Record<string, unknown>)[key])
    );
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
    await this.writeVaultContract({
      functionName: 'addLiquidity',
      args: [
        pair.token0,
        pair.token1,
        amountA,
        amountB,
        this.applySlippage(amountA),
        this.applySlippage(amountB),
        this.deadline(),
      ],
    });
  }

  private async executeRemoveLiquidity(pairAddress: string, liquidity: bigint): Promise<void> {
    const pair = this.chain.pairs?.find(
      (candidate) => candidate.pair.toLowerCase() === pairAddress.toLowerCase()
    );
    if (!pair) {
      throw new Error(`Missing pair config for ${pairAddress}`);
    }

    await this.writeVaultContract({
      functionName: 'removeLiquidity',
      args: [
        getAddress(pair.tokenA) as `0x${string}`,
        getAddress(pair.tokenB) as `0x${string}`,
        liquidity,
        0n,
        0n,
        this.deadline(),
      ],
    });
  }

  private async executeSwap(
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint,
    expectedOut: bigint
  ): Promise<void> {
    await this.writeVaultContract({
      functionName: 'swap',
      args: [
        amountIn,
        this.applySlippage(expectedOut),
        [tokenIn, tokenOut],
        this.deadline(),
      ],
    });
  }

  private async writeVaultContract(request: VaultWriteRequest): Promise<void> {
    const baseRequest = {
      address: getAddress(this.chain.vaultAddress!) as `0x${string}`,
      abi: VAULT_ABI,
      chain: this.client.chain,
      account: this.client.account,
    } as const;

    const hash =
      request.functionName === 'addLiquidity'
        ? await this.client.writeContract({
            ...baseRequest,
            functionName: 'addLiquidity',
            args: request.args,
          })
        : request.functionName === 'removeLiquidity'
          ? await this.client.writeContract({
              ...baseRequest,
              functionName: 'removeLiquidity',
              args: request.args,
            })
          : await this.client.writeContract({
              ...baseRequest,
              functionName: 'swap',
              args: request.args,
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

  // ---------------------------------------------------------------------------
  // Subgraph-based pair discovery
  // ---------------------------------------------------------------------------

  /**
   * Discover pairs from the DEX subgraph if enough cycles have passed.
   */
  private async maybeDiscoverPairs(): Promise<void> {
    this.cyclesSincePairRefresh++;
    if (this.cyclesSincePairRefresh < PAIR_DISCOVERY_INTERVAL) return;

    if (!this.dexSubgraphClient) return;

    try {
      await this.discoverPairsFromSubgraph();
      await this.refreshSubgraphVolumes();
      this.cyclesSincePairRefresh = 0;
    } catch (error) {
      console.warn(
        `   ⚠️  [DEX] Subgraph pair discovery failed (using cached/config pairs):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Query the DEX subgraph for all pairs and filter by minimum liquidity.
   */
  private async discoverPairsFromSubgraph(): Promise<void> {
    if (!this.dexSubgraphClient) return;

    const allPairs = await this.dexSubgraphClient.paginate<SubgraphPair>(
      QUERIES.ALL_PAIRS,
      'pairs',
    );

    // Filter by minimum liquidity
    const liquidPairs = allPairs.filter(
      p => Number(p.reserveKAS) >= MIN_PAIR_LIQUIDITY_KAS,
    );

    // Convert to PairConfig format (carry decimals from subgraph)
    this.discoveredPairs = liquidPairs.map(p => ({
      name: `${p.token0.symbol}/${p.token1.symbol}`,
      tokenA: p.token0.id,
      tokenB: p.token1.id,
      pair: p.id,
      tokenADecimals: Number(p.token0.decimals),
      tokenBDecimals: Number(p.token1.decimals),
    }));

    console.log(
      `   📊 [DEX] Subgraph: discovered ${liquidPairs.length}/${allPairs.length} pairs ` +
        `(min ${MIN_PAIR_LIQUIDITY_KAS} KAS liquidity)`,
    );
  }

  /**
   * Fetch recent daily volume per pair from the subgraph.
   */
  private async refreshSubgraphVolumes(): Promise<void> {
    if (!this.dexSubgraphClient) return;

    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

    try {
      const dayDatas = await this.dexSubgraphClient.paginate<SubgraphPairDayData>(
        QUERIES.PAIR_DAY_DATA,
        'pairDayDatas',
        { minDate: oneDayAgo },
      );

      // Aggregate daily volume per pair
      this.subgraphVolumeCache.clear();
      for (const d of dayDatas) {
        const addr = d.pairAddress.toLowerCase();
        const existing = this.subgraphVolumeCache.get(addr) ?? 0;
        this.subgraphVolumeCache.set(addr, existing + Number(d.dailyVolumeKAS));
      }
    } catch (error) {
      console.warn(
        `   ⚠️  [DEX] Subgraph volume fetch failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
