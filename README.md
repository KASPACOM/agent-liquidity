# Agent Liquidity Manager

AI-powered liquidity manager for KaspaCom DEX (Uniswap V2 fork on IGRA/Kasplex).

Monitors DEX pools, rebalances inventory, and provides liquidity autonomously — all operations routed through an on-chain AgentVault contract with risk limits.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                Agent Liquidity Manager                │
│                                                       │
│  ┌─────────┐   ┌────────────┐   ┌─────────────────┐ │
│  │ Monitor  │──▶│ Rebalancer │──▶│ GOAT SDK Plugin │ │
│  │          │   │ (Strategy) │   │ (KaspaCom DEX)  │ │
│  └────┬─────┘   └────────────┘   └───────┬─────────┘ │
│       │                                   │           │
│  Reads pair data                  Executes trades     │
│  from API + RPC                   through vault       │
└───────┼───────────────────────────────────┼───────────┘
        │                                   │
        ▼                                   ▼
┌───────────────┐                 ┌─────────────────┐
│ dev-api-defi  │                 │  AgentVault.sol  │
│ .kaspa.com    │                 │  (on-chain)      │
│               │                 │                  │
│ GET /dex/pairs│                 │ swap()           │
│ ?network=     │                 │ addLiquidity()   │
│  kasplex      │                 │ removeLiquidity()│
└───────────────┘                 │                  │
                                  │ Risk limits:     │
                                  │ • 100 KAS/trade  │
                                  │ • 5,000 KAS/day  │
                                  └────────┬─────────┘
                                           │
                                           ▼
                                  ┌─────────────────┐
                                  │  KaspaCom DEX    │
                                  │  (Uni V2 Router) │
                                  │  101 active pairs│
                                  └─────────────────┘
```

## Components

| Component | File | What It Does |
|-----------|------|-------------|
| **Config** | `src/config.ts` | Network, contract addresses, top 5 target pairs, risk params |
| **Monitor** | `src/monitor.ts` | Reads pair reserves + prices via Factory/Pair contracts |
| **Rebalancer** | `src/rebalancer.ts` | Decides what action to take: swap, add LP, remove LP, or nothing |
| **Agent Loop** | `src/index-goat.ts` | Main loop — runs every 30s, checks all pairs, executes actions |
| **GOAT Plugin** | `src/plugins/kaspacom-dex/` | KaspaCom DEX plugin for GOAT SDK — 7 tools (swap, LP, quotes, balances) |
| **Legacy Agent** | `src/index.ts` | Original ethers.js version (backup, not used in production) |

## Target Pairs (Top 5 by WKAS Reserves)

| Pair | WKAS Reserves | Pair Address |
|------|--------------|--------------|
| TKCOM/WKAS | 206,612 | `0xc0d4db7b461f760ce1d7823fa715949f0e6e0bf3` |
| TLFG/WKAS | 150,000 | `0x7ab1a8b1346103bd3deea425e59e1d818a952d43` |
| SPRKAS/WKAS | 100,555 | `0x2e3cabef509e3e1b457ef15e9ede4e97c9c3b66e` |
| LFG/WKAS | 80,130 | `0xf8e2470742e46fdf0dd4e3a4347020b00d7bca52` |
| KCOM/WKAS | 79,576 | `0xe22039fb01649641a2893520b7a290413b1a629b` |

---

## Branching & Environments

| Branch | Environment | Triggers | Deploys To |
|--------|-------------|----------|------------|
| `develop` | **Dev / Staging** | Push to develop | ECR dev → ArgoCD dev cluster |
| `main` | **Production** | Push to main | ECR prod → ArgoCD prod cluster |

**Workflow:**
```
feature/xxx  →  PR to develop  →  merge (1 approval)  →  auto-deploy to dev
                develop        →  PR to main           →  merge (1 approval)  →  auto-deploy to prod
```

No direct pushes to `develop` or `main`. All changes go through PRs.

---

## Infra Setup Guide

### 1. Branch Protection (GitHub — requires admin)

Go to **Settings → Branches → Add rule** for both `develop` and `main`:

- [x] Require a pull request before merging
  - Required approvals: **1**
  - Dismiss stale reviews: **yes**
- [x] Require linear history
- [ ] Allow force pushes: **no**
- [ ] Allow deletions: **no**

Set **default branch** to `develop`.

### 2. Create ECR Repositories (one-time)

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

### 3. GitHub Secrets

These should already exist from `api-defi`. Verify in **Settings → Secrets → Actions**:

| Secret | Purpose |
|--------|---------|
| `AWS_ACCESS_KEY_ID` | ECR push access |
| `AWS_SECRET_ACCESS_KEY` | ECR push access |
| `SSH_PRIVATE_KEY` | npm install from private repos (if needed) |
| `ARGO_GH_APP_ID` | GitHub App for ArgoCD repo updates |
| `ARGO_GH_APP_PRIVATE_KEY` | GitHub App for ArgoCD repo updates |

### 4. ArgoCD Manifests

Copy the templates from `k8s/dev/` in this repo to the ArgoCD repo:

**Dev environment:**
```bash
# In KASPACOM/argo-cd repo
mkdir -p dev/dev-a-eu1-cluster/kaspa-agent-liquidity
cp k8s/dev/* dev/dev-a-eu1-cluster/kaspa-agent-liquidity/
```

**Prod environment:**
```bash
mkdir -p prod/prod-a-ue1-cluster/kaspa-agent-liquidity
# Copy and adjust k8s/dev/* for prod values
```

**Update the configmap** with real values:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-liquidity
  namespace: kaspa
data:
  RPC_URL: "https://rpc.kasplextest.xyz"           # prod: mainnet RPC
  DEX_ROUTER: "0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e"
  DEX_FACTORY: "0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E"
  WKAS: "0xf40178040278E16c8813dB20a84119A605812FB3"
  VAULT_ADDRESS: "0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9"
  API_BASE_URL: "https://dev-api-defi.kaspa.com"    # prod: prod API
  LP_FEE_BPS: "100"                                  # 1%
```

**Create an ExternalSecret** for the deployer private key (never in configmap):

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
    name: agent-liquidity
  data:
    - secretKey: DEPLOYER_PRIVATE_KEY
      remoteRef:
        key: kaspacom/agent-liquidity
        property: deployer_private_key
```

### 5. Create ArgoCD Application

```yaml
# dev/dev-a-eu1-cluster/kaspa-agent-liquidity/application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kaspa-agent-liquidity
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/KASPACOM/argo-cd.git
    targetRevision: HEAD
    path: dev/dev-a-eu1-cluster/kaspa-agent-liquidity
  destination:
    server: https://kubernetes.default.svc
    namespace: kaspa
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### 6. Verify Pipeline

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

### 7. Monitoring

The service exposes port **3003**. Add health check when ready:

```yaml
# In deployment.yaml, uncomment:
livenessProbe:
  httpGet:
    path: /health
    port: 3003
  periodSeconds: 15
startupProbe:
  httpGet:
    path: /health
    port: 3003
  failureThreshold: 30
  periodSeconds: 5
```

---

## Local Development

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your deployer key + RPC

# Run (GOAT SDK version)
npm start

# Run (legacy ethers.js version)
npm run start:legacy

# Dev mode (auto-reload)
npm run dev

# Build
npm run build
```

## Contract Addresses

### Kasplex Testnet (Chain 167012)

| Contract | Address |
|----------|---------|
| AgentVault | `0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9` |
| DEX Router | `0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e` |
| DEX Factory | `0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E` |
| WKAS | `0xf40178040278E16c8813dB20a84119A605812FB3` |

### Galleon Testnet (Chain 38836) — Future

| Contract | Address |
|----------|---------|
| DEX Router | `0xC69B228c4591508067c87bf78743080eE1270e2A` |
| DEX Factory | `0xc61aeAdA8888A0e9FF5709A8386c8527CD5065d0` |
| WKAS | `0x394C68684F9AFCEb9b804531EF07a864E8081738` |

## Related Repos

| Repo | Purpose |
|------|---------|
| [kaspacom-contracts](https://github.com/KASPACOM/kaspacom-contracts) | Solidity contracts (AgentVault) |
| [api-defi](https://github.com/KASPACOM/api-defi) | DEX API (pair data source) |
| [defi-frontend](https://github.com/KASPACOM/defi-frontend) | DEX frontend |
| [argo-cd](https://github.com/KASPACOM/argo-cd) | Deployment manifests |
