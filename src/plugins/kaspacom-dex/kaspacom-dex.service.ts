import { Tool } from "@goat-sdk/core";
import type { EVMWalletClient } from "@goat-sdk/wallet-evm";
import { formatUnits, parseUnits } from "viem";
import { ERC20_ABI } from "./abi/erc20";
import { FACTORY_ABI } from "./abi/factory";
import { PAIR_ABI } from "./abi/pair";
import { ROUTER_ABI } from "./abi/router";
import { VAULT_ABI } from "./abi/vault";
import {
  AddLiquidityParameters,
  GetPairReservesParameters,
  GetPairsParameters,
  GetQuoteParameters,
  GetTokenBalanceParameters,
  RemoveLiquidityParameters,
  SwapParameters,
} from "./parameters";
import type { ChainConfig, PairReserves, SwapQuote } from "./types";

export class KaspaComDexService {
  constructor(private config: ChainConfig) {}

  @Tool({
    description:
      "Swap tokens on KaspaCom DEX. Swaps exact input amount for minimum output amount. Automatically approves tokens and handles routing. Returns transaction hash on success.",
  })
  async swap(walletClient: EVMWalletClient, parameters: SwapParameters): Promise<string> {
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min
      const amountIn = BigInt(parameters.amountIn);
      const amountOutMin = BigInt(parameters.amountOutMin);
      const path = [parameters.tokenIn as `0x${string}`, parameters.tokenOut as `0x${string}`];

      if (parameters.useVault && this.config.vaultAddress) {
        // Route through AgentVault
        const hash = await walletClient.sendTransaction({
          to: this.config.vaultAddress,
          abi: VAULT_ABI,
          functionName: "swap",
          args: [amountIn, amountOutMin, path, deadline],
        });
        return hash.hash;
      } else {
        // Direct router call - approve first
        const approveHash = await walletClient.sendTransaction({
          to: parameters.tokenIn as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [this.config.routerAddress, amountIn],
        });

        // Execute swap
        const swapHash = await walletClient.sendTransaction({
          to: this.config.routerAddress,
          abi: ROUTER_ABI,
          functionName: "swapExactTokensForTokens",
          args: [amountIn, amountOutMin, path, walletClient.getAddress(), deadline],
        });

        return swapHash.hash;
      }
    } catch (error) {
      throw new Error(`Failed to swap: ${error}`);
    }
  }

  @Tool({
    description:
      "Add liquidity to a token pair on KaspaCom DEX. Deposits both tokens into the liquidity pool and receives LP tokens. Returns transaction hash and liquidity amount.",
  })
  async addLiquidity(
    walletClient: EVMWalletClient,
    parameters: AddLiquidityParameters
  ): Promise<string> {
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const amountADesired = BigInt(parameters.amountADesired);
      const amountBDesired = BigInt(parameters.amountBDesired);
      const amountAMin = BigInt(parameters.amountAMin);
      const amountBMin = BigInt(parameters.amountBMin);

      if (parameters.useVault && this.config.vaultAddress) {
        // Route through AgentVault
        const hash = await walletClient.sendTransaction({
          to: this.config.vaultAddress,
          abi: VAULT_ABI,
          functionName: "addLiquidity",
          args: [
            parameters.tokenA as `0x${string}`,
            parameters.tokenB as `0x${string}`,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            deadline,
          ],
        });
        return hash.hash;
      } else {
        // Direct router call - approve both tokens first
        await walletClient.sendTransaction({
          to: parameters.tokenA as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [this.config.routerAddress, amountADesired],
        });

        await walletClient.sendTransaction({
          to: parameters.tokenB as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [this.config.routerAddress, amountBDesired],
        });

        const hash = await walletClient.sendTransaction({
          to: this.config.routerAddress,
          abi: ROUTER_ABI,
          functionName: "addLiquidity",
          args: [
            parameters.tokenA as `0x${string}`,
            parameters.tokenB as `0x${string}`,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            walletClient.getAddress(),
            deadline,
          ],
        });

        return hash.hash;
      }
    } catch (error) {
      throw new Error(`Failed to add liquidity: ${error}`);
    }
  }

  @Tool({
    description:
      "Remove liquidity from a token pair on KaspaCom DEX. Burns LP tokens and receives both underlying tokens back. Returns transaction hash.",
  })
  async removeLiquidity(
    walletClient: EVMWalletClient,
    parameters: RemoveLiquidityParameters
  ): Promise<string> {
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const liquidity = BigInt(parameters.liquidity);
      const amountAMin = BigInt(parameters.amountAMin);
      const amountBMin = BigInt(parameters.amountBMin);

      // Get pair address to approve LP tokens
      const pairAddress = await walletClient.read({
        address: this.config.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "getPair",
        args: [parameters.tokenA as `0x${string}`, parameters.tokenB as `0x${string}`],
      }) as unknown as `0x${string}`;

      if (parameters.useVault && this.config.vaultAddress) {
        // Route through AgentVault
        const hash = await walletClient.sendTransaction({
          to: this.config.vaultAddress,
          abi: VAULT_ABI,
          functionName: "removeLiquidity",
          args: [
            parameters.tokenA as `0x${string}`,
            parameters.tokenB as `0x${string}`,
            liquidity,
            amountAMin,
            amountBMin,
            deadline,
          ],
        });
        return hash.hash;
      } else {
        // Direct router call - approve LP tokens first
        await walletClient.sendTransaction({
          to: pairAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [this.config.routerAddress, liquidity],
        });

        const hash = await walletClient.sendTransaction({
          to: this.config.routerAddress,
          abi: ROUTER_ABI,
          functionName: "removeLiquidity",
          args: [
            parameters.tokenA as `0x${string}`,
            parameters.tokenB as `0x${string}`,
            liquidity,
            amountAMin,
            amountBMin,
            walletClient.getAddress(),
            deadline,
          ],
        });

        return hash.hash;
      }
    } catch (error) {
      throw new Error(`Failed to remove liquidity: ${error}`);
    }
  }

  @Tool({
    description:
      "Get a quote for swapping tokens on KaspaCom DEX. Returns expected output amount for given input amount without executing the swap.",
  })
  async getQuote(walletClient: EVMWalletClient, parameters: GetQuoteParameters): Promise<SwapQuote> {
    try {
      const amountIn = BigInt(parameters.amountIn);
      const path = [parameters.tokenIn as `0x${string}`, parameters.tokenOut as `0x${string}`];

      const amounts = await walletClient.read({
        address: this.config.routerAddress,
        abi: ROUTER_ABI,
        functionName: "getAmountsOut",
        args: [amountIn, path],
      }) as unknown as bigint[];

      const amountOut = amounts[amounts.length - 1];
      
      // Calculate price impact (simplified)
      const reserves = await this.getPairReservesInternal(walletClient, parameters.tokenIn, parameters.tokenOut);
      const priceImpact = reserves ? Number((amountIn * BigInt(10000)) / reserves.reserve0) / 100 : 0;

      return {
        amountIn,
        amountOut,
        path,
        priceImpact,
      };
    } catch (error) {
      throw new Error(`Failed to get quote: ${error}`);
    }
  }

  @Tool({
    description:
      "Get reserves for a token pair on KaspaCom DEX. Returns current reserve amounts for both tokens in the pair.",
  })
  async getPairReserves(
    walletClient: EVMWalletClient,
    parameters: GetPairReservesParameters
  ): Promise<PairReserves | null> {
    return this.getPairReservesInternal(walletClient, parameters.tokenA, parameters.tokenB);
  }

  private async getPairReservesInternal(
    walletClient: EVMWalletClient,
    tokenA: string,
    tokenB: string
  ): Promise<PairReserves | null> {
    try {
      const pairAddress = await walletClient.read({
        address: this.config.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "getPair",
        args: [tokenA as `0x${string}`, tokenB as `0x${string}`],
      }) as unknown as `0x${string}`;

      if (pairAddress === "0x0000000000000000000000000000000000000000") {
        return null;
      }

      const [token0, token1, reserves] = await Promise.all([
        walletClient.read({
          address: pairAddress,
          abi: PAIR_ABI,
          functionName: "token0",
        }) as unknown as Promise<`0x${string}`>,
        walletClient.read({
          address: pairAddress,
          abi: PAIR_ABI,
          functionName: "token1",
        }) as unknown as Promise<`0x${string}`>,
        walletClient.read({
          address: pairAddress,
          abi: PAIR_ABI,
          functionName: "getReserves",
        }) as unknown as Promise<[bigint, bigint, number]>,
      ]);

      return {
        token0,
        token1,
        reserve0: reserves[0],
        reserve1: reserves[1],
      };
    } catch (error) {
      throw new Error(`Failed to get pair reserves: ${error}`);
    }
  }

  @Tool({
    description:
      "Get token balance for an address. Returns the balance of a specific ERC20 token for a given address (or wallet address if not specified).",
  })
  async getTokenBalance(
    walletClient: EVMWalletClient,
    parameters: GetTokenBalanceParameters
  ): Promise<string> {
    try {
      const accountAddress = (parameters.accountAddress || walletClient.getAddress()) as unknown as `0x${string}`;
      
      const balance = await walletClient.read({
        address: parameters.tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [accountAddress],
      }) as unknown as bigint;

      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to get token balance: ${error}`);
    }
  }

  @Tool({
    description:
      "Get a list of all token pairs on KaspaCom DEX. Returns pair addresses and token information.",
  })
  async getPairs(walletClient: EVMWalletClient, parameters: GetPairsParameters): Promise<string[]> {
    try {
      const limit = parameters.limit || 10;
      
      const pairsLength = await walletClient.read({
        address: this.config.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "allPairsLength",
      }) as unknown as bigint;

      const maxPairs = Number(pairsLength) < limit ? Number(pairsLength) : limit;
      const pairs: string[] = [];

      for (let i = 0; i < maxPairs; i++) {
        const pairAddress = await walletClient.read({
          address: this.config.factoryAddress,
          abi: FACTORY_ABI,
          functionName: "allPairs",
          args: [BigInt(i)],
        }) as unknown as `0x${string}`;
        
        pairs.push(pairAddress);
      }

      return pairs;
    } catch (error) {
      throw new Error(`Failed to get pairs: ${error}`);
    }
  }
}
