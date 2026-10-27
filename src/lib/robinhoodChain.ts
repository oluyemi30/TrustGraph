import { ZeroHash, isAddress, keccak256, toUtf8Bytes } from 'ethers';

export const ROBINHOOD_TESTNET = {
  chainId: 46630,
  chainIdHex: "0xb626",
  chainName: "Robinhood Chain Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: [
    "https://rpc.testnet.chain.robinhood.com",
  ],
  blockExplorerUrls: [
    "https://explorer.testnet.chain.robinhood.com",
  ],
};

export function getClientRpcUrl(): string {
  const envRpc =
    typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_RH_RPC_URL
      ? String((import.meta as any).env.VITE_RH_RPC_URL).trim()
      : '';
  return envRpc || ROBINHOOD_TESTNET.rpcUrls[0];
}

export function getClientExplorerUrl(): string {
  const envExplorer =
    typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_RH_EXPLORER_URL
      ? String((import.meta as any).env.VITE_RH_EXPLORER_URL).trim()
      : '';
  return (envExplorer || ROBINHOOD_TESTNET.blockExplorerUrls[0]).replace(/\/$/, '');
}

export function getClientRegistryAddress(serverProvidedAddress?: string | null): string {
  if (serverProvidedAddress && isAddress(serverProvidedAddress.trim())) {
    return serverProvidedAddress.trim();
  }
  const envAddr =
    typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_RH_REGISTRY_ADDRESS
      ? String((import.meta as any).env.VITE_RH_REGISTRY_ADDRESS).trim()
      : '';
  return isAddress(envAddr) ? envAddr : '';
}

export function normalizeSubjectKey(entityName: string): string {
  return (entityName || '').trim().toLowerCase();
}

/**
 * Computes a stable, privacy-preserving bytes32 subject identifier from a normalized entity key.
 * No personal data or raw PII is placed on-chain.
 */
export function computeSubjectId(entityName: string): string {
  const normalized = normalizeSubjectKey(entityName);
  if (!normalized) {
    return ZeroHash;
  }
  return keccak256(toUtf8Bytes(`trustgraph:subject:v1:${normalized}`));
}

/**
 * Computes a deterministic bytes32 hash of canonical supporting evidence.
 * Returns ZeroHash if no supporting explanation text is provided.
 */
export function computeEvidenceHash(entityName: string, score: number, comment: string): string {
  const cleanComment = (comment || '').trim();
  if (!cleanComment) {
    return ZeroHash;
  }
  const canonicalPayload = JSON.stringify({
    v: 1,
    subject: normalizeSubjectKey(entityName),
    score: Number(score),
    comment: cleanComment,
  });
  return keccak256(toUtf8Bytes(canonicalPayload));
}

export function shortenAddress(address?: string | null, prefixLen = 6, suffixLen = 4): string {
  if (!address) return '';
  const clean = address.trim();
  if (clean.length <= prefixLen + suffixLen + 2) return clean;
  return `${clean.slice(0, prefixLen)}...${clean.slice(-suffixLen)}`;
}

export function getExplorerTxUrl(txHash: string, baseExplorerUrl?: string): string {
  const base = (baseExplorerUrl || getClientExplorerUrl()).replace(/\/$/, '');
  return `${base}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string, baseExplorerUrl?: string): string {
  const base = (baseExplorerUrl || getClientExplorerUrl()).replace(/\/$/, '');
  return `${base}/address/${address}`;
}

export function getInjectedEthereumProvider(): any | null {
  if (typeof window === 'undefined') return null;
  let eth = (window as any).ethereum;
  if (!eth) return null;

  if (eth.providers && Array.isArray(eth.providers) && eth.providers.length > 0) {
    const preferred =
      eth.providers.find((p: any) => p.isMetaMask) ||
      eth.providers.find((p: any) => p.isCoinbaseWallet) ||
      eth.providers[0];
    return preferred || eth;
  }
  return eth;
}

export function getWalletProviderLabel(eth: any): string {
  if (!eth) return 'No Wallet';
  if (eth.isRabby) return 'Rabby Wallet';
  if (eth.isMetaMask) return 'MetaMask';
  if (eth.isCoinbaseWallet) return 'Coinbase Wallet';
  if (eth.isBraveWallet) return 'Brave Wallet';
  return 'EVM Wallet';
}

export async function readWalletChainId(eth: any): Promise<number | null> {
  if (!eth) return null;
  try {
    const hexChainId = await eth.request({ method: 'eth_chainId' });
    if (typeof hexChainId === 'string') {
      return parseInt(hexChainId, 16);
    }
    if (typeof hexChainId === 'number') {
      return hexChainId;
    }
    return null;
  } catch {
    return null;
  }
}

export async function switchOrAddRobinhoodChain(eth: any): Promise<void> {
  if (!eth) {
    throw new Error('No compatible EVM browser wallet found.');
  }

  const rpcUrl = getClientRpcUrl();
  const explorerUrl = getClientExplorerUrl();

  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ROBINHOOD_TESTNET.chainIdHex }],
    });
  } catch (switchErr: any) {
    const code = switchErr?.code ?? switchErr?.data?.originalError?.code;
    const msg = String(switchErr?.message || '').toLowerCase();
    const isUnrecognizedChain =
      code === 4902 ||
      msg.includes('unrecognized chain') ||
      msg.includes('not been added') ||
      msg.includes('unknown chain');

    if (isUnrecognizedChain) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: ROBINHOOD_TESTNET.chainIdHex,
            chainName: ROBINHOOD_TESTNET.chainName,
            nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
            rpcUrls: [rpcUrl],
            blockExplorerUrls: [explorerUrl],
          },
        ],
      });
      return;
    }
    throw switchErr;
  }
}

export function parseWalletError(err: any): { isUserRejected: boolean; message: string } {
  const code = err?.code ?? err?.info?.error?.code;
  const rawMessage = String(err?.shortMessage || err?.reason || err?.message || 'Wallet operation failed');

  if (
    code === 4001 ||
    code === 'ACTION_REJECTED' ||
    rawMessage.toLowerCase().includes('user rejected') ||
    rawMessage.toLowerCase().includes('user denied')
  ) {
    return {
      isUserRejected: true,
      message: 'Request was rejected in your wallet.',
    };
  }

  if (rawMessage.toLowerCase().includes('insufficient funds')) {
    return {
      isUserRejected: false,
      message: 'Insufficient Robinhood Chain Testnet ETH to cover gas fees.',
    };
  }

  return {
    isUserRejected: false,
    message: rawMessage.length > 180 ? `${rawMessage.slice(0, 177)}...` : rawMessage,
  };
}
