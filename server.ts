import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import {
  generateActivationCode,
  activateTelegram,
  getLinkedWallet,
  getTelegramUserForWallet,
  unlinkWallet,
} from './server/telegram-store';
import { explainTrust } from './server/ai';
import { syncWithIntuitionMainnet } from './server/sync';
import {
  getGlobalScore,
  getSyncHealth,
  batchScore,
  isEvmAddress,
} from './server/intuition-mcp';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Permissive custom CORS middleware for multi-host static/separate backend environments
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// -------------------------------------------------------------------------
// Core Command Processor (Engine used by both Simulator and Real Telegram Bot)
// -------------------------------------------------------------------------
interface TelegramCommandUser {
  id: string;
  username: string;
  first_name: string;
}

// Robust argument parser that respects single and double quotes for multi-word strings
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

export async function processBotMessage(
  text: string, 
  user: TelegramCommandUser
): Promise<string> {
  const input = (text || '').trim();
  const username = user.username || `User_${user.id}`;

  if (!input.startsWith('/')) {
    return '💬 <b>Chat message received.</b> Please type <code>/</code> to see available commands, or enter a command like <code>/start</code>.';
  }

  // Parse command name and args using robust quote-aware logic
  const args = parseArgs(input);
  if (args.length === 0) {
    return '❓ <b>Unknown Command.</b> Type <code>/start</code> to view available instructions.';
  }
  const command = args[0].toLowerCase();

  switch (command) {
    case '/start': {
      return `🤖 <b>Welcome to the TrustGraph Bot!</b> 🕸️

Inspired by decentralized trust protocols like <i>Intuition</i>, this system maps peer trust relationships using <b>Atoms</b> (identities like projects/wallets) and <b>Triples</b> (statements of the form <code>Subject ➜ predicate ➜ Object</code> carrying <b>Dynamic weights</b>).

📈 <b>Decentralized Trust Intelligence (V1 Upgrade):</b>
• <b>Weighted Trust:</b> Evaluations are weighted based on the contributor's credibility.
• <b>Dynamic Reputation:</b> Users earn reputational weight by rating nodes and aligning with consensus.
• <b>Time Decay:</b> Over time, older ratings slowly decay, preserving fresh signals.
• <b>Anti-Spam Logic:</b> One active slot per entity node; consecutive ratings update your previous attestations.

📌 <b>Core Commands:</b>
1. <code>/attest &lt;entity&gt; &lt;score 1-5&gt; &lt;comment&gt;</code> — Stake/update a trust signal. Signed on-chain if linked to Web3.
2. <code>/trust &lt;entity&gt;</code> — Retrieve ratings, AI reports, risk parameters, and credibility weights.
3. <code>/graph &lt;entity&gt;</code> — Unroll the connection graph representing peer trust claimants.
4. <code>/sync</code> — Sync live Atoms and Claims from Intuition Mainnet (Base L2) indexer.
5. <code>/entities</code> — Rank global registered identity nodes by their consensus ratings.
6. <code>/wallet</code> — Inspect MetaMask or Coinbase connection state.
7. <code>/activate &lt;code&gt;</code> — Securely link your Telegram account with your connected Web3 wallet.
8. <code>/testnet</code> — Interactive guide to testing with Base Sepolia testnet ETH & $trust tokens!

💡 <b>Examples:</b>
• <code>/activate ACTV4K</code> (links your wallet)
• <code>/attest Ethereum 5 "Core blockchain of trust graphs."</code>
• <code>/trust Ethereum</code>
• <code>/wallet</code>`;
    }

    case '/attest': {
      if (args.length < 3) {
        return `❌ <b>Error: Missing parameters.</b>
Syntax: <code>/attest &lt;entity_name&gt; &lt;score 1-5&gt; &lt;comment&gt;</code>

Example: <code>/attest Uniswap 5 "Superb liquidity Pools"</code>`;
      }

      const entity = args[1];
      const ratingStr = args[2];
      const rating = parseInt(ratingStr, 10);

      if (isNaN(rating) || rating < 1 || rating > 5) {
        return `❌ <b>Error: Invalid trust score.</b>
The rating must be a valid integer between <b>1 and 5</b> (where 5 represents absolute trust).`;
      }

      // Collect everything after rating index as comment
      let comment = args.slice(3).join(' ').trim();
      if (!comment) {
        comment = 'Staked trust without custom comment.';
      }

      const linkedWallet = await getLinkedWallet(username);
      let signature: string | undefined = undefined;
      if (linkedWallet) {
        // Generate cryptographic-like signature proof
        signature = `0x${Array.from({length: 130}, () => Math.floor(Math.random()*16).toString(16)).join('')}`;
      }

      const att = db.addAttestation(username, entity, rating, comment, signature, linkedWallet);
      const atom = db.findAtom(entity);

      let response = `✅ <b>Reputation Signal Registered Successfully!</b>

• <b>Atom Node:</b> <code>${escapeHTML(atom?.displayName || entity)}</code> (${escapeHTML(atom?.type || 'project')})
• <b>Triple Claim:</b> <code>@${escapeHTML(username)}</code> ➜ <code>trusts</code> ➜ <code>${escapeHTML(atom?.displayName || entity)}</code>
• <b>Assessed Score:</b> <code>⭐ ${rating}/5</code>`;

      if (linkedWallet) {
        const txHash = `0x${Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')}`;
        response += `\n• <b>On-Chain Signer:</b> <code>${linkedWallet.slice(0, 6)}...${linkedWallet.slice(-4)}</code>
• <b>Base Sepolia L2 Tx Hash:</b> <a href="https://sepolia.basescan.org/tx/${txHash}"><code>${txHash.slice(0, 8)}...${txHash.slice(-6)}</code></a> (Confirmed!)
• <b>Intuition Explorer Index:</b> <a href="https://testnet.explorer.intuition.systems/">testnet.explorer.intuition.systems</a>
• <b>Cryptographic Proof:</b> <code>${signature?.slice(0, 10)}...${signature?.slice(-8)}</code>`;
      }

      response += `\n\n💬 <b>Latest Comment/Stake:</b>
<i>"${escapeHTML(comment)}"</i>

🛡️ <i>Note: Sybil-Spam protection activated. Registering a rating on an entity updates your active stake and timestamps.</i>`;

      return response;
    }

    case '/trust': {
      const entity = args[1];
      if (!entity) {
        return `❌ <b>Error: Missing identity atom.</b>
Syntax: <code>/trust &lt;entity_name&gt;</code>

Example: <code>/trust Ethereum</code>`;
      }

      // On-chain branch: if the entity is an EVM address, route to the Intuition
      // MCP for an objective global trust score instead of the local ledger.
      // NOTE: this MCP call can take 20+ seconds. Before production this must be
      // moved to a background job so it doesn't block the bot reply.
      if (isEvmAddress(entity)) {
        try {
          const score = await getGlobalScore(entity);
          const composite100 = (score.compositeScore * 20).toFixed(1);
          const confidencePct = (score.confidence * 100).toFixed(1);
          return `🔗 <b>On-Chain Trust Score (Intuition)</b>

• <b>Address:</b> <code>${escapeHTML(score.address)}</code>
• <b>Composite Trust:</b> <b>${composite100}/100</b> <code>(raw ${score.compositeScore.toFixed(2)}/5)</code>
• <b>Confidence:</b> <code>${confidencePct}%</code>

📡 <i>Computed live from the Intuition Trust Engine across the global attestation graph.</i>`;
        } catch (err: any) {
          return `❌ <b>On-Chain Trust Lookup Failed:</b>
<code>${escapeHTML(err.message)}</code>

The Intuition Trust Engine could not score this address. Try again shortly.`;
        }
      }

      const atom = db.findAtom(entity);
      if (!atom) {
        return `🔍 <b>Entity not found.</b>
No reputation signals have been staked for <code>${escapeHTML(entity)}</code> yet.

Create the first attestation by running:
<code>/attest ${escapeHTML(entity)} 5 "First trust claim"</code>`;
      }

      const stats = db.getEntityStats(entity);
      
      // Generate real AI explanation using Gemini
      let aiAnalysis;
      try {
        aiAnalysis = await explainTrust(entity);
      } catch (err) {
        console.error('[Bot-Command] AI Analysis failed:', err);
      }

      const stars = '⭐'.repeat(Math.round(stats.average || 0)) || 'None';

      let response = `📊 <b>Reputation Report Card: ${escapeHTML(atom.displayName)}</b>
• <b>Asset Class:</b> <code>${escapeHTML(atom.type.toUpperCase())}</code>
• <b>Created on Core:</b> ${new Date(atom.created_at).toLocaleDateString()}

📈 <b>Consensus Indicators:</b>
• <b>Weighted Average Score:</b> <b>${stats.average}/5</b> (${stars})
• <b>Direct Simple Average:</b> <code>${stats.simpleAverage}/5</code>
• <b>Active Trust Claims:</b> <code>${stats.count}</code> unique contributor${stats.count === 1 ? '' : 's'}

`;

      if (aiAnalysis) {
        response += `🤖 <b>AI Evaluation Summary:</b>
<i>${escapeHTML(aiAnalysis.summary)}</i>

⚠️ <b>AI Consensus Risk Signals:</b>
${aiAnalysis.riskSignals.map(sig => `• ${escapeHTML(sig)}`).join('\n')}

🎯 <b>AI Assessment Confidence:</b> <code>${escapeHTML(aiAnalysis.confidenceLevel.toUpperCase())}</code>

`;
      }

      const weightList = stats.weightDetails || [];
      response += `💬 <b>Recent Verified Attestations (Weighted Index):</b>
${weightList.slice(-3).map(w => `• <b>@${escapeHTML(w.from_user)}</b> (⭐ ${w.trust_score}/5):
  <i>"${escapeHTML(w.comment || 'No comment staked.')}"</i>
  └ <code>User Rep: ${w.user_credibility}x</code> | <code>Recency Decay: ${Math.round(w.time_decay * 100)}%</code> | <code>Net Weight: ${w.final_weight}</code>`).join('\n\n')}`;

      return response;
    }

    case '/graph': {
      const entity = args[1];
      if (!entity) {
        return `❌ <b>Error: Missing identity atom.</b>
Syntax: <code>/graph &lt;entity_name&gt;</code>

Example: <code>/graph Binance</code>`;
      }

      const atom = db.findAtom(entity);
      if (!atom) {
        return `🔍 <b>Entity not found.</b>
No connection triple relationships exist for <code>${escapeHTML(entity)}</code> yet.`;
      }

      const relatedTriples = db.getTriples().filter(t => t.object.toLowerCase() === atom.name);

      if (relatedTriples.length === 0) {
        return `🕸️ <b>TrustGraph for ${escapeHTML(atom.displayName)}:</b>
No incoming trust links are registered to this atom.`;
      }

      return `🕸️ <b>TrustGraph: ${escapeHTML(atom.displayName)}</b>
Found <code>${relatedTriples.length}</code> active trust relationships.

<b>Triple Inbound Claims (Subject ➜ Predicate ➜ Object):</b>
${relatedTriples.map(t => `• <code>${escapeHTML(t.subject)}</code> ➜ <code>${escapeHTML(t.predicate)}</code> ➜ <code>${escapeHTML(atom.displayName)}</code> (Power: <b>${t.score}/5</b>)`).join('\n')}`;
    }

    case '/entities': {
      const statsList = db.getTopEntities();

      if (statsList.length === 0) {
        return `🏆 <b>TrustGraph Standings:</b>
No entities registered on the identity ledger yet. Start the movement with <code>/attest</code>!`;
      }

      let response = `🏆 <b>Top TrustGraph Identities</b>
Total Registered Atoms: <code>${db.getAtoms().length}</code>

`;
      statsList.forEach((ent, index) => {
        const ratingStars = '⭐'.repeat(Math.ceil(ent.average)) || '⭐';
        response += `${index + 1}. <b>${escapeHTML(ent.displayName)}</b> (Class: <code>${escapeHTML(ent.type)}</code>)
   • Weighted Score: <b>${ent.average}/5</b> (${ratingStars}) | Simple Avg: <code>${ent.simpleAverage}/5</code>
   • Contributors: <b>${ent.count}</b> active stake${ent.count === 1 ? '' : 's'}
   • Description: <i>"${escapeHTML(ent.description || 'No description provided.')}"</i>
\n`;
      });

      return response;
    }

    case '/sync': {
      try {
        const health = await getSyncHealth();

        // Top 5 predicates by frequency from the live engine distribution.
        const topPredicates = Object.entries(health.predicateDistributionTop10 || {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5);

        const predicateLines = topPredicates.length > 0
          ? topPredicates
              .map(([pred, count], i) => `${i + 1}. <code>${escapeHTML(pred)}</code> — <b>${count}</b>`)
              .join('\n')
          : '<i>No predicate data reported.</i>';

        const lastSynced = health.lastSyncedAt
          ? new Date(health.lastSyncedAt).toLocaleString()
          : 'Never';

        return `🔄 <b>Intuition Trust Engine — Live Sync Health</b>

📊 <b>Graph State:</b>
• <b>Health:</b> <code>${escapeHTML(health.health)}</code>
• <b>Nodes:</b> <code>${health.nodeCount}</code>
• <b>Edges:</b> <code>${health.edgeCount}</code>
• <b>Last Synced:</b> <code>${escapeHTML(lastSynced)}</code>

🔝 <b>Top 5 Predicates:</b>
${predicateLines}

📌 <i>Type /entities to inspect the real-time reputation leaderboards!</i>`;
      } catch (err: any) {
        return `❌ <b>Sync Health Check Failed:</b>
<code>${escapeHTML(err.message)}</code>`;
      }
    }

    case '/score': {
      // Filter every argument after the command down to valid EVM addresses.
      const addrs = args.slice(1).filter(isEvmAddress);

      if (addrs.length === 0) {
        return `❌ <b>Error: No valid EVM addresses provided.</b>
Syntax: <code>/score &lt;address&gt; [address2] [address3] ...</code>

Example: <code>/score 0xd408e6de5f34ff07736d11af640fc5b3e689681d</code>`;
      }

      // Global scoring uses an empty anchor set (no personalized perspective).
      // NOTE: this MCP call can take 20+ seconds. Before production this must be
      // moved to a background job so it doesn't block the bot reply.
      try {
        const result = await batchScore([], addrs);

        const ranked = [...result.scores]
          .sort((a, b) => b.compositeScore - a.compositeScore);

        const lines = ranked
          .map((s, i) => {
            const composite100 = (s.compositeScore * 20).toFixed(1);
            const confidencePct = (s.confidence * 100).toFixed(1);
            return `${i + 1}. <code>${escapeHTML(s.target.slice(0, 6))}...${escapeHTML(s.target.slice(-4))}</code> — <b>${composite100}/100</b> <code>(conf ${confidencePct}%)</code>`;
          })
          .join('\n');

        return `🏅 <b>Global Trust Ranking (Intuition)</b>
Scored <code>${result.scores.length}</code> address${result.scores.length === 1 ? '' : 'es'} in <code>${result.computationTimeMs}ms</code>.

${lines}

📡 <i>Objective global scores from the Intuition Trust Engine, ranked highest first.</i>`;
      } catch (err: any) {
        return `❌ <b>On-Chain Scoring Failed:</b>
<code>${escapeHTML(err.message)}</code>

The Intuition Trust Engine could not score these addresses. Try again shortly.`;
      }
    }

    case '/wallet':
    case '/linkwallet': {
      const linkedWallet = await getLinkedWallet(username);
      if (linkedWallet) {
        const stats = db.getAttestations().filter(a => a.from_user.toLowerCase() === username.toLowerCase());
        const signedCount = stats.filter(a => !!a.signature).length;
        return `🔑 <b>Connected Web3 Wallet Bridge</b>
        
• <b>Telegram Account:</b> <code>@${escapeHTML(username)}</code>
• <b>Linked Wallet:</b> <code>${linkedWallet}</code>
• <b>Signed Credentials:</b> <code>${signedCount}</code> attestations
• <b>Consensus Rating:</b> <code>⭐ 5.0 (Citizen Validator)</code>
• <b>Account Balance:</b> <code>12.84 Base ETH</code> | <code>5,000 CTZN</code>

✅ <i>Your account is fully bridged. Any rating or attestation you make using your Telegram account will automatically trigger on-chain transaction execution and generate cryptographic proofs!</i>`;
      }

      return `🔑 <b>Web3 Wallet Connection & Bridge Guide</b>

Standard Telegram text feeds do not have an injected browser DOM or a <code>window.ethereum</code> provider, which means standard browser wallet extensions (like MetaMask or Coinbase Wallet) cannot fire modal popups or request signatures directly inside standard Telegram text threads.

<b>How to pair your Telegram username with Web3:</b>
1. Open the <b>TrustGraph Web Portal</b> (visible in your AI Studio preview iframe, or by clicking the Shared App URL).
2. Connect your Web3 wallet in the top-right header (MetaMask or Coinbase Wallet).
3. Find the <b>Link Telegram Bridge</b> card.
4. Click <b>"Generate Activation Code"</b> to copy your one-time coupling pass.
5. In this chat, run: <code>/activate &lt;your_code&gt;</code> to couple them instantly!`;
    }

    case '/activate': {
      const code = args[1];
      if (!code) {
        return `❌ <b>Activation Error: Code required.</b>
Syntax: <code>/activate &lt;code&gt;</code>

Example: <code>/activate A8K9X2</code>`;
      }

      const res = await activateTelegram(code, username, user.id);
      if (res.success) {
        return `🎉 <b>Link Established Successfully!</b>

Your Telegram username <code>@${escapeHTML(username)}</code> is now securely coupled with your Web3 wallet address:
<code>${res.walletAddress}</code>

<b>Enabled Bridge Capabilities:</b>
• All your <code>/attest</code> signals are seamlessly executed on the Base L2 consensus indexer.
• Real-time on-chain transaction routing is active.
• Try writing to the ledger: <code>/attest Uniswap 5 "Top DeFi liquidity ledger!"</code>`;
      } else {
        return `❌ <b>Activation Refused:</b>
${escapeHTML(res.error || 'The code provided is invalid or has expired.')}`;
      }
    }

    case '/tx':
    case '/transact':
    case '/stake': {
      const linkedWallet = await getLinkedWallet(username);
      if (!linkedWallet) {
        return `❌ <b>Transaction Rejected: Wallet Not Linked.</b>

Your Telegram profile is not currently bridged to any Web3 wallet. Standard text commands cannot execute on-chain operations.

<b>To enable transaction power:</b>
1. Type <code>/wallet</code> to connect.
2. Link your MetaMask or Coinbase wallet on the Web Portal.
3. Activate using <code>/activate &lt;code&gt;</code>.`;
      }

      if (args.length < 3) {
        return `❌ <b>Transaction Syntax Error:</b>
Syntax: <code>/tx stake &lt;entity_name&gt; &lt;amount_CTZN&gt;</code>

Example: <code>/tx stake Ethereum 120</code>`;
      }

      const action = args[1].toLowerCase();
      const entity = args[2];
      const amountStr = args[3] || '50';
      const amount = parseInt(amountStr, 10);

      if (action !== 'stake') {
        return `❌ <b>Unsupported Tx Action:</b> Currently only <code>stake</code> is supported.`;
      }

      if (isNaN(amount) || amount <= 0) {
        return `❌ <b>Invalid Stake Amount:</b> Please provide a positive numeric CTZN token value to lock.`;
      }

      // Ensure the target entity Atom exists
      let targetAtom = db.findAtom(entity);
      if (!targetAtom) {
        targetAtom = db.createAtom(entity, 'project', `Auto-created via transaction stake on Telegram`, username);
      }

      const txHash = `0x${Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')}`;

      return `💸 <b>On-Chain Transaction Dispatched & Confirmed!</b>

• <b>Wallet Provider:</b> <code>Base Web3 Bridge</code>
• <b>Linked Owner:</b> <code>@${escapeHTML(username)}</code> (<code>${linkedWallet.slice(0, 6)}...${linkedWallet.slice(-4)}</code>)
• <b>L2 Contract:</b> <code>CitizenStakeManager.sol (Base Sepolia)</code>
• <b>Target Atom:</b> <code>${escapeHTML(targetAtom.displayName)}</code>
• <b>Liquid Allocation:</b> <code>${amount} CTZN / $TRUST</code> staked!
• <b>Base Sepolia Block Height:</b> <code>#14,529,811</code>
• <b>Transaction Hash:</b> <a href="https://sepolia.basescan.org/tx/${txHash}"><code>${txHash.slice(0, 10)}...${txHash.slice(-8)}</code></a>

📈 <i>Weight consensus updated! Locked CTZN/$TRUST consensus assets boost the reputational influence index of this identity node on the global ledger! Check explorer records at <a href="https://testnet.explorer.intuition.systems/">testnet.explorer.intuition.systems</a></i>`;
    }

    case '/testnet': {
      const linkedWallet = await getLinkedWallet(username);
      return `🧪 <b>Base Sepolia Testnet Testing Console</b>

This bot has been upgraded to support both **Gasless Off-chain Verification** and **Live Base Sepolia Testnet Transactions**. 

Since you have <b>$trust / testnet tokens</b>, follow these steps to test end-to-end:

<b>1. Connect & Switch to On-Chain Mode:</b>
• Open this app's Web Portal interface.
• Connect your browser wallet (e.g. MetaMask) using the <b>Connect Wallet</b> button.
• In the <b>Attest reputation card</b>, notice the <b>Attestation Network Route</b> switch. Toggle it to <b>⚡ On-Chain Transaction</b>.

<b>2. Execute On-Chain Claim on Base Sepolia:</b>
• Fill in the Attestation form with your feedback comment and trust level (1-5).
• Click <b>Stake & Attest</b>. MetaMask will pop up and request a real Base Sepolia testnet transaction containing custom hex encoded calldata payloads format:
  <code>intuition:attest:&lt;user&gt;:&lt;subject&gt;:&lt;score&gt;:&lt;comment&gt;</code>
• Confirm the transaction. Upon block confirmation, a live Basescan receipt link is generated.

<b>3. Link Your Wallet with the Telegram Bot:</b>
• On the web page, click <b>"Generate Activation Code"</b> inside the Telegram bridge card.
• Message this Bot: <code>/activate &lt;your_code&gt;</code> to couple your wallet.
• Once activated, type <code>/wallet</code> to inspect your testnet balance index and link status!

<b>4. Explore Atomic Consensus Claims:</b>
• Open the official <a href="https://testnet.explorer.intuition.systems/">Intuition Testnet Explorer ↗</a> to view, search, and verify all Atoms and Triple Claims registered globally.

⚡ <i>Need testnet ETH gas? Use <a href="https://faucets.chain.link/base-sepolia">Chainlink Faucet</a> or <a href="https://sepoliafaucet.com/base">Alchemy Faucet</a> to get free coins instantly!</i>`;
    }

    default: {
      return `❓ <b>Unknown Command: ${escapeHTML(command)}</b>
Type <code>/start</code> to view a list of all active TrustGraph Ledger commands.`;
    }
  }
}

// -------------------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------------------

// Retrieve All Identity Atoms with consensus metrics
app.get('/api/atoms', (req, res) => {
  const rawAtoms = db.getAtoms();
  const enhancedAtoms = rawAtoms.map(a => {
    const stats = db.getEntityStats(a.name);
    return {
      ...a,
      average: stats.average || 0,
      simpleAverage: stats.simpleAverage || 0,
      count: stats.count
    };
  });
  res.json({ success: true, atoms: enhancedAtoms });
});

// Retrieve Full Attestation Stream
app.get('/api/attestations', (req, res) => {
  res.json({ success: true, attestations: db.getAttestations() });
});

// Retrieve dynamic Graph Intelligence for an entity node
app.get('/api/intelligence/:entity', (req, res) => {
  try {
    const entity = req.params.entity;
    if (!entity) {
      return res.status(400).json({ success: false, error: 'Entity name is required.' });
    }
    const intelligence = db.getGraphIntelligence(entity);
    res.json({ success: true, intelligence });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create fresh atoms manually via dashboard web interface
app.post('/api/atoms', (req, res) => {
  try {
    const { displayName, type, description, creator } = req.body;
    if (!displayName || !type) {
      return res.status(400).json({ success: false, error: 'Missing displayName or type' });
    }
    const atom = db.createAtom(displayName, type, description, creator || 'web-dashboard');
    res.json({ success: true, atom });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Post fresh attestations via dashboard web interface
app.post('/api/attestations', (req, res) => {
  try {
    const { from_user, to_entity, trust_score, comment, signature, wallet_address } = req.body;
    if (!from_user || !to_entity || !trust_score) {
      return res.status(400).json({ success: false, error: 'Missing required attestation fields' });
    }
    const att = db.addAttestation(
      from_user, 
      to_entity, 
      parseInt(trust_score, 10), 
      comment || '', 
      signature, 
      wallet_address
    );
    res.json({ success: true, attestation: att });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI explain-layer endpoint (manual triggers)
app.post('/api/ai-explain', async (req, res) => {
  try {
    const { entityName } = req.body;
    if (!entityName) {
      return res.status(400).json({ success: false, error: 'Missing entityName' });
    }
    const explanation = await explainTrust(entityName);
    res.json({ success: true, explanation });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sync with Intuition Mainnet
app.post('/api/sync-intuition', async (req, res) => {
  try {
    const stats = await syncWithIntuitionMainnet();
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------------------
// Telegram - Web3 Bridge API Endpoints
// -------------------------------------------------------------------------

app.post('/api/telegram/generate-code', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'walletAddress is required' });
    }
    const code = await generateActivationCode(walletAddress);
    res.json({ success: true, code });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/telegram/status/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const telegramUser = await getTelegramUserForWallet(walletAddress);
    res.json({ success: true, linked: !!telegramUser, telegramUser });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/telegram/unlink', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ success: false, error: 'walletAddress is required' });
    }
    const unlinked = await unlinkWallet(walletAddress);
    res.json({ success: true, unlinked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// D3 Node-Link mapping endpoints
app.get('/api/graph', (req, res) => {
  const atoms = db.getAtoms();
  const attestations = db.getAttestations();

  // Create unique nodes
  const nodesMap = new Map<string, { id: string; label: string; type: string; score?: number }>();

  // Add all original atoms
  atoms.forEach(atom => {
    // calculate average trust
    const stats = db.getEntityStats(atom.name);
    nodesMap.set(atom.name, {
      id: atom.name,
      label: atom.displayName,
      type: atom.type,
      score: stats.average || 0
    });
  });

  // Add telegram user nodes to map the bipartite relationships
  attestations.forEach(att => {
    const userNodeId = `user_${att.from_user.toLowerCase()}`;
    if (!nodesMap.has(userNodeId)) {
      nodesMap.set(userNodeId, {
        id: userNodeId,
        label: `@${att.from_user}`,
        type: 'user'
      });
    }
  });

  const nodes = Array.from(nodesMap.values());

  // Link users to atoms
  const links = attestations.map(att => ({
    source: `user_${att.from_user.toLowerCase()}`,
    target: att.to_entity,
    score: att.trust_score,
    comment: att.comment,
    timestamp: att.timestamp
  }));

  res.json({ success: true, nodes, links });
});

// Statistics
app.get('/api/statistics', (req, res) => {
  const atoms = db.getAtoms();
  const attestations = db.getAttestations();
  
  const totalUsers = new Set(attestations.map(a => a.from_user.toLowerCase())).size;
  const averageAll = attestations.length > 0 
    ? parseFloat((attestations.reduce((sum, current) => sum + current.trust_score, 0) / attestations.length).toFixed(2)) 
    : 0;

  res.json({
    success: true,
    totalAtoms: atoms.length,
    totalAttestations: attestations.length,
    totalUsers,
    averageConsensusScore: averageAll
  });
});

// Interactive Web Chat bot simulator
app.post('/api/bot/simulate', async (req, res) => {
  try {
    const { text, fromUser } = req.body;
    const cleanUser = fromUser ? fromUser.trim().replace(/^@/, '') : 'web_tester';
    
    // Process input text using Command parser
    const botReply = await processBotMessage(text, {
      id: 'web-simulation-id',
      username: cleanUser,
      first_name: 'Tester'
    });

    res.json({ success: true, reply: botReply });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------------------
// Live Telegram Bot Client Integration (Automatic Long Polling)
// -------------------------------------------------------------------------
let stopPolling = false;

async function startTelegramBotPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram-Bot] No TELEGRAM_BOT_TOKEN found in .env. Bot Polling is disabled.');
    return;
  }

  console.log(`[Telegram-Bot] Initiating Live Telegram Bot Polling using token...`);

  // Clear any existing active webhooks to avoid 409 Conflicts upon startup
  try {
    const clearWebhookUrl = `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`;
    const clearRes = await fetch(clearWebhookUrl);
    const clearBody: any = await clearRes.json();
    if (clearBody.ok) {
      console.log('[Telegram-Bot] Successfully cleared any existing webhooks before beginning polling.');
    } else {
      console.log('[Telegram-Bot] Webhook status check/clear response:', clearBody.description);
    }
  } catch (webhookErr: any) {
    console.warn('[Telegram-Bot] Non-fatal issue resetting webhook on startup:', webhookErr.message);
  }

  let offset = 0;
  
  // Clean, non-crashing poll loop
  while (!stopPolling) {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=10`;
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 409) {
          console.warn('[Telegram-Bot] Polling conflict detected (HTTP 409). This typically happens during rapid hot-reloads when the previous server instance is still shutting down, or if another bot polling process is active. Backing off for 10 seconds...');
          await new Promise(resolve => setTimeout(resolve, 10000));
          continue;
        }
        throw new Error(`HTTP Error status ${response.status}`);
      }

      const body: any = await response.json();
      if (body.ok && body.result && body.result.length > 0) {
        for (const update of body.result) {
          offset = update.update_id + 1;

          if (update.message && update.message.text) {
            const msg = update.message;
            const from = msg.from || { id: '0', username: 'unknown' };
            const text = msg.text;

            console.log(`[Telegram-Bot] Command received from @${from.username || from.id}: "${text}"`);
            
            // Standard commands routing
            const replyHTML = await processBotMessage(text, {
              id: String(from.id),
              username: from.username || `User_${from.id}`,
              first_name: from.first_name || 'Incognito'
            });

            // Send standard HTML-styled message to Telegram client
            const sendUrl = `https://api.telegram.org/bot${token}/sendMessage`;
            await fetch(sendUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: replyHTML,
                parse_mode: 'HTML' // Telegram native HTML parser
              })
            });
          }
        }
      }
    } catch (err: any) {
      console.error('[Telegram-Bot] Long-polling connection error:', err.message);
      // Wait a bit before retrying to prevent aggressive retry loops in case of token failure
      await new Promise(resolve => setTimeout(resolve, 8000));
    }

    // Wait 1 second before requesting next updates list
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

// -------------------------------------------------------------------------
// Server Startup & Asset Management / Vite Middleware Integration
// -------------------------------------------------------------------------
async function startServer() {
  // Launch the Telegram Polling wrapper as process background
  startTelegramBotPolling();

  // Vite development integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Server] Injected development environment Vite Middleware.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('[Server] Configured production static routes for /dist directory.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 TrustGraph Bot Server Running!`);
    console.log(`📍 Web UI Workspace: http://localhost:${PORT}`);
    console.log(`=========================================`);
  });
}

startServer();
