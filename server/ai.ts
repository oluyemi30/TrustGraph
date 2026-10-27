import { GoogleGenAI, Type } from '@google/genai';
import { db } from './db';

export interface AIExplanationResult {
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

let aiClient: GoogleGenAI | null = null;

export function getAiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== 'MY_GEMINI_API_KEY' && key.trim().length > 0) {
      try {
        aiClient = new GoogleGenAI({
          apiKey: key.trim(),
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      } catch (err) {
        console.error('[AI-Service] Error initializing Gemini client:', err);
      }
    }
  }
  return aiClient;
}

interface CacheEntry {
  result: AIExplanationResult;
  count: number;
  verifiedCount: number;
  average: number;
}

const explanationCache = new Map<string, CacheEntry>();
let lastRateLimitTimestamp = 0;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;

const AI_DISCLAIMER =
  'Off-chain AI interpretation generated from available evidence. AI summaries are analytical aids, never on-chain proof or financial guarantees.';

export async function explainTrust(entityName: string): Promise<AIExplanationResult> {
  const stats = db.getEntityStats(entityName);
  const atom = db.findAtom(entityName);

  const displayName = atom ? atom.displayName : entityName;
  const trustScore = stats.average;
  const totalClaims = stats.count;
  const verifiedOnChainCount = stats.verifiedOnChainCount;

  const cacheKey = entityName.toLowerCase().trim();
  const cached = explanationCache.get(cacheKey);
  if (
    cached &&
    cached.count === totalClaims &&
    cached.verifiedCount === verifiedOnChainCount &&
    cached.average === trustScore
  ) {
    return cached.result;
  }

  const activeRecords = stats.list.filter(
    (a) => !a.revoked && a.evidence_category !== 'external_intuition_sample'
  );

  const attestationData = activeRecords
    .slice(-15)
    .map(
      (a) =>
        `- [${a.evidence_category}] Score ${a.trust_score}/5 by ${a.wallet_address || `@${a.from_user}`}: "${(a.comment || '').slice(0, 200)}"`
    )
    .join('\n');

  const riskSignalsHeuristic: string[] = [];
  if (totalClaims === 0) {
    riskSignalsHeuristic.push('No active attestations exist for this entity yet.');
  } else {
    if (verifiedOnChainCount === 0) {
      riskSignalsHeuristic.push(
        'All current claims are off-chain; zero verified Robinhood Chain registry attestations exist yet.'
      );
    }
    if (trustScore > 0 && trustScore < 3) {
      riskSignalsHeuristic.push('Composite trust rating is below 3.0/5, signaling negative community feedback.');
    }
    if (totalClaims < 3) {
      riskSignalsHeuristic.push('Small contributor sample size (< 3 attestations) limits statistical confidence.');
    }
    if (stats.revokedCount > 0) {
      riskSignalsHeuristic.push(`${stats.revokedCount} prior attestation(s) were revoked or superseded.`);
    }
    const scoreVariance =
      activeRecords.length > 1
        ? Math.max(...activeRecords.map((a) => a.trust_score)) -
          Math.min(...activeRecords.map((a) => a.trust_score))
        : 0;
    if (scoreVariance >= 3) {
      riskSignalsHeuristic.push('High score dispersion (>= 3 points) indicates polarized contributor assessments.');
    }
  }

  let confidence: 'Low' | 'Medium' | 'High' = 'Low';
  if (verifiedOnChainCount >= 2 && totalClaims >= 4) confidence = 'High';
  else if (totalClaims >= 3 || verifiedOnChainCount >= 1) confidence = 'Medium';

  const summaryHeuristic =
    totalClaims === 0
      ? `${displayName} has no active attestations yet. Submit a verified Robinhood Chain attestation to establish initial provenance.`
      : `Across ${totalClaims} active record${totalClaims === 1 ? '' : 's'} (${verifiedOnChainCount} verified on Robinhood Chain, ${stats.offChainCount} off-chain), ${displayName} holds a provenance-weighted score of ${trustScore}/5.`;

  const defaultResult: AIExplanationResult = {
    entityName: displayName,
    summary: summaryHeuristic,
    riskSignals:
      riskSignalsHeuristic.length > 0
        ? riskSignalsHeuristic
        : ['Evidence includes verified signals with consistent contributor ratings.'],
    confidenceLevel: confidence,
    trustScore,
    totalClaims,
    verifiedOnChainCount,
    sourceType: 'deterministic_heuristic',
    isOnChainEvidence: false,
    disclaimer: AI_DISCLAIMER,
  };

  const ai = getAiClient();
  if (!ai) {
    return defaultResult;
  }

  if (Date.now() - lastRateLimitTimestamp < RATE_LIMIT_COOLDOWN_MS) {
    return defaultResult;
  }

  try {
    const prompt = [
      'Analyze the following TrustGraph reputation dataset objectively and concisely.',
      'Distinguish clearly between verified on-chain Robinhood Chain attestations and unverified off-chain claims.',
      'Never claim on-chain verification if verifiedOnChainCount is 0, and never guarantee financial safety.',
      '',
      `Entity Name: ${displayName}`,
      `Entity Class: ${atom ? atom.type : 'unknown'}`,
      `Provenance-Weighted Score (out of 5): ${trustScore}`,
      `Active Evidence Count: ${totalClaims}`,
      `Verified On-Chain Attestations (Robinhood Chain): ${verifiedOnChainCount}`,
      `Revoked/Superseded Count: ${stats.revokedCount}`,
      '',
      'Active Evidence Records:',
      attestationData || 'None.',
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: 'Objective 2-sentence summary citing verified vs off-chain evidence counts.',
            },
            riskSignals: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '1 to 3 concrete risk or data-quality observations.',
            },
            confidenceLevel: {
              type: Type.STRING,
              description: 'Low, Medium, or High based on verified evidence volume.',
            },
          },
          required: ['summary', 'riskSignals', 'confidenceLevel'],
        },
      },
    });

    const contentText = (response.text || '').trim();
    if (contentText) {
      const parsed = JSON.parse(contentText);
      const validConf: 'Low' | 'Medium' | 'High' =
        parsed.confidenceLevel === 'High' || parsed.confidenceLevel === 'Medium'
          ? parsed.confidenceLevel
          : 'Low';

      const sanitizedRisks = Array.isArray(parsed.riskSignals)
        ? parsed.riskSignals
            .map((s: any) => String(s || '').trim().slice(0, 240))
            .filter(Boolean)
            .slice(0, 4)
        : defaultResult.riskSignals;

      const finalizedResult: AIExplanationResult = {
        entityName: displayName,
        summary: String(parsed.summary || defaultResult.summary).trim().slice(0, 600),
        riskSignals: sanitizedRisks.length > 0 ? sanitizedRisks : defaultResult.riskSignals,
        confidenceLevel: validConf,
        trustScore,
        totalClaims,
        verifiedOnChainCount,
        sourceType: 'ai_interpretation',
        isOnChainEvidence: false,
        disclaimer: AI_DISCLAIMER,
      };

      explanationCache.set(cacheKey, {
        result: finalizedResult,
        count: totalClaims,
        verifiedCount: verifiedOnChainCount,
        average: trustScore,
      });

      return finalizedResult;
    }
  } catch (err: any) {
    const isRateLimit =
      err &&
      (err.status === 429 ||
        String(err).includes('429') ||
        String(err).includes('RESOURCE_EXHAUSTED'));
    if (isRateLimit) {
      lastRateLimitTimestamp = Date.now();
    } else {
      console.warn('[AI-Service] Gemini analysis fallback to deterministic heuristics:', err?.message || err);
    }
  }

  return defaultResult;
}
