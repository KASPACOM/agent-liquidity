# End-to-End Test Plan — Vault + DEX + Arbitrage

**Goal:** Run a realistic multi-user DEX session with the vault doing LP + arb, track everything on-chain, produce a detailed P&L report with proof.

---

## Phase 1: Vault Setup

1. **Fund vault with WKAS**
   - Deposit 500 iKAS → vault wraps to WKAS
   - TX proof required

2. **Whitelist tokens**
   - WKAS, ALPHA, BETA, GAMMA (existing tokens)
   - TX proof for each whitelist call

3. **Snapshot NAV**
   - Call `snapshotNAV()` to set baseline for circuit breaker

## Phase 2: Pool Setup (3 pairs minimum)

Using existing pairs with liquidity:
- ALPHA/WKAS (`0x2794...`)
- BETA/WKAS (`0xBAD1...`)
- GAMMA/WKAS (`0x9C7f...`)

Seed additional liquidity if needed.

## Phase 3: Multi-User Trading (5 wallets, 15+ min)

| Wallet | Role | Strategy |
|--------|------|----------|
| Wallet 1 | **Vault (LP Manager)** | Add/remove liquidity via vault, rebalance |
| Wallet 2 | **Vault (Arbitrageur)** | Cross-pair arb via vault when spread > 2% |
| Wallet 3 | **Whale Trader** | Large swaps via router (creates price impact for arb) |
| Wallet 4 | **Retail Trader A** | Small random swaps via router |
| Wallet 5 | **Retail Trader B** | Small random swaps via router |

### Flow:
```
T=0:    Vault adds liquidity to all 3 pairs
T=1-15: Whale + Retail traders create volume and price movement
        Vault arb engine detects cross-pair spread
        Vault executes arb trades
        Vault monitors IL — removes LP if threshold hit
T=15:   Vault removes all LP positions
        Calculate final P&L
```

## Phase 4: Report Generation

### On-Chain Proof
Every single TX logged with:
- TX hash + explorer link
- Function called
- Token amounts in/out
- Gas cost
- Block number + timestamp

### Vault P&L Report
```
═══════════════════════════════════════
    VAULT P&L REPORT — E2E Test
═══════════════════════════════════════

VAULT: 0xEB661B0baE5383c0789DF2C7FEc190C633c9D1c8

STARTING STATE:
  NAV: 500 KAS
  Positions: none
  
LP INCOME:
  Pair 1 (ALPHA/WKAS):
    Entry: [tx] | Exit: [tx]
    Fees earned: X.XX KAS
    IL: -X.XX KAS
    Net: +X.XX KAS
  Pair 2 (BETA/WKAS):
    ...
  Pair 3 (GAMMA/WKAS):
    ...

ARBITRAGE:
  Total arb trades: N
  Profitable: N
  Total arb profit: X.XX KAS
  Best arb: +X.XX KAS [tx link]
  
  Trade log:
    1. Buy ALPHA on pair1 @ 0.010 → Sell on pair2 @ 0.012 → +0.XX KAS [tx]
    2. ...

EXPENSES:
  Total gas: X.XX KAS
  
FINAL STATE:
  NAV: XXX KAS
  Net P&L: +X.XX KAS (+X.XX%)
  
ALL TRANSACTIONS: [N total]
  [tx1] [explorer link]
  [tx2] [explorer link]
  ...
```

## Implementation

Single script: `scripts/e2e-vault-test.ts`

Key differences from stress test:
1. **All LP and arb go through vault** (not direct wallet)
2. **Detailed P&L tracking** at token level
3. **Arb detection + execution** (not just random trades)
4. **NAV snapshots** every minute for P&L curve
5. **Report includes every TX with explorer links**
