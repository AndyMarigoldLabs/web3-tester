import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { expect, test } from '../src/fixtures.js';
import {
  SAFE_TRANSACTION_TYPED_DATA_TYPES,
  InMemorySafeTransactionService,
  SAFE_MULTISEND_CALL_ONLY_ADDRESS,
  SafeTransactionServiceClient,
  SafeWalletHarness,
  buildSafeTransactionTypedData,
  deterministicSafeSignature,
  hashSafeTransactionData,
  hashSafeTransactionTypedData,
  handleSafeAppRequest,
  injectSafeAppBridge,
  type SafeTransactionData,
} from '../src/safe.js';

const SAFE_ADDRESS = '0x000000000000000000000000000000000000515a' as const;
const RECIPIENT = '0x000000000000000000000000000000000000beef' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const SECOND_RECIPIENT = '0x000000000000000000000000000000000000cafe' as const;

const manualMultiSendCallData = (
  transactions: readonly { to: Address; value: bigint | number | string; data: Hex }[],
): Hex => {
  const packed = transactions
    .map((transaction) =>
      [
        toHex(0, { size: 1 }).slice(2),
        transaction.to.slice(2).toLowerCase(),
        toHex(BigInt(transaction.value), { size: 32 }).slice(2),
        toHex(BigInt((transaction.data.length - 2) / 2), { size: 32 }).slice(2),
        transaction.data.slice(2),
      ].join(''),
    )
    .join('');
  const encodedTransactions = `0x${packed}` as Hex;
  const selector = keccak256(toHex('multiSend(bytes)')).slice(0, 10);
  return `${selector}${encodeAbiParameters([{ type: 'bytes' }], [encodedTransactions]).slice(2)}` as Hex;
};

const manualSafeTransactionHash = (
  safeAddress: Address,
  chainId: number | bigint,
  transaction: SafeTransactionData,
): Hex => {
  const typedData = buildSafeTransactionTypedData(safeAddress, chainId, transaction);
  const domainTypeHash = keccak256(
    toHex('EIP712Domain(uint256 chainId,address verifyingContract)'),
  );
  const safeTxTypeHash = keccak256(
    toHex(
      'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)',
    ),
  );
  const domainHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [domainTypeHash, BigInt(chainId), safeAddress],
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint8' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [
        safeTxTypeHash,
        typedData.message.to,
        typedData.message.value,
        keccak256(typedData.message.data),
        typedData.message.operation,
        typedData.message.safeTxGas,
        typedData.message.baseGas,
        typedData.message.gasPrice,
        typedData.message.gasToken,
        typedData.message.refundReceiver,
        typedData.message.nonce,
      ],
    ),
  );

  return keccak256(concatHex(['0x1901', domainHash, structHash]));
};

test('Safe EIP-712 transaction hash matches the Safe.sol layout', () => {
  const transaction: SafeTransactionData = {
    to: RECIPIENT,
    value: '0x7b',
    data: '0x1234',
    safeTxGas: 21_000,
    baseGas: '42',
    gasPrice: 3n,
    nonce: '5',
  };

  const typedData = buildSafeTransactionTypedData(SAFE_ADDRESS, 1, transaction);
  expect(typedData).toMatchObject({
    domain: { chainId: 1n, verifyingContract: SAFE_ADDRESS },
    primaryType: 'SafeTx',
    types: SAFE_TRANSACTION_TYPED_DATA_TYPES,
    message: {
      to: RECIPIENT,
      value: 123n,
      data: '0x1234',
      safeTxGas: 21_000n,
      baseGas: 42n,
      gasPrice: 3n,
      nonce: 5n,
    },
  });

  const safeTxHash = hashSafeTransactionTypedData(SAFE_ADDRESS, 1, transaction);
  expect(safeTxHash).toBe(manualSafeTransactionHash(SAFE_ADDRESS, 1, transaction));
  expect(hashSafeTransactionTypedData(SAFE_ADDRESS, 5, transaction)).not.toBe(safeTxHash);
  expect(
    hashSafeTransactionTypedData('0x000000000000000000000000000000000000515b', 1, transaction),
  ).not.toBe(safeTxHash);
});

test('SafeTransactionServiceClient uses Safe Transaction Service REST endpoints', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const safeTxHash = hashSafeTransactionData(SAFE_ADDRESS, 1, {
    to: RECIPIENT,
    value: 1n,
    data: '0x',
    nonce: 0,
  });

  const fetchImpl: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const responseBody = {
      safe: SAFE_ADDRESS,
      to: RECIPIENT,
      value: '1',
      data: '0x',
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: '0',
      contractTransactionHash: safeTxHash,
      sender: '0x0000000000000000000000000000000000000001',
      confirmations: [],
      isExecuted: false,
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = new SafeTransactionServiceClient({
    baseUrl: 'https://safe.test',
    apiPrefix: '/api/v1',
    fetch: fetchImpl,
  });

  await client.proposeTransaction({
    safeAddress: SAFE_ADDRESS,
    senderAddress: '0x0000000000000000000000000000000000000001',
    safeTxHash,
    senderSignature: deterministicSafeSignature(
      safeTxHash,
      '0x0000000000000000000000000000000000000001',
    ),
    origin: 'web3-tester',
    data: { to: RECIPIENT, value: 1n, data: '0x', nonce: 0 },
  });
  await client.confirmTransaction(safeTxHash, {
    owner: '0x0000000000000000000000000000000000000002',
    signature: deterministicSafeSignature(
      safeTxHash,
      '0x0000000000000000000000000000000000000002',
    ),
  });
  await client.getTransaction(safeTxHash);
  await client.listConfirmations(safeTxHash);
  await client.listTransactions(SAFE_ADDRESS);

  expect(requests.map((request) => `${request.init.method} ${new URL(request.url).pathname}`)).toEqual([
    `POST /api/v1/safes/${SAFE_ADDRESS}/multisig-transactions/`,
    `POST /api/v1/multisig-transactions/${safeTxHash}/confirmations/`,
    `GET /api/v1/multisig-transactions/${safeTxHash}/`,
    `GET /api/v1/multisig-transactions/${safeTxHash}/confirmations/`,
    `GET /api/v1/safes/${SAFE_ADDRESS}/multisig-transactions/`,
  ]);

  const proposeBody = JSON.parse(String(requests[0]!.init.body));
  expect(proposeBody).toMatchObject({
    to: RECIPIENT,
    value: '1',
    data: '0x',
    contractTransactionHash: safeTxHash,
    safeTxHash,
    sender: '0x0000000000000000000000000000000000000001',
    origin: 'web3-tester',
  });
});

test('SafeTransactionServiceClient refetches after empty Safe service POST responses', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const owner1 = '0x0000000000000000000000000000000000000001' as const;
  const owner2 = '0x0000000000000000000000000000000000000002' as const;
  const safeTxHash = hashSafeTransactionData(SAFE_ADDRESS, 1, {
    to: RECIPIENT,
    value: 1n,
    data: '0x',
    nonce: 0,
  });
  let confirmed = false;

  const responseBody = () => ({
    safe: SAFE_ADDRESS,
    to: RECIPIENT,
    value: '1',
    data: '0x',
    operation: 0,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: '0',
    contractTransactionHash: safeTxHash,
    sender: owner1,
    confirmations: confirmed
      ? [{ owner: owner2, signature: deterministicSafeSignature(safeTxHash, owner2) }]
      : [],
    isExecuted: false,
  });

  const fetchImpl: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const pathname = new URL(String(url)).pathname;
    if (init.method === 'POST' && pathname.endsWith('/multisig-transactions/')) {
      return new Response(null, { status: 201 });
    }
    if (init.method === 'POST' && pathname.endsWith('/confirmations/')) {
      confirmed = true;
      return new Response(null, { status: 201 });
    }
    if (init.method === 'GET' && pathname.endsWith(`/multisig-transactions/${safeTxHash}/`)) {
      return new Response(JSON.stringify(responseBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const client = new SafeTransactionServiceClient({
    baseUrl: 'https://safe.test',
    apiPrefix: '/api/v1',
    fetch: fetchImpl,
  });

  const proposed = await client.proposeTransaction({
    safeAddress: SAFE_ADDRESS,
    senderAddress: owner1,
    safeTxHash,
    senderSignature: deterministicSafeSignature(safeTxHash, owner1),
    data: { to: RECIPIENT, value: 1n, data: '0x', nonce: 0 },
  });
  expect(proposed.safeTxHash).toBe(safeTxHash);
  expect(proposed.confirmations).toEqual([]);

  const confirmedTransaction = await client.confirmTransaction(safeTxHash, {
    owner: owner2,
    signature: deterministicSafeSignature(safeTxHash, owner2),
  });
  expect(confirmedTransaction.confirmations).toHaveLength(1);
  expect(confirmedTransaction.confirmations[0]?.owner).toBe(owner2);

  expect(requests.map((request) => `${request.init.method} ${new URL(request.url).pathname}`)).toEqual([
    `POST /api/v1/safes/${SAFE_ADDRESS}/multisig-transactions/`,
    `GET /api/v1/multisig-transactions/${safeTxHash}/`,
    `POST /api/v1/multisig-transactions/${safeTxHash}/confirmations/`,
    `GET /api/v1/multisig-transactions/${safeTxHash}/`,
  ]);
});

test('SafeTransactionServiceClient computes EIP-712 safeTxHash when chainId is configured', async () => {
  const transaction: SafeTransactionData = {
    to: RECIPIENT,
    value: 1n,
    data: '0x',
    nonce: 0,
  };
  const expectedSafeTxHash = hashSafeTransactionTypedData(SAFE_ADDRESS, 1, transaction);
  let proposedBody: Record<string, unknown> | undefined;

  const fetchImpl: typeof fetch = async (_url, init = {}) => {
    proposedBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        ...proposedBody,
        safe: SAFE_ADDRESS,
        confirmations: [],
        isExecuted: false,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  const client = new SafeTransactionServiceClient({
    baseUrl: 'https://safe.test',
    chainId: 1,
    fetch: fetchImpl,
  });

  const proposed = await client.proposeTransaction({
    safeAddress: SAFE_ADDRESS,
    senderAddress: '0x0000000000000000000000000000000000000001',
    senderSignature: deterministicSafeSignature(
      expectedSafeTxHash,
      '0x0000000000000000000000000000000000000001',
    ),
    data: transaction,
  });

  expect(proposed.safeTxHash).toBe(expectedSafeTxHash);
  expect(proposedBody).toMatchObject({
    contractTransactionHash: expectedSafeTxHash,
    safeTxHash: expectedSafeTxHash,
  });
});

test('SafeWalletHarness proposes, confirms, enforces threshold, and records execution', async ({
  chain,
}) => {
  const [owner1, owner2] = (await chain.accounts()).slice(0, 2) as [Address, Address];
  const service = new InMemorySafeTransactionService();
  const safe = new SafeWalletHarness({
    safeAddress: SAFE_ADDRESS,
    owners: [owner1, owner2],
    threshold: 2,
    chainId: chain.client.chain.id,
    transactionService: service,
    rpcClient: chain,
  });

  const proposed = await safe.proposeTransaction({
    proposer: owner1,
    transaction: { to: RECIPIENT, value: 123n, data: '0x' },
    origin: 'web3-tester safe spec',
  });
  expect(proposed.confirmations.map((confirmation) => confirmation.owner)).toEqual([owner1]);

  await expect(safe.executeTransaction(proposed.safeTxHash)).rejects.toThrow(/1\/2 confirmations/);

  const confirmed = await safe.confirmTransaction(proposed.safeTxHash, { owner: owner2 });
  expect(confirmed.confirmations.map((confirmation) => confirmation.owner)).toEqual([
    owner1,
    owner2,
  ]);

  const balanceBefore = await chain.client.getBalance({ address: RECIPIENT });
  const executed = await safe.executeTransaction(proposed.safeTxHash, { executor: owner1 });
  expect(executed.txHash).toMatch(/^0x/);
  expect(executed.transaction.isExecuted).toBe(true);
  expect(executed.transaction.transactionHash).toBe(executed.txHash);

  await chain.client.waitForTransactionReceipt({ hash: executed.txHash! });
  await expect.poll(() => chain.client.getBalance({ address: RECIPIENT })).toBe(balanceBefore + 123n);

  const listed = await safe.listTransactions();
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({
    safeTxHash: proposed.safeTxHash,
    isExecuted: true,
    transactionHash: executed.txHash,
  });
});

test('injectSafeAppBridge answers Safe Apps SDK iframe requests', async ({ page, chain }) => {
  const [owner1, owner2] = (await chain.accounts()).slice(0, 2) as [Address, Address];
  const service = new InMemorySafeTransactionService();
  const safe = new SafeWalletHarness({
    safeAddress: SAFE_ADDRESS,
    owners: [owner1, owner2],
    threshold: 2,
    chainId: chain.client.chain.id,
    transactionService: service,
    rpcClient: chain,
  });

  const appHtml = `
      <script>
        const request = (method, params) => new Promise((resolve, reject) => {
          const id = Math.random().toString(16).slice(2);
          const handler = (event) => {
            if (!event.data || event.data.id !== id) return;
            window.removeEventListener('message', handler);
            if (event.data.success) resolve(event.data.data);
            else reject(new Error(event.data.error));
          };
          window.addEventListener('message', handler);
          parent.postMessage({ id, method, params, env: { sdkVersion: '1.0.0' } }, '*');
        });

        (async () => {
          const safeInfo = await request('getSafeInfo');
          const chainInfo = await request('getChainInfo');
          const environment = await request('getEnvironmentInfo');
          const balances = await request('getSafeBalances', { currency: 'usd' });
          const rpcChainId = await request('rpcCall', { call: 'eth_chainId', params: [] });
          const sent = await request('sendTransactions', {
            txs: [{ to: '${RECIPIENT}', value: '7', data: '0x' }],
            params: { safeTxGas: 21000 },
          });
          const details = await request('getTxBySafeTxHash', { safeTxHash: sent.safeTxHash });
          const addressBook = await request('requestAddressBook');
          window.results = {
            safeInfo,
            chainInfo,
            environment,
            balances,
            rpcChainId,
            sent,
            details,
            addressBook,
          };
        })().catch((error) => {
          window.results = { error: error.message };
        });
      </script>
  `;

  await page.setContent('<iframe id="safe-app"></iframe>');
  await injectSafeAppBridge(page, safe, {
    chainInfo: {
      chainName: 'Anvil Local',
      shortName: 'anvil',
      blockExplorerUriTemplate: { txHash: 'https://explorer.test/tx/{{txHash}}' },
    },
    environmentOrigin: 'https://safe-app.test',
    safeInfo: {
      implementation: owner1,
      modules: [owner2],
      fallbackHandler: null,
      guard: null,
      version: '1.4.1',
    },
    addressBook: [{ address: owner1, chainId: String(chain.client.chain.id), name: 'Owner 1' }],
    balances: {
      fiatTotal: '19.25',
      items: [
        {
          tokenInfo: {
            type: 'NATIVE_TOKEN',
            address: ZERO_ADDRESS,
            decimals: 18,
            symbol: 'ETH',
            name: 'Ether',
            logoUri: null,
          },
          balance: '7000000000000000000',
          fiatBalance: '19.25',
          fiatConversion: '2.75',
        },
      ],
    },
  });
  await page.locator('#safe-app').evaluate((iframe, srcdoc) => {
    (iframe as HTMLIFrameElement).srcdoc = srcdoc;
  }, appHtml);

  const frame = page.frameLocator('#safe-app');
  await expect.poll(() => frame.locator('body').evaluate(() => window.results)).toMatchObject({
    safeInfo: {
      safeAddress: SAFE_ADDRESS,
      chainId: chain.client.chain.id,
      threshold: 2,
      owners: [owner1, owner2],
      isReadOnly: false,
      nonce: 0,
      implementation: owner1,
      modules: [owner2],
      fallbackHandler: null,
      guard: null,
      version: '1.4.1',
    },
    chainInfo: {
      chainName: 'Anvil Local',
      chainId: String(chain.client.chain.id),
      shortName: 'anvil',
      blockExplorerUriTemplate: {
        txHash: 'https://explorer.test/tx/{{txHash}}',
      },
    },
    environment: { origin: 'https://safe-app.test' },
    balances: {
      fiatTotal: '19.25',
      items: [
        {
          tokenInfo: { type: 'NATIVE_TOKEN', address: ZERO_ADDRESS, symbol: 'ETH' },
          balance: '7000000000000000000',
          fiatBalance: '19.25',
          fiatConversion: '2.75',
        },
      ],
    },
    rpcChainId: '0x7a69',
    addressBook: [{ address: owner1, chainId: String(chain.client.chain.id), name: 'Owner 1' }],
  });

  const results = (await frame.locator('body').evaluate(() => window.results)) as {
    sent: { safeTxHash: string };
    details: {
      safeTxHash: string;
      txStatus: string;
      txData: { to: { value: string }; value: string; hexData: string };
      detailedExecutionInfo: {
        confirmationsRequired: number;
        confirmationsSubmitted: number;
      };
    };
  };
  expect(results.sent.safeTxHash).toMatch(/^0x/);
  expect(results.details).toMatchObject({
    safeTxHash: results.sent.safeTxHash,
    txStatus: 'AWAITING_CONFIRMATIONS',
    txData: {
      to: { value: RECIPIENT },
      value: '7',
      hexData: '0x',
    },
    detailedExecutionInfo: {
      confirmationsRequired: 2,
      confirmationsSubmitted: 1,
    },
  });

  const stored = await safe.getTransaction(results.sent.safeTxHash as `0x${string}`);
  expect(stored.confirmations.map((confirmation) => confirmation.owner)).toEqual([owner1]);
  expect(stored.confirmationsRequired).toBe(2);
});

test('Safe Apps bridge origin allowlist rejects missing and untrusted origins', async ({
  chain,
}) => {
  const [owner] = (await chain.accounts()).slice(0, 1) as [Address];
  const safe = new SafeWalletHarness({
    safeAddress: SAFE_ADDRESS,
    owners: [owner],
    threshold: 1,
    chainId: chain.client.chain.id,
    transactionService: new InMemorySafeTransactionService(),
  });
  const request = {
    id: 'safe-info',
    method: 'getSafeInfo',
    env: { sdkVersion: '1.0.0' },
  };

  await expect(
    handleSafeAppRequest(safe, request, {
      allowedOrigins: ['https://safe-app.test'],
    }),
  ).rejects.toThrow('Safe App origin "null" is not allowed.');

  await expect(
    handleSafeAppRequest(safe, request, {
      allowedOrigins: ['https://safe-app.test'],
      origin: 'https://evil.test/app',
    }),
  ).rejects.toThrow('Safe App origin "https://evil.test" is not allowed.');

  await expect(
    handleSafeAppRequest(safe, request, {
      allowedOrigins: ['https://safe-app.test'],
      origin: 'https://safe-app.test/app',
    }),
  ).resolves.toMatchObject({
    safeAddress: SAFE_ADDRESS,
    owners: [owner],
  });
});

test('Safe Apps sendTransactions batches multiple calls through MultiSendCallOnly', async ({
  chain,
}) => {
  const [owner] = (await chain.accounts()).slice(0, 1) as [Address];
  const service = new InMemorySafeTransactionService();
  const safe = new SafeWalletHarness({
    safeAddress: SAFE_ADDRESS,
    owners: [owner],
    threshold: 1,
    chainId: chain.client.chain.id,
    transactionService: service,
  });
  const txs = [
    { to: RECIPIENT, value: '7', data: '0x1234' as Hex },
    { to: SECOND_RECIPIENT, value: 9n, data: '0xabcd' as Hex },
  ];

  const response = (await handleSafeAppRequest(safe, {
    id: 'multi-send',
    method: 'sendTransactions',
    params: {
      txs,
      params: { safeTxGas: 45_000 },
      origin: 'safe multi spec',
    },
    env: { sdkVersion: '1.0.0' },
  })) as { safeTxHash: Hex };

  const stored = await safe.getTransaction(response.safeTxHash);
  expect(stored).toMatchObject({
    to: SAFE_MULTISEND_CALL_ONLY_ADDRESS,
    value: '0',
    data: manualMultiSendCallData(txs),
    operation: 1,
    safeTxGas: '45000',
    origin: 'safe multi spec',
  });
});

test('SafeWalletHarness defaults to EIP-712 safeTxHash and keeps fixture mode available', async ({
  chain,
}) => {
  const [owner] = (await chain.accounts()).slice(0, 1) as [Address];
  const transaction = { to: RECIPIENT, value: 1n, data: '0x', nonce: 9 } satisfies SafeTransactionData;

  const eip712Safe = new SafeWalletHarness({
    safeAddress: SAFE_ADDRESS,
    owners: [owner],
    threshold: 1,
    chainId: chain.client.chain.id,
    transactionService: new InMemorySafeTransactionService(),
  });
  await expect(
    eip712Safe.proposeTransaction({ proposer: owner, transaction }),
  ).resolves.toMatchObject({
    safeTxHash: hashSafeTransactionTypedData(SAFE_ADDRESS, chain.client.chain.id, transaction),
  });

  const fixtureSafe = new SafeWalletHarness({
    safeAddress: SAFE_ADDRESS,
    owners: [owner],
    threshold: 1,
    chainId: chain.client.chain.id,
    transactionService: new InMemorySafeTransactionService(),
    safeTxHashStrategy: 'fixture',
  });
  await expect(
    fixtureSafe.proposeTransaction({ proposer: owner, transaction }),
  ).resolves.toMatchObject({
    safeTxHash: hashSafeTransactionData(SAFE_ADDRESS, chain.client.chain.id, transaction),
  });
});
