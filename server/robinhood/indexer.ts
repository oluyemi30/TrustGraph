import { FetchRequest, JsonRpcProvider, isAddress } from 'ethers';
import { ROBINHOOD_TESTNET } from '../../src/lib/robinhoodChain';
import { DatabaseEngine, db as defaultDb } from '../db';
import { getRobinhoodConfig, withRpcRetry } from './client';
import { readOnChainAttestation, registryInterface } from './registry';

const MAX_LOG_BLOCK_SPAN = 2000;
const REORG_LOOKBACK_BLOCKS = 6;
const INITIAL_BACKFILL_SPAN = 10_000;

export interface IndexerSyncResult {
  synced: boolean;
  chainId: number;
  contractAddress: string | null;
  fromBlock: number;
  toBlock: number;
  createdProcessed: number;
  newlyIndexed: number;
  revocationsProcessed: number;
  reorgReconciled: number;
  timestamp: string;
  warning?: string;
}

export async function syncRobinhoodRegistryEvents(options?: {
  database?: DatabaseEngine;
  rpcUrlOverride?: string;
  registryAddressOverride?: string;
  fromBlockOverride?: number;
}): Promise<IndexerSyncResult> {
  const database = options?.database || defaultDb;
  const cfg = getRobinhoodConfig({
    rpcUrl: options?.rpcUrlOverride,
    registryAddress: options?.registryAddressOverride,
  });

  if (!cfg.registryAddress || !isAddress(cfg.registryAddress)) {
    return {
      synced: false,
      chainId: ROBINHOOD_TESTNET.chainId,
      contractAddress: null,
      fromBlock: 0,
      toBlock: 0,
      createdProcessed: 0,
      newlyIndexed: 0,
      revocationsProcessed: 0,
      reorgReconciled: 0,
      timestamp: new Date().toISOString(),
      warning:
        'RH_REGISTRY_ADDRESS is not configured. Deploy contracts/TrustGraphRegistry.sol to Robinhood Chain Testnet first.',
    };
  }

  const req = new FetchRequest(cfg.rpcUrl);
  req.timeout = 12_000;
  const provider = new JsonRpcProvider(req);

  const chainHex = await withRpcRetry(() => provider.send('eth_chainId', []));
  const rpcChainId = typeof chainHex === 'string' ? parseInt(chainHex, 16) : Number(chainHex);
  if (rpcChainId !== ROBINHOOD_TESTNET.chainId) {
    throw new Error(
      `Chain mismatch during indexing: RPC returned chain ${rpcChainId}, expected Robinhood Chain Testnet (${ROBINHOOD_TESTNET.chainId}).`
    );
  }

  const [code, latestBlock] = await withRpcRetry(() =>
    Promise.all([provider.getCode(cfg.registryAddress!), provider.getBlockNumber()])
  );

  if (!code || code === '0x' || code === '0x0') {
    return {
      synced: false,
      chainId: ROBINHOOD_TESTNET.chainId,
      contractAddress: cfg.registryAddress,
      fromBlock: latestBlock,
      toBlock: latestBlock,
      createdProcessed: 0,
      newlyIndexed: 0,
      revocationsProcessed: 0,
      reorgReconciled: 0,
      timestamp: new Date().toISOString(),
      warning: `No contract bytecode found at ${cfg.registryAddress} on Robinhood Chain Testnet.`,
    };
  }

  const prevState = database.getIndexerState();
  const sameContract =
    prevState.contractAddress?.toLowerCase() === cfg.registryAddress.toLowerCase();

  let startBlock: number;
  if (options?.fromBlockOverride !== undefined) {
    startBlock = Math.max(0, options.fromBlockOverride);
  } else if (sameContract && prevState.lastProcessedBlock > 0) {
    startBlock = Math.max(0, prevState.lastProcessedBlock - REORG_LOOKBACK_BLOCKS);
  } else {
    startBlock = Math.max(0, latestBlock - INITIAL_BACKFILL_SPAN);
  }

  if (startBlock > latestBlock) {
    startBlock = latestBlock;
  }

  const createdTopic = registryInterface.getEvent('AttestationCreated')!.topicHash;
  const revokedTopic = registryInterface.getEvent('AttestationRevoked')!.topicHash;

  let createdProcessed = 0;
  let newlyIndexed = 0;
  let revocationsProcessed = 0;

  for (let cursor = startBlock; cursor <= latestBlock; cursor += MAX_LOG_BLOCK_SPAN) {
    const endWindow = Math.min(latestBlock, cursor + MAX_LOG_BLOCK_SPAN - 1);

    const logs = await withRpcRetry(() =>
      provider.getLogs({
        address: cfg.registryAddress!,
        fromBlock: cursor,
        toBlock: endWindow,
        topics: [[createdTopic, revokedTopic]],
      })
    );

    // Sort strictly by (blockNumber, index) for deterministic state transitions
    const sortedLogs = [...logs].sort(
      (a, b) => a.blockNumber - b.blockNumber || a.index - b.index
    );

    for (const log of sortedLogs) {
      let parsed;
      try {
        parsed = registryInterface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
      } catch {
        continue;
      }
      if (!parsed) continue;

      if (parsed.name === 'AttestationCreated') {
        createdProcessed += 1;
        const attId = parsed.args.attestationId.toString();

        // Confirm current revocation state from contract storage
        let isCurrentlyRevoked = false;
        try {
          const onChainRec = await readOnChainAttestation(attId, {
            provider,
            registryAddress: cfg.registryAddress!,
            rpcUrl: cfg.rpcUrl,
          });
          isCurrentlyRevoked = onChainRec.revoked;
        } catch {
          // If record reverted (e.g. reorged out), skip indexing
          continue;
        }

        const outcome = database.upsertVerifiedOnChainAttestation({
          chainId: ROBINHOOD_TESTNET.chainId,
          contractAddress: cfg.registryAddress!,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          onchainAttestationId: attId,
          subjectId: String(parsed.args.subjectId),
          attester: String(parsed.args.attester),
          score: Number(parsed.args.score),
          evidenceHash: String(parsed.args.evidenceHash),
          createdAtSec: Number(parsed.args.createdAt),
          revoked: isCurrentlyRevoked,
        });
        if (outcome.created) newlyIndexed += 1;
      } else if (parsed.name === 'AttestationRevoked') {
        revocationsProcessed += 1;
        database.markOnChainAttestationRevoked({
          chainId: ROBINHOOD_TESTNET.chainId,
          contractAddress: cfg.registryAddress!,
          onchainAttestationId: parsed.args.attestationId.toString(),
          revokedAtSec: Number(parsed.args.revokedAt),
          revocationTxHash: log.transactionHash,
        });
      }
    }
  }

  // Reorg & state consistency check for recently indexed records
  let reorgReconciled = 0;
  const recentThresholdBlock = Math.max(0, latestBlock - REORG_LOOKBACK_BLOCKS * 4);
  const recentRecords = database
    .getAttestations(true)
    .filter(
      (a) =>
        a.verified_onchain &&
        a.contract_address?.toLowerCase() === cfg.registryAddress!.toLowerCase() &&
        (a.block_number ?? 0) >= recentThresholdBlock &&
        Boolean(a.onchain_attestation_id)
    );

  for (const rec of recentRecords) {
    try {
      const live = await readOnChainAttestation(rec.onchain_attestation_id!, {
        provider,
        registryAddress: cfg.registryAddress!,
        rpcUrl: cfg.rpcUrl,
      });
      if (live.revoked && !rec.revoked) {
        database.markOnChainAttestationRevoked({
          chainId: ROBINHOOD_TESTNET.chainId,
          contractAddress: cfg.registryAddress!,
          onchainAttestationId: rec.onchain_attestation_id!,
          revokedAtSec: live.revokedAt || Math.floor(Date.now() / 1000),
        });
        reorgReconciled += 1;
      }
    } catch {
      // Attestation ID does not exist on canonical chain after reorg
      database.removeOrphanedOnChainAttestation(
        ROBINHOOD_TESTNET.chainId,
        cfg.registryAddress!,
        rec.onchain_attestation_id!
      );
      reorgReconciled += 1;
    }
  }

  const prevTotal = sameContract ? prevState.totalIndexedEvents : 0;
  const nowIso = new Date().toISOString();

  database.updateIndexerState({
    chainId: ROBINHOOD_TESTNET.chainId,
    contractAddress: cfg.registryAddress,
    lastProcessedBlock: latestBlock,
    lastSyncedAt: nowIso,
    totalIndexedEvents: prevTotal + newlyIndexed,
  });

  return {
    synced: true,
    chainId: ROBINHOOD_TESTNET.chainId,
    contractAddress: cfg.registryAddress,
    fromBlock: startBlock,
    toBlock: latestBlock,
    createdProcessed,
    newlyIndexed,
    revocationsProcessed,
    reorgReconciled,
    timestamp: nowIso,
  };
}
