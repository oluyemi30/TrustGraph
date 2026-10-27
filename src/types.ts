export type EvidenceCategory =
  | 'onchain_verified'
  | 'offchain_signed'
  | 'offchain_community'
  | 'external_intuition'
  | 'external_intuition_sample';

export interface CategoryScoreBreakdown {
  activeCount: number;
  revokedCount?: number;
  sampleCount?: number;
  simpleAverage: number;
  timeWeightedAverage: number;
}

export interface ReputationBreakdown {
  entityName: string;
  subjectId: string;
  scoreDistribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  categories: {
    onchainVerified: CategoryScoreBreakdown;
    offchainSigned: CategoryScoreBreakdown;
    communityUnverified: CategoryScoreBreakdown;
    externalIntuition: CategoryScoreBreakdown;
  };
  compositeSignal: {
    score: number;
    activeEvidenceCount: number;
    revokedCount: number;
    formulaSummary: string;
    weightsUsed: {
      onchainVerified: number;
      offchainSigned: number;
      externalIntuition: number;
      communityUnverified: number;
      timeDecayHalfLifeDays: number;
    };
    disclaimer: string;
  };
}

export interface Atom {
  id: number;
  name: string;
  displayName: string;
  type: 'user' | 'project' | 'wallet';
  created_at: string;
  description: string;
  creator: string;
  subject_id?: string;
  wallet_address?: string;
  origin_source?: 'trustgraph' | 'robinhood_chain' | 'intuition' | 'intuition_sample';
  average?: number;
  simpleAverage?: number;
  count?: number;
  verifiedOnChainCount?: number;
  offChainCount?: number;
  revokedCount?: number;
  reputationBreakdown?: ReputationBreakdown;
}

export interface Attestation {
  id: number;
  from_user: string;
  to_entity: string;
  trust_score: number;
  comment: string;
  timestamp: string;
  signature?: string;
  wallet_address?: string;
  evidence_category: EvidenceCategory;
  verified_onchain: boolean;
  revoked: boolean;
  revoked_at?: string;
  revocation_tx_hash?: string;
  chain_id?: number;
  contract_address?: string;
  tx_hash?: string;
  block_number?: number;
  log_index?: number;
  onchain_attestation_id?: string;
  subject_id?: string;
  evidence_hash?: string;
  external_network?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  score?: number;
  verifiedCount?: number;
  originSource?: string;
  x?: number;
  y?: number;
}

export interface GraphLink {
  id: number;
  source: string;
  target: string;
  score: number;
  comment: string;
  timestamp: string;
  evidenceCategory: EvidenceCategory;
  verifiedOnChain: boolean;
  revoked: boolean;
  txHash?: string;
  attesterAddress?: string;
  fromUser: string;
}

export interface GlobalStats {
  totalAtoms: number;
  totalAttestations: number;
  verifiedOnChainCount: number;
  offChainCount: number;
  offChainSignedCount: number;
  offChainCommunityCount: number;
  externalIntuitionCount: number;
  revokedCount: number;
  uniqueAttesterWallets: number;
  linkedTelegramWallets: number;
  totalUsers: number;
  averageConsensusScore: number;
  indexerState?: IndexerState;
}

export interface IndexerState {
  chainId: number;
  contractAddress: string | null;
  lastProcessedBlock: number;
  lastSyncedAt: string | null;
  totalIndexedEvents: number;
}

export interface RobinhoodNetworkStatus {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrl: string;
  explorerUrl: string;
  registryAddress: string | null;
  rpcConnected: boolean;
  rpcReportedChainId: number | null;
  chainMatchesExpected: boolean;
  latestBlock: number | null;
  gasPriceGwei: string | null;
  contractDeployed: boolean;
  error?: string;
}

export interface AIConsensus {
  entityName: string;
  summary: string;
  riskSignals: string[];
  confidenceLevel: 'Low' | 'Medium' | 'High';
  trustScore: number;
  totalClaims: number;
  verifiedOnChainCount: number;
  sourceType: 'ai_interpretation' | 'deterministic_heuristic';
  isOnChainEvidence: false;
  disclaimer: string;
}

export interface GraphIntelligenceNode {
  id: string;
  name: string;
  type: string;
  strength: number;
}

export interface IndirectPath {
  path: string[];
  score: number;
  influence: number;
}

export interface GraphIntelligence {
  entityName: string;
  weightedScore: number;
  riskScore: number;
  riskFactors: string[];
  confidenceScore: number;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  topInfluencingNodes: GraphIntelligenceNode[];
  indirectPaths: IndirectPath[];
  reputationBreakdown: ReputationBreakdown;
}

export interface ToastNotice {
  id: string;
  tone: 'success' | 'warning' | 'error' | 'info';
  title: string;
  description?: string;
  linkUrl?: string;
  linkLabel?: string;
}
