/**
 * Intuition MCP Connector
 *
 * Thin client for the Intuition Trust Engine MCP server (StreamableHTTP transport).
 * Handles the JSON-RPC session handshake and exposes simple typed helpers
 * for the trust tools the bot actually uses.
 *
 * No external deps: uses native fetch (Node 18+).
 */

const MCP_URL = process.env.INTUITION_MCP_URL || 'https://mcp-trust.intuition.box/mcp';

// JSON-RPC id counter
let rpcId = 1;

/**
 * Low-level MCP call. Does the full handshake every call:
 *   1. initialize  -> server returns an mcp-session-id header
 *   2. notifications/initialized
 *   3. tools/call  -> the actual tool invocation
 *
 * The trust server's StreamableHTTP transport replies with an SSE-style
 * body (lines beginning with "data:"), so we parse that out.
 */
async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<any> {
  // --- Step 1: initialize a session ---
  const initRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'trustgraph-bot', version: '1.0.0' },
      },
    }),
  });

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new Error('MCP server did not return a session id on initialize');
  }
  // Drain the init response body so the connection is clean
  await initRes.text();

  // --- Step 2: send initialized notification ---
  await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });

  // --- Step 3: call the tool ---
  const callRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  const raw = await callRes.text();

  // Best-effort: close the session so we don't leak transports
  fetch(MCP_URL, {
    method: 'DELETE',
    headers: { 'mcp-session-id': sessionId },
  }).catch(() => { /* non-fatal */ });

  const parsed = parseRpcBody(raw);

  if (parsed?.error) {
    throw new Error(`MCP error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }

  // tools/call result -> { content: [{ type: 'text', text: '...json...' }] }
  const textBlock = parsed?.result?.content?.find((c: any) => c.type === 'text');
  if (!textBlock) {
    throw new Error('MCP response contained no text content');
  }

  // The tool's payload is itself JSON-encoded inside the text block
  try {
    return JSON.parse(textBlock.text);
  } catch {
    // Some tools may return plain strings; hand it back as-is
    return textBlock.text;
  }
}

/**
 * The StreamableHTTP transport can return either a plain JSON body or an
 * SSE stream where the JSON sits behind a "data: " prefix. Handle both.
 */
function parseRpcBody(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Plain JSON
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }

  // SSE: find the last "data:" line and parse it
  const dataLines = trimmed
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim());

  if (dataLines.length === 0) {
    throw new Error('Could not parse MCP response body');
  }

  // The result frame is usually the last data line
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(dataLines[i]);
    } catch {
      continue;
    }
  }
  throw new Error('No valid JSON found in MCP SSE stream');
}

// ============ Typed helpers for the tools the bot uses ============

export interface CompositeScore {
  address: string;
  compositeScore: number;
  confidence: number;
}

export interface BatchScoreResult {
  anchorCount: number;
  targetCount: number;
  computationTimeMs: number;
  scores: Array<{
    target: string;
    compositeScore: number;
    confidence: number;
  }>;
}

export interface SyncHealth {
  health: string;
  lastSyncedAt: string | null;
  nodeCount: number;
  edgeCount: number;
  predicateDistributionTop10: Record<string, number>;
}

/**
 * Global objective trust score for a single address.
 * Not seeded by any one wallet.
 */
export async function getGlobalScore(address: string): Promise<CompositeScore> {
  return callMcpTool('compute_composite_score', { address });
}

/**
 * Personalized score: how much the anchor (or group of anchors) trusts the target.
 * anchors can be a single address or an array (group reputation).
 */
export async function getPersonalizedScore(
  anchors: string | string[],
  target: string,
): Promise<BatchScoreResult> {
  return callMcpTool('batch_compute_trust', {
    anchors,
    targets: [target],
  });
}

/**
 * Rank many target addresses from the perspective of one or more anchors.
 */
export async function batchScore(
  anchors: string | string[],
  targets: string[],
): Promise<BatchScoreResult> {
  return callMcpTool('batch_compute_trust', { anchors, targets });
}

/**
 * Live graph health from the trust engine (real node/edge counts, last sync).
 */
export async function getSyncHealth(): Promise<SyncHealth> {
  return callMcpTool('get_sync_health', {});
}

/**
 * Trust subgraph around an address, shaped for visualization.
 */
export async function getNetworkGraph(
  address: string,
  maxHops = 2,
): Promise<{ nodes: any[]; edges: any[] }> {
  return callMcpTool('get_network_graph', { address, maxHops });
}

/**
 * Quick check: is a string an EVM address?
 * The MCP scores addresses, so the bot uses this to decide whether to
 * route to the MCP or fall back to its local named-entity engine.
 */
export function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}
