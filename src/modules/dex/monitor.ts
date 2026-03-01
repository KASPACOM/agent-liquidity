import { ethers } from 'ethers';

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

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
  private provider: ethers.JsonRpcProvider;
  private factory: ethers.Contract;
  
  constructor(rpcUrl: string, factoryAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.factory = new ethers.Contract(factoryAddress, FACTORY_ABI, this.provider);
  }
  
  async getPairState(tokenA: string, tokenB: string): Promise<PairState | null> {
    try {
      const pairAddress = await this.factory.getPair(tokenA, tokenB);
      if (pairAddress === ethers.ZeroAddress) return null;
      
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const [reserves, token0] = await Promise.all([
        pair.getReserves(),
        pair.token0(),
      ]);
      
      const reserve0 = reserves[0];
      const reserve1 = reserves[1];
      
      // Price calculation (assuming 18 decimals for both — adjust per token)
      const price0in1 = Number(reserve1) / Number(reserve0);
      const price1in0 = Number(reserve0) / Number(reserve1);
      
      return {
        pairAddress,
        token0,
        token1: token0.toLowerCase() === tokenA.toLowerCase() ? tokenB : tokenA,
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
    const token = new ethers.Contract(tokenAddress, [
      'function balanceOf(address) view returns (uint256)',
    ], this.provider);
    return token.balanceOf(walletAddress);
  }
}
