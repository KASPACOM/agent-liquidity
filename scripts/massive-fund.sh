#!/bin/bash
# Massive Aave Stress Test — Galleon Testnet (38836)
set -euo pipefail
export PATH="/root/.foundry/bin:$PATH"
source /root/.openclaw/.env

RPC="https://galleon-testnet.igralabs.com:8545"
POOL="0xb265EA393A9297472628E21575AE5c7E6458A1F2"
GATEWAY="0x89F4834CEe75f53dFb9F717362DC1a574966632e"
DEPLOYER="0x537dB45aC71bf8e1f1e28530732FAeabD607778E"
KEY="$IGRA_DEPLOYER_KEY"
L="--legacy --gas-price 2000000000000 --gas-limit 500000 --rpc-url $RPC --private-key $KEY"
LG="--legacy --gas-price 2000000000000 --gas-limit 800000 --rpc-url $RPC --private-key $KEY"
USDC="0xfEE6ee271c2fD76EdAd5De7B8177C3935799111A"
USDT="0xb522AC3161D67b6Ed2e311E0036A2F49F903bcc7"
DAI="0x2c680F22600A632c9291c2f1E3b070ED79c1168e"
WETH="0x23A8E284A6193C1D6A51A7b34d047ae0b969D660"
WBTC="0x2429526815517B971d45B0899C3D67990A68BcD7"
WKAS="0x394C68684F9AFCEb9b804531EF07a864E8081738"
DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
mkdir -p "$DATA_DIR"
EXPLORER="https://explorer.galleon-testnet.igralabs.com/tx"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  MASSIVE AAVE FUNDING — Galleon Testnet"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "━━━ STEP 1: Mint massive supply to deployer ━━━"
mint() {
  local name=$1 addr=$2 amount=$3
  TX=$(cast send $addr "mint(address,uint256)" $DEPLOYER $amount $L 2>&1)
  if echo "$TX" | grep -q "status.*1"; then
    HASH=$(echo "$TX" | grep transactionHash | awk '{print $2}')
    echo "✅ Minted $name | $EXPLORER/$HASH"
  else echo "❌ Failed $name"; fi
}
mint "1M USDC"    $USDC $(python3 -c "print(1_000_000 * 10**6)")
mint "1M USDT"    $USDT $(python3 -c "print(1_000_000 * 10**6)")
mint "500K DAI"   $DAI  $(python3 -c "print(500_000 * 10**18)")
mint "1000 WBTC"  $WBTC $(python3 -c "print(1_000 * 10**8)")
mint "500 WETH"   $WETH $(python3 -c "print(500 * 10**18)")

echo ""
echo "━━━ STEP 1b: Seed pool with liquidity ━━━"
for TOKEN in $USDC $USDT $DAI $WETH $WBTC; do
  cast send $TOKEN "approve(address,uint256)" $POOL $(python3 -c "print(2**256-1)") $L 2>&1 > /dev/null
done
sup() {
  local name=$1 addr=$2 amount=$3
  TX=$(cast send $POOL "supply(address,uint256,address,uint16)" $addr $amount $DEPLOYER 0 $L 2>&1)
  echo "$TX" | grep -q "status.*1" && echo "✅ Supplied $name" || echo "❌ Failed $name"
}
sup "500K USDC" $USDC $(python3 -c "print(500_000 * 10**6)")
sup "500K USDT" $USDT $(python3 -c "print(500_000 * 10**6)")
sup "250K DAI"  $DAI  $(python3 -c "print(250_000 * 10**18)")
sup "200 WETH"  $WETH $(python3 -c "print(200 * 10**18)")
sup "500 WBTC"  $WBTC $(python3 -c "print(500 * 10**8)")
# iKAS via Gateway
TX=$(cast send $GATEWAY "depositETH(address,address,uint16)" 0x0000000000000000000000000000000000000000 $DEPLOYER 0 --value $(python3 -c "print(500 * 10**18)") $LG 2>&1)
echo "$TX" | grep -q "status.*1" && echo "✅ Supplied 500 iKAS via Gateway" || echo "❌ iKAS supply failed"

echo ""
echo "━━━ STEP 2: Generate 10 wallets ━━━"
python3 << 'PYEOF'
import json, secrets, subprocess
wallets = []
for i in range(10):
    key = "0x" + secrets.token_hex(32)
    addr = subprocess.check_output(["cast", "wallet", "address", key]).decode().strip()
    wallets.append({"index": i+1, "privateKey": key, "address": addr})
    print(f"  Wallet {i+1}: {addr}")
json.dump(wallets, open("/home/coder/projects/evm/agent-liquidity/data/massive-fund-wallets.json", "w"), indent=2)
PYEOF

echo ""
echo "━━━ STEP 3: Fund wallets ━━━"
ADDRS=($(python3 -c "import json; [print(w['address']) for w in json.load(open('$DATA_DIR/massive-fund-wallets.json'))]"))
KEYS=($(python3 -c "import json; [print(w['privateKey']) for w in json.load(open('$DATA_DIR/massive-fund-wallets.json'))]"))

fund() {
  local addr=$1; shift
  cast send $addr --value $(python3 -c "print(50 * 10**18)") --rpc-url $RPC --private-key $KEY --legacy --gas-price 2000000000000 --gas-limit 21000 2>&1 > /dev/null
  while [ $# -ge 2 ]; do
    local token=$1 amount=$2; shift 2
    cast send $token "mint(address,uint256)" $addr $amount $L 2>&1 > /dev/null
  done
}

echo "  Funding wallets with iKAS + tokens..."
fund ${ADDRS[0]} $USDC $(python3 -c "print(100000 * 10**6)")
fund ${ADDRS[1]} $USDT $(python3 -c "print(100000 * 10**6)")
fund ${ADDRS[2]} $USDC $(python3 -c "print(50000 * 10**6)") $USDT $(python3 -c "print(50000 * 10**6)")
fund ${ADDRS[3]} $WETH $(python3 -c "print(20 * 10**18)")
fund ${ADDRS[4]} $WBTC $(python3 -c "print(5 * 10**8)")
fund ${ADDRS[5]} $DAI  $(python3 -c "print(100000 * 10**18)")
fund ${ADDRS[6]} $USDC $(python3 -c "print(20000 * 10**6)") $WETH $(python3 -c "print(5 * 10**18)") $WBTC $(python3 -c "print(1 * 10**8)")
fund ${ADDRS[7]} $USDC $(python3 -c "print(10000 * 10**6)") $WETH $(python3 -c "print(10 * 10**18)") $WBTC $(python3 -c "print(2 * 10**8)")
fund ${ADDRS[8]} $USDC $(python3 -c "print(50000 * 10**6)")
fund ${ADDRS[9]} $WETH $(python3 -c "print(15 * 10**18)")
echo "  ✅ All 10 wallets funded"

echo ""
echo "━━━ STEP 4: Create positions ━━━"

pos() {
  local idx=$1 addr=$2 key=$3 scenario=$4; shift 4
  local wL="--legacy --gas-price 2000000000000 --gas-limit 500000 --rpc-url $RPC --private-key $key"
  echo ""
  echo "═══ W$idx: $scenario | $addr ═══"
  
  # Approve all tokens
  for TOKEN in $USDC $USDT $DAI $WETH $WBTC; do
    cast send $TOKEN "approve(address,uint256)" $POOL $(python3 -c "print(2**256-1)") $wL 2>&1 > /dev/null
  done
  
  # Execute operations
  while [ $# -ge 3 ]; do
    local op=$1 token=$2 amount=$3; shift 3
    if [ "$op" = "supply" ]; then
      TX=$(cast send $POOL "supply(address,uint256,address,uint16)" $token $amount $addr 0 $wL 2>&1)
    elif [ "$op" = "borrow" ]; then
      TX=$(cast send $POOL "borrow(address,uint256,uint256,uint16,address)" $token $amount 2 0 $addr $wL 2>&1)
    fi
    HASH=$(echo "$TX" | grep transactionHash | awk '{print $2}')
    STATUS=$(echo "$TX" | grep "^status" | awk '{print $2}')
    [ "$STATUS" = "1" ] && echo "  ✅ $op | $EXPLORER/$HASH" || echo "  ❌ $op FAILED"
  done
}

# Safe positions (HF > 3)
pos 1 ${ADDRS[0]} ${KEYS[0]} "USDC whale — safe" \
  supply $USDC $(python3 -c "print(100000*10**6)") \
  borrow $USDT $(python3 -c "print(30000*10**6)")

pos 2 ${ADDRS[1]} ${KEYS[1]} "USDT whale — safe" \
  supply $USDT $(python3 -c "print(100000*10**6)") \
  borrow $USDC $(python3 -c "print(30000*10**6)")

pos 3 ${ADDRS[2]} ${KEYS[2]} "Stablecoin mix — moderate" \
  supply $USDC $(python3 -c "print(50000*10**6)") \
  supply $USDT $(python3 -c "print(50000*10**6)") \
  borrow $DAI  $(python3 -c "print(60000*10**18)")

# Volatile collateral
pos 4 ${ADDRS[3]} ${KEYS[3]} "ETH whale — moderate" \
  supply $WETH $(python3 -c "print(20*10**18)") \
  borrow $USDC $(python3 -c "print(35000*10**6)")

pos 5 ${ADDRS[4]} ${KEYS[4]} "BTC whale — moderate" \
  supply $WBTC $(python3 -c "print(5*10**8)") \
  borrow $USDC $(python3 -c "print(100000*10**6)") \
  borrow $USDT $(python3 -c "print(50000*10**6)")

pos 6 ${ADDRS[5]} ${KEYS[5]} "DAI → borrow ETH" \
  supply $DAI  $(python3 -c "print(100000*10**18)") \
  borrow $WETH $(python3 -c "print(20*10**18)")

# Multi-asset
pos 7 ${ADDRS[6]} ${KEYS[6]} "Multi-asset portfolio" \
  supply $USDC $(python3 -c "print(20000*10**6)") \
  supply $WETH $(python3 -c "print(5*10**18)") \
  supply $WBTC $(python3 -c "print(1*10**8)") \
  borrow $USDT $(python3 -c "print(30000*10**6)") \
  borrow $DAI  $(python3 -c "print(20000*10**18)")

pos 8 ${ADDRS[7]} ${KEYS[7]} "Mixed volatile+stable" \
  supply $USDC $(python3 -c "print(10000*10**6)") \
  supply $WETH $(python3 -c "print(10*10**18)") \
  supply $WBTC $(python3 -c "print(2*10**8)") \
  borrow $USDT $(python3 -c "print(80000*10**6)")

# 🔴 Near-liquidation
pos 9 ${ADDRS[8]} ${KEYS[8]} "🔴 Near-liquidation (USDC→WETH)" \
  supply $USDC $(python3 -c "print(50000*10**6)") \
  borrow $WETH $(python3 -c "print(int(14.2*10**18))")

pos 10 ${ADDRS[9]} ${KEYS[9]} "🔴 Near-liquidation (ETH→USDC)" \
  supply $WETH $(python3 -c "print(15*10**18)") \
  borrow $USDC $(python3 -c "print(30000*10**6)")

echo ""
echo "━━━ FINAL: Health Factors ━━━"
python3 << 'PYEOF'
import json, subprocess
wallets = json.load(open("/home/coder/projects/evm/agent-liquidity/data/massive-fund-wallets.json"))
pool = "0xb265EA393A9297472628E21575AE5c7E6458A1F2"
rpc = "https://galleon-testnet.igralabs.com:8545"
explorer = "https://explorer.galleon-testnet.igralabs.com/address"
scenarios = ["USDC whale","USDT whale","Stable mix","ETH whale","BTC whale","DAI→ETH","Multi-asset","Mixed","🔴 USDC→WETH","🔴 ETH→USDC"]
results = {"wallets":[]}
for i,w in enumerate(wallets):
    r = subprocess.run(["cast","call",pool,"getUserAccountData(address)(uint256,uint256,uint256,uint256,uint256,uint256)",w["address"],"--rpc-url",rpc],capture_output=True,text=True)
    lines = r.stdout.strip().split("\n")
    coll=int(lines[0].split()[0]); debt=int(lines[1].split()[0]); hf=int(lines[5].split()[0])
    hf_s = f"{hf/1e18:.2f}" if hf<1e60 else "∞"
    risk = "🔴" if hf<1.5e18 else ("🟡" if hf<3e18 else "🟢")
    e = {"index":i+1,"address":w["address"],"scenario":scenarios[i],"collateralUsd":f"{coll/1e8:.0f}","debtUsd":f"{debt/1e8:.0f}","healthFactor":hf_s,"explorerUrl":f"{explorer}/{w['address']}"}
    results["wallets"].append(e)
    print(f"W{i+1:2d} | {w['address'][:14]}... | ${coll/1e8:>10,.0f} coll | ${debt/1e8:>10,.0f} debt | HF {hf_s:>8} {risk} | {scenarios[i]}")
json.dump(results, open("/home/coder/projects/evm/agent-liquidity/data/massive-fund-results.json","w"), indent=2)
print("\nSaved to data/massive-fund-results.json")
PYEOF
echo "━━━ DONE ━━━"
