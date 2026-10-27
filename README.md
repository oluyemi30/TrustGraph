# TrustGraph — On-Chain Trust & Reputation Protocol on Robinhood Chain Testnet

TrustGraph is an open-source, provenance-aware trust and reputation protocol built for **Robinhood Chain Testnet** (`Chain ID: 46630`). It enables contributors and EVM wallets to publish verifiable on-chain attestations, sign gasless off-chain assertions, explore entity relationship graphs, inspect multi-source reputation breakdowns, and interact via a Telegram bridge (`@trustmvpbot`).

---

## 1. What TrustGraph Does

Traditional reputation trackers collapse verified transactions, anonymous comments, and AI summaries into a single opaque score. TrustGraph separates every claim by cryptographic provenance:

1. **Verified On-Chain Attestations (`onchain_verified`)**: Settled on **Robinhood Chain Testnet (`46630`)** via `TrustGraphRegistry.sol`. Verified server-side by inspecting the transaction receipt (`status === 1`), contract address, emitted `AttestationCreated` / `AttestationRevoked` logs, and live contract state.
2. **Wallet-Signed Off-Chain Attestations (`offchain_signed`)**: Gasless EIP-191 wallet signatures verified cryptographically against the signer's EVM address.
3. **Unverified Community Claims (`offchain_community`)**: Web or Telegram user-submitted assessments stored explicitly as unverified community signals.
4. **Supplementary External Protocol Data (`external_intuition`)**: Optional knowledge-graph records imported from Intuition Protocol (Base), isolated from Robinhood Chain records.
5. **Off-Chain AI Risk Interpretations**: Analytical summaries generated server-side via Gemini (`@google/genai`) or deterministic heuristics—never treated or counted as on-chain evidence.

---

## 2. System Architecture

```text
contracts/
  TrustGraphRegistry.sol       # Solidity ^0.8.28 attestation & revocation registry

scripts/
  compile-contracts.ts         # Compiles Solidity via solc 0.8.28 -> artifacts/ & src/lib/trustGraphAbi.ts
  deploy-testnet.ts            # Deploys TrustGraphRegistry to Robinhood Chain Testnet (46630)

src/
  lib/
    robinhoodChain.ts          # ROBINHOOD_TESTNET config (46630), subjectId/evidenceHash, wallet switching
    trustGraphContract.ts      # Reusable contract client (attest, revoke, fee estimation, 9 tx states)
    trustGraphAbi.ts           # Generated ABI from compiled contract
    api.ts                     # Typed API client supporting custom gateway URLs
  components/
    TrustGraphCanvas.tsx       # Interactive SVG graph explorer with provenance filters & inspector
    AttestationPanel.tsx       # On-chain, wallet-signed, community & tx-verification workflows
    EntityProfileView.tsx      # Multi-source reputation breakdown, AI analysis & revocation UI
    NetworkAndBotView.tsx      # Robinhood Chain sync, nonce-signed Telegram link & bot simulator
  App.tsx                      # Main responsive Robinhood Chain-inspired web application

server/
  robinhood/
    client.ts                  # Configurable RPC client, retry/backoff & startup env validation
    registry.ts                # Server-side contract state & summary readers
    verification.ts            # Strict receipt, chainId, contract & event log verification
    indexer.ts                 # Idempotent event indexer with lastProcessedBlock & reorg lookback
  auth.ts                      # Single-use nonce challenge & EIP-191 signature verification
  db.ts                        # Clean StorageAdapter persistence + backward-compatible migration
  ai.ts                        # Server-side Gemini risk interpretation (never exposed to client)
  sync.ts                      # Isolated optional Intuition Protocol external sync
server.ts                      # Express API, rate limiting, Zod validation & Telegram bot polling

test/
  evmHarness.ts                # Local @ethereumjs/vm JSON-RPC node running Chain ID 46630
  TrustGraphRegistry.test.ts   # Smart contract unit tests (attest, errors, superseding, revoke)
  backend.test.ts              # Receipt verification, indexer idempotency, nonce replay & bot tests
```

---

## 3. Robinhood Chain Testnet Configuration

TrustGraph uses the following network parameters consistently across smart contract deployment, frontend wallet switching, and backend verification:

| Parameter | Value |
| :--- | :--- |
| **Network Name** | `Robinhood Chain Testnet` |
| **Chain ID** | `46630` (`0xb626`) |
| **RPC URL (Development)** | `https://rpc.testnet.chain.robinhood.com` |
| **Block Explorer** | `https://explorer.testnet.chain.robinhood.com` |
| **Native Gas Token** | `ETH` (18 decimals) |

> **Production RPC Recommendation:** Use the public `https://rpc.testnet.chain.robinhood.com` endpoint only for development and testnet experimentation. For production or high-throughput indexing, provision a dedicated RPC endpoint with higher rate limits and set `RH_RPC_URL` and `VITE_RH_RPC_URL` in your environment.

---

## 4. Installation & Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Compile the Solidity contract:**
   ```bash
   npm run compile:contracts
   ```

4. **Start the full-stack development server (Port 3000):**
   ```bash
   npm run dev
   ```

5. **Build and run for production:**
   ```bash
   npm run build
   npm start
   ```

---

## 5. Environment Variables

Configure variables in `.env` (never commit real secrets or private keys):

| Variable | Required? | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | Optional | `development` (default) or `production`. |
| `PORT` | Optional | Express & Vite server port (defaults to `3000`). |
| `RH_CHAIN_ID` | Required (Default `46630`) | Target chain ID verified by the backend. |
| `RH_RPC_URL` | Required | Robinhood Chain Testnet JSON-RPC endpoint used for receipt verification and indexing. |
| `RH_EXPLORER_URL` | Optional | Block explorer base URL (`https://explorer.testnet.chain.robinhood.com`). |
| `RH_REGISTRY_ADDRESS` | Required for On-Chain Mode | Deployed `TrustGraphRegistry` contract address on Chain `46630`. Leave blank until deployed. |
| `VITE_RH_RPC_URL` | Optional | Client-side RPC URL passed during `wallet_addEthereumChain`. |
| `VITE_RH_EXPLORER_URL` | Optional | Client-side block explorer URL. |
| `VITE_RH_REGISTRY_ADDRESS` | Optional | Client fallback registry address (also read dynamically from `GET /api/network/status`). |
| `DEPLOYER_PRIVATE_KEY` | Deployment CLI Only | Used **exclusively** by `npm run deploy:testnet` in a secure local/CI shell. Never used by the web server or exposed in `VITE_*` variables. |
| `TELEGRAM_BOT_TOKEN` | Optional | BotFather token to enable live `@trustmvpbot` long-polling. |
| `GEMINI_API_KEY` | Optional | Server-only API key for Gemini AI risk summaries (falls back to deterministic heuristics when omitted). |
| `INTUITION_API_KEY` | Optional | Optional API key for Intuition Protocol GraphQL sync. |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated allowed origins when hosting frontend and backend on separate domains in production. |

---

## 6. Compiling, Testing & Deploying the Smart Contract

### Compile Contract
```bash
npm run compile:contracts
```
Compiles `contracts/TrustGraphRegistry.sol` with `solc 0.8.28` (`evmVersion: 'paris'`, optimizer enabled) and outputs `/artifacts/TrustGraphRegistry.json` and `/src/lib/trustGraphAbi.ts`.

### Run Automated Contract & Backend Tests
```bash
npm test
```
Runs both:
- `npm run test:contracts` — Deploys `TrustGraphRegistry` to an isolated local `@ethereumjs/vm` node (`chainId: 46630`) and tests valid attestations, custom error reverts (`InvalidScore`, `InvalidSubject`, `UnauthorizedAttester`, `AlreadyRevoked`), duplicate `(attester, subjectId)` superseding behavior, multi-wallet score aggregation, and revocation.
- `npm run test:backend` — Verifies chain receipt & event checking, rejection of wallet self-transfers, rejection of wrong-chain transactions, rejection of forged `verified: true` flags, idempotent multi-run event indexing, single-use nonce replay prevention, input validation, and honest Telegram bot responses.

### Deploy to Robinhood Chain Testnet (Chain ID `46630`)
1. Fund a dedicated deployer wallet with **Robinhood Chain Testnet ETH** (never use a main personal wallet).
2. Run the deployment script in your terminal:
   ```bash
   DEPLOYER_PRIVATE_KEY=0xYOUR_FUNDED_TESTNET_PRIVATE_KEY npm run deploy:testnet
   ```
3. The script verifies `chainId === 46630`, checks non-zero ETH balance, deploys `TrustGraphRegistry`, confirms deployed bytecode on-chain, and prints the real contract address and Robinhood Explorer link.
4. Copy the printed contract address into `.env`:
   ```dotenv
   RH_REGISTRY_ADDRESS=0xYourDeployedContractAddress
   VITE_RH_REGISTRY_ADDRESS=0xYourDeployedContractAddress
   ```
5. Restart the server (`npm run dev` or `npm start`).

---

## 7. Wallet Connection, Attestations & Explorer Verification

1. Open the TrustGraph web dashboard in a browser with an injected EVM wallet (MetaMask, Rabby, Coinbase Wallet, Brave Wallet).
2. Click **Connect Wallet**. If your wallet is on another network, click **Switch to Robinhood (46630)**—TrustGraph automatically invokes `wallet_switchEthereumChain` / `wallet_addEthereumChain` for `0xb626`.
3. In **Submit or Verify Trust Attestation**:
   - Choose **On-Chain (46630)** mode.
   - Select or enter an entity name, choose a score (`1` to `5`), and add an optional explanation.
   - Inspect the **On-Chain Payload Preview** (`bytes32 subjectId` and `bytes32 evidenceHash`—no personal data is written on-chain) and the live RPC fee estimate (displayed only when reliable fee data is returned).
   - Click **Review On-Chain Attestation**, then **Confirm & Sign On-Chain Transaction**.
4. Once mined, TrustGraph verifies the receipt and `AttestationCreated` event log both client-side and server-side (`POST /api/attestations/verify-onchain`) and displays a direct link to verify the transaction on the **Robinhood Chain Testnet Explorer**:
   - `https://explorer.testnet.chain.robinhood.com/tx/<txHash>`
   - `https://explorer.testnet.chain.robinhood.com/address/<registryAddress>`
5. **Revocation**: Open any entity profile under **Entities**. If your connected wallet authored an active on-chain or wallet-signed attestation, click **Revoke Attestation** to revoke it on-chain (`TrustGraphRegistry.revoke(id)`) or via a nonce-authenticated EIP-191 signature. Revoked records remain auditable in history but are immediately excluded from active reputation scores.

---

## 8. Backend Verification & Idempotent Event Indexing

- **Zero Trust in Client Flags**: `POST /api/attestations` ignores client-supplied `verified: true` fields. A record is stored as `onchain_verified` **only** if `verifyOnChainAttestationTx` confirms:
  1. RPC `eth_chainId` equals `46630`.
  2. Transaction receipt exists with `receipt.status === 1`.
  3. `receipt.to` matches the configured `RH_REGISTRY_ADDRESS` (ordinary wallet self-transfers are rejected with `wrong_contract`).
  4. Receipt logs contain an authentic `AttestationCreated` event from `RH_REGISTRY_ADDRESS` whose `subjectId` and `evidenceHash` match.
  5. Live `getAttestation(id)` contract state confirms the record.
- **Idempotent Synchronization**: `POST /api/robinhood/sync` (and `/sync` in Telegram) scans `AttestationCreated` and `AttestationRevoked` logs in bounded block windows, tracks `lastProcessedBlock`, rewinds `REORG_LOOKBACK_BLOCKS` (6 blocks) on incremental runs to handle shallow chain reorganizations, and upserts by `(chainId, contractAddress, onchainAttestationId)` so repeated syncs never create duplicates.

---

## 9. Telegram Bot (`@trustmvpbot`) & Nonce Wallet Linking

- **Bot Link**: [https://t.me/trustmvpbot](https://t.me/trustmvpbot)
- **Live Polling**: Set `TELEGRAM_BOT_TOKEN` in `.env` and start the server. You can also test all bot commands without a token in **Network & Bot → Interactive Telegram Command Verifier**.
- **Supported Commands**:
  - `/start` — Protocol overview and provenance guide.
  - `/trust <entity>` — Separated reputation breakdown + off-chain AI risk summary.
  - `/entities` — Browse indexed entities with verified vs off-chain counts.
  - `/graph <entity>` — Inspect relationship triples and provenance tags.
  - `/attest <entity> <1-5> <comment>` — Records an **Off-Chain Unverified Community Claim** and guides the user to the Web Dashboard for on-chain signing (never fabricates transaction hashes or collects private keys).
  - `/verify <txHash> [entity]` — Verifies a real Robinhood Chain Testnet transaction receipt on-chain.
  - `/sync` — Synchronizes verified `TrustGraphRegistry` events from Robinhood Chain Testnet.
  - `/wallet` & `/activate <code>` — Completes single-use nonce-verified wallet linking initiated from the Web Dashboard.
  - `/testnet` — Displays Robinhood Chain Testnet RPC and Explorer configuration.

---

## 10. Optional Intuition Integration

TrustGraph preserves its Intuition Protocol GraphQL connector (`POST /api/sync-intuition` and `/sync intuition`) as an isolated supplementary data source:
- Imported records are labeled `External · Intuition (Base)` and never counted as Robinhood Chain attestations.
- If the external GraphQL endpoint is unreachable, sync reports the failure transparently rather than fabricating mainnet records. Developers may explicitly opt into labeled `Sample Data · Dev Only` records, which are excluded from live reputation calculations.

---

## 11. Trust Model, Security Considerations & Known Limitations

- **Unaudited Testnet Smart Contract**: `TrustGraphRegistry.sol` has not undergone an external third-party security audit. Do not use it to custody funds or govern mainnet value without a formal audit.
- **No Built-In Sybil Resistance**: While `TrustGraphRegistry` prevents a single wallet from stacking multiple active attestations on the same `subjectId` (via automatic superseding), an actor can still create multiple funded wallets. Trust scores represent community and wallet signals, not guarantees of safety or identity verification.
- **Privacy On-Chain**: Only `bytes32 subjectId` and `bytes32 evidenceHash` hashes are written on-chain. Never submit personal phone numbers, private keys, or confidential documents into public attestation comments.
- **Local Persistence**: By default, data is persisted atomically to `data/database.json` behind the `StorageAdapter` interface in `server/db.ts`. For multi-instance production deployments, implement a PostgreSQL `StorageAdapter` backed by transactional row locks.
