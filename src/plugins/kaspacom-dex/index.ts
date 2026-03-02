/**
 * KaspaCom DEX Plugin for GOAT SDK
 *
 * This plugin exposes DEX operations as GOAT SDK tools for use with
 * external agent frameworks (LangChain, Vercel AI, MCP, etc).
 *
 * For the internal automated strategy engine, see src/modules/dex/strategy.ts
 * which calls the vault directly via viem for lower overhead.
 */
export { KaspaComDexPlugin, kaspaComDex } from "./kaspacom-dex.plugin";
export { KaspaComDexService } from "./kaspacom-dex.service";
export * from "./parameters";
export * from "./types";
