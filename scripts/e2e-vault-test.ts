import { config as dotenvConfig } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  getAddress,
  parseEther,
  parseUnits,
} from 'ethers';
import { ERC20_ABI } from '../src/plugins/kaspacom-dex/abi/erc20';
import { FACTORY_ABI } from '../src/plugins/kaspacom-dex/abi/factory';
import { PAIR_ABI } from '../src/plugins/kaspacom-dex/abi/pair';
import { ROUTER_ABI } from '../src/plugins/kaspacom-dex/abi/router';

dotenvConfig();

const RPC_URL = 'https://galleon-testnet.igralabs.com:8545';
const CHAIN_ID = 38836;
const NETWORK_NAME = 'Galleon Testnet';
const EXPLORER_URL = 'https://explorer.galleon-testnet.igralabs.com';
const DEFAULT_TRADING_DURATION_MS = 15 * 60 * 1000;
const WALLET_COUNT = 50;
const ARB_INTERVAL_MS = 5_000;
const NAV_SNAPSHOT_INTERVAL_MS = 60_000;
const MAX_IKAS_BUDGET = parseEther('5000');
const PER_WALLET_NATIVE = parseEther('50');
const PER_WALLET_WRAP = parseEther('30');
const DEFAULT_SEED_PHRASE =
  'test test test test test test test test test test test junk';
const MAX_UINT256 = (1n << 256n) - 1n;

const ADDRESSES = {
  vault: getAddress('0xa3ED9723EbCb88916b1f80c3988A13a49cd372E5'),
  router: getAddress('0x47F80b6D7071B7738D6DD9d973D7515ce753e9d9'),
  factory: getAddress('0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0'),
  wkas: getAddress('0x394C68684F9AFCEb9b804531EF07a864E8081738'),
  erc20Deployer: getAddress('0xC8E13bddDb1E0B878de0996c27F0c3738e2709eA'),
} as const;

const TOKENS = {
  ALPHA: {
    symbol: 'ALPHA',
    address: getAddress('0x266eA9bFddBBe51ee3a463eABAcaE4425C4Aeb7e'),
    decimals: 18,
    fundingAmount: parseUnits('10000', 18),
  },
  BETA: {
    symbol: 'BETA',
    address: getAddress('0x406861d140BDA7db0e70e45Fd888ba716DcA2d21'),
    decimals: 18,
    fundingAmount: parseUnits('10000', 18),
  },
  GAMMA: {
    symbol: 'GAMMA',
    address: getAddress('0xE3013b828Cf35DE8D3A60FE9B9Eaf7C58E9Da9dA'),
    decimals: 6,
    fundingAmount: parseUnits('1000000', 6),
  },
  WKAS: {
    symbol: 'WKAS',
    address: ADDRESSES.wkas,
    decimals: 18,
    fundingAmount: 0n,
  },
} as const;

const PAIRS = [
  {
    key: 'ALPHA/WKAS',
    token: TOKENS.ALPHA,
    base: TOKENS.WKAS,
    pairAddress: getAddress('0x2794A35D9c82F0490EB26Ce7D38CffB75984043A'),
    lpTargetWkas: parseEther('25'),
  },
  {
    key: 'BETA/WKAS',
    token: TOKENS.BETA,
    base: TOKENS.WKAS,
    pairAddress: getAddress('0xBAD16160d9a57031F6E443BD522525941D5ADc14'),
    lpTargetWkas: parseEther('25'),
  },
  {
    key: 'GAMMA/WKAS',
    token: TOKENS.GAMMA,
    base: TOKENS.WKAS,
    pairAddress: getAddress('0x9C7faA9f4983CA692999C7b2629cafeB2145db88'),
    lpTargetWkas: parseEther('25'),
  },
] as const;

const VAULT_ABI = [
  'function swap(uint256 amountIn, uint256 amountOutMin, address[] path, uint256 deadline) returns (uint256[])',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, uint256 deadline) returns (uint256, uint256, uint256)',
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, uint256 deadline) returns (uint256, uint256)',
  'function deposit(address token, uint256 amount)',
  'function getTokenBalance(address token) view returns (uint256)',
  'function getVaultNAV() view returns (uint256)',
  'function getRemainingDailyVolume() view returns (uint256)',
  'function owner() view returns (address)',
  'function agent() view returns (address)',
  'function maxTradeSize() view returns (uint256)',
  'function dailyVolumeLimit() view returns (uint256)',
  'function snapshotNAV()',
] as const;

const WKAS_ABI = [
  'function deposit() payable',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

const TX_OVERRIDES = {
  type: 0,
  gasPrice: 2_000_000_000_001n, // 1 wei above floor — Pavel's fix for Galleon rounding
  gasLimit: 3_000_000n,
};

const MAX_TX_RETRIES = 5;
const MEMPOOL_POLL_MS = 3000;

type TokenSymbol = keyof typeof TOKENS;
type PairKey = (typeof PAIRS)[number]['key'];
type TraderRole = 'Random Trader' | 'Trend Follower' | 'Mean Reverter' | 'Whale';

type AnyContract = Contract & Record<string, any>;

type PairConfig = (typeof PAIRS)[number];

type WalletContext = {
  index: number;
  role: TraderRole;
  wallet: Wallet;
  address: string;
  rng: () => number;
  txHashes: string[];
  trades: number;
  volumeWkasWei: bigint;
};

type PairSnapshot = {
  reserveToken: bigint;
  reserveWkas: bigint;
  priceWkasPerToken: number;
  totalSupply: bigint;
};

type VaultLpEntry = {
  pair: PairKey;
  tokenAddress: string;
  pairAddress: string;
  entryPrice: number;
  priceStart: number;
  reserveTokenStart: bigint;
  reserveWkasStart: bigint;
  vaultTokenBefore: bigint;
  vaultWkasBefore: bigint;
  vaultTokenAfter: bigint;
  vaultWkasAfter: bigint;
  actualTokenIn: bigint;
  actualWkasIn: bigint;
  lpBalance: bigint;
  entryTxHash: string;
  entryExplorerUrl: string;
};

type VaultLpExit = {
  pair: PairKey;
  lpBalance: bigint;
  exitPrice: number;
  reserveTokenEnd: bigint;
  reserveWkasEnd: bigint;
  withdrawnToken: bigint;
  withdrawnWkas: bigint;
  holdValueWkas: bigint;
  noFeeLpValueWkas: bigint;
  actualLpValueWkas: bigint;
  ilWkas: bigint;
  feesEarnedWkas: bigint;
  netWkas: bigint;
  exitTxHash: string;
  exitExplorerUrl: string;
};

type ArbTrade = {
  pair: string;
  direction: string;
  amountIn: string;
  amountOut?: string;
  profit: string;
  txHash: string;
  explorerUrl: string;
};

type AllTransaction = {
  wallet: string;
  action: string;
  pair?: string;
  amountIn?: string;
  amountOut?: string;
  txHash: string;
  explorerUrl: string;
  blockNumber: number;
  timestamp: string;
  gasUsed: string;
};

type PairMarketStats = {
  name: PairKey;
  trades: number;
  volumeWKAS: bigint;
  priceStart: number;
  priceEnd: number;
  priceChange: number;
};

type WalletReport = {
  index: number;
  role: TraderRole;
  address: string;
  trades: number;
  volume: string;
  txHashes: string[];
};

type JsonReport = {
  metadata: {
    startTime: string;
    endTime: string;
    duration: number;
    network: string;
    vault: string;
    router: string;
  };
  vaultPnL: {
    startingNAV: string;
    endingNAV: string;
    netPnL: string;
    pnlPercent: number;
    lpIncome: Array<{
      pair: PairKey;
      feesEarned: string;
      il: string;
      net: string;
      entryTx: string;
      exitTx: string;
    }>;
    arbTrades: ArbTrade[];
    gasCost: string;
  };
  market: {
    totalTrades: number;
    totalVolume: string;
    pairs: Array<{
      name: PairKey;
      trades: number;
      volumeWKAS: string;
      priceStart: number;
      priceEnd: number;
      priceChange: number;
    }>;
  };
  wallets: WalletReport[];
  allTransactions: AllTransaction[];
};

type RuntimeContext = {
  provider: JsonRpcProvider;
  deployer: Wallet;
  tokenDeployer: Wallet;
  vaultRunner: Wallet;
  router: AnyContract;
  vault: AnyContract;
  factory: AnyContract;
  pairContracts: Map<PairKey, AnyContract>;
  tokenContracts: Record<TokenSymbol, AnyContract>;
  wkas: AnyContract;
  wallets: WalletContext[];
  pairStats: Map<PairKey, PairMarketStats>;
  lpEntries: Map<PairKey, VaultLpEntry>;
  lpExits: VaultLpExit[];
  arbTrades: ArbTrade[];
  allTransactions: AllTransaction[];
  startTime: number;
  endTime: number;
  clockOffset: number;
  nonceMap: Map<string, number>;
  reportPath: string;
  jsonPath: string;
  vaultGasWei: bigint;
  configNotes: string[];
  priceHistory: Map<PairKey, number[]>;
  initialVaultNav: bigint;
};

function getCliDurationMs(): number {
  const minutes = process.env.E2E_VAULT_TEST_DURATION_MINUTES;
  if (!minutes) {
    return DEFAULT_TRADING_DURATION_MS;
  }

  const parsed = Number.parseFloat(minutes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid E2E_VAULT_TEST_DURATION_MINUTES: ${minutes}`);
  }
  return Math.trunc(parsed * 60_000);
}

function nowIso(): string {
  return new Date().toISOString();
}

function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

function getPrivateKey(...envNames: string[]): string {
  for (const envName of envNames) {
    const value = process.env[envName];
    if (!value) {
      continue;
    }
    return value.startsWith('0x') ? value : `0x${value}`;
  }
  throw new Error(`Missing private key in env: ${envNames.join(', ')}`);
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

function deriveWallet(index: number, provider: JsonRpcProvider): Wallet {
  const phrase = process.env.E2E_TEST_MNEMONIC ?? DEFAULT_SEED_PHRASE;
  const hd = HDNodeWallet.fromPhrase(phrase, '', `m/44'/60'/0'/0/${index}`).connect(provider);
  return new Wallet(hd.privateKey, provider);
}

async function getNextNonce(context: RuntimeContext, wallet: Wallet): Promise<number> {
  const address = wallet.address;
  if (!context.nonceMap.has(address)) {
    context.nonceMap.set(address, await context.provider.getTransactionCount(address, 'pending'));
  }
  const next = context.nonceMap.get(address)!;
  context.nonceMap.set(address, next + 1);
  return next;
}

async function txOverrides(
  context: RuntimeContext,
  wallet: Wallet,
  extra: Record<string, bigint | number | string> = {}
): Promise<Record<string, bigint | number | string>> {
  return {
    ...TX_OVERRIDES,
    nonce: await getNextNonce(context, wallet),
    ...extra,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function randomBetween(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function applySlippage(amount: bigint, bps: number): bigint {
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

function formatToken(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}

function formatWkas(amount: bigint): string {
  return formatEther(amount);
}

function shortError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(serializeBigInt(value), null, 2)}\n`, 'utf8');
}

async function syncChainTime(context: RuntimeContext): Promise<void> {
  const block = await context.provider.getBlock('latest');
  if (!block) {
    throw new Error('Unable to read latest block');
  }
  context.clockOffset = block.timestamp - Math.floor(Date.now() / 1000);
}

function makeDeadline(context: RuntimeContext): bigint {
  // Use chain time — Galleon block.timestamp is ~3h ahead of real time
  return BigInt(Math.floor(Date.now() / 1000) + context.clockOffset + 600);
}

async function withReceipt(
  context: RuntimeContext,
  walletLabel: string,
  action: string,
  send: () => Promise<{ hash: string; wait: () => Promise<any> }>,
  details: {
    pair?: string;
    amountIn?: bigint;
    amountOut?: bigint;
  } = {}
): Promise<any> {
  // Pavel's retry pattern: poll mempool after 3s, rebroadcast if TX dropped
  for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      const tx = await send();
      console.log(`      TX sent: ${tx.hash}`);
      
      // Poll mempool within 3 seconds
      await new Promise(r => setTimeout(r, MEMPOOL_POLL_MS));
      const txCheck = await context.provider.getTransaction(tx.hash);
      
      if (!txCheck) {
        // TX was silently dropped from mempool
        if (attempt < MAX_TX_RETRIES) {
          console.log(`      ⚠️  TX dropped from mempool (attempt ${attempt}/${MAX_TX_RETRIES}) — rebroadcasting...`);
          continue;
        }
        console.log(`      ❌ TX dropped — all ${MAX_TX_RETRIES} retries exhausted`);
        throw new Error(`TX dropped from mempool after ${MAX_TX_RETRIES} retries`);
      }
      
      // TX is in mempool — wait for confirmation with timeout
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Transaction confirmation timeout after 60s')), 60_000)
      );
      
      const receipt = await Promise.race([tx.wait(), timeoutPromise]);
      if (receipt && receipt.status === 0) {
        console.log(`      ❌ TX REVERTED: ${explorerTx(tx.hash)}`);
        throw new Error(`TX reverted: ${action}`);
      }
      
      const block = await context.provider.getBlock(receipt.blockNumber);
      context.allTransactions.push({
        wallet: walletLabel,
        action,
        pair: details.pair,
        amountIn: details.amountIn?.toString(),
        amountOut: details.amountOut?.toString(),
        txHash: tx.hash,
        explorerUrl: explorerTx(tx.hash),
        blockNumber: Number(receipt.blockNumber),
        timestamp: block ? new Date(block.timestamp * 1000).toISOString() : nowIso(),
        gasUsed: receipt.gasUsed.toString(),
      });
      return receipt;
    } catch (err: any) {
      if (attempt < MAX_TX_RETRIES && (err.message?.includes('timeout') || err.message?.includes('dropped'))) {
        console.log(`      ⚠️  ${action} error (attempt ${attempt}/${MAX_TX_RETRIES}): ${err.message?.slice(0, 100)} — retrying...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`withReceipt: exhausted all ${MAX_TX_RETRIES} retries for ${action}`);
}

async function validateChain(context: RuntimeContext): Promise<void> {
  const network = await context.provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`Expected chain ${CHAIN_ID}, got ${network.chainId}`);
  }

  const [routerCode, factoryCode, vaultCode, wkasCode] = await Promise.all([
    context.provider.getCode(ADDRESSES.router),
    context.provider.getCode(ADDRESSES.factory),
    context.provider.getCode(ADDRESSES.vault),
    context.provider.getCode(ADDRESSES.wkas),
  ]);

  if ([routerCode, factoryCode, vaultCode, wkasCode].some((code) => code === '0x')) {
    throw new Error('One or more configured contracts are not deployed');
  }

  const routerFactory = getAddress(await context.router['factory']());
  if (routerFactory !== ADDRESSES.factory) {
    throw new Error(`Router factory mismatch: ${routerFactory}`);
  }
}

async function maybeReadAddress(
  context: RuntimeContext,
  method: 'owner' | 'agent'
): Promise<string | null> {
  try {
    return getAddress(await context.vault[method]());
  } catch {
    return null;
  }
}

async function maybeReadBigInt(
  context: RuntimeContext,
  method: 'getVaultNAV' | 'getRemainingDailyVolume' | 'maxTradeSize' | 'dailyVolumeLimit'
): Promise<bigint | null> {
  try {
    return BigInt(await context.vault[method]());
  } catch {
    return null;
  }
}

async function maybeSnapshotNav(context: RuntimeContext, note: string): Promise<void> {
  try {
    console.log(`    Attempting snapshotNAV (${note})...`);
    const vault = context.vault.connect(context.vaultRunner) as AnyContract;
    
    // Add a timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('snapshotNAV timeout after 30s')), 30_000)
    );
    
    await Promise.race([
      withReceipt(
        context,
        'Vault',
        `snapshotNAV (${note})`,
        async () => vault['snapshotNAV'](await txOverrides(context, context.vaultRunner))
      ),
      timeoutPromise
    ]);
    console.log(`    ✓ snapshotNAV (${note}) complete`);
  } catch (error) {
    console.log(`    ⚠️  snapshotNAV (${note}) failed or timed out: ${shortError(error)}`);
    context.configNotes.push(`snapshotNAV failed (${note}): ${shortError(error)}`);
  }
}

function getPairContract(context: RuntimeContext, pairKey: PairKey): AnyContract {
  const pair = context.pairContracts.get(pairKey);
  if (!pair) {
    throw new Error(`Missing pair contract for ${pairKey}`);
  }
  return pair;
}

async function readPairSnapshot(context: RuntimeContext, pair: PairConfig): Promise<PairSnapshot> {
  const pairContract = getPairContract(context, pair.key);
  const [token0, reserves, totalSupply] = await Promise.all([
    pairContract['token0'](),
    pairContract['getReserves'](),
    pairContract['totalSupply'](),
  ]);
  const reserve0 = BigInt(reserves[0]);
  const reserve1 = BigInt(reserves[1]);
  const tokenIs0 = getAddress(token0) === pair.token.address;
  const reserveToken = tokenIs0 ? reserve0 : reserve1;
  const reserveWkas = tokenIs0 ? reserve1 : reserve0;
  const tokenUnits = Number(formatUnits(reserveToken, pair.token.decimals));
  const wkasUnits = Number(formatEther(reserveWkas));
  return {
    reserveToken,
    reserveWkas,
    priceWkasPerToken: tokenUnits === 0 ? 0 : wkasUnits / tokenUnits,
    totalSupply: BigInt(totalSupply),
  };
}

async function quoteAmountsOut(
  context: RuntimeContext,
  amountIn: bigint,
  path: readonly string[]
): Promise<bigint[]> {
  const amounts = await context.router['getAmountsOut'](amountIn, [...path]);
  return Array.from(amounts, (value: bigint) => BigInt(value));
}

async function quoteWkasValue(
  context: RuntimeContext,
  tokenAddress: string,
  amount: bigint
): Promise<bigint> {
  if (getAddress(tokenAddress) === ADDRESSES.wkas) {
    return amount;
  }
  const amounts = await quoteAmountsOut(context, amount, [tokenAddress, ADDRESSES.wkas]);
  return amounts[amounts.length - 1] ?? 0n;
}

async function getTokenBalance(
  context: RuntimeContext,
  tokenAddress: string,
  owner: string
): Promise<bigint> {
  const token = new Contract(tokenAddress, ERC20_ABI, context.provider) as AnyContract;
  return BigInt(await token['balanceOf'](owner));
}

async function getVaultTokenBalance(context: RuntimeContext, tokenAddress: string): Promise<bigint> {
  return BigInt(await context.vault['getTokenBalance'](tokenAddress));
}

async function getVaultNav(context: RuntimeContext): Promise<bigint> {
  const value = await maybeReadBigInt(context, 'getVaultNAV');
  if (value === null) {
    throw new Error('Vault getVaultNAV unavailable');
  }
  return value;
}

async function approveIfNeeded(
  context: RuntimeContext,
  wallet: Wallet,
  walletLabel: string,
  tokenAddress: string,
  spender: string,
  requiredAmount: bigint
): Promise<void> {
  const token = new Contract(tokenAddress, ERC20_ABI, wallet) as AnyContract;
  const allowance = BigInt(await token['allowance'](wallet.address, spender));
  if (allowance >= requiredAmount) {
    return;
  }
  await withReceipt(
    context,
    walletLabel,
    `approve ${tokenAddress} -> ${spender}`,
    async () =>
      token['approve'](
        spender,
        MAX_UINT256,
        await txOverrides(context, wallet)
      )
  );
}

async function fundWallets(context: RuntimeContext): Promise<void> {
  let budget = 0n;
  for (const wallet of context.wallets) {
    budget += PER_WALLET_NATIVE;
  }
  if (budget > MAX_IKAS_BUDGET) {
    throw new Error(`Funding budget ${formatWkas(budget)} exceeds ${formatWkas(MAX_IKAS_BUDGET)}`);
  }

  for (const wallet of context.wallets) {
    try {
      const existingBalance = await context.provider.getBalance(wallet.address);
      if (existingBalance >= PER_WALLET_NATIVE / 2n) {
        if (wallet.index % 10 === 0) console.log(`    wallet #${wallet.index} already funded (${formatWkas(existingBalance)} iKAS), skipping`);
        continue;
      }
      await withReceipt(
        context,
        'Deployer',
        `fund wallet #${wallet.index}`,
        async () =>
          context.deployer.sendTransaction({
            to: wallet.address,
            value: PER_WALLET_NATIVE,
            ...(await txOverrides(context, context.deployer)),
          }),
        { amountOut: PER_WALLET_NATIVE }
      );
      if (wallet.index % 10 === 0) console.log(`    funded ${wallet.index}/50`);
    } catch (error) {
      console.error(`    ❌ failed to fund wallet #${wallet.index}: ${shortError(error)}`);
      context.configNotes.push(`Fund wallet #${wallet.index} failed: ${shortError(error)}`);
    }
  }
}

async function wrapAndApproveWallet(context: RuntimeContext, wallet: WalletContext): Promise<void> {
  const wkas = context.wkas.connect(wallet.wallet) as AnyContract;
  const existingWkas = BigInt(await context.wkas['balanceOf'](wallet.address));
  if (existingWkas < PER_WALLET_WRAP / 2n) {
    await withReceipt(
      context,
      `Wallet #${wallet.index}`,
      'wrap WKAS',
      async () =>
        wkas['deposit']({
          ...(await txOverrides(context, wallet.wallet, { value: PER_WALLET_WRAP })),
        }),
      { amountIn: PER_WALLET_WRAP, amountOut: PER_WALLET_WRAP }
    );
  }

  for (const token of Object.values(TOKENS)) {
    await approveIfNeeded(
      context,
      wallet.wallet,
      `Wallet #${wallet.index}`,
      token.address,
      ADDRESSES.router,
      MAX_UINT256 / 2n
    );
  }
}

async function transferTokenToWallets(
  context: RuntimeContext,
  token: (typeof TOKENS)[TokenSymbol]
): Promise<void> {
  if (token.symbol === 'WKAS') {
    return;
  }
  const contract = context.tokenContracts[token.symbol as TokenSymbol].connect(context.tokenDeployer) as AnyContract;
  for (const wallet of context.wallets) {
    const existingBal = BigInt(await contract['balanceOf'](wallet.address));
    if (existingBal >= token.fundingAmount / 2n) {
      continue;
    }
    await withReceipt(
      context,
      'Token Deployer',
      `transfer ${token.symbol} to wallet #${wallet.index}`,
      async () =>
        contract['transfer'](
          wallet.address,
          token.fundingAmount,
          await txOverrides(context, context.tokenDeployer)
        ),
      { amountOut: token.fundingAmount }
    );
  }
}

async function runLimited<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current !== undefined) {
        await worker(current);
      }
    }
  });
  await Promise.all(runners);
}

async function setupWallets(context: RuntimeContext): Promise<void> {
  await fundWallets(context);
  await runLimited(context.wallets, 8, async (wallet) => {
    await wrapAndApproveWallet(context, wallet);
  });
  for (const token of [TOKENS.ALPHA, TOKENS.BETA, TOKENS.GAMMA] as const) {
    await transferTokenToWallets(context, token);
  }
}

async function depositIntoVault(
  context: RuntimeContext,
  tokenAddress: string,
  amount: bigint,
  wallet: Wallet,
  label: string
): Promise<void> {
  const vault = context.vault.connect(wallet) as AnyContract;
  await approveIfNeeded(context, wallet, label, tokenAddress, ADDRESSES.vault, amount);
  await withReceipt(
    context,
    label,
    `vault deposit ${tokenAddress}`,
    async () => vault['deposit'](tokenAddress, amount, await txOverrides(context, wallet)),
    { amountIn: amount, amountOut: amount }
  );
}

async function ensureVaultInventory(context: RuntimeContext): Promise<void> {
  for (const pair of PAIRS) {
    const snapshot = await readPairSnapshot(context, pair);
    const tokenTarget = (pair.lpTargetWkas * snapshot.reserveToken) / snapshot.reserveWkas;
    const tokenBuffer = (tokenTarget * 3n) / 2n;
    const currentTokenBalance = await getVaultTokenBalance(context, pair.token.address);
    if (currentTokenBalance < tokenBuffer) {
      await depositIntoVault(
        context,
        pair.token.address,
        tokenBuffer - currentTokenBalance,
        context.tokenDeployer,
        'Token Deployer'
      );
    }
  }

  const currentWkasBalance = await getVaultTokenBalance(context, ADDRESSES.wkas);
  const minimumWkas = parseEther('120');
  if (currentWkasBalance < minimumWkas) {
    const topUp = minimumWkas - currentWkasBalance;
    const deployerWkas = context.wkas.connect(context.deployer) as AnyContract;
    await withReceipt(
      context,
      'Deployer',
      'wrap WKAS for vault top-up',
      async () =>
        deployerWkas['deposit']({
          ...(await txOverrides(context, context.deployer, { value: topUp })),
        }),
      { amountIn: topUp, amountOut: topUp }
    );
    await depositIntoVault(context, ADDRESSES.wkas, topUp, context.deployer, 'Deployer');
  }
}

async function enterVaultLpPositions(context: RuntimeContext): Promise<void> {
  const vault = context.vault.connect(context.vaultRunner) as AnyContract;
  for (const pair of PAIRS) {
    console.log(`  Processing ${pair.key} LP entry...`);
    const before = await readPairSnapshot(context, pair);
    console.log(`    Reserve snapshot: ${formatToken(before.reserveToken, pair.token.decimals)} ${pair.token.symbol}, ${formatWkas(before.reserveWkas)} WKAS`);
    const vaultTokenBefore = await getVaultTokenBalance(context, pair.token.address);
    const vaultWkasBefore = await getVaultTokenBalance(context, ADDRESSES.wkas);
    const desiredToken = (pair.lpTargetWkas * before.reserveToken) / before.reserveWkas;
    console.log(`    Vault balances before: ${formatToken(vaultTokenBefore, pair.token.decimals)} ${pair.token.symbol}, ${formatWkas(vaultWkasBefore)} WKAS`);
    console.log(`    Adding liquidity: ${formatToken(desiredToken, pair.token.decimals)} ${pair.token.symbol} + ${formatWkas(pair.lpTargetWkas)} WKAS...`);
    const receipt = await withReceipt(
      context,
      'Vault',
      `addLiquidity ${pair.key}`,
      async () =>
        vault['addLiquidity'](
          pair.token.address,
          ADDRESSES.wkas,
          desiredToken,
          pair.lpTargetWkas,
          applySlippage(desiredToken, 200),
          applySlippage(pair.lpTargetWkas, 200),
          makeDeadline(context),
          await txOverrides(context, context.vaultRunner)
        ),
      { pair: pair.key, amountIn: desiredToken, amountOut: pair.lpTargetWkas }
    );
    console.log(`    ✓ LP entry TX: ${explorerTx(receipt.hash)}`);

    const pairContract = getPairContract(context, pair.key);
    const lpBalance = BigInt(await pairContract['balanceOf'](ADDRESSES.vault));
    const vaultTokenAfter = await getVaultTokenBalance(context, pair.token.address);
    const vaultWkasAfter = await getVaultTokenBalance(context, ADDRESSES.wkas);
    const actualTokenIn = vaultTokenBefore - vaultTokenAfter;
    const actualWkasIn = vaultWkasBefore - vaultWkasAfter;
    context.vaultGasWei += BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? TX_OVERRIDES.gasPrice);

    context.lpEntries.set(pair.key, {
      pair: pair.key,
      tokenAddress: pair.token.address,
      pairAddress: pair.pairAddress,
      entryPrice: before.priceWkasPerToken,
      priceStart: before.priceWkasPerToken,
      reserveTokenStart: before.reserveToken,
      reserveWkasStart: before.reserveWkas,
      vaultTokenBefore,
      vaultWkasBefore,
      vaultTokenAfter,
      vaultWkasAfter,
      actualTokenIn,
      actualWkasIn,
      lpBalance,
      entryTxHash: receipt.hash,
      entryExplorerUrl: explorerTx(receipt.hash),
    });
  }
}

async function routerSwap(
  context: RuntimeContext,
  wallet: WalletContext,
  path: string[],
  amountIn: bigint,
  pairLabel: string,
  action: string
): Promise<void> {
  const router = context.router.connect(wallet.wallet) as AnyContract;
  const quote = await quoteAmountsOut(context, amountIn, path);
  const expectedOut = quote[quote.length - 1] ?? 0n;
  if (expectedOut === 0n) {
    return;
  }
  const minOut = (expectedOut * 99n) / 100n;
  const receipt = await withReceipt(
    context,
    `Wallet #${wallet.index}`,
    action,
    async () =>
      router['swapExactTokensForTokens'](
        amountIn,
        minOut,
        path,
        wallet.address,
        makeDeadline(context),
        await txOverrides(context, wallet.wallet)
      ),
    { pair: pairLabel, amountIn, amountOut: expectedOut }
  );
  wallet.txHashes.push(receipt.hash);
  wallet.trades += 1;

  const pairStat = context.pairStats.get(pairLabel as PairKey);
  if (pairStat) {
    pairStat.trades += 1;
    pairStat.volumeWKAS += await quoteWkasValue(context, path[0]!, amountIn);
  }
  wallet.volumeWkasWei += await quoteWkasValue(context, path[0]!, amountIn);
}

async function randomTraderCycle(context: RuntimeContext, wallet: WalletContext): Promise<void> {
  const choices = [
    { path: [ADDRESSES.wkas, TOKENS.ALPHA.address], pair: 'ALPHA/WKAS' },
    { path: [ADDRESSES.wkas, TOKENS.BETA.address], pair: 'BETA/WKAS' },
    { path: [ADDRESSES.wkas, TOKENS.GAMMA.address], pair: 'GAMMA/WKAS' },
    { path: [TOKENS.ALPHA.address, ADDRESSES.wkas], pair: 'ALPHA/WKAS' },
    { path: [TOKENS.BETA.address, ADDRESSES.wkas], pair: 'BETA/WKAS' },
    { path: [TOKENS.GAMMA.address, ADDRESSES.wkas], pair: 'GAMMA/WKAS' },
    { path: [TOKENS.ALPHA.address, ADDRESSES.wkas, TOKENS.BETA.address], pair: 'ALPHA/WKAS' },
    { path: [TOKENS.BETA.address, ADDRESSES.wkas, TOKENS.GAMMA.address], pair: 'BETA/WKAS' },
  ];
  const choice = choices[Math.floor(wallet.rng() * choices.length)]!;
  const amountWkas = parseEther(randomBetween(wallet.rng, 0.5, 5).toFixed(6));
  let amountIn = amountWkas;
  if (choice.path[0] !== ADDRESSES.wkas) {
    const quote = await quoteAmountsOut(context, amountWkas, [ADDRESSES.wkas, choice.path[0]!]);
    amountIn = quote[quote.length - 1] ?? 0n;
  }
  if (amountIn <= 0n) {
    return;
  }
  await routerSwap(context, wallet, choice.path, amountIn, choice.pair, 'random trader swap');
}

async function getCurrentPrice(context: RuntimeContext, pairKey: PairKey): Promise<number> {
  const pair = PAIRS.find((entry) => entry.key === pairKey);
  if (!pair) {
    return 0;
  }
  const snapshot = await readPairSnapshot(context, pair);
  const history = context.priceHistory.get(pairKey) ?? [];
  history.push(snapshot.priceWkasPerToken);
  if (history.length > 12) {
    history.shift();
  }
  context.priceHistory.set(pairKey, history);
  return snapshot.priceWkasPerToken;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function roleDrivenSwap(
  context: RuntimeContext,
  wallet: WalletContext,
  pair: PairConfig,
  direction: 'buy' | 'sell',
  wkasSize: bigint,
  action: string
): Promise<void> {
  let path: string[];
  let amountIn: bigint;
  if (direction === 'buy') {
    path = [ADDRESSES.wkas, pair.token.address];
    amountIn = wkasSize;
  } else {
    path = [pair.token.address, ADDRESSES.wkas];
    const quote = await quoteAmountsOut(context, wkasSize, [ADDRESSES.wkas, pair.token.address]);
    amountIn = quote[quote.length - 1] ?? 0n;
  }
  if (amountIn <= 0n) {
    return;
  }
  await routerSwap(context, wallet, path, amountIn, pair.key, action);
}

async function trendFollowerCycle(context: RuntimeContext, wallet: WalletContext): Promise<void> {
  const pair = PAIRS[Math.floor(wallet.rng() * PAIRS.length)]!;
  const current = await getCurrentPrice(context, pair.key);
  const history = context.priceHistory.get(pair.key) ?? [];
  const baseline = average(history.slice(0, Math.max(history.length - 1, 1)));
  if (baseline <= 0) {
    return;
  }
  const amount = parseEther(randomBetween(wallet.rng, 1, 4).toFixed(6));
  if (current > baseline * 1.01) {
    await roleDrivenSwap(context, wallet, pair, 'buy', amount, 'trend follower buy');
    return;
  }
  if (current < baseline * 0.99) {
    await roleDrivenSwap(context, wallet, pair, 'sell', amount, 'trend follower sell');
  }
}

async function meanReverterCycle(context: RuntimeContext, wallet: WalletContext): Promise<void> {
  const pair = PAIRS[Math.floor(wallet.rng() * PAIRS.length)]!;
  const current = await getCurrentPrice(context, pair.key);
  const history = context.priceHistory.get(pair.key) ?? [];
  const baseline = average(history);
  if (baseline <= 0) {
    return;
  }
  const amount = parseEther(randomBetween(wallet.rng, 1, 4).toFixed(6));
  if (current < baseline * 0.985) {
    await roleDrivenSwap(context, wallet, pair, 'buy', amount, 'mean reverter buy dip');
    return;
  }
  if (current > baseline * 1.015) {
    await roleDrivenSwap(context, wallet, pair, 'sell', amount, 'mean reverter sell rip');
  }
}

async function whaleCycle(context: RuntimeContext, wallet: WalletContext): Promise<void> {
  const pair = PAIRS[Math.floor(wallet.rng() * PAIRS.length)]!;
  const buySide = wallet.rng() > 0.4;
  const size = parseEther(randomBetween(wallet.rng, 10, 30).toFixed(6));
  await roleDrivenSwap(
    context,
    wallet,
    pair,
    buySide ? 'buy' : 'sell',
    size,
    buySide ? 'whale buy' : 'whale sell'
  );
}

async function runWalletLoop(context: RuntimeContext, wallet: WalletContext): Promise<void> {
  while (Date.now() < context.endTime) {
    try {
      if (wallet.role === 'Random Trader') {
        await randomTraderCycle(context, wallet);
        await delay(Math.trunc(randomBetween(wallet.rng, 3_000, 10_000)));
        continue;
      }
      if (wallet.role === 'Trend Follower') {
        await trendFollowerCycle(context, wallet);
        await delay(Math.trunc(randomBetween(wallet.rng, 4_000, 9_000)));
        continue;
      }
      if (wallet.role === 'Mean Reverter') {
        await meanReverterCycle(context, wallet);
        await delay(Math.trunc(randomBetween(wallet.rng, 4_000, 9_000)));
        continue;
      }
      await whaleCycle(context, wallet);
      await delay(Math.trunc(randomBetween(wallet.rng, 5_000, 11_000)));
    } catch (error) {
      context.configNotes.push(`Wallet #${wallet.index} ${wallet.role}: ${shortError(error)}`);
      await delay(2_000);
    }
  }
}

function getVaultTradeBudget(balance: bigint, capWkas: bigint): bigint {
  if (balance <= 0n) {
    return 0n;
  }
  const tenth = balance / 10n;
  return tenth < capWkas ? tenth : capWkas;
}

async function maybeRunVaultArb(context: RuntimeContext): Promise<void> {
  const vault = context.vault.connect(context.vaultRunner) as AnyContract;
  const comparisons = await Promise.all(
    PAIRS.map(async (pair) => ({
      pair,
      snapshot: await readPairSnapshot(context, pair),
      history: context.priceHistory.get(pair.key) ?? [],
    }))
  );

  let best:
    | {
        source: PairConfig;
        target: PairConfig;
        spread: number;
      }
    | undefined;

  for (const left of comparisons) {
    for (const right of comparisons) {
      if (left.pair.key === right.pair.key) {
        continue;
      }
      const leftBaseline = left.history.length > 0 ? average(left.history) : left.snapshot.priceWkasPerToken;
      const rightBaseline = right.history.length > 0 ? average(right.history) : right.snapshot.priceWkasPerToken;
      if (leftBaseline <= 0 || rightBaseline <= 0) {
        continue;
      }
      const leftIndex = left.snapshot.priceWkasPerToken / leftBaseline;
      const rightIndex = right.snapshot.priceWkasPerToken / rightBaseline;
      const spread = Math.abs(leftIndex - rightIndex) / Math.min(leftIndex, rightIndex);
      if (spread <= 0.02) {
        continue;
      }
      const source = leftIndex > rightIndex ? left.pair : right.pair;
      const target = leftIndex > rightIndex ? right.pair : left.pair;
      if (!best || spread > best.spread) {
        best = { source, target, spread };
      }
    }
  }

  if (!best) {
    return;
  }

  const beforeNav = await getVaultNav(context);
  const sourceBalance = await getVaultTokenBalance(context, best.source.token.address);
  const wkasBalance = await getVaultTokenBalance(context, ADDRESSES.wkas);
  let path: string[];
  let amountIn: bigint;
  let direction: string;

  if (sourceBalance > 0n) {
    const maxSourceByWkas = await quoteAmountsOut(
      context,
      parseEther('12'),
      [ADDRESSES.wkas, best.source.token.address]
    );
    amountIn = getVaultTradeBudget(
      sourceBalance,
      maxSourceByWkas[maxSourceByWkas.length - 1] ?? 0n
    );
    path = [best.source.token.address, ADDRESSES.wkas, best.target.token.address];
    direction = `${best.source.token.symbol}->WKAS->${best.target.token.symbol}`;
  } else {
    amountIn = getVaultTradeBudget(wkasBalance, parseEther('12'));
    path = [ADDRESSES.wkas, best.target.token.address];
    direction = `WKAS->${best.target.token.symbol}`;
  }

  if (amountIn <= 0n) {
    return;
  }

  const amounts = await quoteAmountsOut(context, amountIn, path);
  const expectedOut = amounts[amounts.length - 1] ?? 0n;
  if (expectedOut <= 0n) {
    return;
  }

  const receipt = await withReceipt(
    context,
    'Vault',
    `arb ${direction}`,
    async () =>
      vault['swap'](
        amountIn,
        (expectedOut * 99n) / 100n,
        path,
        makeDeadline(context),
        await txOverrides(context, context.vaultRunner)
      ),
    { pair: `${best.source.key} vs ${best.target.key}`, amountIn, amountOut: expectedOut }
  );

  const afterNav = await getVaultNav(context);
  const profit = afterNav - beforeNav;
  context.vaultGasWei += BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? TX_OVERRIDES.gasPrice);
  context.arbTrades.push({
    pair: `${best.source.key} vs ${best.target.key}`,
    direction,
    amountIn: amountIn.toString(),
    amountOut: expectedOut.toString(),
    profit: profit.toString(),
    txHash: receipt.hash,
    explorerUrl: explorerTx(receipt.hash),
  });
}

async function runVaultLoops(context: RuntimeContext): Promise<void> {
  let nextSnapshotAt = Date.now();
  while (Date.now() < context.endTime) {
    try {
      await maybeRunVaultArb(context);
    } catch (error) {
      context.configNotes.push(`Vault arb loop: ${shortError(error)}`);
    }

    if (Date.now() >= nextSnapshotAt) {
      try {
        await maybeSnapshotNav(context, 'interval');
      } catch {
        // handled in maybeSnapshotNav
      }
      nextSnapshotAt = Date.now() + NAV_SNAPSHOT_INTERVAL_MS;
    }

    await delay(ARB_INTERVAL_MS);
  }
}

function theoreticalIlWkas(entryPrice: number, exitPrice: number, holdValueWkas: bigint): bigint {
  if (entryPrice <= 0 || exitPrice <= 0 || holdValueWkas <= 0n) {
    return 0n;
  }
  const r = exitPrice / entryPrice;
  const lpRatio = (2 * Math.sqrt(r)) / (1 + r);
  const noFeeLpValue = BigInt(Math.trunc(Number(formatEther(holdValueWkas)) * lpRatio * 1e18));
  return noFeeLpValue - holdValueWkas;
}

async function exitVaultLpPositions(context: RuntimeContext): Promise<void> {
  const vault = context.vault.connect(context.vaultRunner) as AnyContract;
  for (const pair of PAIRS) {
    const entry = context.lpEntries.get(pair.key);
    if (!entry || entry.lpBalance === 0n) {
      continue;
    }

    const beforeToken = await getVaultTokenBalance(context, pair.token.address);
    const beforeWkas = await getVaultTokenBalance(context, ADDRESSES.wkas);
    const endSnapshot = await readPairSnapshot(context, pair);

    const receipt = await withReceipt(
      context,
      'Vault',
      `removeLiquidity ${pair.key}`,
      async () =>
        vault['removeLiquidity'](
          pair.token.address,
          ADDRESSES.wkas,
          entry.lpBalance,
          0n,
          0n,
          makeDeadline(context),
          await txOverrides(context, context.vaultRunner)
        ),
      { pair: pair.key, amountIn: entry.lpBalance }
    );
    context.vaultGasWei += BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? TX_OVERRIDES.gasPrice);

    const afterToken = await getVaultTokenBalance(context, pair.token.address);
    const afterWkas = await getVaultTokenBalance(context, ADDRESSES.wkas);
    const withdrawnToken = afterToken - beforeToken;
    const withdrawnWkas = afterWkas - beforeWkas;
    const tokenValueAtExit = await quoteWkasValue(context, pair.token.address, entry.actualTokenIn);
    const holdValueWkas = tokenValueAtExit + entry.actualWkasIn;
    const actualLpValueWkas = (await quoteWkasValue(context, pair.token.address, withdrawnToken)) + withdrawnWkas;
    const ilWkas = theoreticalIlWkas(entry.entryPrice, endSnapshot.priceWkasPerToken, holdValueWkas);
    const noFeeLpValueWkas = holdValueWkas + ilWkas;
    const feesEarnedWkas = actualLpValueWkas - noFeeLpValueWkas;
    const netWkas = actualLpValueWkas - holdValueWkas;

    context.lpExits.push({
      pair: pair.key,
      lpBalance: entry.lpBalance,
      exitPrice: endSnapshot.priceWkasPerToken,
      reserveTokenEnd: endSnapshot.reserveToken,
      reserveWkasEnd: endSnapshot.reserveWkas,
      withdrawnToken,
      withdrawnWkas,
      holdValueWkas,
      noFeeLpValueWkas,
      actualLpValueWkas,
      ilWkas,
      feesEarnedWkas,
      netWkas,
      exitTxHash: receipt.hash,
      exitExplorerUrl: explorerTx(receipt.hash),
    });
  }
}

async function finalizePairStats(context: RuntimeContext): Promise<void> {
  for (const pair of PAIRS) {
    const stat = context.pairStats.get(pair.key);
    if (!stat) {
      continue;
    }
    const endSnapshot = await readPairSnapshot(context, pair);
    stat.priceEnd = endSnapshot.priceWkasPerToken;
    stat.priceChange =
      stat.priceStart === 0 ? 0 : ((stat.priceEnd - stat.priceStart) / stat.priceStart) * 100;
  }
}

function buildWallets(provider: JsonRpcProvider): WalletContext[] {
  const wallets: WalletContext[] = [];
  for (let index = 1; index <= WALLET_COUNT; index += 1) {
    const wallet = deriveWallet(index, provider);
    const role: TraderRole =
      index <= 20
        ? 'Random Trader'
        : index <= 35
          ? 'Trend Follower'
          : index <= 45
            ? 'Mean Reverter'
            : 'Whale';
    wallets.push({
      index,
      role,
      wallet,
      address: wallet.address,
      rng: makeRng(index * 9_973),
      txHashes: [],
      trades: 0,
      volumeWkasWei: 0n,
    });
  }
  return wallets;
}

function getResultPaths(): { reportPath: string; jsonPath: string } {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
  const baseDir = resolve(process.cwd(), 'e2e-results');
  return {
    reportPath: resolve(baseDir, `report-${stamp}.txt`),
    jsonPath: resolve(baseDir, `txns-${stamp}.json`),
  };
}

async function buildContext(): Promise<RuntimeContext> {
  const provider = makeProvider();
  const deployer = new Wallet(getPrivateKey('DEPLOYER_PRIVATE_KEY', 'PRIVATE_KEY'), provider);
  const tokenDeployer = new Wallet(
    getPrivateKey('ERC20_DEPLOYER_PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY', 'PRIVATE_KEY'),
    provider
  );
  const vaultRunner = new Wallet(
    getPrivateKey('VAULT_PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY', 'PRIVATE_KEY'),
    provider
  );
  const { reportPath, jsonPath } = getResultPaths();

  const pairStats = new Map<PairKey, PairMarketStats>();
  for (const pair of PAIRS) {
    const snapshot = await readPairSnapshot(
      {
        provider,
        deployer,
        tokenDeployer,
        vaultRunner,
        router: new Contract(ADDRESSES.router, ROUTER_ABI, provider) as AnyContract,
        vault: new Contract(ADDRESSES.vault, VAULT_ABI, provider) as AnyContract,
        factory: new Contract(ADDRESSES.factory, FACTORY_ABI, provider) as AnyContract,
        pairContracts: new Map([[pair.key, new Contract(pair.pairAddress, PAIR_ABI, provider) as AnyContract]]),
        tokenContracts: {
          ALPHA: new Contract(TOKENS.ALPHA.address, ERC20_ABI, provider) as AnyContract,
          BETA: new Contract(TOKENS.BETA.address, ERC20_ABI, provider) as AnyContract,
          GAMMA: new Contract(TOKENS.GAMMA.address, ERC20_ABI, provider) as AnyContract,
          WKAS: new Contract(TOKENS.WKAS.address, ERC20_ABI, provider) as AnyContract,
        },
        wkas: new Contract(ADDRESSES.wkas, WKAS_ABI, provider) as AnyContract,
        wallets: [],
        pairStats: new Map(),
        lpEntries: new Map(),
        lpExits: [],
        arbTrades: [],
        allTransactions: [],
        startTime: Date.now(),
        endTime: Date.now(),
        clockOffset: 0,
        nonceMap: new Map(),
        reportPath,
        jsonPath,
        vaultGasWei: 0n,
        configNotes: [],
        priceHistory: new Map(),
        initialVaultNav: 0n,
      },
      pair
    );
    pairStats.set(pair.key, {
      name: pair.key,
      trades: 0,
      volumeWKAS: 0n,
      priceStart: snapshot.priceWkasPerToken,
      priceEnd: snapshot.priceWkasPerToken,
      priceChange: 0,
    });
  }

  return {
    provider,
    deployer,
    tokenDeployer,
    vaultRunner,
    router: new Contract(ADDRESSES.router, ROUTER_ABI, provider) as AnyContract,
    vault: new Contract(ADDRESSES.vault, VAULT_ABI, provider) as AnyContract,
    factory: new Contract(ADDRESSES.factory, FACTORY_ABI, provider) as AnyContract,
    pairContracts: new Map(
      PAIRS.map((pair) => [pair.key, new Contract(pair.pairAddress, PAIR_ABI, provider) as AnyContract])
    ),
    tokenContracts: {
      ALPHA: new Contract(TOKENS.ALPHA.address, ERC20_ABI, provider) as AnyContract,
      BETA: new Contract(TOKENS.BETA.address, ERC20_ABI, provider) as AnyContract,
      GAMMA: new Contract(TOKENS.GAMMA.address, ERC20_ABI, provider) as AnyContract,
      WKAS: new Contract(TOKENS.WKAS.address, ERC20_ABI, provider) as AnyContract,
    },
    wkas: new Contract(ADDRESSES.wkas, WKAS_ABI, provider) as AnyContract,
    wallets: buildWallets(provider),
    pairStats,
    lpEntries: new Map(),
    lpExits: [],
    arbTrades: [],
    allTransactions: [],
    startTime: Date.now(),
    endTime: Date.now() + getCliDurationMs(),
    clockOffset: 0,
    nonceMap: new Map(),
    reportPath,
    jsonPath,
    vaultGasWei: 0n,
    configNotes: [],
    priceHistory: new Map(),
    initialVaultNav: 0n,
  };
}

function buildHumanReport(
  context: RuntimeContext,
  startingNav: bigint,
  endingNav: bigint,
  jsonReport: JsonReport
): string {
  const durationMinutes = (context.endTime - context.startTime) / 60_000;
  const lpLines = context.lpExits.map((entry) => {
    const lpEntry = context.lpEntries.get(entry.pair)!;
    return `    ${entry.pair}: fees +${formatWkas(entry.feesEarnedWkas)} | IL ${formatWkas(entry.ilWkas)} | net ${entry.netWkas >= 0n ? '+' : ''}${formatWkas(entry.netWkas)} | entry ${lpEntry.entryExplorerUrl} | exit ${entry.exitExplorerUrl}`;
  });

  const profitableArbs = context.arbTrades.filter((entry) => BigInt(entry.profit) > 0n);
  const bestTrade = profitableArbs.sort((a, b) => Number(BigInt(b.profit) - BigInt(a.profit)))[0];
  const totalArbProfit = context.arbTrades.reduce((sum, entry) => sum + BigInt(entry.profit), 0n);
  const totalTrades = jsonReport.market.totalTrades;
  const totalVolume = jsonReport.market.totalVolume;
  const walletLines = context.wallets.map(
    (wallet) =>
      `  Wallet #${wallet.index} (${wallet.role}): ${wallet.trades} trades | ${formatWkas(wallet.volumeWkasWei)} WKAS volume | ${wallet.address}`
  );
  const topTransactions = [...context.allTransactions]
    .sort((left, right) => Number(BigInt(right.amountIn ?? '0') - BigInt(left.amountIn ?? '0')))
    .slice(0, 10)
    .map(
      (txn, index) =>
        `  ${index + 1}. ${txn.txHash} | ${txn.action} | ${txn.explorerUrl}`
    );
  const vaultTransactions = context.allTransactions
    .filter((entry) => entry.wallet === 'Vault')
    .map(
      (txn, index) =>
        `  ${index + 1}. ${txn.action}: ${txn.txHash} | ${txn.explorerUrl}`
    );

  return [
    '═══════════════════════════════════════════════════',
    '    E2E VAULT TEST REPORT — IGRA Galleon',
    '═══════════════════════════════════════════════════',
    `Duration: ${durationMinutes.toFixed(2)}m`,
    `Network: ${NETWORK_NAME} (${CHAIN_ID})`,
    `Vault: ${ADDRESSES.vault}`,
    `Router: ${ADDRESSES.router}`,
    `Wallets: ${WALLET_COUNT}`,
    '',
    'VAULT P&L:',
    `  Starting NAV: ${formatWkas(startingNav)} WKAS`,
    `  Ending NAV: ${formatWkas(endingNav)} WKAS`,
    `  Net P&L: ${endingNav - startingNav >= 0n ? '+' : ''}${formatWkas(endingNav - startingNav)} WKAS (${startingNav === 0n ? '0.00' : (((Number(formatEther(endingNav - startingNav)) / Number(formatEther(startingNav))) * 100)).toFixed(2)}%)`,
    '',
    '  LP Income:',
    ...lpLines,
    '',
    '  Arbitrage:',
    `    Total arb trades: ${context.arbTrades.length}`,
    `    Profitable: ${profitableArbs.length}`,
    `    Total arb profit: ${totalArbProfit >= 0n ? '+' : ''}${formatWkas(totalArbProfit)} WKAS`,
    `    Best trade: ${bestTrade ? `${formatWkas(BigInt(bestTrade.profit))} WKAS ${bestTrade.explorerUrl}` : 'n/a'}`,
    '',
    '    Arb Log:',
    ...context.arbTrades.map(
      (trade, index) =>
        `      #${index + 1}: ${trade.direction} | ${BigInt(trade.profit) >= 0n ? '+' : ''}${formatWkas(BigInt(trade.profit))} WKAS | ${trade.explorerUrl}`
    ),
    '',
    `  Gas spent: ${formatWkas(context.vaultGasWei)} iKAS`,
    '',
    'MARKET OVERVIEW:',
    `  Total trades across all wallets: ${totalTrades}`,
    `  Total volume: ${totalVolume} WKAS equivalent`,
    '',
    '  Pair Stats:',
    ...jsonReport.market.pairs.map(
      (pair) =>
        `    ${pair.name}: ${pair.trades} trades | ${pair.priceStart.toFixed(8)} -> ${pair.priceEnd.toFixed(8)} | ${pair.volumeWKAS} WKAS`
    ),
    '',
    'WALLET BREAKDOWN:',
    ...walletLines,
    '',
    'TOP 10 TRANSACTIONS BY VALUE:',
    ...topTransactions,
    '',
    'ALL VAULT TRANSACTIONS:',
    ...vaultTransactions,
    '',
    context.configNotes.length > 0 ? `NOTES: ${context.configNotes.join(' | ')}` : 'NOTES: none',
  ].join('\n');
}

async function writeOutputs(
  context: RuntimeContext,
  startingNav: bigint,
  endingNav: bigint
): Promise<{ report: string; jsonReport: JsonReport }> {
  await finalizePairStats(context);
  const totalTrades = context.wallets.reduce((sum, wallet) => sum + wallet.trades, 0);
  const totalVolume = context.wallets.reduce((sum, wallet) => sum + wallet.volumeWkasWei, 0n);
  const jsonReport: JsonReport = {
    metadata: {
      startTime: new Date(context.startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: Date.now() - context.startTime,
      network: NETWORK_NAME,
      vault: ADDRESSES.vault,
      router: ADDRESSES.router,
    },
    vaultPnL: {
      startingNAV: startingNav.toString(),
      endingNAV: endingNav.toString(),
      netPnL: (endingNav - startingNav).toString(),
      pnlPercent:
        startingNav === 0n
          ? 0
          : (Number(formatEther(endingNav - startingNav)) / Number(formatEther(startingNav))) * 100,
      lpIncome: context.lpExits.map((entry) => {
        const lpEntry = context.lpEntries.get(entry.pair)!;
        return {
          pair: entry.pair,
          feesEarned: entry.feesEarnedWkas.toString(),
          il: entry.ilWkas.toString(),
          net: entry.netWkas.toString(),
          entryTx: lpEntry.entryTxHash,
          exitTx: entry.exitTxHash,
        };
      }),
      arbTrades: context.arbTrades,
      gasCost: context.vaultGasWei.toString(),
    },
    market: {
      totalTrades,
      totalVolume: totalVolume.toString(),
      pairs: Array.from(context.pairStats.values()).map((entry) => ({
        name: entry.name,
        trades: entry.trades,
        volumeWKAS: entry.volumeWKAS.toString(),
        priceStart: entry.priceStart,
        priceEnd: entry.priceEnd,
        priceChange: entry.priceChange,
      })),
    },
    wallets: context.wallets.map((wallet) => ({
      index: wallet.index,
      role: wallet.role,
      address: wallet.address,
      trades: wallet.trades,
      volume: wallet.volumeWkasWei.toString(),
      txHashes: wallet.txHashes,
    })),
    allTransactions: context.allTransactions,
  };

  const report = buildHumanReport(context, startingNav, endingNav, jsonReport);
  await mkdir(dirname(context.reportPath), { recursive: true });
  await writeFile(context.reportPath, `${report}\n`, 'utf8');
  await saveJson(context.jsonPath, jsonReport);
  return { report, jsonReport };
}

async function printStartupSummary(context: RuntimeContext): Promise<void> {
  const [owner, agent, maxTradeSize, dailyVolumeLimit, remainingDailyVolume] = await Promise.all([
    maybeReadAddress(context, 'owner'),
    maybeReadAddress(context, 'agent'),
    maybeReadBigInt(context, 'maxTradeSize'),
    maybeReadBigInt(context, 'dailyVolumeLimit'),
    maybeReadBigInt(context, 'getRemainingDailyVolume'),
  ]);

  console.log(`E2E vault test starting on ${NETWORK_NAME} (${CHAIN_ID})`);
  console.log(`Vault: ${ADDRESSES.vault}`);
  console.log(`Router: ${ADDRESSES.router}`);
  console.log(`Report: ${context.reportPath}`);
  console.log(`Transactions JSON: ${context.jsonPath}`);
  console.log(`Deployer signer: ${context.deployer.address}`);
  console.log(`Token deployer signer: ${context.tokenDeployer.address}`);
  console.log(`Vault signer: ${context.vaultRunner.address}`);
  console.log(`Vault owner: ${owner ?? 'n/a'} | agent: ${agent ?? 'n/a'}`);
  console.log(
    `Vault limits: maxTradeSize=${maxTradeSize ? formatWkas(maxTradeSize) : 'n/a'} WKAS | dailyVolumeLimit=${dailyVolumeLimit ? formatWkas(dailyVolumeLimit) : 'n/a'} WKAS | remaining=${remainingDailyVolume ? formatWkas(remainingDailyVolume) : 'n/a'} WKAS`
  );
}

async function seedPriceHistory(context: RuntimeContext): Promise<void> {
  for (const pair of PAIRS) {
    console.log(`  Reading ${pair.key} snapshot...`);
    const snapshot = await readPairSnapshot(context, pair);
    context.priceHistory.set(pair.key, [snapshot.priceWkasPerToken]);
    console.log(`  ✓ ${pair.key}: ${snapshot.priceWkasPerToken.toFixed(8)}`);
  }
}

async function savePartialResults(context: RuntimeContext, reason: string): Promise<void> {
  try {
    console.log(`\n⚠️  Saving partial results (${reason})...`);
    const endingNav = await getVaultNav(context).catch(() => 0n);
    const startNav = context.initialVaultNav || 0n;
    context.configNotes.push(`PARTIAL RESULT: ${reason}`);
    const { report } = await writeOutputs(context, startNav, endingNav);
    console.log(report);
    console.log(`\nPartial report saved: ${context.reportPath}`);
    console.log(`Partial JSON saved: ${context.jsonPath}`);
  } catch (saveError) {
    console.error('Failed to save partial results:', saveError);
  }
}

async function main(): Promise<void> {
  const context = await buildContext();
  await syncChainTime(context);
  console.log('✓ Chain time synced');
  await validateChain(context);
  console.log('✓ Chain validated');
  await printStartupSummary(context);
  console.log('✓ Seeding price history...');
  await seedPriceHistory(context);
  console.log('✓ Price history seeded');
  console.log('✓ Snapshotting NAV at startup...');
  await maybeSnapshotNav(context, 'startup');
  console.log('✓ NAV snapshot complete');

  // Phase 1: Setup wallets (skippable via SKIP_WALLET_SETUP env var)
  const skipWalletSetup = process.env.SKIP_WALLET_SETUP === 'true';
  if (skipWalletSetup) {
    console.log('\n=== Phase 1: SKIPPED (SKIP_WALLET_SETUP=true) ===');
    console.log('  Assuming wallets are already funded and approved');
  } else {
    console.log('\n=== Phase 1: Setting up 50 wallets ===');
    console.log('  Funding wallets with native iKAS...');
    await fundWallets(context);
    console.log('  ✅ All 50 wallets funded');

    console.log('  Wrapping WKAS + approving router for each wallet...');
    let wrapCount = 0;
    const origWrapAndApprove = wrapAndApproveWallet;
    await runLimited(context.wallets, 8, async (wallet) => {
      await origWrapAndApprove(context, wallet);
      wrapCount++;
      if (wrapCount % 10 === 0) console.log(`  ... ${wrapCount}/50 wallets wrapped & approved`);
    });
    console.log('  ✅ All wallets wrapped & approved');

    console.log('  Transferring ALPHA, BETA, GAMMA tokens...');
    for (const token of [TOKENS.ALPHA, TOKENS.BETA, TOKENS.GAMMA] as const) {
      await transferTokenToWallets(context, token);
      console.log(`  ✅ ${token.symbol} distributed to all wallets`);
    }
  }

  console.log('  Ensuring vault has enough inventory...');
  await ensureVaultInventory(context);
  console.log('  ✅ Vault inventory ready');

  // Phase 2: Vault LP Entry
  console.log('\n=== Phase 2: Vault LP Entry ===');
  context.initialVaultNav = await getVaultNav(context);
  console.log(`  Starting NAV: ${formatWkas(context.initialVaultNav)} WKAS`);
  await maybeSnapshotNav(context, 'pre-lp');
  
  try {
    await enterVaultLpPositions(context);
    console.log('  ✅ Vault LP positions entered on 3 pairs');
  } catch (lpError) {
    console.error(`  ❌ LP entry failed: ${shortError(lpError)}`);
    context.configNotes.push(`LP entry failed: ${shortError(lpError)}`);
    console.log('  Continuing to trading phase anyway...');
  }
  
  await maybeSnapshotNav(context, 'post-lp-entry');

  // Phase 3/4: Trading + Arb
  const tradingMins = ((context.endTime - Date.now()) / 60_000).toFixed(1);
  console.log(`\n=== Phase 3/4: Trading market (${tradingMins}m) + Vault arb ===`);
  console.log('  50 wallets trading concurrently, vault arb loop every 5s');

  // Progress ticker
  const progressInterval = setInterval(() => {
    const totalTrades = context.wallets.reduce((sum, w) => sum + w.trades, 0);
    const totalTxs = context.allTransactions.length;
    const arbCount = context.arbTrades.length;
    const elapsed = ((Date.now() - context.startTime) / 60_000).toFixed(1);
    const remaining = ((context.endTime - Date.now()) / 60_000).toFixed(1);
    console.log(`  📊 ${elapsed}m elapsed | ${remaining}m left | ${totalTrades} trades | ${totalTxs} TXs | ${arbCount} arb attempts`);
  }, 30_000);

  try {
    await Promise.all([
      ...context.wallets.map((wallet) => runWalletLoop(context, wallet)),
      runVaultLoops(context),
    ]);
  } catch (tradingError) {
    console.error('Trading phase error:', tradingError);
    context.configNotes.push(`Trading error: ${shortError(tradingError)}`);
  } finally {
    clearInterval(progressInterval);
  }

  const totalTrades = context.wallets.reduce((sum, w) => sum + w.trades, 0);
  console.log(`  ✅ Trading complete: ${totalTrades} trades, ${context.allTransactions.length} TXs, ${context.arbTrades.length} arb trades`);

  // Phase 5: Exit + Report
  console.log('\n=== Phase 5: Vault LP Exit + Report ===');
  try {
    await exitVaultLpPositions(context);
    console.log('  ✅ All LP positions removed');
  } catch (exitError) {
    console.error('LP exit error:', exitError);
    context.configNotes.push(`LP exit error: ${shortError(exitError)}`);
  }
  await maybeSnapshotNav(context, 'post-lp-exit');
  const endingNav = await getVaultNav(context);
  const { report, jsonReport } = await writeOutputs(context, context.initialVaultNav, endingNav);

  console.log(report);
  console.log('');
  console.log('Summary:');
  console.log(`  Trades: ${jsonReport.market.totalTrades}`);
  console.log(`  Volume: ${formatWkas(BigInt(jsonReport.market.totalVolume))} WKAS`);
  console.log(
    `  Vault P&L: ${endingNav - context.initialVaultNav >= 0n ? '+' : ''}${formatWkas(endingNav - context.initialVaultNav)} WKAS`
  );
  console.log(`  Report saved: ${context.reportPath}`);
  console.log(`  JSON saved: ${context.jsonPath}`);
}

main().catch(async (error) => {
  console.error('E2E vault test failed:', error);
  // Try to save partial results even on crash
  try {
    const provider = new JsonRpcProvider(RPC_URL);
    // We can't easily recover context here, but the error message will help debug
    console.error('Use partial results if any were saved before the crash.');
  } catch {}
  process.exitCode = 1;
});
