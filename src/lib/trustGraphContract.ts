import { BrowserProvider, Contract, formatEther, isAddress } from 'ethers';
import { TRUSTGRAPH_REGISTRY_ABI } from './trustGraphAbi';
import {
  ROBINHOOD_TESTNET,
  computeEvidenceHash,
  computeSubjectId,
  getExplorerTxUrl,
  parseWalletError,
} from './robinhoodChain';

export type TransactionLifecycleState =
  | 'wallet_disconnected'
  | 'wrong_network'
  | 'contract_not_deployed'
  | 'ready'
  | 'awaiting_approval'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'rejected';

export interface SubmittedAttestationResult {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  attestationId: string;
  subjectId: string;
  evidenceHash: string;
  attester: string;
  score: number;
  createdAt: number;
  supersededAttestationId?: string;
  explorerUrl: string;
}

export interface SubmittedRevocationResult {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  attestationId: string;
  subjectId: string;
  attester: string;
  revokedAt: number;
  explorerUrl: string;
}

export interface GasFeeEstimate {
  gasLimit: string;
  estimatedFeeEth: string;
}

export async function isRegistryContractDeployed(
  ethProvider: any,
  registryAddress: string
): Promise<boolean> {
  if (!ethProvider || !registryAddress || !isAddress(registryAddress)) {
    return false;
  }
  try {
    const provider = new BrowserProvider(ethProvider);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== ROBINHOOD_TESTNET.chainId) {
      return false;
    }
    const code = await provider.getCode(registryAddress);
    return Boolean(code && code !== '0x' && code !== '0x0');
  } catch {
    return false;
  }
}

export async function estimateAttestationNetworkFee(params: {
  ethProvider: any;
  registryAddress: string;
  entityName: string;
  score: number;
  comment: string;
}): Promise<GasFeeEstimate | null> {
  const { ethProvider, registryAddress, entityName, score, comment } = params;
  if (!ethProvider || !registryAddress || !isAddress(registryAddress)) return null;
  if (!entityName.trim() || score < 1 || score > 5) return null;

  try {
    const provider = new BrowserProvider(ethProvider);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== ROBINHOOD_TESTNET.chainId) return null;

    const code = await provider.getCode(registryAddress);
    if (!code || code === '0x') return null;

    const signer = await provider.getSigner();
    const contract = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, signer);
    const subjectId = computeSubjectId(entityName);
    const evidenceHash = computeEvidenceHash(entityName, score, comment);

    const [gasLimit, feeData] = await Promise.all([
      contract.attest.estimateGas(subjectId, score, evidenceHash),
      provider.getFeeData(),
    ]);

    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!gasPrice || gasPrice <= 0n) return null;

    const totalWei = gasLimit * gasPrice;
    return {
      gasLimit: gasLimit.toString(),
      estimatedFeeEth: formatEther(totalWei),
    };
  } catch {
    return null;
  }
}

export async function submitOnChainAttestation(params: {
  ethProvider: any;
  registryAddress: string;
  entityName: string;
  score: number;
  comment: string;
  explorerBaseUrl?: string;
  onStateChange?: (state: TransactionLifecycleState, detail?: string) => void;
}): Promise<SubmittedAttestationResult> {
  const {
    ethProvider,
    registryAddress,
    entityName,
    score,
    comment,
    explorerBaseUrl,
    onStateChange,
  } = params;

  if (!ethProvider) {
    onStateChange?.('wallet_disconnected', 'Connect an EVM wallet to submit an on-chain attestation.');
    throw new Error('Wallet is not connected.');
  }

  if (!registryAddress || !isAddress(registryAddress)) {
    onStateChange?.(
      'contract_not_deployed',
      'TrustGraphRegistry contract address is not configured for Robinhood Chain Testnet.'
    );
    throw new Error('TrustGraphRegistry contract is not deployed or configured.');
  }

  const provider = new BrowserProvider(ethProvider);
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== ROBINHOOD_TESTNET.chainId) {
    onStateChange?.(
      'wrong_network',
      `Connected to chain ${network.chainId.toString()}. Switch to Robinhood Chain Testnet (46630).`
    );
    throw new Error(
      `Wrong network (${network.chainId.toString()}). Please switch to Robinhood Chain Testnet (46630).`
    );
  }

  const deployedCode = await provider.getCode(registryAddress);
  if (!deployedCode || deployedCode === '0x') {
    onStateChange?.(
      'contract_not_deployed',
      `No contract bytecode found at ${registryAddress} on Robinhood Chain Testnet.`
    );
    throw new Error(`No TrustGraphRegistry bytecode found at ${registryAddress} on Robinhood Chain Testnet.`);
  }

  const intScore = Math.trunc(score);
  if (intScore < 1 || intScore > 5) {
    throw new Error('Trust score must be an integer between 1 and 5.');
  }

  const subjectId = computeSubjectId(entityName);
  const evidenceHash = computeEvidenceHash(entityName, intScore, comment);

  const signer = await provider.getSigner();
  const contract = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, signer);

  try {
    onStateChange?.('awaiting_approval', 'Confirm the TrustGraphRegistry.attest transaction in your wallet...');
    const tx = await contract.attest(subjectId, intScore, evidenceHash);

    onStateChange?.('pending', tx.hash);
    const receipt = await tx.wait(1);

    if (!receipt || receipt.status !== 1) {
      onStateChange?.('failed', 'Transaction reverted on Robinhood Chain Testnet.');
      throw new Error('Transaction reverted on Robinhood Chain Testnet.');
    }

    let createdEvent: any = null;
    let createdLogIndex = 0;
    let supersededId: string | undefined;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
      try {
        const parsed = contract.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed?.name === 'AttestationCreated') {
          createdEvent = parsed;
          createdLogIndex = log.index;
        } else if (parsed?.name === 'AttestationRevoked' && parsed.args.superseded) {
          supersededId = parsed.args.attestationId.toString();
        }
      } catch {
        // Ignore unrelated log entries
      }
    }

    if (!createdEvent) {
      onStateChange?.('failed', 'Transaction succeeded, but no AttestationCreated event was emitted by the registry.');
      throw new Error('Missing expected AttestationCreated event in transaction receipt.');
    }

    const result: SubmittedAttestationResult = {
      txHash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      logIndex: Number(createdLogIndex),
      attestationId: createdEvent.args.attestationId.toString(),
      subjectId: String(createdEvent.args.subjectId),
      evidenceHash: String(createdEvent.args.evidenceHash),
      attester: String(createdEvent.args.attester),
      score: Number(createdEvent.args.score),
      createdAt: Number(createdEvent.args.createdAt),
      supersededAttestationId: supersededId,
      explorerUrl: getExplorerTxUrl(receipt.hash, explorerBaseUrl),
    };

    onStateChange?.('confirmed', result.txHash);
    return result;
  } catch (err: any) {
    const parsed = parseWalletError(err);
    if (parsed.isUserRejected) {
      onStateChange?.('rejected', parsed.message);
    } else {
      onStateChange?.('failed', parsed.message);
    }
    throw new Error(parsed.message);
  }
}

export async function revokeOnChainAttestation(params: {
  ethProvider: any;
  registryAddress: string;
  attestationId: string | number;
  explorerBaseUrl?: string;
  onStateChange?: (state: TransactionLifecycleState, detail?: string) => void;
}): Promise<SubmittedRevocationResult> {
  const { ethProvider, registryAddress, attestationId, explorerBaseUrl, onStateChange } = params;

  if (!ethProvider) {
    onStateChange?.('wallet_disconnected', 'Connect your wallet to revoke an attestation.');
    throw new Error('Wallet is not connected.');
  }

  if (!registryAddress || !isAddress(registryAddress)) {
    onStateChange?.('contract_not_deployed', 'TrustGraphRegistry contract address is not configured.');
    throw new Error('TrustGraphRegistry contract address is not configured.');
  }

  const provider = new BrowserProvider(ethProvider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== ROBINHOOD_TESTNET.chainId) {
    onStateChange?.('wrong_network', 'Switch to Robinhood Chain Testnet (46630) to revoke.');
    throw new Error('Please switch to Robinhood Chain Testnet (46630).');
  }

  const signer = await provider.getSigner();
  const contract = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, signer);

  try {
    onStateChange?.('awaiting_approval', `Confirm revocation of attestation #${attestationId} in your wallet...`);
    const tx = await contract.revoke(BigInt(attestationId));

    onStateChange?.('pending', tx.hash);
    const receipt = await tx.wait(1);

    if (!receipt || receipt.status !== 1) {
      onStateChange?.('failed', 'Revocation transaction reverted.');
      throw new Error('Revocation transaction reverted on Robinhood Chain Testnet.');
    }

    let revokedEvent: any = null;
    let revokedLogIndex = 0;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
      try {
        const parsed = contract.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed?.name === 'AttestationRevoked') {
          revokedEvent = parsed;
          revokedLogIndex = log.index;
        }
      } catch {
        // Ignore unrelated log entries
      }
    }

    if (!revokedEvent) {
      onStateChange?.('failed', 'Missing AttestationRevoked event in transaction receipt.');
      throw new Error('Missing expected AttestationRevoked event in receipt.');
    }

    const result: SubmittedRevocationResult = {
      txHash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      logIndex: Number(revokedLogIndex),
      attestationId: revokedEvent.args.attestationId.toString(),
      subjectId: String(revokedEvent.args.subjectId),
      attester: String(revokedEvent.args.attester),
      revokedAt: Number(revokedEvent.args.revokedAt),
      explorerUrl: getExplorerTxUrl(receipt.hash, explorerBaseUrl),
    };

    onStateChange?.('confirmed', result.txHash);
    return result;
  } catch (err: any) {
    const parsed = parseWalletError(err);
    if (parsed.isUserRejected) {
      onStateChange?.('rejected', parsed.message);
    } else {
      onStateChange?.('failed', parsed.message);
    }
    throw new Error(parsed.message);
  }
}
