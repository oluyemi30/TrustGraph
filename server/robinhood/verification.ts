import { FetchRequest, JsonRpcProvider, ZeroHash, isAddress } from 'ethers';
import { ROBINHOOD_TESTNET } from '../../src/lib/robinhoodChain';
import { getRobinhoodConfig, withRpcRetry } from './client';
import {
  computeEvidenceHash,
  computeSubjectId,
  readOnChainAttestation,
  registryInterface,
} from './registry';

const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

export interface VerifiedAttestationProof {
  verified: true;
  status: 'confirmed';
  chainId: number;
  contractAddress: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  confirmations: number;
  attestationId: string;
  subjectId: string;
  attester: string;
  score: number;
  evidenceHash: string;
  commentHashMatches: boolean;
  createdAt: number;
  revoked: boolean;
  supersededAttestationId?: string;
}

export interface UnverifiedTxStatus {
  verified: false;
  status:
    | 'invalid_hash'
    | 'contract_not_configured'
    | 'wrong_chain'
    | 'contract_not_deployed'
    | 'pending'
    | 'reverted'
    | 'wrong_contract'
    | 'missing_event'
    | 'subject_mismatch'
    | 'evidence_mismatch'
    | 'rpc_error';
  reason: string;
}

export type AttestationVerificationOutcome = VerifiedAttestationProof | UnverifiedTxStatus;

export interface VerifiedRevocationProof {
  verified: true;
  status: 'confirmed';
  chainId: number;
  contractAddress: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  attestationId: string;
  subjectId: string;
  attester: string;
  revokedAt: number;
}

export async function verifyOnChainAttestationTx(params: {
  txHash: string;
  expectedEntityName?: string;
  expectedComment?: string;
  rpcUrlOverride?: string;
  registryAddressOverride?: string;
}): Promise<AttestationVerificationOutcome> {
  const cleanHash = (params.txHash || '').trim();
  if (!TX_HASH_REGEX.test(cleanHash)) {
    return {
      verified: false,
      status: 'invalid_hash',
      reason: 'Transaction hash must be a 32-byte 0x-prefixed hex string.',
    };
  }

  const cfg = getRobinhoodConfig({
    rpcUrl: params.rpcUrlOverride,
    registryAddress: params.registryAddressOverride,
  });

  if (!cfg.registryAddress || !isAddress(cfg.registryAddress)) {
    return {
      verified: false,
      status: 'contract_not_configured',
      reason: 'RH_REGISTRY_ADDRESS is not configured on the server.',
    };
  }

  try {
    const req = new FetchRequest(cfg.rpcUrl);
    req.timeout = 10_000;
    const provider = new JsonRpcProvider(req);

    const chainIdHex = await withRpcRetry(() => provider.send('eth_chainId', []));
    const rpcChainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);

    if (rpcChainId !== ROBINHOOD_TESTNET.chainId) {
      return {
        verified: false,
        status: 'wrong_chain',
        reason: `RPC reported chain ID ${rpcChainId}, expected Robinhood Chain Testnet (${ROBINHOOD_TESTNET.chainId}).`,
      };
    }

    const code = await withRpcRetry(() => provider.getCode(cfg.registryAddress!));
    if (!code || code === '0x' || code === '0x0') {
      return {
        verified: false,
        status: 'contract_not_deployed',
        reason: `No TrustGraphRegistry bytecode found at ${cfg.registryAddress} on Robinhood Chain Testnet.`,
      };
    }

    const [receipt, latestBlock] = await withRpcRetry(() =>
      Promise.all([provider.getTransactionReceipt(cleanHash), provider.getBlockNumber()])
    );

    if (!receipt) {
      return {
        verified: false,
        status: 'pending',
        reason: 'Transaction receipt not yet found on Robinhood Chain Testnet (pending or unknown hash).',
      };
    }

    if (receipt.status !== 1) {
      return {
        verified: false,
        status: 'reverted',
        reason: 'Transaction failed or reverted on-chain (receipt.status !== 1).',
      };
    }

    if (!receipt.to || receipt.to.toLowerCase() !== cfg.registryAddress.toLowerCase()) {
      return {
        verified: false,
        status: 'wrong_contract',
        reason: `Transaction target ${receipt.to || 'contract-creation'} does not match deployed TrustGraphRegistry (${cfg.registryAddress}). Self-transfers and external contracts are never accepted as TrustGraph attestations.`,
      };
    }

    let createdLog: any = null;
    let createdLogIndex = 0;
    let supersededAttestationId: string | undefined;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== cfg.registryAddress.toLowerCase()) continue;
      try {
        const parsed = registryInterface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed?.name === 'AttestationCreated') {
          createdLog = parsed;
          createdLogIndex = log.index;
        } else if (parsed?.name === 'AttestationRevoked' && parsed.args.superseded) {
          supersededAttestationId = parsed.args.attestationId.toString();
        }
      } catch {
        // Ignore non-matching logs
      }
    }

    if (!createdLog) {
      return {
        verified: false,
        status: 'missing_event',
        reason: 'Transaction did not emit a valid AttestationCreated event from TrustGraphRegistry.',
      };
    }

    const attestationId = createdLog.args.attestationId.toString();
    const subjectId = String(createdLog.args.subjectId);
    const attester = String(createdLog.args.attester);
    const score = Number(createdLog.args.score);
    const evidenceHash = String(createdLog.args.evidenceHash);
    const createdAt = Number(createdLog.args.createdAt);

    if (params.expectedEntityName && params.expectedEntityName.trim()) {
      const expectedSubjectId = computeSubjectId(params.expectedEntityName);
      if (expectedSubjectId.toLowerCase() !== subjectId.toLowerCase()) {
        return {
          verified: false,
          status: 'subject_mismatch',
          reason: `On-chain subjectId (${subjectId}) does not match entity "${params.expectedEntityName}" (${expectedSubjectId}).`,
        };
      }
    }

    let commentHashMatches = true;
    if (params.expectedComment !== undefined && params.expectedEntityName) {
      const expectedHash = computeEvidenceHash(
        params.expectedEntityName,
        score,
        params.expectedComment
      );
      if (evidenceHash !== ZeroHash && expectedHash.toLowerCase() !== evidenceHash.toLowerCase()) {
        return {
          verified: false,
          status: 'evidence_mismatch',
          reason: 'Submitted explanation text does not match the on-chain evidenceHash committed in the transaction.',
        };
      }
      commentHashMatches = expectedHash.toLowerCase() === evidenceHash.toLowerCase();
    }

    // Read live contract state to confirm canonical record & current revocation status
    const liveState = await readOnChainAttestation(attestationId, {
      provider,
      registryAddress: cfg.registryAddress,
      rpcUrl: cfg.rpcUrl,
    });

    const confirmations = Math.max(1, latestBlock - Number(receipt.blockNumber) + 1);

    return {
      verified: true,
      status: 'confirmed',
      chainId: ROBINHOOD_TESTNET.chainId,
      contractAddress: cfg.registryAddress,
      txHash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      logIndex: Number(createdLogIndex),
      confirmations,
      attestationId,
      subjectId,
      attester,
      score,
      evidenceHash,
      commentHashMatches,
      createdAt,
      revoked: liveState.revoked,
      supersededAttestationId,
    };
  } catch (err: any) {
    return {
      verified: false,
      status: 'rpc_error',
      reason: `RPC verification failed: ${err?.message || 'Unable to query Robinhood Chain Testnet'}`,
    };
  }
}

export async function verifyOnChainRevocationTx(params: {
  txHash: string;
  expectedAttestationId?: string | number;
  rpcUrlOverride?: string;
  registryAddressOverride?: string;
}): Promise<VerifiedRevocationProof | UnverifiedTxStatus> {
  const cleanHash = (params.txHash || '').trim();
  if (!TX_HASH_REGEX.test(cleanHash)) {
    return {
      verified: false,
      status: 'invalid_hash',
      reason: 'Transaction hash must be a 32-byte 0x-prefixed hex string.',
    };
  }

  const cfg = getRobinhoodConfig({
    rpcUrl: params.rpcUrlOverride,
    registryAddress: params.registryAddressOverride,
  });

  if (!cfg.registryAddress || !isAddress(cfg.registryAddress)) {
    return {
      verified: false,
      status: 'contract_not_configured',
      reason: 'RH_REGISTRY_ADDRESS is not configured on the server.',
    };
  }

  try {
    const req = new FetchRequest(cfg.rpcUrl);
    req.timeout = 10_000;
    const provider = new JsonRpcProvider(req);

    const chainIdHex = await withRpcRetry(() => provider.send('eth_chainId', []));
    const rpcChainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);

    if (rpcChainId !== ROBINHOOD_TESTNET.chainId) {
      return {
        verified: false,
        status: 'wrong_chain',
        reason: `RPC reported chain ID ${rpcChainId}, expected ${ROBINHOOD_TESTNET.chainId}.`,
      };
    }

    const receipt = await withRpcRetry(() => provider.getTransactionReceipt(cleanHash));
    if (!receipt) {
      return {
        verified: false,
        status: 'pending',
        reason: 'Revocation transaction receipt not found yet.',
      };
    }

    if (receipt.status !== 1) {
      return {
        verified: false,
        status: 'reverted',
        reason: 'Revocation transaction reverted on-chain.',
      };
    }

    if (!receipt.to || receipt.to.toLowerCase() !== cfg.registryAddress.toLowerCase()) {
      return {
        verified: false,
        status: 'wrong_contract',
        reason: 'Transaction was not sent to the configured TrustGraphRegistry contract.',
      };
    }

    let revokedEvent: any = null;
    let revokedLogIndex = 0;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== cfg.registryAddress.toLowerCase()) continue;
      try {
        const parsed = registryInterface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed?.name === 'AttestationRevoked') {
          revokedEvent = parsed;
          revokedLogIndex = log.index;
        }
      } catch {
        // Ignore unrelated logs
      }
    }

    if (!revokedEvent) {
      return {
        verified: false,
        status: 'missing_event',
        reason: 'Transaction did not emit an AttestationRevoked event from TrustGraphRegistry.',
      };
    }

    const attestationId = revokedEvent.args.attestationId.toString();
    if (
      params.expectedAttestationId !== undefined &&
      String(params.expectedAttestationId) !== attestationId
    ) {
      return {
        verified: false,
        status: 'subject_mismatch',
        reason: `Revoked attestation ID (${attestationId}) does not match expected ID (${params.expectedAttestationId}).`,
      };
    }

    const liveState = await readOnChainAttestation(attestationId, {
      provider,
      registryAddress: cfg.registryAddress,
      rpcUrl: cfg.rpcUrl,
    });

    if (!liveState.revoked) {
      return {
        verified: false,
        status: 'reverted',
        reason: 'On-chain state check indicates the attestation is not marked revoked.',
      };
    }

    return {
      verified: true,
      status: 'confirmed',
      chainId: ROBINHOOD_TESTNET.chainId,
      contractAddress: cfg.registryAddress,
      txHash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      logIndex: Number(revokedLogIndex),
      attestationId,
      subjectId: String(revokedEvent.args.subjectId),
      attester: String(revokedEvent.args.attester),
      revokedAt: Number(revokedEvent.args.revokedAt),
    };
  } catch (err: any) {
    return {
      verified: false,
      status: 'rpc_error',
      reason: `RPC verification failed: ${err?.message || 'Unable to verify revocation transaction'}`,
    };
  }
}
