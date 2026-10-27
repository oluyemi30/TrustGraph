import { Contract, Interface, Provider } from 'ethers';
import { TRUSTGRAPH_REGISTRY_ABI } from '../../src/lib/trustGraphAbi';
import {
  computeEvidenceHash,
  computeSubjectId,
  normalizeSubjectKey,
} from '../../src/lib/robinhoodChain';
import { createRobinhoodProvider, getRobinhoodConfig, withRpcRetry } from './client';

export { TRUSTGRAPH_REGISTRY_ABI, computeSubjectId, computeEvidenceHash, normalizeSubjectKey };

export const registryInterface = new Interface(TRUSTGRAPH_REGISTRY_ABI);

export interface OnChainAttestationState {
  attestationId: string;
  subjectId: string;
  evidenceHash: string;
  attester: string;
  createdAt: number;
  score: number;
  revoked: boolean;
  revokedAt: number;
}

export interface OnChainSubjectSummary {
  activeCount: number;
  revokedCount: number;
  activeScoreSum: number;
  averageScore: number;
}

export function getRegistryContract(params?: {
  provider?: Provider;
  registryAddress?: string;
  rpcUrl?: string;
}): Contract {
  const cfg = getRobinhoodConfig({
    registryAddress: params?.registryAddress,
    rpcUrl: params?.rpcUrl,
  });
  if (!cfg.registryAddress) {
    throw new Error('TrustGraphRegistry address (RH_REGISTRY_ADDRESS) is not configured.');
  }
  const provider = params?.provider || createRobinhoodProvider(cfg.rpcUrl);
  return new Contract(cfg.registryAddress, TRUSTGRAPH_REGISTRY_ABI, provider);
}

export async function readOnChainAttestation(
  attestationId: bigint | number | string,
  overrides?: { rpcUrl?: string; registryAddress?: string; provider?: Provider }
): Promise<OnChainAttestationState> {
  const contract = getRegistryContract(overrides);
  const raw = await withRpcRetry(() => contract.getAttestation(BigInt(attestationId)));
  return {
    attestationId: BigInt(attestationId).toString(),
    subjectId: String(raw.subjectId),
    evidenceHash: String(raw.evidenceHash),
    attester: String(raw.attester),
    createdAt: Number(raw.createdAt),
    score: Number(raw.score),
    revoked: Boolean(raw.revoked),
    revokedAt: Number(raw.revokedAt),
  };
}

export async function readOnChainSubjectSummary(
  entityNameOrSubjectId: string,
  overrides?: { rpcUrl?: string; registryAddress?: string; provider?: Provider }
): Promise<OnChainSubjectSummary> {
  const contract = getRegistryContract(overrides);
  const subjectId = /^0x[0-9a-fA-F]{64}$/.test(entityNameOrSubjectId)
    ? entityNameOrSubjectId
    : computeSubjectId(entityNameOrSubjectId);

  const [activeCount, revokedCount, activeScoreSum, averageScoreBps] = await withRpcRetry(() =>
    contract.getSubjectSummary(subjectId)
  );

  return {
    activeCount: Number(activeCount),
    revokedCount: Number(revokedCount),
    activeScoreSum: Number(activeScoreSum),
    averageScore: Number(averageScoreBps) / 100,
  };
}
