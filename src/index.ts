/**
 * Legacy entry point (non-GOAT SDK version)
 * For new deployments, use index-goat.ts instead
 */
import { ethers } from 'ethers';
import { PriceMonitor } from './modules/dex/monitor';
import { Rebalancer, RebalanceAction } from './modules/dex/rebalancer';
import { CONFIG } from './config';

const main = async () => {
  console.log('⚠️  Legacy entry point — consider migrating to index-goat.ts for GOAT SDK integration');

  const activeChain = CONFIG.activeChain;
  if (!activeChain.factoryAddress) {
    console.error('Active chain has no DEX factory configured');
    process.exit(1);
  }

  const monitor = new PriceMonitor(activeChain.rpcUrl, activeChain.factoryAddress);
  const rebalancer = new Rebalancer();
  const provider = new ethers.JsonRpcProvider(activeChain.rpcUrl);

  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error('DEPLOYER_PRIVATE_KEY not set');

  const wallet = new ethers.Wallet(key, provider);

  console.log(`🎯 Agent Liquidity Manager (Legacy)`);
  console.log(`   Chain: ${activeChain.chainId}`);
  console.log(`   Vault: ${activeChain.vaultAddress}`);
  console.log(`   Wallet: ${wallet.address}`);
  console.log(`   Pairs: ${activeChain.pairs?.length || 0}`);
  console.log(`   Check interval: ${CONFIG.checkIntervalMs / 1000}s\n`);

  while (true) {
    console.log(`\n⏱️  [${new Date().toISOString()}] Running cycle...`);

    for (const pair of activeChain.pairs || []) {
      console.log(`\n   📊 Checking ${pair.name}...`);

      const state = await monitor.getPairState(pair.tokenA, pair.tokenB);
      if (!state) {
        console.log(`   ⚠️  Pair not found, skipping`);
        continue;
      }

      console.log(`   Price: ${state.price0in1.toFixed(6)}`);

      // Get vault balances (simplified — no actual vault call here)
      const balance0 = 0n;
      const balance1 = 0n;

      const action = rebalancer.evaluate(state, { token0: balance0, token1: balance1 });
      console.log(`   Action: ${action.type} — ${action.reason}`);
    }

    await new Promise((resolve) => setTimeout(resolve, CONFIG.checkIntervalMs));
  }
};

main().catch(console.error);
