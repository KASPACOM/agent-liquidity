export type ChainConfig = {
  chainId: number;
  chainName: string;
  routerAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  wkasAddress: `0x${string}`;
  vaultAddress?: `0x${string}`;
};

export type PairReserves = {
  reserve0: bigint;
  reserve1: bigint;
  token0: `0x${string}`;
  token1: `0x${string}`;
};

export type SwapQuote = {
  amountIn: bigint;
  amountOut: bigint;
  path: `0x${string}`[];
  priceImpact: number;
};

export type LiquidityPosition = {
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
};
