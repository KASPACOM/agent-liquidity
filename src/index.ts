import { ethers } from 'ethers';
import { PriceMonitor } from './monitor';
import { Rebalancer, RebalanceAction } from './rebalancer';
import { CONFIG } from './config';

const VAULT_ABI = [
  'function addLiquidity(address,address,uint256,uint256,uint256,uint256,uint256) external returns (uint256,uint256,uint256)',
  'function removeLiquidity(address,address,uint256,uint256,uint256,uint256) external returns (uint256,uint256)',
  'function swap(uint256,uint256,address[],uint256) external returns (uint256[])',
  'function getTokenBalance(address) external view returns (uint256)',
  'function getRemainingDailyVolume() external view returns (uint256)',
];

class AgentLiquidityManager {
  private monitor: PriceMonitor;
  private rebalancer: Rebalancer;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private vault: ethers.Contract;
  
  constructor() {
    this.monitor = new PriceMonitor(CONFIG.rpcUrl, CONFIG.factoryAddress);
    this.rebalancer = new Rebalancer();
    this.provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    
    // Load private key from env at runtime (OPSEC: never log or persist)
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    this.wallet = new ethers.Wallet(key, this.provider);
    
    this.vault = new ethers.Contract(CONFIG.vaultAddress, VAULT_ABI, this.wallet);
  }
  
  async run() {
    console.log('🎯 Agent Liquidity Manager starting...');
    console.log(`   Chain: ${CONFIG.chainId} (IGRA Galleon)`);
    console.log(`   Vault: ${CONFIG.vaultAddress}`);
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
    
    // Check remaining daily volume
    const remaining = await this.vault.getRemainingDailyVolume();
    console.log(`   Daily volume remaining: ${ethers.formatEther(remaining)} iKAS`);
    
    for (const pair of CONFIG.pairs) {
      console.log(`\n   📊 Checking ${pair.name}...`);
      
      // Get pair state
      const state = await this.monitor.getPairState(pair.tokenA, pair.tokenB);
      if (!state) {
        console.log(`   ⚠️  Pair not found, skipping`);
        continue;
      }
      
      console.log(`   Price: ${state.price0in1.toFixed(6)}`);
      console.log(`   Reserves: ${ethers.formatEther(state.reserve0)} / ${ethers.formatEther(state.reserve1)}`);
      
      // Get vault balances for this pair's tokens
      const balance0 = await this.vault.getTokenBalance(state.token0);
      const balance1 = await this.vault.getTokenBalance(state.token1);
      console.log(`   Vault balances: ${ethers.formatEther(balance0)} / ${ethers.formatEther(balance1)}`);
      
      // Evaluate
      const action = this.rebalancer.evaluate(state, { token0: balance0, token1: balance1 });
      console.log(`   Action: ${action.type} — ${action.reason}`);
      
      // Execute
      if (action.type !== 'none') {
        await this.execute(action);
      }
    }
  }
  
  private async execute(action: RebalanceAction) {
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min deadline
    
    switch (action.type) {
      case 'add_liquidity': {
        console.log(`   🟢 Adding liquidity: ${ethers.formatEther(action.amountA)} / ${ethers.formatEther(action.amountB)}`);
        const tx = await this.vault.addLiquidity(
          action.tokenA, action.tokenB,
          action.amountA, action.amountB,
          0, 0, // Min amounts (TODO: calculate with slippage)
          deadline
        );
        const receipt = await tx.wait();
        console.log(`   ✅ TX: ${receipt.hash}`);
        break;
      }
      case 'swap': {
        console.log(`   🔄 Swapping ${ethers.formatEther(action.amountA)} ${action.tokenA.slice(0,10)}...`);
        const tx = await this.vault.swap(
          action.amountA,
          0, // Min out (TODO: calculate with slippage)
          [action.tokenA, action.tokenB],
          deadline
        );
        const receipt = await tx.wait();
        console.log(`   ✅ TX: ${receipt.hash}`);
        break;
      }
      case 'remove_liquidity': {
        console.log(`   🔴 Removing liquidity`);
        // TODO: Implement
        break;
      }
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run
const agent = new AgentLiquidityManager();
agent.run().catch(console.error);
