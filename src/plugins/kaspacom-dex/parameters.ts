import { createToolParameters } from "@goat-sdk/core";
import { z } from "zod";

export class SwapParameters extends createToolParameters(
  z.object({
    tokenIn: z.string().describe("Address of the input token"),
    tokenOut: z.string().describe("Address of the output token"),
    amountIn: z.string().describe("Amount of input token to swap (in wei/base units)"),
    amountOutMin: z.string().describe("Minimum amount of output token to receive (in wei/base units)"),
    slippageBps: z.number().optional().describe("Slippage tolerance in basis points (default: 50 = 0.5%)"),
    useVault: z.boolean().optional().describe("Use AgentVault contract for swap (default: false)"),
  })
) {}

export class AddLiquidityParameters extends createToolParameters(
  z.object({
    tokenA: z.string().describe("Address of first token"),
    tokenB: z.string().describe("Address of second token"),
    amountADesired: z.string().describe("Desired amount of tokenA (in wei/base units)"),
    amountBDesired: z.string().describe("Desired amount of tokenB (in wei/base units)"),
    amountAMin: z.string().describe("Minimum amount of tokenA (in wei/base units)"),
    amountBMin: z.string().describe("Minimum amount of tokenB (in wei/base units)"),
    useVault: z.boolean().optional().describe("Use AgentVault contract for adding liquidity (default: false)"),
  })
) {}

export class RemoveLiquidityParameters extends createToolParameters(
  z.object({
    tokenA: z.string().describe("Address of first token"),
    tokenB: z.string().describe("Address of second token"),
    liquidity: z.string().describe("Amount of LP tokens to burn (in wei/base units)"),
    amountAMin: z.string().describe("Minimum amount of tokenA to receive (in wei/base units)"),
    amountBMin: z.string().describe("Minimum amount of tokenB to receive (in wei/base units)"),
    useVault: z.boolean().optional().describe("Use AgentVault contract for removing liquidity (default: false)"),
  })
) {}

export class GetQuoteParameters extends createToolParameters(
  z.object({
    tokenIn: z.string().describe("Address of the input token"),
    tokenOut: z.string().describe("Address of the output token"),
    amountIn: z.string().describe("Amount of input token (in wei/base units)"),
  })
) {}

export class GetPairReservesParameters extends createToolParameters(
  z.object({
    tokenA: z.string().describe("Address of first token"),
    tokenB: z.string().describe("Address of second token"),
  })
) {}

export class GetTokenBalanceParameters extends createToolParameters(
  z.object({
    tokenAddress: z.string().describe("Address of the token"),
    accountAddress: z.string().optional().describe("Address to check balance for (defaults to wallet address)"),
  })
) {}

export class GetPairsParameters extends createToolParameters(
  z.object({
    limit: z.number().optional().describe("Maximum number of pairs to return (default: 10)"),
  })
) {}
