import { isAddress, verifyMessage } from 'ethers';
import { AuthChallenge, DatabaseEngine, db as defaultDb } from './db';

export function verifyChallengeSignature(params: {
  walletAddress: string;
  nonce: string;
  signature: string;
  expectedPurpose: AuthChallenge['purpose'];
  database?: DatabaseEngine;
}): { verified: true; walletAddress: string } | { verified: false; error: string } {
  const database = params.database || defaultDb;
  const cleanWallet = (params.walletAddress || '').trim();

  if (!isAddress(cleanWallet)) {
    return { verified: false, error: 'Invalid EVM wallet address.' };
  }
  if (!params.signature || !params.signature.startsWith('0x')) {
    return { verified: false, error: 'Valid cryptographic wallet signature is required.' };
  }

  const consumed = database.consumeAuthChallenge(
    params.nonce,
    cleanWallet,
    params.expectedPurpose
  );

  if ('error' in consumed) {
    return { verified: false, error: consumed.error };
  }

  try {
    const recovered = verifyMessage(consumed.challenge.message, params.signature);
    if (recovered.toLowerCase() !== cleanWallet.toLowerCase()) {
      return {
        verified: false,
        error: 'Signature recovery did not match the claimed wallet address.',
      };
    }
    return { verified: true, walletAddress: recovered };
  } catch (err: any) {
    return {
      verified: false,
      error: `Invalid cryptographic signature: ${err?.message || 'verification failed'}`,
    };
  }
}

export function buildCanonicalOffChainAttestationMessage(params: {
  walletAddress: string;
  fromUser: string;
  toEntity: string;
  score: number;
  comment: string;
  issuedAt: string;
}): string {
  return [
    'TrustGraph Off-Chain Community Attestation',
    `Signer: ${params.walletAddress.trim()}`,
    `Author: @${params.fromUser.trim().replace(/^@/, '')}`,
    `Subject: ${params.toEntity.trim().toLowerCase()}`,
    `Trust Score: ${Math.trunc(params.score)}/5`,
    `Comment: ${(params.comment || '').trim()}`,
    `Issued At: ${params.issuedAt}`,
  ].join('\n');
}

export function verifyOffChainSignedAttestation(params: {
  walletAddress: string;
  signedMessage: string;
  signature: string;
  expectedEntity: string;
  expectedScore: number;
}): { verified: true; signer: string } | { verified: false; error: string } {
  if (!isAddress(params.walletAddress)) {
    return { verified: false, error: 'Invalid wallet address.' };
  }
  if (!params.signedMessage || !params.signature) {
    return { verified: false, error: 'Missing signedMessage or signature.' };
  }

  // Ensure the signed message explicitly binds the target entity and score
  const msgLower = params.signedMessage.toLowerCase();
  if (!msgLower.includes(`subject: ${params.expectedEntity.trim().toLowerCase()}`)) {
    return { verified: false, error: 'Signed message does not match target subject.' };
  }
  if (!params.signedMessage.includes(`Trust Score: ${Math.trunc(params.expectedScore)}/5`)) {
    return { verified: false, error: 'Signed message does not match submitted trust score.' };
  }

  try {
    const recovered = verifyMessage(params.signedMessage, params.signature);
    if (recovered.toLowerCase() !== params.walletAddress.toLowerCase()) {
      return { verified: false, error: 'Recovered signer does not match wallet_address.' };
    }
    return { verified: true, signer: recovered };
  } catch {
    return { verified: false, error: 'Failed to verify EIP-191 wallet signature.' };
  }
}
