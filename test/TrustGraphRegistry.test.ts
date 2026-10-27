import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contract, Wallet, ZeroHash } from 'ethers';
import { TRUSTGRAPH_REGISTRY_ABI } from '../src/lib/trustGraphAbi';
import { computeEvidenceHash, computeSubjectId } from '../src/lib/robinhoodChain';
import { LocalRobinhoodChainNode, startLocalRobinhoodEvmServer } from './evmHarness';

const DEPLOYER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ALICE_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const BOB_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const MALLORY_PK = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';

describe('TrustGraphRegistry Smart Contract (Robinhood Chain Testnet 46630)', () => {
  let node: LocalRobinhoodChainNode;
  let registryAddress: string;
  let aliceWallet: Wallet;
  let bobWallet: Wallet;
  let malloryWallet: Wallet;
  let aliceRegistry: Contract;
  let bobRegistry: Contract;
  let malloryRegistry: Contract;

  before(async () => {
    node = await startLocalRobinhoodEvmServer(46630);
    const deployed = await node.deployRegistry(DEPLOYER_PK);
    registryAddress = deployed.address;

    aliceWallet = new Wallet(ALICE_PK, node.provider);
    bobWallet = new Wallet(BOB_PK, node.provider);
    malloryWallet = new Wallet(MALLORY_PK, node.provider);

    await node.fundWallet(aliceWallet.address);
    await node.fundWallet(bobWallet.address);
    await node.fundWallet(malloryWallet.address);

    aliceRegistry = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, aliceWallet);
    bobRegistry = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, bobWallet);
    malloryRegistry = new Contract(registryAddress, TRUSTGRAPH_REGISTRY_ABI, malloryWallet);
  });

  after(async () => {
    await node.close();
  });

  it('initializes constants and zero attestations on chainId 46630', async () => {
    const network = await node.provider.getNetwork();
    assert.equal(Number(network.chainId), 46630);

    const minScore = await aliceRegistry.MIN_SCORE();
    const maxScore = await aliceRegistry.MAX_SCORE();
    const total = await aliceRegistry.totalAttestations();

    assert.equal(Number(minScore), 1);
    assert.equal(Number(maxScore), 5);
    assert.equal(total, 0n);
  });

  it('creates a valid attestation, emits AttestationCreated, and exposes public record', async () => {
    const subjectId = computeSubjectId('Ethereum');
    const comment = 'Audited core infrastructure with battle-tested client diversity.';
    const evidenceHash = computeEvidenceHash('Ethereum', 5, comment);

    const tx = await aliceRegistry.attest(subjectId, 5, evidenceHash);
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);

    const parsedLogs = receipt.logs
      .map((l: any) => {
        try {
          return aliceRegistry.interface.parseLog({ topics: [...l.topics], data: l.data });
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    assert.equal(parsedLogs.length, 1);
    assert.equal(parsedLogs[0]!.name, 'AttestationCreated');
    assert.equal(parsedLogs[0]!.args.attestationId, 1n);
    assert.equal(parsedLogs[0]!.args.subjectId, subjectId);
    assert.equal(parsedLogs[0]!.args.attester.toLowerCase(), aliceWallet.address.toLowerCase());
    assert.equal(Number(parsedLogs[0]!.args.score), 5);
    assert.equal(parsedLogs[0]!.args.evidenceHash, evidenceHash);

    const record = await aliceRegistry.getAttestation(1);
    assert.equal(record.subjectId, subjectId);
    assert.equal(record.evidenceHash, evidenceHash);
    assert.equal(record.attester.toLowerCase(), aliceWallet.address.toLowerCase());
    assert.equal(Number(record.score), 5);
    assert.equal(record.revoked, false);
    assert.ok(Number(record.createdAt) > 0);

    const isRev = await aliceRegistry.isRevoked(1);
    assert.equal(isRev, false);

    const summary = await aliceRegistry.getSubjectSummary(subjectId);
    assert.equal(summary.activeCount, 1n);
    assert.equal(summary.revokedCount, 0n);
    assert.equal(summary.activeScoreSum, 5n);
    assert.equal(summary.averageScoreBps, 500n);
  });

  it('reverts on invalid scores (0 and 6) and empty bytes32(0) subjectId', async () => {
    const validSubject = computeSubjectId('Uniswap');

    await assert.rejects(
      async () => {
        await aliceRegistry.attest(validSubject, 0, ZeroHash);
      },
      /reverted|InvalidScore/i
    );

    await assert.rejects(
      async () => {
        await aliceRegistry.attest(validSubject, 6, ZeroHash);
      },
      /reverted|InvalidScore/i
    );

    await assert.rejects(
      async () => {
        await aliceRegistry.attest(ZeroHash, 4, ZeroHash);
      },
      /reverted|InvalidSubject/i
    );
  });

  it('supersedes prior active attestation from same (attester, subjectId) without inflating activeCount', async () => {
    const subjectId = computeSubjectId('Ethereum');
    const updatedHash = computeEvidenceHash('Ethereum', 3, 'Updated assessment after upgrade.');

    const tx = await aliceRegistry.attest(subjectId, 3, updatedHash);
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);

    // Attestation #1 must now be revoked (superseded), and #2 active
    assert.equal(await aliceRegistry.isRevoked(1), true);
    assert.equal(await aliceRegistry.isRevoked(2), false);
    assert.equal(await aliceRegistry.getActiveAttestationId(aliceWallet.address, subjectId), 2n);

    const summary = await aliceRegistry.getSubjectSummary(subjectId);
    assert.equal(summary.activeCount, 1n);
    assert.equal(summary.revokedCount, 1n);
    assert.equal(summary.activeScoreSum, 3n);
    assert.equal(summary.averageScoreBps, 300n);
  });

  it('aggregates multiple distinct attesters accurately and supports paginated queries', async () => {
    const subjectId = computeSubjectId('Ethereum');
    const bobHash = computeEvidenceHash('Ethereum', 5, 'Strong validator decentralization.');

    const tx = await bobRegistry.attest(subjectId, 5, bobHash);
    await tx.wait();

    const summary = await aliceRegistry.getSubjectSummary(subjectId);
    assert.equal(summary.activeCount, 2n); // Alice (#2: 3) + Bob (#3: 5)
    assert.equal(summary.revokedCount, 1n); // Alice (#1)
    assert.equal(summary.activeScoreSum, 8n);
    assert.equal(summary.averageScoreBps, 400n); // 4.00 / 5.00

    const [ids, total] = await aliceRegistry.getSubjectAttestationIds(subjectId, 0, 10);
    assert.equal(total, 3n);
    assert.deepEqual(
      ids.map((n: bigint) => Number(n)),
      [1, 2, 3]
    );
  });

  it('prevents unauthorized revocation and allows original attester to revoke exactly once', async () => {
    // Mallory cannot revoke Bob's attestation #3
    await assert.rejects(
      async () => {
        await malloryRegistry.revoke(3);
      },
      /reverted|UnauthorizedAttester/i
    );

    // Bob revokes his own attestation #3
    const revTx = await bobRegistry.revoke(3);
    const revReceipt = await revTx.wait();
    assert.equal(revReceipt.status, 1);

    assert.equal(await bobRegistry.isRevoked(3), true);

    const subjectId = computeSubjectId('Ethereum');
    const summaryAfter = await bobRegistry.getSubjectSummary(subjectId);
    assert.equal(summaryAfter.activeCount, 1n); // Only Alice (#2: 3) remains active
    assert.equal(summaryAfter.revokedCount, 2n);
    assert.equal(summaryAfter.activeScoreSum, 3n);

    // Double revocation must revert with AlreadyRevoked
    await assert.rejects(
      async () => {
        await bobRegistry.revoke(3);
      },
      /reverted|AlreadyRevoked/i
    );
  });
});
