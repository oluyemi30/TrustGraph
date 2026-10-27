import dotenv from 'dotenv';
import { isAddress } from 'ethers';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { ROBINHOOD_TESTNET, getExplorerTxUrl, shortenAddress } from './src/lib/robinhoodChain';
import { explainTrust } from './server/ai';
import {
  verifyChallengeSignature,
  verifyOffChainSignedAttestation,
} from './server/auth';
import { db } from './server/db';
import {
  getRobinhoodConfig,
  getRobinhoodNetworkStatus,
  validateStartupEnvironment,
} from './server/robinhood/client';
import { syncRobinhoodRegistryEvents } from './server/robinhood/indexer';
import {
  verifyOnChainAttestationTx,
  verifyOnChainRevocationTx,
} from './server/robinhood/verification';
import { syncWithIntuitionMainnet } from './server/sync';

dotenv.config();

const startupValidation = validateStartupEnvironment();
if (process.env.TRUSTGRAPH_TEST_MODE !== 'true') {
  startupValidation.warnings.forEach((w) => console.warn(`[Config Notice] ${w}`));
}

export const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '64kb' }));

// -------------------------------------------------------------------------
// Safe CORS Configuration (Never combine wildcard '*' with credentials)
// -------------------------------------------------------------------------
const configuredAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const isProd = process.env.NODE_ENV === 'production';

  if (origin) {
    if (!isProd || configuredAllowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (configuredAllowedOrigins.length === 0) {
      // Allow public read/API calls without credentials when no restricted origin list is set
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  } else if (!isProd) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// -------------------------------------------------------------------------
// Sliding-Window Rate Limiter
// -------------------------------------------------------------------------
interface RateWindow {
  timestamps: number[];
}

const ipRateBuckets = new Map<string, RateWindow>();
const telegramUserRateBuckets = new Map<string, RateWindow>();

function checkSlidingRateLimit(
  store: Map<string, RateWindow>,
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = store.get(key) || { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  if (entry.timestamps.length >= maxRequests) {
    store.set(key, entry);
    return false;
  }
  entry.timestamps.push(now);
  store.set(key, entry);
  return true;
}

function createRateLimitMiddleware(maxRequests: number, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.TRUSTGRAPH_TEST_MODE === 'true') return next();
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();
    const bucketKey = `${clientIp}:${maxRequests}`;
    if (!checkSlidingRateLimit(ipRateBuckets, bucketKey, maxRequests, windowMs)) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please wait briefly before retrying.',
      });
    }
    next();
  };
}

app.use('/api', createRateLimitMiddleware(120, 60_000));

// -------------------------------------------------------------------------
// Request Validation Schemas (Zod)
// -------------------------------------------------------------------------
const EvmAddressSchema = z
  .string()
  .trim()
  .refine((val) => isAddress(val), { message: 'Invalid EVM wallet address format.' });

const CreateAtomSchema = z.object({
  displayName: z.string().trim().min(1, 'Entity name is required').max(80, 'Entity name too long'),
  type: z.enum(['project', 'wallet', 'user']),
  description: z.string().trim().max(400).optional().default(''),
  creator: z.string().trim().max(80).optional(),
  walletAddress: z.string().trim().optional(),
});

const CreateAttestationSchema = z.object({
  from_user: z.string().trim().min(1).max(80),
  to_entity: z.string().trim().min(1).max(80),
  trust_score: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().default(''),
  tx_hash: z.string().trim().optional(),
  signature: z.string().trim().optional(),
  signed_message: z.string().optional(),
  wallet_address: z.string().trim().optional(),
  // Explicitly accept & discard any forged client verification flags so we can audit/ignore them safely
  verified: z.any().optional(),
  verified_onchain: z.any().optional(),
});

const VerifyOnChainTxSchema = z.object({
  txHash: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid 32-byte transaction hash'),
  entityName: z.string().trim().min(1).max(80).optional(),
  comment: z.string().trim().max(500).optional(),
  fromUser: z.string().trim().max(80).optional(),
});

const RevokeOnChainSchema = z.object({
  txHash: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid 32-byte transaction hash'),
  attestationId: z.union([z.string(), z.number()]).optional(),
});

const AuthNonceSchema = z.object({
  walletAddress: EvmAddressSchema,
  purpose: z.enum(['link_wallet', 'unlink_wallet', 'revoke_offchain']),
});

const SignedWalletActionSchema = z.object({
  walletAddress: EvmAddressSchema,
  nonce: z.string().trim().min(8).max(128),
  signature: z.string().trim().min(130).max(200),
});

// -------------------------------------------------------------------------
// Telegram Command Engine (Zero Fabricated Hashes or Fake Confirmations)
// -------------------------------------------------------------------------
export interface TelegramCommandUser {
  id: string;
  username: string;
  first_name: string;
}

function parseArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else {
        inQuotes = true;
        quoteChar = char;
      }
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function escapeHTML(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCategoryBadge(category: string): string {
  switch (category) {
    case 'onchain_verified':
      return '[On-Chain Verified · Robinhood Chain]';
    case 'offchain_signed':
      return '[Off-Chain · Wallet-Signed]';
    case 'external_intuition':
      return '[External · Intuition/Base]';
    case 'external_intuition_sample':
      return '[Sample Data · Dev Only]';
    default:
      return '[Off-Chain · Unverified Community]';
  }
}

export async function processBotMessage(
  text: string,
  user: TelegramCommandUser
): Promise<string> {
  const input = (text || '').trim();
  const username = (user.username || `User_${user.id}`).replace(/^@/, '');

  if (
    process.env.TRUSTGRAPH_TEST_MODE !== 'true' &&
    !checkSlidingRateLimit(telegramUserRateBuckets, user.id || username, 20, 60_000)
  ) {
    return '⏳ <b>Rate limit reached.</b> Please wait a moment before sending more commands.';
  }

  if (!input.startsWith('/')) {
    return '💬 <b>TrustGraph Bot</b> — Type <code>/start</code> to view commands for exploring Robinhood Chain Testnet attestations and entity reputation.';
  }

  const args = parseArgs(input);
  if (args.length === 0) {
    return '❓ <b>Unknown command.</b> Type <code>/start</code> to see available commands.';
  }

  const command = args[0].toLowerCase().split('@')[0];
  const cfg = getRobinhoodConfig();

  switch (command) {
    case '/start': {
      return `🛡️ <b>TrustGraph — On-Chain Reputation Protocol</b>

Primary Network: <b>${escapeHTML(ROBINHOOD_TESTNET.chainName)}</b> (Chain ID <code>${ROBINHOOD_TESTNET.chainId}</code>)
Registry Status: ${
        cfg.registryAddress
          ? `<code>${escapeHTML(shortenAddress(cfg.registryAddress))}</code>`
          : '<i>Awaiting Testnet Contract Deployment</i>'
      }

TrustGraph separates every reputation record by cryptographic provenance:
• <b>Verified On-Chain:</b> Confirmed <code>TrustGraphRegistry</code> receipt &amp; event on Robinhood Chain Testnet.
• <b>Wallet-Signed Off-Chain:</b> EIP-191 signed assertion without gas.
• <b>Community Off-Chain:</b> Unverified user-submitted claim.
• <b>AI Interpretation:</b> Analytical summary (never treated as on-chain proof).

📌 <b>Commands:</b>
• <code>/trust &lt;entity&gt;</code> — View multi-source reputation breakdown &amp; AI risk analysis.
• <code>/entities</code> — Browse indexed entities &amp; verified counts.
• <code>/graph &lt;entity&gt;</code> — Inspect relationship triples and provenance.
• <code>/attest &lt;entity&gt; &lt;1-5&gt; &lt;comment&gt;</code> — Submit an off-chain community claim &amp; get instructions for on-chain signing.
• <code>/verify &lt;txHash&gt; [entity]</code> — Verify a real Robinhood Chain transaction receipt.
• <code>/sync</code> — Synchronize verified events from Robinhood Chain Testnet.
• <code>/wallet</code> — Check wallet link status.
• <code>/activate &lt;code&gt;</code> — Complete nonce-verified wallet linking from the Web Dashboard.
• <code>/testnet</code> — Robinhood Chain Testnet RPC &amp; Explorer setup guide.`;
    }

    case '/attest': {
      if (args.length < 3) {
        return `❌ <b>Missing parameters.</b>
Usage: <code>/attest &lt;entity_name&gt; &lt;score 1-5&gt; &lt;optional_comment&gt;</code>
Example: <code>/attest Ethereum 5 "Reliable developer ecosystem"</code>`;
      }

      const entity = args[1];
      const rating = parseInt(args[2], 10);

      if (isNaN(rating) || rating < 1 || rating > 5) {
        return `❌ <b>Invalid score.</b> Score must be an integer from <b>1 to 5</b>.`;
      }

      const comment = args.slice(3).join(' ').trim() || 'Community trust signal submitted via Telegram.';
      const linkedWallet = db.getLinkedWallet(username);

      const att = db.addOffChainOrExternalAttestation({
        fromUser: username,
        toEntityName: entity,
        trustScore: rating,
        comment,
        category: 'offchain_community',
        walletAddress: linkedWallet,
      });
      const atom = db.findAtom(entity);

      return `📝 <b>Off-Chain Community Claim Recorded</b>

• <b>Subject:</b> <code>${escapeHTML(atom?.displayName || entity)}</code>
• <b>Author:</b> <code>@${escapeHTML(username)}</code>${
        linkedWallet ? ` (Linked wallet: <code>${escapeHTML(shortenAddress(linkedWallet))}</code>)` : ''
      }
• <b>Trust Score:</b> <code>${att.trust_score}/5</code>
• <b>Verification Status:</b> <b>Off-Chain · Unverified Community Claim</b> (NOT confirmed on-chain)
• <b>Comment:</b> <i>"${escapeHTML(comment)}"</i>

🔐 <b>Want to submit a Verified On-Chain Attestation?</b>
Telegram never collects private keys or seed phrases and cannot sign EVM transactions on your behalf.
1. Open the <b>TrustGraph Web Dashboard</b> in a browser with your EVM wallet.
2. Connect to <b>Robinhood Chain Testnet (Chain ID 46630)</b>.
3. Submit your attestation via <code>TrustGraphRegistry.attest()</code>, or verify an existing tx here using <code>/verify &lt;txHash&gt; ${escapeHTML(entity)}</code>.`;
    }

    case '/verify': {
      const txHash = args[1];
      const entityHint = args[2];
      if (!txHash) {
        return `❌ <b>Missing transaction hash.</b>
Usage: <code>/verify &lt;0x_tx_hash&gt; [entity_name]</code>`;
      }

      const verification = await verifyOnChainAttestationTx({
        txHash,
        expectedEntityName: entityHint,
      });

      if ('reason' in verification) {
        return `⚠️ <b>Transaction Not Verified (${escapeHTML(verification.status)})</b>

• <b>Tx Hash:</b> <code>${escapeHTML(txHash)}</code>
• <b>Reason:</b> ${escapeHTML(verification.reason)}`;
      }

      const { record } = db.upsertVerifiedOnChainAttestation({
        chainId: verification.chainId,
        contractAddress: verification.contractAddress,
        txHash: verification.txHash,
        blockNumber: verification.blockNumber,
        logIndex: verification.logIndex,
        onchainAttestationId: verification.attestationId,
        subjectId: verification.subjectId,
        attester: verification.attester,
        score: verification.score,
        evidenceHash: verification.evidenceHash,
        createdAtSec: verification.createdAt,
        revoked: verification.revoked,
        entityNameHint: entityHint,
        fromUserHint: username,
      });

      const explorerLink = getExplorerTxUrl(verification.txHash, cfg.explorerUrl);
      return `✅ <b>Verified On-Chain Attestation Indexed</b>

• <b>Network:</b> Robinhood Chain Testnet (<code>46630</code>)
• <b>Attestation ID:</b> <code>#${escapeHTML(verification.attestationId)}</code>
• <b>Subject:</b> <code>${escapeHTML(record.to_entity)}</code>
• <b>Attester Wallet:</b> <code>${escapeHTML(shortenAddress(verification.attester))}</code>
• <b>Score:</b> <code>${verification.score}/5</code>
• <b>Block:</b> <code>#${verification.blockNumber}</code>
• <b>Explorer:</b> <a href="${escapeHTML(explorerLink)}">View Receipt on Robinhood Explorer ↗</a>`;
    }

    case '/trust': {
      const entity = args[1];
      if (!entity) {
        return `❌ <b>Missing entity name.</b>
Usage: <code>/trust &lt;entity_name&gt;</code>
Example: <code>/trust Ethereum</code>`;
      }

      const atom = db.findAtom(entity);
      if (!atom) {
        return `🔍 <b>Entity Not Found</b>
No entity or attestations found for <code>${escapeHTML(entity)}</code>.
Use <code>/entities</code> to list indexed subjects or submit an attestation on the Web Dashboard.`;
      }

      const stats = db.getEntityStats(atom.name);
      const b = stats.breakdown;

      let aiAnalysis = null;
      try {
        aiAnalysis = await explainTrust(atom.name);
      } catch (err) {
        console.error('[Bot] AI explanation error:', err);
      }

      const recentActive = stats.list
        .filter((a) => !a.revoked)
        .slice(-3)
        .reverse();

      let response = `📊 <b>TrustGraph Profile: ${escapeHTML(atom.displayName)}</b>
• <b>Class:</b> <code>${escapeHTML(atom.type.toUpperCase())}</code>
• <b>Subject ID:</b> <code>${escapeHTML((atom.subject_id || '').slice(0, 14))}...</code>

🛡️ <b>Provenance Breakdown (Separated by Source):</b>
• <b>Verified On-Chain (Robinhood Chain):</b> <code>${b.categories.onchainVerified.activeCount}</code> active (Avg: <b>${b.categories.onchainVerified.simpleAverage || '—'}/5</b>, Revoked: <code>${b.categories.onchainVerified.revokedCount || 0}</code>)
• <b>Wallet-Signed Off-Chain:</b> <code>${b.categories.offchainSigned.activeCount}</code> active (Avg: <b>${b.categories.offchainSigned.simpleAverage || '—'}/5</b>)
• <b>Unverified Community Claims:</b> <code>${b.categories.communityUnverified.activeCount}</code> active (Avg: <b>${b.categories.communityUnverified.simpleAverage || '—'}/5</b>)
• <b>External Protocol (Intuition/Base):</b> <code>${b.categories.externalIntuition.activeCount}</code> active
• <b>Provenance-Weighted Signal:</b> <b>${b.compositeSignal.score || '—'}/5</b>

`;

      if (aiAnalysis) {
        response += `🤖 <b>AI Risk Interpretation (Off-Chain Analysis — Not On-Chain Proof):</b>
<i>${escapeHTML(aiAnalysis.summary)}</i>
${aiAnalysis.riskSignals.map((sig) => `• ${escapeHTML(sig)}`).join('\n')}
• <b>Signal Confidence:</b> <code>${escapeHTML(aiAnalysis.confidenceLevel)}</code>

`;
      }

      if (recentActive.length > 0) {
        response += `📜 <b>Recent Evidence Records:</b>\n${recentActive
          .map(
            (r) =>
              `• <b>${r.trust_score}/5</b> by <code>${escapeHTML(
                r.wallet_address ? shortenAddress(r.wallet_address) : `@${r.from_user}`
              )}</code> ${escapeHTML(formatCategoryBadge(r.evidence_category))}\n  <i>"${escapeHTML(
                r.comment
              )}"</i>`
          )
          .join('\n')}\n\n`;
      }

      response += `ℹ️ <i>Scores reflect community &amp; wallet signals, not guarantees of safety.</i>`;
      return response;
    }

    case '/graph': {
      const entity = args[1];
      if (!entity) {
        return `🕸️ <b>TrustGraph Explorer</b>
Specify an entity to inspect its relationships: <code>/graph &lt;entity_name&gt;</code> (e.g., <code>/graph Ethereum</code>), or open the interactive graph on the Web Dashboard.`;
      }

      const atom = db.findAtom(entity);
      if (!atom) {
        return `🔍 <b>Entity not found:</b> <code>${escapeHTML(entity)}</code>`;
      }

      const relatedTriples = db
        .getTriples(false)
        .filter((t) => t.object.toLowerCase() === atom.name);

      if (relatedTriples.length === 0) {
        return `🕸️ <b>TrustGraph: ${escapeHTML(atom.displayName)}</b>
No active incoming trust relationships recorded yet.`;
      }

      return `🕸️ <b>TrustGraph Relationships: ${escapeHTML(atom.displayName)}</b>
Active Relationships: <code>${relatedTriples.length}</code>

${relatedTriples
  .slice(-8)
  .map(
    (t) =>
      `• <code>${escapeHTML(
        t.subject.startsWith('0x') ? shortenAddress(t.subject) : t.subject
      )}</code> ➜ <code>${escapeHTML(t.predicate)}</code> ➜ <b>${escapeHTML(
        atom.displayName
      )}</b> (<b>${t.score}/5</b>) ${escapeHTML(formatCategoryBadge(t.evidence_category))}`
  )
  .join('\n')}`;
    }

    case '/entities': {
      const top = db.getTopEntities();
      if (top.length === 0) {
        return `📋 <b>Indexed Entities</b>\nNo entities registered yet.`;
      }

      let response = `📋 <b>Indexed TrustGraph Entities (${top.length})</b>\n\n`;
      top.slice(0, 10).forEach((ent, idx) => {
        response += `${idx + 1}. <b>${escapeHTML(ent.displayName)}</b> (<code>${escapeHTML(ent.type)}</code>)
   • On-Chain Verified: <b>${ent.verifiedOnChainCount}</b> | Off-Chain: <code>${ent.offChainCount}</code> | Revoked: <code>${ent.revokedCount}</code>
   • Weighted Signal: <b>${ent.average ? `${ent.average}/5` : 'No active ratings'}</b>\n\n`;
      });
      return response.trim();
    }

    case '/sync': {
      const subTarget = (args[1] || '').toLowerCase();
      if (subTarget === 'intuition') {
        const res = await syncWithIntuitionMainnet();
        return `🔄 <b>Intuition External Source Sync</b>
• <b>Source:</b> ${escapeHTML(res.sourceNetwork)}
• <b>Status:</b> ${res.synced ? 'Completed' : 'Unavailable'}
• <b>Atoms Imported:</b> <code>${res.atomsSynced}</code>
• <b>Claims Imported:</b> <code>${res.claimsSynced}</code>
• <b>Details:</b> ${escapeHTML(res.message)}`;
      }

      try {
        const syncRes = await syncRobinhoodRegistryEvents();
        if (!syncRes.synced) {
          return `⚠️ <b>Robinhood Chain Sync Notice</b>
• <b>Network:</b> Robinhood Chain Testnet (<code>${syncRes.chainId}</code>)
• <b>Details:</b> ${escapeHTML(syncRes.warning || 'Registry not yet configured.')}`;
        }

        return `🔄 <b>Robinhood Chain Testnet Sync Complete</b>

• <b>Chain ID:</b> <code>${syncRes.chainId}</code>
• <b>Registry:</b> <code>${escapeHTML(shortenAddress(syncRes.contractAddress))}</code>
• <b>Blocks Scanned:</b> <code>#${syncRes.fromBlock}</code> → <code>#${syncRes.toBlock}</code>
• <b>Events Verified:</b> <code>${syncRes.createdProcessed}</code> attestations (${syncRes.newlyIndexed} new), <code>${syncRes.revocationsProcessed}</code> revocations`;
      } catch (err: any) {
        return `❌ <b>Robinhood Chain Sync Error:</b> ${escapeHTML(err?.message || 'RPC unavailable')}`;
      }
    }

    case '/wallet':
    case '/linkwallet': {
      const linkedWallet = db.getLinkedWallet(username);
      if (linkedWallet) {
        const allAtts = db.getAttestations(false);
        const onChainByWallet = allAtts.filter(
          (a) =>
            a.verified_onchain &&
            a.wallet_address?.toLowerCase() === linkedWallet.toLowerCase()
        ).length;
        const signedOffChainByWallet = allAtts.filter(
          (a) =>
            a.evidence_category === 'offchain_signed' &&
            a.wallet_address?.toLowerCase() === linkedWallet.toLowerCase()
        ).length;

        return `🔑 <b>Wallet Link Status: Connected</b>

• <b>Telegram Handle:</b> <code>@${escapeHTML(username)}</code>
• <b>Verified Wallet:</b> <code>${escapeHTML(linkedWallet)}</code>
• <b>Verified On-Chain Attestations (Robinhood Chain):</b> <code>${onChainByWallet}</code>
• <b>Signed Off-Chain Claims:</b> <code>${signedOffChainByWallet}</code>

ℹ️ <i>Note: Wallet linking associates your Telegram profile with a signature-verified EVM address. Signing new on-chain Robinhood Chain transactions always happens in your browser wallet on the Web Dashboard—never share private keys in Telegram.</i>`;
      }

      return `🔑 <b>Link Your EVM Wallet Securely</b>

1. Open the <b>TrustGraph Web Dashboard</b> and connect your EVM wallet.
2. Open the <b>Telegram &amp; Network</b> section and click <b>Sign &amp; Generate Activation Code</b> (signs a single-use cryptographic nonce).
3. Send <code>/activate &lt;6_char_code&gt;</code> here within 10 minutes.`;
    }

    case '/activate': {
      const code = args[1];
      if (!code) {
        return `❌ <b>Activation code required.</b>
Usage: <code>/activate &lt;code&gt;</code>`;
      }

      const res = db.activateTelegram(code, username, user.id);
      if (res.success) {
        return `✅ <b>Wallet Ownership Linked</b>

• <b>Telegram Handle:</b> <code>@${escapeHTML(username)}</code>
• <b>Linked Wallet:</b> <code>${escapeHTML(res.walletAddress || '')}</code>

Your Telegram handle is now linked to your verified wallet profile. To submit on-chain attestations on Robinhood Chain Testnet (<code>46630</code>), sign transactions directly in your browser wallet on the Web Dashboard.`;
      }
      return `❌ <b>Activation Failed:</b> ${escapeHTML(res.error || 'Invalid or expired code.')}`;
    }

    case '/testnet': {
      return `🌐 <b>Robinhood Chain Testnet Configuration</b>

• <b>Network Name:</b> <code>${escapeHTML(ROBINHOOD_TESTNET.chainName)}</code>
• <b>Chain ID:</b> <code>${ROBINHOOD_TESTNET.chainId}</code> (<code>${ROBINHOOD_TESTNET.chainIdHex}</code>)
• <b>RPC URL:</b> <code>${escapeHTML(cfg.rpcUrl)}</code>
• <b>Block Explorer:</b> <a href="${escapeHTML(cfg.explorerUrl)}">${escapeHTML(cfg.explorerUrl)}</a>
• <b>Native Gas Token:</b> <code>ETH</code>
• <b>Registry Contract:</b> ${
        cfg.registryAddress
          ? `<code>${escapeHTML(cfg.registryAddress)}</code>`
          : '<i>Not yet deployed — set RH_REGISTRY_ADDRESS after running npm run deploy:testnet</i>'
      }`;
    }

    default: {
      return `❓ <b>Unknown command:</b> <code>${escapeHTML(command)}</code>
Type <code>/start</code> to see supported TrustGraph commands.`;
    }
  }
}

// -------------------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------------------

// Network & Indexer Status
app.get('/api/network/status', async (_req: Request, res: Response) => {
  const netStatus = await getRobinhoodNetworkStatus();
  const indexerState = db.getIndexerState();
  res.json({
    success: true,
    network: netStatus,
    indexer: indexerState,
  });
});

// Synchronize verified events from Robinhood Chain Testnet
app.post(
  '/api/robinhood/sync',
  createRateLimitMiddleware(15, 60_000),
  async (req: Request, res: Response) => {
    try {
      const fromBlock =
        req.body?.fromBlock !== undefined ? Number(req.body.fromBlock) : undefined;
      const syncResult = await syncRobinhoodRegistryEvents({
        fromBlockOverride: Number.isFinite(fromBlock) ? fromBlock : undefined,
      });
      res.json({ success: true, result: syncResult });
    } catch (err: any) {
      res.status(502).json({
        success: false,
        error: err?.message ? String(err.message).slice(0, 180) : 'Failed to synchronize Robinhood Chain events.',
      });
    }
  }
);

// Inspect / verify any Robinhood Chain transaction hash
app.get('/api/robinhood/tx/:txHash', async (req: Request, res: Response) => {
  const txHash = String(req.params.txHash || '').trim();
  const verification = await verifyOnChainAttestationTx({ txHash });
  res.json({
    success: true,
    verification,
  });
});

// Verify & index an on-chain attestation transaction
app.post(
  '/api/attestations/verify-onchain',
  createRateLimitMiddleware(30, 60_000),
  async (req: Request, res: Response) => {
    const parsed = VerifyOnChainTxSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid verification payload.',
      });
    }

    const { txHash, entityName, comment, fromUser } = parsed.data;
    const verification = await verifyOnChainAttestationTx({
      txHash,
      expectedEntityName: entityName,
      expectedComment: comment,
    });

    if ('reason' in verification) {
      return res.status(422).json({
        success: false,
        verification,
        error: verification.reason,
      });
    }

    const { record, created } = db.upsertVerifiedOnChainAttestation({
      chainId: verification.chainId,
      contractAddress: verification.contractAddress,
      txHash: verification.txHash,
      blockNumber: verification.blockNumber,
      logIndex: verification.logIndex,
      onchainAttestationId: verification.attestationId,
      subjectId: verification.subjectId,
      attester: verification.attester,
      score: verification.score,
      evidenceHash: verification.evidenceHash,
      createdAtSec: verification.createdAt,
      revoked: verification.revoked,
      entityNameHint: entityName,
      commentHint: comment,
      fromUserHint: fromUser,
      supersededAttestationId: verification.supersededAttestationId,
    });

    res.json({
      success: true,
      created,
      attestation: record,
      verification,
    });
  }
);

// Verify & index an on-chain revocation transaction
app.post(
  '/api/attestations/revoke-onchain',
  createRateLimitMiddleware(30, 60_000),
  async (req: Request, res: Response) => {
    const parsed = RevokeOnChainSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid revocation payload.',
      });
    }

    const verification = await verifyOnChainRevocationTx({
      txHash: parsed.data.txHash,
      expectedAttestationId: parsed.data.attestationId,
    });

    if ('reason' in verification) {
      return res.status(422).json({
        success: false,
        verification,
        error: verification.reason,
      });
    }

    const updated = db.markOnChainAttestationRevoked({
      chainId: verification.chainId,
      contractAddress: verification.contractAddress,
      onchainAttestationId: verification.attestationId,
      revokedAtSec: verification.revokedAt,
      revocationTxHash: verification.txHash,
    });

    res.json({
      success: true,
      attestation: updated,
      verification,
    });
  }
);

// Revoke an off-chain wallet-signed attestation via cryptographic nonce proof
app.post(
  '/api/attestations/:id/revoke-offchain',
  createRateLimitMiddleware(20, 60_000),
  (req: Request, res: Response) => {
    const attestationId = Number(req.params.id);
    if (!Number.isInteger(attestationId) || attestationId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid attestation ID.' });
    }

    const parsed = SignedWalletActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Valid wallet signature and nonce required.',
      });
    }

    const authCheck = verifyChallengeSignature({
      walletAddress: parsed.data.walletAddress,
      nonce: parsed.data.nonce,
      signature: parsed.data.signature,
      expectedPurpose: 'revoke_offchain',
    });

    if ('error' in authCheck) {
      return res.status(401).json({ success: false, error: authCheck.error });
    }

    try {
      const revokedRecord = db.revokeOffChainAttestation(attestationId, authCheck.walletAddress);
      res.json({ success: true, attestation: revokedRecord });
    } catch (err: any) {
      res.status(403).json({ success: false, error: err?.message || 'Unable to revoke attestation.' });
    }
  }
);

// Retrieve All Identity Atoms with multi-source reputation metrics
app.get('/api/atoms', (_req: Request, res: Response) => {
  const rawAtoms = db.getAtoms();
  const enhancedAtoms = rawAtoms.map((a) => {
    const stats = db.getEntityStats(a.name);
    return {
      ...a,
      average: stats.average || 0,
      simpleAverage: stats.simpleAverage || 0,
      count: stats.count,
      verifiedOnChainCount: stats.verifiedOnChainCount,
      offChainCount: stats.offChainCount,
      revokedCount: stats.revokedCount,
      reputationBreakdown: stats.breakdown,
    };
  });
  res.json({ success: true, atoms: enhancedAtoms });
});

// Retrieve Full Attestation Stream
app.get('/api/attestations', (req: Request, res: Response) => {
  const includeRevoked = req.query.includeRevoked !== 'false';
  res.json({ success: true, attestations: db.getAttestations(includeRevoked) });
});

// Retrieve dynamic Graph Intelligence & Reputation Breakdown for an entity
app.get('/api/intelligence/:entity', (req: Request, res: Response) => {
  try {
    const entity = String(req.params.entity || '').trim();
    if (!entity || entity.length > 100) {
      return res.status(400).json({ success: false, error: 'Valid entity name is required.' });
    }
    const intelligence = db.getGraphIntelligence(entity);
    res.json({ success: true, intelligence });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to compute entity intelligence.' });
  }
});

// Register fresh entity atom
app.post('/api/atoms', createRateLimitMiddleware(30, 60_000), (req: Request, res: Response) => {
  const parsed = CreateAtomSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid entity registration payload.',
    });
  }

  const { displayName, type, description, creator, walletAddress } = parsed.data;
  if (walletAddress && !isAddress(walletAddress)) {
    return res.status(400).json({ success: false, error: 'Invalid walletAddress format.' });
  }

  const atom = db.createAtom(
    displayName,
    type,
    description,
    creator || 'web-dashboard',
    'trustgraph',
    walletAddress
  );
  res.json({ success: true, atom });
});

// Post attestations — NEVER trusts client `verified` flags; verifies chain receipt or EIP-191 signature
app.post(
  '/api/attestations',
  createRateLimitMiddleware(30, 60_000),
  async (req: Request, res: Response) => {
    const parsed = CreateAttestationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid attestation request body.',
      });
    }

    const {
      from_user,
      to_entity,
      trust_score,
      comment,
      tx_hash,
      signature,
      signed_message,
      wallet_address,
    } = parsed.data;

    if (wallet_address && !isAddress(wallet_address)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet_address format.' });
    }

    // Path A: Client supplied a transaction hash -> MUST verify receipt & TrustGraphRegistry event on Robinhood Chain
    if (tx_hash) {
      const verification = await verifyOnChainAttestationTx({
        txHash: tx_hash,
        expectedEntityName: to_entity,
        expectedComment: comment,
      });

      if ('reason' in verification) {
        return res.status(422).json({
          success: false,
          error: `On-chain verification failed: ${verification.reason}`,
          verification,
        });
      }

      const { record } = db.upsertVerifiedOnChainAttestation({
        chainId: verification.chainId,
        contractAddress: verification.contractAddress,
        txHash: verification.txHash,
        blockNumber: verification.blockNumber,
        logIndex: verification.logIndex,
        onchainAttestationId: verification.attestationId,
        subjectId: verification.subjectId,
        attester: verification.attester,
        score: verification.score,
        evidenceHash: verification.evidenceHash,
        createdAtSec: verification.createdAt,
        revoked: verification.revoked,
        entityNameHint: to_entity,
        commentHint: comment,
        fromUserHint: from_user,
        supersededAttestationId: verification.supersededAttestationId,
      });

      return res.json({ success: true, attestation: record, verification });
    }

    // Path B: Client supplied an EIP-191 off-chain signature + signed_message -> Verify cryptographic signature
    if (signature && signed_message && wallet_address) {
      const sigCheck = verifyOffChainSignedAttestation({
        walletAddress: wallet_address,
        signedMessage: signed_message,
        signature,
        expectedEntity: to_entity,
        expectedScore: trust_score,
      });

      if ('error' in sigCheck) {
        return res.status(400).json({
          success: false,
          error: `Invalid wallet signature: ${sigCheck.error}`,
        });
      }

      const signedRecord = db.addOffChainOrExternalAttestation({
        fromUser: from_user,
        toEntityName: to_entity,
        trustScore: trust_score,
        comment,
        category: 'offchain_signed',
        signature,
        walletAddress: sigCheck.signer,
      });

      return res.json({ success: true, attestation: signedRecord });
    }

    // Path C: Unverified off-chain community submission (never marked verified_onchain or offchain_signed)
    const communityRecord = db.addOffChainOrExternalAttestation({
      fromUser: from_user,
      toEntityName: to_entity,
      trustScore: trust_score,
      comment,
      category: 'offchain_community',
    });

    return res.json({ success: true, attestation: communityRecord });
  }
);

// AI explain-layer endpoint (explicitly off-chain interpretation)
app.post(
  '/api/ai-explain',
  createRateLimitMiddleware(25, 60_000),
  async (req: Request, res: Response) => {
    try {
      const entityName = String(req.body?.entityName || '').trim();
      if (!entityName || entityName.length > 100) {
        return res.status(400).json({ success: false, error: 'Valid entityName is required.' });
      }
      const explanation = await explainTrust(entityName);
      res.json({ success: true, explanation });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to generate AI risk explanation.' });
    }
  }
);

// Optional supplementary Intuition External Sync
app.post(
  '/api/sync-intuition',
  createRateLimitMiddleware(10, 60_000),
  async (req: Request, res: Response) => {
    try {
      const allowSampleFallback = Boolean(req.body?.allowSampleFallback);
      const stats = await syncWithIntuitionMainnet({ allowSampleFallback });
      res.json({ success: true, stats });
    } catch {
      res.status(500).json({ success: false, error: 'Intuition external sync failed.' });
    }
  }
);

// -------------------------------------------------------------------------
// Secure Nonce Challenge & Telegram Wallet Linking Endpoints
// -------------------------------------------------------------------------
app.post('/api/auth/nonce', createRateLimitMiddleware(30, 60_000), (req: Request, res: Response) => {
  const parsed = AuthNonceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Valid walletAddress and purpose are required.',
    });
  }

  const hostHeader = String(req.headers.host || 'localhost:3000').replace(/[^a-zA-Z0-9.:-]/g, '');
  const challenge = db.createAuthChallenge(
    parsed.data.walletAddress,
    hostHeader,
    parsed.data.purpose
  );

  res.json({
    success: true,
    nonce: challenge.nonce,
    message: challenge.message,
    expiresAt: challenge.expires_at,
  });
});

app.post(
  '/api/telegram/generate-code',
  createRateLimitMiddleware(15, 60_000),
  (req: Request, res: Response) => {
    const parsed = SignedWalletActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(401).json({
        success: false,
        error:
          'Cryptographic wallet ownership verification (nonce + signature) is required to generate a Telegram link code.',
      });
    }

    const authCheck = verifyChallengeSignature({
      walletAddress: parsed.data.walletAddress,
      nonce: parsed.data.nonce,
      signature: parsed.data.signature,
      expectedPurpose: 'link_wallet',
    });

    if ('error' in authCheck) {
      return res.status(401).json({ success: false, error: authCheck.error });
    }

    const code = db.generateActivationCodeForVerifiedWallet(authCheck.walletAddress);
    res.json({ success: true, code });
  }
);

app.get('/api/telegram/status/:walletAddress', (req: Request, res: Response) => {
  const walletAddress = String(req.params.walletAddress || '').trim();
  if (!isAddress(walletAddress)) {
    return res.status(400).json({ success: false, error: 'Invalid wallet address.' });
  }
  const telegramUser = db.getTelegramUserForWallet(walletAddress);
  res.json({ success: true, linked: !!telegramUser, telegramUser });
});

app.post(
  '/api/telegram/unlink',
  createRateLimitMiddleware(15, 60_000),
  (req: Request, res: Response) => {
    const parsed = SignedWalletActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(401).json({
        success: false,
        error: 'Cryptographic wallet signature (nonce + signature) is required to unlink a wallet.',
      });
    }

    const authCheck = verifyChallengeSignature({
      walletAddress: parsed.data.walletAddress,
      nonce: parsed.data.nonce,
      signature: parsed.data.signature,
      expectedPurpose: 'unlink_wallet',
    });

    if ('error' in authCheck) {
      return res.status(401).json({ success: false, error: authCheck.error });
    }

    const unlinked = db.unlinkWallet(authCheck.walletAddress);
    res.json({ success: true, unlinked });
  }
);

// Graph Topology Endpoint (with explicit relationship provenance & revocation state)
app.get('/api/graph', (req: Request, res: Response) => {
  const includeRevoked = req.query.includeRevoked === 'true';
  const atoms = db.getAtoms();
  const attestations = db.getAttestations(includeRevoked);

  const nodesMap = new Map<
    string,
    {
      id: string;
      label: string;
      type: string;
      score?: number;
      verifiedCount?: number;
      originSource?: string;
    }
  >();

  atoms.forEach((atom) => {
    const stats = db.getEntityStats(atom.name);
    nodesMap.set(atom.name, {
      id: atom.name,
      label: atom.displayName,
      type: atom.type,
      score: stats.average || 0,
      verifiedCount: stats.verifiedOnChainCount,
      originSource: atom.origin_source || 'trustgraph',
    });
  });

  attestations.forEach((att) => {
    const actorKey = att.wallet_address
      ? `wallet_${att.wallet_address.toLowerCase()}`
      : `user_${att.from_user.toLowerCase()}`;
    if (!nodesMap.has(actorKey)) {
      nodesMap.set(actorKey, {
        id: actorKey,
        label: att.wallet_address ? shortenAddress(att.wallet_address) : `@${att.from_user}`,
        type: att.wallet_address ? 'wallet_actor' : 'user',
      });
    }
  });

  const nodes = Array.from(nodesMap.values());

  const links = attestations.map((att) => ({
    id: att.id,
    source: att.wallet_address
      ? `wallet_${att.wallet_address.toLowerCase()}`
      : `user_${att.from_user.toLowerCase()}`,
    target: att.to_entity,
    score: att.trust_score,
    comment: att.comment,
    timestamp: att.timestamp,
    evidenceCategory: att.evidence_category,
    verifiedOnChain: att.verified_onchain,
    revoked: att.revoked,
    txHash: att.tx_hash,
    attesterAddress: att.wallet_address,
    fromUser: att.from_user,
  }));

  res.json({ success: true, nodes, links });
});

// Honest Global Statistics
app.get('/api/statistics', (_req: Request, res: Response) => {
  const atoms = db.getAtoms();
  const allAtts = db.getAttestations(true);
  const activeAtts = allAtts.filter((a) => !a.revoked && a.evidence_category !== 'external_intuition_sample');

  const verifiedOnChainCount = activeAtts.filter((a) => a.evidence_category === 'onchain_verified').length;
  const offChainSignedCount = activeAtts.filter((a) => a.evidence_category === 'offchain_signed').length;
  const offChainCommunityCount = activeAtts.filter((a) => a.evidence_category === 'offchain_community').length;
  const externalIntuitionCount = activeAtts.filter((a) => a.evidence_category === 'external_intuition').length;
  const revokedCount = allAtts.filter((a) => a.revoked).length;

  const uniqueWallets = new Set(
    activeAtts
      .map((a) => a.wallet_address?.toLowerCase())
      .filter((w): w is string => Boolean(w))
  ).size;

  const totalContributors = new Set(
    activeAtts.map((a) => (a.wallet_address || a.from_user).toLowerCase())
  ).size;

  const averageAll =
    activeAtts.length > 0
      ? parseFloat(
          (
            activeAtts.reduce((sum, current) => sum + current.trust_score, 0) /
            activeAtts.length
          ).toFixed(2)
        )
      : 0;

  res.json({
    success: true,
    totalAtoms: atoms.length,
    totalAttestations: activeAtts.length,
    verifiedOnChainCount,
    offChainCount: offChainSignedCount + offChainCommunityCount,
    offChainSignedCount,
    offChainCommunityCount,
    externalIntuitionCount,
    revokedCount,
    uniqueAttesterWallets: uniqueWallets,
    linkedTelegramWallets: db.getWalletLinks().length,
    totalUsers: totalContributors,
    averageConsensusScore: averageAll,
    indexerState: db.getIndexerState(),
  });
});

// Interactive Web Chat Bot Simulator
app.post(
  '/api/bot/simulate',
  createRateLimitMiddleware(30, 60_000),
  async (req: Request, res: Response) => {
    try {
      const text = String(req.body?.text || '').slice(0, 500);
      const rawUser = String(req.body?.fromUser || 'web_tester').slice(0, 60);
      const cleanUser = rawUser.trim().replace(/^@/, '') || 'web_tester';

      const botReply = await processBotMessage(text, {
        id: `sim_${cleanUser.toLowerCase()}`,
        username: cleanUser,
        first_name: 'Dashboard User',
      });

      res.json({ success: true, reply: botReply });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to process simulator command.' });
    }
  }
);

// Global API Error Handler (no stack trace leaks)
app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Error]', err?.message || err);
  res.status(400).json({
    success: false,
    error: 'Malformed request payload.',
  });
});

// -------------------------------------------------------------------------
// Live Telegram Bot Long Polling
// -------------------------------------------------------------------------
let stopPolling = false;

async function startTelegramBotPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram-Bot] TELEGRAM_BOT_TOKEN not set; live Telegram polling disabled.');
    return;
  }

  try {
    const clearWebhookUrl = `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`;
    await fetch(clearWebhookUrl);
  } catch (webhookErr: any) {
    console.warn('[Telegram-Bot] Webhook check warning:', webhookErr?.message);
  }

  let offset = 0;

  while (!stopPolling) {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=10`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 409) {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          continue;
        }
        throw new Error(`Telegram HTTP ${response.status}`);
      }

      const body: any = await response.json();
      if (body.ok && Array.isArray(body.result) && body.result.length > 0) {
        for (const update of body.result) {
          offset = update.update_id + 1;
          if (update.message && update.message.text) {
            const msg = update.message;
            const from = msg.from || { id: '0', username: 'unknown' };

            const replyHTML = await processBotMessage(msg.text, {
              id: String(from.id),
              username: from.username || `User_${from.id}`,
              first_name: from.first_name || 'Member',
            });

            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: replyHTML,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
              }),
            });
          }
        }
      }
    } catch (err: any) {
      console.error('[Telegram-Bot] Polling error:', err?.message);
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

// -------------------------------------------------------------------------
// Server Startup (Skipped when imported by automated test suite)
// -------------------------------------------------------------------------
export async function startServer() {
  startTelegramBotPolling();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TrustGraph Protocol Server listening on http://localhost:${PORT}`);
  });
}

if (process.env.TRUSTGRAPH_TEST_MODE !== 'true') {
  startServer();
}
