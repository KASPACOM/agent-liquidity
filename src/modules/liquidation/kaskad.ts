/**
 * Kaskad helpers for Aave read/write safety.
 *
 * Kaskad-enabled Aave markets require fresh signed oracle updates for health
 * factor reads and liquidation/borrow/withdraw writes. The current
 * AgentVaultV3 liquidation path calls Pool.liquidationCall directly with vault
 * funds and has no PriceUpdate argument, so it cannot safely execute against a
 * Kaskad oracle without a vault contract upgrade.
 */
import {
  decodeAbiParameters,
  decodeErrorResult,
  encodeFunctionData,
  type Hex,
  type PublicClient,
} from 'viem';
import type { ChainConfig } from './types';
import type { UserAccountData } from './types';

export interface KaskadPriceUpdate {
  assetId: Hex;
  price: bigint;
  timestamp: bigint;
  numSources: number;
  sourcesHash: Hex;
  signature: Hex;
}

interface RawEnclavePrice {
  asset_id: string;
  price: string;
  timestamp: number | string;
  num_sources: number;
  sources_hash: string;
  signature: string;
}

interface PricesResponse {
  prices?: RawEnclavePrice[];
}

const KASKAD_PRICE_CACHE_TTL_MS = 5_000;
const KASKAD_FETCH_TIMEOUT_MS = 4_000;

const PRICE_UPDATE_COMPONENTS = [
  { name: 'assetId', type: 'bytes32' },
  { name: 'price', type: 'uint256' },
  { name: 'timestamp', type: 'uint256' },
  { name: 'numSources', type: 'uint8' },
  { name: 'sourcesHash', type: 'bytes32' },
  { name: 'signature', type: 'bytes' },
] as const;

export const UI_DATA_PROVIDER_WRAPPER_ABI = [
  {
    type: 'function',
    name: 'getUserAccountData',
    inputs: [
      {
        name: 'prices',
        type: 'tuple[]',
        components: PRICE_UPDATE_COMPONENTS,
      },
      { name: 'provider', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'ResultData',
    inputs: [{ name: 'data', type: 'bytes' }],
  },
  {
    type: 'error',
    name: 'PriceUpdateFailed',
    inputs: [
      { name: 'assetId', type: 'bytes32' },
      { name: 'reason', type: 'bytes' },
    ],
  },
] as const;

const USER_ACCOUNT_DATA_OUTPUTS = [
  { name: 'totalCollateralBase', type: 'uint256' },
  { name: 'totalDebtBase', type: 'uint256' },
  { name: 'availableBorrowsBase', type: 'uint256' },
  { name: 'currentLiquidationThreshold', type: 'uint256' },
  { name: 'ltv', type: 'uint256' },
  { name: 'healthFactor', type: 'uint256' },
] as const;

interface CacheEntry {
  updates: KaskadPriceUpdate[];
  fetchedAt: number;
  inflight: Promise<KaskadPriceUpdate[]> | null;
}

/** Strict fetch/cache client: no stale fallback for bot safety. */
export class KaskadEnclaveClient {
  private readonly cache = new Map<string, CacheEntry>();

  public async getFresh(baseUrl: string): Promise<KaskadPriceUpdate[]> {
    if (!baseUrl) {
      throw new Error('Kaskad enclave API URL is not configured');
    }

    const key = baseUrl.replace(/\/+$/, '');
    const entry = this.getEntry(key);
    const age = Date.now() - entry.fetchedAt;

    if (entry.updates.length > 0 && age < KASKAD_PRICE_CACHE_TTL_MS) {
      return entry.updates;
    }

    if (entry.inflight) {
      return entry.inflight;
    }

    entry.inflight = this.fetchPrices(key)
      .then((updates) => {
        if (updates.length === 0) {
          throw new Error('Kaskad relayer returned an empty price bundle');
        }
        entry.updates = updates;
        entry.fetchedAt = Date.now();
        return updates;
      })
      .finally(() => {
        entry.inflight = null;
      });

    return entry.inflight;
  }

  private getEntry(key: string): CacheEntry {
    const entry = this.cache.get(key) ?? { updates: [], fetchedAt: 0, inflight: null };
    this.cache.set(key, entry);
    return entry;
  }

  private async fetchPrices(baseUrl: string): Promise<KaskadPriceUpdate[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), KASKAD_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}/prices`, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const body = (await response.json()) as PricesResponse;
      return (body.prices ?? []).map((p) => ({
        assetId: p.asset_id as Hex,
        price: BigInt(p.price),
        timestamp: BigInt(p.timestamp),
        numSources: p.num_sources,
        sourcesHash: p.sources_hash as Hex,
        signature: p.signature as Hex,
      }));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function hasKaskadReadWrapper(chain: ChainConfig): boolean {
  return Boolean(
    chain.kaskad?.uiDataProviderWrapper &&
      chain.kaskad?.enclaveApiUrl &&
      chain.aaveContracts?.poolAddressesProvider,
  );
}

export function isKaskadConfigured(chain: ChainConfig): boolean {
  return Boolean(
    chain.kaskad?.priceOracle ||
      chain.kaskad?.router ||
      chain.kaskad?.uiDataProviderWrapper ||
      chain.kaskad?.enclaveApiUrl,
  );
}

export function getKaskadVaultLiquidationUnsupportedError(chain: ChainConfig): string | null {
  if (!isKaskadConfigured(chain)) return null;

  return (
    `Kaskad oracle liquidation is disabled for ${chain.name}: ` +
    'AgentVaultV3.liquidate calls Aave Pool.liquidationCall directly with vault funds and cannot atomically submit Kaskad signed prices. ' +
    'KaskadRouter.liquidateWithPrices uses msg.sender funds/approvals and would bypass AgentVaultV3 vault accounting/semantics. ' +
    'Skipping liquidation until a vault-level Kaskad price-update liquidation path is deployed.'
  );
}

export async function getUserAccountDataViaKaskadWrapper(
  client: PublicClient,
  chain: ChainConfig,
  userAddress: string,
  enclaveClient: KaskadEnclaveClient,
): Promise<UserAccountData> {
  if (!chain.aaveContracts) {
    throw new Error(`Chain ${chain.name} has no Aave contracts`);
  }

  if (!hasKaskadReadWrapper(chain)) {
    throw new Error(
      `Kaskad read wrapper is not fully configured for ${chain.name}; refusing direct Pool.getUserAccountData because it may use stale oracle prices`,
    );
  }

  const prices = await enclaveClient.getFresh(chain.kaskad!.enclaveApiUrl!);
  const data = encodeFunctionData({
    abi: UI_DATA_PROVIDER_WRAPPER_ABI,
    functionName: 'getUserAccountData',
    args: [
      prices,
      chain.aaveContracts.poolAddressesProvider! as `0x${string}`,
      userAddress as `0x${string}`,
    ],
  });

  try {
    const result = await client.call({
      to: chain.kaskad!.uiDataProviderWrapper! as `0x${string}`,
      data,
    });
    const raw = result.data ?? '0x';
    throw new Error(
      `UiDataProviderWrapper.getUserAccountData returned without ResultData revert (raw=${raw.slice(0, 18)}…); wrapper may be misdeployed`,
    );
  } catch (error) {
    const revertData = extractRevertData(error);
    if (!revertData) {
      throw error;
    }

    const decoded = decodeErrorResult({
      abi: UI_DATA_PROVIDER_WRAPPER_ABI,
      data: revertData,
    });

    if (decoded.errorName === 'PriceUpdateFailed') {
      const [assetId, reason] = decoded.args;
      throw new Error(
        `UiDataProviderWrapper.getUserAccountData: PriceUpdateFailed for assetId=${assetId} reason=${reason}`,
      );
    }

    if (decoded.errorName !== 'ResultData') {
      throw error;
    }

    const [innerData] = decoded.args;
    const values = decodeAbiParameters(USER_ACCOUNT_DATA_OUTPUTS, innerData);

    return {
      totalCollateralBase: values[0],
      totalDebtBase: values[1],
      availableBorrowsBase: values[2],
      currentLiquidationThreshold: values[3],
      ltv: values[4],
      healthFactor: values[5],
      user: userAddress,
    };
  }
}

function extractRevertData(error: unknown): Hex | null {
  const seen = new Set<unknown>();

  function visit(value: unknown, depth: number): Hex | null {
    if (depth > 5 || value == null) return null;
    if (typeof value === 'string') {
      return value.startsWith('0x') ? (value as Hex) : null;
    }
    if (typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);

    const record = value as Record<string, unknown>;
    const directKeys = ['data', 'error', 'cause', 'details', 'info', 'shortMessage'];
    for (const key of directKeys) {
      const found = visit(record[key], depth + 1);
      if (found) return found;
    }

    for (const nested of Object.values(record)) {
      const found = visit(nested, depth + 1);
      if (found) return found;
    }

    return null;
  }

  return visit(error, 0);
}
