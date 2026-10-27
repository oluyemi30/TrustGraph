process.env.TRUSTGRAPH_TEST_MODE = 'true';

import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { after, before, describe, it } from 'node:test';
import { Contract, Wallet, hexlify, toUtf8Bytes } from 'ethers';
import { TRUSTGRAPH_REGISTRY_ABI } from '../src/lib/trustGraphAbi';
import {
  ROBINHOOD_TESTNET,
  computeEvidenceHash,
  computeSubjectId,
} from '../src/lib/robinhoodChain';
import { DatabaseEngine, JsonFileStorageAdapter } from '../server/db';
import { syncRobinhoodRegistryEvents } from '../server/robinhood/indexer';
import {
  verifyOnChainAttestationTx,
  verifyOnChainRevocationTx,
} from '../server/robinhood/verification';
import { LocalRobinhoodChainNode, startLocalRobinhoodEvmServer } from './evmHarness';

const DEPLOYER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const USER_A_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const USER_B_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

describe('Backend Verification, Idempotent Indexer, Nonce Auth & Repaired Telegram Bot', () => {
  let evmNode: LocalRobinhoodChainNode;
  let wrongChainNode: LocalRobinhoodChainNode;
  let registryAddress: string;
  let userAWallet: Wallet;
  let userBWallet: Wallet;
  let userARegistry: Contract;
  let apiServer: http.Server;
  let apiBaseUrl: string;
  let tempDir: string;
  let isolatedDb: DatabaseEngine;

  // Snapshot original data/database.json so running HTTP route tests leaves workspace data untouched
  const mainDbPath = path.resolve(process.cwd(), 'data/database.json');
  let originalMainDbContent: string | null = null;

  before(async () => {
    if (fs.existsSync(mainDbPath)) {
      originalMainDbContent = fs.readFileSync(mainDbPath, 'utf8');
    }

    evmNode = await startLocalRobinhoodEvmServer(46630);
    wrongChainNode = await startLocalRobinhoodEvmServer(84532); // Base Sepolia chainId to test rejection

    const deployed = await evmNode.deployRegistry(DEPLOYER_PK);
    registryAddress = deployed.address;

    process.env.RH_CHAIN_ID = '46630';
    process.env.RH_RPC_URL = evmNode.rpcUrl;
    process.env.RH_REGISTRY_ADDRESS = registryAddress;

    userAWallet = new Wallet(USER_A_PK, evmNode.provider);
    userBWallet = new Wallet(USER_B_PK, evmNode.provider);
    await evmNode.fundWallet(userAWallet.address);
    await evmNode.fundWallet(userBWallet.address);

    userARegistry = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, userAWallet);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trustgraph-test-'));
    isolatedDb = new DatabaseEngine(
      new JsonFileStorageAdapter(path.join(tempDir, 'isolated-db.json'))
    );

    const { app } = await import('../server');
    apiServer = http.createServer(app);
    await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (apiServer.address() as { port: number }).port;
    apiBaseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await evmNode.close();
    await wrongChainNode.close();
    if (originalMainDbContent !== null) {
      fs.writeFileSync(mainDbPath, originalMainDbContent, 'utf8');
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('exposes accurate Robinhood Chain Testnet (46630) network status', async () => {
    assert.equal(ROBINHOOD_TESTNET.chainId, 46630);
    assert.equal(ROBINHOOD_TESTNET.chainIdHex, '0xb626');
    assert.equal(ROBINHOOD_TESTNET.nativeCurrency.symbol, 'ETH');

    const res = await fetch(`${apiBaseUrl}/api/network/status`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.network.chainId, 46630);
    assert.equal(body.network.rpcConnected, true);
    assert.equal(body.network.chainMatchesExpected, true);
    assert.equal(body.network.contractDeployed, true);
    assert.equal(body.network.registryAddress.toLowerCase(), registryAddress.toLowerCase());
  });

  it('verifies a real TrustGraphRegistry.attest receipt and rejects self-transfer transactions', async () => {
    const entity = 'RobinhoodSwap';
    const comment = 'Deterministic AMM contracts verified on testnet.';
    const subjectId = computeSubjectId(entity);
    const evidenceHash = computeEvidenceHash(entity, 5, comment);

    const realTx = await userARegistry.attest(subjectId, 5, evidenceHash);
    const realReceipt = await realTx.wait();

    const verified = await verifyOnChainAttestationTx({
      txHash: realReceipt.hash,
      expectedEntityName: entity,
      expectedComment: comment,
      rpcUrlOverride: evmNode.rpcUrl,
      registryAddressOverride: registryAddress,
    });

    assert.equal(verified.verified, true);
    if (verified.verified) {
      assert.equal(verified.chainId, 46630);
      assert.equal(verified.attestationId, '1');
      assert.equal(verified.score, 5);
      assert.equal(verified.attester.toLowerCase(), userAWallet.address.toLowerCase());
      assert.equal(verified.commentHashMatches, true);
    }

    // Legacy self-transaction with calldata MUST be rejected
    const fakeSelfTx = await userAWallet.sendTransaction({
      to: userAWallet.address,
      value: 0n,
      data: hexlify(toUtf8Bytes('TrustGraph Attestation: RobinhoodSwap (5/5)')),
    });
    const fakeReceipt = await fakeSelfTx.wait();

    const rejectedSelfTx = await verifyOnChainAttestationTx({
      txHash: fakeReceipt!.hash,
      expectedEntityName: entity,
      rpcUrlOverride: evmNode.rpcUrl,
      registryAddressOverride: registryAddress,
    });

    assert.equal(rejectedSelfTx.verified, false);
    if ('reason' in rejectedSelfTx) {
      assert.equal(rejectedSelfTx.status, 'wrong_contract');
    }
  });

  it('rejects verification when RPC reports a non-Robinhood chain ID', async () => {
    const wrongDeployed = await wrongChainNode.deployRegistry(DEPLOYER_PK);
    const wrongWallet = new Wallet(USER_A_PK, wrongChainNode.provider);
    await wrongChainNode.fundWallet(wrongWallet.address);
    const wrongContract = new Contract(
      wrongDeployed.address,
      TRUSTGRAPH_REGISTRY_ABI,
      wrongWallet
    );

    const tx = await wrongContract.attest(computeSubjectId('Ethereum'), 4, computeEvidenceHash('Ethereum', 4, 'test'));
    const receipt = await tx.wait();

    const outcome = await verifyOnChainAttestationTx({
      txHash: receipt.hash,
      rpcUrlOverride: wrongChainNode.rpcUrl,
      registryAddressOverride: wrongDeployed.address,
    });

    assert.equal(outcome.verified, false);
    if ('reason' in outcome) {
      assert.equal(outcome.status, 'wrong_chain');
    }
  });

  it('never trusts client-submitted verified: true flags on POST /api/attestations', async () => {
    const res = await fetch(`${apiBaseUrl}/api/attestations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_user: 'spoof_attempt',
        to_entity: 'Ethereum',
        trust_score: 5,
        comment: 'Attempting to spoof verified flag without chain tx',
        verified: true,
        verified_onchain: true,
      }),
    });

    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.attestation.verified_onchain, false);
    assert.equal(data.attestation.evidence_category, 'offchain_community');
  });

  it('indexes events idempotently across repeated sync runs and reflects on-chain revocations', async () => {
    const userBRegistry = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, userBWallet);
    const subId = computeSubjectId('Vitalik');
    const evHash = computeEvidenceHash('Vitalik', 4, 'Consistent protocol stewardship.');

    const createTx = await userBRegistry.attest(subId, 4, evHash);
    await createTx.wait();

    // First sync into isolated database
    const sync1 = await syncRobinhoodRegistryEvents({
      database: isolatedDb,
      rpcUrlOverride: evmNode.rpcUrl,
      registryAddressOverride: registryAddress,
      fromBlockOverride: 100,
    });
    assert.equal(sync1.synced, true);
    assert.equal(sync1.newlyIndexed, 2); // Attestation #1 (RobinhoodSwap) + Attestation #2 (Vitalik)

    // Second & third syncs MUST NOT duplicate records
    const sync2 = await syncRobinhoodRegistryEvents({
      database: isolatedDb,
      rpcUrlOverride: evmNode.rpcUrl,
      registryAddressOverride: registryAddress,
    });
    const sync3 = await syncRobinhoodRegistryEvents({
      database: isolatedDb,
      rpcUrlOverride: evmNode.rpcUrl,
      registryAddressOverride: registryAddress,
    });

    assert.equal(sync2.newlyIndexed, 0);
    assert.equal(sync3.newlyIndexed, 0);

    const onChainRecordsBeforeRevoke = isolatedDb
      .getAttestations(true)
      .filter((a) => a.verified_onchain);
    assert.equal(onChainRecordsBeforeRevoke.length, 2);

    // Revoke attestation #2 on-chain and verify + sync
    const revTx = await userBRegistry.revoke(2);
    const revReceipt = await revTx.wait();

    const revCheck = await verifyOnChainRevocationTx({
      txHash: revReceipt.hash,
      expectedAttestationId: '2',
      rpcUrlOverride: evmNode.rpcUrl,
      registryAddressOverride: registryAddress,
    });
    assert.equal(revCheck.verified, true);

    await syncRobinhoodRegistryEvents({
      database: isolatedDb,
      rpcUrlOverride: evmNode.rpcUrl,
      registryAddressOverride: registryAddress,
    });

    const att2 = isolatedDb
      .getAttestations(true)
      .find((a) => a.onchain_attestation_id === '2');
    assert.ok(att2);
    assert.equal(att2.revoked, true);
  });

  it('enforces single-use nonce signatures for wallet linking and blocks replay attacks', async () => {
    // 1. Unsigned generate-code request must fail with 401
    const unauthRes = await fetch(`${apiBaseUrl}/api/telegram/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: userAWallet.address }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Request a valid challenge nonce
    const nonceRes = await fetch(`${apiBaseUrl}/api/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: userAWallet.address,
        purpose: 'link_wallet',
      }),
    });
    assert.equal(nonceRes.status, 200);
    const nonceBody: any = await nonceRes.json();
    assert.ok(nonceBody.nonce);
    assert.ok(nonceBody.message.includes(nonceBody.nonce));

    // 3. Sign with User A wallet and exchange for activation code
    const signature = await userAWallet.signMessage(nonceBody.message);
    const codeRes = await fetch(`${apiBaseUrl}/api/telegram/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: userAWallet.address,
        nonce: nonceBody.nonce,
        signature,
      }),
    });
    assert.equal(codeRes.status, 200);
    const codeBody: any = await codeRes.json();
    assert.equal(codeBody.code.length, 6);

    // 4. Replaying the exact same nonce + signature MUST fail with 401
    const replayRes = await fetch(`${apiBaseUrl}/api/telegram/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: userAWallet.address,
        nonce: nonceBody.nonce,
        signature,
      }),
    });
    assert.equal(replayRes.status, 401);
  });

  it('validates API inputs and ensures Telegram bot never fabricates 0x transaction hashes', async () => {
    // Invalid score = 9 rejected with 400
    const badScoreRes = await fetch(`${apiBaseUrl}/api/attestations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_user: 'tester',
        to_entity: 'Ethereum',
        trust_score: 9,
        comment: 'Out of range',
      }),
    });
    assert.equal(badScoreRes.status, 400);

    // Telegram /attest command must clearly record Off-Chain Community Claim without fake 0x hashes
    const { processBotMessage } = await import('../server');
    const botReply = await processBotMessage('/attest Ethereum 5 "Transparent ecosystem"', {
      id: '9001',
      username: 'security_auditor',
      first_name: 'Auditor',
    });

    assert.ok(botReply.includes('Off-Chain Community Claim Recorded'));
    assert.ok(botReply.includes('NOT confirmed on-chain'));
    assert.equal(/0x[0-9a-fA-F]{64}/.test(botReply), false);
  });
});
