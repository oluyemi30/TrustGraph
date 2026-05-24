import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { explainTrust } from './server/ai';
import { syncWithIntuitionSepolia } from './server/sync';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

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

export async function processBotMessage(
  text: string, 
  user: TelegramCommandUser
): Promise<string> {
  const input = (text || '').trim();
  const username = user.username || `User_${user.id}`;

  if (!input.startsWith('/')) {
    return '💬 *Chat message received.* Please type `/` to see available commands, or enter a command like `/start`.';
  }

  // Parse command name and args using robust quote-aware logic
  const args = parseArgs(input);
  if (args.length === 0) {
    return '❓ *Unknown Command.* Type `/start` to view available instructions.';
  }
  const command = args[0].toLowerCase();

  switch (command) {
    case '/start': {
      return `🤖 *Welcome to the TrustGraph Bot!* 🕸️

Inspired by decentralized trust protocols like *Intuition*, this system maps peer trust relationships using **Atoms** (identities like projects/wallets) and **Triples** (statements of the form \`Subject ➜ predicate ➜ Object\` carrying **Dynamic weights**).

📈 *Decentralized Trust Intelligence (V1 Upgrade):*
• **Weighted Trust:** Evaluations are weighted based on the contributor's credibility.
• **Dynamic Reputation:** Users earn reputational weight by rating nodes and aligning with consensus.
• **Time Decay:** Over time, older ratings slowly decay, preserving fresh signals.
• **Anti-Spam Logic:** One active slot per entity node; consecutive ratings update your previous attestations.

📌 *Core Commands:*
1. \`/attest <entity> <score 1-5> <comment>\` — Stake/update a trust signal. Creates the entity is it does not exist yet.
2. \`/trust <entity>\` — Retrieve ratings, AI reports, risk parameters, and credibility weights.
3. \`/graph <entity>\` — Unroll the connection graph representing peer trust claimants.
4. \`/entities\` — Rank global registered identity nodes by their consensus ratings.

💡 *Examples:*
• \`/attest Ethereum 5 "Core layer-1 layer of smart contracts."\`
• \`/trust Ethereum\`
• \`/graph Ethereum\`
• \`/entities\``;
    }

    case '/attest': {
      if (args.length < 3) {
        return `❌ *Error: Missing parameters.*
Syntax: \`/attest <entity_name> <score 1-5> <comment>\`

Example: \`/attest Uniswap 5 "Superb liquidity Pools"\``;
      }

      const entity = args[1];
      const ratingStr = args[2];
      const rating = parseInt(ratingStr, 10);

      if (isNaN(rating) || rating < 1 || rating > 5) {
        return `❌ *Error: Invalid trust score.*
The rating must be a valid integer between **1 and 5** (where 5 represents absolute trust).`;
      }

      // Collect everything after rating index as comment
      let comment = args.slice(3).join(' ').trim();
      if (!comment) {
        comment = 'Staked trust without custom comment.';
      }

      const att = db.addAttestation(username, entity, rating, comment);
      const atom = db.findAtom(entity);

      return `✅ *Reputation Signal Registered Successfully!*

*Atom Node:* \`${atom?.displayName || entity}\` (${atom?.type || 'project'})
*Triple Claim:* \`@${username}\` ➜ \`trusts\` ➜ \`${atom?.displayName || entity}\`
*Assessed Score:* \`⭐ ${rating}/5\`

💬 *Latest Comment/Stake:*
_"${comment}"_

🛡️ _Note: Sybil-Spam protection activated. Registering a rating on an entity updates your active stake and timestamps._`;
    }

    case '/trust': {
      const entity = args[1];
      if (!entity) {
        return `❌ *Error: Missing identity atom.*
Syntax: \`/trust <entity_name>\`

Example: \`/trust Ethereum\``;
      }

      const atom = db.findAtom(entity);
      if (!atom) {
        return `🔍 *Entity not found.*
No reputation signals have been staked for \`${entity}\` yet.

Create the first attestation by running:
\`/attest ${entity} 5 "First trust claim"\``;
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

      let response = `📊 *Reputation Report Card: ${atom.displayName}*
*Asset Class:* \`${atom.type.toUpperCase()}\`
*Created on Core:* ${new Date(atom.created_at).toLocaleDateString()}

📈 *Consensus Indicators:*
• *Weighted Average Score:* **${stats.average}/5** (${stars})
• *Direct Simple Average:* \`${stats.simpleAverage}/5\`
• *Active Trust Claims:* \`${stats.count}\` unique contributor${stats.count === 1 ? '' : 's'}

`;

      if (aiAnalysis) {
        response += `🤖 *AI Evaluation Summary:*
_${aiAnalysis.summary}_

⚠️ *AI Consensus Risk Signals:*
${aiAnalysis.riskSignals.map(sig => `• ${sig}`).join('\n')}

🎯 *AI Assessment Confidence:* \`${aiAnalysis.confidenceLevel.toUpperCase()}\`

`;
      }

      const weightList = stats.weightDetails || [];
      response += `💬 *Recent Verified Attestations (Weighted Index):*
${weightList.slice(-3).map(w => `• *@${w.from_user}* (⭐ ${w.trust_score}/5):
  _"${w.comment || 'No comment staked.'}"_
  └ \`User Rep: ${w.user_credibility}x\` | \`Recency Decent: ${Math.round(w.time_decay * 100)}%\` | \`Net Weight: ${w.final_weight}\``).join('\n\n')}`;

      return response;
    }

    case '/graph': {
      const entity = args[1];
      if (!entity) {
        return `❌ *Error: Missing identity atom.*
Syntax: \`/graph <entity_name>\`

Example: \`/graph Binance\``;
      }

      const atom = db.findAtom(entity);
      if (!atom) {
        return `🔍 *Entity not found.*
No connection triple relationships exist for \`${entity}\` yet.`;
      }

      const relatedTriples = db.getTriples().filter(t => t.object.toLowerCase() === atom.name);

      if (relatedTriples.length === 0) {
        return `🕸️ *TrustGraph for ${atom.displayName}:*
No incoming trust links are registered to this atom.`;
      }

      return `🕸️ *TrustGraph: ${atom.displayName}*
Found \`${relatedTriples.length}\` active trust relationships.

*Triple Inbound Claims (Subject ➜ Predicate ➜ Object):*
${relatedTriples.map(t => `• \`${t.subject}\` ➜ \`${t.predicate}\` ➜ \`${atom.displayName}\` (Power: *${t.score}/5*)`).join('\n')}`;
    }

    case '/entities': {
      const statsList = db.getTopEntities();

      if (statsList.length === 0) {
        return `🏆 *TrustGraph Standings:*
No entities registered on the identity ledger yet. Start the movement with \`/attest\`!`;
      }

      let response = `🏆 *Top TrustGraph Identities*
Total Registered Atoms: \`${db.getAtoms().length}\`

`;
      statsList.forEach((ent, index) => {
        const ratingStars = '⭐'.repeat(Math.ceil(ent.average)) || '⭐';
        response += `${index + 1}. *${ent.displayName}* (Class: \`${ent.type}\`)
   • Weighted Score: *${ent.average}/5* (${ratingStars}) | Simple Avg: \`${ent.simpleAverage}/5\`
   • Contributors: *${ent.count}* active stake${ent.count === 1 ? '' : 's'}
   • Description: _"${ent.description || 'No description provided.'}"_
\n`;
      });

      return response;
    }

    default: {
      return `❓ *Unknown Command: ${command}*
Type \`/start\` to view a list of all active TrustGraph Ledger commands.`;
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
    const { from_user, to_entity, trust_score, comment } = req.body;
    if (!from_user || !to_entity || !trust_score) {
      return res.status(400).json({ success: false, error: 'Missing required attestation fields' });
    }
    const att = db.addAttestation(from_user, to_entity, parseInt(trust_score, 10), comment || '');
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

// Sync with Intuition Sepolia Testnet
app.post('/api/sync-intuition', async (req, res) => {
  try {
    const stats = await syncWithIntuitionSepolia();
    res.json({ success: true, stats });
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
            const replyMarkdown = await processBotMessage(text, {
              id: String(from.id),
              username: from.username || `User_${from.id}`,
              first_name: from.first_name || 'Incognito'
            });

            // Convert raw HTML-bold templates to custom bot modes if necessary, standard telegram parses standard MarkdownV2 or HTML
            const sendUrl = `https://api.telegram.org/bot${token}/sendMessage`;
            await fetch(sendUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: replyMarkdown,
                parse_mode: 'Markdown' // Telegram normal Markdown parser support beautifully
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
