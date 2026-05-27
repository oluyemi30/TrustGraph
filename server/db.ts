import fs from 'fs';
import path from 'path';

export interface WalletLink {
  telegram_user: string;
  telegram_id?: string;
  wallet_address: string;
  linked_at: string;
}

export interface ActivationCode {
  code: string;
  wallet_address: string;
  created_at: string;
  expires_at: number;
}

export interface Atom {
  id: number;
  name: string; // unique, e.g. "binance", "solana" (lowercased internally for matching)
  displayName: string; // e.g. "Binance", "Solana"
  type: 'user' | 'project' | 'wallet';
  created_at: string;
  description: string;
  creator: string; // telegram handle or "system"
}

export interface Attestation {
  id: number;
  from_user: string; // e.g. "satoshi"
  to_entity: string; // target name
  trust_score: number; // 1-5
  comment: string;
  timestamp: string;
  signature?: string;
  wallet_address?: string;
}

export interface Triple {
  id: number;
  subject: string; // entity/user name
  predicate: string; // e.g. "trusts", "attests_to"
  object: string; // entity name
  score: number;
  creator: string;
  timestamp: string;
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

export interface GraphIntelligence {
  entityName: string;
  weightedScore: number;
  riskScore: number;
  riskFactors: string[];
  confidenceScore: number;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  topInfluencingNodes: GraphInfluenceNode[];
  indirectPaths: IndirectPath[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

class DatabaseEngine {
  private atoms: Atom[] = [];
  private attestations: Attestation[] = [];
  private triples: Triple[] = [];
  private walletLinks: WalletLink[] = [];
  private activationCodes: ActivationCode[] = [];
  private intelCache = new Map<string, GraphIntelligence>();

  constructor() {
    this.init();
  }

  private init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        const data = JSON.parse(fileContent);
        this.atoms = data.atoms || [];
        this.attestations = data.attestations || [];
        this.triples = data.triples || [];
        this.walletLinks = data.walletLinks || [];
        this.activationCodes = data.activationCodes || [];
        console.log(`[Database] Loaded ${this.atoms.length} Atoms, ${this.attestations.length} Attestations, ${this.triples.length} Triples, ${this.walletLinks.length} Wallet Links.`);
      } catch (err) {
        console.error('[Database] Error reading database.json, initializing fresh.', err);
        this.save();
      }
    } else {
      // Seed with highly valuable initial project, wallet, and user atoms for a beautiful cold-start graph
      this.atoms = [
        {
          id: 1,
          name: 'binance',
          displayName: 'Binance',
          type: 'project',
          created_at: new Date('2026-01-10T12:00:00Z').toISOString(),
          description: 'Global cryptocurrency exchange network.',
          creator: 'system'
        },
        {
          id: 2,
          name: 'ethereum',
          displayName: 'Ethereum SDK',
          type: 'project',
          created_at: new Date('2026-02-15T09:30:00Z').toISOString(),
          description: 'Decentralized smart contract platform.',
          creator: 'system'
        },
        {
          id: 3,
          name: 'solana',
          displayName: 'Solana Foundation',
          type: 'project',
          created_at: new Date('2026-03-01T15:00:00Z').toISOString(),
          description: 'High-speed layer-1 blockchain technology.',
          creator: 'system'
        },
        {
          id: 4,
          name: 'vitalik.eth',
          displayName: 'Vitalik Buterin Wallet',
          type: 'wallet',
          created_at: new Date('2026-03-05T18:45:00Z').toISOString(),
          description: 'Core founder of Ethereum network public wallet.',
          creator: 'system'
        }
      ];

      this.attestations = [
        {
          id: 1,
          from_user: 'AliceCrypto',
          to_entity: 'ethereum',
          trust_score: 5,
          comment: 'Perfect smart contract execution and robust network security.',
          timestamp: new Date('2026-04-10T14:20:00Z').toISOString()
        },
        {
          id: 2,
          from_user: 'DefiBob',
          to_entity: 'ethereum',
          trust_score: 4,
          comment: 'High gas fees sometimes, but standard for decentralization.',
          timestamp: new Date('2026-04-12T08:15:00Z').toISOString()
        },
        {
          id: 3,
          from_user: 'AliceCrypto',
          to_entity: 'binance',
          trust_score: 4,
          comment: 'Super fast trades, reliable volume, but highly centralized.',
          timestamp: new Date('2026-04-20T11:40:00Z').toISOString()
        },
        {
          id: 4,
          from_user: 'SatoshiFid',
          to_entity: 'vitalik.eth',
          trust_score: 5,
          comment: 'Highly transparent developer wallet with frequent open-source activity.',
          timestamp: new Date('2026-05-01T22:10:00Z').toISOString()
        },
        {
          id: 5,
          from_user: 'CryptoWizard',
          to_entity: 'solana',
          trust_score: 3,
          comment: 'Incredible speed but had several consensus halts historically.',
          timestamp: new Date('2026-05-15T19:05:00Z').toISOString()
        }
      ];

      // Build corresponding triples for the initial seed
      this.rebuildTriples();
      this.save();
    }
  }

  private save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify({
        atoms: this.atoms,
        attestations: this.attestations,
        triples: this.triples,
        walletLinks: this.walletLinks,
        activationCodes: this.activationCodes
      }, null, 2), 'utf8');
    } catch (err) {
      console.error('[Database] Error saving DB file:', err);
    }
  }

  private rebuildTriples() {
    this.triples = [];
    this.attestations.forEach((att, idx) => {
      this.triples.push({
        id: idx + 1,
        subject: `@${att.from_user}`,
        predicate: 'trusts',
        object: att.to_entity,
        score: att.trust_score,
        creator: att.from_user,
        timestamp: att.timestamp
      });
    });
  }

  public getAtoms(): Atom[] {
    return this.atoms;
  }

  public getAttestations(): Attestation[] {
    return this.attestations;
  }

  public getTriples(): Triple[] {
    return this.triples;
  }

  public findAtom(name: string): Atom | undefined {
    const searchName = name.trim().toLowerCase();
    return this.atoms.find(a => a.name === searchName);
  }

  public createAtom(displayName: string, type: 'user' | 'project' | 'wallet', description: string = '', creator: string = 'system'): Atom {
    const originalName = displayName.trim();
    const searchName = originalName.toLowerCase();
    
    let existing = this.findAtom(searchName);
    if (existing) {
      return existing;
    }

    const newAtom: Atom = {
      id: this.atoms.length > 0 ? Math.max(...this.atoms.map(a => a.id)) + 1 : 1,
      name: searchName,
      displayName: originalName,
      type,
      created_at: new Date().toISOString(),
      description: description || `Created atom representing ${type} ${originalName}`,
      creator
    };

    this.atoms.push(newAtom);
    this.intelCache.clear();
    this.save();
    return newAtom;
  }

  public addAttestation(fromUser: string, toEntityName: string, trustScore: number, comment: string, signature?: string, walletAddress?: string): Attestation {
    const cleanFrom = fromUser.trim().replace(/^@/, '');
    const cleanTo = toEntityName.trim();
    const cleanToKey = cleanTo.toLowerCase();

    // Ensure the target entity Atom exists
    let targetAtom = this.findAtom(cleanToKey);
    if (!targetAtom) {
      // Default type is project unless user ends name with address-like hex, then wallet
      const isWallet = /^0x[a-fA-F0-9]{40}$/.test(cleanTo);
      const inferredType = isWallet ? 'wallet' : 'project';
      targetAtom = this.createAtom(cleanTo, inferredType, `Auto-created via attestation from @${cleanFrom}`, cleanFrom);
    }

    // Anti-Spam / Sybil Protection: check if this user has already attested to this exact entity
    const existingIdx = this.attestations.findIndex(
      a => a.from_user.toLowerCase() === cleanFrom.toLowerCase() && a.to_entity === targetAtom!.name
    );

    if (existingIdx !== -1) {
      // Upsert: update the score, comment, and timestamp of the existing attestation
      this.attestations[existingIdx].trust_score = Math.min(5, Math.max(1, trustScore));
      this.attestations[existingIdx].comment = comment || 'Updated trust attestation comment.';
      this.attestations[existingIdx].timestamp = new Date().toISOString();
      if (signature) this.attestations[existingIdx].signature = signature;
      if (walletAddress) this.attestations[existingIdx].wallet_address = walletAddress;

      this.rebuildTriples();
      this.intelCache.clear();
      this.save();
      return this.attestations[existingIdx];
    }

    // Insert new attestation
    const newAtt: Attestation = {
      id: this.attestations.length > 0 ? Math.max(...this.attestations.map(a => a.id)) + 1 : 1,
      from_user: cleanFrom,
      to_entity: targetAtom.name,
      trust_score: Math.min(5, Math.max(1, trustScore)),
      comment: comment || 'Staked trust without custom comment.',
      timestamp: new Date().toISOString(),
      signature,
      wallet_address: walletAddress
    };

    this.attestations.push(newAtt);

    // Rebuild triples
    this.rebuildTriples();
    this.intelCache.clear();
    this.save();

    return newAtt;
  }

  // Calculate user credibilities dynamically based on their total assertions and peer alignment
  public getUserReputations(): Map<string, { username: string; credibility: number; count: number; alignment: number }> {
    const reps = new Map<string, { username: string; credibility: number; count: number; alignment: number }>();
    
    // Group attestations by user
    const userMap = new Map<string, Attestation[]>();
    this.attestations.forEach(att => {
      const userKey = att.from_user.trim().toLowerCase();
      if (!userMap.has(userKey)) {
        userMap.set(userKey, []);
      }
      userMap.get(userKey)!.push(att);
    });

    // Compute simple averages for each entity (first pass benchmark)
    const simpleAvgMap = new Map<string, number>();
    const entityGroups = new Map<string, number[]>();
    this.attestations.forEach(att => {
      const entKey = att.to_entity.trim().toLowerCase();
      if (!entityGroups.has(entKey)) {
        entityGroups.set(entKey, []);
      }
      entityGroups.get(entKey)!.push(att.trust_score);
    });

    entityGroups.forEach((scores, ent) => {
      const sum = scores.reduce((a, s) => a + s, 0);
      simpleAvgMap.set(ent, sum / scores.length);
    });

    // Evaluate stats for each contributor
    userMap.forEach((userAtts, userKey) => {
      const uniqueEntities = new Set(userAtts.map(a => a.to_entity.toLowerCase()));
      const uniqueCount = uniqueEntities.size;

      // Base credibility increases with participation volume: 1.0 baseline, +0.4 for each unique entity validated
      const baseCredibility = 1.0 + Math.min(2.0, uniqueCount * 0.4);

      // Alignment check: count evaluations matching entity average boundaries
      let alignCount = 0;
      userAtts.forEach(att => {
        const entAvg = simpleAvgMap.get(att.to_entity.toLowerCase());
        if (entAvg !== undefined && Math.abs(att.trust_score - entAvg) <= 1.25) {
          alignCount++;
        }
      });

      const alignRatio = userAtts.length > 0 ? (alignCount / userAtts.length) : 0;
      // Peer Alignment Bonus: Adds up to +1.5 credibility
      const alignmentBonus = alignRatio * 1.5;

      const totalCredibility = parseFloat((baseCredibility + alignmentBonus).toFixed(2));
      const normalizedCredibility = Math.min(5.0, Math.max(1.0, totalCredibility));

      reps.set(userKey, {
        username: userAtts[0].from_user,
        credibility: normalizedCredibility,
        count: userAtts.length,
        alignment: Math.round(alignRatio * 100)
      });
    });

    return reps;
  }

  public getEntityStats(entityName: string) {
    const key = entityName.trim().toLowerCase();
    const related = this.attestations.filter(a => a.to_entity === key);
    
    if (related.length === 0) {
      return {
        count: 0,
        average: 0,
        simpleAverage: 0,
        list: [],
        weightDetails: []
      };
    }

    const reps = this.getUserReputations();
    
    let totalWeightSum = 0;
    let weightedScoresSum = 0;
    const weightDetails: any[] = [];

    related.forEach(att => {
      const userKey = att.from_user.toLowerCase();
      const userRep = reps.get(userKey) || { username: att.from_user, credibility: 1.0, count: 1, alignment: 50 };

      // Time-decay metric (90-day half-life decay, min multiplier 0.2)
      const ageInMs = Date.now() - new Date(att.timestamp).getTime();
      const ageInDays = ageInMs / (1000 * 60 * 60 * 24);
      const timeDecayFactor = Math.max(0.2, Math.exp(-ageInDays / 90));

      // Composite weight = credibility * time_decay
      const finalWeight = parseFloat((userRep.credibility * timeDecayFactor).toFixed(3));

      weightedScoresSum += att.trust_score * finalWeight;
      totalWeightSum += finalWeight;

      weightDetails.push({
        id: att.id,
        from_user: att.from_user,
        trust_score: att.trust_score,
        user_credibility: userRep.credibility,
        time_decay: parseFloat(timeDecayFactor.toFixed(2)),
        final_weight: finalWeight,
        comment: att.comment,
        timestamp: att.timestamp
      });
    });

    const weightedAvg = totalWeightSum > 0 ? parseFloat((weightedScoresSum / totalWeightSum).toFixed(1)) : 3.0;

    // Direct arithmetic average
    const arithmeticSum = related.reduce((acc, current) => acc + current.trust_score, 0);
    const arithmeticAverage = parseFloat((arithmeticSum / related.length).toFixed(1));

    return {
      count: related.length,
      average: weightedAvg,
      simpleAverage: arithmeticAverage,
      list: related,
      weightDetails
    };
  }

  public getAtomDisplayName(name: string): string {
    const atom = this.findAtom(name);
    return atom ? atom.displayName : name;
  }

  // Find all trust paths of length 1, 2, or 3 hops ending at target entity
  public findTrustPathsBackwards(targetName: string): IndirectPath[] {
    const cleanTarget = targetName.toLowerCase();
    const paths: IndirectPath[] = [];
    const attestations = this.getAttestations();
    const reps = this.getUserReputations();

    // 1-hop: Direct attestations to Target
    const directAtts = attestations.filter(a => a.to_entity === cleanTarget);

    directAtts.forEach(att1 => {
      const u1 = att1.from_user.toLowerCase();
      const u1Rep = reps.get(u1) || { credibility: 1.0 };
      const strength1 = u1Rep.credibility;

      // 1-hop path: [User1 -> Target] (length 1, weight 1.0)
      paths.push({
        path: [att1.from_user, this.getAtomDisplayName(att1.to_entity)],
        score: att1.trust_score,
        influence: parseFloat(strength1.toFixed(3))
      });

      // 2-hop path: [User2 -> User1 -> Target]
      // Find anyone attesting to User1 as an entity
      const atts2 = attestations.filter(a => 
        a.to_entity === u1 && 
        a.from_user.toLowerCase() !== u1 && 
        a.from_user.toLowerCase() !== cleanTarget
      );
      
      atts2.forEach(att2 => {
        const u2 = att2.from_user.toLowerCase();
        const u2Rep = reps.get(u2) || { credibility: 1.0 };
        const scoreFactor2 = att2.trust_score / 5.0; // scales trust weight by score
        const strength2 = 0.5 * scoreFactor2 * u2Rep.credibility; // 2 hops = 0.5 decay

        paths.push({
          path: [att2.from_user, att1.from_user, this.getAtomDisplayName(att1.to_entity)],
          score: att1.trust_score,
          influence: parseFloat(strength2.toFixed(3))
        });

        // 3-hop path: [User3 -> User2 -> User1 -> Target]
        const atts3 = attestations.filter(a => 
          a.to_entity === u2 && 
          a.from_user.toLowerCase() !== u2 && 
          a.from_user.toLowerCase() !== u1 && 
          a.from_user.toLowerCase() !== cleanTarget
        );

        atts3.forEach(att3 => {
          const u3 = att3.from_user.toLowerCase();
          const u3Rep = reps.get(u3) || { credibility: 1.0 };
          const scoreFactor3 = att3.trust_score / 5.0;
          const strength3 = 0.25 * scoreFactor3 * scoreFactor2 * u3Rep.credibility; // 3 hops = 0.25 decay

          paths.push({
            path: [att3.from_user, att2.from_user, att1.from_user, this.getAtomDisplayName(att1.to_entity)],
            score: att1.trust_score,
            influence: parseFloat(strength3.toFixed(3))
          });
        });
      });
    });

    return paths;
  }

  // Dynamic analysis layer for risk parameter, voter structure, and propagated trust power
  public getGraphIntelligence(entityName: string): GraphIntelligence {
    const cleanTarget = entityName.trim().toLowerCase();
    const cached = this.intelCache.get(cleanTarget);
    if (cached) {
      return cached;
    }

    const atom = this.findAtom(cleanTarget);
    const displayName = atom ? atom.displayName : entityName;

    // 1. Compute multi-hop paths backward
    const paths = this.findTrustPathsBackwards(cleanTarget);

    // 2. Prevent over-voting: group by starting source and select highest-weight path
    const bestPathBySource = new Map<string, IndirectPath>();
    paths.forEach(p => {
      const source = p.path[0].toLowerCase();
      const existing = bestPathBySource.get(source);
      if (!existing || p.influence > existing.influence) {
        bestPathBySource.set(source, p);
      }
    });

    // 3. Propagated trust consensus
    let totalScoreSum = 0;
    let totalWeightSum = 0;
    bestPathBySource.forEach(p => {
      totalScoreSum += p.score * p.influence;
      totalWeightSum += p.influence;
    });

    const weightedScore = totalWeightSum > 0 
      ? parseFloat((totalScoreSum / totalWeightSum).toFixed(2))
      : 3.0;

    // 4. Calculate Risk Score (0-100)
    let riskScore = 0;
    const riskFactors: string[] = [];
    const directAtts = this.attestations.filter(a => a.to_entity === cleanTarget);

    if (directAtts.length === 0) {
      riskScore = 50;
      riskFactors.push("No direct trust attestations have been registered or verified for this atom.");
    } else {
      const reps = this.getUserReputations();
      
      // voter reputation concentration risk code
      const lowRepCount = directAtts.filter(a => {
        const u = reps.get(a.from_user.toLowerCase());
        return u && u.credibility < 2.0;
      }).length;
      const lowRepRatio = lowRepCount / directAtts.length;
      if (lowRepRatio > 0.4) {
        riskScore += 25;
        riskFactors.push(`High low-reputation user concentration: ${Math.round(lowRepRatio * 100)}% of voters have low credibility.`);
      }

      // sudden spikes
      const recentThreshold = Date.now() - (48 * 60 * 60 * 1000); // 48 hrs
      const recentCount = directAtts.filter(a => new Date(a.timestamp).getTime() > recentThreshold).length;
      const recentRatio = recentCount / directAtts.length;
      if (recentRatio > 0.6 && directAtts.length >= 2) {
        riskScore += 20;
        riskFactors.push("Sudden spike: a high concentration of trust activity was submitted recently.");
      }

      // diversity
      if (directAtts.length === 1) {
        riskScore += 30;
        riskFactors.push("Absolute centralization: only a single unique stakeholder of trust exists.");
      } else if (directAtts.length === 2) {
        riskScore += 15;
        riskFactors.push("Slight centralization: only 2 unique stakeholders have rated this node.");
      }

      // Sybil similarity comments
      const duplicateComments = directAtts.filter(a => 
        a.comment === 'Staked trust without custom comment.' || 
        a.comment === 'Updated trust attestation comment.'
      ).length;
      const dupRatio = duplicateComments / directAtts.length;
      if (dupRatio > 0.5 && directAtts.length >= 2) {
        riskScore += 20;
        riskFactors.push("High density of placeholder comments indicates possible Sybil collusion patterns.");
      }
    }

    riskScore = Math.min(95, Math.max(5, riskScore));
    if (riskFactors.length === 0) {
      riskFactors.push("Consensus signatures are well-distributed with zero anomalous triggers.");
    }

    // 5. Calculate Confidence Score (0-100)
    let confidenceScore = 10;
    if (directAtts.length > 0) {
      const reps = this.getUserReputations();
      // Volume booster
      confidenceScore += Math.min(50, directAtts.length * 10);

      // Average voter credibility booster
      const totalRepSum = directAtts.reduce((sum, a) => {
        const u = reps.get(a.from_user.toLowerCase());
        return sum + (u ? u.credibility : 1.0);
      }, 0);
      const avgRep = totalRepSum / directAtts.length;
      confidenceScore += Math.min(30, Math.round(avgRep * 6));

      // Path redundancy verification booster
      confidenceScore += Math.min(20, bestPathBySource.size * 4);
    }

    confidenceScore = Math.min(100, Math.max(10, confidenceScore));
    let confidenceLevel: 'Low' | 'Medium' | 'High' = 'Low';
    if (confidenceScore > 75) {
      confidenceLevel = 'High';
    } else if (confidenceScore >= 40) {
      confidenceLevel = 'Medium';
    }

    // 6. Top Influencers
    const topInfluencingNodes = Array.from(bestPathBySource.entries())
      .map(([source, p]) => {
        const atomOfSource = this.findAtom(source);
        return {
          id: source,
          name: atomOfSource ? atomOfSource.displayName : `@${p.path[0]}`,
          type: atomOfSource ? atomOfSource.type : 'user',
          strength: p.influence
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
      indirectPaths: paths
    };

    this.intelCache.set(cleanTarget, result);
    return result;
  }

  public getTopEntities() {
    const uniqueTargets = Array.from(new Set(this.attestations.map(a => a.to_entity)));
    const statsList = uniqueTargets.map(name => {
      const atom = this.findAtom(name);
      const metrics = this.getEntityStats(name);
      const intelligence = this.getGraphIntelligence(name);
      return {
        name,
        displayName: atom ? atom.displayName : name,
        type: atom ? atom.type : 'project',
        description: atom ? atom.description : '',
        average: intelligence.weightedScore,
        simpleAverage: metrics.simpleAverage,
        count: metrics.count
      };
    }).sort((a, b) => b.average - a.average || b.count - a.count);

    return statsList;
  }

  public getWalletLinks(): WalletLink[] {
    return this.walletLinks;
  }

  public getActivationCodes(): ActivationCode[] {
    return this.activationCodes;
  }

  public generateActivationCode(walletAddress: string): string {
    const cleanAddress = walletAddress.trim().toLowerCase();
    
    // Clear any existing codes for this wallet to avoid duplicates
    this.activationCodes = this.activationCodes.filter(
      c => c.wallet_address.toLowerCase() !== cleanAddress
    );

    // Generate random 6 character alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous / confusing chars
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    this.activationCodes.push({
      code,
      wallet_address: walletAddress.trim(),
      created_at: new Date().toISOString(),
      expires_at: Date.now() + 15 * 60 * 1000 // 15 mins expiration
    });

    this.save();
    return code;
  }

  public activateTelegram(code: string, telegramUser: string, telegramId?: string): { success: boolean; walletAddress?: string; error?: string } {
    const searchCode = code.trim().toUpperCase();
    const cleanUser = telegramUser.trim().replace(/^@/, '');

    // Cleanup expired codes first
    const now = Date.now();
    this.activationCodes = this.activationCodes.filter(c => c.expires_at > now);

    const matchIdx = this.activationCodes.findIndex(c => c.code === searchCode);
    if (matchIdx === -1) {
      return { success: false, error: 'Invalid or expired activation code. Please generate a new code on the Web Portal.' };
    }

    const matched = this.activationCodes[matchIdx];
    const walletAddress = matched.wallet_address;

    // Remove the used code
    this.activationCodes.splice(matchIdx, 1);

    // Clear any existing links for this Telegram user or this wallet to maintain 1-to-1 mapping
    this.walletLinks = this.walletLinks.filter(
      l => l.telegram_user.toLowerCase() !== cleanUser.toLowerCase() &&
           l.wallet_address.toLowerCase() !== walletAddress.toLowerCase()
    );

    // Save the new link
    this.walletLinks.push({
      telegram_user: cleanUser,
      telegram_id: telegramId ? String(telegramId) : undefined,
      wallet_address: walletAddress,
      linked_at: new Date().toISOString()
    });

    // Also auto-create/update user atom for credibility tracking if needed
    this.createAtom(cleanUser, 'user', `Citizen Intuition Stakeholder linked with wallet ${walletAddress}`, 'system');

    this.save();
    return { success: true, walletAddress };
  }

  public getLinkedWallet(telegramUser: string): string | undefined {
    const cleanUser = telegramUser.trim().replace(/^@/, '').toLowerCase();
    const link = this.walletLinks.find(l => l.telegram_user.toLowerCase() === cleanUser);
    return link ? link.wallet_address : undefined;
  }

  public getTelegramUserForWallet(walletAddress: string): string | undefined {
    const cleanAddr = walletAddress.trim().toLowerCase();
    const link = this.walletLinks.find(l => l.wallet_address.toLowerCase() === cleanAddr);
    return link ? link.telegram_user : undefined;
  }

  public unlinkWallet(walletAddress: string): boolean {
    const cleanAddr = walletAddress.trim().toLowerCase();
    const initialLen = this.walletLinks.length;
    this.walletLinks = this.walletLinks.filter(l => l.wallet_address.toLowerCase() !== cleanAddr);
    if (this.walletLinks.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }
}

export const db = new DatabaseEngine();
