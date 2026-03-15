/**
 * Strategy Manager for Aave V3 Liquidations
 * Ported from ethers v5 to viem
 * Orchestrates monitoring, assessment, and execution
 */
import { formatUnits } from 'viem';
import { HealthFactorMonitor } from './health-monitor';
import { Liquidator } from './liquidator';
import {
  ChainConfig,
  LiquidationTarget,
  ExecutionResult,
} from './types';
import { SubgraphClient, QUERIES } from '../subgraph';

/** How often to refresh borrower addresses (every N cycles = N * 30s). */
const BORROWER_REFRESH_INTERVAL = 10; // ~5 minutes

interface SubgraphBorrower {
  id: string;
  borrowedReservesCount: number;
}

export class StrategyManager {
  private isRunning = false;
  private chainMonitors: Map<number, HealthFactorMonitor> = new Map();
  private liquidator: Liquidator;
  private knownAddresses: Map<number, string[]> = new Map();
  private lastExecutionTime: Map<number, number> = new Map();
  private executionHistory: ExecutionResult[] = [];
  private executionCooldown = 60000; // 1 minute in ms

  // Subgraph clients per chain (for borrower discovery)
  private aaveSubgraphClients: Map<number, SubgraphClient> = new Map();
  private cyclesSinceRefresh: Map<number, number> = new Map();

  constructor() {
    this.liquidator = new Liquidator();
  }

  /**
   * Initialize the strategy manager for all enabled chains
   */
  public async initialize(chains: ChainConfig[], privateKey: string): Promise<void> {
    const enabledChains = chains.filter(c => c.enabled && c.aaveContracts !== null);

    if (enabledChains.length === 0) {
      console.log('No enabled chains with Aave contracts — liquidation module inactive');
      return;
    }

    console.log(`Initializing strategy manager for ${enabledChains.length} chain(s)...`);

    for (const chain of enabledChains) {
      // Initialize liquidator for this chain
      this.liquidator.initChain(chain, privateKey);

      // Initialize health factor monitor for this chain
      const monitor = new HealthFactorMonitor(chain);
      await monitor.initialize();
      this.chainMonitors.set(chain.chainId, monitor);

      // Initialize known addresses
      this.knownAddresses.set(chain.chainId, []);
      this.lastExecutionTime.set(chain.chainId, 0);
      this.cyclesSinceRefresh.set(chain.chainId, BORROWER_REFRESH_INTERVAL); // trigger on first cycle

      // Initialize subgraph client for borrower discovery
      if (chain.aaveSubgraphUrl) {
        const client = new SubgraphClient(chain.aaveSubgraphUrl);
        this.aaveSubgraphClients.set(chain.chainId, client);
        console.log(`[${chain.name}] Aave subgraph client initialized: ${chain.aaveSubgraphUrl}`);

        // Discover borrowers on startup
        await this.discoverBorrowers(chain);
      } else {
        console.warn(`[${chain.name}] No AAVE_SUBGRAPH_URL — borrower discovery disabled. Use addAddressesToMonitor() manually.`);
      }

      console.log(`Strategy manager initialized for chain: ${chain.name} (${chain.chainId})`);
    }

    console.log('Strategy manager initialization complete');
  }

  /**
   * Single cycle of monitoring and execution
   */
  public async cycle(chains: ChainConfig[]): Promise<void> {
    if (!this.isRunning) return;

    const enabledChains = chains.filter(c => c.enabled && c.aaveContracts !== null);

    for (const chain of enabledChains) {
      try {
        // Periodically refresh borrower addresses from subgraph
        await this.maybeRefreshBorrowers(chain);

        // Scan for liquidation opportunities
        await this.scanForOpportunities(chain);

        // Execute liquidations if profitable
        await this.executeStrategy(chain);
      } catch (error) {
        console.error(`[${chain.name}] Error processing chain:`, error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Subgraph-based borrower discovery
  // ---------------------------------------------------------------------------

  /**
   * Discover all active borrowers from the Aave V3 subgraph.
   * Paginates through all results and populates knownAddresses.
   */
  private async discoverBorrowers(chain: ChainConfig): Promise<void> {
    const client = this.aaveSubgraphClients.get(chain.chainId);
    if (!client) return;

    try {
      const borrowers = await client.paginate<SubgraphBorrower>(
        QUERIES.ACTIVE_BORROWERS,
        'users',
      );

      const addresses = borrowers.map(b => b.id);

      if (addresses.length > 0) {
        this.addAddressesToMonitor(chain.chainId, addresses);
        console.log(`[${chain.name}] Subgraph: discovered ${addresses.length} active borrowers`);
      } else {
        console.log(`[${chain.name}] Subgraph: no active borrowers found`);
      }

      this.cyclesSinceRefresh.set(chain.chainId, 0);
    } catch (error) {
      console.warn(
        `[${chain.name}] Subgraph borrower discovery failed (will retry next interval):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Refresh borrower addresses if enough cycles have passed.
   */
  private async maybeRefreshBorrowers(chain: ChainConfig): Promise<void> {
    const count = (this.cyclesSinceRefresh.get(chain.chainId) ?? 0) + 1;
    this.cyclesSinceRefresh.set(chain.chainId, count);

    if (count >= BORROWER_REFRESH_INTERVAL) {
      await this.discoverBorrowers(chain);
    }
  }

  /**
   * Scan for liquidation opportunities on a specific chain
   */
  private async scanForOpportunities(chain: ChainConfig): Promise<void> {
    try {
      const monitor = this.chainMonitors.get(chain.chainId);
      if (!monitor) {
        return;
      }

      const addresses = this.knownAddresses.get(chain.chainId) || [];

      if (addresses.length > 0) {
        // Scan known addresses for low health factors
        const targets = await monitor.scanForLowHealthFactors(addresses);

        if (targets.length > 0) {
          console.log(`[${chain.name}] Found ${targets.length} potential liquidation targets`);
        }
      }

      // Get liquidatable positions
      const liquidatablePositions = await monitor.getLiquidatablePositions();

      if (liquidatablePositions.length > 0) {
        console.log(`[${chain.name}] Found ${liquidatablePositions.length} liquidatable positions`);

        // For each liquidatable position, calculate profit
        for (const position of liquidatablePositions) {
          await this.assessPosition(chain, position);
        }
      }
    } catch (error) {
      console.error(`[${chain.name}] Error scanning for opportunities:`, error);
      throw error;
    }
  }

  /**
   * Assess a position for liquidation profitability
   */
  private async assessPosition(chain: ChainConfig, target: LiquidationTarget): Promise<void> {
    try {
      // Iterate through all debt assets and check profitability with each collateral asset
      for (const debtAsset of target.debtAssets) {
        // Check if we have balance for this debt asset
        const balance = await this.liquidator.checkVaultBalance(chain, debtAsset.address);

        if (balance === 0n) {
          continue;
        }

        // For each collateral asset
        for (const collateralAsset of target.collateralAssets) {
          // Calculate profit for liquidating this debt with this collateral
          const profitCalculation = await this.liquidator.calculateLiquidationProfit(
            chain,
            target,
            debtAsset,
            collateralAsset
          );

          // Log the result
          if (profitCalculation.profitable) {
            console.log(
              `[${chain.name}] Found profitable liquidation opportunity:\n` +
                `  User: ${target.user}\n` +
                `  Health Factor: ${Number(target.healthFactor) / 1e18}\n` +
                `  Debt Asset: ${debtAsset.symbol}\n` +
                `  Collateral Asset: ${collateralAsset.symbol}\n` +
                `  Estimated Profit: $${profitCalculation.netProfitUsd.toFixed(2)}`
            );
          }
        }
      }
    } catch (error) {
      console.error(`[${chain.name}] Error assessing position for ${target.user}:`, error);
    }
  }

  /**
   * Execute the most profitable strategy on a specific chain
   */
  private async executeStrategy(chain: ChainConfig): Promise<void> {
    try {
      // Check cooldown period
      const now = Date.now();
      const lastExecution = this.lastExecutionTime.get(chain.chainId) || 0;

      if (now - lastExecution < this.executionCooldown) {
        return;
      }

      const monitor = this.chainMonitors.get(chain.chainId);
      if (!monitor) {
        return;
      }

      // Get liquidatable positions
      const liquidatablePositions = await monitor.getLiquidatablePositions();

      if (liquidatablePositions.length === 0) {
        return;
      }

      // Collect ALL profitable opportunities, sorted by priority (highest first)
      const opportunities: any[] = [];

      for (const position of liquidatablePositions) {
        for (const debtAsset of position.debtAssets) {
          // Check if we have balance for this debt asset
          const balance = await this.liquidator.checkVaultBalance(chain, debtAsset.address);

          if (balance === 0n) {
            continue;
          }

          for (const collateralAsset of position.collateralAssets) {
            const profitCalculation = await this.liquidator.calculateLiquidationProfit(
              chain,
              position,
              debtAsset,
              collateralAsset
            );

            if (profitCalculation.profitable) {
              opportunities.push(profitCalculation);
            }
          }
        }
      }

      if (opportunities.length === 0) {
        return;
      }

      // Sort by execution priority (highest profit first)
      opportunities.sort((a, b) => b.executionPriority - a.executionPriority);

      console.log(`[${chain.name}] Executing ${opportunities.length} liquidation(s) this cycle`);

      // Execute ALL profitable targets sequentially
      let successCount = 0;
      for (const opportunity of opportunities) {
        // Re-check balance before each execution (previous liquidation may have spent tokens)
        const currentBalance = await this.liquidator.checkVaultBalance(chain, opportunity.debtAsset.address);
        if (currentBalance < opportunity.debtToCover) {
          console.log(
            `[${chain.name}] Skipping ${opportunity.target.user} — insufficient ${opportunity.debtAsset.symbol} ` +
              `(have: ${formatUnits(currentBalance, opportunity.debtAsset.decimals)}, ` +
              `need: ${formatUnits(opportunity.debtToCover, opportunity.debtAsset.decimals)})`
          );
          continue;
        }

        console.log(
          `[${chain.name}] Executing liquidation for ${opportunity.target.user} ` +
            `(Expected profit: $${opportunity.netProfitUsd.toFixed(2)})`
        );

        const result = await this.liquidator.executeDirectLiquidation(chain, opportunity);
        this.executionHistory.push(result);

        // Log failure only here — success is already logged by liquidator
        if (!result.success) {
          console.error(`[${chain.name}] ❌ Liquidation failed: ${result.error}`);
        } else {
          successCount++;
        }
      }

      // Update cooldown after batch execution
      this.lastExecutionTime.set(chain.chainId, now);

      if (successCount > 0) {
        console.log(`[${chain.name}] Batch complete: ${successCount}/${opportunities.length} liquidations succeeded`);
      }
    } catch (error) {
      console.error(`[${chain.name}] Error executing strategy:`, error);
    }
  }

  /**
   * Start the strategy manager
   */
  public start(): void {
    this.isRunning = true;
    console.log('Liquidation strategy manager started');
  }

  /**
   * Stop the strategy manager
   */
  public stop(): void {
    this.isRunning = false;
    console.log('Liquidation strategy manager stopped');
  }

  /**
   * Add addresses to monitor on a specific chain
   */
  public addAddressesToMonitor(chainId: number, addresses: string[]): void {
    const currentAddresses = this.knownAddresses.get(chainId) || [];
    const uniqueAddresses = Array.from(new Set([...currentAddresses, ...addresses]));
    this.knownAddresses.set(chainId, uniqueAddresses);

    console.log(`Added ${addresses.length} addresses to monitor on chain ${chainId}`);
  }

  /**
   * Get execution history
   */
  public getExecutionHistory(): ExecutionResult[] {
    return this.executionHistory;
  }
}
