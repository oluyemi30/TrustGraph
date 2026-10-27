import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { compileTrustGraphRegistry } from './compile-contracts';

dotenv.config();

const EXPECTED_CHAIN_ID = 46630n;
const DEFAULT_RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const DEFAULT_EXPLORER_URL = 'https://explorer.testnet.chain.robinhood.com';

async function main() {
  const rpcUrl = (process.env.RH_RPC_URL || DEFAULT_RPC_URL).trim();
  const explorerUrl = (process.env.RH_EXPLORER_URL || DEFAULT_EXPLORER_URL).trim().replace(/\/$/, '');
  const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();

  if (!privateKey) {
    console.error('❌ Missing DEPLOYER_PRIVATE_KEY environment variable.');
    console.error('Provide a funded Robinhood Chain Testnet deployer key only in your local shell or secure CI:');
    console.error('  DEPLOYER_PRIVATE_KEY=0x... npm run deploy:testnet');
    process.exit(1);
  }

  // Ensure fresh artifact
  const artifactPath = path.join(process.cwd(), 'artifacts', 'TrustGraphRegistry.json');
  const artifact = fs.existsSync(artifactPath)
    ? JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    : compileTrustGraphRegistry();

  console.log(`[Deploy] Connecting to Robinhood Chain Testnet RPC: ${rpcUrl}`);
  const provider = new JsonRpcProvider(rpcUrl);

  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    console.error(
      `❌ Chain ID mismatch! Expected Robinhood Chain Testnet (46630), got ${network.chainId.toString()}. Aborting.`
    );
    process.exit(1);
  }

  const wallet = new Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`[Deploy] Deployer address: ${wallet.address}`);
  console.log(`[Deploy] Deployer balance: ${formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('❌ Deployer wallet has 0 ETH on Robinhood Chain Testnet (Chain ID 46630).');
    console.error('Fund this wallet with Robinhood Chain Testnet ETH before deploying.');
    process.exit(1);
  }

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('[Deploy] Submitting TrustGraphRegistry deployment transaction...');

  const contract = await factory.deploy();
  const deployTx = contract.deploymentTransaction();
  if (deployTx) {
    console.log(`[Deploy] Deployment tx hash: ${deployTx.hash}`);
    console.log(`[Deploy] Explorer tx link:   ${explorerUrl}/tx/${deployTx.hash}`);
  }

  await contract.waitForDeployment();
  const deployedAddress = await contract.getAddress();
  const code = await provider.getCode(deployedAddress);

  if (!code || code === '0x') {
    throw new Error(`Deployment verification failed: no bytecode found at ${deployedAddress}`);
  }

  console.log('\n✅ TrustGraphRegistry deployed to Robinhood Chain Testnet!');
  console.log(`   Contract Address: ${deployedAddress}`);
  console.log(`   Explorer URL:     ${explorerUrl}/address/${deployedAddress}`);
  console.log('\nNext step — add to your .env file and restart the server:');
  console.log(`   RH_REGISTRY_ADDRESS=${deployedAddress}`);
  console.log(`   VITE_RH_REGISTRY_ADDRESS=${deployedAddress}`);
}

main().catch((err) => {
  console.error('[Deploy] Deployment failed:', err.message || err);
  process.exit(1);
});
