/**
 * check-wallet-status.ts
 *
 * Read-only status check for all 100 lending wallets on Galleon testnet.
 * Reads addresses from data/lending-wallets-100.json and calls getUserAccountData
 * on each one. No private keys required.
 *
 * Flags wallets with HF < 1.5 in red (at-risk) and HF < 1.1 in bright red (near liquidation).
 *
 * Run: npx tsx scripts/check-wallet-status.ts
 */

import { config as dotenvConfig } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPublicClient,
  defineChain,
  formatUnits,
  http,
  type Address,
} from 'viem';

dotenvConfig();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_URL = 'https://galleon-testnet.igralabs.com:8545';
const CHAIN_ID = 38836;
const BASE_CURRENCY_DECIMALS = 8;
const POOL_ADDRESS = '0xb265EA393A9297472628E21575AE5c7E6458A1F2' as const satisfies Address;

const DATA_DIR = resolve(process.cwd(), 'data');
const WALLETS_FILE = resolve(DATA_DIR, 'lending-wallets-100.json');

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Galleon Testnet',
  nativeCurrency: { name: 'iKAS', symbol: 'iKAS', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
});

// ---------------------------------------------------------------------------
// ANSI colours
// ---------------------------------------------------------------------------

const C = {
  red:     '\x1b[31m',
  brightRed: '\x1b[91m',
  yellow:  '\x1b[33m',
  green:   '\x1b[32m',
  cyan:    '\x1b[36m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  reset:   '\x1b[0m',
} as const;

function colorHF(hf: number): string {
  const s = hf === Infinity ? '∞' : hf.toFixed(3);
  if (hf < 1.1) return `${C.brightRed}${C.bold}${s}${C.reset}`;
  if (hf < 1.5) return `${C.red}${s}${C.reset}`;
  if (hf < 2.0) return `${C.yellow}${s}${C.reset}`;
  return `${C.green}${s}${C.reset}`;
}

// ---------------------------------------------------------------------------
// ABI (minimal inline)
// ---------------------------------------------------------------------------

const poolAbi = [
  {
    type: 'function', name: 'getUserAccountData', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletRecord = {
  index: number;
  address: string;
  role: string;
  profile: {
    collateral: Array<{ token: string; amount: string }>;
    borrows: Array<{ token: string; borrowPercent: number }>;
    targetHF: number | null;
  };
};

type AccountData = {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
};

// ---------------------------------------------------------------------------
// On-chain read
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PublicClient = any;

async function getUserAccountData(
  publicClient: PublicClient,
  user: Address,
): Promise<AccountData> {
  const result = await publicClient.readContract({
    address: POOL_ADDRESS,
    abi: poolAbi,
    functionName: 'getUserAccountData',
    args: [user],
  }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

  return {
    totalCollateralBase: result[0],
    totalDebtBase: result[1],
    availableBorrowsBase: result[2],
    currentLiquidationThreshold: result[3],
    ltv: result[4],
    healthFactor: result[5],
  };
}

function parseHF(raw: bigint): number {
  // healthFactor has 18 decimals; max uint256 = no debt (infinite HF)
  const MAX_UINT256 = 2n ** 256n - 1n;
  if (raw === MAX_UINT256) return Infinity;
  return parseFloat(formatUnits(raw, 18));
}

function fmt(value: bigint, decimals: number): string {
  return parseFloat(formatUnits(value, decimals)).toFixed(2);
}

function pad(s: string, n: number): string {
  return s.padEnd(n).slice(0, n);
}
function padLeft(s: string, n: number): string {
  return s.padStart(n).slice(-n);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const walletsRaw = await readFile(WALLETS_FILE, 'utf8');
  const wallets: WalletRecord[] = JSON.parse(walletsRaw);

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

  console.log(`\n${C.bold}Galleon Testnet — Lending Wallet Status (${wallets.length} wallets)${C.reset}`);
  console.log(`Pool: ${POOL_ADDRESS}\n`);

  // Table header
  const header = [
    padLeft('#', 4),
    pad('Role', 22),
    padLeft('Collateral$', 13),
    padLeft('Debt$', 11),
    padLeft('Available$', 11),
    padLeft('HF', 10),
    pad('Address', 44),
  ].join('  ');
  console.log(`${C.bold}${C.dim}${header}${C.reset}`);
  console.log('─'.repeat(header.length));

  // Aggregate stats
  let totalCollateral = 0;
  let totalDebt = 0;
  const hfBuckets: Record<string, number> = {
    'no_debt (∞)': 0,
    'safe (>= 2.0)': 0,
    'watch (1.5–2.0)': 0,
    'at_risk (1.1–1.5)': 0,
    'near_liq (< 1.1)': 0,
    'no_position': 0,
  };
  const atRisk: Array<{ index: number; role: string; hf: number }> = [];

  for (const wallet of wallets) {
    const data = await getUserAccountData(publicClient, wallet.address as Address);
    const hfNum = parseHF(data.healthFactor);
    const hfDisplay = colorHF(hfNum);

    const collUsd = parseFloat(fmt(data.totalCollateralBase, BASE_CURRENCY_DECIMALS));
    const debtUsd = parseFloat(fmt(data.totalDebtBase, BASE_CURRENCY_DECIMALS));
    const availUsd = parseFloat(fmt(data.availableBorrowsBase, BASE_CURRENCY_DECIMALS));

    totalCollateral += collUsd;
    totalDebt += debtUsd;

    // Bucket
    if (collUsd === 0) {
      hfBuckets['no_position']++;
    } else if (hfNum === Infinity) {
      hfBuckets['no_debt (∞)']++;
    } else if (hfNum >= 2.0) {
      hfBuckets['safe (>= 2.0)']++;
    } else if (hfNum >= 1.5) {
      hfBuckets['watch (1.5–2.0)']++;
    } else if (hfNum >= 1.1) {
      hfBuckets['at_risk (1.1–1.5)']++;
      atRisk.push({ index: wallet.index, role: wallet.role, hf: hfNum });
    } else {
      hfBuckets['near_liq (< 1.1)']++;
      atRisk.push({ index: wallet.index, role: wallet.role, hf: hfNum });
    }

    const row = [
      padLeft(String(wallet.index), 4),
      pad(wallet.role, 22),
      padLeft(`$${collUsd.toFixed(2)}`, 13),
      padLeft(`$${debtUsd.toFixed(2)}`, 11),
      padLeft(`$${availUsd.toFixed(2)}`, 11),
      padLeft(hfDisplay, 10 + (hfDisplay.length - hfDisplay.replace(/\x1b\[[0-9;]*m/g, '').length)),
      `${C.dim}${wallet.address}${C.reset}`,
    ].join('  ');

    console.log(row);
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log(`${C.bold}SUMMARY${C.reset}`);
  console.log(`  Total collateral:  $${totalCollateral.toFixed(2)}`);
  console.log(`  Total debt:        $${totalDebt.toFixed(2)}`);
  console.log(`  Utilization:       ${totalCollateral > 0 ? ((totalDebt / totalCollateral) * 100).toFixed(1) : '0'}%`);
  console.log(`\n${C.bold}Health Factor Distribution:${C.reset}`);
  for (const [bucket, count] of Object.entries(hfBuckets)) {
    if (count === 0) continue;
    const bar = '█'.repeat(Math.round(count / 2));
    const label = bucket.includes('near_liq') || bucket.includes('at_risk')
      ? `${C.red}${bucket}${C.reset}`
      : `${C.green}${bucket}${C.reset}`;
    console.log(`  ${pad(label, 40 + 10)}  ${String(count).padStart(3)}  ${C.dim}${bar}${C.reset}`);
  }

  if (atRisk.length > 0) {
    console.log(`\n${C.red}${C.bold}⚠️  AT-RISK WALLETS (HF < 1.5):${C.reset}`);
    for (const w of atRisk) {
      const hfColor = w.hf < 1.1 ? C.brightRed + C.bold : C.red;
      console.log(`  #${w.index} [${w.role}] HF=${hfColor}${w.hf.toFixed(4)}${C.reset}`);
    }
  }

  console.log('');
}

main().catch(error => {
  console.error('Status check failed:', error);
  process.exitCode = 1;
});
