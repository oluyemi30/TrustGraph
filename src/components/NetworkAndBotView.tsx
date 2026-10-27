import React, { useEffect, useState } from 'react';
import { BrowserProvider } from 'ethers';
import {
  ArrowUpRight,
  Check,
  Copy,
  Link2,
  RefreshCw,
  Send,
  Unlink,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  ROBINHOOD_TESTNET,
  getExplorerAddressUrl,
  getInjectedEthereumProvider,
  parseWalletError,
  shortenAddress,
} from '../lib/robinhoodChain';
import { IndexerState, RobinhoodNetworkStatus, ToastNotice } from '../types';

interface NetworkAndBotViewProps {
  walletAddress: string | null;
  walletChainId: number | null;
  networkStatus: RobinhoodNetworkStatus | null;
  indexerState: IndexerState | null;
  onConnectWallet: () => Promise<void>;
  onSwitchNetwork: () => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onNotify: (notice: Omit<ToastNotice, 'id'>) => void;
}

interface BotChatEntry {
  id: string;
  sender: 'user' | 'bot';
  content: string;
  timestamp: string;
}

function renderSanitizedTelegramHtml(rawHtml: string): React.ReactNode {
  const lines = rawHtml.split('\n');
  return lines.map((line, idx) => {
    const cleanText = line
      .replace(/<b>(.*?)<\/b>/g, '$1')
      .replace(/<i>(.*?)<\/i>/g, '$1')
      .replace(/<code>(.*?)<\/code>/g, '$1')
      .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/g, '$2 ($1)')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    return (
      <div key={idx} className={cleanText.trim() === '' ? 'h-2' : 'leading-relaxed'}>
        {cleanText}
      </div>
    );
  });
}

export const NetworkAndBotView: React.FC<NetworkAndBotViewProps> = ({
  walletAddress,
  walletChainId,
  networkStatus,
  onConnectWallet,
  onSwitchNetwork,
  onRefreshAll,
  onNotify,
}) => {
  const [syncingRobinhood, setSyncingRobinhood] = useState(false);
  const [syncingIntuition, setSyncingIntuition] = useState(false);

  // Telegram Nonce Wallet Linking State
  const [linkedTelegramHandle, setLinkedTelegramHandle] = useState<string | null>(null);
  const [activationCode, setActivationCode] = useState<string | null>(null);
  const [linkingBusy, setLinkingBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Bot Command Preview State
  const [botInput, setBotInput] = useState('');
  const [botBusy, setBotBusy] = useState(false);
  const [botMessages, setBotMessages] = useState<BotChatEntry[]>([
    {
      id: 'welcome',
      sender: 'bot',
      content:
        'Preview @trustmvpbot responses here before opening Telegram.\nTry /start, /entities, /trust Ethereum, or /wallet.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);

  // Advanced Custom API Gateway URL (preserved for split static/backend hosting)
  const [customApiUrl, setCustomApiUrl] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('TRUSTGRAPH_API_URL') || '' : ''
  );

  useEffect(() => {
    let active = true;
    async function checkLinkStatus() {
      if (!walletAddress) {
        setLinkedTelegramHandle(null);
        setActivationCode(null);
        return;
      }
      try {
        const res = await apiFetch<{
          success: boolean;
          linked: boolean;
          telegramUser: string | null;
        }>(`/api/telegram/status/${encodeURIComponent(walletAddress)}`);
        if (active) {
          setLinkedTelegramHandle(res.linked ? res.telegramUser : null);
        }
      } catch {
        if (active) setLinkedTelegramHandle(null);
      }
    }
    checkLinkStatus();
    return () => {
      active = false;
    };
  }, [walletAddress]);

  const handleSyncRobinhood = async () => {
    setSyncingRobinhood(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        result: {
          synced: boolean;
          fromBlock: number;
          toBlock: number;
          newlyIndexed: number;
          revocationsProcessed: number;
          warning?: string;
        };
      }>('/api/robinhood/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.result.synced) {
        onNotify({
          tone: 'warning',
          title: 'Sync Notice',
          description:
            res.result.warning || 'On-chain registry contract is awaiting testnet configuration.',
        });
      } else {
        onNotify({
          tone: 'success',
          title: 'Robinhood Chain Synchronized',
          description: `Scanned blocks #${res.result.fromBlock} to #${res.result.toBlock} (${res.result.newlyIndexed} new attestations).`,
        });
      }
      await onRefreshAll();
    } catch (err: any) {
      onNotify({
        tone: 'error',
        title: 'Sync Error',
        description: err?.message || 'Unable to reach Robinhood Chain Testnet RPC.',
      });
    } finally {
      setSyncingRobinhood(false);
    }
  };

  const handleGenerateSignedLinkCode = async () => {
    const eth = getInjectedEthereumProvider();
    if (!eth || !walletAddress) {
      await onConnectWallet();
      return;
    }

    setLinkingBusy(true);
    try {
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
          purpose: 'link_wallet',
        }),
      });

      const signature = await signer.signMessage(nonceRes.message);

      const codeRes = await apiFetch<{ success: boolean; code: string }>(
        '/api/telegram/generate-code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: signerAddress,
            nonce: nonceRes.nonce,
            signature,
          }),
        }
      );

      setActivationCode(codeRes.code);
      onNotify({
        tone: 'success',
        title: 'Activation Code Ready',
        description: `Send /activate ${codeRes.code} to @trustmvpbot within 10 minutes.`,
      });
    } catch (err: any) {
      const parsed = parseWalletError(err);
      onNotify({
        tone: parsed.isUserRejected ? 'warning' : 'error',
        title: parsed.isUserRejected ? 'Signature Cancelled' : 'Verification Failed',
        description: parsed.message,
      });
    } finally {
      setLinkingBusy(false);
    }
  };

  const handleUnlinkWallet = async () => {
    const eth = getInjectedEthereumProvider();
    if (!eth || !walletAddress) return;

    setLinkingBusy(true);
    try {
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
          purpose: 'unlink_wallet',
        }),
      });

      const signature = await signer.signMessage(nonceRes.message);

      await apiFetch('/api/telegram/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: signerAddress,
          nonce: nonceRes.nonce,
          signature,
        }),
      });

      setLinkedTelegramHandle(null);
      setActivationCode(null);
      onNotify({
        tone: 'info',
        title: 'Telegram Handle Unlinked',
        description: 'Wallet link removed. Existing attestation history remains intact.',
      });
      await onRefreshAll();
    } catch (err: any) {
      const parsed = parseWalletError(err);
      onNotify({
        tone: 'error',
        title: 'Unlink Failed',
        description: parsed.message,
      });
    } finally {
      setLinkingBusy(false);
    }
  };

  const handleCopyCommand = async () => {
    if (!activationCode) return;
    try {
      await navigator.clipboard.writeText(`/activate ${activationCode}`);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const sendSimulatorCommand = async (rawCommand: string) => {
    const cmd = rawCommand.trim();
    if (!cmd || botBusy) return;

    setBotMessages((prev) => [
      ...prev,
      {
        id: `u_${Date.now()}`,
        sender: 'user',
        content: cmd,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    setBotInput('');
    setBotBusy(true);

    try {
      const res = await apiFetch<{ success: boolean; reply: string }>('/api/bot/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cmd,
          fromUser: linkedTelegramHandle || 'web_operator',
        }),
      });

      setBotMessages((prev) => [
        ...prev,
        {
          id: `b_${Date.now()}`,
          sender: 'bot',
          content: res.reply,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);

      if (cmd.startsWith('/attest') || cmd.startsWith('/activate') || cmd.startsWith('/sync')) {
        await onRefreshAll();
      }
    } catch (err: any) {
      setBotMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          sender: 'bot',
          content: `Unable to reach bot service: ${err?.message || 'Request failed'}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setBotBusy(false);
    }
  };

  const handleSyncIntuition = async () => {
    setSyncingIntuition(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        stats: {
          synced: boolean;
          message: string;
        };
      }>('/api/sync-intuition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowSampleFallback: false }),
      });

      onNotify({
        tone: res.stats.synced ? 'success' : 'warning',
        title: res.stats.synced ? 'Intuition Sync Complete' : 'Intuition Endpoint Unavailable',
        description: res.stats.message,
      });
      await onRefreshAll();
    } catch (err: any) {
      onNotify({
        tone: 'error',
        title: 'Sync Error',
        description: err?.message || 'Failed to query Intuition Protocol.',
      });
    } finally {
      setSyncingIntuition(false);
    }
  };

  const handleSaveApiGateway = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customApiUrl.trim();
    if (trimmed) {
      localStorage.setItem('TRUSTGRAPH_API_URL', trimmed);
      onNotify({
        tone: 'success',
        title: 'API Gateway Updated',
        description: `Routing API requests through ${trimmed}.`,
      });
    } else {
      localStorage.removeItem('TRUSTGRAPH_API_URL');
      onNotify({
        tone: 'info',
        title: 'API Gateway Reset',
        description: 'Using default full-stack server routes.',
      });
    }
    onRefreshAll();
  };

  const explorerUrl = networkStatus?.explorerUrl || ROBINHOOD_TESTNET.blockExplorerUrls[0];

  return (
    <div className="space-y-6">
      {/* Row 1: Telegram Wallet Link + Network Synchronization */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Card 1: Telegram Bot Wallet Link (Primary User Workflow) */}
        <section
          aria-labelledby="telegram-bridge-heading"
          className="lg:col-span-6 bg-white border border-[#DCE3DC] rounded-xl p-6 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#DCE3DC]">
              <div>
                <h2 id="telegram-bridge-heading" className="text-base font-semibold text-[#0C100C]">
                  Link Wallet to Telegram (@trustmvpbot)
                </h2>
                <p className="text-xs text-[#535E54] mt-0.5">
                  Sign a one-time wallet challenge to pair your EVM address with Telegram.
                </p>
              </div>
              <a
                href="https://t.me/trustmvpbot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[#0C100C] text-[#CCFF00] rounded-lg hover:bg-[#1A221B] transition-colors whitespace-nowrap shrink-0"
              >
                <span>Open @trustmvpbot</span>
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>

            {!walletAddress ? (
              <div className="p-4 rounded-lg bg-[#F6F8F5] border border-[#DCE3DC] text-xs space-y-3">
                <p className="text-[#535E54]">
                  Connect your EVM wallet to generate a verified 10-minute{' '}
                  <code className="font-mono text-[#0C100C]">/activate</code> code for{' '}
                  <a
                    href="https://t.me/trustmvpbot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0C100C] font-medium underline"
                  >
                    t.me/trustmvpbot
                  </a>
                  .
                </p>
                <button
                  type="button"
                  onClick={onConnectWallet}
                  className="px-4 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] transition-colors cursor-pointer"
                >
                  Connect Wallet
                </button>
              </div>
            ) : linkedTelegramHandle ? (
              <div className="p-4 rounded-lg bg-[#ECFCE8] border border-[#A5E199] text-xs space-y-3">
                <div>
                  <div className="font-semibold text-[#0D3B04]">
                    Linked to @{linkedTelegramHandle}
                  </div>
                  <p className="text-[#19540D] mt-1 font-mono">{walletAddress}</p>
                </div>
                <button
                  type="button"
                  disabled={linkingBusy}
                  onClick={handleUnlinkWallet}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[#DCE3DC] text-[#9E2424] rounded-lg hover:bg-[#FFF5F5] transition-colors cursor-pointer"
                >
                  <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{linkingBusy ? 'Unlinking...' : 'Unlink Wallet'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <p className="text-[#535E54]">
                  Connected as{' '}
                  <code className="font-mono text-[#0C100C]">{shortenAddress(walletAddress)}</code>.
                  Sign a single-use nonce message to prove ownership without paying gas.
                </p>

                <button
                  type="button"
                  disabled={linkingBusy}
                  onClick={handleGenerateSignedLinkCode}
                  className="w-full py-2.5 px-4 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Link2 className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {linkingBusy ? 'Awaiting Signature...' : 'Sign & Generate Activation Code'}
                  </span>
                </button>

                {activationCode && (
                  <div className="p-3.5 rounded-lg bg-[#F6F8F5] border border-[#DCE3DC] space-y-2">
                    <div className="text-[#535E54]">
                      Send this command to{' '}
                      <a
                        href="https://t.me/trustmvpbot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0C100C] font-medium underline"
                      >
                        @trustmvpbot
                      </a>{' '}
                      within 10 minutes:
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-white border border-[#DCE3DC] rounded-lg px-3 py-2">
                      <code className="font-mono font-semibold text-sm text-[#0C100C]">
                        /activate {activationCode}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyCommand}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#0C100C] hover:text-[#166B00] cursor-pointer"
                      >
                        {copiedCode ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#166B00]" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="text-[11px] text-[#535E54] pt-4 border-t border-[#DCE3DC] mt-4">
            @trustmvpbot never requests private keys or seed phrases.
          </p>
        </section>

        {/* Card 2: Robinhood Chain & External Data Sync */}
        <section
          aria-labelledby="rh-network-heading"
          className="lg:col-span-6 bg-white border border-[#DCE3DC] rounded-xl p-6 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#DCE3DC]">
              <div>
                <h2 id="rh-network-heading" className="text-base font-semibold text-[#0C100C]">
                  Chain &amp; External Protocol Sync
                </h2>
                <p className="text-xs text-[#535E54] mt-0.5">
                  Synchronize Robinhood Chain Testnet receipts and optional Intuition Protocol data.
                </p>
              </div>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#0C100C] underline hover:text-[#166B00] whitespace-nowrap shrink-0"
              >
                Explorer
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>

            <dl className="divide-y divide-[#DCE3DC] text-xs">
              <div className="py-2.5 flex items-center justify-between gap-4">
                <dt className="text-[#535E54]">Target Network</dt>
                <dd className="font-mono tabular-nums font-medium text-[#0C100C]">
                  Robinhood Chain Testnet (46630 · ETH)
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-4">
                <dt className="text-[#535E54]">RPC Status</dt>
                <dd className="font-mono tabular-nums font-medium text-[#0C100C]">
                  {networkStatus?.rpcConnected
                    ? `Online · Block #${networkStatus.latestBlock?.toLocaleString() ?? '—'}`
                    : 'Connecting...'}
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-4">
                <dt className="text-[#535E54]">Registry Contract</dt>
                <dd className="font-mono text-[#0C100C]">
                  {networkStatus?.registryAddress ? (
                    <a
                      href={getExplorerAddressUrl(networkStatus.registryAddress, explorerUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-[#166B00] inline-flex items-center gap-1"
                    >
                      {shortenAddress(networkStatus.registryAddress, 8, 6)}
                      <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="font-sans text-[#535E54]">Awaiting deployment</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          <div className="pt-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleSyncRobinhood}
                disabled={syncingRobinhood}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#CCFF00] text-[#0C100C] rounded-lg hover:bg-[#B8E600] disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingRobinhood ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{syncingRobinhood ? 'Syncing Chain...' : 'Sync Robinhood Chain'}</span>
              </button>

              <button
                type="button"
                onClick={handleSyncIntuition}
                disabled={syncingIntuition}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#F6F8F5] border border-[#DCE3DC] text-[#0C100C] rounded-lg hover:bg-[#EEF2EC] disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingIntuition ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{syncingIntuition ? 'Importing...' : 'Import Intuition (Base)'}</span>
              </button>

              {walletAddress && walletChainId !== ROBINHOOD_TESTNET.chainId && (
                <button
                  type="button"
                  onClick={onSwitchNetwork}
                  className="px-3.5 py-2 text-xs font-medium bg-[#0C100C] text-white rounded-lg hover:bg-[#1A221B] transition-colors whitespace-nowrap cursor-pointer"
                >
                  Switch Wallet to 46630
                </button>
              )}
            </div>
            <p className="text-[11px] text-[#535E54]">
              Supplementary Intuition imports remain tagged with Base origin and never mix into
              Robinhood Chain counts.
            </p>
          </div>
        </section>
      </div>

      {/* Row 2: Clean Bot Command Preview */}
      <section
        aria-labelledby="bot-simulator-heading"
        className="bg-white border border-[#DCE3DC] rounded-xl overflow-hidden"
      >
        <div className="p-5 border-b border-[#DCE3DC] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 id="bot-simulator-heading" className="text-base font-semibold text-[#0C100C]">
              Try @trustmvpbot Commands
            </h2>
            <p className="text-xs text-[#535E54]">
              Preview live bot queries directly in your browser.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {['/start', '/entities', '/trust Ethereum', '/wallet', '/sync'].map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => sendSimulatorCommand(cmd)}
                disabled={botBusy}
                className="px-2.5 py-1 text-xs font-mono bg-[#F6F8F5] border border-[#DCE3DC] rounded-md text-[#0C100C] hover:bg-[#EEF2EC] transition-colors whitespace-nowrap cursor-pointer"
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 bg-[#F6F8F5] max-h-[300px] overflow-y-auto space-y-3 text-xs">
          {botMessages.map((msg) => (
            <div
              key={msg.id}
              className={`p-3.5 rounded-lg border ${
                msg.sender === 'user'
                  ? 'bg-[#0C100C] border-[#0C100C] text-white ml-auto max-w-xl'
                  : 'bg-white border-[#DCE3DC] text-[#0C100C] mr-auto max-w-2xl'
              }`}
            >
              <div
                className={`text-[10px] mb-1 tabular-nums ${
                  msg.sender === 'user' ? 'text-[#CCFF00]' : 'text-[#535E54]'
                }`}
              >
                {msg.sender === 'user' ? 'You' : '@trustmvpbot'} · {msg.timestamp}
              </div>
              <div>
                {msg.sender === 'bot' ? renderSanitizedTelegramHtml(msg.content) : msg.content}
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendSimulatorCommand(botInput);
          }}
          className="p-4 bg-white border-t border-[#DCE3DC] flex items-center gap-2"
        >
          <input
            type="text"
            value={botInput}
            onChange={(e) => setBotInput(e.target.value)}
            placeholder="Run a bot command (e.g., /trust Ethereum)"
            aria-label="Telegram bot command"
            className="flex-1 px-3.5 py-2 text-sm font-mono bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
          />
          <button
            type="submit"
            disabled={botBusy || !botInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0C100C] text-[#CCFF00] rounded-lg hover:bg-[#1A221B] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{botBusy ? 'Running...' : 'Send'}</span>
          </button>
        </form>
      </section>

      {/* Quiet Collapsible Advanced Settings (Hidden by Default to Keep UI Clean) */}
      <details className="bg-white border border-[#DCE3DC] rounded-xl p-4 text-xs text-[#535E54]">
        <summary className="cursor-pointer font-medium text-[#0C100C] select-none">
          Advanced Connection Settings (Custom Backend API URL)
        </summary>
        <form onSubmit={handleSaveApiGateway} className="mt-3 space-y-2.5">
          <p>
            Only needed if hosting the static frontend separately from your Express server. Leave
            blank for standard full-stack deployments.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              value={customApiUrl}
              onChange={(e) => setCustomApiUrl(e.target.value)}
              placeholder="https://your-trustgraph-backend.example.com"
              aria-label="Custom Backend API URL"
              className="flex-1 px-3.5 py-2 text-xs font-mono bg-[#F6F8F5] border border-[#DCE3DC] rounded-lg text-[#0C100C] focus:bg-white"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-[#0C100C] text-white rounded-lg hover:bg-[#1A221B] whitespace-nowrap cursor-pointer"
            >
              Save URL
            </button>
            {customApiUrl && (
              <button
                type="button"
                onClick={() => {
                  setCustomApiUrl('');
                  localStorage.removeItem('TRUSTGRAPH_API_URL');
                  onRefreshAll();
                }}
                className="px-3 py-2 text-xs font-medium text-[#535E54] hover:text-[#0C100C] cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </form>
      </details>
    </div>
  );
};
