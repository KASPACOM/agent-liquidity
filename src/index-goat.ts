import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PriceMonitor } from './monitor';
import { Rebalancer, RebalanceAction } from './rebalancer';
import { CONFIG } from './config';
import { ViemEVMWalletClient } from '@goat-sdk/wallet-viem';
import { kaspaComDex } from './plugins/kaspacom-dex';

// Define custom chain for IGRA Galleon Testnet
const galleonTestnet = {
  id: CONFIG.chainId,
  name: 'Kasplex Testnet',
  network: 'galleon-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'iKAS',
    symbol: 'iKAS',
  },
  rpcUrls: {
    default: { http: [CONFIG.rpcUrl] },
    public: { http: [CONFIG.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.testnet.kasplextest.xyz' },
  },
} as const;

class AgentLiquidityManager {
  private monitor: PriceMonitor;
  private rebalancer: Rebalancer;
  private dexPlugin: any;
  private walletClient!: ViemEVMWalletClient;
  
  constructor() {
    this.monitor = new PriceMonitor(CONFIG.rpcUrl, CONFIG.factoryAddress);
    this.rebalancer = new Rebalancer();
  }
  
  async initialize() {
    console.log('🎯 Initializing Agent Liquidity Manager with GOAT SDK...');
    
    // Load private key from env (OPSEC: never log or persist)
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    
    // Create viem wallet client
    const account = privateKeyToAccount(key as `0x${string}`);
    const viemClient = createWalletClient({
      account,
      chain: galleonTestnet,
      transport: http(CONFIG.rpcUrl),
    }).extend(publicActions);
    
    // Create GOAT EVM wallet client
    this.walletClient = new ViemEVMWalletClient(viemClient);
    
    // Initialize KaspaCom DEX plugin with vault config
    this.dexPlugin = kaspaComDex({
      chainId: CONFIG.chainId,
      vaultAddress: CONFIG.vaultAddress as `0x${string}`,
      routerAddress: CONFIG.routerAddress as `0x${string}`,
      factoryAddress: CONFIG.factoryAddress as `0x${string}`,
      wkasAddress: CONFIG.wkasAddress as `0x${string}`,
      chainName: 'Kasplex Testnet',
    });
    
    console.log('✅ GOAT SDK initialized with KaspaCom DEX plugin');
    console.log(`   Chain: ${CONFIG.chainId} (IGRA Galleon)`);
    console.log(`   Vault: ${CONFIG.vaultAddress}`);
    console.log(`   Wallet: ${this.walletClient.getAddress()}`);
  }
  
  async run() {
    await this.initialize();
    
    console.log(`   Check interval: ${CONFIG.checkIntervalMs / 1000}s`);
    console.log(`   Pairs: ${CONFIG.pairs.length}`);
    
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
    
    for (const pair of CONFIG.pairs) {
      console.log(`\n   📊 Checking ${pair.name}...`);
      
      // Get pair state using monitor (keep existing logic)
      const state = await this.monitor.getPairState(pair.tokenA, pair.tokenB);
      if (!state) {
        console.log(`   ⚠️  Pair not found, skipping`);
        continue;
      }
      
      console.log(`   Price: ${state.price0in1.toFixed(6)}`);
      console.log(`   Reserves: ${state.reserve0.toString()} / ${state.reserve1.toString()}`);
      
      // Get vault balances using GOAT wallet client
      try {
        const balance0 = await this.walletClient.read({
          address: CONFIG.vaultAddress as `0x${string}`,
          abi: [{
            inputs: [{ name: 'token', type: 'address' }],
            name: 'getTokenBalance',
            outputs: [{ name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function',
          }],
          functionName: 'getTokenBalance',
          args: [state.token0],
        }) as unknown as bigint;
        
        const balance1 = await this.walletClient.read({
          address: CONFIG.vaultAddress as `0x${string}`,
          abi: [{
            inputs: [{ name: 'token', type: 'address' }],
            name: 'getTokenBalance',
            outputs: [{ name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function',
          }],
          functionName: 'getTokenBalance',
          args: [state.token1],
        }) as unknown as bigint;
        
        console.log(`   Vault balances: ${balance0} / ${balance1}`);
        
        // Evaluate
        const action = this.rebalancer.evaluate(state, { 
          token0: balance0, 
          token1: balance1 
        });
        console.log(`   Action: ${action.type} — ${action.reason}`);
        
        // Execute using vault via GOAT wallet client
        if (action.type !== 'none') {
          await this.executeViaVault(action);
        }
      } catch (error) {
        console.error(`   ⚠️  Failed to process pair:`, error);
      }
    }
  }
  
  private async executeViaVault(action: RebalanceAction) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    
    try {
      switch (action.type) {
        case 'add_liquidity': {
          console.log(`   🟢 Adding liquidity via Vault: ${action.amountA} / ${action.amountB}`);
          const result = await this.walletClient.sendTransaction({
            to: CONFIG.vaultAddress as `0x${string}`,
            abi: [{
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
            }],
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
          console.log(`   🔄 Swapping via Vault: ${action.amountA} ${action.tokenA.slice(0,10)}...`);
          const result = await this.walletClient.sendTransaction({
            to: CONFIG.vaultAddress as `0x${string}`,
            abi: [{
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
            }],
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run
const agent = new AgentLiquidityManager();
agent.run().catch(console.error);
