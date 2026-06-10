import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { db } from './db';
import { explainTrust } from './ai';
import { syncWithIntuitionMainnet } from './sync';
import {
  getGlobalScore,
  getSyncHealth,
  batchScore,
  isEvmAddress,
} from './intuition-mcp';

dotenv.config();

const app = express();

app.use(express.json());

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

interface TelegramCommandUser {
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

export async function processBotMessage(
  text: string,
  user: TelegramCommandUser
): Promise<string> {
  const input = (text || '').trim();
  const username = user.username || `User_${user.id}`;

  if (!input.startsWith('/')) {
    return '💬 <b>Chat message received.</b> Please type <code>/</code> to see available commands, or enter a command like <code>/start</code>.';
  }

  const args = parseArgs(input);
  if (args.length === 0) {
    return '❓ <b>Unknown Command.</b> Type <code>/start</code> to view available instructions.';
  }
  const command = args[0].toLowerCase();

  switch (command) {
    case '/start': {
      return `🤖 <b>Welcome to the TrustGraph Bot!</b>`;
    }
    default: {
      return `❓ <b>Unknown Command: ${escapeHTML(command)}</b>\nType <code>/start</code> to view a list of all active TrustGraph Ledger commands.`;
    }
  }
}

// -------------------
// REST API Endpoints
// -------------------

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

app.get('/api/attestations', (req, res) => {
  res.json({ success: true, attestations: db.getAttestations() });
});

app.get('/api/intelligence/:entity', (req, res) => {
  try {
    const entity = req.params.entity;
    if (!entity) return res.status(400).json({ success: false, error: 'Entity name is required.' });
    const intelligence = db.getGraphIntelligence(entity);
    res.json({ success: true, intelligence });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/atoms', (req, res) => {
  try {
    const { displayName, type, description, creator } = req.body;
    if (!displayName || !type) return res.status(400).json({ success: false, error: 'Missing displayName or type' });
    const atom = db.createAtom(displayName, type, description, creator || 'web-dashboard');
    res.json({ success: true, atom });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/attestations', (req, res) => {
  try {
    const { from_user, to_entity, trust_score, comment, signature, wallet_address } = req.body;
    if (!from_user || !to_entity || !trust_score) return res.status(400).json({ success: false, error: 'Missing required attestation fields' });
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

app.post('/api/ai-explain', async (req, res) => {
  try {
    const { entityName } = req.body;
    if (!entityName) return res.status(400).json({ success: false, error: 'Missing entityName' });
    const explanation = await explainTrust(entityName);
    res.json({ success: true, explanation });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sync-intuition', async (req, res) => {
  try {
    const stats = await syncWithIntuitionMainnet();
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/telegram/generate-code', (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).json({ success: false, error: 'walletAddress is required' });
    const code = db.generateActivationCode(walletAddress);
    res.json({ success: true, code });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/telegram/status/:walletAddress', (req, res) => {
  try {
    const { walletAddress } = req.params;
    const telegramUser = db.getTelegramUserForWallet(walletAddress);
    res.json({ success: true, linked: !!telegramUser, telegramUser });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/telegram/unlink', (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).json({ success: false, error: 'walletAddress is required' });
    const unlinked = db.unlinkWallet(walletAddress);
    res.json({ success: true, unlinked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/graph', (req, res) => {
  const atoms = db.getAtoms();
  const attestations = db.getAttestations();

  const nodesMap = new Map<string, { id: string; label: string; type: string; score?: number }>();

  atoms.forEach(atom => {
    const stats = db.getEntityStats(atom.name);
    nodesMap.set(atom.name, {
      id: atom.name,
      label: atom.displayName,
      type: atom.type,
      score: stats.average || 0
    });
  });

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

  const links = attestations.map(att => ({
    source: `user_${att.from_user.toLowerCase()}`,
    target: att.to_entity,
    score: att.trust_score,
    comment: att.comment,
    timestamp: att.timestamp
  }));

  res.json({ success: true, nodes, links });
});

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

app.post('/api/bot/simulate', async (req, res) => {
  try {
    const { text, fromUser } = req.body;
    const cleanUser = fromUser ? fromUser.trim().replace(/^@/, '') : 'web_tester';
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

export { app };
export default app;
