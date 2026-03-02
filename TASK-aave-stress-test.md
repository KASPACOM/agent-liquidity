# TASK: Aave V3 Stress Test Script on Galleon Testnet

Create `scripts/aave-stress-test.ts` — a standalone script that generates wallets, funds them, and creates diverse Aave positions on Galleon testnet for stress testing the liquidation bot.

## Network: Galleon Testnet (chain 38836)
- RPC: https://galleon-testnet.igralabs.com:8545
- **IMPORTANT: All transactions need --legacy (no EIP-1559). Set `type: 'legacy'` on every tx.**
- Gas price: 2000000000000 (2 twei)

## Aave Contracts (Galleon)
- Pool Proxy: 0xb265EA393A9297472628E21575AE5c7E6458A1F2
- Oracle: 0x5B83681E48f365cfD2A4Ee29E2B699e38e04EbD9
- ProtocolDataProvider: 0xc6b4592171EC79192f838E4050a2453D4D71fBAe
- WrappedTokenGateway: 0x89F4834CEe75f53dFb9F717362DC1a574966632e
- UIPoolDataProvider: 0xCC79B6e8F0389720c099E9621724AEBc97828436

## Token Contracts (Galleon — all mintable with mint(address,uint256))
- WKAS: 0x394C68684F9AFCEb9b804531EF07a864E8081738 (18 decimals)
- USDC: 0xfEE6ee271c2fD76EdAd5De7B8177C3935799111A (6 decimals)
- USDT: 0xb522AC3161D67b6Ed2e311E0036A2F49F903bcc7 (6 decimals)
- DAI:  0x2c680F22600A632c9291c2f1E3b070ED79c1168e (18 decimals)
- WETH: 0x23A8E284A6193C1D6A51A7b34d047ae0b969D660 (18 decimals)
- WBTC: 0x2429526815517B971d45B0899C3D67990A68BcD7 (8 decimals)

## What The Script Does

### 1. Generate 5 wallets
Use `viem`'s `generatePrivateKey()` and `privateKeyToAccount()`.
Save wallet details (address + private key) to `data/stress-test-wallets.json`.

### 2. Fund each wallet from deployer
The deployer key is in env var `IGRA_DEPLOYER_KEY`.
- Send 100 iKAS native to each wallet for gas
- Mint tokens to each wallet based on their scenario (see below)

### 3. Execute scenarios

**Wallet 1: Moderate USDC supplier**
- Mint 5,000 USDC to wallet
- Approve USDC for Pool
- Supply 5,000 USDC to Aave
- Borrow 2,000 USDC worth of WKAS (moderate LTV ~40%)

**Wallet 2: High LTV WKAS borrower (liquidation target)**
- Mint 10,000 USDC to wallet
- Approve + Supply 10,000 USDC
- Borrow maximum WKAS possible (push LTV to ~75-80%)
- This wallet should be liquidatable if WKAS price rises or USDC price drops

**Wallet 3: Multi-asset position**
- Mint 0.5 WBTC + 5,000 USDT to wallet
- Supply 0.5 WBTC as collateral
- Borrow 2,000 USDT + 1,000 USDC

**Wallet 4: Max leverage (most risky)**
- Mint 5 WETH to wallet
- Approve + Supply 5 WETH
- Borrow max USDC possible (push close to liquidation threshold)

**Wallet 5: Stablecoin collateral**
- Mint 10,000 DAI to wallet
- Supply 10,000 DAI
- Borrow 5,000 USDC

### 4. After all positions created, query health factors
For each wallet, call `pool.getUserAccountData(address)` and log:
- totalCollateralBase
- totalDebtBase
- healthFactor
- availableBorrowsBase
- currentLiquidationThreshold

### 5. Save results
Write `data/stress-test-results.json` with:
```json
{
  "timestamp": "ISO date",
  "network": "galleon-testnet",
  "chainId": 38836,
  "wallets": [
    {
      "index": 1,
      "address": "0x...",
      "scenario": "Moderate USDC supplier",
      "collateral": [{ "token": "USDC", "amount": "5000" }],
      "borrows": [{ "token": "WKAS", "amount": "..." }],
      "healthFactor": "1.xx",
      "totalCollateralUsd": "...",
      "totalDebtUsd": "...",
      "txHashes": ["0x..."]
    }
  ]
}
```

## Technical Notes

### Transaction format (CRITICAL)
Galleon doesn't support EIP-1559. Every `writeContract` and `sendTransaction` call MUST include:
```typescript
{
  type: 'legacy' as const,
  gasPrice: 2000000000000n,  // 2 twei
}
```

### Aave supply flow (from frontend service)
1. `erc20.approve(poolAddress, amount)` — approve token for Pool
2. `pool.supply(asset, amount, onBehalfOf, referralCode=0)` — supply to Aave
3. `pool.setUserUseReserveAsCollateral(asset, true)` — enable as collateral (may be default)

### Aave borrow flow
1. `pool.borrow(asset, amount, interestRateMode=2, referralCode=0, onBehalfOf)` — borrow
   - interestRateMode: 2 = variable rate

### Health factor query
```typescript
const data = await pool.read.getUserAccountData([address]);
// Returns: [totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor]
// healthFactor is in 18 decimals (1e18 = 1.0)
```

### To determine borrow amounts
- First supply, then call getUserAccountData to get availableBorrowsBase
- For high LTV scenarios, borrow ~90% of availableBorrowsBase
- For moderate scenarios, borrow ~50% of availableBorrowsBase

### Pool ABI is at
`src/modules/liquidation/abi/pool.json` — use it with `import poolAbi from '../modules/liquidation/abi/pool.json'` or inline the needed functions.

## Dependencies
- viem (already installed)
- dotenv (already installed)
- NO new dependencies

## Run with
```bash
npx tsx scripts/aave-stress-test.ts
```

## Don't Do
- Don't modify any existing source files
- Don't add npm dependencies
- Don't use ethers.js — use viem only
- Don't hardcode the deployer private key — read from process.env.IGRA_DEPLOYER_KEY
- Don't skip the legacy tx type — it WILL fail without it
