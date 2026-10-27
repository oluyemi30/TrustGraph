import React, { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import heroSculptureImg from '../assets/images/hero_trust_sculpture_1793067319698.jpg';
import provenanceLayersImg from '../assets/images/provenance_glass_layers_1793067320166.jpg';
import { ROBINHOOD_TESTNET, computeSubjectId, shortenAddress } from '../lib/robinhoodChain';
import { Atom, GlobalStats, RobinhoodNetworkStatus } from '../types';
import { BrandLogo } from './BrandLogo';

export type WorkspaceEntryTarget = 'overview' | 'graph' | 'entities' | 'activity' | 'network';

interface LandingPageProps {
  atoms: Atom[];
  stats: GlobalStats | null;
  networkStatus: RobinhoodNetworkStatus | null;
  loading: boolean;
  onEnterWorkspace: (targetTab?: WorkspaceEntryTarget) => void;
  onInspectEntity: (entityName: string) => void;
  onAttestEntity: (entityDisplayName: string) => void;
}

const PROCESS_STEPS = [
  {
    number: '01',
    title: 'Select or Register a Subject',
    summary:
      'Pick any DeFi protocol, smart contract wallet, or contributor—or add a new subject to the directory.',
    detail:
      'TrustGraph converts each entity identifier into a deterministic hash before interacting with the blockchain, keeping human-readable labels, descriptions, and personal handles off-chain.',
    ctaLabel: 'Browse Entities Directory',
    targetTab: 'entities' as WorkspaceEntryTarget,
  },
  {
    number: '02',
    title: 'Choose Your Proof Level & Sign',
    summary:
      'Score the subject from 1 to 5 and decide how much cryptographic weight to put behind your rating.',
    detail:
      'Broadcast an on-chain transaction on Robinhood Chain Testnet (46630), sign a gasless EIP-191 wallet message, or leave an open community note. Each tier stays in its own bucket.',
    ctaLabel: 'Open Attestation Form',
    targetTab: 'overview' as WorkspaceEntryTarget,
  },
  {
    number: '03',
    title: 'Receipt & Event Log Verification',
    summary:
      'A transaction hash alone is never accepted as proof of an on-chain rating.',
    detail:
      'Before marking any claim verified on-chain, the backend checks Chain ID 46630, confirms receipt execution status, verifies the target contract address, and decodes the emitted registry event.',
    ctaLabel: 'Explore the Trust Graph',
    targetTab: 'graph' as WorkspaceEntryTarget,
  },
  {
    number: '04',
    title: 'Inspect Provenance or Revoke Anytime',
    summary:
      'Audit every score by source, read off-chain AI risk context, and revoke outdated ratings when facts change.',
    detail:
      'Every profile displays separate counts and averages per proof tier. If a protocol upgrades or suffers an exploit, original attesters can revoke their rating so active scores update immediately.',
    ctaLabel: 'Audit Live Activity Ledger',
    targetTab: 'activity' as WorkspaceEntryTarget,
  },
] as const;

export const LandingPage: React.FC<LandingPageProps> = ({
  atoms,
  stats,
  networkStatus,
  loading,
  onEnterWorkspace,
  onInspectEntity,
  onAttestEntity,
}) => {
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);
  const [selectedSampleSlug, setSelectedSampleSlug] = useState<string>('ethereum');
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [layersImgFailed, setLayersImgFailed] = useState(false);

  const explorerUrl = networkStatus?.explorerUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0];

  const previewAtoms = useMemo(() => {
    if (atoms.length > 0) return atoms.slice(0, 4);
    return [
      {
        id: 1,
        name: 'ethereum',
        displayName: 'Ethereum SDK',
        type: 'project',
        created_at: new Date().toISOString(),
        description: 'Decentralized smart contract platform.',
        creator: 'system',
        verifiedOnChainCount: 0,
        offChainCount: 2,
        count: 2,
        average: 4.5,
      },
      {
        id: 2,
        name: 'binance',
        displayName: 'Binance',
        type: 'project',
        created_at: new Date().toISOString(),
        description: 'Global cryptocurrency exchange network.',
        creator: 'system',
        verifiedOnChainCount: 0,
        offChainCount: 1,
        count: 1,
        average: 4.0,
      },
    ] as Atom[];
  }, [atoms]);

  const activeSampleAtom = useMemo(() => {
    return (
      previewAtoms.find((a) => a.name.toLowerCase() === selectedSampleSlug.toLowerCase()) ||
      previewAtoms[0]
    );
  }, [previewAtoms, selectedSampleSlug]);

  const activeStep = PROCESS_STEPS[activeStepIdx];

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F8F5] text-[#0C100C]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#0C100C] border-b border-white/10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Lockup */}
          <a
            href="#top"
            className="inline-flex items-center whitespace-nowrap shrink-0 rounded-lg"
          >
            <BrandLogo theme="dark" size="md" />
          </a>

          {/* Zone 2: 4 Concise Single-Line Navigation Links */}
          <nav
            aria-label="Landing page sections"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#A6B2A7]"
          >
            <a
              href="#how-it-works"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
            <a
              href="#provenance"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Provenance Tiers
            </a>
            <a
              href="#telegram"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Telegram Bot
            </a>
            <a
              href="#live-index"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Live Index
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onEnterWorkspace('overview')}
              className="px-4 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Launch Workspace
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* SECTION 1: HERO (Proposition + Dominant Architectural Visual + Full-Width Proof Strip) */}
        <section className="bg-[#0C100C] text-white border-b border-white/10">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-12 pb-12 lg:pt-16 lg:pb-16">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
              {/* Left Column: Core Proposition */}
              <div className="lg:col-span-7 flex flex-col justify-between space-y-8">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#A6B2A7]">
                    <span className="text-[#CCFF00] font-medium">Robinhood Chain Testnet</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Chain ID 46630</span>
                    <span aria-hidden="true">·</span>
                    <span>Verifiable Reputation Protocol</span>
                  </div>

                  <h1 className="text-[clamp(2.25rem,4vw,3.75rem)] font-bold leading-[1.08] tracking-tight text-white text-balance">
                    Every trust score should prove where it came from.
                  </h1>

                  <p className="text-base text-[#B6C2B7] leading-relaxed max-w-[62ch]">
                    Most crypto reputation directories blend anonymous votes, wallet signatures, and
                    blockchain transactions into one opaque number. TrustGraph separates every rating
                    by cryptographic proof—settling verified attestations on Robinhood Chain while
                    keeping off-chain signatures, community notes, and AI risk summaries distinct.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onEnterWorkspace('overview')}
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>Enter Protocol Workspace</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <a
                    href="#how-it-works"
                    className="inline-flex items-center px-5 py-3 text-sm font-medium text-white border border-white/20 rounded-lg hover:bg-white/5 transition-colors whitespace-nowrap"
                  >
                    Walk Through the Process
                  </a>
                </div>
              </div>

              {/* Right Column: Architectural Visual Showcase (Matched Height via items-stretch) */}
              <div className="lg:col-span-5 flex">
                <div className="relative w-full min-h-[280px] lg:min-h-full rounded-xl overflow-hidden border border-white/15 bg-[#141A15] flex flex-col justify-end">
                  {!heroImgFailed ? (
                    <img
                      src={heroSculptureImg}
                      alt="Obsidian monolith nodes connected by precision chartreuse optical lines representing verified trust topology"
                      referrerPolicy="no-referrer"
                      onError={() => setHeroImgFailed(true)}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,#CCFF0026,transparent_55%)]"
                    />
                  )}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-t from-[#0C100C] via-[#0C100C]/65 to-transparent"
                  />

                  <div className="relative z-10 p-6 space-y-2">
                    <div className="text-xs text-[#CCFF00] font-medium">
                      Provenance-Aware Graph Topology
                    </div>
                    <p className="text-sm text-white/90 leading-snug">
                      Visual connections never imply verification on their own. Only verified{' '}
                      <code className="font-mono text-xs text-[#CCFF00]">TrustGraphRegistry</code>{' '}
                      events earn on-chain standing.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Full-Width 4-Column Quantitative Proof Bar Below Hero Split */}
            <div className="mt-10 pt-8 border-t border-white/10 grid grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <div className="text-xs text-[#A6B2A7]">Primary Settlement Network</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
                  Chain 46630
                </div>
                <div className="text-xs text-[#859286] mt-0.5 tabular-nums">
                  {networkStatus?.rpcConnected && networkStatus.latestBlock
                    ? `Robinhood Testnet · Block #${networkStatus.latestBlock.toLocaleString()}`
                    : 'Robinhood Chain Testnet · ETH gas'}
                </div>
              </div>

              <div>
                <div className="text-xs text-[#A6B2A7]">Indexed Entities</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
                  {loading ? '—' : stats?.totalAtoms ?? atoms.length}
                </div>
                <div className="text-xs text-[#859286] mt-0.5">
                  Protocols, wallets &amp; contributors
                </div>
              </div>

              <div>
                <div className="text-xs text-[#A6B2A7]">Recorded Trust Claims</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#CCFF00] mt-1">
                  {loading ? '—' : stats?.totalAttestations ?? 0}
                </div>
                <div className="text-xs text-[#859286] mt-0.5 tabular-nums">
                  {stats?.verifiedOnChainCount ?? 0} on-chain · {stats?.offChainCount ?? 0} off-chain
                </div>
              </div>

              <div>
                <div className="text-xs text-[#A6B2A7]">Evidence Architecture</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
                  4 Tiers
                </div>
                <div className="text-xs text-[#859286] mt-0.5">
                  On-chain · Signed · Community · External
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: INTERACTIVE 4-STEP PROCESS WALKTHROUGH */}
        <section id="how-it-works" className="py-16 lg:py-24 border-b border-[#DCE3DC]">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
            <div className="max-w-2xl space-y-2 mb-10">
              <div className="text-xs font-medium text-[#535E54]">
                End-to-End Protocol Walkthrough
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0C100C] text-balance">
                How TrustGraph Works from First Claim to On-Chain Proof
              </h2>
              <p className="text-sm sm:text-base text-[#535E54]">
                Select each stage below to see how an attestation is created, verified against
                Robinhood Chain Testnet, and surfaced to users.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              {/* Left Column: 4 Interactive Editorial Steps */}
              <div
                role="tablist"
                aria-label="TrustGraph process steps"
                className="lg:col-span-5 flex flex-col justify-between divide-y divide-[#DCE3DC] bg-white border border-[#DCE3DC] rounded-xl overflow-hidden"
              >
                {PROCESS_STEPS.map((step, idx) => {
                  const selected = idx === activeStepIdx;
                  return (
                    <button
                      key={step.number}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveStepIdx(idx)}
                      className={`w-full text-left p-5 transition-colors cursor-pointer ${
                        selected ? 'bg-[#0C100C] text-white' : 'bg-white text-[#0C100C] hover:bg-[#EEF2EC]/70'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span
                          className={`text-xs font-mono tabular-nums font-semibold ${
                            selected ? 'text-[#CCFF00]' : 'text-[#535E54]'
                          }`}
                        >
                          {step.number}.
                        </span>
                        {selected && (
                          <span className="text-[11px] font-medium text-[#CCFF00]">
                            Active Step
                          </span>
                        )}
                      </div>
                      <div className="text-base font-semibold mt-1">{step.title}</div>
                      <p
                        className={`text-xs mt-1 leading-relaxed ${
                          selected ? 'text-[#B6C2B7]' : 'text-[#535E54]'
                        }`}
                      >
                        {step.summary}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Right Column: Interactive Stage Panel */}
              <div
                role="tabpanel"
                className="lg:col-span-7 bg-white border border-[#DCE3DC] rounded-xl p-6 sm:p-8 flex flex-col justify-between space-y-6"
              >
                <div className="space-y-5">
                  <div className="pb-5 border-b border-[#DCE3DC]">
                    <div className="text-xs font-mono tabular-nums text-[#535E54]">
                      Step {activeStep.number} of 04
                    </div>
                    <h3 className="text-xl font-bold text-[#0C100C] mt-1">{activeStep.title}</h3>
                    <p className="text-sm text-[#535E54] mt-2 leading-relaxed">
                      {activeStep.detail}
                    </p>
                  </div>

                  {/* Step-Specific Interactive Demonstration */}
                  {activeStepIdx === 0 && (
                    <div className="space-y-4">
                      <div className="text-xs font-medium text-[#535E54]">
                        Click a live entity to preview how TrustGraph derives an anonymized on-chain
                        key:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {previewAtoms.map((atom) => {
                          const isCurrent = activeSampleAtom?.name === atom.name;
                          return (
                            <button
                              key={atom.id}
                              type="button"
                              onClick={() => setSelectedSampleSlug(atom.name)}
                              className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                                isCurrent
                                  ? 'bg-[#0C100C] border-[#0C100C] text-[#CCFF00]'
                                  : 'bg-[#F6F8F5] border-[#DCE3DC] text-[#0C100C] hover:bg-[#EEF2EC]'
                              }`}
                            >
                              {atom.displayName}
                            </button>
                          );
                        })}
                      </div>

                      {activeSampleAtom && (
                        <div className="p-4 rounded-lg bg-[#F6F8F5] border border-[#DCE3DC] space-y-2.5 text-xs">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#535E54]">Human Display Name (Off-Chain)</span>
                            <span className="font-semibold text-[#0C100C]">
                              {activeSampleAtom.displayName} · <span className="capitalize">{activeSampleAtom.type}</span>
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4 pt-2 border-t border-[#DCE3DC]">
                            <span className="text-[#535E54]">On-Chain Subject Key</span>
                            <code className="font-mono text-[#0C100C]">
                              {shortenAddress(
                                activeSampleAtom.subject_id || computeSubjectId(activeSampleAtom.name),
                                12,
                                10
                              )}
                            </code>
                          </div>
                          <div className="pt-2 border-t border-[#DCE3DC] text-[#535E54]">
                            Privacy guarantee: raw names, comments, and Telegram handles are never
                            written into smart contract storage.
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeStepIdx === 1 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#DCE3DC] text-[#535E54]">
                            <th className="py-2.5 pr-4 font-semibold">Proof Mode</th>
                            <th className="py-2.5 px-3 font-semibold">Cost</th>
                            <th className="py-2.5 px-3 font-semibold">Anti-Spam Policy</th>
                            <th className="py-2.5 pl-3 font-semibold text-right">Revocable</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#DCE3DC]">
                          <tr>
                            <td className="py-3 pr-4 font-semibold text-[#0C100C]">
                              On-Chain (Chain 46630)
                            </td>
                            <td className="py-3 px-3 font-mono tabular-nums text-[#535E54]">
                              Testnet ETH gas
                            </td>
                            <td className="py-3 px-3 text-[#535E54]">
                              Supersedes prior active score per wallet
                            </td>
                            <td className="py-3 pl-3 text-right font-medium text-[#166B00]">
                              Yes (On-Chain)
                            </td>
                          </tr>
                          <tr>
                            <td className="py-3 pr-4 font-semibold text-[#0C100C]">
                              Wallet-Signed (EIP-191)
                            </td>
                            <td className="py-3 px-3 font-mono text-[#535E54]">Gasless</td>
                            <td className="py-3 px-3 text-[#535E54]">
                              Verified cryptographic wallet signature
                            </td>
                            <td className="py-3 pl-3 text-right font-medium text-[#166B00]">
                              Yes (Signed Nonce)
                            </td>
                          </tr>
                          <tr>
                            <td className="py-3 pr-4 font-semibold text-[#0C100C]">
                              Community Note
                            </td>
                            <td className="py-3 px-3 font-mono text-[#535E54]">Free</td>
                            <td className="py-3 px-3 text-[#535E54]">
                              Labeled unverified; lowest score weight
                            </td>
                            <td className="py-3 pl-3 text-right text-[#535E54]">Context only</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {activeStepIdx === 2 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {[
                        {
                          gate: '1. Network Verification',
                          rule: 'Confirms RPC reports Robinhood Chain Testnet (Chain ID 46630).',
                        },
                        {
                          gate: '2. Execution & Target Check',
                          rule: 'Requires receipt.status === 1 sent to the configured TrustGraphRegistry address.',
                        },
                        {
                          gate: '3. Event Log Decoding',
                          rule: 'Parses AttestationCreated from logs; ordinary wallet self-transfers are rejected.',
                        },
                        {
                          gate: '4. Idempotent Indexing',
                          rule: 'Tracks block checkpoints with a 6-block reorg lookback so syncs never duplicate.',
                        },
                      ].map((item) => (
                        <div
                          key={item.gate}
                          className="p-3.5 rounded-lg bg-[#F6F8F5] border border-[#DCE3DC] space-y-1"
                        >
                          <div className="font-semibold text-[#0C100C] flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#166B00] shrink-0" aria-hidden="true" />
                            <span>{item.gate}</span>
                          </div>
                          <p className="text-[#535E54] leading-relaxed">{item.rule}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeStepIdx === 3 && (
                    <div className="p-4 rounded-lg bg-[#F6F8F5] border border-[#DCE3DC] space-y-3 text-xs">
                      <div className="font-semibold text-[#0C100C]">
                        What You See on Every Entity Profile
                      </div>
                      <div className="divide-y divide-[#DCE3DC]">
                        <div className="py-2 flex items-center justify-between gap-4">
                          <span className="text-[#535E54]">Multi-Source Score Table</span>
                          <span className="text-[#0C100C] font-medium">
                            Separate counts &amp; averages per proof tier
                          </span>
                        </div>
                        <div className="py-2 flex items-center justify-between gap-4">
                          <span className="text-[#535E54]">AI Risk Summary</span>
                          <span className="text-[#0C100C] font-medium">
                            Plain-English analysis, never counted as chain proof
                          </span>
                        </div>
                        <div className="py-2 flex items-center justify-between gap-4">
                          <span className="text-[#535E54]">1-Click Revocation</span>
                          <span className="text-[#0C100C] font-medium">
                            Original attester can revoke stale ratings anytime
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Step Navigation & Direct Workspace Action */}
                <div className="pt-4 border-t border-[#DCE3DC] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeStepIdx === 0}
                      onClick={() => setActiveStepIdx((i) => Math.max(0, i - 1))}
                      className="px-3.5 py-2 text-xs font-medium bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] hover:bg-[#EEF2EC] disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={activeStepIdx === PROCESS_STEPS.length - 1}
                      onClick={() =>
                        setActiveStepIdx((i) => Math.min(PROCESS_STEPS.length - 1, i + 1))
                      }
                      className="px-3.5 py-2 text-xs font-medium bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] hover:bg-[#EEF2EC] disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      Next Step
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onEnterWorkspace(activeStep.targetTab)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>{activeStep.ctaLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: ASYMMETRIC BENTO ARCHITECTURE (Provenance Separation & Telegram Bridge) */}
        <section id="provenance" className="py-16 lg:py-24 bg-white border-b border-[#DCE3DC]">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
            <div className="max-w-2xl space-y-2 mb-10">
              <div className="text-xs font-medium text-[#535E54]">
                Protocol Guarantees &amp; Companion Access
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0C100C] text-balance">
                Designed Against Score Stuffing, Fake Receipts, and Black-Box Ratings
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Asymmetric Card 1 (Span 7): 4 Separated Evidence Layers with 4:3 Visual */}
              <div className="lg:col-span-7 bg-[#0C100C] text-white rounded-xl border border-[#0C100C] overflow-hidden grid grid-cols-1 sm:grid-cols-12">
                <div className="sm:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-[#CCFF00]">01. Provenance Isolation</div>
                    <h3 className="text-xl font-bold tracking-tight">
                      Four Separated Layers of Evidence
                    </h3>
                    <p className="text-sm text-[#B6C2B7] leading-relaxed">
                      Robinhood Chain contract receipts, gasless EIP-191 wallet signatures,
                      community submissions, and supplementary Intuition Protocol imports each keep
                      their own origin tag and weight—so unverified chatter never masquerades as
                      settled on-chain consensus.
                    </p>
                  </div>
                  <div className="text-xs text-[#859286] pt-2">
                    On-Chain (46630) · Wallet-Signed · Community · External (Intuition)
                  </div>
                </div>

                <div className="sm:col-span-5 relative min-h-[210px] bg-[#141A15]">
                  {!layersImgFailed ? (
                    <img
                      src={provenanceLayersImg}
                      alt="Four separated smoked-graphite optical glass layers with the top verified layer lit in chartreuse"
                      referrerPolicy="no-referrer"
                      onError={() => setLayersImgFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#141A15]" />
                  )}
                </div>
              </div>

              {/* Asymmetric Card 2 (Span 5): Anti-Stuffing & Revocation */}
              <div className="lg:col-span-5 bg-[#F6F8F5] border border-[#DCE3DC] rounded-xl p-6 sm:p-8 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-mono text-[#535E54]">02. Smart Contract Policy</div>
                  <h3 className="text-xl font-bold tracking-tight text-[#0C100C]">
                    One Active On-Chain Voice per Wallet
                  </h3>
                  <p className="text-sm text-[#535E54] leading-relaxed">
                    When the same wallet submits an updated score for an entity on{' '}
                    <code className="font-mono text-xs text-[#0C100C]">TrustGraphRegistry.sol</code>
                    , its previous active attestation is automatically superseded instead of
                    inflating total vote counts.
                  </p>
                </div>
                <div className="text-xs text-[#535E54] pt-3 border-t border-[#DCE3DC]">
                  Honest limitation: wallet uniqueness prevents single-address spam, not multi-wallet
                  Sybil resistance.
                </div>
              </div>

              {/* Asymmetric Card 3 (Span 5): Off-Chain AI Boundary */}
              <div className="lg:col-span-5 bg-[#F6F8F5] border border-[#DCE3DC] rounded-xl p-6 sm:p-8 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-mono text-[#535E54]">03. Analytical Guardrail</div>
                  <h3 className="text-xl font-bold tracking-tight text-[#0C100C]">
                    AI Risk Summaries Stay Off-Chain
                  </h3>
                  <p className="text-sm text-[#535E54] leading-relaxed">
                    AI explanations read score dispersion, revocation activity, and reviewer notes to
                    highlight potential risks in seconds—while being structurally barred from
                    modifying on-chain reputation numbers.
                  </p>
                </div>
                <div className="text-xs text-[#535E54] pt-3 border-t border-[#DCE3DC]">
                  Explicitly labeled analytical interpretation · Never treated as blockchain proof
                </div>
              </div>

              {/* Asymmetric Card 4 (Span 7): Telegram Companion Bridge */}
              <div
                id="telegram"
                className="lg:col-span-7 bg-white border border-[#DCE3DC] rounded-xl p-6 sm:p-8 flex flex-col justify-between space-y-5"
              >
                <div className="space-y-2">
                  <div className="text-xs font-mono text-[#535E54]">04. Telegram Companion</div>
                  <h3 className="text-xl font-bold tracking-tight text-[#0C100C]">
                    Query Trust &amp; Link Your Wallet via @trustmvpbot
                  </h3>
                  <p className="text-sm text-[#535E54] leading-relaxed max-w-2xl">
                    Sign a short-lived, single-use nonce challenge in your browser to receive a
                    10-minute <code className="font-mono text-xs text-[#0C100C]">/activate</code>{' '}
                    code for Telegram. Once linked, inspect entity profiles, check wallet status,
                    and synchronize Robinhood Chain events from anywhere—without sharing private
                    keys or receiving fabricated transaction hashes.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onEnterWorkspace('network')}
                    className="px-4 py-2.5 text-xs font-semibold bg-[#0C100C] text-[#CCFF00] rounded-lg hover:bg-[#1A221B] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Link Wallet in Workspace
                  </button>
                  <a
                    href="https://t.me/trustmvpbot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium bg-[#F6F8F5] border border-[#DCE3DC] text-[#0C100C] rounded-lg hover:bg-[#EEF2EC] transition-colors whitespace-nowrap"
                  >
                    <span>Open t.me/trustmvpbot</span>
                    <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: LIVE PROTOCOL INDEX PREVIEW (Claim-to-Proof Adjacency) */}
        <section id="live-index" className="py-16 lg:py-24 border-b border-[#DCE3DC]">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-[#535E54]">Live Protocol Directory</div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0C100C]">
                  Inspect Indexed Entities Right Now
                </h2>
                <p className="text-sm text-[#535E54]">
                  Select any entity below to jump straight into its multi-source breakdown or submit
                  a new rating.
                </p>
              </div>

              <button
                type="button"
                onClick={() => onEnterWorkspace('entities')}
                className="text-xs font-semibold text-[#0C100C] underline hover:text-[#166B00] whitespace-nowrap self-start sm:self-auto cursor-pointer"
              >
                View Full Directory ({atoms.length})
              </button>
            </div>

            <div className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden">
              {loading ? (
                <div className="p-6 space-y-3 animate-pulse">
                  <div className="h-10 bg-[#EEF2EC] rounded" />
                  <div className="h-10 bg-[#EEF2EC] rounded" />
                  <div className="h-10 bg-[#EEF2EC] rounded" />
                </div>
              ) : previewAtoms.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#535E54]">
                  No entities indexed yet. Enter the workspace to register the first protocol or
                  wallet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE3DC] text-[11px] font-semibold text-[#535E54]">
                        <th className="py-3.5 px-5">Subject Entity</th>
                        <th className="py-3.5 px-4">Class &amp; Origin</th>
                        <th className="py-3.5 px-4 text-right">Verified On-Chain</th>
                        <th className="py-3.5 px-4 text-right">Off-Chain Claims</th>
                        <th className="py-3.5 px-4 text-right">Weighted Signal</th>
                        <th className="py-3.5 px-5 text-right">Workspace</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DCE3DC] text-sm">
                      {previewAtoms.map((atom) => (
                        <tr
                          key={atom.id}
                          className="hover:bg-[#F6F8F5] transition-colors"
                        >
                          <td className="py-4 px-5">
                            <button
                              type="button"
                              onClick={() => onInspectEntity(atom.name)}
                              className="font-semibold text-[#0C100C] hover:underline text-left cursor-pointer"
                            >
                              {atom.displayName}
                            </button>
                            {atom.description && (
                              <p className="text-xs text-[#535E54] mt-0.5 max-w-md truncate">
                                {atom.description}
                              </p>
                            )}
                          </td>
                          <td className="py-4 px-4 text-xs text-[#535E54] whitespace-nowrap">
                            <span className="capitalize font-medium text-[#0C100C]">
                              {atom.type}
                            </span>{' '}
                            ·{' '}
                            {atom.origin_source === 'intuition'
                              ? 'Intuition (Base)'
                              : 'TrustGraph'}
                          </td>
                          <td className="py-4 px-4 text-right font-mono tabular-nums font-semibold text-[#166B00]">
                            {atom.verifiedOnChainCount || 0}
                          </td>
                          <td className="py-4 px-4 text-right font-mono tabular-nums text-[#535E54]">
                            {atom.offChainCount || 0}
                          </td>
                          <td className="py-4 px-4 text-right font-mono tabular-nums font-semibold text-[#0C100C]">
                            {atom.count && atom.average ? `${atom.average.toFixed(2)}/5` : '—'}
                          </td>
                          <td className="py-4 px-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onInspectEntity(atom.name)}
                                className="px-3 py-1.5 text-xs font-medium bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] hover:bg-[#EEF2EC] transition-colors cursor-pointer"
                              >
                                Inspect
                              </button>
                              <button
                                type="button"
                                onClick={() => onAttestEntity(atom.displayName)}
                                className="px-3 py-1.5 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors cursor-pointer"
                              >
                                Attest
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* SECTION 5: FOCUSED CONVERSION CALLOUT */}
        <section className="py-16 bg-[#0C100C] text-white">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2 max-w-xl">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">
                Ready to explore the live graph or sign an attestation?
              </h2>
              <p className="text-sm text-[#B6C2B7]">
                Connect an EVM wallet on Robinhood Chain Testnet (46630), sign a gasless EIP-191
                claim, or inspect existing provenance breakdowns with no wallet required.
              </p>
            </div>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => onEnterWorkspace('overview')}
                className="inline-flex items-center gap-2 px-6 py-3.5 text-sm font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>Open TrustGraph Workspace</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="bg-[#0C100C] border-t border-white/10 text-[#859286]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <BrandLogo theme="dark" size="sm" />
            <span aria-hidden="true" className="hidden sm:inline text-white/20">
              ·
            </span>
            <span>
              Independent Open-Source Reputation Protocol on Robinhood Chain Testnet (46630).
              Unaudited testnet contract.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => onEnterWorkspace('overview')}
              className="text-white/80 hover:text-white underline cursor-pointer"
            >
              Launch Workspace
            </button>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/80 hover:text-white underline"
            >
              Robinhood Testnet Explorer
            </a>
            <a
              href="https://t.me/trustmvpbot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/80 hover:text-white underline"
            >
              Telegram @trustmvpbot
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
