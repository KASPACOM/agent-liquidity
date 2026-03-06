# TASK: Update E2E Vault Test with Retry Pattern + V2.1 Address

## Files to Modify
- `scripts/e2e-vault-test.ts` — the main E2E test script (1753 lines)

## Changes Required

### 1. Update Vault V2.1 Address
Change line 38:
```typescript
vault: getAddress('0xa3ED9723EbCb88916b1f80c3988A13a49cd372E5'),
```

### 2. Add Pavel's Reliable TX Sending Pattern
The Galleon testnet silently drops ~30% of transactions. After broadcasting, we must poll and retry.

Add this utility function near the top (after imports):

```typescript
const TX_OVERRIDES = {
  type: 0 as const,       // legacy TX only — EIP-1559 rejected
  gasPrice: 2000000000001n, // 1 wei above floor to avoid rounding
  gasLimit: 3000000n,
};

const TX_OVERRIDES_DEPLOY = {
  ...TX_OVERRIDES,
  gasLimit: 10000000n,
};

async function reliableSend(
  contract: Contract,
  method: string,
  args: any[],
  wallet: Wallet | HDNodeWallet,
  label: string,
  overrides: Record<string, any> = {},
  maxRetries = 5,
): Promise<{ receipt: any; hash: string } | null> {
  const provider = wallet.provider!;
  const nonce = await provider.getTransactionCount(wallet.address, 'pending');
  
  const mergedOverrides = { ...TX_OVERRIDES, ...overrides, nonce };
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const tx = await contract.connect(wallet)[method](...args, mergedOverrides);
      const hash = tx.hash;
      console.log(`  📤 ${label} TX: ${hash}`);
      
      // Poll mempool within 3 seconds
      await new Promise(r => setTimeout(r, 3000));
      const txCheck = await provider.getTransaction(hash);
      
      if (!txCheck) {
        // TX was dropped from mempool
        if (attempt < maxRetries) {
          console.log(`  ⚠️  ${label} TX dropped (attempt ${attempt}/${maxRetries}) — rebroadcasting...`);
          continue; // Will rebroadcast with same nonce
        } else {
          console.log(`  ❌ ${label} — all ${maxRetries} retries exhausted`);
          return null;
        }
      }
      
      // TX is in mempool, wait for receipt
      const receipt = await tx.wait();
      if (receipt && receipt.status === 1) {
        console.log(`  ✅ ${label} confirmed | block ${receipt.blockNumber}`);
        return { receipt, hash };
      } else {
        console.log(`  ❌ ${label} REVERTED`);
        return null;
      }
    } catch (err: any) {
      if (attempt < maxRetries && err.message?.includes('timeout')) {
        console.log(`  ⚠️  ${label} timeout (attempt ${attempt}/${maxRetries}) — retrying...`);
        continue;
      }
      console.log(`  ❌ ${label} ERROR: ${err.message?.slice(0, 200)}`);
      return null;
    }
  }
  return null;
}
```

### 3. Replace ALL Direct Contract Calls with `reliableSend`
Find every place in the script that does:
```typescript
const tx = await someContract.connect(wallet).someMethod(...args, overrides);
const receipt = await tx.wait();
```

Replace with:
```typescript
const result = await reliableSend(someContract, 'someMethod', [...args], wallet, 'Label');
if (!result) { /* handle failure */ }
const { receipt, hash } = result;
```

This includes:
- Wallet funding (sending iKAS to wallets)
- WKAS wrapping
- Token approvals
- Router swaps
- Vault deposits/withdrawals
- Any other contract interaction

### 4. For Raw ETH Transfers (wallet funding)
Raw ETH transfers can't use `reliableSend`. Add a separate retry wrapper:

```typescript
async function reliableTransfer(
  from: Wallet | HDNodeWallet,
  to: string,
  value: bigint,
  label: string,
  maxRetries = 5,
): Promise<boolean> {
  const provider = from.provider!;
  const nonce = await provider.getTransactionCount(from.address, 'pending');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const tx = await from.sendTransaction({
        to,
        value,
        nonce,
        ...TX_OVERRIDES,
      });
      console.log(`  📤 ${label} TX: ${tx.hash}`);
      
      await new Promise(r => setTimeout(r, 3000));
      const txCheck = await provider.getTransaction(tx.hash);
      
      if (!txCheck) {
        if (attempt < maxRetries) {
          console.log(`  ⚠️  ${label} TX dropped (attempt ${attempt}/${maxRetries}) — rebroadcasting...`);
          continue;
        }
        console.log(`  ❌ ${label} — all retries exhausted`);
        return false;
      }
      
      const receipt = await tx.wait();
      if (receipt && receipt.status === 1) {
        console.log(`  ✅ ${label} confirmed`);
        return true;
      }
      console.log(`  ❌ ${label} REVERTED`);
      return false;
    } catch (err: any) {
      if (attempt < maxRetries && err.message?.includes('timeout')) {
        console.log(`  ⚠️  ${label} timeout (attempt ${attempt}/${maxRetries}) — retrying...`);
        continue;
      }
      console.log(`  ❌ ${label} ERROR: ${err.message?.slice(0, 200)}`);
      return false;
    }
  }
  return false;
}
```

### 5. Use Chain Time for Any Deadlines
Galleon's block.timestamp is ~3 hours ahead of real time. If there are any deadline calculations:
```typescript
// WRONG
const deadline = Math.floor(Date.now() / 1000) + 600;

// CORRECT
const latestBlock = await provider.getBlock('latest');
const chainTime = latestBlock!.timestamp;
const deadline = chainTime + 600;
```

### 6. Update Wallet Funding Amount
Each wallet needs at least 15 iKAS for gas (3M gas × 2 twei = 6 iKAS per TX).
If `PER_WALLET_NATIVE` is less than 15, increase it. Current is 50, which is fine.

### 7. Do NOT Change
- The trading logic (Random, Trend, MeanRevert, Whale strategies)
- The vault LP/deposit/withdraw logic  
- The P&L report generation
- The wallet HD derivation
- Token addresses
- Router/Factory addresses

### 8. Commit
After all changes, commit with:
```
git add -A && git commit -m "feat: apply Pavel retry pattern + update vault to V2.1

- Vault address: 0xa3ED9723EbCb88916b1f80c3988A13a49cd372E5 (V2.1 with transferOwnership)
- reliableSend(): 5 retries, 3s mempool poll, rebroadcast same nonce
- reliableTransfer(): same pattern for raw ETH sends
- TX_OVERRIDES: legacy type 0, gasPrice 2000000000001
- Chain time for deadlines (Galleon is +3h offset)" --no-verify
```

## Key Context
- This is ethers.js v6 (NOT viem)
- Galleon RPC: `https://galleon-testnet.igralabs.com:8545`
- Chain ID: 38836
- ~30% of TXs are silently dropped from mempool
- EIP-1559 is rejected — must use legacy (type 0) transactions
- The script should still work end-to-end after these changes
