import { config as dotenvConfig } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  Contract,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  ZeroAddress,
  formatEther,
  formatUnits,
  getAddress,
  keccak256,
  parseEther,
  parseUnits,
  toUtf8Bytes,
} from 'ethers';
import { CONFIG } from '../src/config';
import { ERC20_ABI } from '../src/plugins/kaspacom-dex/abi/erc20';
import { FACTORY_ABI } from '../src/plugins/kaspacom-dex/abi/factory';
import { PAIR_ABI } from '../src/plugins/kaspacom-dex/abi/pair';
import { VAULT_ABI } from '../src/plugins/kaspacom-dex/abi/vault';

dotenvConfig();

const RPC_URL = 'https://galleon-testnet.igralabs.com:8545';
const CHAIN_ID = 38836;
const EXPLORER_URL = 'https://explorer.galleon-testnet.igralabs.com';
const DEFAULT_DURATION_MS = 18 * 60 * 1000;
const ROUTER_ADDRESS = '0xC69B228c4591508067c87bf78743080eE1270e2A';
const WRAPPER_ROUTER_ADDRESS = '0x1f99e4a0b40cdb6f25ea92fef6eda326f9317d6b';
const FACTORY_ADDRESS = '0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0';
const WKAS_ADDRESS = '0x394C68684F9AFCEb9b804531EF07a864E8081738';
const ERC20_DEPLOYER_ADDRESS = '0xC8E13bddDb1E0B878de0996c27F0c3738e2709eA'; // official KaspaCom ERC20MintableDeployer on Galleon
const AGENT_VAULT_ADDRESS = '0x983E517e872301828d5d35aD646929beC41bD54c';
const MAX_TRADE_SIZE_KAS = BigInt(Math.trunc(CONFIG.maxTradeSizeKas)) * 10n ** 18n;
const TX_OVERRIDES = {
  type: 0,
  gasPrice: 2_000_000_000_000n,
  gasLimit: 3_000_000n, // KaspaComPair deployment needs ~1.5M, ERC20Mintable ~950K, swaps ~200K
} as const;

const ROUTER_ABI = [
  {
    type: 'function',
    name: 'factory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'WETH',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'addLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'amountADesired', type: 'uint256' },
      { name: 'amountBDesired', type: 'uint256' },
      { name: 'amountAMin', type: 'uint256' },
      { name: 'amountBMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountA', type: 'uint256' },
      { name: 'amountB', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'addLiquidityETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amountTokenDesired', type: 'uint256' },
      { name: 'amountTokenMin', type: 'uint256' },
      { name: 'amountETHMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountToken', type: 'uint256' },
      { name: 'amountETH', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'removeLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'amountAMin', type: 'uint256' },
      { name: 'amountBMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountA', type: 'uint256' },
      { name: 'amountB', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'removeLiquidityETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'amountTokenMin', type: 'uint256' },
      { name: 'amountETHMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountToken', type: 'uint256' },
      { name: 'amountETH', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapExactETHForTokens',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapExactTokensForETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

const WKAS_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dst', type: 'address' },
      { name: 'wad', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'guy', type: 'address' },
      { name: 'wad', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const DIRECT_PAIR_ABI = [
  ...PAIR_ABI,
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [{ name: 'liquidity', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'burn',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount0Out', type: 'uint256' },
      { name: 'amount1Out', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const ERC20_DEPLOYER_ABI = [
  {
    type: 'function',
    name: 'deploy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'decimals', type: 'uint8' },
      { name: 'initialSupply', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const MINTABLE_ERC20_ABI = [
  ...ERC20_ABI,
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

type StressTokenKey = 'STRESSA' | 'STRESSB' | 'STRESSC';
type ExistingTokenKey = 'WKAS' | 'WBTC' | 'WETH' | 'DAI' | 'USDC' | 'USDT';
type TokenKey = StressTokenKey | ExistingTokenKey;
type WalletRole = 'Market Maker' | 'Arbitrageur' | 'Whale' | 'Retail Trader' | 'LP Manager';
type PairKey = 'STRESSA/WKAS' | 'STRESSB/WKAS' | 'STRESSC/WKAS' | 'STRESSA/STRESSB';

type TokenConfig = {
  key: TokenKey;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  deployedTxHash?: string;
};

type PairConfig = {
  key: PairKey;
  tokenA: TokenKey;
  tokenB: TokenKey;
  pairAddress: string;
  createdTxHash: string;
  creationMode: 'addLiquidity' | 'addLiquidityETH';
};

type TxLogEntry = {
  phase: string;
  actor: string;
  action: string;
  hash?: string;
  explorerUrl?: string;
  submittedAt: string;
  minedAt?: string;
  success: boolean;
  gasUsed?: string;
  gasPrice?: string;
  gasCostWei?: string;
  blockNumber?: number;
  error?: string;
  context?: Record<string, unknown>;
};

type TradeRecord = {
  timestamp: string;
  actor: string;
  action: string;
  success: boolean;
  pair?: string;
  direction?: string;
  amountInWei?: string;
  amountOutWei?: string;
  amountInSymbol?: string;
  amountOutSymbol?: string;
  expectedOutWei?: string;
  slippageBps?: number;
  txHash?: string;
  error?: string;
};

type WalletStats = {
  role: WalletRole;
  address: string;
  trades: number;
  successfulTrades: number;
  failedTrades: number;
  volumeKasWei: bigint;
  gasSpentWei: bigint;
  slippagesBps: number[];
  arbAttempts: number;
  profitableArbs: number;
  arbNetKasWei: bigint;
  lpCycles: number;
  impermanentLossesBps: number[];
  notes: string[];
  startingValueKasWei: bigint;
  endingValueKasWei: bigint;
};

type VaultSnapshot = {
  timestamp: string;
  nativeBalanceWei: string;
  remainingDailyVolumeWei?: string;
  tokenBalances: Record<string, string>;
  lpBalances: Record<string, string>;
  note?: string;
};

type ResultsPayload = {
  metadata: {
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
    network: string;
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    routerAddress: string;
    wrapperRouterAddress: string;
    factoryAddress: string;
    vaultAddress: string;
    wKasAddress: string;
    deployerAddress: string;
  };
  deployedTokens: Record<string, TokenConfig>;
  pairs: Record<string, PairConfig>;
  txs: TxLogEntry[];
  trades: TradeRecord[];
  wallets: WalletStats[];
  vaultSnapshots: VaultSnapshot[];
  errors: string[];
  report?: string;
};

type StressWallet = {
  index: number;
  role: WalletRole;
  signer: NonceManager;
  address: string;
  rng: () => number;
};

type RuntimeContext = {
  provider: JsonRpcProvider;
  deployer: NonceManager;
  deployerAddress: string;
  router: AnyContract;
  factory: AnyContract;
  vault: AnyContract;
  erc20Deployer: AnyContract;
  tokens: Record<TokenKey, TokenConfig>;
  stressWallets: StressWallet[];
  walletStats: Map<string, WalletStats>;
  txs: TxLogEntry[];
  trades: TradeRecord[];
  pairs: Map<PairKey, PairConfig>;
  errors: string[];
  vaultSnapshots: VaultSnapshot[];
  startedAt: number;
  endAt: number;
  resultsFile: string;
  reportFile: string;
  persistChain: Promise<void>;
  lpState: Map<string, LPPositionState>;
  marketMakerState: { lastBoughtAmountWei: bigint };
  whaleState: { step: number };
  lpPairCursor: number;
  vaultState: { seeded: boolean; activePair?: PairKey; notes: string[] };
};

type LPPositionState = {
  pairKey: PairKey;
  tokenAAmountWei: bigint;
  tokenBAmountWei: bigint;
  enteredAt: number;
  referenceValueKasWei: bigint;
};

type AnyContract = Contract & Record<string, any>;

function nowIso(): string {
  return new Date().toISOString();
}

function getPrivateKey(): string {
  const key = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.IGRA_DEPLOYER_KEY;
  if (!key) {
    throw new Error('PRIVATE_KEY is required');
  }

  return key.startsWith('0x') ? key : `0x${key}`;
}

function makeProvider(): JsonRpcProvider {
  const provider = new JsonRpcProvider(
    RPC_URL,
    { chainId: CHAIN_ID, name: 'galleon-testnet' },
    { staticNetwork: true }
  );
  provider.pollingInterval = 1_000;
  return provider;
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicWallet(basePrivateKey: string, index: number, provider: JsonRpcProvider): Wallet {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = keccak256(
      toUtf8Bytes(`${basePrivateKey.toLowerCase()}:${index}:${attempt}:dex-stress-test`)
    );
    try {
      return new Wallet(candidate, provider);
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to derive deterministic wallet ${index}`);
}

// Chain clock offset: Galleon block.timestamp can be ahead of system clock.
// We fetch the latest block timestamp once at startup and use it as the base.
let chainTimeOffsetSec = 0;
async function syncChainTime(provider: JsonRpcProvider): Promise<void> {
  const block = await provider.getBlock('latest');
  if (block) {
    const systemNow = Math.floor(Date.now() / 1000);
    chainTimeOffsetSec = block.timestamp - systemNow;
    console.log(`Chain time offset: ${chainTimeOffsetSec}s (block.timestamp=${block.timestamp}, systemNow=${systemNow})`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function randomBetween(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function applySlippage(amount: bigint, bps: number): bigint {
  const safeBps = Math.max(0, Math.min(bps, 9_999));
  return (amount * BigInt(10_000 - safeBps)) / 10_000n;
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return 0n;
  }
  const amountInWithFee = amountIn * 99n;
  return (amountInWithFee * reserveOut) / (reserveIn * 100n + amountInWithFee);
}

function clampKasTradeSize(amountWei: bigint): bigint {
  return amountWei > MAX_TRADE_SIZE_KAS ? MAX_TRADE_SIZE_KAS : amountWei;
}

function formatKas(wei: bigint): string {
  return formatEther(wei);
}

function serializeBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInt(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeBigInt(nested)])
    );
  }

  return value;
}

function shortError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(serializeBigInt(value), null, 2)}\n`, 'utf8');
}

function txExplorerUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

function getResultPaths(): { resultsFile: string; reportFile: string } {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
  const baseDir = resolve(process.cwd(), 'stress-test-results');
  return {
    resultsFile: resolve(baseDir, `txns-${stamp}.json`),
    reportFile: resolve(baseDir, `report-${stamp}.txt`),
  };
}

async function persistResults(context: RuntimeContext, report?: string): Promise<void> {
  const payload: ResultsPayload = {
    metadata: {
      startedAt: new Date(context.startedAt).toISOString(),
      endedAt: nowIso(),
      durationMs: Date.now() - context.startedAt,
      network: 'Galleon Testnet',
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      explorerUrl: EXPLORER_URL,
      routerAddress: ROUTER_ADDRESS,
      wrapperRouterAddress: WRAPPER_ROUTER_ADDRESS,
      factoryAddress: FACTORY_ADDRESS,
      vaultAddress: AGENT_VAULT_ADDRESS,
      wKasAddress: WKAS_ADDRESS,
      deployerAddress: context.deployerAddress,
    },
    deployedTokens: Object.fromEntries(
      Object.entries(context.tokens)
        .filter(([key]) => key.startsWith('STRESS'))
        .map(([key, value]) => [key, value])
    ),
    pairs: Object.fromEntries(context.pairs.entries()),
    txs: context.txs,
    trades: context.trades,
    wallets: Array.from(context.walletStats.values()),
    vaultSnapshots: context.vaultSnapshots,
    errors: context.errors,
    report,
  };

  context.persistChain = context.persistChain.then(async () => {
    await mkdir(dirname(context.resultsFile), { recursive: true });
    await writeFile(context.resultsFile, `${JSON.stringify(serializeBigInt(payload), null, 2)}\n`, 'utf8');
    if (report) {
      await writeFile(context.reportFile, `${report}\n`, 'utf8');
    }
  });

  await context.persistChain;
}

function pushError(context: RuntimeContext, message: string): void {
  context.errors.push(`${nowIso()} ${message}`);
}

function getWalletStats(context: RuntimeContext, wallet: StressWallet): WalletStats {
  const stats = context.walletStats.get(wallet.address);
  if (!stats) {
    throw new Error(`Missing stats for wallet ${wallet.address}`);
  }
  return stats;
}

async function validateContracts(context: RuntimeContext): Promise<void> {
  const network = await context.provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`Expected chain ${CHAIN_ID}, received ${network.chainId}`);
  }

  const [routerCode, factoryCode, vaultCode, deployerCode] = await Promise.all([
    context.provider.getCode(ROUTER_ADDRESS),
    context.provider.getCode(FACTORY_ADDRESS),
    context.provider.getCode(AGENT_VAULT_ADDRESS),
    context.provider.getCode(ERC20_DEPLOYER_ADDRESS),
  ]);

  if ([routerCode, factoryCode, vaultCode, deployerCode].some((code) => code === '0x')) {
    throw new Error('One or more required contracts are not deployed at the configured addresses');
  }

  const routerFactory = getAddress(await context.router['factory']());
  const routerWeth = getAddress(await context.router['WETH']());
  if (routerFactory !== getAddress(FACTORY_ADDRESS)) {
    throw new Error(`Router factory mismatch: expected ${FACTORY_ADDRESS}, got ${routerFactory}`);
  }
  if (routerWeth !== getAddress(WKAS_ADDRESS)) {
    throw new Error(`Router WETH mismatch: expected ${WKAS_ADDRESS}, got ${routerWeth}`);
  }
}

async function sendLoggedTx(
  context: RuntimeContext,
  phase: string,
  actor: string,
  action: string,
  send: () => Promise<{ hash: string; wait: () => Promise<any> }>,
  meta?: Record<string, unknown>
): Promise<any | null> {
  const entry: TxLogEntry = {
    phase,
    actor,
    action,
    submittedAt: nowIso(),
    success: false,
    context: meta,
  };
  context.txs.push(entry);

  try {
    const tx = await send();
    entry.hash = tx.hash;
    entry.explorerUrl = txExplorerUrl(tx.hash);
    await persistResults(context);

    const receipt = await tx.wait();
    entry.minedAt = nowIso();
    entry.success = receipt?.status === 1;
    entry.blockNumber = Number(receipt?.blockNumber ?? 0);
    const gasUsed = BigInt(receipt?.gasUsed ?? 0n);
    const gasPrice = BigInt(receipt?.gasPrice ?? TX_OVERRIDES.gasPrice);
    entry.gasUsed = gasUsed.toString();
    entry.gasPrice = gasPrice.toString();
    entry.gasCostWei = (gasUsed * gasPrice).toString();
    await persistResults(context);
    return receipt;
  } catch (error) {
    entry.minedAt = nowIso();
    entry.error = shortError(error);
    await persistResults(context);
    return null;
  }
}

function recordTrade(context: RuntimeContext, record: TradeRecord): void {
  context.trades.push(record);
}

function connected(contract: AnyContract, signer: NonceManager): AnyContract {
  return contract.connect(signer) as AnyContract;
}

function getPairContract(address: string, runner: NonceManager | JsonRpcProvider): AnyContract {
  return new Contract(address, DIRECT_PAIR_ABI, runner) as AnyContract;
}

function getWkasContract(runner: NonceManager | JsonRpcProvider): AnyContract {
  return new Contract(WKAS_ADDRESS, WKAS_ABI, runner) as AnyContract;
}

async function getDirectPairAddress(
  context: RuntimeContext,
  tokenA: string,
  tokenB: string
): Promise<string> {
  return getAddress(await context.factory['getPair'](tokenA, tokenB));
}

async function ensurePairExists(
  context: RuntimeContext,
  signer: NonceManager,
  actor: string,
  phase: string,
  tokenA: string,
  tokenB: string
): Promise<string> {
  let pairAddress = await getDirectPairAddress(context, tokenA, tokenB);
  if (pairAddress !== ZeroAddress) {
    return pairAddress;
  }

  const receipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `create pair ${tokenA}/${tokenB}`,
    async () => new Contract(FACTORY_ADDRESS, FACTORY_ABI, signer)['createPair'](tokenA, tokenB, TX_OVERRIDES),
    { tokenA, tokenB }
  );

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Failed to create pair for ${tokenA}/${tokenB}`);
  }

  // Parse PairCreated event from receipt logs to avoid stale provider cache
  // PairCreated(address indexed token0, address indexed token1, address pair, uint256)
  // topic[0] = event sig, topic[1] = token0, topic[2] = token1, data = pair address (first 32 bytes) + allPairsLength
  const PAIR_CREATED_TOPIC = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
  const pairLog = receipt.logs?.find(
    (l: any) => l.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase()
      && l.topics?.[0]?.toLowerCase() === PAIR_CREATED_TOPIC
  );
  if (pairLog) {
    // pair address is first 32 bytes of data (ABI-encoded address)
    pairAddress = getAddress('0x' + pairLog.data.slice(26, 66));
    return pairAddress;
  }

  // Fallback: query factory (allow slight delay for RPC to catch up)
  await new Promise(r => setTimeout(r, 2000));
  pairAddress = await getDirectPairAddress(context, tokenA, tokenB);
  if (pairAddress === ZeroAddress) {
    throw new Error(`Factory returned zero pair for ${tokenA}/${tokenB}`);
  }

  return pairAddress;
}

async function quoteDirectAmountOut(
  context: RuntimeContext,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint
): Promise<bigint> {
  const pairAddress = await getDirectPairAddress(context, tokenIn, tokenOut);
  if (pairAddress === ZeroAddress) {
    return 0n;
  }

  const pairContract = getPairContract(pairAddress, context.provider);
  const [token0, reserves] = await Promise.all([
    pairContract['token0'](),
    pairContract['getReserves'](),
  ]);
  const reserve0 = BigInt(reserves[0]);
  const reserve1 = BigInt(reserves[1]);
  const isToken0In = getAddress(tokenIn) === getAddress(token0);
  return getAmountOut(amountIn, isToken0In ? reserve0 : reserve1, isToken0In ? reserve1 : reserve0);
}

async function quoteAmountsOut(
  context: RuntimeContext,
  path: readonly string[],
  amountIn: bigint
): Promise<bigint[] | null> {
  try {
    if (path.length < 2) {
      return [amountIn];
    }

    const amounts: bigint[] = [amountIn];
    let running = amountIn;
    for (let i = 0; i < path.length - 1; i += 1) {
      running = await quoteDirectAmountOut(context, path[i]!, path[i + 1]!, running);
      amounts.push(running);
    }
    return amounts;
  } catch {
    return null;
  }
}

async function getTokenBalance(
  context: RuntimeContext,
  token: TokenConfig,
  account: string
): Promise<bigint> {
  const contract = new Contract(token.address, MINTABLE_ERC20_ABI, context.provider);
  return BigInt(await contract['balanceOf'](account));
}

async function getNativeBalance(context: RuntimeContext, account: string): Promise<bigint> {
  return await context.provider.getBalance(account);
}

async function deployStressToken(
  context: RuntimeContext,
  symbol: StressTokenKey,
  name: string,
  decimals: number,
  supply: bigint
): Promise<TokenConfig> {
  const receipt = await sendLoggedTx(
    context,
    'setup',
    'Deployer',
    `deploy ${symbol}`,
    async () =>
      context.erc20Deployer['deploy'](
        name,
        symbol,
        decimals,
        supply,
        context.deployerAddress,
        TX_OVERRIDES
      ),
    { decimals, supply: supply.toString() }
  );

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Failed to deploy ${symbol}`);
  }

  // Parse deployed token address from TokenDeployed event log (topic[1] = indexed token address)
  const deployedLog = receipt.logs?.find(
    (l: any) => l.address.toLowerCase() === ERC20_DEPLOYER_ADDRESS.toLowerCase() && l.topics?.length >= 2
  );
  if (!deployedLog) {
    throw new Error(`Could not find TokenDeployed event log for ${symbol}`);
  }
  const tokenAddress = getAddress('0x' + deployedLog.topics[1].slice(26));

  return {
    key: symbol,
    symbol,
    name,
    address: tokenAddress,
    decimals,
    deployedTxHash: receipt.transactionHash ?? receipt.hash,
  };
}

async function transferToken(
  context: RuntimeContext,
  signer: NonceManager,
  actor: string,
  token: TokenConfig,
  recipient: string,
  amount: bigint,
  phase: string
): Promise<void> {
  const contract = new Contract(token.address, MINTABLE_ERC20_ABI, signer);
  const receipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `transfer ${token.symbol}`,
    async () => contract['transfer'](recipient, amount, TX_OVERRIDES),
    { token: token.address, recipient, amount: amount.toString() }
  );

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transfer failed for ${token.symbol}`);
  }
}

async function wrapNative(
  context: RuntimeContext,
  signer: NonceManager,
  actor: string,
  amount: bigint,
  phase: string
): Promise<{ hash: string; gasCostWei: bigint }> {
  const wkas = getWkasContract(signer);
  const receipt = await sendLoggedTx(
    context,
    phase,
    actor,
    'wrap WKAS',
    async () => wkas['deposit']({ ...TX_OVERRIDES, value: amount }),
    { amount: amount.toString() }
  );

  if (!receipt || receipt.status !== 1) {
    throw new Error('WKAS deposit failed');
  }

  return {
    hash: receipt.hash,
    gasCostWei: BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? TX_OVERRIDES.gasPrice),
  };
}

async function unwrapWkas(
  context: RuntimeContext,
  signer: NonceManager,
  actor: string,
  amount: bigint,
  phase: string
): Promise<{ hash: string; gasCostWei: bigint }> {
  const wkas = getWkasContract(signer);
  const receipt = await sendLoggedTx(
    context,
    phase,
    actor,
    'unwrap WKAS',
    async () => wkas['withdraw'](amount, TX_OVERRIDES),
    { amount: amount.toString() }
  );

  if (!receipt || receipt.status !== 1) {
    throw new Error('WKAS withdraw failed');
  }

  return {
    hash: receipt.hash,
    gasCostWei: BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? TX_OVERRIDES.gasPrice),
  };
}

async function directAddLiquidity(
  context: RuntimeContext,
  signer: NonceManager,
  pair: PairConfig,
  tokenA: TokenConfig,
  amountA: bigint,
  tokenB: TokenConfig,
  amountB: bigint,
  actor: string,
  phase: string
): Promise<{ hash: string; gasCostWei: bigint }> {
  const pairContract = getPairContract(pair.pairAddress, signer);
  const tokenAContract = new Contract(tokenA.address, ERC20_ABI, signer) as AnyContract;
  const tokenBContract = new Contract(tokenB.address, ERC20_ABI, signer) as AnyContract;
  let gasCostWei = 0n;

  const transferAReceipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `transfer ${tokenA.symbol} to ${pair.key}`,
    async () => tokenAContract['transfer'](pair.pairAddress, amountA, TX_OVERRIDES),
    { pair: pair.key, token: tokenA.address, amount: amountA.toString() }
  );
  if (!transferAReceipt || transferAReceipt.status !== 1) {
    throw new Error(`Failed to transfer ${tokenA.symbol} into ${pair.key}`);
  }
  gasCostWei += BigInt(transferAReceipt.gasUsed) * BigInt(transferAReceipt.gasPrice ?? TX_OVERRIDES.gasPrice);

  const transferBReceipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `transfer ${tokenB.symbol} to ${pair.key}`,
    async () => tokenBContract['transfer'](pair.pairAddress, amountB, TX_OVERRIDES),
    { pair: pair.key, token: tokenB.address, amount: amountB.toString() }
  );
  if (!transferBReceipt || transferBReceipt.status !== 1) {
    throw new Error(`Failed to transfer ${tokenB.symbol} into ${pair.key}`);
  }
  gasCostWei += BigInt(transferBReceipt.gasUsed) * BigInt(transferBReceipt.gasPrice ?? TX_OVERRIDES.gasPrice);

  const recipient = await signer.getAddress();
  const mintReceipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `mint LP ${pair.key}`,
    async () => pairContract['mint'](recipient, TX_OVERRIDES),
    { pair: pair.key, recipient }
  );
  if (!mintReceipt || mintReceipt.status !== 1) {
    throw new Error(`Failed to mint LP for ${pair.key}`);
  }
  gasCostWei += BigInt(mintReceipt.gasUsed) * BigInt(mintReceipt.gasPrice ?? TX_OVERRIDES.gasPrice);

  return { hash: mintReceipt.hash, gasCostWei };
}

async function directRemoveLiquidity(
  context: RuntimeContext,
  signer: NonceManager,
  pair: PairConfig,
  lpAmount: bigint,
  actor: string,
  phase: string
): Promise<{ hash: string; gasCostWei: bigint }> {
  const pairContract = getPairContract(pair.pairAddress, signer);
  let gasCostWei = 0n;

  const transferReceipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `return LP ${pair.key}`,
    async () => pairContract['transfer'](pair.pairAddress, lpAmount, TX_OVERRIDES),
    { pair: pair.key, liquidity: lpAmount.toString() }
  );
  if (!transferReceipt || transferReceipt.status !== 1) {
    throw new Error(`Failed to return LP tokens for ${pair.key}`);
  }
  gasCostWei += BigInt(transferReceipt.gasUsed) * BigInt(transferReceipt.gasPrice ?? TX_OVERRIDES.gasPrice);

  const recipient = await signer.getAddress();
  const burnReceipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `burn LP ${pair.key}`,
    async () => pairContract['burn'](recipient, TX_OVERRIDES),
    { pair: pair.key, recipient }
  );
  if (!burnReceipt || burnReceipt.status !== 1) {
    throw new Error(`Failed to burn LP for ${pair.key}`);
  }
  gasCostWei += BigInt(burnReceipt.gasUsed) * BigInt(burnReceipt.gasPrice ?? TX_OVERRIDES.gasPrice);

  return { hash: burnReceipt.hash, gasCostWei };
}

async function directSwap(
  context: RuntimeContext,
  signer: NonceManager,
  pairAddress: string,
  tokenIn: string,
  amountIn: bigint,
  actor: string,
  phase: string,
  recipient?: string,
  transferIn = true
): Promise<{ amountOutWei: bigint; txHash: string; gasCostWei: bigint }> {
  const pairContract = getPairContract(pairAddress, signer);
  const [token0, reserves] = await Promise.all([
    pairContract['token0'](),
    pairContract['getReserves'](),
  ]);
  const isToken0In = getAddress(tokenIn) === getAddress(token0);
  const reserve0 = BigInt(reserves[0]);
  const reserve1 = BigInt(reserves[1]);
  const reserveIn = isToken0In ? reserve0 : reserve1;
  const reserveOut = isToken0In ? reserve1 : reserve0;
  const amountOutWei = getAmountOut(amountIn, reserveIn, reserveOut);
  if (amountOutWei <= 0n) {
    throw new Error(`Swap quote is zero for pair ${pairAddress}`);
  }

  let gasCostWei = 0n;
  if (transferIn) {
    const tokenInContract = new Contract(tokenIn, ERC20_ABI, signer) as AnyContract;
    const transferReceipt = await sendLoggedTx(
      context,
      phase,
      actor,
      `transfer swap input ${tokenIn}`,
      async () => tokenInContract['transfer'](pairAddress, amountIn, TX_OVERRIDES),
      { pairAddress, tokenIn, amountIn: amountIn.toString() }
    );
    if (!transferReceipt || transferReceipt.status !== 1) {
      throw new Error(`Failed to transfer swap input ${tokenIn}`);
    }
    gasCostWei += BigInt(transferReceipt.gasUsed) * BigInt(transferReceipt.gasPrice ?? TX_OVERRIDES.gasPrice);
  }

  const to = recipient ?? (await signer.getAddress());
  const swapReceipt = await sendLoggedTx(
    context,
    phase,
    actor,
    `swap on pair ${pairAddress}`,
    async () =>
      pairContract['swap'](
        isToken0In ? 0n : amountOutWei,
        isToken0In ? amountOutWei : 0n,
        to,
        '0x',
        TX_OVERRIDES
      ),
    { pairAddress, tokenIn, amountIn: amountIn.toString(), amountOutWei: amountOutWei.toString(), to }
  );
  if (!swapReceipt || swapReceipt.status !== 1) {
    throw new Error(`Swap failed on pair ${pairAddress}`);
  }
  gasCostWei += BigInt(swapReceipt.gasUsed) * BigInt(swapReceipt.gasPrice ?? TX_OVERRIDES.gasPrice);

  return {
    amountOutWei,
    txHash: swapReceipt.hash,
    gasCostWei,
  };
}

async function sendNative(
  context: RuntimeContext,
  signer: NonceManager,
  actor: string,
  recipient: string,
  amount: bigint,
  phase: string
): Promise<void> {
  const receipt = await sendLoggedTx(
    context,
    phase,
    actor,
    'send native',
    async () =>
      signer.sendTransaction({
        to: recipient,
        value: amount,
        ...TX_OVERRIDES,
      }),
    { recipient, amount: amount.toString() }
  );

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Native transfer failed for ${recipient}`);
  }
}

async function bootstrapPair(
  context: RuntimeContext,
  pairKey: PairKey,
  tokenAKey: TokenKey,
  tokenBKey: TokenKey,
  amountA: bigint,
  amountB: bigint,
  mode: 'addLiquidity' | 'addLiquidityETH'
): Promise<PairConfig> {
  const tokenA = context.tokens[tokenAKey];
  const tokenB = context.tokens[tokenBKey];
  const pairAddress = await ensurePairExists(
    context,
    context.deployer,
    'Deployer',
    'setup',
    tokenA.address,
    tokenB.address
  );
  const pairConfig: PairConfig = {
    key: pairKey,
    tokenA: tokenAKey,
    tokenB: tokenBKey,
    pairAddress,
    createdTxHash: '',
    creationMode: mode,
  };

  let lastTx: string | undefined;
  if (mode === 'addLiquidityETH') {
    const nativeAmount = tokenAKey === 'WKAS' ? amountA : amountB;
    const wrapResult = await wrapNative(context, context.deployer, 'Deployer', nativeAmount, 'setup');
    const addResult = await directAddLiquidity(
      context,
      context.deployer,
      pairConfig,
      tokenA,
      amountA,
      tokenB,
      amountB,
      'Deployer',
      'setup'
    );
    lastTx = addResult.hash ?? wrapResult.hash;
  } else {
    const addResult = await directAddLiquidity(
      context,
      context.deployer,
      pairConfig,
      tokenA,
      amountA,
      tokenB,
      amountB,
      'Deployer',
      'setup'
    );
    lastTx = addResult.hash;
  }

  if (!lastTx) {
    throw new Error(`Missing bootstrap tx hash for ${pairKey}`);
  }

  return {
    key: pairKey,
    tokenA: tokenAKey,
    tokenB: tokenBKey,
    pairAddress,
    createdTxHash: lastTx,
    creationMode: mode,
  };
}

async function readPairReserves(
  context: RuntimeContext,
  pair: PairConfig
): Promise<{ reserveA: bigint; reserveB: bigint }> {
  const pairContract = new Contract(pair.pairAddress, PAIR_ABI, context.provider);
  const [token0, reserves] = await Promise.all([
    getAddress(await pairContract['token0']()),
    pairContract['getReserves'](),
  ]);

  const reserve0 = BigInt(reserves[0]);
  const reserve1 = BigInt(reserves[1]);
  if (token0 === getAddress(context.tokens[pair.tokenA].address)) {
    return { reserveA: reserve0, reserveB: reserve1 };
  }
  return { reserveA: reserve1, reserveB: reserve0 };
}

async function getPairPriceInKas(context: RuntimeContext, pairKey: PairKey): Promise<number> {
  const pair = context.pairs.get(pairKey);
  if (!pair) {
    return 0;
  }

  const { reserveA, reserveB } = await readPairReserves(context, pair);
  const tokenA = context.tokens[pair.tokenA];
  const tokenB = context.tokens[pair.tokenB];
  const normalizedA = Number(formatUnits(reserveA, tokenA.decimals));
  const normalizedB = Number(formatUnits(reserveB, tokenB.decimals));
  if (normalizedA === 0 || normalizedB === 0) {
    return 0;
  }

  if (pair.tokenA === 'WKAS') {
    return normalizedA / normalizedB;
  }
  if (pair.tokenB === 'WKAS') {
    return normalizedB / normalizedA;
  }

  const directQuote = await quoteKasValue(context, pair.tokenA, parseUnits('1', tokenA.decimals));
  return Number(formatEther(directQuote));
}

async function quoteKasValue(
  context: RuntimeContext,
  tokenKey: TokenKey,
  amountWei: bigint
): Promise<bigint> {
  if (tokenKey === 'WKAS') {
    return amountWei;
  }

  const token = context.tokens[tokenKey];
  const amounts = await quoteAmountsOut(context, [token.address, WKAS_ADDRESS], amountWei);
  if (!amounts) {
    return 0n;
  }
  return amounts[amounts.length - 1];
}

async function calculatePortfolioValueKas(
  context: RuntimeContext,
  walletAddress: string,
  includeLp = false
): Promise<bigint> {
  let total = await getNativeBalance(context, walletAddress);
  const tokenKeys: TokenKey[] = ['STRESSA', 'STRESSB', 'STRESSC'];
  for (const tokenKey of tokenKeys) {
    const balance = await getTokenBalance(context, context.tokens[tokenKey], walletAddress);
    total += await quoteKasValue(context, tokenKey, balance);
  }

  if (!includeLp) {
    return total;
  }

  for (const pair of context.pairs.values()) {
    const pairContract = new Contract(pair.pairAddress, PAIR_ABI, context.provider);
    const [balance, totalSupply] = await Promise.all([
      pairContract['balanceOf'](walletAddress),
      pairContract['totalSupply'](),
    ]);
    const lpBalance = BigInt(balance);
    const supply = BigInt(totalSupply);
    if (lpBalance === 0n || supply === 0n) {
      continue;
    }

    const reserves = await readPairReserves(context, pair);
    total += (await quoteKasValue(context, pair.tokenA, (reserves.reserveA * lpBalance) / supply));
    total += (await quoteKasValue(context, pair.tokenB, (reserves.reserveB * lpBalance) / supply));
  }

  return total;
}

async function setup(context: RuntimeContext): Promise<{ startPrices: Record<PairKey, number> }> {
  console.log('Setup phase: deploying tokens, funding wallets, bootstrapping pools.');

  const stressTokens = {
    STRESSA: await deployStressToken(
      context,
      'STRESSA',
      'Stress Token A',
      18,
      parseUnits('10000000', 18)
    ),
    STRESSB: await deployStressToken(
      context,
      'STRESSB',
      'Stress Token B',
      18,
      parseUnits('10000000', 18)
    ),
    STRESSC: await deployStressToken(
      context,
      'STRESSC',
      'Stress Token C',
      6,
      parseUnits('10000000', 6)
    ),
  } as const;

  context.tokens.STRESSA = stressTokens.STRESSA;
  context.tokens.STRESSB = stressTokens.STRESSB;
  context.tokens.STRESSC = stressTokens.STRESSC;

  const walletFunding = [
    ['STRESSA', parseUnits('150000', 18)],
    ['STRESSB', parseUnits('150000', 18)],
    ['STRESSC', parseUnits('250000', 6)],
  ] as const;

  for (const wallet of context.stressWallets) {
    await sendNative(context, context.deployer, 'Deployer', wallet.address, parseEther('500'), 'setup');
    for (const [tokenKey, amount] of walletFunding) {
      await transferToken(
        context,
        context.deployer,
        'Deployer',
        context.tokens[tokenKey],
        wallet.address,
        amount,
        'setup'
      );
    }
  }

  await transferToken(
    context,
    context.deployer,
    'Deployer',
    context.tokens.STRESSA,
    AGENT_VAULT_ADDRESS,
    parseUnits('15000', 18),
    'setup'
  );
  await transferToken(
    context,
    context.deployer,
    'Deployer',
    context.tokens.STRESSB,
    AGENT_VAULT_ADDRESS,
    parseUnits('15000', 18),
    'setup'
  );
  context.vaultState.seeded = true;

  const pairConfigs: PairConfig[] = [];
  pairConfigs.push(
    await bootstrapPair(
      context,
      'STRESSA/WKAS',
      'STRESSA',
      'WKAS',
      parseUnits('100000', 18),
      parseEther('1000'),
      'addLiquidityETH'
    )
  );
  pairConfigs.push(
    await bootstrapPair(
      context,
      'STRESSB/WKAS',
      'STRESSB',
      'WKAS',
      parseUnits('50000', 18),
      parseEther('500'),
      'addLiquidityETH'
    )
  );
  pairConfigs.push(
    await bootstrapPair(
      context,
      'STRESSC/WKAS',
      'STRESSC',
      'WKAS',
      parseUnits('200000', 6),
      parseEther('200'),
      'addLiquidityETH'
    )
  );
  pairConfigs.push(
    await bootstrapPair(
      context,
      'STRESSA/STRESSB',
      'STRESSA',
      'STRESSB',
      parseUnits('50000', 18),
      parseUnits('50000', 18),
      'addLiquidity'
    )
  );

  for (const pair of pairConfigs) {
    context.pairs.set(pair.key, pair);
  }

  const startPrices = {
    'STRESSA/WKAS': await getPairPriceInKas(context, 'STRESSA/WKAS'),
    'STRESSB/WKAS': await getPairPriceInKas(context, 'STRESSB/WKAS'),
    'STRESSC/WKAS': await getPairPriceInKas(context, 'STRESSC/WKAS'),
    'STRESSA/STRESSB': await getPairPriceInKas(context, 'STRESSA/STRESSB'),
  } satisfies Record<PairKey, number>;

  for (const wallet of context.stressWallets) {
    const includeLp = wallet.role === 'LP Manager';
    const stats = getWalletStats(context, wallet);
    stats.startingValueKasWei = await calculatePortfolioValueKas(context, wallet.address, includeLp);
  }

  await snapshotVault(context, 'setup complete');
  await persistResults(context);

  return { startPrices };
}

async function performBuyWithNative(
  context: RuntimeContext,
  wallet: StressWallet,
  tokenKey: StressTokenKey,
  amountInWei: bigint,
  action: string,
  slippageBps: number
): Promise<{ success: boolean; amountOutWei: bigint; expectedOutWei: bigint; txHash?: string }> {
  const token = context.tokens[tokenKey];
  const beforeToken = await getTokenBalance(context, token, wallet.address);
  const pairAddress = await getDirectPairAddress(context, WKAS_ADDRESS, token.address);
  if (pairAddress === ZeroAddress) {
    pushError(context, `${wallet.role} missing pair for WKAS/${token.symbol}`);
    return { success: false, amountOutWei: 0n, expectedOutWei: 0n };
  }
  const quote = await quoteAmountsOut(context, [WKAS_ADDRESS, token.address], amountInWei);
  if (!quote) {
    pushError(context, `${wallet.role} failed to quote buy ${token.symbol}`);
    return { success: false, amountOutWei: 0n, expectedOutWei: 0n };
  }

  const expectedOutWei = quote[quote.length - 1];
  let txHash: string | undefined;
  let gasCostWei = 0n;
  try {
    const wrapResult = await wrapNative(context, wallet.signer, wallet.role, amountInWei, 'trading');
    const swapResult = await directSwap(
      context,
      wallet.signer,
      pairAddress,
      WKAS_ADDRESS,
      amountInWei,
      wallet.role,
      'trading',
      wallet.address
    );
    txHash = swapResult.txHash;
    gasCostWei = wrapResult.gasCostWei + swapResult.gasCostWei;
  } catch (error) {
    const stats = getWalletStats(context, wallet);
    stats.failedTrades += 1;
    recordTrade(context, {
      timestamp: nowIso(),
      actor: wallet.role,
      action,
      success: false,
      pair: `${token.symbol}/WKAS`,
      direction: 'buy',
      amountInWei: amountInWei.toString(),
      amountInSymbol: 'iKAS',
      amountOutSymbol: token.symbol,
      expectedOutWei: expectedOutWei.toString(),
      txHash,
      error: shortError(error),
    });
    return { success: false, amountOutWei: 0n, expectedOutWei, txHash };
  }

  const afterToken = await getTokenBalance(context, token, wallet.address);
  const actualOutWei = afterToken - beforeToken;
  const stats = getWalletStats(context, wallet);
  stats.trades += 1;
  stats.successfulTrades += 1;
  stats.volumeKasWei += amountInWei;
  stats.gasSpentWei += gasCostWei;
  const slippage = expectedOutWei === 0n
    ? 0
    : Number(((expectedOutWei - actualOutWei) * 10_000n) / expectedOutWei);
  stats.slippagesBps.push(Math.max(slippage, 0));

  recordTrade(context, {
    timestamp: nowIso(),
    actor: wallet.role,
    action,
    success: true,
    pair: `${token.symbol}/WKAS`,
    direction: 'buy',
    amountInWei: amountInWei.toString(),
    amountOutWei: actualOutWei.toString(),
    amountInSymbol: 'iKAS',
    amountOutSymbol: token.symbol,
    expectedOutWei: expectedOutWei.toString(),
    slippageBps: Math.max(slippage, 0),
    txHash,
  });

  return { success: true, amountOutWei: actualOutWei, expectedOutWei, txHash };
}

async function performSellForNative(
  context: RuntimeContext,
  wallet: StressWallet,
  tokenKey: StressTokenKey,
  amountInWei: bigint,
  action: string,
  slippageBps: number
): Promise<{ success: boolean; amountOutWei: bigint; expectedOutWei: bigint; txHash?: string }> {
  const token = context.tokens[tokenKey];
  const beforeNative = await getNativeBalance(context, wallet.address);
  const beforeToken = await getTokenBalance(context, token, wallet.address);
  const beforeWkas = await getTokenBalance(context, context.tokens.WKAS, wallet.address);
  const pairAddress = await getDirectPairAddress(context, token.address, WKAS_ADDRESS);
  if (pairAddress === ZeroAddress) {
    pushError(context, `${wallet.role} missing pair for ${token.symbol}/WKAS`);
    return { success: false, amountOutWei: 0n, expectedOutWei: 0n };
  }
  const quote = await quoteAmountsOut(context, [token.address, WKAS_ADDRESS], amountInWei);
  if (!quote) {
    pushError(context, `${wallet.role} failed to quote sell ${token.symbol}`);
    return { success: false, amountOutWei: 0n, expectedOutWei: 0n };
  }

  const expectedOutWei = quote[quote.length - 1];
  let txHash: string | undefined;
  let gasCost = 0n;
  try {
    const swapResult = await directSwap(
      context,
      wallet.signer,
      pairAddress,
      token.address,
      amountInWei,
      wallet.role,
      'trading',
      wallet.address
    );
    const afterWkas = await getTokenBalance(context, context.tokens.WKAS, wallet.address);
    const wkasReceived = afterWkas - beforeWkas;
    const unwrapResult = await unwrapWkas(context, wallet.signer, wallet.role, wkasReceived, 'trading');
    txHash = unwrapResult.hash ?? swapResult.txHash;
    gasCost = swapResult.gasCostWei + unwrapResult.gasCostWei;
  } catch (error) {
    const stats = getWalletStats(context, wallet);
    stats.failedTrades += 1;
    recordTrade(context, {
      timestamp: nowIso(),
      actor: wallet.role,
      action,
      success: false,
      pair: `${token.symbol}/WKAS`,
      direction: 'sell',
      amountInWei: amountInWei.toString(),
      amountInSymbol: token.symbol,
      amountOutSymbol: 'iKAS',
      expectedOutWei: expectedOutWei.toString(),
      txHash,
      error: shortError(error),
    });
    return { success: false, amountOutWei: 0n, expectedOutWei, txHash };
  }

  const afterNative = await getNativeBalance(context, wallet.address);
  const afterToken = await getTokenBalance(context, token, wallet.address);
  const actualOutWei = afterNative - beforeNative + gasCost;
  const actualInWei = beforeToken - afterToken;
  const stats = getWalletStats(context, wallet);
  stats.trades += 1;
  stats.successfulTrades += 1;
  stats.volumeKasWei += actualOutWei;
  stats.gasSpentWei += gasCost;
  const slippage = expectedOutWei === 0n
    ? 0
    : Number(((expectedOutWei - actualOutWei) * 10_000n) / expectedOutWei);
  stats.slippagesBps.push(Math.max(slippage, 0));

  recordTrade(context, {
    timestamp: nowIso(),
    actor: wallet.role,
    action,
    success: true,
    pair: `${token.symbol}/WKAS`,
    direction: 'sell',
    amountInWei: actualInWei.toString(),
    amountOutWei: actualOutWei.toString(),
    amountInSymbol: token.symbol,
    amountOutSymbol: 'iKAS',
    expectedOutWei: expectedOutWei.toString(),
    slippageBps: Math.max(slippage, 0),
    txHash,
  });

  return { success: true, amountOutWei: actualOutWei, expectedOutWei, txHash };
}

async function performTokenToTokenSwap(
  context: RuntimeContext,
  wallet: StressWallet,
  tokenInKey: StressTokenKey,
  tokenOutKey: StressTokenKey,
  amountInWei: bigint,
  action: string,
  slippageBps: number
): Promise<{ success: boolean; amountOutWei: bigint; expectedOutWei: bigint }> {
  const tokenIn = context.tokens[tokenInKey];
  const tokenOut = context.tokens[tokenOutKey];
  const beforeOut = await getTokenBalance(context, tokenOut, wallet.address);
  const pairInAddress = await getDirectPairAddress(context, tokenIn.address, WKAS_ADDRESS);
  const pairOutAddress = await getDirectPairAddress(context, WKAS_ADDRESS, tokenOut.address);
  if (pairInAddress === ZeroAddress || pairOutAddress === ZeroAddress) {
    pushError(context, `${wallet.role} missing path for ${tokenIn.symbol}->WKAS->${tokenOut.symbol}`);
    return { success: false, amountOutWei: 0n, expectedOutWei: 0n };
  }
  const quote = await quoteAmountsOut(context, [tokenIn.address, WKAS_ADDRESS, tokenOut.address], amountInWei);
  if (!quote) {
    pushError(context, `${wallet.role} failed to quote token swap ${tokenIn.symbol}->${tokenOut.symbol}`);
    return { success: false, amountOutWei: 0n, expectedOutWei: 0n };
  }

  const expectedOutWei = quote[quote.length - 1];
  let txHash: string | undefined;
  let gasCostWei = 0n;
  try {
    const firstHop = await directSwap(
      context,
      wallet.signer,
      pairInAddress,
      tokenIn.address,
      amountInWei,
      wallet.role,
      'trading',
      pairOutAddress
    );
    const secondHop = await directSwap(
      context,
      wallet.signer,
      pairOutAddress,
      WKAS_ADDRESS,
      firstHop.amountOutWei,
      wallet.role,
      'trading',
      wallet.address,
      false
    );
    txHash = secondHop.txHash;
    gasCostWei = firstHop.gasCostWei + secondHop.gasCostWei;
  } catch (error) {
    const stats = getWalletStats(context, wallet);
    stats.failedTrades += 1;
    recordTrade(context, {
      timestamp: nowIso(),
      actor: wallet.role,
      action,
      success: false,
      pair: `${tokenIn.symbol}/WKAS/${tokenOut.symbol}`,
      direction: `${tokenIn.symbol}->${tokenOut.symbol}`,
      amountInWei: amountInWei.toString(),
      amountInSymbol: tokenIn.symbol,
      amountOutSymbol: tokenOut.symbol,
      expectedOutWei: expectedOutWei.toString(),
      txHash,
      error: shortError(error),
    });
    return { success: false, amountOutWei: 0n, expectedOutWei };
  }

  const afterOut = await getTokenBalance(context, tokenOut, wallet.address);
  const actualOutWei = afterOut - beforeOut;
  const stats = getWalletStats(context, wallet);
  stats.trades += 1;
  stats.successfulTrades += 1;
  stats.volumeKasWei += await quoteKasValue(context, tokenInKey, amountInWei);
  stats.gasSpentWei += gasCostWei;
  const slippage = expectedOutWei === 0n
    ? 0
    : Number(((expectedOutWei - actualOutWei) * 10_000n) / expectedOutWei);
  stats.slippagesBps.push(Math.max(slippage, 0));

  recordTrade(context, {
    timestamp: nowIso(),
    actor: wallet.role,
    action,
    success: true,
    pair: `${tokenIn.symbol}/WKAS/${tokenOut.symbol}`,
    direction: `${tokenIn.symbol}->${tokenOut.symbol}`,
    amountInWei: amountInWei.toString(),
    amountOutWei: actualOutWei.toString(),
    amountInSymbol: tokenIn.symbol,
    amountOutSymbol: tokenOut.symbol,
    expectedOutWei: expectedOutWei.toString(),
    slippageBps: Math.max(slippage, 0),
    txHash,
  });

  return { success: true, amountOutWei: actualOutWei, expectedOutWei };
}

async function marketMakerCycle(context: RuntimeContext, wallet: StressWallet): Promise<void> {
  const nativeBalance = await getNativeBalance(context, wallet.address);
  const tokenBalance = await getTokenBalance(context, context.tokens.STRESSA, wallet.address);
  if (context.marketMakerState.lastBoughtAmountWei === 0n || tokenBalance === 0n || nativeBalance < parseEther('10')) {
    const amountInWei = clampKasTradeSize(parseEther(randomBetween(wallet.rng, 5, 20).toFixed(6)));
    const result = await performBuyWithNative(context, wallet, 'STRESSA', amountInWei, 'market-maker buy STRESSA', 250);
    if (result.success) {
      context.marketMakerState.lastBoughtAmountWei = result.amountOutWei;
    }
    return;
  }

  const sellAmount = context.marketMakerState.lastBoughtAmountWei / 2n || tokenBalance / 2n;
  if (sellAmount > 0n) {
    const result = await performSellForNative(context, wallet, 'STRESSA', sellAmount, 'market-maker sell STRESSA', 300);
    if (result.success) {
      context.marketMakerState.lastBoughtAmountWei = 0n;
    }
  }
}

async function arbitrageCycle(context: RuntimeContext, wallet: StressWallet): Promise<void> {
  const stats = getWalletStats(context, wallet);
  const [priceA, priceB] = await Promise.all([
    getPairPriceInKas(context, 'STRESSA/WKAS'),
    getPairPriceInKas(context, 'STRESSB/WKAS'),
  ]);
  if (priceA === 0 || priceB === 0) {
    return;
  }

  const deviation = Math.abs(priceA - priceB) / Math.min(priceA, priceB);
  if (deviation < 0.03) {
    return;
  }

  const fromToken = priceA > priceB ? 'STRESSA' : 'STRESSB';
  const toToken = fromToken === 'STRESSA' ? 'STRESSB' : 'STRESSA';
  const tokenBalance = await getTokenBalance(context, context.tokens[fromToken], wallet.address);
  const amountInWei = tokenBalance / 12n;
  if (amountInWei === 0n) {
    return;
  }

  stats.arbAttempts += 1;
  const beforeValue = await calculatePortfolioValueKas(context, wallet.address);
  const result = await performTokenToTokenSwap(
    context,
    wallet,
    fromToken,
    toToken,
    amountInWei,
    `arb ${fromToken}->WKAS->${toToken}`,
    350
  );
  if (!result.success) {
    return;
  }

  const afterValue = await calculatePortfolioValueKas(context, wallet.address);
  const delta = afterValue - beforeValue;
  stats.arbNetKasWei += delta;
  if (delta > 0n) {
    stats.profitableArbs += 1;
  }
}

async function whaleCycle(context: RuntimeContext, wallet: StressWallet): Promise<void> {
  const targetToken = context.whaleState.step % 2 === 0 ? 'STRESSA' : 'STRESSB';
  const tokenBalance = await getTokenBalance(context, context.tokens[targetToken], wallet.address);
  if (context.whaleState.step % 3 === 2 && tokenBalance > 0n) {
    await performSellForNative(
      context,
      wallet,
      targetToken,
      tokenBalance / 2n,
      `whale sell ${targetToken}`,
      450
    );
  } else {
    const amountInWei = clampKasTradeSize(parseEther(randomBetween(wallet.rng, 50, 100).toFixed(6)));
    await performBuyWithNative(context, wallet, targetToken, amountInWei, `whale buy ${targetToken}`, 450);
  }
  context.whaleState.step += 1;
}

async function retailCycle(context: RuntimeContext, wallet: StressWallet): Promise<void> {
  const tokens: StressTokenKey[] = ['STRESSA', 'STRESSB', 'STRESSC'];
  const tokenKey = tokens[Math.floor(wallet.rng() * tokens.length)] ?? 'STRESSA';
  const direction = wallet.rng() > 0.45 ? 'buy' : 'sell';
  if (direction === 'buy') {
    const amountInWei = parseEther(randomBetween(wallet.rng, 1, 5).toFixed(6));
    await performBuyWithNative(context, wallet, tokenKey, amountInWei, `retail buy ${tokenKey}`, 350);
    return;
  }

  const balance = await getTokenBalance(context, context.tokens[tokenKey], wallet.address);
  if (balance === 0n) {
    return;
  }
  await performSellForNative(
    context,
    wallet,
    tokenKey,
    balance / 10n,
    `retail sell ${tokenKey}`,
    350
  );
}

async function addLiquidityCycle(
  context: RuntimeContext,
  wallet: StressWallet,
  pairKey: PairKey
): Promise<void> {
  const pair = context.pairs.get(pairKey);
  if (!pair) {
    return;
  }

  const tokenA = context.tokens[pair.tokenA];
  const tokenB = context.tokens[pair.tokenB];
  const pairAddress = pair.pairAddress;
  const pairContract = new Contract(pairAddress, PAIR_ABI, context.provider);
  const lpBalance = BigInt(await pairContract['balanceOf'](wallet.address));

  if (lpBalance > 0n && context.lpState.has(pairKey)) {
    const position = context.lpState.get(pairKey)!;
    if (Date.now() - position.enteredAt < 60_000) {
      return;
    }

    if (pair.tokenB === 'WKAS') {
      const beforeToken = await getTokenBalance(context, tokenA, wallet.address);
      const beforeNative = await getNativeBalance(context, wallet.address);
      const beforeWkas = await getTokenBalance(context, context.tokens.WKAS, wallet.address);
      let txHash: string | undefined;
      let gasCost = 0n;
      try {
        const removeResult = await directRemoveLiquidity(
          context,
          wallet.signer,
          pair,
          lpBalance,
          wallet.role,
          'trading'
        );
        const afterWkas = await getTokenBalance(context, context.tokens.WKAS, wallet.address);
        const wkasReturned = afterWkas - beforeWkas;
        const unwrapResult = await unwrapWkas(context, wallet.signer, wallet.role, wkasReturned, 'trading');
        txHash = unwrapResult.hash ?? removeResult.hash;
        gasCost = removeResult.gasCostWei + unwrapResult.gasCostWei;
      } catch {
        getWalletStats(context, wallet).failedTrades += 1;
        return;
      }

      const afterToken = await getTokenBalance(context, tokenA, wallet.address);
      const afterNative = await getNativeBalance(context, wallet.address);
      const returnedToken = afterToken - beforeToken;
      const returnedNative = afterNative - beforeNative + gasCost;
      const currentHoldValue =
        (await quoteKasValue(context, pair.tokenA, position.tokenAAmountWei)) + position.tokenBAmountWei;
      const lpValue =
        (await quoteKasValue(context, pair.tokenA, returnedToken)) + returnedNative;
      const ilBps = currentHoldValue === 0n
        ? 0
        : Number(((lpValue - currentHoldValue) * 10_000n) / currentHoldValue);
      const stats = getWalletStats(context, wallet);
      stats.trades += 1;
      stats.successfulTrades += 1;
      stats.lpCycles += 1;
      stats.gasSpentWei += gasCost;
      stats.impermanentLossesBps.push(ilBps);
      context.lpState.delete(pairKey);
      recordTrade(context, {
        timestamp: nowIso(),
        actor: wallet.role,
        action: `lp remove ${pairKey}`,
        success: true,
        pair: pairKey,
        direction: 'remove-liquidity',
        amountOutWei: returnedNative.toString(),
        amountOutSymbol: 'iKAS',
        txHash,
      });
      return;
    }

    const beforeA = await getTokenBalance(context, tokenA, wallet.address);
    const beforeB = await getTokenBalance(context, tokenB, wallet.address);
    let txHash: string | undefined;
    let gasCostWei = 0n;
    try {
      const removeResult = await directRemoveLiquidity(
        context,
        wallet.signer,
        pair,
        lpBalance,
        wallet.role,
        'trading'
      );
      txHash = removeResult.hash;
      gasCostWei = removeResult.gasCostWei;
    } catch {
      getWalletStats(context, wallet).failedTrades += 1;
      return;
    }

    const afterA = await getTokenBalance(context, tokenA, wallet.address);
    const afterB = await getTokenBalance(context, tokenB, wallet.address);
    const returnedA = afterA - beforeA;
    const returnedB = afterB - beforeB;
    const currentHoldValue =
      (await quoteKasValue(context, pair.tokenA, position.tokenAAmountWei)) +
      (await quoteKasValue(context, pair.tokenB, position.tokenBAmountWei));
    const lpValue =
      (await quoteKasValue(context, pair.tokenA, returnedA)) +
      (await quoteKasValue(context, pair.tokenB, returnedB));
    const ilBps = currentHoldValue === 0n
      ? 0
      : Number(((lpValue - currentHoldValue) * 10_000n) / currentHoldValue);
    const stats = getWalletStats(context, wallet);
    stats.trades += 1;
    stats.successfulTrades += 1;
    stats.lpCycles += 1;
    stats.gasSpentWei += gasCostWei;
    stats.impermanentLossesBps.push(ilBps);
    context.lpState.delete(pairKey);
    recordTrade(context, {
      timestamp: nowIso(),
      actor: wallet.role,
      action: `lp remove ${pairKey}`,
      success: true,
      pair: pairKey,
      direction: 'remove-liquidity',
      txHash,
    });
    return;
  }

  if (pair.tokenB === 'WKAS') {
    const tokenAmount = pair.tokenA === 'STRESSC'
      ? parseUnits(randomBetween(wallet.rng, 1_000, 5_000).toFixed(2), tokenA.decimals)
      : parseUnits(randomBetween(wallet.rng, 500, 2_500).toFixed(6), tokenA.decimals);
    const nativeAmount = parseEther(randomBetween(wallet.rng, 5, 25).toFixed(6));
    let txHash: string | undefined;
    let gasCostWei = 0n;
    try {
      const wrapResult = await wrapNative(context, wallet.signer, wallet.role, nativeAmount, 'trading');
      const addResult = await directAddLiquidity(
        context,
        wallet.signer,
        pair,
        tokenA,
        tokenAmount,
        tokenB,
        nativeAmount,
        wallet.role,
        'trading'
      );
      txHash = addResult.hash ?? wrapResult.hash;
      gasCostWei = wrapResult.gasCostWei + addResult.gasCostWei;
    } catch {
      getWalletStats(context, wallet).failedTrades += 1;
      return;
    }

    const stats = getWalletStats(context, wallet);
    stats.trades += 1;
    stats.successfulTrades += 1;
    stats.gasSpentWei += gasCostWei;
    context.lpState.set(pairKey, {
      pairKey,
      tokenAAmountWei: tokenAmount,
      tokenBAmountWei: nativeAmount,
      enteredAt: Date.now(),
      referenceValueKasWei: (await quoteKasValue(context, pair.tokenA, tokenAmount)) + nativeAmount,
    });
    recordTrade(context, {
      timestamp: nowIso(),
      actor: wallet.role,
      action: `lp add ${pairKey}`,
      success: true,
      pair: pairKey,
      direction: 'add-liquidity',
      txHash,
    });
    return;
  }

  const amountA = parseUnits(randomBetween(wallet.rng, 1_000, 4_000).toFixed(6), tokenA.decimals);
  const amountB = parseUnits(randomBetween(wallet.rng, 1_000, 4_000).toFixed(6), tokenB.decimals);
  let txHash: string | undefined;
  let gasCostWei = 0n;
  try {
    const addResult = await directAddLiquidity(
      context,
      wallet.signer,
      pair,
      tokenA,
      amountA,
      tokenB,
      amountB,
      wallet.role,
      'trading'
    );
    txHash = addResult.hash;
    gasCostWei = addResult.gasCostWei;
  } catch {
    getWalletStats(context, wallet).failedTrades += 1;
    return;
  }

  const stats = getWalletStats(context, wallet);
  stats.trades += 1;
  stats.successfulTrades += 1;
  stats.gasSpentWei += gasCostWei;
  context.lpState.set(pairKey, {
    pairKey,
    tokenAAmountWei: amountA,
    tokenBAmountWei: amountB,
    enteredAt: Date.now(),
    referenceValueKasWei:
      (await quoteKasValue(context, pair.tokenA, amountA)) +
      (await quoteKasValue(context, pair.tokenB, amountB)),
  });
  recordTrade(context, {
    timestamp: nowIso(),
    actor: wallet.role,
    action: `lp add ${pairKey}`,
    success: true,
    pair: pairKey,
    direction: 'add-liquidity',
    txHash,
  });
}

async function lpManagerCycle(context: RuntimeContext, wallet: StressWallet): Promise<void> {
  const pairOrder: PairKey[] = ['STRESSA/WKAS', 'STRESSB/WKAS', 'STRESSC/WKAS', 'STRESSA/STRESSB'];
  const pairKey = pairOrder[context.lpPairCursor % pairOrder.length] ?? 'STRESSA/WKAS';
  await addLiquidityCycle(context, wallet, pairKey);
  context.lpPairCursor += 1;
}

async function runWalletLoop(
  context: RuntimeContext,
  wallet: StressWallet,
  cycle: (context: RuntimeContext, wallet: StressWallet) => Promise<void>,
  minDelayMs: number,
  maxDelayMs: number
): Promise<void> {
  while (Date.now() < context.endAt) {
    try {
      await cycle(context, wallet);
    } catch (error) {
      pushError(context, `${wallet.role}: ${shortError(error)}`);
      getWalletStats(context, wallet).notes.push(shortError(error));
    }

    await persistResults(context);
    const waitMs = Math.trunc(randomBetween(wallet.rng, minDelayMs, maxDelayMs));
    await delay(waitMs);
  }
}

async function snapshotVault(context: RuntimeContext, note?: string): Promise<void> {
  const tokenBalances = Object.fromEntries(
    await Promise.all(
      (['STRESSA', 'STRESSB', 'STRESSC'] as const).map(async (key) => [
        key,
        (await getTokenBalance(context, context.tokens[key], AGENT_VAULT_ADDRESS)).toString(),
      ])
    )
  );

  const lpBalances = Object.fromEntries(
    await Promise.all(
      Array.from(context.pairs.entries()).map(async ([pairKey, pair]) => {
        const pairContract = new Contract(pair.pairAddress, PAIR_ABI, context.provider);
        return [pairKey, (BigInt(await pairContract['balanceOf'](AGENT_VAULT_ADDRESS))).toString()];
      })
    )
  );

  const nativeBalance = await getNativeBalance(context, AGENT_VAULT_ADDRESS);
  let remainingDailyVolumeWei: bigint | undefined;
  try {
    remainingDailyVolumeWei = BigInt(await context.vault['getRemainingDailyVolume']());
  } catch (error) {
    pushError(context, `Vault getRemainingDailyVolume failed: ${shortError(error)}`);
  }

  context.vaultSnapshots.push({
    timestamp: nowIso(),
    nativeBalanceWei: nativeBalance.toString(),
    remainingDailyVolumeWei: remainingDailyVolumeWei?.toString(),
    tokenBalances,
    lpBalances,
    note,
  });
}

async function vaultCycle(context: RuntimeContext): Promise<void> {
  while (Date.now() < context.endAt) {
    try {
      await snapshotVault(context);
      const nativeBalance = await getNativeBalance(context, AGENT_VAULT_ADDRESS);
      const remainingDailyVolumeWei = BigInt(await context.vault['getRemainingDailyVolume']());
      const stressABPair = context.pairs.get('STRESSA/STRESSB');
      if (!stressABPair) {
        await delay(60_000);
        continue;
      }

      const pairContract = new Contract(stressABPair.pairAddress, PAIR_ABI, context.provider);
      const vaultLpBalance = BigInt(await pairContract['balanceOf'](AGENT_VAULT_ADDRESS));
      const tokenABalance = await getTokenBalance(context, context.tokens.STRESSA, AGENT_VAULT_ADDRESS);
      const tokenBBalance = await getTokenBalance(context, context.tokens.STRESSB, AGENT_VAULT_ADDRESS);

      if (nativeBalance > 0n && context.vaultState.notes.length === 0) {
        const note = 'Vault holds native iKAS, but the available local ABI exposes only token-token liquidity functions. Native deployment is skipped rather than forcing an unsafe wrapper path.';
        context.vaultState.notes.push(note);
        pushError(context, note);
      }

      if (
        (vaultLpBalance === 0n && tokenABalance > parseUnits('1000', 18) && tokenBBalance > parseUnits('1000', 18)) ||
        vaultLpBalance > 0n
      ) {
        const note =
          remainingDailyVolumeWei < parseEther('25')
            ? 'Vault liquidity cycle skipped: remaining daily volume too low'
            : 'Vault liquidity cycle skipped: AgentVault exposes only router-backed liquidity methods, so direct pair mint/burn is not safely callable from this script';
        if (!context.vaultState.notes.includes(note)) {
          context.vaultState.notes.push(note);
        }
      }
    } catch (error) {
      pushError(context, `Vault loop: ${shortError(error)}`);
    }

    await persistResults(context);
    await delay(60_000);
  }

  await snapshotVault(context, 'final');
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function minMax(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

async function finalizeWalletStats(context: RuntimeContext): Promise<void> {
  for (const wallet of context.stressWallets) {
    const stats = getWalletStats(context, wallet);
    stats.endingValueKasWei = await calculatePortfolioValueKas(
      context,
      wallet.address,
      wallet.role === 'LP Manager'
    );
  }
}

async function buildReport(
  context: RuntimeContext,
  startPrices: Record<PairKey, number>
): Promise<string> {
  await finalizeWalletStats(context);
  const durationMs = Date.now() - context.startedAt;
  const endPrices = {
    'STRESSA/WKAS': await getPairPriceInKas(context, 'STRESSA/WKAS'),
    'STRESSB/WKAS': await getPairPriceInKas(context, 'STRESSB/WKAS'),
    'STRESSC/WKAS': await getPairPriceInKas(context, 'STRESSC/WKAS'),
    'STRESSA/STRESSB': await getPairPriceInKas(context, 'STRESSA/STRESSB'),
  } satisfies Record<PairKey, number>;

  const totalTrades = Array.from(context.walletStats.values()).reduce((sum, stats) => sum + stats.trades, 0);
  const totalGasSpentWei = Array.from(context.walletStats.values()).reduce((sum, stats) => sum + stats.gasSpentWei, 0n);
  const latestVault = context.vaultSnapshots[context.vaultSnapshots.length - 1];
  const firstVault = context.vaultSnapshots[0];
  const deployedTokenLines = (['STRESSA', 'STRESSB', 'STRESSC'] as const).map((key) => {
    const token = context.tokens[key];
    return `  ${token.symbol}: ${token.address} (tx: ${token.deployedTxHash ?? 'n/a'})`;
  });
  const pairLines = Array.from(context.pairs.values()).map(
    (pair) => `  ${pair.key}: ${pair.pairAddress} (tx: ${pair.createdTxHash})`
  );

  const walletLines = context.stressWallets.flatMap((wallet) => {
    const stats = getWalletStats(context, wallet);
    const pnlWei = stats.endingValueKasWei - stats.startingValueKasWei;
    const lines: string[] = [];
    if (wallet.role === 'Market Maker') {
      lines.push(
        `  Wallet ${wallet.index} (${wallet.role}):`,
        `    Trades: ${stats.trades} | Volume: ${formatKas(stats.volumeKasWei)} iKAS | P&L: ${formatKas(pnlWei)} iKAS`
      );
      return lines;
    }
    if (wallet.role === 'Arbitrageur') {
      lines.push(
        `  Wallet ${wallet.index} (${wallet.role}):`,
        `    Trades: ${stats.trades} | Arb attempts: ${stats.arbAttempts} | Profitable: ${stats.profitableArbs} | Net: ${formatKas(stats.arbNetKasWei)} iKAS`
      );
      return lines;
    }
    if (wallet.role === 'Whale') {
      lines.push(
        `  Wallet ${wallet.index} (${wallet.role}):`,
        `    Trades: ${stats.trades} | Volume: ${formatKas(stats.volumeKasWei)} iKAS | Max slippage: ${formatPct(minMax(stats.slippagesBps).max / 100)}`
      );
      return lines;
    }
    if (wallet.role === 'Retail Trader') {
      lines.push(
        `  Wallet ${wallet.index} (${wallet.role}):`,
        `    Trades: ${stats.trades} | Volume: ${formatKas(stats.volumeKasWei)} iKAS | Avg slippage: ${formatPct(average(stats.slippagesBps) / 100)}`
      );
      return lines;
    }

    const il = minMax(stats.impermanentLossesBps);
    lines.push(
      `  Wallet ${wallet.index} (${wallet.role}):`,
      `    LP cycles: ${stats.lpCycles} | IL range: ${formatPct(il.min / 100)} to ${formatPct(il.max / 100)}`
    );
    return lines;
  });

  const priceLines = (['STRESSA/WKAS', 'STRESSB/WKAS', 'STRESSC/WKAS'] as const).map((key) => {
    const start = startPrices[key];
    const end = endPrices[key];
    const changePct = start === 0 ? 0 : ((end - start) / start) * 100;
    return `  ${key}: start ${start.toFixed(6)} -> end ${end.toFixed(6)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
  });

  return [
    '═══════════════════════════════════════════',
    '    DEX STRESS TEST REPORT — IGRA Galleon',
    '═══════════════════════════════════════════',
    `Duration: ${(durationMs / 60_000).toFixed(2)}m`,
    `Network: Galleon Testnet (${CHAIN_ID})`,
    '',
    'DEPLOYED TOKENS:',
    ...deployedTokenLines,
    '',
    'PAIRS CREATED:',
    ...pairLines,
    '',
    'TRADING SUMMARY:',
    `  Total trades: ${totalTrades}`,
    `  Total gas spent: ${formatKas(totalGasSpentWei)} iKAS`,
    '',
    ...walletLines,
    '',
    'PRICE MOVEMENTS:',
    ...priceLines,
    '',
    'VAULT STATUS:',
    `  Starting balance: ${firstVault ? formatKas(BigInt(firstVault.nativeBalanceWei)) : '0'} iKAS`,
    `  Ending balance: ${latestVault ? formatKas(BigInt(latestVault.nativeBalanceWei)) : '0'} iKAS`,
    `  LP positions: ${latestVault ? JSON.stringify(latestVault.lpBalances) : '{}'}`,
    context.vaultState.notes.length > 0 ? `  Notes: ${context.vaultState.notes.join(' | ')}` : '  Notes: none',
    '',
    `ALL TRANSACTIONS: ${context.resultsFile}`,
  ].join('\n');
}

function buildContext(): RuntimeContext {
  const provider = makeProvider();
  const basePrivateKey = getPrivateKey();
  const deployerWallet = new Wallet(basePrivateKey, provider);
  const deployer = new NonceManager(deployerWallet);
  const deployerAddress = deployerWallet.address;
  const { resultsFile, reportFile } = getResultPaths();
  const derivedWallets = [
    { index: 1, role: 'Market Maker' as const, wallet: deterministicWallet(basePrivateKey, 1, provider) },
    { index: 2, role: 'Arbitrageur' as const, wallet: deterministicWallet(basePrivateKey, 2, provider) },
    { index: 3, role: 'Whale' as const, wallet: deterministicWallet(basePrivateKey, 3, provider) },
    { index: 4, role: 'Retail Trader' as const, wallet: deterministicWallet(basePrivateKey, 4, provider) },
    { index: 5, role: 'LP Manager' as const, wallet: deterministicWallet(basePrivateKey, 5, provider) },
  ];
  const stressWallets: StressWallet[] = derivedWallets.map((entry) => ({
    index: entry.index,
    role: entry.role,
    signer: new NonceManager(entry.wallet),
    address: entry.wallet.address,
    rng: () => 0,
  }));

  for (const wallet of stressWallets) {
    wallet.rng = makeRng(Number(BigInt(keccak256(toUtf8Bytes(wallet.address))) & 0xffff_ffffn));
  }

  const walletStats = new Map<string, WalletStats>();
  for (const wallet of stressWallets) {
    walletStats.set(wallet.address, {
      role: wallet.role,
      address: wallet.address,
      trades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      volumeKasWei: 0n,
      gasSpentWei: 0n,
      slippagesBps: [],
      arbAttempts: 0,
      profitableArbs: 0,
      arbNetKasWei: 0n,
      lpCycles: 0,
      impermanentLossesBps: [],
      notes: [],
      startingValueKasWei: 0n,
      endingValueKasWei: 0n,
    });
  }

  return {
    provider,
    deployer,
    deployerAddress,
    router: new Contract(ROUTER_ADDRESS, ROUTER_ABI, deployer) as AnyContract,
    factory: new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider) as AnyContract,
    vault: new Contract(AGENT_VAULT_ADDRESS, VAULT_ABI, deployer) as AnyContract,
    erc20Deployer: new Contract(ERC20_DEPLOYER_ADDRESS, ERC20_DEPLOYER_ABI, deployer) as AnyContract,
    tokens: {
      WKAS: {
        key: 'WKAS',
        symbol: 'WKAS',
        name: 'Wrapped KAS',
        address: WKAS_ADDRESS,
        decimals: 18,
      },
      WBTC: {
        key: 'WBTC',
        symbol: 'WBTC',
        name: 'Wrapped BTC',
        address: '0x2429526815517B971d45B0899C3D67990A68BcD7',
        decimals: 8,
      },
      WETH: {
        key: 'WETH',
        symbol: 'WETH',
        name: 'Wrapped ETH',
        address: '0x23A8E284A6193C1D6A51A7b34d047ae0b969D660',
        decimals: 18,
      },
      DAI: {
        key: 'DAI',
        symbol: 'DAI',
        name: 'Dai Stablecoin',
        address: '0x2c680F22600A632c9291c2f1E3b070ED79c1168e',
        decimals: 18,
      },
      USDC: {
        key: 'USDC',
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0xfEE6ee271c2fD76EdAd5De7B8177C3935799111A',
        decimals: 6,
      },
      USDT: {
        key: 'USDT',
        symbol: 'USDT',
        name: 'Tether USD',
        address: '0xb522AC3161D67b6Ed2e311E0036A2F49F903bcc7',
        decimals: 6,
      },
      STRESSA: {
        key: 'STRESSA',
        symbol: 'STRESSA',
        name: 'Stress Token A',
        address: ZeroAddress,
        decimals: 18,
      },
      STRESSB: {
        key: 'STRESSB',
        symbol: 'STRESSB',
        name: 'Stress Token B',
        address: ZeroAddress,
        decimals: 18,
      },
      STRESSC: {
        key: 'STRESSC',
        symbol: 'STRESSC',
        name: 'Stress Token C',
        address: ZeroAddress,
        decimals: 6,
      },
    },
    stressWallets,
    walletStats,
    txs: [],
    trades: [],
    pairs: new Map(),
    errors: [],
    vaultSnapshots: [],
    startedAt: Date.now(),
    endAt: Date.now() + Number(process.env.DEX_STRESS_TEST_DURATION_MS ?? DEFAULT_DURATION_MS),
    resultsFile,
    reportFile,
    persistChain: Promise.resolve(),
    lpState: new Map(),
    marketMakerState: { lastBoughtAmountWei: 0n },
    whaleState: { step: 0 },
    lpPairCursor: 0,
    vaultState: { seeded: false, notes: [] },
  };
}

async function main(): Promise<void> {
  const context = buildContext();
  console.log(`Starting DEX stress test on Galleon with deployer ${context.deployerAddress}`);
  console.log(`Results file: ${context.resultsFile}`);
  console.log(`Report file: ${context.reportFile}`);

  await syncChainTime(context.provider);
  await validateContracts(context);
  const { startPrices } = await setup(context);

  console.log('Trading phase: running concurrent wallet and vault loops.');
  await Promise.all([
    runWalletLoop(context, context.stressWallets[0]!, marketMakerCycle, 5_000, 15_000),
    runWalletLoop(context, context.stressWallets[1]!, arbitrageCycle, 5_000, 15_000),
    runWalletLoop(context, context.stressWallets[2]!, whaleCycle, 7_000, 14_000),
    runWalletLoop(context, context.stressWallets[3]!, retailCycle, 2_000, 7_000),
    runWalletLoop(context, context.stressWallets[4]!, lpManagerCycle, 20_000, 45_000),
    vaultCycle(context),
  ]);

  const report = await buildReport(context, startPrices);
  console.log(report);
  await persistResults(context, report);
}

main().catch(async (error) => {
  console.error('DEX stress test failed:', error);
  try {
    const provider = makeProvider();
    const deployerWallet = new Wallet(getPrivateKey(), provider);
    const { resultsFile, reportFile } = getResultPaths();
    await saveJson(resultsFile, {
      failedAt: nowIso(),
      error: shortError(error),
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
      deployerAddress: deployerWallet.address,
      explorerUrl: EXPLORER_URL,
    });
    await writeFile(reportFile, `DEX stress test failed at ${nowIso()}\n${shortError(error)}\n`, 'utf8');
  } catch (persistError) {
    console.error('Failed to persist fatal error report:', persistError);
  }
  process.exitCode = 1;
});
