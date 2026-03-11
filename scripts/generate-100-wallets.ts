/**
 * generate-100-wallets.ts
 *
 * Deterministically derives 100 wallet addresses from the deployer key
 * and assigns each a lending profile (role, collateral, borrow targets).
 *
 * Key derivation: keccak256(toUtf8Bytes(`${deployerKey}:${index}:0:lending-stress-v2`))
 * Private keys are NOT stored. They are derivable at runtime using the same function.
 *
 * Output: data/lending-wallets-100.json
 *
 * Run: npx tsx scripts/generate-100-wallets.ts
 */

import { config as dotenvConfig } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { keccak256, toUtf8Bytes, Wallet } from 'ethers';

dotenvConfig();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = resolve(process.cwd(), 'data');
const OUTPUT_FILE = resolve(DATA_DIR, 'lending-wallets-100.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TokenAmount = {
  token: string;
  amount: string;
};

type BorrowSpec = {
  token: string;
  /** Percentage of available borrow capacity to take (0-100). Set at runtime. */
  borrowPercent: number;
};

type WalletProfile = {
  collateral: TokenAmount[];
  borrows: BorrowSpec[];
  targetHF: number | null;
};

type WalletRecord = {
  index: number;
  address: string;
  role: string;
  profile: WalletProfile;
};

// ---------------------------------------------------------------------------
// Key derivation (NO keys stored)
// ---------------------------------------------------------------------------

function requireDeployerKey(): string {
  const key = process.env.IGRA_DEPLOYER_KEY;
  if (!key) throw new Error('IGRA_DEPLOYER_KEY environment variable is required');
  return key.startsWith('0x') ? key : `0x${key}`;
}

/**
 * Derive wallet address at index deterministically.
 * Same function must be used in setup scripts to derive the private key.
 * NEVER persist the private key to disk.
 */
export function deriveWalletAddress(deployerKey: string, index: number): string {
  const privateKey = keccak256(toUtf8Bytes(`${deployerKey}:${index}:0:lending-stress-v2`));
  return new Wallet(privateKey).address;
}

/**
 * Derive wallet private key at index deterministically.
 * Use ONLY at runtime — do NOT log, store, or pass to non-trusted code.
 */
export function derivePrivateKey(deployerKey: string, index: number): string {
  return keccak256(toUtf8Bytes(`${deployerKey}:${index}:0:lending-stress-v2`));
}

// ---------------------------------------------------------------------------
// Profile factory
// ---------------------------------------------------------------------------

function makeProfile(index: number): { role: string; profile: WalletProfile } {
  // 1–20: Conservative Supplier — supply only, no borrowing
  if (index <= 20) {
    return {
      role: 'Conservative Supplier',
      profile: {
        collateral: [
          { token: 'WKAS', amount: '1000' },
          { token: 'USDC', amount: '5000' },
        ],
        borrows: [],
        targetHF: null,
      },
    };
  }

  // 21–40: Safe Borrower — moderate borrow (~50%), HF 2.0-3.0
  if (index <= 40) {
    const borrowToken = index % 2 === 1 ? 'USDC' : 'DAI';
    return {
      role: 'Safe Borrower',
      profile: {
        collateral: [
          { token: 'WKAS', amount: '2000' },
          { token: 'USDT', amount: '3000' },
        ],
        borrows: [{ token: borrowToken, borrowPercent: 50 }],
        targetHF: 2.5,
      },
    };
  }

  // 41–60: Moderate Borrower — 65% capacity, HF 1.5-2.0
  if (index <= 60) {
    const borrowToken = index % 2 === 1 ? 'USDC' : 'USDT';
    return {
      role: 'Moderate Borrower',
      profile: {
        collateral: [
          { token: 'WETH', amount: '5' },
          { token: 'WBTC', amount: '0.1' },
        ],
        borrows: [{ token: borrowToken, borrowPercent: 65 }],
        targetHF: 1.75,
      },
    };
  }

  // 61–80: Aggressive Borrower — 80% capacity, HF 1.2-1.5
  if (index <= 80) {
    const borrowToken = index % 2 === 1 ? 'USDC' : 'DAI';
    return {
      role: 'Aggressive Borrower',
      profile: {
        collateral: [{ token: 'WKAS', amount: '5000' }],
        borrows: [{ token: borrowToken, borrowPercent: 80 }],
        targetHF: 1.35,
      },
    };
  }

  // 81–90: Whale Supplier — large multi-asset, small borrow (~20%), HF 5+
  if (index <= 90) {
    return {
      role: 'Whale Supplier',
      profile: {
        collateral: [
          { token: 'WKAS', amount: '10000' },
          { token: 'USDC', amount: '50000' },
          { token: 'WETH', amount: '10' },
        ],
        borrows: [{ token: 'USDC', borrowPercent: 20 }],
        targetHF: 6.0,
      },
    };
  }

  // 91–100: Liquidation Target — single volatile asset, ~90% borrow, HF 1.05-1.15
  const collateralToken = index % 2 === 1 ? 'WKAS' : 'WETH';
  const collateralAmount = collateralToken === 'WKAS' ? '3000' : '3';
  return {
    role: 'Liquidation Target',
    profile: {
      collateral: [{ token: collateralToken, amount: collateralAmount }],
      borrows: [{ token: 'USDC', borrowPercent: 90 }],
      targetHF: 1.1,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const deployerKey = requireDeployerKey();

  await mkdir(DATA_DIR, { recursive: true });

  const wallets: WalletRecord[] = [];

  for (let index = 1; index <= 100; index++) {
    const address = deriveWalletAddress(deployerKey, index);
    const { role, profile } = makeProfile(index);
    wallets.push({ index, address, role, profile });
  }

  await writeFile(OUTPUT_FILE, `${JSON.stringify(wallets, null, 2)}\n`, 'utf8');

  // Distribution summary
  const roleCounts: Record<string, number> = {};
  for (const w of wallets) {
    roleCounts[w.role] = (roleCounts[w.role] ?? 0) + 1;
  }

  console.log(`\n✅ Generated ${wallets.length} wallets → ${OUTPUT_FILE}`);
  console.log('\nDistribution:');
  for (const [role, count] of Object.entries(roleCounts)) {
    console.log(`  ${String(count).padStart(3)}  ${role}`);
  }

  console.log('\nSample addresses (first 5):');
  for (const w of wallets.slice(0, 5)) {
    console.log(`  ${String(w.index).padStart(3)}.  [${w.role}]  ${w.address}`);
  }
  console.log('\nSample addresses (last 5):');
  for (const w of wallets.slice(-5)) {
    console.log(`  ${String(w.index).padStart(3)}.  [${w.role}]  ${w.address}`);
  }
}

main().catch(error => {
  console.error('Wallet generation failed:', error);
  process.exitCode = 1;
});
