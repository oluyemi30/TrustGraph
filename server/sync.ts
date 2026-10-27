import { IntuitionSDK } from '@intuitionmachine/sdk';
import { DatabaseEngine, db as defaultDb } from './db';

export interface IntuitionSyncStats {
  synced: boolean;
  atomsSynced: number;
  claimsSynced: number;
  endpointUsed: string;
  sourceNetwork: 'Base / Intuition Protocol';
  usedSampleFallback: boolean;
  timestamp: string;
  message: string;
}

/**
 * Optional supplementary external synchronization from Intuition (Base network).
 * Strictly isolated from Robinhood Chain Testnet registry records.
 * Never silently fabricates production records if the external GraphQL endpoint is unreachable.
 */
export async function syncWithIntuitionMainnet(options?: {
  database?: DatabaseEngine;
  allowSampleFallback?: boolean;
}): Promise<IntuitionSyncStats> {
  const database = options?.database || defaultDb;
  const allowSample =
    options?.allowSampleFallback ??
    process.env.ALLOW_INTUITION_SAMPLE_FALLBACK === 'true';

  const sdk = new IntuitionSDK({
    apiKey: process.env.INTUITION_API_KEY || '',
    network: 'base',
  });

  let fetchedData: any = null;
  let fetchErrorMsg = '';

  try {
    const payload = await sdk.getRecentAtomsAndClaims(50, 30);
    if (payload && payload.data) {
      fetchedData = payload.data;
    }
  } catch (err: any) {
    fetchErrorMsg = err?.message || `HTTP status ${err?.status || 'unreachable'}`;
  }

  let atomsSyncedCount = 0;
  let claimsSyncedCount = 0;

  if (fetchedData) {
    const fetchedAtoms = fetchedData.atoms || [];
    const fetchedClaims = fetchedData.claims || [];

    fetchedAtoms.forEach((atom: any) => {
      const label = String(atom.label || atom.value || `Atom #${atom.id}`).trim();
      if (!label) return;
      const type: 'user' | 'project' | 'wallet' =
        atom.type === 'wallet' || /^0x[0-9a-fA-F]{40}$/.test(label) ? 'wallet' : 'project';

      const desc = `Imported from Intuition Protocol (Base). External Atom ID: ${atom.id}`;
      database.createAtom(label, type, desc, atom.creator || 'intuition-protocol', 'intuition');
      atomsSyncedCount++;
    });

    fetchedClaims.forEach((claim: any) => {
      const subjectLabel = String(claim.subject?.label || `Atom-${claim.subject?.id || 'unknown'}`).trim();
      const objectLabel = String(claim.object?.label || `Atom-${claim.object?.id || 'unknown'}`).trim();
      const predicateLabel = String(claim.predicate?.label || 'trusts').trim();

      if (
        predicateLabel.toLowerCase().includes('trust') ||
        predicateLabel.toLowerCase().includes('attest')
      ) {
        database.createAtom(
          subjectLabel,
          'user',
          `Imported Intuition participant ${subjectLabel}`,
          claim.creator || 'intuition-protocol',
          'intuition'
        );
        database.createAtom(
          objectLabel,
          'project',
          `Imported Intuition subject ${objectLabel}`,
          claim.creator || 'intuition-protocol',
          'intuition'
        );

        database.addOffChainOrExternalAttestation({
          fromUser: subjectLabel,
          toEntityName: objectLabel,
          trustScore: 4,
          comment: `External Intuition Protocol triple (${predicateLabel}) on Base.`,
          category: 'external_intuition',
          externalNetwork: 'Intuition (Base)',
        });
        claimsSyncedCount++;
      }
    });

    return {
      synced: true,
      atomsSynced: atomsSyncedCount,
      claimsSynced: claimsSyncedCount,
      endpointUsed: sdk.endpoint,
      sourceNetwork: 'Base / Intuition Protocol',
      usedSampleFallback: false,
      timestamp: new Date().toISOString(),
      message: `Imported ${atomsSyncedCount} atoms and ${claimsSyncedCount} external claims from Intuition Protocol (Base).`,
    };
  }

  if (allowSample && process.env.NODE_ENV !== 'production') {
    const sampleAtoms = [
      {
        label: 'Base Protocol (Sample)',
        type: 'project' as const,
        description: '[SAMPLE DATA] Supplementary Intuition Protocol demo entity on Base.',
      },
      {
        label: '0xintuition (Sample)',
        type: 'project' as const,
        description: '[SAMPLE DATA] Supplementary Intuition semantic graph demo entity.',
      },
    ];

    sampleAtoms.forEach((a) => {
      database.createAtom(a.label, a.type, a.description, 'intuition-sample', 'intuition_sample');
      atomsSyncedCount++;
    });

    database.addOffChainOrExternalAttestation({
      fromUser: '0xintuition (Sample)',
      toEntityName: 'Base Protocol (Sample)',
      trustScore: 4,
      comment: '[SAMPLE DATA] Development sample claim from Intuition fallback buffer (excluded from verified scores).',
      category: 'external_intuition_sample',
      externalNetwork: 'Intuition Sample (Dev Only)',
    });
    claimsSyncedCount = 1;

    return {
      synced: true,
      atomsSynced: atomsSyncedCount,
      claimsSynced: claimsSyncedCount,
      endpointUsed: 'local-dev-sample-buffer',
      sourceNetwork: 'Base / Intuition Protocol',
      usedSampleFallback: true,
      timestamp: new Date().toISOString(),
      message: `Live Intuition GraphQL endpoint unreachable (${fetchErrorMsg}). Loaded clearly labeled development sample records.`,
    };
  }

  return {
    synced: false,
    atomsSynced: 0,
    claimsSynced: 0,
    endpointUsed: sdk.endpoint,
    sourceNetwork: 'Base / Intuition Protocol',
    usedSampleFallback: false,
    timestamp: new Date().toISOString(),
    message: `Intuition GraphQL endpoint (${sdk.endpoint}) is currently unreachable (${fetchErrorMsg || 'unavailable'}). No fabricated records were inserted.`,
  };
}
