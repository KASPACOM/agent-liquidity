import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG } from './config';
import { ViemEVMWalletClient } from '@goat-sdk/wallet-viem';
import { kaspaComDex } from './plugins/kaspacom-dex';

// DEX module
import { PriceMonitor, Rebalancer, RebalanceAction } from './modules/dex';

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
  private dexMonitor?: PriceMonitor;
  private rebalancer?: Rebalancer;
  private dexPlugin?: any;
  private walletClient!: ViemEVMWalletClient;

  // Liquidation
  private liquidationStrategy?: StrategyManager;

  constructor() {
    // Initialize modules based on config
    if (CONFIG.dexEnabled) {
      const activeChain = CONFIG.activeChain;
      this.dexMonitor = new PriceMonitor(activeChain.rpcUrl, activeChain.factoryAddress!);
      this.rebalancer = new Rebalancer();
    }

    if (CONFIG.liquidationEnabled) {
      this.liquidationStrategy = new StrategyManager();
    }
  }

  async initialize() {
    console.log('🎯 Initializing Agent Liquidity Manager...');

    // Load private key from env (OPSEC: never log or persist)
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error('DEPLOYER_PRIVATE_KEY not set');

    const account = privateKeyToAccount(key as `0x${string}`);

    // Initialize for active chain
    const activeChain = CONFIG.activeChain;
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
  }

  async run() {
    await this.initialize();

    // Main loop
    while (true) {
      try {
        await this.cycle();
      } catch (error) {
        console.error('❌ Cycle error:', error);
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
    const activeChain = CONFIG.activeChain;
    if (!activeChain.pairs || activeChain.pairs.length === 0) return;

    for (const pair of activeChain.pairs) {
      console.log(`\n   📊 [DEX] Checking ${pair.name}...`);

      // Get pair state using monitor
      const state = await this.dexMonitor!.getPairState(pair.tokenA, pair.tokenB);
      if (!state) {
        console.log(`   ⚠️  Pair not found, skipping`);
        continue;
      }

      console.log(`   Price: ${state.price0in1.toFixed(6)}`);
      console.log(`   Reserves: ${state.reserve0.toString()} / ${state.reserve1.toString()}`);

      // Get vault balances
      try {
        const balance0 = (await this.walletClient.read({
          address: activeChain.vaultAddress! as `0x${string}`,
          abi: [
            {
              inputs: [{ name: 'token', type: 'address' }],
              name: 'getTokenBalance',
              outputs: [{ name: '', type: 'uint256' }],
              stateMutability: 'view',
              type: 'function',
            },
          ],
          functionName: 'getTokenBalance',
          args: [state.token0],
        })) as unknown as bigint;

        const balance1 = (await this.walletClient.read({
          address: activeChain.vaultAddress! as `0x${string}`,
          abi: [
            {
              inputs: [{ name: 'token', type: 'address' }],
              name: 'getTokenBalance',
              outputs: [{ name: '', type: 'uint256' }],
              stateMutability: 'view',
              type: 'function',
            },
          ],
          functionName: 'getTokenBalance',
          args: [state.token1],
        })) as unknown as bigint;

        console.log(`   Vault balances: ${balance0} / ${balance1}`);

        // Evaluate
        const action = this.rebalancer!.evaluate(state, {
          token0: balance0,
          token1: balance1,
        });
        console.log(`   Action: ${action.type} — ${action.reason}`);

        // Execute using vault
        if (action.type !== 'none') {
          await this.executeViaVault(action);
        }
      } catch (error) {
        console.error(`   ⚠️  Failed to process pair:`, error);
      }
    }
  }

  private async liquidationCycle() {
    console.log(`\n   💧 [LIQUIDATION] Scanning for opportunities...`);
    await this.liquidationStrategy!.cycle(CONFIG.chains);
  }

  private async executeViaVault(action: RebalanceAction) {
    const activeChain = CONFIG.activeChain;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    try {
      switch (action.type) {
        case 'add_liquidity': {
          console.log(
            `   🟢 Adding liquidity via Vault: ${action.amountA} / ${action.amountB}`
          );
          const result = await this.walletClient.sendTransaction({
            to: activeChain.vaultAddress! as `0x${string}`,
            abi: [
              {
                inputs: [
                  { name: 'tokenA', type: 'address' },
                  { name: 'tokenB', type: 'address' },
                  { name: 'amountADesired', type: 'uint256' },
                  { name: 'amountBDesired', type: 'uint256' },
                  { name: 'amountAMin', type: 'uint256' },
                  { name: 'amountBMin', type: 'uint256' },
                  { name: 'deadline', type: 'uint256' },
                ],
                name: 'addLiquidity',
                outputs: [
                  { name: 'amountA', type: 'uint256' },
                  { name: 'amountB', type: 'uint256' },
                  { name: 'liquidity', type: 'uint256' },
                ],
                stateMutability: 'nonpayable',
                type: 'function',
              },
            ],
            functionName: 'addLiquidity',
            args: [
              action.tokenA as `0x${string}`,
              action.tokenB as `0x${string}`,
              action.amountA,
              action.amountB,
              BigInt(0), // TODO: calculate slippage
              BigInt(0),
              deadline,
            ],
          });
          console.log(`   ✅ TX: ${result.hash}`);
          break;
        }
        case 'swap': {
          console.log(
            `   🔄 Swapping via Vault: ${action.amountA} ${action.tokenA.slice(0, 10)}...`
          );
          const result = await this.walletClient.sendTransaction({
            to: activeChain.vaultAddress! as `0x${string}`,
            abi: [
              {
                inputs: [
                  { name: 'amountIn', type: 'uint256' },
                  { name: 'amountOutMin', type: 'uint256' },
                  { name: 'path', type: 'address[]' },
                  { name: 'deadline', type: 'uint256' },
                ],
                name: 'swap',
                outputs: [{ name: 'amounts', type: 'uint256[]' }],
                stateMutability: 'nonpayable',
                type: 'function',
              },
            ],
            functionName: 'swap',
            args: [
              action.amountA,
              BigInt(0), // TODO: calculate slippage
              [action.tokenA as `0x${string}`, action.tokenB as `0x${string}`],
              deadline,
            ],
          });
          console.log(`   ✅ TX: ${result.hash}`);
          break;
        }
        case 'remove_liquidity': {
          console.log(`   🔴 Remove liquidity via Vault: (pending implementation)`);
          break;
        }
      }
    } catch (error) {
      console.error(`   ❌ Execution failed:`, error);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Run
const agent = new AgentLiquidityManager();
agent.run().catch(console.error);
