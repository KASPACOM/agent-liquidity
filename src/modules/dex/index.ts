/**
 * DEX Module
 * LP management, arbitrage, and liquidity strategy for KaspaCom DEX
 */

export { PriceMonitor, type PairState } from './monitor';
export {
  getAmountIn,
  getAmountOut,
  calcIL,
  calcLpValue,
} from './math';
export { PositionStore, type LPPosition } from './positions';
export {
  SmartLPManager,
  type PairSnapshot,
  type PairVolumeData,
  type SmartLpDecision,
} from './smart-lp';
export { ArbitrageEngine, type ArbitrageOpportunity } from './arbitrage';
export { DexStrategyEngine } from './strategy';
