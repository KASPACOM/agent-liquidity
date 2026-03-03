/**
 * Price Monitor for Aave Oracle
 * Ported from ethers v5 to viem
 */
import { createPublicClient, http, PublicClient, formatUnits } from 'viem';
import { ChainConfig, PriceData } from './types';

// ABI for Aave Price Oracle
const PRICE_ORACLE_ABI = [
  {
    inputs: [{ name: 'asset', type: 'address' }],
    name: 'getAssetPrice',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'assets', type: 'address[]' }],
    name: 'getAssetsPrices',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export class PriceMonitor {
  private clients: Map<number, PublicClient> = new Map();
  private priceCache: Map<string, PriceData> = new Map();

  /**
   * Initialize price monitor for a specific chain
   */
  public initChain(chain: ChainConfig): void {
    if (!chain.aaveContracts) {
      console.log(`[${chain.name}] Skipping price monitor init — no Aave contracts`);
      return;
    }

    const client = createPublicClient({
      transport: http(chain.rpcUrl),
    });

    this.clients.set(chain.chainId, client);
    console.log(`[${chain.name}] Price monitor initialized`);
  }

  /**
   * Get price data from oracle for a single asset
   */
  public async getPriceData(chain: ChainConfig, assetAddress: string): Promise<PriceData> {
    if (!chain.aaveContracts) {
      throw new Error(`Chain ${chain.name} has no Aave contracts`);
    }

    // Initialize chain if not already done
    if (!this.clients.has(chain.chainId)) {
      this.initChain(chain);
    }

    const client = this.clients.get(chain.chainId);
    if (!client) {
      throw new Error(`Client not initialized for chain ${chain.chainId}`);
    }

    // Get price from Aave Oracle
    const aaveOraclePrice = await client.readContract({
      address: chain.aaveContracts.oracle as `0x${string}`,
      abi: PRICE_ORACLE_ABI,
      functionName: 'getAssetPrice',
      args: [assetAddress as `0x${string}`],
    }) as bigint;

    const priceData: PriceData = {
      assetAddress,
      aaveOraclePrice,
      timestamp: Date.now(),
    };

    // Cache the price data
    const cacheKey = `${chain.chainId}-${assetAddress}`;
    this.priceCache.set(cacheKey, priceData);

    return priceData;
  }

  /**
   * Get price data for multiple assets at once
   */
  public async getPricesData(chain: ChainConfig, assetAddresses: string[]): Promise<PriceData[]> {
    if (!chain.aaveContracts) {
      throw new Error(`Chain ${chain.name} has no Aave contracts`);
    }

    // Initialize chain if not already done
    if (!this.clients.has(chain.chainId)) {
      this.initChain(chain);
    }

    const client = this.clients.get(chain.chainId);
    if (!client) {
      throw new Error(`Client not initialized for chain ${chain.chainId}`);
    }

    // Get prices from Aave Oracle in batch
    const aaveOraclePrices = await client.readContract({
      address: chain.aaveContracts.oracle as `0x${string}`,
      abi: PRICE_ORACLE_ABI,
      functionName: 'getAssetsPrices',
      args: [assetAddresses as `0x${string}`[]],
    }) as bigint[];

    // Create price data for each asset
    const pricesData: PriceData[] = [];

    for (let i = 0; i < assetAddresses.length; i++) {
      const assetAddress = assetAddresses[i];
      const aaveOraclePrice = aaveOraclePrices[i];

      const priceData: PriceData = {
        assetAddress,
        aaveOraclePrice,
        timestamp: Date.now(),
      };

      // Cache the price data
      const cacheKey = `${chain.chainId}-${assetAddress}`;
      this.priceCache.set(cacheKey, priceData);
      pricesData.push(priceData);
    }

    return pricesData;
  }

  /**
   * Get cached price data
   */
  public getCachedPrice(chain: ChainConfig, assetAddress: string): PriceData | undefined {
    const cacheKey = `${chain.chainId}-${assetAddress}`;
    return this.priceCache.get(cacheKey);
  }

  /**
   * Clear price cache for a chain
   */
  public clearCache(chainId?: number): void {
    if (chainId) {
      // Clear cache for specific chain
      const keysToDelete: string[] = [];
      for (const key of this.priceCache.keys()) {
        if (key.startsWith(`${chainId}-`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.priceCache.delete(key));
    } else {
      // Clear all cache
      this.priceCache.clear();
    }
  }
}
