import { FetchRequest, JsonRpcProvider, Network, formatUnits, isAddress } from 'ethers';
import { ROBINHOOD_TESTNET } from '../../src/lib/robinhoodChain';

export interface RobinhoodConfig {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  registryAddress: string | null;
}

export interface RobinhoodNetworkStatus {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  nativeCurrency: typeof ROBINHOOD_TESTNET.nativeCurrency;
  rpcUrl: string;
  explorerUrl: string;
  registryAddress: string | null;
  rpcConnected: boolean;
  rpcReportedChainId: number | null;
  chainMatchesExpected: boolean;
  latestBlock: number | null;
  gasPriceGwei: string | null;
  contractDeployed: boolean;
  error?: string;
}

export function getRobinhoodConfig(overrides?: {
  rpcUrl?: string;
  registryAddress?: string;
  explorerUrl?: string;
}): RobinhoodConfig {
  const rawChainId = Number(process.env.RH_CHAIN_ID || ROBINHOOD_TESTNET.chainId);
  const chainId = Number.isFinite(rawChainId) && rawChainId > 0 ? rawChainId : ROBINHOOD_TESTNET.chainId;

  const rpcUrl = (overrides?.rpcUrl || process.env.RH_RPC_URL || ROBINHOOD_TESTNET.rpcUrls[0]).trim();
  const explorerUrl = (
    overrides?.explorerUrl ||
    process.env.RH_EXPLORER_URL ||
    ROBINHOOD_TESTNET.blockExplorerUrls[0]
  )
    .trim()
    .replace(/\/$/, '');

  const rawRegistry = (
    overrides?.registryAddress ??
    process.env.RH_REGISTRY_ADDRESS ??
    process.env.VITE_RH_REGISTRY_ADDRESS ??
    ''
  ).trim();

  const registryAddress = rawRegistry && isAddress(rawRegistry) ? rawRegistry : null;

  return {
    chainId,
    chainIdHex: `0x${chainId.toString(16)}`,
    chainName: ROBINHOOD_TESTNET.chainName,
    rpcUrl,
    explorerUrl,
    registryAddress,
  };
}

export function validateStartupEnvironment(): { warnings: string[] } {
  const warnings: string[] = [];
  const cfg = getRobinhoodConfig();

  if (cfg.chainId !== ROBINHOOD_TESTNET.chainId) {
    warnings.push(
      `RH_CHAIN_ID is set to ${cfg.chainId}, which differs from Robinhood Chain Testnet (${ROBINHOOD_TESTNET.chainId}).`
    );
  }

  try {
    const parsedUrl = new URL(cfg.rpcUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      warnings.push(`RH_RPC_URL uses unsupported protocol "${parsedUrl.protocol}".`);
    }
  } catch {
    warnings.push(`RH_RPC_URL "${cfg.rpcUrl}" is not a valid URL.`);
  }

  const rawRegistry = (process.env.RH_REGISTRY_ADDRESS || '').trim();
  if (!rawRegistry) {
    warnings.push(
      'RH_REGISTRY_ADDRESS is not set yet. Deploy contracts/TrustGraphRegistry.sol via `npm run deploy:testnet` and configure RH_REGISTRY_ADDRESS to enable live on-chain attestations.'
    );
  } else if (!isAddress(rawRegistry)) {
    warnings.push(`RH_REGISTRY_ADDRESS "${rawRegistry}" is not a valid EVM address and will be ignored.`);
  }

  if (process.env.VITE_DEPLOYER_PRIVATE_KEY || process.env.VITE_PRIVATE_KEY) {
    throw new Error(
      'SECURITY VIOLATION: Private key detected in a VITE_* frontend environment variable. Remove it immediately.'
    );
  }

  return { warnings };
}

export function createRobinhoodProvider(rpcUrlOverride?: string): JsonRpcProvider {
  const cfg = getRobinhoodConfig({ rpcUrl: rpcUrlOverride });
  const req = new FetchRequest(cfg.rpcUrl);
  req.timeout = 10_000;
  const staticNet = Network.from({
    name: 'robinhood-chain-testnet',
    chainId: cfg.chainId,
  });
  return new JsonRpcProvider(req, staticNet, { staticNetwork: staticNet });
}

export async function withRpcRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 450
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '').toLowerCase();
      const isRetryable =
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('timeout') ||
        msg.includes('network error') ||
        msg.includes('econnreset') ||
        msg.includes('502') ||
        msg.includes('503');

      if (!isRetryable || attempt === maxAttempts) {
        break;
      }
      const jitter = Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1) + jitter));
    }
  }
  throw lastError;
}

export async function getRobinhoodNetworkStatus(overrides?: {
  rpcUrl?: string;
  registryAddress?: string;
}): Promise<RobinhoodNetworkStatus> {
  const cfg = getRobinhoodConfig(overrides);

  try {
    // Use an unpinned provider briefly to verify actual chainId returned by RPC
    const req = new FetchRequest(cfg.rpcUrl);
    req.timeout = 8_000;
    const probeProvider = new JsonRpcProvider(req);

    const [networkHex, blockNumber, feeData] = await withRpcRetry(() =>
      Promise.all([
        probeProvider.send('eth_chainId', []),
        probeProvider.getBlockNumber(),
        probeProvider.getFeeData().catch(() => null),
      ])
    );

    const reportedChainId =
      typeof networkHex === 'string' ? parseInt(networkHex, 16) : Number(networkHex);
    const chainMatchesExpected = reportedChainId === ROBINHOOD_TESTNET.chainId;

    let contractDeployed = false;
    if (cfg.registryAddress && chainMatchesExpected) {
      const code = await withRpcRetry(() => probeProvider.getCode(cfg.registryAddress!));
      contractDeployed = Boolean(code && code !== '0x' && code !== '0x0');
    }

    const gasPriceWei = feeData?.gasPrice ?? feeData?.maxFeePerGas ?? null;
    const gasPriceGwei = gasPriceWei !== null ? formatUnits(gasPriceWei, 'gwei') : null;

    return {
      chainId: ROBINHOOD_TESTNET.chainId,
      chainIdHex: ROBINHOOD_TESTNET.chainIdHex,
      chainName: ROBINHOOD_TESTNET.chainName,
      nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
      rpcUrl: cfg.rpcUrl,
      explorerUrl: cfg.explorerUrl,
      registryAddress: cfg.registryAddress,
      rpcConnected: true,
      rpcReportedChainId: reportedChainId,
      chainMatchesExpected,
      latestBlock: blockNumber,
      gasPriceGwei,
      contractDeployed,
    };
  } catch (err: any) {
    return {
      chainId: ROBINHOOD_TESTNET.chainId,
      chainIdHex: ROBINHOOD_TESTNET.chainIdHex,
      chainName: ROBINHOOD_TESTNET.chainName,
      nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
      rpcUrl: cfg.rpcUrl,
      explorerUrl: cfg.explorerUrl,
      registryAddress: cfg.registryAddress,
      rpcConnected: false,
      rpcReportedChainId: null,
      chainMatchesExpected: false,
      latestBlock: null,
      gasPriceGwei: null,
      contractDeployed: false,
      error: err?.message ? String(err.message).slice(0, 160) : 'RPC unreachable',
    };
  }
}
