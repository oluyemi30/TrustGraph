import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ROBINHOOD_TESTNET,
  computeSubjectId,
  normalizeSubjectKey,
} from '../src/lib/robinhoodChain';

export type EvidenceCategory =
  | 'onchain_verified'
  | 'offchain_signed'
  | 'offchain_community'
  | 'external_intuition'
  | 'external_intuition_sample';

export interface WalletLink {
  telegram_user: string;
  telegram_id?: string;
  wallet_address: string;
  linked_at: string;
  verified_signature: boolean;
}

export interface ActivationCode {
  code: string;
  wallet_address: string;
  created_at: string;
  expires_at: number;
}

export interface AuthChallenge {
  nonce: string;
  wallet_address: string;
  domain: string;
  purpose: 'link_wallet' | 'unlink_wallet' | 'revoke_offchain';
  message: string;
  issued_at: string;
  expires_at: number;
  used: boolean;
}

export interface IndexerState {
  chainId: number;
  contractAddress: string | null;
  lastProcessedBlock: number;
  lastSyncedAt: string | null;
  totalIndexedEvents: number;
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

  // Provenance & verification fields (backward-compatible)
  evidence_category: EvidenceCategory;
  verified_onchain: boolean;
  revoked: boolean;
  revoked_at?: string;
  revocation_tx_hash?: string;

  // On-chain verification proof metadata (populated only after receipt + event verification)
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

export interface Triple {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  score: number;
  creator: string;
  timestamp: string;
  evidence_category: EvidenceCategory;
  verified_onchain: boolean;
  revoked: boolean;
}

export interface GraphInfluenceNode {
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

export interface GraphIntelligence {
  entityName: string;
  weightedScore: number;
  riskScore: number;
  riskFactors: string[];
  confidenceScore: number;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  topInfluencingNodes: GraphInfluenceNode[];
  indirectPaths: IndirectPath[];
  reputationBreakdown: ReputationBreakdown;
}

export interface PersistedDatabaseSnapshot {
  schemaVersion: number;
  atoms: Atom[];
  attestations: Attestation[];
  triples: Triple[];
  walletLinks: WalletLink[];
  activationCodes: ActivationCode[];
  authChallenges: AuthChallenge[];
  indexerState: IndexerState;
}

export interface StorageAdapter {
  load(): PersistedDatabaseSnapshot | null;
  save(snapshot: PersistedDatabaseSnapshot): void;
}

export class JsonFileStorageAdapter implements StorageAdapter {
  private readonly dirPath: string;
  private readonly filePath: string;

  constructor(customFilePath?: string) {
    if (customFilePath) {
      this.filePath = customFilePath;
      this.dirPath = path.dirname(customFilePath);
    } else {
      this.dirPath = path.join(process.cwd(), 'data');
      this.filePath = path.join(this.dirPath, 'database.json');
    }
  }

  public load(): PersistedDatabaseSnapshot | null {
    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(raw);
  }

  public save(snapshot: PersistedDatabaseSnapshot): void {
    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true });
    }
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}

function inferCategoryForLegacyRecord(raw: any): EvidenceCategory {
  if (raw.evidence_category) {
    return raw.evidence_category as EvidenceCategory;
  }
  const comment = String(raw.comment || '');
  if (comment.includes('Intuition Mainnet Triple Claim')) {
    return 'external_intuition';
  }
  // Note: legacy 66-char self-transfer hashes on Base Sepolia are NOT verified Robinhood Chain registry events
  if (raw.signature && String(raw.signature).startsWith('0x') && String(raw.signature).length > 100 && raw.wallet_address) {
    return 'offchain_signed';
  }
  return 'offchain_community';
}

export class DatabaseEngine {
  private storage: StorageAdapter;
  private atoms: Atom[] = [];
  private attestations: Attestation[] = [];
  private triples: Triple[] = [];
  private walletLinks: WalletLink[] = [];
  private activationCodes: ActivationCode[] = [];
  private authChallenges: AuthChallenge[] = [];
  private indexerState: IndexerState = {
    chainId: ROBINHOOD_TESTNET.chainId,
    contractAddress: null,
    lastProcessedBlock: 0,
    lastSyncedAt: null,
    totalIndexedEvents: 0,
  };
  private intelCache = new Map<string, GraphIntelligence>();

  constructor(storageAdapter?: StorageAdapter) {
    this.storage = storageAdapter || new JsonFileStorageAdapter();
    this.init();
  }

  private init() {
    try {
      const existing = this.storage.load();
      if (existing) {
        this.atoms = (existing.atoms || []).map((a: any) => ({
          ...a,
          subject_id: a.subject_id || computeSubjectId(a.name),
          origin_source:
            a.origin_source ||
            (a.creator === 'intuition-mainnet' ? 'intuition' : 'trustgraph'),
          wallet_address:
            a.wallet_address ||
            (/^0x[0-9a-fA-F]{40}$/.test(a.displayName) ? a.displayName : undefined),
        }));

        this.attestations = (existing.attestations || []).map((att: any) => {
          const category = inferCategoryForLegacyRecord(att);
          const verifiedOnChain =
            Boolean(att.verified_onchain) &&
            category === 'onchain_verified' &&
            Boolean(att.tx_hash) &&
            Boolean(att.contract_address) &&
            att.chain_id === ROBINHOOD_TESTNET.chainId;

          return {
            ...att,
            evidence_category: verifiedOnChain ? 'onchain_verified' : category === 'onchain_verified' ? 'offchain_community' : category,
            verified_onchain: verifiedOnChain,
            revoked: Boolean(att.revoked),
            subject_id: att.subject_id || computeSubjectId(att.to_entity),
          };
        });

        this.walletLinks = (existing.walletLinks || []).map((wl: any) => ({
          ...wl,
          verified_signature: Boolean(wl.verified_signature),
        }));
        this.activationCodes = existing.activationCodes || [];
        this.authChallenges = (existing.authChallenges || []).filter(
          (c: AuthChallenge) => !c.used && c.expires_at > Date.now()
        );
        if (existing.indexerState) {
          this.indexerState = {
            chainId: existing.indexerState.chainId || ROBINHOOD_TESTNET.chainId,
            contractAddress: existing.indexerState.contractAddress || null,
            lastProcessedBlock: existing.indexerState.lastProcessedBlock || 0,
            lastSyncedAt: existing.indexerState.lastSyncedAt || null,
            totalIndexedEvents: existing.indexerState.totalIndexedEvents || 0,
          };
        }

        this.rebuildTriples();
        this.save();
        return;
      }
    } catch (err) {
      console.error('[Database] Error loading persisted snapshot, seeding clean initial dataset:', err);
    }

    // Seed initial entities and community signals if database does not exist yet
    this.atoms = [
      {
        id: 1,
        name: 'binance',
        displayName: 'Binance',
        type: 'project',
        created_at: new Date('2026-01-10T12:00:00Z').toISOString(),
        description: 'Global cryptocurrency exchange network.',
        creator: 'system',
        subject_id: computeSubjectId('binance'),
        origin_source: 'trustgraph',
      },
      {
        id: 2,
        name: 'ethereum',
        displayName: 'Ethereum SDK',
        type: 'project',
        created_at: new Date('2026-02-15T09:30:00Z').toISOString(),
        description: 'Decentralized smart contract platform.',
        creator: 'system',
        subject_id: computeSubjectId('ethereum'),
        origin_source: 'trustgraph',
      },
      {
        id: 3,
        name: 'solana',
        displayName: 'Solana Foundation',
        type: 'project',
        created_at: new Date('2026-03-01T15:00:00Z').toISOString(),
        description: 'High-speed layer-1 blockchain technology.',
        creator: 'system',
        subject_id: computeSubjectId('solana'),
        origin_source: 'trustgraph',
      },
      {
        id: 4,
        name: 'vitalik.eth',
        displayName: 'Vitalik Buterin Wallet',
        type: 'wallet',
        created_at: new Date('2026-03-05T18:45:00Z').toISOString(),
        description: 'Core founder of Ethereum network public wallet.',
        creator: 'system',
        subject_id: computeSubjectId('vitalik.eth'),
        origin_source: 'trustgraph',
      },
    ];

    this.attestations = [
      {
        id: 1,
        from_user: 'AliceCrypto',
        to_entity: 'ethereum',
        trust_score: 5,
        comment: 'Perfect smart contract execution and robust network security.',
        timestamp: new Date('2026-04-10T14:20:00Z').toISOString(),
        evidence_category: 'offchain_community',
        verified_onchain: false,
        revoked: false,
        subject_id: computeSubjectId('ethereum'),
      },
      {
        id: 2,
        from_user: 'DefiBob',
        to_entity: 'ethereum',
        trust_score: 4,
        comment: 'High gas fees sometimes, but standard for decentralization.',
        timestamp: new Date('2026-04-12T08:15:00Z').toISOString(),
        evidence_category: 'offchain_community',
        verified_onchain: false,
        revoked: false,
        subject_id: computeSubjectId('ethereum'),
      },
      {
        id: 3,
        from_user: 'AliceCrypto',
        to_entity: 'binance',
        trust_score: 4,
        comment: 'Super fast trades, reliable volume, but highly centralized.',
        timestamp: new Date('2026-04-20T11:40:00Z').toISOString(),
        evidence_category: 'offchain_community',
        verified_onchain: false,
        revoked: false,
        subject_id: computeSubjectId('binance'),
      },
      {
        id: 4,
        from_user: 'SatoshiFid',
        to_entity: 'vitalik.eth',
        trust_score: 5,
        comment: 'Highly transparent developer wallet with frequent open-source activity.',
        timestamp: new Date('2026-05-01T22:10:00Z').toISOString(),
        evidence_category: 'offchain_community',
        verified_onchain: false,
        revoked: false,
        subject_id: computeSubjectId('vitalik.eth'),
      },
      {
        id: 5,
        from_user: 'CryptoWizard',
        to_entity: 'solana',
        trust_score: 3,
        comment: 'Incredible speed but had several consensus halts historically.',
        timestamp: new Date('2026-05-15T19:05:00Z').toISOString(),
        evidence_category: 'offchain_community',
        verified_onchain: false,
        revoked: false,
        subject_id: computeSubjectId('solana'),
      },
    ];

    this.rebuildTriples();
    this.save();
  }

  private save() {
    try {
      this.storage.save({
        schemaVersion: 2,
        atoms: this.atoms,
        attestations: this.attestations,
        triples: this.triples,
        walletLinks: this.walletLinks,
        activationCodes: this.activationCodes,
        authChallenges: this.authChallenges,
        indexerState: this.indexerState,
      });
    } catch (err) {
      console.error('[Database] Error saving database snapshot:', err);
    }
  }

  private rebuildTriples() {
    this.triples = this.attestations.map((att, idx) => ({
      id: idx + 1,
      subject: att.wallet_address ? att.wallet_address : `@${att.from_user}`,
      predicate: 'trusts',
      object: att.to_entity,
      score: att.trust_score,
      creator: att.from_user,
      timestamp: att.timestamp,
      evidence_category: att.evidence_category,
      verified_onchain: att.verified_onchain,
      revoked: att.revoked,
    }));
  }

  private nextAttestationId(): number {
    return this.attestations.length > 0
      ? Math.max(...this.attestations.map((a) => a.id)) + 1
      : 1;
  }

  public getAtoms(): Atom[] {
    return this.atoms;
  }

  public getAttestations(includeRevoked = true): Attestation[] {
    if (includeRevoked) return this.attestations;
    return this.attestations.filter((a) => !a.revoked);
  }

  public getAttestationById(id: number): Attestation | undefined {
    return this.attestations.find((a) => a.id === id);
  }

  public getTriples(includeRevoked = false): Triple[] {
    if (includeRevoked) return this.triples;
    return this.triples.filter((t) => !t.revoked);
  }

  public getIndexerState(): IndexerState {
    return { ...this.indexerState };
  }

  public updateIndexerState(patch: Partial<IndexerState>) {
    this.indexerState = {
      ...this.indexerState,
      ...patch,
    };
    this.save();
  }

  public findAtom(nameOrSubjectId: string): Atom | undefined {
    const clean = (nameOrSubjectId || '').trim().toLowerCase();
    return this.atoms.find(
      (a) =>
        a.name === clean ||
        (a.subject_id && a.subject_id.toLowerCase() === clean)
    );
  }

  public createAtom(
    displayName: string,
    type: 'user' | 'project' | 'wallet',
    description: string = '',
    creator: string = 'system',
    originSource: Atom['origin_source'] = 'trustgraph',
    walletAddress?: string
  ): Atom {
    const originalName = displayName.trim();
    const searchName = normalizeSubjectKey(originalName);

    const existing = this.findAtom(searchName);
    if (existing) {
      if (walletAddress && !existing.wallet_address) {
        existing.wallet_address = walletAddress;
        this.save();
      }
      return existing;
    }

    const inferredWallet =
      walletAddress || (/^0x[0-9a-fA-F]{40}$/.test(originalName) ? originalName : undefined);

    const newAtom: Atom = {
      id: this.atoms.length > 0 ? Math.max(...this.atoms.map((a) => a.id)) + 1 : 1,
      name: searchName,
      displayName: originalName,
      type,
      created_at: new Date().toISOString(),
      description: description || `Registered ${type} entity ${originalName}`,
      creator,
      subject_id: computeSubjectId(searchName),
      wallet_address: inferredWallet,
      origin_source: originSource,
    };

    this.atoms.push(newAtom);
    this.intelCache.clear();
    this.save();
    return newAtom;
  }

  /**
   * Records an off-chain community, wallet-signed, or external Intuition attestation.
   * NEVER marks `verified_onchain: true`. Only `upsertVerifiedOnChainAttestation` may set on-chain verification.
   */
  public addOffChainOrExternalAttestation(params: {
    fromUser: string;
    toEntityName: string;
    trustScore: number;
    comment: string;
    category: Exclude<EvidenceCategory, 'onchain_verified'>;
    signature?: string;
    walletAddress?: string;
    externalNetwork?: string;
  }): Attestation {
    const cleanFrom = params.fromUser.trim().replace(/^@/, '');
    const cleanTo = params.toEntityName.trim();
    const cleanToKey = normalizeSubjectKey(cleanTo);
    const clampedScore = Math.min(5, Math.max(1, Math.trunc(params.trustScore)));

    let targetAtom = this.findAtom(cleanToKey);
    if (!targetAtom) {
      const isWallet = /^0x[a-fA-F0-9]{40}$/.test(cleanTo);
      const origin =
        params.category === 'external_intuition'
          ? 'intuition'
          : params.category === 'external_intuition_sample'
          ? 'intuition_sample'
          : 'trustgraph';
      targetAtom = this.createAtom(
        cleanTo,
        isWallet ? 'wallet' : 'project',
        `Created via ${params.category.replace(/_/g, ' ')} record from ${cleanFrom}`,
        cleanFrom,
        origin
      );
    }

    // One active off-chain record per (from_user/wallet, to_entity, category)
    const existingIdx = this.attestations.findIndex(
      (a) =>
        !a.verified_onchain &&
        !a.revoked &&
        a.evidence_category === params.category &&
        a.to_entity === targetAtom!.name &&
        (params.walletAddress && a.wallet_address
          ? a.wallet_address.toLowerCase() === params.walletAddress.toLowerCase()
          : a.from_user.toLowerCase() === cleanFrom.toLowerCase())
    );

    if (existingIdx !== -1) {
      const target = this.attestations[existingIdx];
      target.trust_score = clampedScore;
      target.comment = params.comment || target.comment;
      target.timestamp = new Date().toISOString();
      if (params.signature) target.signature = params.signature;
      if (params.walletAddress) target.wallet_address = params.walletAddress;
      if (params.externalNetwork) target.external_network = params.externalNetwork;

      this.rebuildTriples();
      this.intelCache.clear();
      this.save();
      return target;
    }

    const newAtt: Attestation = {
      id: this.nextAttestationId(),
      from_user: cleanFrom,
      to_entity: targetAtom.name,
      trust_score: clampedScore,
      comment: params.comment || 'Submitted community trust signal.',
      timestamp: new Date().toISOString(),
      signature: params.signature,
      wallet_address: params.walletAddress,
      evidence_category: params.category,
      verified_onchain: false,
      revoked: false,
      subject_id: targetAtom.subject_id || computeSubjectId(targetAtom.name),
      external_network: params.externalNetwork,
    };

    this.attestations.push(newAtt);
    this.rebuildTriples();
    this.intelCache.clear();
    this.save();
    return newAtt;
  }

  // Backward-compatible wrapper used by existing callers for off-chain community attestations
  public addAttestation(
    fromUser: string,
    toEntityName: string,
    trustScore: number,
    comment: string,
    signature?: string,
    walletAddress?: string
  ): Attestation {
    return this.addOffChainOrExternalAttestation({
      fromUser,
      toEntityName,
      trustScore,
      comment,
      category: 'offchain_community',
      signature,
      walletAddress,
    });
  }

  /**
   * Idempotently stores a verified Robinhood Chain Testnet attestation after receipt + event verification.
   */
  public upsertVerifiedOnChainAttestation(params: {
    chainId: number;
    contractAddress: string;
    txHash: string;
    blockNumber: number;
    logIndex: number;
    onchainAttestationId: string;
    subjectId: string;
    attester: string;
    score: number;
    evidenceHash: string;
    createdAtSec: number;
    revoked: boolean;
    entityNameHint?: string;
    commentHint?: string;
    fromUserHint?: string;
    supersededAttestationId?: string;
  }): { record: Attestation; created: boolean } {
    const cleanContract = params.contractAddress.toLowerCase();
    const cleanTx = params.txHash.toLowerCase();

    // Mark superseded prior attestation as revoked if applicable
    if (params.supersededAttestationId) {
      this.markOnChainAttestationRevoked({
        chainId: params.chainId,
        contractAddress: params.contractAddress,
        onchainAttestationId: params.supersededAttestationId,
        revokedAtSec: params.createdAtSec,
        revocationTxHash: params.txHash,
      });
    } else {
      // Also ensure any earlier active on-chain record for same (attester, subjectId, contract) is superseded
      this.attestations.forEach((existing) => {
        if (
          existing.verified_onchain &&
          !existing.revoked &&
          existing.chain_id === params.chainId &&
          existing.contract_address?.toLowerCase() === cleanContract &&
          existing.wallet_address?.toLowerCase() === params.attester.toLowerCase() &&
          existing.subject_id?.toLowerCase() === params.subjectId.toLowerCase() &&
          existing.onchain_attestation_id !== params.onchainAttestationId
        ) {
          existing.revoked = true;
          existing.revoked_at = new Date(params.createdAtSec * 1000).toISOString();
          existing.revocation_tx_hash = params.txHash;
        }
      });
    }

    // Resolve target atom by subjectId or entityNameHint
    let atom = this.findAtom(params.subjectId);
    if (!atom && params.entityNameHint) {
      const hintedKey = normalizeSubjectKey(params.entityNameHint);
      if (computeSubjectId(hintedKey).toLowerCase() === params.subjectId.toLowerCase()) {
        const isWallet = /^0x[0-9a-fA-F]{40}$/.test(params.entityNameHint.trim());
        atom = this.createAtom(
          params.entityNameHint.trim(),
          isWallet ? 'wallet' : 'project',
          `Indexed via verified Robinhood Chain attestation #${params.onchainAttestationId}`,
          params.attester,
          'robinhood_chain'
        );
      }
    }
    if (!atom) {
      const shortSubject = `subject-${params.subjectId.slice(2, 10)}`;
      atom = {
        id: this.atoms.length > 0 ? Math.max(...this.atoms.map((a) => a.id)) + 1 : 1,
        name: shortSubject,
        displayName: `On-Chain Subject ${params.subjectId.slice(0, 10)}...`,
        type: 'project',
        created_at: new Date(params.createdAtSec * 1000).toISOString(),
        description: `Indexed directly from Robinhood Chain Testnet subjectId ${params.subjectId}`,
        creator: params.attester,
        subject_id: params.subjectId,
        origin_source: 'robinhood_chain',
      };
      this.atoms.push(atom);
    }

    // Idempotency check by (chainId, contractAddress, onchainAttestationId) OR (chainId, txHash, logIndex)
    const duplicateIdx = this.attestations.findIndex(
      (a) =>
        a.verified_onchain &&
        a.chain_id === params.chainId &&
        a.contract_address?.toLowerCase() === cleanContract &&
        (a.onchain_attestation_id === params.onchainAttestationId ||
          (a.tx_hash?.toLowerCase() === cleanTx && a.log_index === params.logIndex))
    );

    const linkedTelegram = this.getTelegramUserForWallet(params.attester);
    const cleanFromUser =
      (params.fromUserHint && params.fromUserHint.trim().replace(/^@/, '')) ||
      linkedTelegram ||
      `${params.attester.slice(0, 6)}...${params.attester.slice(-4)}`;

    if (duplicateIdx !== -1) {
      const existing = this.attestations[duplicateIdx];
      existing.revoked = params.revoked;
      existing.block_number = params.blockNumber;
      existing.log_index = params.logIndex;
      existing.tx_hash = params.txHash;
      if (params.commentHint && params.commentHint.trim() && existing.comment.startsWith('On-chain attestation #')) {
        existing.comment = params.commentHint.trim();
      }
      if (params.fromUserHint && params.fromUserHint.trim()) {
        existing.from_user = cleanFromUser;
      }
      this.rebuildTriples();
      this.intelCache.clear();
      this.save();
      return { record: existing, created: false };
    }

    const createdIso = new Date(params.createdAtSec * 1000).toISOString();
    const newRecord: Attestation = {
      id: this.nextAttestationId(),
      from_user: cleanFromUser,
      to_entity: atom.name,
      trust_score: Math.min(5, Math.max(1, params.score)),
      comment:
        params.commentHint && params.commentHint.trim()
          ? params.commentHint.trim()
          : `On-chain attestation #${params.onchainAttestationId} verified on Robinhood Chain Testnet.`,
      timestamp: createdIso,
      wallet_address: params.attester,
      evidence_category: 'onchain_verified',
      verified_onchain: true,
      revoked: params.revoked,
      chain_id: params.chainId,
      contract_address: params.contractAddress,
      tx_hash: params.txHash,
      block_number: params.blockNumber,
      log_index: params.logIndex,
      onchain_attestation_id: params.onchainAttestationId,
      subject_id: params.subjectId,
      evidence_hash: params.evidenceHash,
    };

    this.attestations.push(newRecord);
    this.rebuildTriples();
    this.intelCache.clear();
    this.save();
    return { record: newRecord, created: true };
  }

  public markOnChainAttestationRevoked(params: {
    chainId: number;
    contractAddress: string;
    onchainAttestationId: string;
    revokedAtSec: number;
    revocationTxHash?: string;
  }): Attestation | null {
    const cleanContract = params.contractAddress.toLowerCase();
    const match = this.attestations.find(
      (a) =>
        a.verified_onchain &&
        a.chain_id === params.chainId &&
        a.contract_address?.toLowerCase() === cleanContract &&
        a.onchain_attestation_id === String(params.onchainAttestationId)
    );

    if (!match) return null;
    if (match.revoked && match.revocation_tx_hash === params.revocationTxHash) {
      return match;
    }

    match.revoked = true;
    match.revoked_at = new Date(params.revokedAtSec * 1000).toISOString();
    if (params.revocationTxHash) {
      match.revocation_tx_hash = params.revocationTxHash;
    }

    this.rebuildTriples();
    this.intelCache.clear();
    this.save();
    return match;
  }

  public revokeOffChainAttestation(attestationId: number, callerWallet: string): Attestation {
    const match = this.attestations.find((a) => a.id === attestationId);
    if (!match) {
      throw new Error('Attestation record not found.');
    }
    if (match.verified_onchain) {
      throw new Error('On-chain attestations must be revoked on Robinhood Chain Testnet via TrustGraphRegistry.revoke().');
    }
    if (!match.wallet_address || match.wallet_address.toLowerCase() !== callerWallet.toLowerCase()) {
      throw new Error('Only the original signing wallet can revoke this attestation.');
    }
    if (match.revoked) {
      throw new Error('Attestation is already revoked.');
    }

    match.revoked = true;
    match.revoked_at = new Date().toISOString();
    this.rebuildTriples();
    this.intelCache.clear();
    this.save();
    return match;
  }

  /**
   * Removes or updates records from orphaned blocks if a shallow chain reorganization occurred.
   */
  public removeOrphanedOnChainAttestation(chainId: number, contractAddress: string, onchainAttestationId: string) {
    const before = this.attestations.length;
    this.attestations = this.attestations.filter(
      (a) =>
        !(
          a.verified_onchain &&
          a.chain_id === chainId &&
          a.contract_address?.toLowerCase() === contractAddress.toLowerCase() &&
          a.onchain_attestation_id === onchainAttestationId
        )
    );
    if (this.attestations.length !== before) {
      this.rebuildTriples();
      this.intelCache.clear();
      this.save();
    }
  }

  public getUserReputations(): Map<string, { username: string; credibility: number; count: number; alignment: number }> {
    const reps = new Map<string, { username: string; credibility: number; count: number; alignment: number }>();
    const activeAtts = this.attestations.filter((a) => !a.revoked && a.evidence_category !== 'external_intuition_sample');

    const userMap = new Map<string, Attestation[]>();
    activeAtts.forEach((att) => {
      const userKey = (att.wallet_address || att.from_user).trim().toLowerCase();
      if (!userMap.has(userKey)) userMap.set(userKey, []);
      userMap.get(userKey)!.push(att);
    });

    const simpleAvgMap = new Map<string, number>();
    const entityGroups = new Map<string, number[]>();
    activeAtts.forEach((att) => {
      const entKey = att.to_entity.trim().toLowerCase();
      if (!entityGroups.has(entKey)) entityGroups.set(entKey, []);
      entityGroups.get(entKey)!.push(att.trust_score);
    });

    entityGroups.forEach((scores, ent) => {
      const sum = scores.reduce((a, s) => a + s, 0);
      simpleAvgMap.set(ent, sum / scores.length);
    });

    userMap.forEach((userAtts, userKey) => {
      const uniqueEntities = new Set(userAtts.map((a) => a.to_entity.toLowerCase()));
      const baseCredibility = 1.0 + Math.min(2.0, uniqueEntities.size * 0.35);

      let alignCount = 0;
      userAtts.forEach((att) => {
        const entAvg = simpleAvgMap.get(att.to_entity.toLowerCase());
        if (entAvg !== undefined && Math.abs(att.trust_score - entAvg) <= 1.25) {
          alignCount++;
        }
      });

      const alignRatio = userAtts.length > 0 ? alignCount / userAtts.length : 0;
      const onChainBonus = userAtts.some((a) => a.verified_onchain) ? 0.5 : 0;
      const totalCred = Math.min(5.0, Math.max(1.0, parseFloat((baseCredibility + alignRatio * 1.2 + onChainBonus).toFixed(2))));

      reps.set(userKey, {
        username: userAtts[0].from_user,
        credibility: totalCred,
        count: userAtts.length,
        alignment: Math.round(alignRatio * 100),
      });
    });

    return reps;
  }

  public getReputationBreakdown(entityName: string): ReputationBreakdown {
    const key = normalizeSubjectKey(entityName);
    const atom = this.findAtom(key);
    const subjectId = atom?.subject_id || computeSubjectId(key);
    const allForEntity = this.attestations.filter((a) => a.to_entity === key);

    const HALF_LIFE_DAYS = 90;
    const computeTimeFactor = (iso: string) => {
      const ageDays = Math.max(0, (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
      return Math.max(0.25, Math.exp((-Math.LN2 * ageDays) / HALF_LIFE_DAYS));
    };

    const calcBucket = (items: Attestation[], revokedItems: Attestation[] = [], sampleCount?: number): CategoryScoreBreakdown => {
      if (items.length === 0) {
        return {
          activeCount: 0,
          revokedCount: revokedItems.length,
          sampleCount,
          simpleAverage: 0,
          timeWeightedAverage: 0,
        };
      }
      const simpleSum = items.reduce((s, a) => s + a.trust_score, 0);
      let wSum = 0;
      let wTotal = 0;
      items.forEach((a) => {
        const tf = computeTimeFactor(a.timestamp);
        wSum += a.trust_score * tf;
        wTotal += tf;
      });
      return {
        activeCount: items.length,
        revokedCount: revokedItems.length,
        sampleCount,
        simpleAverage: parseFloat((simpleSum / items.length).toFixed(2)),
        timeWeightedAverage: wTotal > 0 ? parseFloat((wSum / wTotal).toFixed(2)) : 0,
      };
    };

    const onchainActive = allForEntity.filter((a) => a.evidence_category === 'onchain_verified' && !a.revoked);
    const onchainRevoked = allForEntity.filter((a) => a.evidence_category === 'onchain_verified' && a.revoked);

    const offchainSignedActive = allForEntity.filter((a) => a.evidence_category === 'offchain_signed' && !a.revoked);
    const offchainSignedRevoked = allForEntity.filter((a) => a.evidence_category === 'offchain_signed' && a.revoked);

    const communityActive = allForEntity.filter((a) => a.evidence_category === 'offchain_community' && !a.revoked);
    const communityRevoked = allForEntity.filter((a) => a.evidence_category === 'offchain_community' && a.revoked);

    const intuitionLive = allForEntity.filter((a) => a.evidence_category === 'external_intuition' && !a.revoked);
    const intuitionSample = allForEntity.filter((a) => a.evidence_category === 'external_intuition_sample' && !a.revoked);

    const distribution: Record<'1' | '2' | '3' | '4' | '5', number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };

    const activeNonSample = [...onchainActive, ...offchainSignedActive, ...communityActive, ...intuitionLive];
    activeNonSample.forEach((a) => {
      const k = String(Math.min(5, Math.max(1, Math.round(a.trust_score)))) as '1' | '2' | '3' | '4' | '5';
      distribution[k] += 1;
    });

    const weights = {
      onchainVerified: 1.0,
      offchainSigned: 0.6,
      externalIntuition: 0.5,
      communityUnverified: 0.25,
      timeDecayHalfLifeDays: HALF_LIFE_DAYS,
    };

    let compositeWeightedSum = 0;
    let compositeWeightTotal = 0;

    const accumulate = (list: Attestation[], sourceWeight: number) => {
      list.forEach((a) => {
        const w = sourceWeight * computeTimeFactor(a.timestamp);
        compositeWeightedSum += a.trust_score * w;
        compositeWeightTotal += w;
      });
    };

    accumulate(onchainActive, weights.onchainVerified);
    accumulate(offchainSignedActive, weights.offchainSigned);
    accumulate(intuitionLive, weights.externalIntuition);
    accumulate(communityActive, weights.communityUnverified);

    const compositeScore =
      compositeWeightTotal > 0 ? parseFloat((compositeWeightedSum / compositeWeightTotal).toFixed(2)) : 0;

    const totalRevoked = onchainRevoked.length + offchainSignedRevoked.length + communityRevoked.length;

    return {
      entityName: atom ? atom.displayName : entityName,
      subjectId,
      scoreDistribution: distribution,
      categories: {
        onchainVerified: calcBucket(onchainActive, onchainRevoked),
        offchainSigned: calcBucket(offchainSignedActive, offchainSignedRevoked),
        communityUnverified: calcBucket(communityActive, communityRevoked),
        externalIntuition: calcBucket(intuitionLive, [], intuitionSample.length),
      },
      compositeSignal: {
        score: compositeScore,
        activeEvidenceCount: activeNonSample.length,
        revokedCount: totalRevoked,
        formulaSummary:
          'Provenance-weighted mean with 90-day exponential recency decay: On-Chain Verified (1.0x), Wallet-Signed Off-Chain (0.6x), External Intuition (0.5x), Unverified Community (0.25x). Revoked and dev-sample records are excluded.',
        weightsUsed: weights,
        disclaimer:
          'Trust scores summarize community and on-chain wallet signals. This protocol does not enforce proof-of-personhood or Sybil resistance and is not a guarantee of financial safety.',
      },
    };
  }

  public getEntityStats(entityName: string) {
    const key = normalizeSubjectKey(entityName);
    const allRelated = this.attestations.filter((a) => a.to_entity === key);
    const activeRelated = allRelated.filter((a) => !a.revoked && a.evidence_category !== 'external_intuition_sample');
    const breakdown = this.getReputationBreakdown(key);

    if (activeRelated.length === 0) {
      return {
        count: 0,
        verifiedOnChainCount: 0,
        offChainCount: 0,
        revokedCount: breakdown.compositeSignal.revokedCount,
        average: 0,
        simpleAverage: 0,
        list: allRelated,
        weightDetails: [],
        breakdown,
      };
    }

    const reps = this.getUserReputations();
    const weightDetails = activeRelated.map((att) => {
      const userKey = (att.wallet_address || att.from_user).toLowerCase();
      const userRep = reps.get(userKey) || {
        username: att.from_user,
        credibility: 1.0,
        count: 1,
        alignment: 50,
      };
      const ageDays = Math.max(0, (Date.now() - new Date(att.timestamp).getTime()) / (1000 * 60 * 60 * 24));
      const timeDecayFactor = Math.max(0.25, Math.exp((-Math.LN2 * ageDays) / 90));
      const provenanceMultiplier =
        att.evidence_category === 'onchain_verified'
          ? 1.0
          : att.evidence_category === 'offchain_signed'
          ? 0.6
          : att.evidence_category === 'external_intuition'
          ? 0.5
          : 0.25;
      const finalWeight = parseFloat((userRep.credibility * timeDecayFactor * provenanceMultiplier).toFixed(3));

      return {
        id: att.id,
        from_user: att.from_user,
        wallet_address: att.wallet_address,
        evidence_category: att.evidence_category,
        verified_onchain: att.verified_onchain,
        tx_hash: att.tx_hash,
        trust_score: att.trust_score,
        user_credibility: userRep.credibility,
        time_decay: parseFloat(timeDecayFactor.toFixed(2)),
        provenance_weight: provenanceMultiplier,
        final_weight: finalWeight,
        comment: att.comment,
        timestamp: att.timestamp,
      };
    });

    const arithmeticSum = activeRelated.reduce((acc, current) => acc + current.trust_score, 0);
    const arithmeticAverage = parseFloat((arithmeticSum / activeRelated.length).toFixed(2));

    return {
      count: activeRelated.length,
      verifiedOnChainCount: breakdown.categories.onchainVerified.activeCount,
      offChainCount:
        breakdown.categories.offchainSigned.activeCount +
        breakdown.categories.communityUnverified.activeCount,
      revokedCount: breakdown.compositeSignal.revokedCount,
      average: breakdown.compositeSignal.score,
      simpleAverage: arithmeticAverage,
      list: allRelated,
      weightDetails,
      breakdown,
    };
  }

  public getAtomDisplayName(name: string): string {
    const atom = this.findAtom(name);
    return atom ? atom.displayName : name;
  }

  public findTrustPathsBackwards(targetName: string): IndirectPath[] {
    const cleanTarget = normalizeSubjectKey(targetName);
    const paths: IndirectPath[] = [];
    const attestations = this.attestations.filter((a) => !a.revoked && a.evidence_category !== 'external_intuition_sample');
    const reps = this.getUserReputations();

    const directAtts = attestations.filter((a) => a.to_entity === cleanTarget);

    directAtts.forEach((att1) => {
      const u1 = att1.from_user.toLowerCase();
      const u1Rep = reps.get((att1.wallet_address || u1).toLowerCase()) || { credibility: 1.0 };
      const provBoost = att1.verified_onchain ? 1.25 : 1.0;
      const strength1 = u1Rep.credibility * provBoost;

      paths.push({
        path: [att1.from_user, this.getAtomDisplayName(att1.to_entity)],
        score: att1.trust_score,
        influence: parseFloat(strength1.toFixed(3)),
      });

      const atts2 = attestations.filter(
        (a) =>
          a.to_entity === u1 &&
          a.from_user.toLowerCase() !== u1 &&
          a.from_user.toLowerCase() !== cleanTarget
      );

      atts2.forEach((att2) => {
        const u2 = att2.from_user.toLowerCase();
        const u2Rep = reps.get((att2.wallet_address || u2).toLowerCase()) || { credibility: 1.0 };
        const scoreFactor2 = att2.trust_score / 5.0;
        const strength2 = 0.5 * scoreFactor2 * u2Rep.credibility;

        paths.push({
          path: [att2.from_user, att1.from_user, this.getAtomDisplayName(att1.to_entity)],
          score: att1.trust_score,
          influence: parseFloat(strength2.toFixed(3)),
        });
      });
    });

    return paths;
  }

  public getGraphIntelligence(entityName: string): GraphIntelligence {
    const cleanTarget = normalizeSubjectKey(entityName);
    const cached = this.intelCache.get(cleanTarget);
    if (cached) return cached;

    const atom = this.findAtom(cleanTarget);
    const displayName = atom ? atom.displayName : entityName;
    const breakdown = this.getReputationBreakdown(cleanTarget);
    const paths = this.findTrustPathsBackwards(cleanTarget);

    const bestPathBySource = new Map<string, IndirectPath>();
    paths.forEach((p) => {
      const source = p.path[0].toLowerCase();
      const existing = bestPathBySource.get(source);
      if (!existing || p.influence > existing.influence) {
        bestPathBySource.set(source, p);
      }
    });

    const weightedScore = breakdown.compositeSignal.score;
    const directAtts = this.attestations.filter(
      (a) => a.to_entity === cleanTarget && !a.revoked && a.evidence_category !== 'external_intuition_sample'
    );

    let riskScore = 0;
    const riskFactors: string[] = [];

    if (directAtts.length === 0) {
      riskScore = 50;
      riskFactors.push('No active attestations have been recorded for this entity yet.');
    } else {
      if (breakdown.categories.onchainVerified.activeCount === 0) {
        riskScore += 18;
        riskFactors.push('Zero verified Robinhood Chain attestations; current signals are off-chain only.');
      }
      if (directAtts.length === 1) {
        riskScore += 28;
        riskFactors.push('Single-attester concentration: reputation relies on only one contributor.');
      } else if (directAtts.length === 2) {
        riskScore += 14;
        riskFactors.push('Limited sample size: only 2 contributors have attested to this entity.');
      }
      if (breakdown.compositeSignal.revokedCount > 0) {
        riskScore += Math.min(20, breakdown.compositeSignal.revokedCount * 8);
        riskFactors.push(
          `${breakdown.compositeSignal.revokedCount} prior attestation(s) were revoked or superseded.`
        );
      }
      if (weightedScore > 0 && weightedScore < 3.0) {
        riskScore += 25;
        riskFactors.push('Low composite trust score (< 3.0/5) reflects negative community sentiment.');
      }
    }

    riskScore = Math.min(95, Math.max(5, riskScore));
    if (riskFactors.length === 0) {
      riskFactors.push('Attestations include verified evidence with balanced contributor distribution.');
    }

    let confidenceScore = 10;
    if (directAtts.length > 0) {
      confidenceScore += Math.min(40, directAtts.length * 10);
      confidenceScore += Math.min(35, breakdown.categories.onchainVerified.activeCount * 15);
      confidenceScore += Math.min(15, breakdown.categories.offchainSigned.activeCount * 8);
    }
    confidenceScore = Math.min(100, Math.max(10, confidenceScore));

    const confidenceLevel: 'Low' | 'Medium' | 'High' =
      confidenceScore >= 75 ? 'High' : confidenceScore >= 40 ? 'Medium' : 'Low';

    const topInfluencingNodes = Array.from(bestPathBySource.entries())
      .map(([source, p]) => {
        const atomOfSource = this.findAtom(source);
        return {
          id: source,
          name: atomOfSource ? atomOfSource.displayName : `@${p.path[0]}`,
          type: atomOfSource ? atomOfSource.type : 'user',
          strength: p.influence,
        };
      })
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5);

    const result: GraphIntelligence = {
      entityName: displayName,
      weightedScore,
      riskScore,
      riskFactors,
      confidenceScore,
      confidenceLevel,
      topInfluencingNodes,
      indirectPaths: paths,
      reputationBreakdown: breakdown,
    };

    this.intelCache.set(cleanTarget, result);
    return result;
  }

  public getTopEntities() {
    return this.atoms
      .map((atom) => {
        const metrics = this.getEntityStats(atom.name);
        return {
          name: atom.name,
          displayName: atom.displayName,
          type: atom.type,
          description: atom.description,
          subjectId: atom.subject_id || computeSubjectId(atom.name),
          originSource: atom.origin_source || 'trustgraph',
          average: metrics.average,
          simpleAverage: metrics.simpleAverage,
          count: metrics.count,
          verifiedOnChainCount: metrics.verifiedOnChainCount,
          offChainCount: metrics.offChainCount,
          revokedCount: metrics.revokedCount,
        };
      })
      .sort((a, b) => b.verifiedOnChainCount - a.verifiedOnChainCount || b.average - a.average || b.count - a.count);
  }

  // -------------------------------------------------------------------------
  // Cryptographic Nonce Challenge & Wallet Linking
  // -------------------------------------------------------------------------
  public createAuthChallenge(
    walletAddress: string,
    domain: string,
    purpose: AuthChallenge['purpose']
  ): AuthChallenge {
    const now = Date.now();
    this.authChallenges = this.authChallenges.filter((c) => !c.used && c.expires_at > now);

    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAt = new Date(now).toISOString();
    const expiresAt = now + 5 * 60 * 1000; // 5-minute TTL
    const cleanAddr = walletAddress.trim();

    const message = [
      `${domain} wants you to verify wallet ownership for TrustGraph:`,
      cleanAddr,
      '',
      `Action: ${purpose}`,
      `Network: ${ROBINHOOD_TESTNET.chainName} (Chain ID: ${ROBINHOOD_TESTNET.chainId})`,
      `URI: https://${domain}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    ].join('\n');

    const challenge: AuthChallenge = {
      nonce,
      wallet_address: cleanAddr,
      domain,
      purpose,
      message,
      issued_at: issuedAt,
      expires_at: expiresAt,
      used: false,
    };

    this.authChallenges.push(challenge);
    this.save();
    return challenge;
  }

  public consumeAuthChallenge(
    nonce: string,
    walletAddress: string,
    expectedPurpose: AuthChallenge['purpose']
  ): { valid: true; challenge: AuthChallenge } | { valid: false; error: string } {
    const now = Date.now();
    const match = this.authChallenges.find((c) => c.nonce === nonce);

    if (!match) {
      return { valid: false, error: 'Authentication nonce not found or expired.' };
    }
    if (match.used) {
      return { valid: false, error: 'Authentication nonce has already been used (replay rejected).' };
    }
    if (match.expires_at <= now) {
      match.used = true;
      this.save();
      return { valid: false, error: 'Authentication nonce has expired. Request a new challenge.' };
    }
    if (match.purpose !== expectedPurpose) {
      return { valid: false, error: 'Authentication nonce purpose mismatch.' };
    }
    if (match.wallet_address.toLowerCase() !== walletAddress.trim().toLowerCase()) {
      return { valid: false, error: 'Challenge wallet address does not match caller.' };
    }

    match.used = true;
    this.save();
    return { valid: true, challenge: match };
  }

  public getWalletLinks(): WalletLink[] {
    return this.walletLinks;
  }

  public generateActivationCodeForVerifiedWallet(walletAddress: string): string {
    const cleanAddress = walletAddress.trim().toLowerCase();

    this.activationCodes = this.activationCodes.filter(
      (c) => c.wallet_address.toLowerCase() !== cleanAddress && c.expires_at > Date.now()
    );

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(randomBytes[i] % chars.length);
    }

    this.activationCodes.push({
      code,
      wallet_address: walletAddress.trim(),
      created_at: new Date().toISOString(),
      expires_at: Date.now() + 10 * 60 * 1000, // 10-minute expiration
    });

    this.save();
    return code;
  }

  public activateTelegram(
    code: string,
    telegramUser: string,
    telegramId?: string
  ): { success: boolean; walletAddress?: string; error?: string } {
    const searchCode = code.trim().toUpperCase();
    const cleanUser = telegramUser.trim().replace(/^@/, '');

    const now = Date.now();
    this.activationCodes = this.activationCodes.filter((c) => c.expires_at > now);

    const matchIdx = this.activationCodes.findIndex((c) => c.code === searchCode);
    if (matchIdx === -1) {
      return {
        success: false,
        error: 'Invalid or expired activation code. Sign a fresh linking challenge on the TrustGraph Web Dashboard.',
      };
    }

    const matched = this.activationCodes[matchIdx];
    const walletAddress = matched.wallet_address;

    this.activationCodes.splice(matchIdx, 1);

    this.walletLinks = this.walletLinks.filter(
      (l) =>
        l.telegram_user.toLowerCase() !== cleanUser.toLowerCase() &&
        l.wallet_address.toLowerCase() !== walletAddress.toLowerCase()
    );

    this.walletLinks.push({
      telegram_user: cleanUser,
      telegram_id: telegramId ? String(telegramId) : undefined,
      wallet_address: walletAddress,
      linked_at: new Date().toISOString(),
      verified_signature: true,
    });

    this.save();
    return { success: true, walletAddress };
  }

  public getLinkedWallet(telegramUser: string): string | undefined {
    const cleanUser = telegramUser.trim().replace(/^@/, '').toLowerCase();
    const link = this.walletLinks.find((l) => l.telegram_user.toLowerCase() === cleanUser);
    return link ? link.wallet_address : undefined;
  }

  public getTelegramUserForWallet(walletAddress: string): string | undefined {
    const cleanAddr = walletAddress.trim().toLowerCase();
    const link = this.walletLinks.find((l) => l.wallet_address.toLowerCase() === cleanAddr);
    return link ? link.telegram_user : undefined;
  }

  public unlinkWallet(walletAddress: string): boolean {
    const cleanAddr = walletAddress.trim().toLowerCase();
    const initialLen = this.walletLinks.length;
    this.walletLinks = this.walletLinks.filter((l) => l.wallet_address.toLowerCase() !== cleanAddr);
    if (this.walletLinks.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }
}

export const db = new DatabaseEngine();
