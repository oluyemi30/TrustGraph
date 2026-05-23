import { GoogleGenAI } from "@google/genai";
import { db } from "./db";

export interface AIExplanationResult {
  entityName: string;
  summary: string;
  riskSignals: string[];
  confidenceLevel: 'Low' | 'Medium' | 'High';
  trustScore: number;
  totalClaims: number;
}

let aiClient: GoogleGenAI | null = null;

export function getAiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== 'MY_GEMINI_API_KEY') {
      try {
        aiClient = new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });
        console.log('[AI-Service] Gemini Client successfully initialized with key.');
      } catch (err) {
        console.error('[AI-Service] Error initializing Gemini client:', err);
      }
    } else {
      console.log('[AI-Service] GEMINI_API_KEY not set. Using local heuristic fallback generator.');
    }
  }
  return aiClient;
}

interface CacheEntry {
  result: AIExplanationResult;
  count: number;
  average: number;
}

const explanationCache = new Map<string, CacheEntry>();
let lastRateLimitTimestamp = 0;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown after 429

export async function explainTrust(entityName: string): Promise<AIExplanationResult> {
  const stats = db.getEntityStats(entityName);
  const atom = db.findAtom(entityName);
  
  const displayName = atom ? atom.displayName : entityName;
  const trustScore = stats.average;
  const totalClaims = stats.count;

  // Serve from cache if the entity's attestation count & average score are identical to cached values
  const cacheKey = entityName.toLowerCase().trim();
  const cached = explanationCache.get(cacheKey);
  if (cached && cached.count === totalClaims && cached.average === trustScore) {
    return cached.result;
  }

  // Compile prompt context
  const attestationData = stats.list.map(a => `- Rating: ${a.trust_score}/5 by @${a.from_user}: "${a.comment}"`).join('\n');

  const riskSignalsHeuristic: string[] = [];
  if (trustScore < 3) {
    riskSignalsHeuristic.push('Low overall feedback score implies active trust concerns in the community.');
  }
  if (totalClaims < 3) {
    riskSignalsHeuristic.push('Very low participation level limits statistical reputation consensus.');
  }
  const scoreVariance = stats.list.length > 1 ? 
    Math.max(...stats.list.map(a => a.trust_score)) - Math.min(...stats.list.map(a => a.trust_score)) : 0;
  if (scoreVariance >= 3) {
    riskSignalsHeuristic.push('Polarized ratings indicate divided stakeholder trust circles.');
  }

  // Determine heuristic confidence level
  let confidence: 'Low' | 'Medium' | 'High' = 'Low';
  if (totalClaims >= 5) confidence = 'High';
  else if (totalClaims >= 3) confidence = 'Medium';

  const summaryHeuristic = `Based on ${totalClaims} community attestation${totalClaims === 1 ? '' : 's'}, ${displayName} maintains an average trust rating of ${trustScore}/5. ${
    trustScore >= 4 ? 'The consensus is highly favorable, highlighting active reliability and positive stakeholder relationships.' :
    trustScore >= 3 ? 'The entity displays stable reputation signals with moderate trust scores but is subject to occasional critical reviews.' :
    'Reputation signals reflect severe trust concerns or negative feedback that requires caution.'
  }`;

  const defaultResult: AIExplanationResult = {
    entityName: displayName,
    summary: summaryHeuristic,
    riskSignals: riskSignalsHeuristic.length > 0 ? riskSignalsHeuristic : ['No critical risk signals flagged by the community.'],
    confidenceLevel: confidence,
    trustScore,
    totalClaims
  };

  const ai = getAiClient();
  if (!ai) {
    return defaultResult;
  }

  // If rate limit was hit recently, bypass calling the live API to conserve quota
  const now = Date.now();
  if (now - lastRateLimitTimestamp < RATE_LIMIT_COOLDOWN_MS) {
    return defaultResult;
  }

  try {
    const prompt = `
You are the TrustGraph AI Analyst (inspired by Intuition reputation standards).
Analyze this trust data and explain whether this entity is trustworthy. Be extremely concise, objective, and factual.

Entity Name: ${displayName}
Type: ${atom ? atom.type : 'Unknown'}
Average Trust Score (out of 5): ${trustScore}
Total Community Attestations: ${totalClaims}

Raw Attestations Table:
${attestationData || 'No attestation feedback exists yet. It is a newly registered Atom identity.'}

Please return the analysis strictly formatted as a JSON object matching this TypeScript structure:
{
  "summary": "Concise paragraph summarizing the trust consensus and feedback theme",
  "riskSignals": ["bullet 1 about issues or warnings", "bullet 2"],
  "confidenceLevel": "Low" | "Medium" | "High"
}

Provide ONLY the valid JSON block without markdown formatting or other explanations.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const contentText = response.text || '';
    if (contentText.trim()) {
      const result = JSON.parse(contentText.trim());
      const finalizedResult: AIExplanationResult = {
        entityName: displayName,
        summary: result.summary || defaultResult.summary,
        riskSignals: result.riskSignals && result.riskSignals.length > 0 ? result.riskSignals : defaultResult.riskSignals,
        confidenceLevel: result.confidenceLevel || defaultResult.confidenceLevel,
        trustScore,
        totalClaims
      };

      explanationCache.set(cacheKey, {
        result: finalizedResult,
        count: totalClaims,
        average: trustScore
      });

      return finalizedResult;
    }
  } catch (err: any) {
    const isRateLimit = err && (err.status === 429 || String(err).includes('429') || String(err).includes('RESOURCE_EXHAUSTED'));
    if (isRateLimit) {
      lastRateLimitTimestamp = Date.now();
      console.warn('[AI-Service] Gemini API quota limit reached (429/RESOURCE_EXHAUSTED). Backing off live API queries for 60s and utilizing local heuristics.');
    } else {
      console.warn('[AI-Service] Gemini generation or parsing failed, falling back to heuristics:', err?.message || err);
    }
  }

  return defaultResult;
}
