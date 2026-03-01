# Agent Liquidity Manager

AI-powered liquidity and liquidation manager for KaspaCom DEX + Aave V3.

**Two operational modules:**
1. **DEX Liquidity Management** — Autonomous rebalancing and LP provision (Uniswap V2 fork on IGRA/Kasplex)
2. **Aave Liquidation Bot** — Monitors unhealthy positions and executes liquidations (IGRA networks only)

All operations routed through an on-chain AgentVault contract with risk limits.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Agent Liquidity Manager                              │
│                                                                          │
│  ┌──────────────┐   ┌────────────┐   ┌─────────────────────────────┐  │
│  │ DEX Monitor  │──▶│ Rebalancer │──▶│ GOAT SDK Plugin             │  │
│  │              │   │ (Strategy) │   │ (KaspaCom DEX)              │  │
│  └──────┬───────┘   └────────────┘   └────────┬────────────────────┘  │
│         │                                      │                        │
│  ┌──────▼──────────────────────┐              │                        │
│  │ Liquidation Monitor         │              │                        │
│  │ (IGRA only — Aave V3)       │              │                        │
│  └──────┬──────────────────────┘              │                        │
│         │                                      │                        │
│  Reads pair data + positions           Executes trades/liquidations    │
│  from Graph Nodes or API               through AgentVault              │
└─────────┼────────────────────────────────────┼─────────────────────────┘
          │                                      │
          ▼                                      ▼
┌──────────────────────┐            ┌────────────────────────┐
│ Graph Nodes (k8s)    │            │  AgentVault.sol         │
│ - IGRA subgraphs     │            │  (on-chain)             │
│ - Kasplex subgraphs  │            │                         │
│ - Aave subgraph      │            │ swap()                  │
│                      │            │ addLiquidity()          │
│ OR                   │            │ removeLiquidity()       │
│                      │            │ liquidateAave() (IGRA)  │
│ Public API           │            │                         │
│ dev-api-defi         │            │ Risk limits:            │
│ .kaspa.com           │            │ • 100 KAS/trade         │
└──────────────────────┘            │ • 5,000 KAS/day         │
                                     └────────┬───────────────┘
                                              │
                         ┌────────────────────┴────────────────────┐
                         ▼                                         ▼
                ┌─────────────────┐                    ┌──────────────────┐
                │ KaspaCom DEX     │                    │ Aave V3 Pool     │
                │ (Uni V2 Router)  │                    │ (IGRA only)      │
                │ 100+ active pairs│                    │ Liquidations     │
                └─────────────────┘                    └──────────────────┘
```

---

## Environment Variables

### Required (All Deployments)

```bash
DEPLOYER_PRIVATE_KEY     # Wallet private key (NEVER in configmap, use ExternalSecret)
RPC_URL                  # Primary RPC endpoint
```

### DEX Module

```bash
DEX_ROUTER               # Uniswap V2 Router address
DEX_FACTORY              # Uniswap V2 Factory address  
WKAS                     # Wrapped KAS token address
VAULT_ADDRESS            # AgentVault contract address
API_BASE_URL             # KaspaCom API (pair data source) — optional if using graph nodes
LP_FEE_BPS               # LP fee in basis points (100 = 1%)
```

### Liquidation Module (IGRA networks only)

```bash
LIQUIDATION_ENABLED      # true/false — enables Aave liquidation monitoring
AAVE_POOL                # Aave V3 Pool (proxy) address
AAVE_POOL_DATA_PROVIDER  # Aave V3 PoolDataProvider address
AAVE_ORACLE              # Aave V3 Oracle address
```

**Note:** Kasplex networks have NO Aave deployment. Liquidation module auto-disables when Aave addresses are not configured.

### Graph Node URLs (k8s internal — only accessible inside cluster)

**Recommended for production** — faster, no cache, real-time data.

```bash
# IGRA subgraphs (Caravel/Galleon testnet + Galleon mainnet)
IGRA_GRAPH_NODE_URL=http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-v2-core
IGRA_GRAPH_TOKEN_NODE_URL=http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-tokens

# Kasplex subgraphs (Kasplex testnet + mainnet)
KASPLEX_GRAPH_NODE_URL=http://graph-node-kasplex.graph-node:8000/subgraphs/name/kasplex-testnet-kas-new-v2-core
KASPLEX_GRAPH_TOKEN_NODE_URL=http://graph-node-kasplex.graph-node:8000/subgraphs/name/kasplex-testnet-tokens

# Aave subgraph (IGRA only)
AAVE_SUBGRAPH_URL=http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-aave-v3
```

**Alternative:** Use `API_BASE_URL=https://dev-api-defi.kaspa.com` (works from anywhere, has caching, good for local dev and external access).

### Optional

```bash
LOG_LEVEL                # info/debug/warn/error (default: info)
CHECK_INTERVAL_MS        # monitoring loop interval (default: 30000)
MAX_SLIPPAGE_BPS         # max slippage for trades (default: 100)
TELEGRAM_BOT_TOKEN       # for alerts (future)
TELEGRAM_CHAT_ID         # for alerts (future)
```

---

## Environments & Branches

| Environment | Branch | Network | Chain ID | Modules Active | ECR Registry |
|-------------|--------|---------|----------|----------------|--------------|
| Dev | `develop` | Kasplex Testnet | 167012 | DEX only | `kaspacom/agent-liquidity-dev` (eu-central-1) |
| Dev | `develop` | Galleon Testnet | 38836 | DEX + Liquidation | `kaspacom/agent-liquidity-dev` (eu-central-1) |
| Prod | `main` | Kasplex Mainnet | TBD | DEX only | `kaspacom/agent-liquidity-prod` (us-east-1) |
| Prod | `main` | Galleon Mainnet | 38837 | DEX + Liquidation | `kaspacom/agent-liquidity-prod` (us-east-1) |

**Network Differences:**
- **Kasplex** — DEX only (no Aave), uses Kasplex graph nodes or API
- **IGRA (Galleon/Caravel)** — DEX + Aave liquidations, uses IGRA graph nodes or API

---

## Contract Addresses Per Network

### Kasplex Testnet (167012) — DEX Only

| Contract | Address |
|----------|---------|
| AgentVault | `0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9` |
| DEX Router | `0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e` |
| DEX Factory | `0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E` |
| WKAS | `0xf40178040278E16c8813dB20a84119A605812FB3` |

### Galleon Testnet (38836) — DEX + Aave

| Contract | Address |
|----------|---------|
| DEX Router | `0xC69B228c4591508067c87bf78743080eE1270e2A` |
| DEX Factory | `0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0` |
| WKAS | `0x394C68684F9AFCEb9b804531EF07a864E8081738` |
| Aave Pool | `0x631BC5c362ce203B6043844f93f2c67D23a87994` |
| Aave Oracle | `0x6f10A47E2Df6138a36Bc785DA927Ea4072fd4c8f` |
| Aave PoolDataProvider | `0x22B9bDEA931cE0b137DAEf80B2228a288ba05835` |

### Galleon Mainnet (38837) — DEX + Aave

| Contract | Address |
|----------|---------|
| DEX Router | `0xC1E42A2a214eD7bE35c9e89AAA1354d9B28f3640` |
| DEX Factory | `0xd98a97c3bfaa934a8b7298c5d8757967ef30e0a2` |
| WKAS | `0x683917d7fa28dfa4ef9440d79b386e67350cc660` |

### Caravel Testnet (19416) — Legacy IGRA Testnet (Aave Only)

| Contract | Address |
|----------|---------|
| Aave Pool | `0x6715ff97db95D74f92d5a45b8BB3239389F9ddF4` |
| Aave Oracle | `0x0730633De813d5EEbAaD00538c468c01897A23b0` |
| Aave PoolDataProvider | `0x93952B31970a4abf5455BFD80FC90B9c874EF801` |

---

## Data Sources

The agent can retrieve pair/market data via **two methods**:

### 1. Direct Graph Node Queries (Recommended for k8s Deployment)

- **Faster** — no caching layer, real-time data
- **Only accessible inside k8s cluster** — uses internal service DNS
- **Configuration:** Set `IGRA_GRAPH_NODE_URL` / `KASPLEX_GRAPH_NODE_URL` / `AAVE_SUBGRAPH_URL` env vars

**Example (IGRA Galleon Testnet):**
```bash
IGRA_GRAPH_NODE_URL=http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-v2-core
AAVE_SUBGRAPH_URL=http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-aave-v3
```

### 2. Public API (Good for Local Dev & External Access)

- **Works from anywhere** — no k8s cluster access required
- **Has caching** — may lag real-time data by ~10-30s
- **Configuration:** Set `API_BASE_URL` env var

**Example:**
```bash
API_BASE_URL=https://dev-api-defi.kaspa.com
```

**When to use each:**
- **Production k8s deployments** → Graph nodes (method 1)
- **Local development** → Public API (method 2)
- **External monitoring services** → Public API (method 2)

---

## Local Development

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your deployer key + RPC + contract addresses

# Run (GOAT SDK version — production)
npm start

# Run (legacy ethers.js version — backup)
npm run start:legacy

# Dev mode (auto-reload on file changes)
npm run dev

# Build
npm run build

# Type check
npm run type-check

# Lint
npm run lint
```

### Example `.env` for Local Dev (Kasplex Testnet)

```bash
# Network
RPC_URL=https://rpc.kasplextest.xyz

# DEX Module
DEX_ROUTER=0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e
DEX_FACTORY=0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E
WKAS=0xf40178040278E16c8813dB20a84119A605812FB3
VAULT_ADDRESS=0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9
LP_FEE_BPS=100

# Data source (use API for local dev)
API_BASE_URL=https://dev-api-defi.kaspa.com

# Agent wallet (NEVER commit real keys!)
DEPLOYER_PRIVATE_KEY=0x1234...your_test_key_here

# Optional
LOG_LEVEL=debug
CHECK_INTERVAL_MS=30000
```

### Example `.env` for Local Dev (Galleon Testnet with Liquidation)

```bash
# Network
RPC_URL=https://galleon-testnet.igralabs.com:8545

# DEX Module
DEX_ROUTER=0xC69B228c4591508067c87bf78743080eE1270e2A
DEX_FACTORY=0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0
WKAS=0x394C68684F9AFCEb9b804531EF07a864E8081738
VAULT_ADDRESS=0x... # Deploy AgentVault to Galleon first
LP_FEE_BPS=100

# Liquidation Module
LIQUIDATION_ENABLED=true
AAVE_POOL=0x631BC5c362ce203B6043844f93f2c67D23a87994
AAVE_POOL_DATA_PROVIDER=0x22B9bDEA931cE0b137DAEf80B2228a288ba05835
AAVE_ORACLE=0x6f10A47E2Df6138a36Bc785DA927Ea4072fd4c8f

# Data source
API_BASE_URL=https://dev-api-defi.kaspa.com

# Agent wallet
DEPLOYER_PRIVATE_KEY=0x1234...your_test_key_here

# Optional
LOG_LEVEL=debug
CHECK_INTERVAL_MS=30000
```

---

## CI/CD Pipeline

### Workflow

```
feature/xxx  →  PR to develop  →  merge (1 approval)  →  auto-deploy to dev
develop      →  PR to main     →  merge (1 approval)  →  auto-deploy to prod
```

**No direct pushes to `develop` or `main`.** All changes go through PRs.

### GitHub Actions Pipeline

On push to `develop` or `main`:

1. **Build** — `npm run build`
2. **Test** — `npm test` (if tests exist)
3. **Docker Build** — Multi-stage build with npm dependencies
4. **Push to ECR** — Tag with commit SHA + branch
5. **Update ArgoCD** — Automated PR to `KASPACOM/argo-cd` with new image tag
6. **ArgoCD Sync** — Automatically deploys to k8s cluster

**Pipeline status:** https://github.com/KASPACOM/agent-liquidity/actions

---

## Infrastructure Setup Guide

### 1. Create ECR Repositories (one-time)

```bash
# Dev (eu-central-1)
aws ecr create-repository \
  --repository-name kaspacom/agent-liquidity-dev \
  --region eu-central-1

# Prod (us-east-1)
aws ecr create-repository \
  --repository-name kaspacom/agent-liquidity-prod \
  --region us-east-1
```

### 2. GitHub Secrets

Add to **Settings → Secrets → Actions**:

| Secret | Purpose |
|--------|---------|
| `AWS_ACCESS_KEY_ID` | ECR push access |
| `AWS_SECRET_ACCESS_KEY` | ECR push access |
| `ARGO_GH_APP_ID` | GitHub App for ArgoCD repo updates |
| `ARGO_GH_APP_PRIVATE_KEY` | GitHub App for ArgoCD repo updates |

### 3. ArgoCD Manifests

Copy `k8s/dev/` templates to the ArgoCD repo:

```bash
# In KASPACOM/argo-cd repo
mkdir -p dev/dev-a-eu1-cluster/kaspa-agent-liquidity
cp -r k8s/dev/* dev/dev-a-eu1-cluster/kaspa-agent-liquidity/

# For prod
mkdir -p prod/prod-a-ue1-cluster/kaspa-agent-liquidity
# Copy and adjust for prod values
```

### 4. ConfigMap (k8s)

**⚠️ NEVER put private keys in configmaps!**

Example configmap for **Kasplex Testnet (DEX only)**:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-liquidity
  namespace: kaspa
data:
  RPC_URL: "https://rpc.kasplextest.xyz"
  DEX_ROUTER: "0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e"
  DEX_FACTORY: "0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E"
  WKAS: "0xf40178040278E16c8813dB20a84119A605812FB3"
  VAULT_ADDRESS: "0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9"
  LP_FEE_BPS: "100"
  LOG_LEVEL: "info"
  CHECK_INTERVAL_MS: "30000"
  
  # Graph nodes (k8s internal)
  KASPLEX_GRAPH_NODE_URL: "http://graph-node-kasplex.graph-node:8000/subgraphs/name/kasplex-testnet-kas-new-v2-core"
  KASPLEX_GRAPH_TOKEN_NODE_URL: "http://graph-node-kasplex.graph-node:8000/subgraphs/name/kasplex-testnet-tokens"
  
  # Fallback API (optional)
  API_BASE_URL: "https://dev-api-defi.kaspa.com"
```

Example configmap for **Galleon Testnet (DEX + Liquidation)**:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-liquidity
  namespace: kaspa
data:
  RPC_URL: "https://galleon-testnet.igralabs.com:8545"
  DEX_ROUTER: "0xC69B228c4591508067c87bf78743080eE1270e2A"
  DEX_FACTORY: "0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0"
  WKAS: "0x394C68684F9AFCEb9b804531EF07a864E8081738"
  VAULT_ADDRESS: "0x..." # Deploy AgentVault first
  LP_FEE_BPS: "100"
  LOG_LEVEL: "info"
  CHECK_INTERVAL_MS: "30000"
  
  # Liquidation module
  LIQUIDATION_ENABLED: "true"
  AAVE_POOL: "0x631BC5c362ce203B6043844f93f2c67D23a87994"
  AAVE_POOL_DATA_PROVIDER: "0x22B9bDEA931cE0b137DAEf80B2228a288ba05835"
  AAVE_ORACLE: "0x6f10A47E2Df6138a36Bc785DA927Ea4072fd4c8f"
  
  # Graph nodes (k8s internal)
  IGRA_GRAPH_NODE_URL: "http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-v2-core"
  IGRA_GRAPH_TOKEN_NODE_URL: "http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-tokens"
  AAVE_SUBGRAPH_URL: "http://graph-node-igra.graph-node:8000/subgraphs/name/igra-testnet-aave-v3"
  
  # Fallback API
  API_BASE_URL: "https://dev-api-defi.kaspa.com"
```

### 5. ExternalSecret (Private Key)

**Required for all deployments** — stores `DEPLOYER_PRIVATE_KEY` securely.

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: agent-liquidity
  namespace: kaspa
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: agent-liquidity-secret
  data:
    - secretKey: DEPLOYER_PRIVATE_KEY
      remoteRef:
        key: kaspacom/agent-liquidity  # AWS Secrets Manager key
        property: deployer_private_key
```

**Store the private key in AWS Secrets Manager:**

```bash
aws secretsmanager create-secret \
  --name kaspacom/agent-liquidity \
  --description "Agent Liquidity deployer wallet" \
  --secret-string '{"deployer_private_key":"0x1234...your_private_key_here"}' \
  --region eu-central-1  # or us-east-1 for prod
```

### 6. Deployment (k8s)

Example deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-liquidity
  namespace: kaspa
spec:
  replicas: 1
  selector:
    matchLabels:
      app: agent-liquidity
  template:
    metadata:
      labels:
        app: agent-liquidity
    spec:
      containers:
      - name: agent-liquidity
        image: 123456789.dkr.ecr.eu-central-1.amazonaws.com/kaspacom/agent-liquidity-dev:latest
        envFrom:
          - configMapRef:
              name: agent-liquidity
          - secretRef:
              name: agent-liquidity-secret
        ports:
          - containerPort: 3003
            name: http
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        # Optional: health checks
        # livenessProbe:
        #   httpGet:
        #     path: /health
        #     port: 3003
        #   periodSeconds: 15
        # startupProbe:
        #   httpGet:
        #     path: /health
        #     port: 3003
        #   failureThreshold: 30
        #   periodSeconds: 5
```

### 7. Branch Protection (GitHub)

Go to **Settings → Branches → Add rule** for both `develop` and `main`:

- ✅ Require a pull request before merging
  - Required approvals: **1**
  - Dismiss stale reviews: **yes**
- ✅ Require status checks to pass (CI pipeline)
- ✅ Require linear history
- ❌ Allow force pushes: **no**
- ❌ Allow deletions: **no**

Set **default branch** to `develop`.

### 8. Verify Pipeline

```bash
# Create a feature branch, make a change, open PR to develop
git checkout -b feature/test-pipeline
echo "# test" >> README.md
git add -A && git commit -m "test: verify CI/CD pipeline"
git push origin feature/test-pipeline

# Open PR: feature/test-pipeline → develop
# After merge, GitHub Actions builds + pushes to ECR + updates ArgoCD
# ArgoCD syncs → k8s deploys new pod

# Check: https://github.com/KASPACOM/agent-liquidity/actions
```

---

## Components

| Component | File | What It Does |
|-----------|------|-------------|
| **Config** | `src/config.ts` | Network, contract addresses, top 5 target pairs, risk params |
| **DEX Monitor** | `src/monitor.ts` | Reads pair reserves + prices via Factory/Pair contracts or graph |
| **Rebalancer** | `src/rebalancer.ts` | Decides what action to take: swap, add LP, remove LP, or nothing |
| **Liquidation Monitor** | `src/liquidation-monitor.ts` | Monitors Aave positions for health factor < 1.0 (IGRA only) |
| **Agent Loop** | `src/index-goat.ts` | Main loop — runs every 30s, checks all pairs/positions, executes actions |
| **GOAT Plugin** | `src/plugins/kaspacom-dex/` | KaspaCom DEX plugin for GOAT SDK — 7 tools (swap, LP, quotes, balances) |
| **Legacy Agent** | `src/index.ts` | Original ethers.js version (backup, not used in production) |

---

## Target Pairs (Top 5 by WKAS Reserves — Kasplex Testnet)

| Pair | WKAS Reserves | Pair Address |
|------|--------------|--------------|
| TKCOM/WKAS | 206,612 | `0xc0d4db7b461f760ce1d7823fa715949f0e6e0bf3` |
| TLFG/WKAS | 150,000 | `0x7ab1a8b1346103bd3deea425e59e1d818a952d43` |
| SPRKAS/WKAS | 100,555 | `0x2e3cabef509e3e1b457ef15e9ede4e97c9c3b66e` |
| LFG/WKAS | 80,130 | `0xf8e2470742e46fdf0dd4e3a4347020b00d7bca52` |
| KCOM/WKAS | 79,576 | `0xe22039fb01649641a2893520b7a290413b1a629b` |

---

## Monitoring & Observability

### Logs

```bash
# View logs in k8s
kubectl logs -n kaspa deployment/agent-liquidity -f

# View last 100 lines
kubectl logs -n kaspa deployment/agent-liquidity --tail=100

# Filter for errors
kubectl logs -n kaspa deployment/agent-liquidity | grep ERROR
```

### Health Check

The service exposes port **3003**. Add health endpoint when ready:

```typescript
// src/index.ts
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});
```

### Metrics (Future)

Consider adding:
- Prometheus metrics for trades, LP operations, liquidations
- Grafana dashboard for monitoring
- Alerting via Telegram or PagerDuty

---

## Security Best Practices

1. **Private Keys:**
   - NEVER commit `.env` with real keys
   - Use ExternalSecret in k8s (AWS Secrets Manager)
   - Rotate keys periodically

2. **Network Access:**
   - Graph nodes are k8s-internal only (no public exposure)
   - Limit RPC access to trusted endpoints
   - Use VPC security groups for cluster isolation

3. **Risk Limits:**
   - AgentVault enforces on-chain limits (100 KAS/trade, 5,000 KAS/day)
   - Monitor vault balance regularly
   - Set `MAX_SLIPPAGE_BPS` conservatively (default 100 = 1%)

4. **Monitoring:**
   - Set up alerts for failed transactions
   - Monitor gas costs and slippage
   - Track liquidation success rate (IGRA deployments)

---

## Troubleshooting

### Issue: Graph node URLs not accessible

**Symptom:** `ENOTFOUND graph-node-igra.graph-node` or similar DNS errors

**Solution:** Graph nodes are k8s-internal. Use `API_BASE_URL` for local dev or external deployments.

### Issue: Transaction reverts with "insufficient liquidity"

**Symptom:** `execution reverted: UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT`

**Solution:**
- Check pair reserves — may be too low for trade size
- Increase `MAX_SLIPPAGE_BPS` (carefully)
- Reduce trade size in strategy logic

### Issue: Liquidation module not running on Kasplex

**Symptom:** Liquidation logs missing, only DEX operations

**Solution:** Expected behavior — Kasplex has no Aave deployment. Liquidation module auto-disables when `AAVE_POOL` is not configured.

### Issue: ArgoCD sync fails

**Symptom:** `ImagePullBackOff` or `ErrImagePull` in k8s

**Solution:**
- Verify ECR image exists: `aws ecr list-images --repository-name kaspacom/agent-liquidity-dev --region eu-central-1`
- Check k8s service account has ECR pull permissions
- Verify image tag in ArgoCD manifest matches pushed tag

---

## Related Repositories

| Repo | Purpose |
|------|---------|
| [kaspacom-contracts](https://github.com/KASPACOM/kaspacom-contracts) | Solidity contracts (AgentVault, DEX) |
| [api-defi](https://github.com/KASPACOM/api-defi) | DEX API (pair data source) |
| [defi-frontend](https://github.com/KASPACOM/defi-frontend) | DEX frontend UI |
| [argo-cd](https://github.com/KASPACOM/argo-cd) | Deployment manifests for k8s |
| [graph-node-deployments](https://github.com/KASPACOM/graph-node-deployments) | Graph node subgraph deployments |

---

## License

MIT

---

## Support

- **Issues:** https://github.com/KASPACOM/agent-liquidity/issues
- **Team Contact:** Telegram @KASPACOM
