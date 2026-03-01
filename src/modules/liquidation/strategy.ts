/**
 * Strategy Manager for Aave V3 Liquidations
 * Ported from ethers v5 to viem
 * Orchestrates monitoring, assessment, and execution
 */
import { HealthFactorMonitor } from './health-monitor';
import { Liquidator } from './liquidator';
import {
  ChainConfig,
  LiquidationTarget,
  ExecutionResult,
} from './types';

export class StrategyManager {
  private isRunning = false;
  private chainMonitors: Map<number, HealthFactorMonitor> = new Map();
  private liquidator: Liquidator;
  private knownAddresses: Map<number, string[]> = new Map();
  private lastExecutionTime: Map<number, number> = new Map();
  private executionHistory: ExecutionResult[] = [];
  private executionCooldown = 60000; // 1 minute in ms

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
        // Scan for liquidation opportunities
        await this.scanForOpportunities(chain);

        // Execute liquidations if profitable
        await this.executeStrategy(chain);
      } catch (error) {
        console.error(`[${chain.name}] Error processing chain:`, error);
      }
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
        const balance = await this.liquidator.checkBalance(chain, debtAsset.address);

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

      // Find the most profitable liquidation across all positions
      let bestOpportunity: any = null;

      for (const position of liquidatablePositions) {
        for (const debtAsset of position.debtAssets) {
          // Check if we have balance for this debt asset
          const balance = await this.liquidator.checkBalance(chain, debtAsset.address);

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
              // Check if this is better than our current best opportunity
              if (
                !bestOpportunity ||
                profitCalculation.executionPriority > bestOpportunity.executionPriority
              ) {
                bestOpportunity = profitCalculation;
              }
            }
          }
        }
      }

      // If we found a profitable opportunity, execute it
      if (bestOpportunity) {
        console.log(
          `[${chain.name}] Executing liquidation for ${bestOpportunity.target.user} ` +
            `(Expected profit: $${bestOpportunity.netProfitUsd.toFixed(2)})`
        );

        // Execute the liquidation
        const result = await this.liquidator.executeDirectLiquidation(chain, bestOpportunity);

        // Record the execution
        this.lastExecutionTime.set(chain.chainId, now);
        this.executionHistory.push(result);

        // Log the result
        if (result.success) {
          console.log(`[${chain.name}] ✅ Liquidation successful! Tx hash: ${result.transactionHash}`);
        } else {
          console.error(`[${chain.name}] ❌ Liquidation failed: ${result.error}`);
        }
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
