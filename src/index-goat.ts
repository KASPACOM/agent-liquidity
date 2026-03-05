import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'http';
import { CONFIG } from './config';
import { ViemEVMWalletClient } from '@goat-sdk/wallet-viem';
import { kaspaComDex } from './plugins/kaspacom-dex';

// DEX module
import { DexStrategyEngine } from './modules/dex';

// Liquidation module
import { StrategyManager } from './modules/liquidation';

// Define custom chain for active network
function getChainConfig(chainId: number, rpcUrl: string, name: string) {
  return {
    id: chainId,
    name,
    network: name.toLowerCase().replace(/\s+/g, '-'),
    nativeCurrency: {
      decimals: 18,
      name: 'iKAS',
      symbol: 'iKAS',
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: {
      default: { name: 'Explorer', url: '#' },
    },
  } as const;
}

class AgentLiquidityManager {
  // DEX
  private dexStrategy?: DexStrategyEngine;
  private dexPlugin?: any;
  private walletClient!: ViemEVMWalletClient;
  private viemClient!: any;

  // Liquidation
  private liquidationStrategy?: StrategyManager;

  // Health tracking
  private lastCycleAt: Date | null = null;
  private cycleCount = 0;
  private lastError: string | null = null;
  private startedAt = new Date();

  constructor() {
    if (CONFIG.liquidationEnabled) {
      this.liquidationStrategy = new StrategyManager();
    }
  }

  async initialize() {
    console.log('🎯 Initializing Agent Liquidity Manager...');

    // Initialize for active chain
    const activeChain = CONFIG.activeChain;

    // Load private key from env (OPSEC: never log or persist)
    const key = CONFIG.getDeployerKey(activeChain);
    const account = privateKeyToAccount(key as `0x${string}`);
    const chainConfig = getChainConfig(
      activeChain.chainId,
      activeChain.rpcUrl,
      activeChain.name
    );

    const viemClient = createWalletClient({
      account,
      chain: chainConfig,
      transport: http(activeChain.rpcUrl),
    }).extend(publicActions);

    this.viemClient = viemClient;
    this.walletClient = new ViemEVMWalletClient(viemClient);

    console.log(`\n✅ Initialized`);
    console.log(`   Chain: ${activeChain.name} (${activeChain.chainId})`);
    console.log(`   Wallet: ${this.walletClient.getAddress()}`);

    // Initialize DEX if enabled
    if (CONFIG.dexEnabled && activeChain.vaultAddress) {
      this.dexPlugin = kaspaComDex({
        chainId: activeChain.chainId,
        vaultAddress: activeChain.vaultAddress as `0x${string}`,
        routerAddress: activeChain.routerAddress! as `0x${string}`,
        factoryAddress: activeChain.factoryAddress! as `0x${string}`,
        wkasAddress: activeChain.wkasAddress! as `0x${string}`,
        chainName: activeChain.name,
      });

      console.log(`\n📊 DEX Module: Active`);
      console.log(`   Vault: ${activeChain.vaultAddress}`);
      console.log(`   Pairs: ${activeChain.pairs?.length || 0}`);

      this.dexStrategy = new DexStrategyEngine(viemClient, activeChain);
    }

    // Initialize liquidation if enabled
    if (CONFIG.liquidationEnabled && this.liquidationStrategy) {
      await this.liquidationStrategy.initialize(CONFIG.chains, key);
      this.liquidationStrategy.start();
      console.log(`\n💧 Liquidation Module: Active`);
      const aaveChains = CONFIG.chains.filter(c => c.enabled && c.aaveContracts);
      aaveChains.forEach(c => {
        console.log(`   [${c.name}] Pool: ${c.aaveContracts?.pool}`);
      });
    } else {
      console.log(`\n💧 Liquidation Module: Inactive (no Aave contracts on active chains)`);
    }

    console.log(`\n⏱️  Check interval: ${CONFIG.checkIntervalMs / 1000}s\n`);

    // Start health server
    this.startHealthServer();
  }

  private startHealthServer() {
    const port = parseInt(process.env.HEALTH_PORT || '3003', 10);
    const server = createServer((req, res) => {
      if (req.url === '/health' || req.url === '/healthz') {
        // Liveness: is the process alive?
        const staleMs = this.lastCycleAt
          ? Date.now() - this.lastCycleAt.getTime()
          : Date.now() - this.startedAt.getTime();
        // Unhealthy if no cycle in 5 minutes
        const healthy = staleMs < 300_000;

        res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: healthy ? 'ok' : 'stale',
          uptime: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
          lastCycle: this.lastCycleAt?.toISOString() || null,
          cycleCount: this.cycleCount,
          lastError: this.lastError,
          chain: CONFIG.activeChain.name,
          chainId: CONFIG.activeChain.chainId,
        }));
      } else if (req.url === '/ready') {
        // Readiness: has the first cycle run?
        const ready = this.cycleCount > 0;
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, () => {
      console.log(`🏥 Health server on :${port}/health`);
    });
  }

  async run() {
    await this.initialize();

    // Main loop
    while (true) {
      try {
        await this.cycle();
        this.lastCycleAt = new Date();
        this.cycleCount++;
        this.lastError = null;
      } catch (error) {
        console.error('❌ Cycle error:', error);
        this.lastError = error instanceof Error ? error.message : String(error);
      }
      await this.sleep(CONFIG.checkIntervalMs);
    }
  }

  private async cycle() {
    const timestamp = new Date().toISOString();
    console.log(`\n⏱️  [${timestamp}] Running cycle...`);

    // Run DEX cycle if enabled
    if (CONFIG.dexEnabled) {
      await this.dexCycle();
    }

    // Run liquidation cycle if enabled
    if (CONFIG.liquidationEnabled && this.liquidationStrategy) {
      await this.liquidationCycle();
    }
  }

  private async dexCycle() {
    if (!this.dexStrategy) return;
    await this.dexStrategy.cycle();
  }

  private async liquidationCycle() {
    console.log(`\n   💧 [LIQUIDATION] Scanning for opportunities...`);
    await this.liquidationStrategy!.cycle(CONFIG.chains);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Run
const agent = new AgentLiquidityManager();
agent.run().catch(console.error);
