import { config as dotenvConfig } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import poolAbi from '../src/modules/liquidation/abi/pool.json';

dotenvConfig();

const RPC_URL = 'https://galleon-testnet.igralabs.com:8545';
const CHAIN_ID = 38836;
const GAS_PRICE = 2_000_000_000_000n;
const LEGACY_TX = {
  type: 'legacy' as const,
  gasPrice: GAS_PRICE,
  gas: 500_000n,
};
const POOL_ADDRESS = '0xb265EA393A9297472628E21575AE5c7E6458A1F2' as const satisfies Address;
const ORACLE_ADDRESS = '0x5B83681E48f365cfD2A4Ee29E2B699e38e04EbD9' as const satisfies Address;
const DATA_DIR = resolve(process.cwd(), 'data');
const WALLETS_FILE = resolve(DATA_DIR, 'stress-test-wallets.json');
const RESULTS_FILE = resolve(DATA_DIR, 'stress-test-results.json');
const BASE_CURRENCY_DECIMALS = 8;
const VARIABLE_RATE_MODE = 2;
const REFERRAL_CODE = 0;

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Galleon Testnet',
  nativeCurrency: {
    name: 'iKAS',
    symbol: 'iKAS',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [RPC_URL],
    },
    public: {
      http: [RPC_URL],
    },
  },
});

const erc20Abi = [
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
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const oracleAbi = [
  {
    type: 'function',
    name: 'getAssetPrice',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

type TokenSymbol = 'WKAS' | 'USDC' | 'USDT' | 'DAI' | 'WETH' | 'WBTC';

type TokenConfig = {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
};

type WalletRecord = {
  index: number;
  address: Address;
  privateKey: Hex;
};

type AccountData = {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
};

type ResultPosition = {
  token: TokenSymbol;
  amount: string;
};

type WalletResult = {
  index: number;
  address: Address;
  scenario: string;
  collateral: ResultPosition[];
  borrows: ResultPosition[];
  healthFactor: string;
  totalCollateralUsd: string;
  totalDebtUsd: string;
  availableBorrowsUsd: string;
  currentLiquidationThreshold: string;
  txHashes: Hex[];
};

const TOKENS: Record<TokenSymbol, TokenConfig> = {
  WKAS: {
    symbol: 'WKAS',
    address: '0x394C68684F9AFCEb9b804531EF07a864E8081738',
    decimals: 18,
  },
  USDC: {
    symbol: 'USDC',
    address: '0xfEE6ee271c2fD76EdAd5De7B8177C3935799111A',
    decimals: 6,
  },
  USDT: {
    symbol: 'USDT',
    address: '0xb522AC3161D67b6Ed2e311E0036A2F49F903bcc7',
    decimals: 6,
  },
  DAI: {
    symbol: 'DAI',
    address: '0x2c680F22600A632c9291c2f1E3b070ED79c1168e',
    decimals: 18,
  },
  WETH: {
    symbol: 'WETH',
    address: '0x23A8E284A6193C1D6A51A7b34d047ae0b969D660',
    decimals: 18,
  },
  WBTC: {
    symbol: 'WBTC',
    address: '0x2429526815517B971d45B0899C3D67990A68BcD7',
    decimals: 8,
  },
};

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function requireDeployerKey(): Hex {
  const key = process.env.IGRA_DEPLOYER_KEY;
  if (!key) {
    throw new Error('IGRA_DEPLOYER_KEY is required');
  }

  return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
}

function makeWallets(count: number): WalletRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return {
      index: index + 1,
      address: account.address,
      privateKey,
    };
  });
}

async function saveJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function formatBaseUsd(value: bigint): string {
  return formatUnits(value, BASE_CURRENCY_DECIMALS);
}

function formatHealthFactor(value: bigint): string {
  return formatUnits(value, 18);
}

async function waitForHash(publicClient: ReturnType<typeof createPublicClient>, hash: Hex): Promise<void> {
  await publicClient.waitForTransactionReceipt({ hash });
}

async function mintToWallet(
  deployerClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  token: TokenConfig,
  wallet: Address,
  amount: bigint
): Promise<Hex> {
  const hash = await deployerClient.writeContract({
    account: deployerClient.account!,
    address: token.address,
    abi: erc20Abi,
    functionName: 'mint',
    args: [wallet, amount],
    chain,
    ...LEGACY_TX,
  });
  await waitForHash(publicClient, hash);
  return hash;
}

async function fundWallet(
  deployerClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  wallet: Address
): Promise<Hex> {
  const hash = await deployerClient.sendTransaction({
    account: deployerClient.account!,
    chain,
    to: wallet,
    value: parseEther('100'),
    ...LEGACY_TX,
  });
  await waitForHash(publicClient, hash);
  return hash;
}

async function approveToken(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  token: TokenConfig,
  amount: bigint
): Promise<Hex> {
  const hash = await walletClient.writeContract({
    account: walletClient.account!,
    address: token.address,
    abi: erc20Abi,
    functionName: 'approve',
    args: [POOL_ADDRESS, amount],
    chain,
    ...LEGACY_TX,
  });
  await waitForHash(publicClient, hash);
  return hash;
}

async function supplyToken(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  token: TokenConfig,
  amount: bigint
): Promise<Hex[]> {
  const txHashes: Hex[] = [];

  const supplyHash = await walletClient.writeContract({
    account: walletClient.account!,
    address: POOL_ADDRESS,
    abi: poolAbi,
    functionName: 'supply',
    args: [token.address, amount, walletClient.account!.address, REFERRAL_CODE],
    chain,
    ...LEGACY_TX,
  });
  txHashes.push(supplyHash);
  await waitForHash(publicClient, supplyHash);

  const collateralHash = await walletClient.writeContract({
    account: walletClient.account!,
    address: POOL_ADDRESS,
    abi: poolAbi,
    functionName: 'setUserUseReserveAsCollateral',
    args: [token.address, true],
    chain,
    ...LEGACY_TX,
  });
  txHashes.push(collateralHash);
  await waitForHash(publicClient, collateralHash);

  return txHashes;
}

async function borrowToken(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  token: TokenConfig,
  amount: bigint
): Promise<Hex> {
  const hash = await walletClient.writeContract({
    account: walletClient.account!,
    address: POOL_ADDRESS,
    abi: poolAbi,
    functionName: 'borrow',
    args: [token.address, amount, VARIABLE_RATE_MODE, REFERRAL_CODE, walletClient.account!.address],
    chain,
    ...LEGACY_TX,
  });
  await waitForHash(publicClient, hash);
  return hash;
}

async function getUserAccountData(
  publicClient: ReturnType<typeof createPublicClient>,
  user: Address
): Promise<AccountData> {
  const [totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor] =
    await publicClient.readContract({
      address: POOL_ADDRESS,
      abi: poolAbi,
      functionName: 'getUserAccountData',
      args: [user],
    }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

  return {
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    currentLiquidationThreshold,
    ltv,
    healthFactor,
  };
}

async function getAssetPrice(
  publicClient: ReturnType<typeof createPublicClient>,
  token: TokenConfig
): Promise<bigint> {
  return await publicClient.readContract({
    address: ORACLE_ADDRESS,
    abi: oracleAbi,
    functionName: 'getAssetPrice',
    args: [token.address],
  }) as bigint;
}

async function getTokenBalance(
  publicClient: ReturnType<typeof createPublicClient>,
  token: TokenConfig,
  user: Address
): Promise<bigint> {
  return await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint;
}

function baseValueToTokenAmount(baseValue: bigint, assetPrice: bigint, decimals: number): bigint {
  if (baseValue <= 0n || assetPrice <= 0n) {
    return 0n;
  }

  return (baseValue * 10n ** BigInt(decimals)) / assetPrice;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function describeAmount(token: TokenConfig, amount: bigint): ResultPosition {
  return {
    token: token.symbol,
    amount: formatUnits(amount, token.decimals),
  };
}

async function moderateUsdcSupplier(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  deployerClient: ReturnType<typeof createWalletClient>
): Promise<Pick<WalletResult, 'scenario' | 'collateral' | 'borrows' | 'txHashes'>> {
  const txHashes: Hex[] = [];
  const usdcAmount = parseUnits('5000', TOKENS.USDC.decimals);

  txHashes.push(await mintToWallet(deployerClient, publicClient, TOKENS.USDC, walletClient.account!.address, usdcAmount));
  txHashes.push(await approveToken(walletClient, publicClient, TOKENS.USDC, usdcAmount));
  txHashes.push(...await supplyToken(walletClient, publicClient, TOKENS.USDC, usdcAmount));

  const accountData = await getUserAccountData(publicClient, walletClient.account!.address);
  const wkasPrice = await getAssetPrice(publicClient, TOKENS.WKAS);
  const targetBase = minBigInt(accountData.availableBorrowsBase / 2n, parseUnits('2000', BASE_CURRENCY_DECIMALS));
  const borrowAmount = baseValueToTokenAmount(targetBase, wkasPrice, TOKENS.WKAS.decimals);

  if (borrowAmount <= 0n) {
    throw new Error('Moderate USDC supplier scenario computed zero WKAS borrow');
  }

  txHashes.push(await borrowToken(walletClient, publicClient, TOKENS.WKAS, borrowAmount));

  return {
    scenario: 'Moderate USDC supplier',
    collateral: [describeAmount(TOKENS.USDC, usdcAmount)],
    borrows: [describeAmount(TOKENS.WKAS, borrowAmount)],
    txHashes,
  };
}

async function highLtvWkasBorrower(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  deployerClient: ReturnType<typeof createWalletClient>
): Promise<Pick<WalletResult, 'scenario' | 'collateral' | 'borrows' | 'txHashes'>> {
  const txHashes: Hex[] = [];
  const usdcAmount = parseUnits('10000', TOKENS.USDC.decimals);

  txHashes.push(await mintToWallet(deployerClient, publicClient, TOKENS.USDC, walletClient.account!.address, usdcAmount));
  txHashes.push(await approveToken(walletClient, publicClient, TOKENS.USDC, usdcAmount));
  txHashes.push(...await supplyToken(walletClient, publicClient, TOKENS.USDC, usdcAmount));

  const accountData = await getUserAccountData(publicClient, walletClient.account!.address);
  const wkasPrice = await getAssetPrice(publicClient, TOKENS.WKAS);
  const targetBase = (accountData.availableBorrowsBase * 9n) / 10n;
  const borrowAmount = baseValueToTokenAmount(targetBase, wkasPrice, TOKENS.WKAS.decimals);

  if (borrowAmount <= 0n) {
    throw new Error('High LTV WKAS borrower scenario computed zero WKAS borrow');
  }

  txHashes.push(await borrowToken(walletClient, publicClient, TOKENS.WKAS, borrowAmount));

  return {
    scenario: 'High LTV WKAS borrower',
    collateral: [describeAmount(TOKENS.USDC, usdcAmount)],
    borrows: [describeAmount(TOKENS.WKAS, borrowAmount)],
    txHashes,
  };
}

async function multiAssetPosition(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  deployerClient: ReturnType<typeof createWalletClient>
): Promise<Pick<WalletResult, 'scenario' | 'collateral' | 'borrows' | 'txHashes'>> {
  const txHashes: Hex[] = [];
  const wbtcAmount = parseUnits('0.5', TOKENS.WBTC.decimals);
  const usdtSupplyAmount = parseUnits('5000', TOKENS.USDT.decimals);
  const usdtBorrowAmount = parseUnits('2000', TOKENS.USDT.decimals);
  const usdcBorrowAmount = parseUnits('1000', TOKENS.USDC.decimals);

  txHashes.push(await mintToWallet(deployerClient, publicClient, TOKENS.WBTC, walletClient.account!.address, wbtcAmount));
  txHashes.push(await mintToWallet(deployerClient, publicClient, TOKENS.USDT, walletClient.account!.address, usdtSupplyAmount));
  txHashes.push(await approveToken(walletClient, publicClient, TOKENS.WBTC, wbtcAmount));
  txHashes.push(...await supplyToken(walletClient, publicClient, TOKENS.WBTC, wbtcAmount));

  txHashes.push(await borrowToken(walletClient, publicClient, TOKENS.USDT, usdtBorrowAmount));
  txHashes.push(await borrowToken(walletClient, publicClient, TOKENS.USDC, usdcBorrowAmount));

  return {
    scenario: 'Multi-asset position',
    collateral: [describeAmount(TOKENS.WBTC, wbtcAmount)],
    borrows: [
      describeAmount(TOKENS.USDT, usdtBorrowAmount),
      describeAmount(TOKENS.USDC, usdcBorrowAmount),
    ],
    txHashes,
  };
}

async function maxLeveragePosition(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  deployerClient: ReturnType<typeof createWalletClient>
): Promise<Pick<WalletResult, 'scenario' | 'collateral' | 'borrows' | 'txHashes'>> {
  const txHashes: Hex[] = [];
  const wethAmount = parseUnits('5', TOKENS.WETH.decimals);

  txHashes.push(await mintToWallet(deployerClient, publicClient, TOKENS.WETH, walletClient.account!.address, wethAmount));
  txHashes.push(await approveToken(walletClient, publicClient, TOKENS.WETH, wethAmount));
  txHashes.push(...await supplyToken(walletClient, publicClient, TOKENS.WETH, wethAmount));

  const accountData = await getUserAccountData(publicClient, walletClient.account!.address);
  const usdcPrice = await getAssetPrice(publicClient, TOKENS.USDC);
  const targetBase = (accountData.availableBorrowsBase * 92n) / 100n;
  const borrowAmount = baseValueToTokenAmount(targetBase, usdcPrice, TOKENS.USDC.decimals);

  if (borrowAmount <= 0n) {
    throw new Error('Max leverage scenario computed zero USDC borrow');
  }

  txHashes.push(await borrowToken(walletClient, publicClient, TOKENS.USDC, borrowAmount));

  return {
    scenario: 'Max leverage',
    collateral: [describeAmount(TOKENS.WETH, wethAmount)],
    borrows: [describeAmount(TOKENS.USDC, borrowAmount)],
    txHashes,
  };
}

async function stablecoinCollateralPosition(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  deployerClient: ReturnType<typeof createWalletClient>
): Promise<Pick<WalletResult, 'scenario' | 'collateral' | 'borrows' | 'txHashes'>> {
  const txHashes: Hex[] = [];
  const daiAmount = parseUnits('10000', TOKENS.DAI.decimals);
  const usdcBorrowAmount = parseUnits('5000', TOKENS.USDC.decimals);

  txHashes.push(await mintToWallet(deployerClient, publicClient, TOKENS.DAI, walletClient.account!.address, daiAmount));
  txHashes.push(await approveToken(walletClient, publicClient, TOKENS.DAI, daiAmount));
  txHashes.push(...await supplyToken(walletClient, publicClient, TOKENS.DAI, daiAmount));
  txHashes.push(await borrowToken(walletClient, publicClient, TOKENS.USDC, usdcBorrowAmount));

  return {
    scenario: 'Stablecoin collateral',
    collateral: [describeAmount(TOKENS.DAI, daiAmount)],
    borrows: [describeAmount(TOKENS.USDC, usdcBorrowAmount)],
    txHashes,
  };
}

async function collectWalletResult(
  publicClient: ReturnType<typeof createPublicClient>,
  wallet: WalletRecord,
  scenarioData: Pick<WalletResult, 'scenario' | 'collateral' | 'borrows' | 'txHashes'>
): Promise<WalletResult> {
  const accountData = await getUserAccountData(publicClient, wallet.address);

  console.log(
    [
      `Wallet ${wallet.index} (${wallet.address})`,
      `scenario=${scenarioData.scenario}`,
      `collateralBase=${formatBaseUsd(accountData.totalCollateralBase)}`,
      `debtBase=${formatBaseUsd(accountData.totalDebtBase)}`,
      `availableBorrowsBase=${formatBaseUsd(accountData.availableBorrowsBase)}`,
      `liqThreshold=${accountData.currentLiquidationThreshold.toString()}`,
      `healthFactor=${formatHealthFactor(accountData.healthFactor)}`,
    ].join(' | ')
  );

  return {
    index: wallet.index,
    address: wallet.address,
    scenario: scenarioData.scenario,
    collateral: scenarioData.collateral,
    borrows: scenarioData.borrows,
    healthFactor: formatHealthFactor(accountData.healthFactor),
    totalCollateralUsd: formatBaseUsd(accountData.totalCollateralBase),
    totalDebtUsd: formatBaseUsd(accountData.totalDebtBase),
    availableBorrowsUsd: formatBaseUsd(accountData.availableBorrowsBase),
    currentLiquidationThreshold: accountData.currentLiquidationThreshold.toString(),
    txHashes: scenarioData.txHashes,
  };
}

async function main(): Promise<void> {
  await ensureDataDir();

  const deployerAccount = privateKeyToAccount(requireDeployerKey());
  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL),
  });
  const deployerClient = createWalletClient({
    account: deployerAccount,
    chain,
    transport: http(RPC_URL),
  });

  const wallets = makeWallets(5);
  await saveJson(
    WALLETS_FILE,
    wallets.map(wallet => ({
      index: wallet.index,
      address: wallet.address,
      privateKey: wallet.privateKey,
    }))
  );

  console.log(`Saved ${wallets.length} generated wallets to ${WALLETS_FILE}`);

  for (const wallet of wallets) {
    console.log(`Funding wallet ${wallet.index}: ${wallet.address}`);
    await fundWallet(deployerClient, publicClient, wallet.address);
  }

  const walletClients = wallets.map(wallet =>
    createWalletClient({
      account: privateKeyToAccount(wallet.privateKey),
      chain,
      transport: http(RPC_URL),
    })
  );

  const scenarioResults: WalletResult[] = [];
  const scenarioFns = [
    moderateUsdcSupplier,
    highLtvWkasBorrower,
    multiAssetPosition,
    maxLeveragePosition,
    stablecoinCollateralPosition,
  ] as const;

  for (const [index, walletClient] of walletClients.entries()) {
    const wallet = wallets[index];
    console.log(`Executing wallet ${wallet.index} scenario...`);
    const scenarioData = await scenarioFns[index](walletClient, publicClient, deployerClient);
    scenarioResults.push(await collectWalletResult(publicClient, wallet, scenarioData));
  }

  await saveJson(RESULTS_FILE, {
    timestamp: new Date().toISOString(),
    network: 'galleon-testnet',
    chainId: CHAIN_ID,
    wallets: scenarioResults,
  });

  console.log(`Saved stress test results to ${RESULTS_FILE}`);

  for (const token of Object.values(TOKENS)) {
    const deployerBalance = await getTokenBalance(publicClient, token, deployerAccount.address);
    console.log(`Deployer ${token.symbol} balance: ${formatUnits(deployerBalance, token.decimals)}`);
  }
}

main().catch(error => {
  console.error('Aave stress test setup failed:', error);
  process.exitCode = 1;
});
