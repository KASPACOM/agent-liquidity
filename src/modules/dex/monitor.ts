import { createPublicClient, getAddress, http, zeroAddress, type PublicClient } from 'viem';
import { ERC20_ABI } from '../../plugins/kaspacom-dex/abi/erc20';
import { FACTORY_ABI } from '../../plugins/kaspacom-dex/abi/factory';
import { PAIR_ABI } from '../../plugins/kaspacom-dex/abi/pair';

export interface PairState {
  pairAddress: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  price0in1: number;  // How much token1 per token0
  price1in0: number;  // How much token0 per token1
  totalLiquidityUSD: number;
  timestamp: number;
}

export class PriceMonitor {
  private readonly client: PublicClient;
  private readonly factoryAddress: `0x${string}`;

  constructor(rpcUrl: string, factoryAddress: string) {
    this.client = createPublicClient({
      transport: http(rpcUrl),
    });
    this.factoryAddress = getAddress(factoryAddress) as `0x${string}`;
  }

  async getPairState(tokenA: string, tokenB: string): Promise<PairState | null> {
    try {
      const normalizedTokenA = getAddress(tokenA) as `0x${string}`;
      const normalizedTokenB = getAddress(tokenB) as `0x${string}`;
      const pairAddress = await this.client.readContract({
        address: this.factoryAddress,
        abi: FACTORY_ABI,
        functionName: 'getPair',
        args: [normalizedTokenA, normalizedTokenB],
      });
      if (pairAddress === zeroAddress) return null;

      const [reserves, token0, token1] = await Promise.all([
        this.client.readContract({
          address: pairAddress,
          abi: PAIR_ABI,
          functionName: 'getReserves',
        }),
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
      ]);

      const reserve0 = reserves[0];
      const reserve1 = reserves[1];

      // Price calculation (assuming 18 decimals for both — adjust per token)
      const price0in1 = Number(reserve1) / Number(reserve0);
      const price1in0 = Number(reserve0) / Number(reserve1);

      return {
        pairAddress,
        token0,
        token1,
        reserve0,
        reserve1,
        price0in1,
        price1in0,
        totalLiquidityUSD: 0, // TODO: Calculate with price feeds
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Error getting pair state for ${tokenA}/${tokenB}:`, error);
      return null;
    }
  }

  async getBalance(tokenAddress: string, walletAddress: string): Promise<bigint> {
    return this.client.readContract({
      address: getAddress(tokenAddress) as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [getAddress(walletAddress) as `0x${string}`],
    });
  }
}
