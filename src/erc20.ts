import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import type { RpcClient } from './types.js';

export {
  TEST_ERC20_ABI,
  TEST_ERC20_BYTECODE,
  TEST_ERC20_SOLC_VERSION,
  TEST_ERC20_SOURCE_SHA256,
} from './contracts/test-erc20.js';

export type Erc20StorageLayout = 'solidity' | 'vyper';

export type Erc20SlotInfo = {
  layout: Erc20StorageLayout;
  /** Mapping base slot: a small integer, or an ERC-7201 namespace root. */
  balanceSlot: bigint;
  /** Discovered lazily on first adjustTotalSupply use. */
  totalSupplySlot?: bigint;
};

export type DealErc20Options = {
  /** forge-std deal(token,to,give,adjust) parity: shift totalSupply by the balance delta. Default false. */
  adjustTotalSupply?: boolean;
  /** Highest integer mapping base slot probed per layout. Default 64. */
  maxSlot?: number;
  /** Skip discovery with a known mapping base slot. */
  slot?: bigint | number;
  /** Layout used with `slot`. Default 'solidity'. */
  layout?: Erc20StorageLayout;
  /** Contract whose storage holds balances when it differs from `token`. */
  storageAddress?: Address;
};

export class Erc20DealError extends Error {
  constructor(
    message: string,
    readonly token: Address,
    /** Candidate slots tried across both layouts. */
    readonly probedSlots: number,
  ) {
    super(message);
    this.name = 'Erc20DealError';
  }
}

const MAX_UINT256 = 2n ** 256n - 1n;
// An improbable balance used as the discovery probe. Discovery never writes:
// candidates are tested with eth_call state overrides (stateDiff), so a
// crash mid-discovery cannot leave the chain dirty and probing is
// batch-parallel safe.
const PROBE_SENTINEL = 0xdea1dea1dea1dea1dea1dea1dea1dea1dea1dea1dea1dea1dea1dea1dea1dea1n;

// OZ v5 upgradeable ERC-20 (ERC-7201): _balances is the first struct member,
// so the mapping base IS the namespace root; _totalSupply sits at root+2.
const OZ_V5_ERC20_NAMESPACE_ROOT =
  0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;

const pad32 = (value: bigint): Hex => toHex(value, { size: 32 });

const mappingSlot = (layout: Erc20StorageLayout, holder: Address, base: bigint): Hex =>
  layout === 'solidity'
    ? keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, base]))
    : keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [base, holder]));

const balanceOfData = (holder: Address): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [holder] });

const totalSupplyData = (): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'totalSupply' });

type StateOverride = { address: Address; slot: Hex; value: Hex };

// eth_call returning the first uint256 word, optionally under a stateDiff
// override; undefined on revert/empty (treated as "no signal").
const callUint = async (
  client: RpcClient,
  to: Address,
  data: Hex,
  override?: StateOverride,
): Promise<bigint | undefined> => {
  const params: unknown[] = [{ to, data }, 'latest'];
  if (override) {
    params.push({ [override.address]: { stateDiff: { [override.slot]: override.value } } });
  }

  try {
    const result = await client.request({ method: 'eth_call', params });
    if (typeof result !== 'string' || result.length < 66) {
      return undefined;
    }
    return BigInt(result.slice(0, 66));
  } catch {
    return undefined;
  }
};

const getStorage = async (client: RpcClient, address: Address, slot: Hex): Promise<Hex> => {
  const result = await client.request({
    method: 'eth_getStorageAt',
    params: [address, slot, 'latest'],
  });
  return pad32(BigInt(String(result ?? '0x0')));
};

const setStorage = async (
  client: RpcClient,
  token: Address,
  address: Address,
  slot: Hex,
  value: Hex,
): Promise<void> => {
  try {
    await client.request({ method: 'anvil_setStorageAt', params: [address, slot, value] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|not supported|not available|does not exist|unknown method|unsupported/i.test(message)) {
      throw new Erc20DealError(
        'dealErc20 requires an anvil-backed client (the RPC rejected anvil_setStorageAt) — live chains cannot be dealt.',
        token,
        0,
      );
    }
    throw error;
  }
};

const probeSentinelFor = (current: bigint | undefined): bigint =>
  current === PROBE_SENTINEL ? PROBE_SENTINEL - 1n : PROBE_SENTINEL;

export async function discoverErc20BalanceSlot(
  client: RpcClient,
  token: Address,
  holder: Address,
  options: { maxSlot?: number; storageAddress?: Address } = {},
): Promise<Erc20SlotInfo> {
  const storageAddress = options.storageAddress ?? token;
  const maxSlot = options.maxSlot ?? 64;
  const data = balanceOfData(holder);

  const current = await callUint(client, token, data);
  if (current === undefined) {
    throw new Erc20DealError(
      `${token} does not implement balanceOf — not an ERC-20?`,
      token,
      0,
    );
  }
  const sentinel = probeSentinelFor(current);

  const candidates: Array<{ layout: Erc20StorageLayout; base: bigint }> = [];
  for (let base = 0n; base <= BigInt(maxSlot); base += 1n) {
    candidates.push({ layout: 'solidity', base });
    candidates.push({ layout: 'vyper', base });
  }
  candidates.push({ layout: 'solidity', base: OZ_V5_ERC20_NAMESPACE_ROOT });

  const BATCH = 8;
  for (let start = 0; start < candidates.length; start += BATCH) {
    const hits = await Promise.all(
      candidates.slice(start, start + BATCH).map(async (candidate) => {
        const slot = mappingSlot(candidate.layout, holder, candidate.base);
        const observed = await callUint(client, token, data, {
          address: storageAddress,
          slot,
          value: pad32(sentinel),
        });
        return observed === sentinel ? candidate : undefined;
      }),
    );

    const hit = hits.find(Boolean);
    if (hit) {
      return { layout: hit.layout, balanceSlot: hit.base };
    }
  }

  throw new Erc20DealError(
    `Could not find ${token}'s balance slot after probing ${candidates.length} candidates. ` +
      'Rebasing/shares tokens (stETH, aTokens) compute balanceOf and cannot be dealt this way; ' +
      'solady-style seeded layouts need chain.setStorageAt with a hand-computed slot; ' +
      'external-storage proxies need { storageAddress }; deep layouts may need a higher { maxSlot }.',
    token,
    candidates.length,
  );
}

export async function getErc20Balance(
  client: RpcClient,
  token: Address,
  account: Address,
): Promise<bigint> {
  const balance = await callUint(client, token, balanceOfData(account));
  if (balance === undefined) {
    throw new Erc20DealError(
      `${token} does not implement balanceOf — not an ERC-20?`,
      token,
      0,
    );
  }
  return balance;
}

export async function dealErc20(
  client: RpcClient,
  token: Address,
  account: Address,
  amount: bigint,
  options: DealErc20Options = {},
  cache?: Map<string, Erc20SlotInfo>,
): Promise<void> {
  if (typeof amount !== 'bigint') {
    throw new RangeError('dealErc20 amount must be a bigint.');
  }
  if (amount < 0n || amount > MAX_UINT256) {
    throw new RangeError('dealErc20 amount must be in [0, 2^256).');
  }

  const storageAddress = options.storageAddress ?? token;
  const cacheKey = storageAddress.toLowerCase();

  const explicit: Erc20SlotInfo | undefined =
    options.slot !== undefined
      ? { layout: options.layout ?? 'solidity', balanceSlot: BigInt(options.slot) }
      : undefined;

  let info = explicit ?? cache?.get(cacheKey);
  let freshlyDiscovered = false;
  if (!info) {
    info = await discoverErc20BalanceSlot(client, token, account, options);
    freshlyDiscovered = true;
  }

  const previousBalance = options.adjustTotalSupply
    ? ((await callUint(client, token, balanceOfData(account))) ?? 0n)
    : 0n;

  // The one real write, always verified; a non-verifying write is restored so
  // the worker chain is never left dirty (it outlives this call when used
  // outside the wallet fixture's snapshot/revert).
  const writeAndVerify = async (slotInfo: Erc20SlotInfo): Promise<boolean> => {
    const slot = mappingSlot(slotInfo.layout, account, slotInfo.balanceSlot);
    const previous = await getStorage(client, storageAddress, slot);
    await setStorage(client, token, storageAddress, slot, pad32(amount));
    if ((await callUint(client, token, balanceOfData(account))) === amount) {
      return true;
    }
    await setStorage(client, token, storageAddress, slot, previous);
    return false;
  };

  if (await writeAndVerify(info)) {
    if (freshlyDiscovered) {
      cache?.set(cacheKey, info);
    }
  } else {
    if (explicit) {
      throw new Erc20DealError(
        `balanceOf does not reflect a write at the explicit slot — wrong { slot }/{ layout }, or ${token} computes balanceOf.`,
        token,
        0,
      );
    }
    if (freshlyDiscovered) {
      throw new Erc20DealError(
        `Discovery matched a slot but the final write did not verify — ${token} likely computes balanceOf (shares/rebasing).`,
        token,
        0,
      );
    }

    // Stale cache: snapshot reverts reset deployer nonces, so a different
    // contract can reuse a previously-cached address. Evict and rediscover
    // once.
    cache?.delete(cacheKey);
    const rediscovered = await discoverErc20BalanceSlot(client, token, account, options);
    if (!(await writeAndVerify(rediscovered))) {
      throw new Erc20DealError(
        `Verification failed even after rediscovery — ${token} likely computes balanceOf (shares/rebasing).`,
        token,
        0,
      );
    }
    cache?.set(cacheKey, rediscovered);
    info = rediscovered;
  }

  if (options.adjustTotalSupply) {
    await adjustTotalSupply(client, token, storageAddress, info, amount - previousBalance, {
      maxSlot: options.maxSlot ?? 64,
      cache: explicit ? undefined : cache,
      cacheKey,
    });
  }
}

const adjustTotalSupply = async (
  client: RpcClient,
  token: Address,
  storageAddress: Address,
  info: Erc20SlotInfo,
  delta: bigint,
  context: { maxSlot: number; cache?: Map<string, Erc20SlotInfo>; cacheKey: string },
): Promise<void> => {
  if (delta === 0n) {
    return;
  }

  const data = totalSupplyData();
  const currentSupply = await callUint(client, token, data);
  if (currentSupply === undefined) {
    throw new Erc20DealError(`${token} does not implement totalSupply.`, token, 0);
  }

  const newSupply = currentSupply + delta;
  if (newSupply < 0n) {
    throw new Erc20DealError(
      `adjustTotalSupply would underflow: totalSupply ${currentSupply} with delta ${delta} (forge-std deal reverts here too).`,
      token,
      0,
    );
  }
  if (newSupply > MAX_UINT256) {
    throw new Erc20DealError(
      `adjustTotalSupply would overflow uint256: totalSupply ${currentSupply} with delta ${delta}.`,
      token,
      0,
    );
  }

  let supplySlot = info.totalSupplySlot;
  if (supplySlot === undefined) {
    supplySlot = await discoverPlainSlot(client, token, storageAddress, data, currentSupply, info, context.maxSlot);
    info.totalSupplySlot = supplySlot;
    context.cache?.set(context.cacheKey, info);
  }

  const slot = pad32(supplySlot);
  const previous = await getStorage(client, storageAddress, slot);
  await setStorage(client, token, storageAddress, slot, pad32(newSupply));
  if ((await callUint(client, token, data)) !== newSupply) {
    await setStorage(client, token, storageAddress, slot, previous);
    info.totalSupplySlot = undefined;
    throw new Erc20DealError(
      `${token}'s totalSupply did not reflect the adjustment — it is likely computed.`,
      token,
      0,
    );
  }
};

// Plain (unkeyed) slot discovery for totalSupply, also via state overrides.
const discoverPlainSlot = async (
  client: RpcClient,
  token: Address,
  storageAddress: Address,
  data: Hex,
  current: bigint,
  info: Erc20SlotInfo,
  maxSlot: number,
): Promise<bigint> => {
  const sentinel = probeSentinelFor(current);

  const candidates: bigint[] = [];
  if (info.balanceSlot === OZ_V5_ERC20_NAMESPACE_ROOT) {
    candidates.push(info.balanceSlot + 1n, info.balanceSlot + 2n, info.balanceSlot + 3n);
  }
  for (let base = 0n; base <= BigInt(maxSlot); base += 1n) {
    candidates.push(base);
  }

  for (const base of candidates) {
    const observed = await callUint(client, token, data, {
      address: storageAddress,
      slot: pad32(base),
      value: pad32(sentinel),
    });
    if (observed === sentinel) {
      return base;
    }
  }

  throw new Erc20DealError(
    `Could not find ${token}'s totalSupply slot after probing ${candidates.length} candidates.`,
    token,
    candidates.length,
  );
};
