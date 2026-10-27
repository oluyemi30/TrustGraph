import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isAddress } from 'ethers';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { AttestationPanel } from './components/AttestationPanel';
import { EntityProfileView } from './components/EntityProfileView';
import { LandingPage, WorkspaceEntryTarget } from './components/LandingPage';
import { NetworkAndBotView } from './components/NetworkAndBotView';
import { TrustGraphCanvas } from './components/TrustGraphCanvas';
import { apiFetch, formatEvidenceLabel } from './lib/api';
import {
  ROBINHOOD_TESTNET,
  getClientRegistryAddress,
  getExplorerTxUrl,
  getInjectedEthereumProvider,
  getWalletProviderLabel,
  parseWalletError,
  readWalletChainId,
  shortenAddress,
  switchOrAddRobinhoodChain,
} from './lib/robinhoodChain';
import {
  Atom,
  Attestation,
  GlobalStats,
  GraphLink,
  GraphNode,
  IndexerState,
  RobinhoodNetworkStatus,
  ToastNotice,
} from './types';

type ActiveTab = WorkspaceEntryTarget;

export function App() {
  const [viewMode, setViewMode] = useState<'landing' | 'workspace'>('landing');
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');

  // Core Data State
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphLinks, setGraphLinks] = useState<GraphLink[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [networkStatus, setNetworkStatus] = useState<RobinhoodNetworkStatus | null>(null);
  const [indexerState, setIndexerState] = useState<IndexerState | null>(null);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [includeRevokedGraph, setIncludeRevokedGraph] = useState(false);

  // Selection & Profile Navigation State
  const [selectedGraphEntityId, setSelectedGraphEntityId] = useState<string | null>('ethereum');
  const [focusedProfileKey, setFocusedProfileKey] = useState<string | null>(null);
  const [attestTargetEntity, setAttestTargetEntity] = useState<string>('');

  // Entities Directory & Registration State
  const [entitySearch, setEntitySearch] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | 'project' | 'wallet' | 'user'>(
    'all'
  );
  const [showRegisterEntityForm, setShowRegisterEntityForm] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityType, setNewEntityType] = useState<'project' | 'wallet' | 'user'>('project');
  const [newEntityWallet, setNewEntityWallet] = useState('');
  const [newEntityDescription, setNewEntityDescription] = useState('');
  const [registeringEntity, setRegisteringEntity] = useState(false);

  // Activity Ledger Filters
  const [activitySearch, setActivitySearch] = useState('');
  const [activityCategoryFilter, setActivityCategoryFilter] = useState<
    'all' | 'onchain_verified' | 'offchain_signed' | 'offchain_community' | 'external_intuition'
  >('all');
  const [showRevokedActivity, setShowRevokedActivity] = useState(true);

  // Wallet Connection State
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [walletLabel, setWalletLabel] = useState<string>('EVM Wallet');
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  // Accessible Toast Notifications
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const pushToast = useCallback((notice: Omit<ToastNotice, 'id'>) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...notice, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6500);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Load all backend protocol state
  const refreshAllData = useCallback(async () => {
    setLoadError(null);
    try {
      const [atomsRes, attsRes, statsRes, graphRes, netRes] = await Promise.all([
        apiFetch<{ success: boolean; atoms: Atom[] }>('/api/atoms'),
        apiFetch<{ success: boolean; attestations: Attestation[] }>(
          '/api/attestations?includeRevoked=true'
        ),
        apiFetch<GlobalStats & { success: boolean }>('/api/statistics'),
        apiFetch<{ success: boolean; nodes: GraphNode[]; links: GraphLink[] }>(
          `/api/graph?includeRevoked=${includeRevokedGraph ? 'true' : 'false'}`
        ),
        apiFetch<{
          success: boolean;
          network: RobinhoodNetworkStatus;
          indexer: IndexerState;
        }>('/api/network/status'),
      ]);

      setAtoms(atomsRes.atoms || []);
      setAttestations(attsRes.attestations || []);
      setStats(statsRes);
      setGraphNodes(graphRes.nodes || []);
      setGraphLinks(graphRes.links || []);
      setNetworkStatus(netRes.network);
      setIndexerState(netRes.indexer);

      if (!selectedGraphEntityId && atomsRes.atoms.length > 0) {
        setSelectedGraphEntityId(atomsRes.atoms[0].name);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to connect to TrustGraph API server.');
    } finally {
      setLoadingInitial(false);
    }
  }, [includeRevokedGraph, selectedGraphEntityId]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  // Passive Wallet Session & Network Listener
  useEffect(() => {
    const eth = getInjectedEthereumProvider();
    if (!eth) return;
    setWalletLabel(getWalletProviderLabel(eth));

    let mounted = true;
    async function syncExistingAccounts() {
      try {
        const accounts = await eth.request({ method: 'eth_accounts' });
        const cId = await readWalletChainId(eth);
        if (!mounted) return;
        if (Array.isArray(accounts) && accounts.length > 0) {
          setWalletAddress(accounts[0]);
        }
        setWalletChainId(cId);
      } catch {
        // Ignore silent probe error
      }
    }
    syncExistingAccounts();

    const handleAccountsChanged = (accounts: string[]) => {
      if (!Array.isArray(accounts) || accounts.length === 0) {
        setWalletAddress(null);
        setWalletMenuOpen(false);
      } else {
        setWalletAddress(accounts[0]);
      }
    };

    const handleChainChanged = (hexChainId: string | number) => {
      const parsed =
        typeof hexChainId === 'string' ? parseInt(hexChainId, 16) : Number(hexChainId);
      setWalletChainId(Number.isFinite(parsed) ? parsed : null);
    };

    eth.on?.('accountsChanged', handleAccountsChanged);
    eth.on?.('chainChanged', handleChainChanged);

    return () => {
      mounted = false;
      eth.removeListener?.('accountsChanged', handleAccountsChanged);
      eth.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  const handleConnectWallet = useCallback(async () => {
    const eth = getInjectedEthereumProvider();
    if (!eth) {
      pushToast({
        tone: 'warning',
        title: 'No EVM Wallet Detected',
        description:
          'Open in a browser with MetaMask, Rabby, or Coinbase Wallet to sign on Robinhood Chain Testnet (46630).',
      });
      return;
    }

    try {
      setWalletLabel(getWalletProviderLabel(eth));
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('No wallet accounts authorized.');
      }
      setWalletAddress(accounts[0]);

      const currentChain = await readWalletChainId(eth);
      setWalletChainId(currentChain);

      if (currentChain !== ROBINHOOD_TESTNET.chainId) {
        try {
          await switchOrAddRobinhoodChain(eth);
          const updatedChain = await readWalletChainId(eth);
          setWalletChainId(updatedChain);
          pushToast({
            tone: 'success',
            title: 'Connected to Robinhood Chain Testnet',
            description: `${shortenAddress(accounts[0])} active on Chain ID 46630.`,
          });
        } catch (switchErr: any) {
          const parsedSwitch = parseWalletError(switchErr);
          pushToast({
            tone: 'warning',
            title: 'Wallet Connected (Different Network)',
            description: `Connected ${shortenAddress(accounts[0])}. ${parsedSwitch.message}`,
          });
        }
      } else {
        pushToast({
          tone: 'success',
          title: 'Wallet Connected',
          description: `${shortenAddress(accounts[0])} on Robinhood Chain Testnet (46630).`,
        });
      }
    } catch (err: any) {
      const parsed = parseWalletError(err);
      pushToast({
        tone: parsed.isUserRejected ? 'warning' : 'error',
        title: parsed.isUserRejected ? 'Connection Cancelled' : 'Wallet Connection Error',
        description: parsed.message,
      });
    }
  }, [pushToast]);

  const handleSwitchToRobinhoodChain = useCallback(async () => {
    const eth = getInjectedEthereumProvider();
    if (!eth) {
      await handleConnectWallet();
      return;
    }

    try {
      await switchOrAddRobinhoodChain(eth);
      const updatedChain = await readWalletChainId(eth);
      setWalletChainId(updatedChain);
      pushToast({
        tone: 'success',
        title: 'Switched to Robinhood Chain Testnet',
        description: 'Active network is now Chain ID 46630 (ETH).',
      });
    } catch (err: any) {
      const parsed = parseWalletError(err);
      pushToast({
        tone: parsed.isUserRejected ? 'warning' : 'error',
        title: parsed.isUserRejected ? 'Network Switch Cancelled' : 'Network Switch Failed',
        description: parsed.message,
      });
    }
  }, [handleConnectWallet, pushToast]);

  const handleDisconnectWalletLocal = () => {
    setWalletAddress(null);
    setWalletMenuOpen(false);
    pushToast({
      tone: 'info',
      title: 'Wallet Disconnected',
      description: 'Cleared local session.',
    });
  };

  const registryAddress = useMemo(
    () => getClientRegistryAddress(networkStatus?.registryAddress),
    [networkStatus?.registryAddress]
  );

  const explorerBaseUrl =
    networkStatus?.explorerUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0];

  const enterWorkspace = (targetTab: ActiveTab = 'overview') => {
    setFocusedProfileKey(null);
    setActiveTab(targetTab);
    setViewMode('workspace');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const openEntityProfile = (entityNameOrKey: string) => {
    setFocusedProfileKey(entityNameOrKey.trim().toLowerCase());
    setActiveTab('entities');
    setViewMode('workspace');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const startAttestationFor = (entityDisplayName: string) => {
    setAttestTargetEntity(entityDisplayName);
    setFocusedProfileKey(null);
    setActiveTab('overview');
    setViewMode('workspace');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const focusedEntityAtom = useMemo(() => {
    if (!focusedProfileKey) return null;
    return (
      atoms.find(
        (a) =>
          a.name.toLowerCase() === focusedProfileKey ||
          a.displayName.toLowerCase() === focusedProfileKey
      ) || null
    );
  }, [atoms, focusedProfileKey]);

  const filteredDirectoryAtoms = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    return atoms
      .filter((a) => (entityTypeFilter === 'all' ? true : a.type === entityTypeFilter))
      .filter(
        (a) =>
          !q ||
          a.displayName.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          (a.wallet_address || '').toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const verDiff = (b.verifiedOnChainCount || 0) - (a.verifiedOnChainCount || 0);
        if (verDiff !== 0) return verDiff;
        return (b.count || 0) - (a.count || 0);
      });
  }, [atoms, entitySearch, entityTypeFilter]);

  const filteredActivity = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    return attestations
      .filter((a) => (showRevokedActivity ? true : !a.revoked))
      .filter((a) => {
        if (activityCategoryFilter === 'all') return true;
        if (activityCategoryFilter === 'external_intuition') {
          return (
            a.evidence_category === 'external_intuition' ||
            a.evidence_category === 'external_intuition_sample'
          );
        }
        return a.evidence_category === activityCategoryFilter;
      })
      .filter(
        (a) =>
          !q ||
          a.to_entity.toLowerCase().includes(q) ||
          a.from_user.toLowerCase().includes(q) ||
          (a.wallet_address || '').toLowerCase().includes(q) ||
          (a.comment || '').toLowerCase().includes(q) ||
          (a.tx_hash || '').toLowerCase().includes(q)
      )
      .slice()
      .reverse();
  }, [attestations, activitySearch, activityCategoryFilter, showRevokedActivity]);

  const handleRegisterEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newEntityName.trim();
    if (!cleanName) return;

    if (newEntityWallet.trim() && !isAddress(newEntityWallet.trim())) {
      pushToast({
        tone: 'error',
        title: 'Invalid Wallet Address',
        description: 'Provide a valid 0x EVM address or leave the wallet field blank.',
      });
      return;
    }

    setRegisteringEntity(true);
    try {
      const res = await apiFetch<{ success: boolean; atom: Atom }>('/api/atoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: cleanName,
          type: newEntityType,
          description: newEntityDescription.trim(),
          walletAddress: newEntityWallet.trim() || undefined,
          creator: walletAddress ? shortenAddress(walletAddress) : 'web-dashboard',
        }),
      });

      setNewEntityName('');
      setNewEntityWallet('');
      setNewEntityDescription('');
      setShowRegisterEntityForm(false);

      pushToast({
        tone: 'success',
        title: 'Entity Registered',
        description: `${res.atom.displayName} added to the TrustGraph directory.`,
      });

      await refreshAllData();
      openEntityProfile(res.atom.name);
    } catch (err: any) {
      pushToast({
        tone: 'error',
        title: 'Registration Failed',
        description: err?.message || 'Unable to register entity.',
      });
    } finally {
      setRegisteringEntity(false);
    }
  };

  const isOnRobinhoodChain = walletChainId === ROBINHOOD_TESTNET.chainId;

  if (viewMode === 'landing') {
    return (
      <LandingPage
        atoms={atoms}
        stats={stats}
        networkStatus={networkStatus}
        loading={loadingInitial}
        onEnterWorkspace={enterWorkspace}
        onInspectEntity={openEntityProfile}
        onAttestEntity={startAttestationFor}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F8F5] text-[#0C100C]">
      {/* Strict 3-Zone Obsidian Top Bar */}
      <header className="sticky top-0 z-30 bg-[#0C100C] border-b border-white/10">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-Line Brand Wordmark (Returns to Landing Walkthrough) */}
          <button
            type="button"
            onClick={() => {
              setViewMode('landing');
              if (typeof window !== 'undefined') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className="text-lg font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0 cursor-pointer"
          >
            TrustGraph
          </button>

          {/* Zone 2: 5 Concise Single-Line Workspace Links */}
          <nav
            aria-label="Primary workspace navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            {(
              [
                { id: 'overview', label: 'Overview' },
                { id: 'graph', label: 'Trust Graph' },
                { id: 'entities', label: 'Entities' },
                { id: 'activity', label: 'Activity' },
                { id: 'network', label: 'Telegram & Sync' },
              ] as const
            ).map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id !== 'entities') setFocusedProfileKey(null);
                    setActiveTab(item.id);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-[#CCFF00] text-white font-semibold'
                      : 'border-transparent text-[#A6B2A7] hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action (Wallet Connection) */}
          <div className="relative shrink-0">
            {!walletAddress ? (
              <button
                type="button"
                onClick={handleConnectWallet}
                className="px-4 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Connect Wallet
              </button>
            ) : !isOnRobinhoodChain ? (
              <button
                type="button"
                onClick={handleSwitchToRobinhoodChain}
                className="px-4 py-2 text-xs font-semibold bg-[#FFFBEB] text-[#7A4F04] rounded-lg hover:bg-[#FEF3C7] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Switch to 46630
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setWalletMenuOpen((o) => !o)}
                aria-expanded={walletMenuOpen}
                className="px-3.5 py-2 text-xs font-mono font-medium bg-[#141A15] border border-white/15 text-[#CCFF00] rounded-lg hover:bg-[#1E2620] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {shortenAddress(walletAddress)} · ETH
              </button>
            )}

            {walletMenuOpen && walletAddress && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-[#DCE3DC] rounded-xl shadow-md p-4 z-40 text-xs space-y-3 text-[#0C100C]">
                <div>
                  <div className="text-[#535E54]">{walletLabel}</div>
                  <div className="font-mono text-[#0C100C] font-medium break-all mt-0.5">
                    {walletAddress}
                  </div>
                </div>
                <div className="pt-2 border-t border-[#DCE3DC] flex items-center justify-between text-[#535E54]">
                  <span>Network</span>
                  <span className="font-mono font-semibold text-[#166B00]">
                    {walletChainId === ROBINHOOD_TESTNET.chainId
                      ? 'Robinhood (46630)'
                      : `Chain ${walletChainId ?? 'Unknown'}`}
                  </span>
                </div>
                <div className="pt-2 border-t border-[#DCE3DC] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWalletMenuOpen(false);
                      setActiveTab('network');
                    }}
                    className="px-3 py-1.5 font-medium bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] hover:bg-[#EEF2EC] cursor-pointer"
                  >
                    Telegram Link
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectWalletLocal}
                    className="px-3 py-1.5 font-medium text-[#C93535] hover:bg-[#FFF5F5] rounded-lg cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Compact Workspace Tabs */}
        <nav
          aria-label="Mobile workspace navigation"
          className="md:hidden border-t border-white/10 px-4 flex items-center gap-5 overflow-x-auto text-xs font-medium bg-[#0C100C]"
        >
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'graph', label: 'Trust Graph' },
              { id: 'entities', label: 'Entities' },
              { id: 'activity', label: 'Activity' },
              { id: 'network', label: 'Telegram & Sync' },
            ] as const
          ).map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id !== 'entities') setFocusedProfileKey(null);
                  setActiveTab(item.id);
                }}
                className={`py-2.5 border-b-2 whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-[#CCFF00] text-white font-semibold'
                    : 'border-transparent text-[#A6B2A7]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-[1320px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {loadError && (
          <div
            role="alert"
            className="mb-6 p-4 bg-[#FFF5F5] border border-[#F0B8B8] rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#8A1C1C]"
          >
            <div>
              <strong className="font-semibold">API Connection Error:</strong> {loadError}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={refreshAllData}
                className="px-3 py-1.5 font-semibold bg-white border border-[#E5B0B0] rounded-lg text-[#0C100C] cursor-pointer"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('network')}
                className="px-3 py-1.5 font-medium underline text-[#8A1C1C] cursor-pointer"
              >
                Connection Settings
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: OVERVIEW DASHBOARD */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={() => setViewMode('landing')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#535E54] hover:text-[#0C100C] mb-2 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>How TrustGraph Works</span>
                </button>
                <h1 className="text-2xl sm:text-3xl font-bold text-[#0C100C] tracking-tight text-balance">
                  Protocol Workspace
                </h1>
                <p className="text-sm text-[#535E54] mt-0.5">
                  Robinhood Chain Testnet (46630) ·{' '}
                  {networkStatus?.rpcConnected && networkStatus.latestBlock
                    ? `Live Block #${networkStatus.latestBlock.toLocaleString()}`
                    : 'Multi-source reputation ledger'}
                </p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('graph')}
                  className="px-4 py-2 text-xs font-medium bg-white border border-[#DCE3DC] text-[#0C100C] rounded-lg hover:bg-[#EEF2EC] transition-colors whitespace-nowrap cursor-pointer"
                >
                  Open Trust Graph
                </button>
                <button
                  type="button"
                  onClick={refreshAllData}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-[#DCE3DC] text-[#535E54] hover:text-[#0C100C] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Clean 4-Column Protocol Metrics Bar */}
            <section
              aria-label="Protocol metrics"
              className="bg-white border border-[#DCE3DC] rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-[#DCE3DC]"
            >
              <div className="p-5">
                <div className="text-xs text-[#535E54]">Entities Indexed</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#0C100C] mt-1">
                  {loadingInitial ? '—' : stats?.totalAtoms ?? atoms.length}
                </div>
                <div className="text-xs text-[#535E54] mt-1">
                  Protocols, wallets &amp; contributors
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-[#535E54]">Verified On-Chain (46630)</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#166B00] mt-1">
                  {loadingInitial ? '—' : stats?.verifiedOnChainCount ?? 0}
                </div>
                <div className="text-xs text-[#535E54] mt-1">
                  Confirmed contract receipts
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-[#535E54]">Off-Chain Signals</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#0C100C] mt-1">
                  {loadingInitial ? '—' : stats?.offChainCount ?? 0}
                </div>
                <div className="text-xs text-[#535E54] mt-1 tabular-nums">
                  {stats?.offChainSignedCount ?? 0} signed · {stats?.offChainCommunityCount ?? 0}{' '}
                  community
                </div>
              </div>

              <div className="p-5">
                <div className="text-xs text-[#535E54]">Attester Wallets</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#0C100C] mt-1">
                  {loadingInitial ? '—' : stats?.uniqueAttesterWallets ?? 0}
                </div>
                <div className="text-xs text-[#535E54] mt-1 tabular-nums">
                  {stats?.linkedTelegramWallets ?? 0} linked with @trustmvpbot
                </div>
              </div>
            </section>

            {/* Primary 2-Column Workspace: Attestation Panel + Entity Standings */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-6">
                <AttestationPanel
                  atoms={atoms}
                  initialEntity={attestTargetEntity}
                  walletAddress={walletAddress}
                  walletChainId={walletChainId}
                  networkStatus={networkStatus}
                  registryAddress={registryAddress}
                  onConnectWallet={handleConnectWallet}
                  onSwitchNetwork={handleSwitchToRobinhoodChain}
                  onAttestationRecorded={async (entityName) => {
                    await refreshAllData();
                    setSelectedGraphEntityId(entityName.toLowerCase());
                  }}
                  onNotify={pushToast}
                />
              </div>

              <div className="lg:col-span-6 space-y-6">
                {/* Indexed Entities Reputation Summary */}
                <section
                  aria-labelledby="top-entities-heading"
                  className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden"
                >
                  <div className="p-5 border-b border-[#DCE3DC] flex items-center justify-between gap-3">
                    <div>
                      <h2
                        id="top-entities-heading"
                        className="text-base font-semibold text-[#0C100C]"
                      >
                        Entity Reputation Standings
                      </h2>
                      <p className="text-xs text-[#535E54] mt-0.5">
                        Click any entity to inspect its provenance breakdown or AI risk summary.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedProfileKey(null);
                        setActiveTab('entities');
                      }}
                      className="text-xs font-medium text-[#0C100C] underline hover:text-[#166B00] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      View All ({atoms.length})
                    </button>
                  </div>

                  {loadingInitial ? (
                    <div className="p-6 space-y-3 animate-pulse">
                      <div className="h-9 bg-[#EEF2EC] rounded" />
                      <div className="h-9 bg-[#EEF2EC] rounded" />
                      <div className="h-9 bg-[#EEF2EC] rounded" />
                    </div>
                  ) : atoms.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#535E54]">
                      No entities indexed yet. Submit an attestation or register an entity to begin.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#DCE3DC] text-[11px] font-semibold text-[#535E54]">
                            <th className="py-2.5 px-5">Entity</th>
                            <th className="py-2.5 px-3 text-right">On-Chain</th>
                            <th className="py-2.5 px-3 text-right">Off-Chain</th>
                            <th className="py-2.5 px-5 text-right">Signal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#DCE3DC] text-sm">
                          {atoms.slice(0, 6).map((atom) => (
                            <tr
                              key={atom.id}
                              onClick={() => openEntityProfile(atom.name)}
                              className="hover:bg-[#F6F8F5] cursor-pointer transition-colors"
                            >
                              <td className="py-3 px-5">
                                <div className="font-medium text-[#0C100C]">{atom.displayName}</div>
                                <div className="text-[11px] text-[#535E54] capitalize">
                                  {atom.type} ·{' '}
                                  {atom.origin_source === 'intuition'
                                    ? 'Intuition (Base)'
                                    : 'TrustGraph'}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#166B00]">
                                {atom.verifiedOnChainCount || 0}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums text-[#535E54]">
                                {atom.offChainCount || 0}
                              </td>
                              <td className="py-3 px-5 text-right font-mono tabular-nums font-semibold text-[#0C100C]">
                                {atom.count && atom.average ? `${atom.average.toFixed(2)}/5` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Recent Attestation Feed */}
                <section
                  aria-labelledby="recent-activity-heading"
                  className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden"
                >
                  <div className="p-5 border-b border-[#DCE3DC] flex items-center justify-between gap-3">
                    <div>
                      <h2
                        id="recent-activity-heading"
                        className="text-base font-semibold text-[#0C100C]"
                      >
                        Recent Claims
                      </h2>
                      <p className="text-xs text-[#535E54] mt-0.5">
                        Latest activity tagged by proof level.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('activity')}
                      className="text-xs font-medium text-[#0C100C] underline hover:text-[#166B00] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Full Ledger
                    </button>
                  </div>

                  {attestations.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#535E54]">
                      No attestations recorded yet.
                    </div>
                  ) : (
                    <ul className="divide-y divide-[#DCE3DC]">
                      {attestations
                        .slice(-4)
                        .reverse()
                        .map((att) => (
                          <li key={att.id} className="px-5 py-3.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <button
                                  type="button"
                                  onClick={() => openEntityProfile(att.to_entity)}
                                  className="font-semibold text-[#0C100C] hover:text-[#166B00] underline cursor-pointer"
                                >
                                  {att.to_entity}
                                </button>
                                <span className="text-[#535E54]">
                                  {' '}
                                  by{' '}
                                  <code className="font-mono text-[#0C100C]">
                                    {att.wallet_address
                                      ? shortenAddress(att.wallet_address)
                                      : `@${att.from_user}`}
                                  </code>
                                </span>
                              </div>
                              <span className="font-mono tabular-nums font-semibold text-[#0C100C]">
                                {att.trust_score}/5
                              </span>
                            </div>

                            <div className="mt-1 text-[11px] text-[#535E54] flex flex-wrap items-center gap-1.5">
                              <span
                                className={
                                  att.revoked
                                    ? 'text-[#C93535] font-medium'
                                    : att.evidence_category === 'onchain_verified'
                                    ? 'text-[#166B00] font-medium'
                                    : ''
                                }
                              >
                                {att.revoked
                                  ? 'Revoked'
                                  : formatEvidenceLabel(att.evidence_category)}
                              </span>
                              {att.verified_onchain && att.tx_hash && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <a
                                    href={getExplorerTxUrl(att.tx_hash, explorerBaseUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-[#0C100C] underline"
                                  >
                                    Explorer
                                    <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                                  </a>
                                </>
                              )}
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TRUST GRAPH EXPLORER */}
        {activeTab === 'graph' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-[#0C100C] tracking-tight">
                Trust Graph Explorer
              </h1>
              <p className="text-sm text-[#535E54] mt-0.5">
                Inspect relationships across verified Robinhood Chain receipts, wallet signatures,
                and community notes.
              </p>
            </div>

            <TrustGraphCanvas
              nodes={graphNodes}
              links={graphLinks}
              loading={loadingInitial}
              error={loadError}
              includeRevoked={includeRevokedGraph}
              onToggleIncludeRevoked={setIncludeRevokedGraph}
              selectedEntityId={selectedGraphEntityId}
              onSelectEntity={(id) => setSelectedGraphEntityId(id)}
              onOpenEntityProfile={openEntityProfile}
              onStartAttestation={startAttestationFor}
              onRetry={refreshAllData}
              explorerBaseUrl={explorerBaseUrl}
            />
          </div>
        )}

        {/* TAB 3: ENTITIES & PROFILES */}
        {activeTab === 'entities' && (
          <div>
            {focusedEntityAtom ? (
              <EntityProfileView
                entity={focusedEntityAtom}
                attestations={attestations}
                walletAddress={walletAddress}
                walletChainId={walletChainId}
                registryAddress={registryAddress}
                networkStatus={networkStatus}
                onBack={() => setFocusedProfileKey(null)}
                onStartAttestation={startAttestationFor}
                onConnectWallet={handleConnectWallet}
                onSwitchNetwork={handleSwitchToRobinhoodChain}
                onDataMutated={refreshAllData}
                onNotify={pushToast}
              />
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-bold text-[#0C100C] tracking-tight">
                      Entities Directory
                    </h1>
                    <p className="text-sm text-[#535E54] mt-0.5">
                      Browse indexed protocols, wallets, and contributors.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRegisterEntityForm((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>{showRegisterEntityForm ? 'Close Form' : 'Register Entity'}</span>
                  </button>
                </div>

                {showRegisterEntityForm && (
                  <form
                    onSubmit={handleRegisterEntity}
                    className="bg-white border border-[#DCE3DC] rounded-xl p-6 space-y-4"
                  >
                    <h2 className="text-base font-semibold text-[#0C100C]">
                      Register New Subject Entity
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label
                          htmlFor="reg-entity-name"
                          className="block text-xs font-medium text-[#0C100C] mb-1"
                        >
                          Display Name
                        </label>
                        <input
                          id="reg-entity-name"
                          type="text"
                          required
                          maxLength={80}
                          value={newEntityName}
                          onChange={(e) => setNewEntityName(e.target.value)}
                          placeholder="e.g., Robinhood Dex"
                          className="w-full px-3.5 py-2 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="reg-entity-type"
                          className="block text-xs font-medium text-[#0C100C] mb-1"
                        >
                          Entity Class
                        </label>
                        <select
                          id="reg-entity-type"
                          value={newEntityType}
                          onChange={(e) =>
                            setNewEntityType(e.target.value as 'project' | 'wallet' | 'user')
                          }
                          className="w-full px-3.5 py-2 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
                        >
                          <option value="project">Project / Protocol</option>
                          <option value="wallet">Wallet Address</option>
                          <option value="user">Contributor / Individual</option>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="reg-entity-wallet"
                          className="block text-xs font-medium text-[#0C100C] mb-1"
                        >
                          Associated EVM Wallet (Optional)
                        </label>
                        <input
                          id="reg-entity-wallet"
                          type="text"
                          value={newEntityWallet}
                          onChange={(e) => setNewEntityWallet(e.target.value)}
                          placeholder="0x..."
                          className="w-full px-3.5 py-2 text-sm font-mono bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-entity-desc"
                        className="block text-xs font-medium text-[#0C100C] mb-1"
                      >
                        Short Description (Optional)
                      </label>
                      <input
                        id="reg-entity-desc"
                        type="text"
                        maxLength={400}
                        value={newEntityDescription}
                        onChange={(e) => setNewEntityDescription(e.target.value)}
                        placeholder="Factual summary of the protocol, smart contract, or contributor."
                        className="w-full px-3.5 py-2 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={registeringEntity}
                        className="px-4 py-2 text-xs font-semibold bg-[#0C100C] text-[#CCFF00] rounded-lg hover:bg-[#1A221B] disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {registeringEntity ? 'Registering...' : 'Create Entity'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRegisterEntityForm(false)}
                        className="px-3 py-2 text-xs font-medium text-[#535E54] hover:text-[#0C100C] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                <div className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-[#DCE3DC] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div
                      role="group"
                      aria-label="Filter entities by class"
                      className="inline-flex items-center p-1 bg-[#EEF2EC] rounded-lg self-start"
                    >
                      {(
                        [
                          { id: 'all', label: 'All' },
                          { id: 'project', label: 'Projects' },
                          { id: 'wallet', label: 'Wallets' },
                          { id: 'user', label: 'Contributors' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setEntityTypeFilter(t.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                            entityTypeFilter === t.id
                              ? 'bg-white text-[#0C100C] shadow-xs'
                              : 'text-[#535E54] hover:text-[#0C100C]'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    <div className="relative sm:w-64">
                      <Search
                        className="w-4 h-4 text-[#535E54] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={entitySearch}
                        onChange={(e) => setEntitySearch(e.target.value)}
                        placeholder="Search entities..."
                        aria-label="Search entities directory"
                        className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
                      />
                    </div>
                  </div>

                  {filteredDirectoryAtoms.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#535E54]">
                      No entities match your search filter.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#DCE3DC] text-[11px] font-semibold text-[#535E54]">
                            <th className="py-3 px-5">Entity</th>
                            <th className="py-3 px-4">Class &amp; Origin</th>
                            <th className="py-3 px-4 text-right">Verified On-Chain</th>
                            <th className="py-3 px-4 text-right">Off-Chain</th>
                            <th className="py-3 px-4 text-right">Signal</th>
                            <th className="py-3 px-5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#DCE3DC] text-sm">
                          {filteredDirectoryAtoms.map((atom) => (
                            <tr key={atom.id} className="hover:bg-[#F6F8F5]/70 transition-colors">
                              <td className="py-3.5 px-5 max-w-md">
                                <button
                                  type="button"
                                  onClick={() => openEntityProfile(atom.name)}
                                  className="font-semibold text-[#0C100C] hover:text-[#166B00] text-left cursor-pointer"
                                >
                                  {atom.displayName}
                                </button>
                                {atom.description && (
                                  <p className="text-xs text-[#535E54] truncate mt-0.5">
                                    {atom.description}
                                  </p>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-xs text-[#535E54] whitespace-nowrap">
                                <span className="capitalize text-[#0C100C] font-medium">
                                  {atom.type}
                                </span>{' '}
                                ·{' '}
                                {atom.origin_source === 'intuition'
                                  ? 'Intuition (Base)'
                                  : 'TrustGraph'}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#166B00]">
                                {atom.verifiedOnChainCount || 0}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#535E54]">
                                {atom.offChainCount || 0}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#0C100C]">
                                {atom.count && atom.average ? `${atom.average.toFixed(2)}/5` : '—'}
                              </td>
                              <td className="py-3.5 px-5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openEntityProfile(atom.name)}
                                    className="px-2.5 py-1 text-xs font-medium bg-[#F6F8F5] border border-[#DCE3DC] rounded-md text-[#0C100C] hover:bg-[#EEF2EC] cursor-pointer"
                                  >
                                    Inspect
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startAttestationFor(atom.displayName)}
                                    className="px-2.5 py-1 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-md hover:bg-[#B8E600] cursor-pointer"
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
            )}
          </div>
        )}

        {/* TAB 4: FULL ATTESTATION ACTIVITY LEDGER */}
        {activeTab === 'activity' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-[#0C100C] tracking-tight">
                Activity Ledger
              </h1>
              <p className="text-sm text-[#535E54] mt-0.5">
                Audit every on-chain receipt, wallet signature, community note, and revocation.
              </p>
            </div>

            <div className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden">
              <div className="p-4 border-b border-[#DCE3DC] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="Filter activity by provenance category"
                    className="inline-flex flex-wrap items-center p-1 bg-[#EEF2EC] rounded-lg gap-0.5"
                  >
                    {(
                      [
                        { id: 'all', label: 'All Sources' },
                        { id: 'onchain_verified', label: 'On-Chain (46630)' },
                        { id: 'offchain_signed', label: 'Wallet-Signed' },
                        { id: 'offchain_community', label: 'Community' },
                        { id: 'external_intuition', label: 'Intuition' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setActivityCategoryFilter(f.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          activityCategoryFilter === f.id
                            ? 'bg-white text-[#0C100C] shadow-xs'
                            : 'text-[#535E54] hover:text-[#0C100C]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowRevokedActivity((v) => !v)}
                    aria-pressed={showRevokedActivity}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      showRevokedActivity
                        ? 'bg-white border-[#DCE3DC] text-[#0C100C]'
                        : 'bg-[#F6F8F5] border-[#DCE3DC] text-[#535E54]'
                    }`}
                  >
                    {showRevokedActivity ? 'Showing Revoked' : 'Hiding Revoked'}
                  </button>
                </div>

                <div className="relative sm:w-64">
                  <Search
                    className="w-4 h-4 text-[#535E54] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="Filter by entity, wallet, tx..."
                    aria-label="Search attestation ledger"
                    className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
                  />
                </div>
              </div>

              {filteredActivity.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#535E54]">
                  No attestation records match the selected provenance filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE3DC] text-[11px] font-semibold text-[#535E54]">
                        <th className="py-3 px-5">Subject</th>
                        <th className="py-3 px-4">Score</th>
                        <th className="py-3 px-4">Attester</th>
                        <th className="py-3 px-4">Provenance</th>
                        <th className="py-3 px-4">Note</th>
                        <th className="py-3 px-5 text-right">Receipt / Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DCE3DC] text-xs">
                      {filteredActivity.map((att) => (
                        <tr
                          key={att.id}
                          className={`transition-colors ${
                            att.revoked ? 'bg-[#F6F8F5] opacity-75' : 'hover:bg-[#F6F8F5]/60'
                          }`}
                        >
                          <td className="py-3.5 px-5 font-semibold text-[#0C100C] whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openEntityProfile(att.to_entity)}
                              className="hover:text-[#166B00] underline cursor-pointer"
                            >
                              {att.to_entity}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums font-semibold whitespace-nowrap">
                            <span className={att.revoked ? 'line-through text-[#C93535]' : ''}>
                              {att.trust_score}/5
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[#0C100C] whitespace-nowrap">
                            {att.wallet_address
                              ? shortenAddress(att.wallet_address)
                              : `@${att.from_user}`}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
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
                          </td>
                          <td className="py-3.5 px-4 text-[#535E54] max-w-xs truncate">
                            {att.comment || '—'}
                          </td>
                          <td className="py-3.5 px-5 text-right whitespace-nowrap font-mono tabular-nums text-[#535E54]">
                            {att.verified_onchain && att.tx_hash ? (
                              <a
                                href={getExplorerTxUrl(att.tx_hash, explorerBaseUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[#0C100C] font-sans underline hover:text-[#166B00]"
                              >
                                Block #{att.block_number ?? '—'}
                                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                              </a>
                            ) : (
                              <span>{new Date(att.timestamp).toLocaleDateString()}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: TELEGRAM BRIDGE & NETWORK SYNC */}
        {activeTab === 'network' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-[#0C100C] tracking-tight">
                Telegram &amp; Chain Sync
              </h1>
              <p className="text-sm text-[#535E54] mt-0.5">
                Link your EVM wallet to @trustmvpbot and synchronize Robinhood Chain or Intuition
                Protocol records.
              </p>
            </div>

            <NetworkAndBotView
              walletAddress={walletAddress}
              walletChainId={walletChainId}
              networkStatus={networkStatus}
              indexerState={indexerState}
              onConnectWallet={handleConnectWallet}
              onSwitchNetwork={handleSwitchToRobinhoodChain}
              onRefreshAll={refreshAllData}
              onNotify={pushToast}
            />
          </div>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="bg-white border-t border-[#DCE3DC] mt-12">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#535E54]">
          <div>
            TrustGraph — Independent Open-Source Reputation Protocol on Robinhood Chain Testnet
            (46630).
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setViewMode('landing');
                if (typeof window !== 'undefined') {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              className="hover:text-[#0C100C] underline cursor-pointer"
            >
              Protocol Guide
            </button>
            <a
              href={explorerBaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#0C100C] underline"
            >
              Robinhood Testnet Explorer
            </a>
            <a
              href="https://t.me/trustmvpbot"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#0C100C] underline"
            >
              Telegram @trustmvpbot
            </a>
          </div>
        </div>
      </footer>

      {/* Accessible Toast Region */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full px-4 sm:px-0"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`p-4 rounded-xl border shadow-md bg-white flex items-start justify-between gap-3 text-xs ${
                t.tone === 'error'
                  ? 'border-[#E8B0B0]'
                  : t.tone === 'warning'
                  ? 'border-[#E6CE8A]'
                  : t.tone === 'success'
                  ? 'border-[#A5E199]'
                  : 'border-[#DCE3DC]'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {t.tone === 'success' ? (
                  <CheckCircle2
                    className="w-4 h-4 text-[#166B00] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                ) : t.tone === 'error' || t.tone === 'warning' ? (
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      t.tone === 'error' ? 'text-[#C93535]' : 'text-[#B87B0E]'
                    }`}
                    aria-hidden="true"
                  />
                ) : null}
                <div>
                  <div className="font-semibold text-[#0C100C]">{t.title}</div>
                  {t.description && <p className="text-[#535E54] mt-0.5">{t.description}</p>}
                  {t.linkUrl && (
                    <a
                      href={t.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 font-semibold text-[#166B00] underline mt-1.5"
                    >
                      <span>{t.linkLabel || 'Open Explorer'}</span>
                      <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss notification"
                className="text-[#535E54] hover:text-[#0C100C] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
