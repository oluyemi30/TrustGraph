import React, { useEffect, useMemo, useState } from 'react';
import { BrowserProvider } from 'ethers';
import {
  ArrowLeft,
  ArrowUpRight,
  HelpCircle,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { apiFetch, formatEvidenceLabel } from '../lib/api';
import {
  ROBINHOOD_TESTNET,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getInjectedEthereumProvider,
  parseWalletError,
  shortenAddress,
} from '../lib/robinhoodChain';
import { revokeOnChainAttestation } from '../lib/trustGraphContract';
import {
  AIConsensus,
  Atom,
  Attestation,
  GraphIntelligence,
  RobinhoodNetworkStatus,
  ToastNotice,
} from '../types';

interface EntityProfileViewProps {
  entity: Atom;
  attestations: Attestation[];
  walletAddress: string | null;
  walletChainId: number | null;
  registryAddress: string;
  networkStatus: RobinhoodNetworkStatus | null;
  onBack?: () => void;
  onStartAttestation: (entityName: string) => void;
  onConnectWallet: () => Promise<void>;
  onSwitchNetwork: () => Promise<void>;
  onDataMutated: () => Promise<void>;
  onNotify: (notice: Omit<ToastNotice, 'id'>) => void;
}

export const EntityProfileView: React.FC<EntityProfileViewProps> = ({
  entity,
  attestations,
  walletAddress,
  walletChainId,
  registryAddress,
  networkStatus,
  onBack,
  onStartAttestation,
  onConnectWallet,
  onSwitchNetwork,
  onDataMutated,
  onNotify,
}) => {
  const [intelligence, setIntelligence] = useState<GraphIntelligence | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIConsensus | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [showFormulaDetails, setShowFormulaDetails] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'active' | 'all'>('all');
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const explorerBase = networkStatus?.explorerUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0];

  const entityAttestations = useMemo(() => {
    return attestations
      .filter((a) => a.to_entity.toLowerCase() === entity.name.toLowerCase())
      .filter((a) => (activityFilter === 'active' ? !a.revoked : true))
      .slice()
      .reverse();
  }, [attestations, entity.name, activityFilter]);

  useEffect(() => {
    let active = true;
    async function loadIntelAndAi() {
      setLoadingAi(true);
      try {
        const [intelRes, aiRes] = await Promise.all([
          apiFetch<{ success: boolean; intelligence: GraphIntelligence }>(
            `/api/intelligence/${encodeURIComponent(entity.name)}`
          ),
          apiFetch<{ success: boolean; explanation: AIConsensus }>('/api/ai-explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entityName: entity.name }),
          }),
        ]);
        if (active) {
          setIntelligence(intelRes.intelligence);
          setAiAnalysis(aiRes.explanation);
        }
      } catch {
        // Non-fatal fallback to entity.reputationBreakdown
      } finally {
        if (active) setLoadingAi(false);
      }
    }
    loadIntelAndAi();
    return () => {
      active = false;
    };
  }, [entity.name, attestations.length, entity.revokedCount]);

  const refreshAiExplanation = async () => {
    setLoadingAi(true);
    try {
      const aiRes = await apiFetch<{ success: boolean; explanation: AIConsensus }>(
        '/api/ai-explain',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityName: entity.name }),
        }
      );
      setAiAnalysis(aiRes.explanation);
    } catch (err: any) {
      onNotify({
        tone: 'error',
        title: 'AI Summary Unavailable',
        description: err?.message || 'Could not refresh risk summary.',
      });
    } finally {
      setLoadingAi(false);
    }
  };

  const breakdown = intelligence?.reputationBreakdown || entity.reputationBreakdown;

  const handleRevokeAttestation = async (att: Attestation) => {
    if (!walletAddress) {
      await onConnectWallet();
      return;
    }

    const eth = getInjectedEthereumProvider();
    if (!eth) {
      onNotify({
        tone: 'error',
        title: 'Wallet Not Available',
        description: 'Connect the original attester EVM wallet to revoke this record.',
      });
      return;
    }

    setRevokingId(att.id);
    try {
      if (att.verified_onchain && att.onchain_attestation_id) {
        if (walletChainId !== ROBINHOOD_TESTNET.chainId) {
          await onSwitchNetwork();
          setRevokingId(null);
          return;
        }

        const revResult = await revokeOnChainAttestation({
          ethProvider: eth,
          registryAddress: att.contract_address || registryAddress,
          attestationId: att.onchain_attestation_id,
          explorerBaseUrl: explorerBase,
        });

        await apiFetch('/api/attestations/revoke-onchain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txHash: revResult.txHash,
            attestationId: att.onchain_attestation_id,
          }),
        });

        onNotify({
          tone: 'success',
          title: 'On-Chain Attestation Revoked',
          description: `Attestation #${att.onchain_attestation_id} revoked on Robinhood Chain Testnet.`,
          linkUrl: revResult.explorerUrl,
          linkLabel: 'View Revocation Receipt',
        });
      } else if (att.evidence_category === 'offchain_signed') {
        const provider = new BrowserProvider(eth);
        const signer = await provider.getSigner();
        const signerAddress = await signer.getAddress();

        const nonceRes = await apiFetch<{
          success: boolean;
          nonce: string;
          message: string;
        }>('/api/auth/nonce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: signerAddress,
            purpose: 'revoke_offchain',
          }),
        });

        const signature = await signer.signMessage(nonceRes.message);

        await apiFetch(`/api/attestations/${att.id}/revoke-offchain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: signerAddress,
            nonce: nonceRes.nonce,
            signature,
          }),
        });

        onNotify({
          tone: 'success',
          title: 'Off-Chain Claim Revoked',
          description: 'Signed revocation verified and excluded from active reputation signals.',
        });
      }

      await onDataMutated();
    } catch (err: any) {
      const parsed = parseWalletError(err);
      onNotify({
        tone: parsed.isUserRejected ? 'warning' : 'error',
        title: parsed.isUserRejected ? 'Revocation Cancelled' : 'Revocation Failed',
        description: parsed.message,
      });
    } finally {
      setRevokingId(null);
    }
  };

  const totalDistCount = useMemo(() => {
    if (!breakdown) return 0;
    return (
      (breakdown.scoreDistribution['1'] || 0) +
      (breakdown.scoreDistribution['2'] || 0) +
      (breakdown.scoreDistribution['3'] || 0) +
      (breakdown.scoreDistribution['4'] || 0) +
      (breakdown.scoreDistribution['5'] || 0)
    );
  }, [breakdown]);

  return (
    <div className="space-y-6">
      {/* Clean Entity Header */}
      <div className="bg-white border border-[#DCE3DC] rounded-xl p-6">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#535E54] hover:text-[#0C100C] mb-4 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Entities Directory</span>
          </button>
        )}

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-xs text-[#535E54] flex flex-wrap items-center gap-2">
              <span className="capitalize font-medium text-[#0C100C]">{entity.type}</span>
              <span aria-hidden="true">·</span>
              <span>
                {entity.origin_source === 'intuition'
                  ? 'Intuition Protocol (Base)'
                  : entity.origin_source === 'robinhood_chain'
                  ? 'Robinhood Chain Testnet'
                  : 'TrustGraph'}
              </span>
              {entity.wallet_address && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href={getExplorerAddressUrl(entity.wallet_address, explorerBase)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[#0C100C] underline hover:text-[#166B00] inline-flex items-center gap-0.5"
                  >
                    {shortenAddress(entity.wallet_address, 8, 6)}
                    <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                  </a>
                </>
              )}
            </div>

            <h1 className="text-2xl font-bold text-[#0C100C] tracking-tight">
              {entity.displayName}
            </h1>

            {entity.description && (
              <p className="text-sm text-[#535E54] max-w-2xl">{entity.description}</p>
            )}
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onStartAttestation(entity.displayName)}
              className="px-4 py-2.5 text-sm font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap cursor-pointer"
            >
              Submit Attestation
            </button>
          </div>
        </div>
      </div>

      {/* Streamlined Multi-Source Reputation Breakdown */}
      {breakdown && (
        <div className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-[#DCE3DC] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#0C100C]">
                Reputation Breakdown by Source
              </h2>
              <p className="text-xs text-[#535E54] mt-0.5">
                Every proof tier is tallied separately so unverified notes never dilute on-chain
                evidence.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFormulaDetails(!showFormulaDetails)}
              aria-expanded={showFormulaDetails}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0C100C] hover:text-[#166B00] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-[#535E54]" aria-hidden="true" />
              <span>{showFormulaDetails ? 'Hide Methodology' : 'How Scores Work'}</span>
            </button>
          </div>

          {showFormulaDetails && (
            <div className="px-6 py-4 bg-[#F6F8F5] border-b border-[#DCE3DC] text-xs text-[#535E54] space-y-1.5">
              <p className="text-[#0C100C] font-medium">
                Verified Robinhood Chain attestations carry full weight (1.0x), gasless wallet
                signatures carry 0.7x, external Intuition records carry 0.5x, and unverified
                community notes carry 0.25x with gentle recency weighting.
              </p>
              <p>
                Revoked attestations are immediately excluded from active averages. Scores reflect
                community signals and do not guarantee protocol safety.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#DCE3DC]">
            <div className="lg:col-span-8 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DCE3DC] text-[11px] font-semibold text-[#535E54]">
                    <th className="py-3 px-5">Evidence Source</th>
                    <th className="py-3 px-4 text-right">Active Claims</th>
                    <th className="py-3 px-5 text-right">Average Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE3DC] text-sm">
                  <tr>
                    <td className="py-3.5 px-5">
                      <div className="font-medium text-[#0C100C]">
                        Verified On-Chain · Robinhood Chain (46630)
                      </div>
                      <div className="text-xs text-[#535E54]">
                        Confirmed smart contract receipt &amp; event log
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#166B00]">
                      {breakdown.categories.onchainVerified.activeCount}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono tabular-nums font-semibold text-[#0C100C]">
                      {breakdown.categories.onchainVerified.activeCount > 0
                        ? `${breakdown.categories.onchainVerified.simpleAverage.toFixed(2)}/5`
                        : '—'}
                    </td>
                  </tr>

                  <tr>
                    <td className="py-3.5 px-5">
                      <div className="font-medium text-[#0C100C]">Off-Chain · Wallet-Signed</div>
                      <div className="text-xs text-[#535E54]">
                        Gasless EIP-191 cryptographic signature
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#0C100C]">
                      {breakdown.categories.offchainSigned.activeCount}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono tabular-nums text-[#0C100C]">
                      {breakdown.categories.offchainSigned.activeCount > 0
                        ? `${breakdown.categories.offchainSigned.simpleAverage.toFixed(2)}/5`
                        : '—'}
                    </td>
                  </tr>

                  <tr>
                    <td className="py-3.5 px-5">
                      <div className="font-medium text-[#0C100C]">Off-Chain · Community Notes</div>
                      <div className="text-xs text-[#535E54]">
                        Open web or Telegram submissions without wallet proof
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#0C100C]">
                      {breakdown.categories.communityUnverified.activeCount}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono tabular-nums text-[#0C100C]">
                      {breakdown.categories.communityUnverified.activeCount > 0
                        ? `${breakdown.categories.communityUnverified.simpleAverage.toFixed(2)}/5`
                        : '—'}
                    </td>
                  </tr>

                  <tr>
                    <td className="py-3.5 px-5">
                      <div className="font-medium text-[#0C100C]">
                        External · Intuition Protocol (Base)
                      </div>
                      <div className="text-xs text-[#535E54]">
                        Supplementary external claims kept separate from Robinhood Chain
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#0C100C]">
                      {breakdown.categories.externalIntuition.activeCount}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono tabular-nums text-[#0C100C]">
                      {breakdown.categories.externalIntuition.activeCount > 0
                        ? `${breakdown.categories.externalIntuition.simpleAverage.toFixed(2)}/5`
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Score Distribution + Composite Summary */}
            <div className="lg:col-span-4 p-5 sm:p-6 flex flex-col justify-between space-y-5">
              <div>
                <div className="text-xs text-[#535E54]">Provenance-Weighted Signal</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-[#0C100C]">
                    {breakdown.compositeSignal.activeEvidenceCount > 0
                      ? breakdown.compositeSignal.score.toFixed(2)
                      : '—'}
                  </span>
                  <span className="text-sm text-[#535E54] font-mono tabular-nums">/ 5.00</span>
                </div>
                <div className="text-xs text-[#535E54] mt-1 tabular-nums">
                  {breakdown.compositeSignal.activeEvidenceCount} active ·{' '}
                  {breakdown.compositeSignal.revokedCount} revoked
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-[#0C100C]">Score Distribution</div>
                {(['5', '4', '3', '2', '1'] as const).map((tier) => {
                  const count = breakdown.scoreDistribution[tier] || 0;
                  const pct = totalDistCount > 0 ? Math.round((count / totalDistCount) * 100) : 0;
                  return (
                    <div key={tier} className="flex items-center gap-2.5 text-xs">
                      <span className="w-8 font-mono tabular-nums text-[#535E54]">{tier}/5</span>
                      <div className="flex-1 h-2 bg-[#EEF2EC] rounded-xs overflow-hidden">
                        <div
                          className="h-full bg-[#0C100C] transition-transform duration-150 origin-left"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono tabular-nums text-[#0C100C]">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Off-Chain AI Risk Summary */}
      <div className="bg-white border border-[#DCE3DC] rounded-xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#DCE3DC]">
          <div>
            <div className="text-xs text-[#535E54]">
              Off-Chain Analytical Summary · Never Counted as Blockchain Proof
            </div>
            <h2 className="text-base font-semibold text-[#0C100C] mt-0.5">
              AI Risk &amp; Signal Summary
            </h2>
          </div>

          <button
            type="button"
            onClick={refreshAiExplanation}
            disabled={loadingAi}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] hover:bg-[#EEF2EC] disabled:opacity-50 transition-colors shrink-0 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loadingAi ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
        </div>

        {loadingAi && !aiAnalysis ? (
          <div className="py-6 space-y-2 animate-pulse">
            <div className="h-4 bg-[#EEF2EC] rounded w-3/4" />
            <div className="h-4 bg-[#EEF2EC] rounded w-1/2" />
          </div>
        ) : aiAnalysis ? (
          <div className="pt-4 space-y-3 text-sm">
            <p className="text-[#0C100C] leading-relaxed">{aiAnalysis.summary}</p>

            {aiAnalysis.riskSignals.length > 0 && (
              <ul className="space-y-1.5 text-xs text-[#535E54] list-disc pl-5">
                {aiAnalysis.riskSignals.map((sig, i) => (
                  <li key={i}>{sig}</li>
                ))}
              </ul>
            )}

            <div className="pt-1 text-xs text-[#535E54]">
              Confidence: <strong className="font-medium text-[#0C100C]">{aiAnalysis.confidenceLevel}</strong> ·{' '}
              {aiAnalysis.disclaimer}
            </div>
          </div>
        ) : (
          <p className="pt-4 text-xs text-[#535E54]">
            Click Refresh to evaluate current community and on-chain signals.
          </p>
        )}
      </div>

      {/* Evidence History */}
      <div className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-[#DCE3DC] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#0C100C]">
              Evidence History ({entityAttestations.length})
            </h2>
            <p className="text-xs text-[#535E54] mt-0.5">
              Audit individual attesters, revocation status, and Robinhood Chain Explorer receipts.
            </p>
          </div>

          <div
            role="group"
            aria-label="Filter entity activity"
            className="inline-flex items-center p-1 bg-[#EEF2EC] rounded-lg self-start sm:self-auto"
          >
            <button
              type="button"
              onClick={() => setActivityFilter('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activityFilter === 'all'
                  ? 'bg-white text-[#0C100C] shadow-xs'
                  : 'text-[#535E54] hover:text-[#0C100C]'
              }`}
            >
              All Records
            </button>
            <button
              type="button"
              onClick={() => setActivityFilter('active')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activityFilter === 'active'
                  ? 'bg-white text-[#0C100C] shadow-xs'
                  : 'text-[#535E54] hover:text-[#0C100C]'
              }`}
            >
              Active Only
            </button>
          </div>
        </div>

        {entityAttestations.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-[#0C100C]">No attestations recorded yet</p>
            <p className="text-xs text-[#535E54] mt-1">
              Submit the first attestation for {entity.displayName}.
            </p>
            <button
              type="button"
              onClick={() => onStartAttestation(entity.displayName)}
              className="mt-4 px-4 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors cursor-pointer"
            >
              Create First Attestation
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[#DCE3DC]">
            {entityAttestations.map((att) => {
              const canRevoke =
                !att.revoked &&
                Boolean(walletAddress) &&
                Boolean(att.wallet_address) &&
                walletAddress!.toLowerCase() === att.wallet_address!.toLowerCase() &&
                (att.verified_onchain || att.evidence_category === 'offchain_signed');

              const isRobinhoodChainTx =
                att.verified_onchain &&
                att.tx_hash &&
                (att.chain_id === ROBINHOOD_TESTNET.chainId || !att.chain_id);

              return (
                <li
                  key={att.id}
                  className={`p-5 transition-colors ${
                    att.revoked ? 'bg-[#F6F8F5]/80 opacity-75' : 'hover:bg-[#F6F8F5]/50'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#535E54]">
                        <span
                          className={`font-semibold font-mono tabular-nums text-sm ${
                            att.revoked ? 'line-through text-[#C93535]' : 'text-[#0C100C]'
                          }`}
                        >
                          {att.trust_score}/5
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            att.revoked
                              ? 'text-[#C93535] font-semibold'
                              : att.evidence_category === 'onchain_verified'
                              ? 'text-[#166B00] font-medium'
                              : 'text-[#535E54]'
                          }
                        >
                          {att.revoked
                            ? `Revoked · ${formatEvidenceLabel(att.evidence_category)}`
                            : formatEvidenceLabel(att.evidence_category)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <code className="font-mono text-[#0C100C]">
                          {att.wallet_address
                            ? shortenAddress(att.wallet_address)
                            : `@${att.from_user}`}
                        </code>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {new Date(att.timestamp).toLocaleDateString()}
                        </span>
                      </div>

                      {att.comment && (
                        <p className="text-sm text-[#0C100C] pt-0.5">{att.comment}</p>
                      )}

                      {(att.block_number || isRobinhoodChainTx) && (
                        <div className="pt-1 flex flex-wrap items-center gap-2 text-xs text-[#535E54] font-mono tabular-nums">
                          {att.block_number && <span>Block #{att.block_number}</span>}
                          {isRobinhoodChainTx && att.tx_hash && (
                            <>
                              {att.block_number && <span aria-hidden="true">·</span>}
                              <a
                                href={getExplorerTxUrl(att.tx_hash, explorerBase)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[#0C100C] font-sans underline hover:text-[#166B00]"
                              >
                                Explorer Receipt
                                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                              </a>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {canRevoke && (
                      <button
                        type="button"
                        disabled={revokingId === att.id}
                        onClick={() => handleRevokeAttestation(att)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#E6B8B8] text-[#9E2424] bg-[#FFF8F8] hover:bg-[#FFEDED] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{revokingId === att.id ? 'Revoking...' : 'Revoke'}</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
