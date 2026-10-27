import fs from 'fs';
import http from 'http';
import path from 'path';
import { Block } from '@ethereumjs/block';
import { Common, Hardfork } from '@ethereumjs/common';
import { TransactionFactory } from '@ethereumjs/tx';
import { Account, Address, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { PostByzantiumTxReceipt, VM } from '@ethereumjs/vm';
import { Contract, ContractFactory, FetchRequest, JsonRpcProvider, Wallet } from 'ethers';

export interface StoredRpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  logIndex: string;
  removed: boolean;
}

export interface LocalRobinhoodChainNode {
  rpcUrl: string;
  chainId: number;
  vm: VM;
  provider: JsonRpcProvider;
  fundWallet: (address: string, ethAmount?: bigint) => Promise<void>;
  deployRegistry: (deployerPrivateKey: string) => Promise<{
    address: string;
    contract: Contract;
  }>;
  close: () => Promise<void>;
}

function toRpcQty(num: number | bigint): string {
  return `0x${BigInt(num).toString(16)}`;
}

function pad32Hex(num: number | bigint): string {
  return `0x${BigInt(num).toString(16).padStart(64, '0')}`;
}

export async function startLocalRobinhoodEvmServer(
  chainId = 46630
): Promise<LocalRobinhoodChainNode> {
  const common = Common.custom(
    {
      name: 'robinhood-chain-testnet-local',
      chainId,
      networkId: chainId,
    },
    {
      hardfork: Hardfork.Paris,
    }
  );

  const vm = await VM.create({ common });

  let currentBlockNumber = 100n;
  let currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  const receiptsByHash = new Map<string, any>();
  const txsByHash = new Map<string, any>();
  const blocksByNumber = new Map<number, any>();
  const allLogs: StoredRpcLog[] = [];

  // Initialize genesis/starting block metadata
  const initBlockHash = pad32Hex(currentBlockNumber);
  blocksByNumber.set(Number(currentBlockNumber), {
    number: toRpcQty(currentBlockNumber),
    hash: initBlockHash,
    parentHash: pad32Hex(currentBlockNumber - 1n),
    nonce: '0x0000000000000000',
    sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
    logsBloom: `0x${'0'.repeat(512)}`,
    transactionsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
    stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
    receiptsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
    miner: '0x0000000000000000000000000000000000000000',
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x3e8',
    gasLimit: toRpcQty(30_000_000n),
    gasUsed: '0x0',
    baseFeePerGas: toRpcQty(1_000_000_000n),
    timestamp: toRpcQty(currentTimestamp),
    transactions: [],
    uncles: [],
  });

  async function handleSingleRpc(payload: any): Promise<any> {
    const { id, method, params = [] } = payload;

    try {
      switch (method) {
        case 'eth_chainId':
          return { jsonrpc: '2.0', id, result: toRpcQty(chainId) };

        case 'net_version':
          return { jsonrpc: '2.0', id, result: String(chainId) };

        case 'eth_blockNumber':
          return { jsonrpc: '2.0', id, result: toRpcQty(currentBlockNumber) };

        case 'eth_gasPrice':
        case 'eth_maxPriorityFeePerGas':
          return { jsonrpc: '2.0', id, result: toRpcQty(1_000_000_000n) };

        case 'eth_feeHistory':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              oldestBlock: toRpcQty(currentBlockNumber),
              baseFeePerGas: [toRpcQty(1_000_000_000n), toRpcQty(1_000_000_000n)],
              gasUsedRatio: [0.1],
              reward: [[toRpcQty(1_000_000_000n)]],
            },
          };

        case 'eth_getBalance': {
          const addr = Address.fromString(params[0]);
          const acct = await vm.stateManager.getAccount(addr);
          return { jsonrpc: '2.0', id, result: toRpcQty(acct?.balance ?? 0n) };
        }

        case 'eth_getTransactionCount': {
          const addr = Address.fromString(params[0]);
          const acct = await vm.stateManager.getAccount(addr);
          return { jsonrpc: '2.0', id, result: toRpcQty(acct?.nonce ?? 0n) };
        }

        case 'eth_getCode': {
          const addr = Address.fromString(params[0]);
          const code = await vm.stateManager.getContractCode(addr);
          return {
            jsonrpc: '2.0',
            id,
            result: code.length > 0 ? bytesToHex(code) : '0x',
          };
        }

        case 'eth_call':
        case 'eth_estimateGas': {
          const callObj = params[0] || {};
          const caller = callObj.from
            ? Address.fromString(callObj.from)
            : Address.zero();
          const to = callObj.to ? Address.fromString(callObj.to) : undefined;
          const data = callObj.data ? hexToBytes(callObj.data) : new Uint8Array();
          const value = callObj.value ? BigInt(callObj.value) : 0n;
          const gasLimit = callObj.gas ? BigInt(callObj.gas) : 15_000_000n;

          await vm.stateManager.checkpoint();
          let callRes;
          try {
            const simBlock = Block.fromBlockData(
              {
                header: {
                  number: currentBlockNumber,
                  timestamp: currentTimestamp,
                  gasLimit: 30_000_000n,
                  baseFeePerGas: 1_000_000_000n,
                },
              },
              { common }
            );
            callRes = await vm.evm.runCall({
              caller,
              origin: caller,
              to,
              data,
              value,
              gasLimit,
              block: simBlock,
            });
          } finally {
            await vm.stateManager.revert();
          }

          if (callRes.execResult.exceptionError) {
            const revertData =
              callRes.execResult.returnValue.length > 0
                ? bytesToHex(callRes.execResult.returnValue)
                : '0x';
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: 3,
                message: `execution reverted: ${callRes.execResult.exceptionError.error}`,
                data: revertData,
              },
            };
          }

          if (method === 'eth_estimateGas') {
            const intrinsicBase = to ? 21_000n : 53_000n;
            const calldataCost = BigInt(data.length) * 16n;
            const codeDepositCost = !to
              ? BigInt(callRes.execResult.returnValue.length) * 200n
              : 0n;
            const estimated =
              intrinsicBase +
              calldataCost +
              codeDepositCost +
              callRes.execResult.executionGasUsed +
              45_000n;
            return { jsonrpc: '2.0', id, result: toRpcQty(estimated) };
          }

          return {
            jsonrpc: '2.0',
            id,
            result:
              callRes.execResult.returnValue.length > 0
                ? bytesToHex(callRes.execResult.returnValue)
                : '0x',
          };
        }

        case 'eth_sendRawTransaction': {
          const rawHex = String(params[0]);
          const tx = TransactionFactory.fromSerializedData(hexToBytes(rawHex as `0x${string}`), {
            common,
          });

          const nextBlockNumber = currentBlockNumber + 1n;
          const nextTimestamp = currentTimestamp + 2n;

          const block = Block.fromBlockData(
            {
              header: {
                number: nextBlockNumber,
                timestamp: nextTimestamp,
                gasLimit: 30_000_000n,
                baseFeePerGas: 1_000_000_000n,
              },
            },
            { common }
          );

          const runRes = await vm.runTx({
            tx,
            block,
            skipBlockGasLimitValidation: true,
          });

          currentBlockNumber = nextBlockNumber;
          currentTimestamp = nextTimestamp;

          const txHash = bytesToHex(tx.hash());
          const blockHash = pad32Hex(currentBlockNumber);
          const fromAddr = tx.getSenderAddress().toString();
          const toAddr = tx.to ? tx.to.toString() : null;
          const createdAddr = runRes.createdAddress ? runRes.createdAddress.toString() : null;

          const postReceipt = runRes.receipt as PostByzantiumTxReceipt;
          const rpcLogs: StoredRpcLog[] = (postReceipt.logs || []).map((logTuple, idx) => {
            const logAddr = bytesToHex(logTuple[0]);
            const logTopics = logTuple[1].map((t) => bytesToHex(t));
            const logData = logTuple[2].length > 0 ? bytesToHex(logTuple[2]) : '0x';
            return {
              address: logAddr,
              topics: logTopics,
              data: logData,
              blockNumber: toRpcQty(currentBlockNumber),
              transactionHash: txHash,
              transactionIndex: '0x0',
              blockHash,
              logIndex: toRpcQty(idx),
              removed: false,
            };
          });

          if (postReceipt.status === 1) {
            allLogs.push(...rpcLogs);
          }

          const receiptJson = {
            transactionHash: txHash,
            transactionIndex: '0x0',
            blockHash,
            blockNumber: toRpcQty(currentBlockNumber),
            from: fromAddr,
            to: toAddr,
            cumulativeGasUsed: toRpcQty(runRes.totalGasSpent),
            gasUsed: toRpcQty(runRes.totalGasSpent),
            effectiveGasPrice: toRpcQty(1_000_000_000n),
            contractAddress: createdAddr,
            logs: rpcLogs,
            logsBloom: `0x${'0'.repeat(512)}`,
            status: toRpcQty(postReceipt.status),
            type: toRpcQty(tx.type),
          };

          const txJson = {
            hash: txHash,
            nonce: toRpcQty(tx.nonce),
            blockHash,
            blockNumber: toRpcQty(currentBlockNumber),
            transactionIndex: '0x0',
            from: fromAddr,
            to: toAddr,
            value: toRpcQty(tx.value),
            gas: toRpcQty(tx.gasLimit),
            gasPrice: toRpcQty(1_000_000_000n),
            input: tx.data.length > 0 ? bytesToHex(tx.data) : '0x',
            type: toRpcQty(tx.type),
            chainId: toRpcQty(chainId),
            v: toRpcQty(tx.v ?? 0n),
            r: toRpcQty(tx.r ?? 0n),
            s: toRpcQty(tx.s ?? 0n),
          };

          receiptsByHash.set(txHash.toLowerCase(), receiptJson);
          txsByHash.set(txHash.toLowerCase(), txJson);
          blocksByNumber.set(Number(currentBlockNumber), {
            number: toRpcQty(currentBlockNumber),
            hash: blockHash,
            parentHash: pad32Hex(currentBlockNumber - 1n),
            nonce: '0x0000000000000000',
            sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            logsBloom: `0x${'0'.repeat(512)}`,
            transactionsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
            stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
            receiptsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
            miner: '0x0000000000000000000000000000000000000000',
            difficulty: '0x0',
            totalDifficulty: '0x0',
            extraData: '0x',
            size: '0x3e8',
            gasLimit: toRpcQty(30_000_000n),
            gasUsed: toRpcQty(runRes.totalGasSpent),
            baseFeePerGas: toRpcQty(1_000_000_000n),
            timestamp: toRpcQty(currentTimestamp),
            transactions: [txHash],
            uncles: [],
          });

          if (runRes.execResult.exceptionError) {
            const revertBytes = runRes.execResult.returnValue;
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: 3,
                message: `execution reverted: ${runRes.execResult.exceptionError.error}`,
                data: revertBytes.length > 0 ? bytesToHex(revertBytes) : '0x',
              },
            };
          }

          return { jsonrpc: '2.0', id, result: txHash };
        }

        case 'eth_getTransactionReceipt': {
          const hash = String(params[0] || '').toLowerCase();
          return { jsonrpc: '2.0', id, result: receiptsByHash.get(hash) || null };
        }

        case 'eth_getTransactionByHash': {
          const hash = String(params[0] || '').toLowerCase();
          return { jsonrpc: '2.0', id, result: txsByHash.get(hash) || null };
        }

        case 'eth_getBlockByNumber': {
          const tag = String(params[0] || 'latest');
          const num =
            tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized'
              ? Number(currentBlockNumber)
              : tag === 'earliest'
              ? 100
              : parseInt(tag, 16);
          const foundBlock =
            (Number.isFinite(num) ? blocksByNumber.get(num) : null) ||
            blocksByNumber.get(Number(currentBlockNumber)) ||
            blocksByNumber.get(100);
          return {
            jsonrpc: '2.0',
            id,
            result: foundBlock,
          };
        }

        case 'eth_getLogs': {
          const filter = params[0] || {};
          const fromBlock =
            filter.fromBlock === undefined || filter.fromBlock === 'earliest'
              ? 0
              : filter.fromBlock === 'latest'
              ? Number(currentBlockNumber)
              : parseInt(String(filter.fromBlock), 16);
          const toBlock =
            filter.toBlock === undefined || filter.toBlock === 'latest'
              ? Number(currentBlockNumber)
              : parseInt(String(filter.toBlock), 16);

          const addrFilter = filter.address
            ? String(filter.address).toLowerCase()
            : null;
          const topicFilters: any[] = Array.isArray(filter.topics) ? filter.topics : [];

          const matched = allLogs.filter((l) => {
            const bNum = parseInt(l.blockNumber, 16);
            if (bNum < fromBlock || bNum > toBlock) return false;
            if (addrFilter && l.address.toLowerCase() !== addrFilter) return false;

            for (let i = 0; i < topicFilters.length; i++) {
              const wanted = topicFilters[i];
              if (!wanted) continue;
              const actualTopic = (l.topics[i] || '').toLowerCase();
              if (Array.isArray(wanted)) {
                const lowerOptions = wanted.map((w) => String(w).toLowerCase());
                if (!lowerOptions.includes(actualTopic)) return false;
              } else if (String(wanted).toLowerCase() !== actualTopic) {
                return false;
              }
            }
            return true;
          });

          return { jsonrpc: '2.0', id, result: matched };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method ${method} not supported in test harness` },
          };
      }
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err?.message || 'Internal EVM RPC error' },
      };
    }
  }

  let rpcLock: Promise<any> = Promise.resolve();

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      rpcLock = rpcLock.then(async () => {
        try {
          const parsed = JSON.parse(body);
          let result: any;
          if (Array.isArray(parsed)) {
            result = [];
            for (const item of parsed) {
              result.push(await handleSingleRpc(item));
            }
          } else {
            result = await handleSingleRpc(parsed);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: err?.message },
            })
          );
        }
      });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addrInfo = server.address() as { port: number };
  const rpcUrl = `http://127.0.0.1:${addrInfo.port}`;

  const fetchReq = new FetchRequest(rpcUrl);
  const provider = new JsonRpcProvider(fetchReq, chainId, {
    staticNetwork: true,
    cacheTimeout: -1,
  });

  async function fundWallet(address: string, ethAmount = 50n * 10n ** 18n) {
    const addr = Address.fromString(address);
    const existing = await vm.stateManager.getAccount(addr);
    const updated = Account.fromAccountData({
      nonce: existing?.nonce ?? 0n,
      balance: ethAmount,
      storageRoot: existing?.storageRoot,
      codeHash: existing?.codeHash,
    });
    await vm.stateManager.putAccount(addr, updated);
  }

  async function deployRegistry(deployerPrivateKey: string) {
    const artifactPath = path.resolve(process.cwd(), 'artifacts/TrustGraphRegistry.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    const wallet = new Wallet(deployerPrivateKey, provider);
    await fundWallet(wallet.address);

    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const deployed = await factory.deploy();
    await deployed.waitForDeployment();
    const address = await deployed.getAddress();
    const contract = new Contract(address, artifact.abi, wallet);
    return { address, contract };
  }

  async function close() {
    provider.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return {
    rpcUrl,
    chainId,
    vm,
    provider,
    fundWallet,
    deployRegistry,
    close,
  };
}
