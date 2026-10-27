import React, { useEffect, useState } from 'react';
import { BrowserProvider } from 'ethers';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  ROBINHOOD_TESTNET,
  getExplorerTxUrl,
  getInjectedEthereumProvider,
  parseWalletError,
  shortenAddress,
} from '../lib/robinhoodChain';
import {
  GasFeeEstimate,
  SubmittedAttestationResult,
  TransactionLifecycleState,
  estimateAttestationNetworkFee,
  submitOnChainAttestation,
} from '../lib/trustGraphContract';
import { Atom, RobinhoodNetworkStatus, ToastNotice } from '../types';

export type SubmissionMode = 'onchain_robinhood' | 'offchain_signed' | 'offchain_community';

interface AttestationPanelProps {
  atoms: Atom[];
  initialEntity?: string;
  walletAddress: string | null;
  walletChainId: number | null;
  networkStatus: RobinhoodNetworkStatus | null;
  registryAddress: string;
  onConnectWallet: () => Promise<void>;
  onSwitchNetwork: () => Promise<void>;
  onAttestationRecorded: (entityName: string) => Promise<void>;
  onNotify: (notice: Omit<ToastNotice, 'id'>) => void;
}

const SCORE_LABELS: Record<number, string> = {
  1: 'Critical Risk',
  2: 'Caution',
  3: 'Neutral',
  4: 'Reliable',
  5: 'High Trust',
};

export const AttestationPanel: React.FC<AttestationPanelProps> = ({
  atoms,
  initialEntity = '',
  walletAddress,
  walletChainId,
  networkStatus,
  registryAddress,
  onConnectWallet,
  onSwitchNetwork,
  onAttestationRecorded,
  onNotify,
}) => {
  const [mode, setMode] = useState<SubmissionMode>('onchain_robinhood');
  const [entityName, setEntityName] = useState(initialEntity);
  const [score, setScore] = useState<number>(5);
  const [comment, setComment] = useState('');
  const [communityAuthor, setCommunityAuthor] = useState('');

  const [txLifecycle, setTxLifecycle] = useState<TransactionLifecycleState>('wallet_disconnected');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [pendingTxHash, setPendingTxHash] = useState<string>('');
  const [confirmedReceipt, setConfirmedReceipt] = useState<SubmittedAttestationResult | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<GasFeeEstimate | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quiet existing-tx verification disclosure
  const [existingTxHash, setExistingTxHash] = useState('');
  const [verifyingExisting, setVerifyingExisting] = useState(false);

  useEffect(() => {
    if (initialEntity) {
      setEntityName(initialEntity);
    }
  }, [initialEntity]);

  const isCorrectChain = walletChainId === ROBINHOOD_TESTNET.chainId;
  const isContractConfigured = Boolean(
    registryAddress && (networkStatus?.contractDeployed ?? true)
  );

  useEffect(() => {
    if (isSubmitting) return;
    if (confirmedReceipt && txLifecycle === 'confirmed') return;

    if (!walletAddress) {
      setTxLifecycle('wallet_disconnected');
      setStatusMessage('Connect your wallet to submit on Robinhood Chain Testnet.');
    } else if (!isCorrectChain) {
      setTxLifecycle('wrong_network');
      setStatusMessage('Switch your wallet to Robinhood Chain Testnet (Chain ID 46630).');
    } else if (!registryAddress || networkStatus?.contractDeployed === false) {
      setTxLifecycle('contract_not_deployed');
      setStatusMessage('On-chain registry contract is awaiting testnet configuration.');
    } else {
      setTxLifecycle('ready');
      setStatusMessage('Connected to Robinhood Chain Testnet (46630).');
    }
  }, [
    walletAddress,
    walletChainId,
    isCorrectChain,
    registryAddress,
    networkStatus?.contractDeployed,
    isSubmitting,
    confirmedReceipt,
    txLifecycle,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function runEstimate() {
      if (
        mode !== 'onchain_robinhood' ||
        !walletAddress ||
        !isCorrectChain ||
        !isContractConfigured ||
        !entityName.trim()
      ) {
        setFeeEstimate(null);
        return;
      }
      const eth = getInjectedEthereumProvider();
      if (!eth) {
        setFeeEstimate(null);
        return;
      }
      const est = await estimateAttestationNetworkFee({
        ethProvider: eth,
        registryAddress,
        entityName: entityName.trim(),
        score,
        comment,
      });
      if (!cancelled) {
        setFeeEstimate(est);
      }
    }
    const timer = setTimeout(runEstimate, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    mode,
    walletAddress,
    isCorrectChain,
    isContractConfigured,
    registryAddress,
    entityName,
    score,
    comment,
  ]);

  const resetTransactionalFeedback = () => {
    setConfirmedReceipt(null);
    setPendingTxHash('');
  };

  const handleOnChainSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEntity = entityName.trim();
    if (!targetEntity) {
      onNotify({
        tone: 'error',
        title: 'Subject required',
        description: 'Enter or select an entity before submitting.',
      });
      return;
    }

    const eth = getInjectedEthereumProvider();
    if (!eth || !walletAddress) {
      await onConnectWallet();
      return;
    }

    if (!isCorrectChain) {
      await onSwitchNetwork();
      return;
    }

    if (!registryAddress || networkStatus?.contractDeployed === false) {
      setTxLifecycle('contract_not_deployed');
      return;
    }

    setIsSubmitting(true);
    setConfirmedReceipt(null);
    setPendingTxHash('');

    try {
      const submitted = await submitOnChainAttestation({
        ethProvider: eth,
        registryAddress,
        entityName: targetEntity,
        score,
        comment,
        explorerBaseUrl: networkStatus?.explorerUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0],
        onStateChange: (state, detail) => {
          setTxLifecycle(state);
          if (state === 'pending' && detail) {
            setPendingTxHash(detail);
            setStatusMessage('Broadcast to Robinhood Chain Testnet. Waiting for confirmation...');
          } else if (detail) {
            setStatusMessage(detail);
          }
        },
      });

      await apiFetch('/api/attestations/verify-onchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: submitted.txHash,
          entityName: targetEntity,
          comment: comment.trim(),
          fromUser: shortenAddress(submitted.attester),
        }),
      });

      setConfirmedReceipt(submitted);
      setTxLifecycle('confirmed');
      setStatusMessage(
        `Confirmed in block #${submitted.blockNumber} (Attestation #${submitted.attestationId}).`
      );
      setComment('');

      onNotify({
        tone: 'success',
        title: 'On-Chain Attestation Confirmed',
        description: `Attestation #${submitted.attestationId} verified on Robinhood Chain Testnet.`,
        linkUrl: submitted.explorerUrl,
        linkLabel: 'View on Explorer',
      });

      await onAttestationRecorded(targetEntity);
    } catch (err: any) {
      onNotify({
        tone: 'error',
        title: 'Attestation Not Completed',
        description: err?.message || 'Transaction failed.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOffChainSignedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEntity = entityName.trim();
    if (!targetEntity) {
      onNotify({
        tone: 'error',
        title: 'Subject required',
        description: 'Enter an entity name before signing.',
      });
      return;
    }

    const eth = getInjectedEthereumProvider();
    if (!eth || !walletAddress) {
      await onConnectWallet();
      return;
    }

    setIsSubmitting(true);
    try {
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const authorLabel = shortenAddress(signerAddress);
      const issuedAt = new Date().toISOString();

      const canonicalMessage = [
        'TrustGraph Off-Chain Community Attestation',
        `Signer: ${signerAddress}`,
        `Author: @${authorLabel}`,
        `Subject: ${targetEntity.toLowerCase()}`,
        `Trust Score: ${Math.trunc(score)}/5`,
        `Comment: ${comment.trim()}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');

      const signature = await signer.signMessage(canonicalMessage);

      await apiFetch('/api/attestations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user: authorLabel,
          to_entity: targetEntity,
          trust_score: score,
          comment: comment.trim() || 'Wallet-signed off-chain trust attestation.',
          wallet_address: signerAddress,
          signed_message: canonicalMessage,
          signature,
        }),
      });

      setComment('');
      onNotify({
        tone: 'success',
        title: 'Wallet-Signed Claim Recorded',
        description: `Gasless wallet signature verified for ${targetEntity}.`,
      });
      await onAttestationRecorded(targetEntity);
    } catch (err: any) {
      const parsed = parseWalletError(err);
      onNotify({
        tone: parsed.isUserRejected ? 'warning' : 'error',
        title: parsed.isUserRejected ? 'Signature Cancelled' : 'Signature Failed',
        description: parsed.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCommunitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEntity = entityName.trim();
    const cleanAuthor = communityAuthor.trim().replace(/^@/, '') || 'community_member';
    if (!targetEntity) {
      onNotify({
        tone: 'error',
        title: 'Subject required',
        description: 'Enter an entity name to submit a community note.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await apiFetch('/api/attestations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user: cleanAuthor,
          to_entity: targetEntity,
          trust_score: score,
          comment: comment.trim() || 'Community trust assessment.',
        }),
      });

      setComment('');
      onNotify({
        tone: 'info',
        title: 'Community Note Saved',
        description: `Recorded under unverified community claims for ${targetEntity}.`,
      });
      await onAttestationRecorded(targetEntity);
    } catch (err: any) {
      onNotify({
        tone: 'error',
        title: 'Submission Failed',
        description: err?.message || 'Unable to save community note.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyExistingTx = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHash = existingTxHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(cleanHash)) {
      onNotify({
        tone: 'error',
        title: 'Invalid Transaction Hash',
        description: 'Enter a full 66-character 0x transaction hash from Robinhood Chain Testnet.',
      });
      return;
    }

    setVerifyingExisting(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        attestation: { to_entity: string; onchain_attestation_id?: string };
      }>('/api/attestations/verify-onchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: cleanHash }),
      });

      setExistingTxHash('');
      onNotify({
        tone: 'success',
        title: 'Transaction Receipt Verified',
        description: `Indexed attestation #${res.attestation.onchain_attestation_id || ''} for ${
          res.attestation.to_entity
        }.`,
        linkUrl: getExplorerTxUrl(
          cleanHash,
          networkStatus?.explorerUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0]
        ),
        linkLabel: 'View Receipt',
      });
      await onAttestationRecorded(res.attestation.to_entity);
    } catch (err: any) {
      onNotify({
        tone: 'error',
        title: 'Verification Rejected',
        description:
          err?.message ||
          'Transaction did not emit a valid TrustGraphRegistry event on Robinhood Chain Testnet.',
      });
    } finally {
      setVerifyingExisting(false);
    }
  };

  const renderLifecycleBanner = () => {
    const explorerBase = networkStatus?.explorerUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0];

    switch (txLifecycle) {
      case 'wallet_disconnected':
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#F6F8F5] border border-[#DCE3DC] flex items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2.5 text-[#535E54]">
              <Wallet className="w-4 h-4 text-[#0C100C] shrink-0" aria-hidden="true" />
              <span>Connect an EVM wallet to settle ratings on Robinhood Chain Testnet.</span>
            </div>
            <button
              type="button"
              onClick={onConnectWallet}
              className="px-3 py-1.5 font-semibold bg-[#0C100C] text-[#CCFF00] rounded-lg hover:bg-[#1A221B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Connect Wallet
            </button>
          </div>
        );

      case 'wrong_network':
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#FFFBEB] border border-[#F0D999] flex items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2.5 text-[#7A4F04]">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Switch your wallet to Robinhood Chain Testnet (Chain ID 46630).</span>
            </div>
            <button
              type="button"
              onClick={onSwitchNetwork}
              className="px-3 py-1.5 font-semibold bg-[#0C100C] text-white rounded-lg hover:bg-[#1A221B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Switch Network
            </button>
          </div>
        );

      case 'contract_not_deployed':
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#FFFBEB] border border-[#F0D999] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#7A4F04]"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                On-chain settlement awaits registry contract deployment on this environment. You can
                record a verifiable gasless wallet signature right now.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMode('offchain_signed')}
              className="px-3 py-1.5 font-semibold bg-[#0C100C] text-white rounded-lg hover:bg-[#1A221B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Use Wallet-Signed
            </button>
          </div>
        );

      case 'awaiting_approval':
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#FFFBEB] border border-[#F0D999] flex items-center gap-2.5 text-xs text-[#7A4F04]"
          >
            <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Approve the attestation transaction in your wallet extension.</span>
          </div>
        );

      case 'pending':
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#FFFBEB] border border-[#F0D999] flex items-center justify-between gap-3 text-xs text-[#7A4F04]"
          >
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="font-mono">
                {pendingTxHash
                  ? `Confirming ${shortenAddress(pendingTxHash, 10, 8)}...`
                  : 'Waiting for block confirmation...'}
              </span>
            </div>
            {pendingTxHash && (
              <a
                href={getExplorerTxUrl(pendingTxHash, explorerBase)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[#0C100C] underline shrink-0"
              >
                Explorer
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        );

      case 'confirmed':
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#ECFCE8] border border-[#A5E199] flex items-start justify-between gap-3 text-xs"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#166B00] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="font-semibold text-[#0D3B04]">On-Chain Attestation Confirmed</div>
                <p className="text-[#19540D] mt-0.5">{statusMessage}</p>
              </div>
            </div>
            {confirmedReceipt && (
              <a
                href={confirmedReceipt.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#0D3B04] underline whitespace-nowrap shrink-0"
              >
                Explorer
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        );

      case 'rejected':
      case 'failed':
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#FFF5F5] border border-[#F2B8B8] flex items-start justify-between gap-3 text-xs"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-[#C93535] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="font-semibold text-[#8A1C1C]">
                  {txLifecycle === 'rejected' ? 'Request Cancelled' : 'Transaction Failed'}
                </div>
                <p className="text-[#8A1C1C]/90 mt-0.5">{statusMessage}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                resetTransactionalFeedback();
                setTxLifecycle('ready');
              }}
              className="text-xs font-medium text-[#0C100C] underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        );

      case 'ready':
      default:
        return (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-lg bg-[#F6F8F5] border border-[#DCE3DC] flex items-center justify-between gap-3 text-xs text-[#535E54]"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#166B00] shrink-0" aria-hidden="true" />
              <span>
                Ready on Robinhood Chain Testnet ·{' '}
                <code className="font-mono text-[#0C100C]">{shortenAddress(walletAddress)}</code>
              </span>
            </div>
            {feeEstimate && (
              <span className="font-mono tabular-nums text-[#0C100C] font-medium whitespace-nowrap">
                Est. ~{Number(feeEstimate.estimatedFeeEth).toFixed(6)} ETH
              </span>
            )}
          </div>
        );
    }
  };

  return (
    <section
      aria-labelledby="attestation-panel-heading"
      className="bg-white border border-[#DCE3DC] rounded-xl p-5 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#DCE3DC]">
        <div>
          <h2 id="attestation-panel-heading" className="text-base font-semibold text-[#0C100C]">
            Submit Trust Attestation
          </h2>
          <p className="text-xs text-[#535E54] mt-0.5">
            Choose your proof level—every rating stays separated by provenance.
          </p>
        </div>

        {/* Clean 3-Mode Segmented Control */}
        <div
          role="group"
          aria-label="Select attestation proof mode"
          className="inline-flex items-center p-1 bg-[#EEF2EC] rounded-lg gap-0.5 self-start sm:self-auto"
        >
          {(
            [
              { id: 'onchain_robinhood', label: 'On-Chain' },
              { id: 'offchain_signed', label: 'Wallet-Signed' },
              { id: 'offchain_community', label: 'Community' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === item.id
                  ? 'bg-white text-[#0C100C] shadow-xs'
                  : 'text-[#535E54] hover:text-[#0C100C]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={
          mode === 'onchain_robinhood'
            ? handleOnChainSubmit
            : mode === 'offchain_signed'
            ? handleOffChainSignedSubmit
            : handleCommunitySubmit
        }
        className="pt-5 space-y-4"
      >
        {mode === 'onchain_robinhood' && renderLifecycleBanner()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={mode === 'offchain_community' ? '' : 'sm:col-span-2'}>
            <label
              htmlFor="attest-entity-input"
              className="block text-xs font-medium text-[#0C100C] mb-1.5"
            >
              Subject Entity
            </label>
            <input
              id="attest-entity-input"
              list="trustgraph-entities-datalist"
              type="text"
              required
              maxLength={80}
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              placeholder="Select or enter a protocol, wallet, or contributor"
              className="w-full px-3.5 py-2 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
            />
            <datalist id="trustgraph-entities-datalist">
              {atoms.map((a) => (
                <option key={a.id} value={a.displayName} />
              ))}
            </datalist>
          </div>

          {mode === 'offchain_community' && (
            <div>
              <label
                htmlFor="attest-author-input"
                className="block text-xs font-medium text-[#0C100C] mb-1.5"
              >
                Display Handle
              </label>
              <input
                id="attest-author-input"
                type="text"
                maxLength={60}
                value={communityAuthor}
                onChange={(e) => setCommunityAuthor(e.target.value)}
                placeholder="e.g., @researcher"
                className="w-full px-3.5 py-2 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
              />
            </div>
          )}
        </div>

        {/* Trust Score Selector 1..5 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-[#0C100C]">Trust Score</span>
            <span className="text-xs text-[#535E54] font-medium">
              {score}/5 · {SCORE_LABELS[score]}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label="Trust score from 1 to 5"
            className="grid grid-cols-5 gap-2"
          >
            {[1, 2, 3, 4, 5].map((val) => {
              const selected = score === val;
              return (
                <button
                  key={val}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setScore(val)}
                  className={`py-2.5 px-3 rounded-lg border text-sm font-mono tabular-nums font-semibold transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#0C100C] border-[#0C100C] text-[#CCFF00]'
                      : 'bg-[#F6F8F5] border-[#DCE3DC] text-[#0C100C] hover:bg-[#EEF2EC]'
                  }`}
                >
                  {val}/5
                </button>
              );
            })}
          </div>
        </div>

        {/* Explanation Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="attest-comment-input" className="text-xs font-medium text-[#0C100C]">
              Supporting Note (Optional)
            </label>
            <span className="text-[11px] text-[#535E54] tabular-nums">{comment.length}/500</span>
          </div>
          <textarea
            id="attest-comment-input"
            rows={3}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Share objective context. Do not include private personal information."
            className="w-full px-3.5 py-2 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white resize-y"
          />
          {mode === 'onchain_robinhood' && (
            <p className="text-[11px] text-[#535E54] mt-1.5">
              Settled on Robinhood Chain Testnet (46630) · Only a cryptographic hash of your note
              is stored on-chain.
            </p>
          )}
        </div>

        {/* Primary Action Button */}
        {mode === 'onchain_robinhood' ? (
          <button
            type="submit"
            disabled={
              isSubmitting ||
              (Boolean(walletAddress) &&
                isCorrectChain &&
                (!registryAddress || networkStatus?.contractDeployed === false))
            }
            className="w-full py-2.5 px-4 text-sm font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] disabled:opacity-45 transition-colors cursor-pointer"
          >
            {!walletAddress
              ? 'Connect Wallet to Attest On-Chain'
              : !isCorrectChain
              ? 'Switch to Robinhood Chain (46630)'
              : !registryAddress || networkStatus?.contractDeployed === false
              ? 'On-Chain Registry Not Configured'
              : isSubmitting
              ? 'Awaiting On-Chain Confirmation...'
              : 'Sign & Submit On-Chain Attestation'}
          </button>
        ) : mode === 'offchain_signed' ? (
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 text-sm font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] disabled:opacity-50 transition-colors cursor-pointer"
          >
            {!walletAddress
              ? 'Connect Wallet to Sign Claim'
              : isSubmitting
              ? 'Awaiting Wallet Signature...'
              : 'Sign Off-Chain Claim (Gasless)'}
          </button>
        ) : (
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 text-sm font-semibold bg-[#0C100C] text-white rounded-lg hover:bg-[#1A221B] disabled:opacity-50 transition-colors cursor-pointer"
          >
            {isSubmitting ? 'Saving Note...' : 'Submit Unverified Community Note'}
          </button>
        )}
      </form>

      {/* Quiet Collapsible Disclosure for Existing Transaction Hash Verification */}
      <details className="mt-5 pt-4 border-t border-[#DCE3DC] text-xs text-[#535E54]">
        <summary className="cursor-pointer font-medium hover:text-[#0C100C] select-none">
          Already broadcast a Robinhood Chain transaction? Verify &amp; index its hash
        </summary>
        <form onSubmit={handleVerifyExistingTx} className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            required
            value={existingTxHash}
            onChange={(e) => setExistingTxHash(e.target.value)}
            placeholder="0x... (66-character Robinhood Chain tx hash)"
            aria-label="Existing Robinhood Chain transaction hash"
            className="flex-1 px-3 py-2 text-xs font-mono bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
          />
          <button
            type="submit"
            disabled={verifyingExisting}
            className="px-4 py-2 text-xs font-semibold bg-[#0C100C] text-white rounded-lg hover:bg-[#1A221B] disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            {verifyingExisting ? 'Verifying...' : 'Verify Receipt'}
          </button>
        </form>
      </details>
    </section>
  );
};
