# web3-tester roadmap scoping — 2026-06-10

Implementation-ready designs for all seven roadmap features (the ecosystem-gap findings from
`web3-tester-library-review-2026-06-09.md`). Produced by a 15-agent workflow — one design agent per
feature (code-grounded + web-verified externals), one adversarial feasibility verifier per design, and a
cross-feature consistency/sequencing pass — plus a standalone re-run of the matchers verification after
the in-workflow verifier died on an API error.

Every design received a `needs-revision` verdict with concrete corrections; none was found infeasible in
its core. The corrections are folded into the sequencing plan's **must-fix list** and are part of the spec:
a design below is implementation-ready only WITH its adversarial-review section applied.

The companion digest (phases, rulings, per-feature summaries) is `docs/ROADMAP.md`.


---

# Part 1 — Feature designs


## multichain — Multi-chain RPC routing in mock mode

**Review verdict:** needs-revision.

### Goal

A consumer can register multiple chains on the mock wallet (each backed by its own Anvil node, RPC URL, or any RpcClient), and after a dapp-driven wallet_switchEthereumChain every forwarded RPC (reads, eth_sendTransaction, signing) is routed to the backend for the active chain instead of silently hitting the original node. The standard wagmi/RainbowKit flow — switch, catch 4902, wallet_addEthereumChain, verify eth_chainId — works end to end, switching to a registered-but-unbacked chain fails loudly (4901) instead of lying, transactions are recorded with the chain they executed on, and the bundled fixtures can spin up one extra Anvil per chain per worker with a chains map of ChainControllers alongside the existing chain fixture.

### API surface

```typescript
// ── src/mock-wallet-controller.ts ──────────────────────────────────────────
/** A chain backend: any RpcClient, or an http(s) RPC URL string. */
export type ChainBackend = RpcClient | string;

export type MockWalletControllerOptions = {
  accounts: readonly Address[];
  chainId: number | Hex;
  /**
   * Additional chains the wallet can switch to, keyed by chain id
   * (number or 0x-hex). The constructor's rpcClient remains the backend
   * for `chainId`; listing `chainId` here too is a construction error.
   */
  chains?: Readonly<Record<number | Hex, ChainBackend>>;
  /**
   * Honor dapp-supplied rpcUrls[0] in wallet_addEthereumChain: the URL is
   * probed (eth_chainId must match, per EIP-3085) and wired up as that
   * chain's backend. Default false: the chain id is registered (so the
   * 4902→add→switch flow completes) but forwarded calls on it throw 4901
   * until a backend is registered via `chains` or addChain().
   */
  trustDappRpcUrls?: boolean;
  // ...existing: providerInfo, additionalProviders, autoApprove, connected, allowedOrigins
};

export class MockWalletController {
  /** Test-side chain registration (Synpress addNetwork analogue). */
  addChain(chainId: number | Hex, backend: ChainBackend): void;
  /** Chain ids that currently have an RPC backend, canonical hex. */
  get backedChainIds(): readonly Hex[];
  // existing surface unchanged: switchNetwork, approveNext, holdNextRequest, …
}

/** Adapter: EIP-1193 RpcClient over a plain JSON-RPC URL (viem http transport). */
export function httpRpcClient(url: string): RpcClient;

export type SentTransactionRecord = {
  hash: Hex;
  chainId: Hex;            // NEW — wallet's active chain when the tx was sent
  from?: Address;
  to?: Hex;
  data?: Hex;
  value?: string;
};

// ── src/fixtures.ts ────────────────────────────────────────────────────────
/** Spec for one extra per-worker Anvil chain. Port/host are fixture-managed. */
export type AnvilChainSpec =
  Omit<AnvilOptions, 'port' | 'host' | 'allowNonLoopbackHost'> & { chainId: number };

export type Web3WorkerFixtures = {
  anvil: AnvilInstance;
  chain: ChainController;
  anvilOptions: AnvilOptions;
  /** Worker option, default []. One AnvilInstance is started per entry. */
  extraChains: readonly AnvilChainSpec[];
  /** Worker-scoped: extra chainId -> running AnvilInstance. */
  extraAnvils: ReadonlyMap<number, AnvilInstance>;
  /** Worker-scoped: chainId -> ChainController, INCLUDING the primary chain. */
  chains: ReadonlyMap<number, ChainController>;
};

// ── usage ──────────────────────────────────────────────────────────────────
import { expect, test } from '@marigoldlabs/web3-tester/fixtures';

test.use({ extraChains: [{ chainId: 84532 }] }); // worker option: boots a 2nd anvil

test('wagmi switch → 4902 → add → reads route to Base Sepolia', async ({ page, wallet, chain, chains }) => {
  const base = chains.get(84532)!;
  await base.setBalance(wallet.primaryAccount, 7n * 10n ** 18n);

  // dapp-side: wagmi's injected connector does exactly this on switchChain()
  await page.evaluate(() => window.ethereum.request({
    method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }],
  }));
  const balance = await page.evaluate((a) => window.ethereum.request({
    method: 'eth_getBalance', params: [a, 'latest'],
  }), wallet.primaryAccount);
  expect(BigInt(balance)).toBe(7n * 10n ** 18n);          // read hit the Base anvil

  await page.evaluate(() => window.ethereum.request({
    method: 'eth_sendTransaction', params: [{ to: '0x…beef', value: '0xde0b6b3a7640000' }],
  }));
  expect(wallet.sentTransactionRequests.at(-1)?.chainId).toBe('0x14a34');
});

// Direct (no fixtures), mirrors @johanneskares/wallet-mock transports map:
const wallet = new MockWalletController(page, chainA, {
  accounts, chainId: 31337,
  chains: { 84532: chainB, '0xa': httpRpcClient('http://127.0.0.1:19703') },
  trustDappRpcUrls: false,
});

// Live mode (no live-fixtures change needed — walletOptions passes through):
test.use({ liveOptions: { walletOptions: { chains: {
  [baseSepolia.id]: new PrivateKeyRpcClient({ privateKey, chain: baseSepolia, rpcUrl: process.env.BASE_SEPOLIA_RPC_URL }),
} } } });
```

### Behavior

**State model.** `MockWalletController` replaces the single implicit forward target with `private readonly chainBackends = new Map<Hex, RpcClient>()`. The constructor seeds it with `normalizeChainId(options.chainId) -> rpcClient` (the positional arg keeps its meaning: backend of the default chain) plus every `options.chains` entry (`string` values wrapped via `httpRpcClient`). Listing the default `chainId` in `chains` throws an `Error` at construction (ambiguous config). `knownChainIds` is seeded with the default id plus all `chains` keys, so configured chains are switchable without a prior `wallet_addEthereumChain`. **Canonicalization fix:** `normalizeChainId` becomes `toHex(typeof id === 'number' ? id : BigInt(id))` so `'0xAA36A7'`, `'0x0aa36a7'`, and `11155111` all map to one key (today's pass-through hex would make map lookups case-sensitive — a real bug once ids key a map); unparseable hex in dapp params throws `providerError(-32602, …)`.

**Routing rules.** Wallet-local, never forwarded (unchanged): `eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `net_version`, `wallet_getPermissions/requestPermissions/revokePermissions`, `wallet_switchEthereumChain`, `wallet_addEthereumChain`, `wallet_watchAsset`, `metamask_getProviderState`, unknown `wallet_*` → 4200. Routed through a new `private get activeRpcClient(): RpcClient` (lookup `chainBackends.get(this.chainId)`): `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_sign`, `personal_sign`, `eth_signTypedData_v3` (still rewritten to `_v4`), `eth_signTypedData_v4`, and the default fall-through. If the active chain has no backend, `activeRpcClient` throws `providerError(4901, 'The wallet is not connected to chain "0x…". It was added without an RPC backend — pass it in MockWalletControllerOptions.chains, call wallet.addChain(chainId, clientOrUrl), or enable trustDappRpcUrls.')` — 4901 is EIP-1193's "Chain Disconnected: the Provider is not connected to the requested chain", exactly this situation. All existing approval gating (`assertUserApproved`, `holdNextRequest`, `approveNext`, rejection queue, `allowedOrigins`) sits in front of routing untouched.

**wallet_switchEthereumChain** (per-request semantics): `-32602` if `params[0].chainId` missing/unparseable; `4902` with the existing "Try adding the chain using wallet_addEthereumChain first." message if not in `knownChainIds`; otherwise approval-gated as today, sets `chainId`, emits `chainChanged`, returns `null`. Switching to a known-but-unbacked chain SUCCEEDS (matching MetaMask, which switches even when the RPC later turns out unreachable and then surfaces per-request 'Internal JSON-RPC error') — the failure is deferred to forwarded calls (4901). This is the deliberate replacement for today's silent wrong-chain forwarding; a test that wants the old cosmetic behavior states the lie explicitly: `chains: { '0xaa36a7': chain }` (aliasing two ids to one backend is allowed).

**wallet_addEthereumChain** (EIP-3085): `-32602` for missing/non-0x `chainId` (existing). New: if `trustDappRpcUrls` is true and `rpcUrls?.[0]` is a string, validate it is http(s) (`-32602` otherwise; we deliberately allow `http:` because localhost Anvil is the dominant test case, deviating from EIP-3085's https-only rule — documented), probe it with a bounded (5s) `eth_chainId` fetch (same pattern as `AnvilInstance.reportedChainId`), and reject with `providerError(-32602, 'rpcUrls[0] reports chain id X but Y was requested.')` on mismatch or unreachability — EIP-3085: "The wallet must reject the request if the chainId does not match the value of the eth_chainId method for any of the RPC urls." On success the URL is registered as the chain's backend. With `trustDappRpcUrls` false (default — EIP-3085 explicitly says dapp rpcUrls "cannot be assumed to be honest", and in live mode the controller fronts a real key), `rpcUrls` is ignored and only the chain id is registered. In both cases the handler then auto-switches and emits `chainChanged` (existing behavior, kept deliberately: wagmi's injected connector verifies `eth_chainId === target` after add and throws UserRejectedRequestError if the wallet didn't switch — verified in wagmi source). An add for an already-backed chain id does NOT overwrite the backend (re-add of a known chain is a no-op switch, like MetaMask).

**addChain(chainId, backend)** is the test-side API (Synpress `addNetwork` analogue): adds to both `chainBackends` and `knownChainIds`, no approval gate, no probe (the test is trusted), overwrites an existing backend (tests may rewire). `switchNetwork` keeps its documented permissive semantics (registers the id as user-approved) but forwarded calls afterwards obey routing — so `switchNetwork` to an unbacked id still works for wrong-network-banner tests (`eth_chainId`/mirror props are wallet-local) while reads throw 4901.

**Tx recording:** both `eth_sendTransaction` and `eth_sendRawTransaction` push `chainId: this.chainId` into `SentTransactionRecord` (additive; the matchers feature can consume it). `sentTransactions`/`waitForNextTransaction` unchanged and remain cross-chain global.

**httpRpcClient:** `const t = http(url)({}); return { request: ({ method, params }) => t.request({ method, params } as never) }` — viem transports are `factory(config) => { request }` (same pattern wallet-mock's README uses); zero new deps, viem is already a peer. Caveat documented: URL-backed chains serve reads, `eth_sendRawTransaction`, and dapp-side flows, but node-side signing methods (`personal_sign`, `eth_sign`, typed data, `eth_sendTransaction`) forward to a node that won't sign → the RPC's own -32601/-32000 surfaces. For chains that must sign, back them with Anvil (the fixture does) or an RpcClient that signs (e.g. `PrivateKeyRpcClient`).

**Fixtures:** new worker-scoped option `extraChains` (default `[]`). `extraAnvils` starts one `AnvilInstance` per spec — duplicate chain ids (against the primary or each other) throw at setup. Port allocation: primary keeps `workerPort(workerIndex) = (ANVIL_PORT ?? 8645) + workerIndex`; extras get `(ANVIL_PORT ?? 8645) + 1000 + workerIndex * 20 + index` — a dedicated band 20 wide per worker that cannot collide with the primary band, honoring `ANVIL_PORT` as the whole-band shifter and matching the band discipline of `tests/anvil.spec.ts` (19100) / `tests/private-key-rpc-client.spec.ts` (19510); `AnvilInstance.start`'s existing bind-failure/chain-id-mismatch errors stay the loud failure mode. `chains` maps chainId → `ChainController` for primary + extras. The `wallet` fixture snapshots EVERY controller in `chains` before the test and reverts all in `finally` (per-chain isolation), and passes `chains: Object.fromEntries(extras)` (primary excluded — it's the positional `rpcClient`) to the controller. Same default mnemonic means the same funded accounts exist on every extra Anvil.

**Live-fixtures interplay:** no code change required — `LiveFixtureOptions.walletOptions` already spreads into `MockWalletControllerOptions`, so once `chains` exists there, multi-chain live = one `PrivateKeyRpcClient` per extra chain (same key, each enforcing its own testnet/allowMainnet guard and `assertRpcChainMatches` probe), as in the usage example. `PrivateKeyRpcClient` stays single-chain by design. Deny-by-default approval gating is untouched: `wallet_switchEthereumChain`/`wallet_addEthereumChain` remain `APPROVAL_GATED_METHODS`, so live tests still `approveNext('wallet_switchEthereumChain')` before a dapp switch. A `LiveFixtureOptions.extraChains` sugar is deferred (open question).

**Edge cases:** hex-case/leading-zero aliases collapse to one chain; `chains: {}` ≡ omitted; add-then-re-add keeps the first backend; `trustDappRpcUrls` probe failure leaves wallet state untouched (no partial registration, no switch); 4901 from `activeRpcClient` is thrown before the request leaves the bridge so `serializeRpcError` delivers `{code: 4901}` to the page; emit('chainChanged') already refreshes the injected provider's sync mirrors (`chainId`, `networkVersion`) on every page in the context.

### Files touched

| Path | Change |
| --- | --- |
| `/Users/adhyr/Repos/web3-tester/src/mock-wallet-controller.ts` | Add ChainBackend type, chains + trustDappRpcUrls options, chainBackends map, activeRpcClient getter (4901), addChain()/backedChainIds, httpRpcClient export, EIP-3085 rpcUrls probe in wallet_addEthereumChain, chainId on SentTransactionRecord, normalizeChainId canonicalization via BigInt/toHex; route all forwards (sendTransaction, sendRawTransaction, signing, default) through activeRpcClient |
| `/Users/adhyr/Repos/web3-tester/src/fixtures.ts` | Add extraChains worker option (AnvilChainSpec[]), extraAnvils and chains worker fixtures with the +1000 per-worker port band, duplicate-chainId guard; wallet fixture snapshots/reverts every ChainController in chains and passes the extras map to MockWalletControllerOptions.chains |
| `/Users/adhyr/Repos/web3-tester/src/index.ts` | Export httpRpcClient and types ChainBackend, AnvilChainSpec; Web3WorkerFixtures type update flows through existing fixture export |
| `/Users/adhyr/Repos/web3-tester/src/live-fixtures.ts` | Doc-comment only: note that walletOptions.chains is the multi-chain path (one PrivateKeyRpcClient per chain); no functional change |
| `/Users/adhyr/Repos/web3-tester/tests/mock-wallet-multichain.spec.ts` | New hermetic spec (port band 19700 + workerIndex*20): direct MockWalletController over 2-3 AnvilInstances covering routing, 4902→add→switch, trustDappRpcUrls probe accept/mismatch/non-http, 4901 unbacked chain, per-chain tx records, addChain, hex-alias canonicalization, httpRpcClient adapter |
| `/Users/adhyr/Repos/web3-tester/tests/fixtures-multichain.spec.ts` | New hermetic spec using test.use({ extraChains: [{ chainId: 84532 }] }): chains fixture map, wallet routing after dapp switch, per-chain snapshot/revert isolation across two tests |
| `/Users/adhyr/Repos/web3-tester/tests/mock-wallet.spec.ts` | Extend sentTransactionRequests assertions with chainId; add a regression that single-chain behavior (no chains option) is byte-for-byte unchanged |
| `/Users/adhyr/Repos/web3-tester/playwright.config.ts` | Add **/mock-wallet-multichain.spec.ts and **/fixtures-multichain.spec.ts to the library project's testMatch |
| `/Users/adhyr/Repos/web3-tester/docs/API.md` | Document chains/trustDappRpcUrls options, addChain, backedChainIds, httpRpcClient, 4901/4902 semantics table, extraChains/chains/extraAnvils fixtures, port-band note, live multi-chain recipe, URL-backed-chain signing caveat |
| `/Users/adhyr/Repos/web3-tester/CHANGELOG.md` | 0.3.0 entry; call out the behavior change: forwarded calls after switching to an unbacked chain now throw 4901 instead of silently hitting the default node, with the explicit-aliasing migration note |
| `/Users/adhyr/Repos/web3-tester/dist` | Rebuild committed dist (npm run build) to satisfy the CI freshness gate |

### New dependencies

None.

### Test strategy

All new tests are hermetic and join the `library` Playwright project (npm test). (1) tests/mock-wallet-multichain.spec.ts — fresh port band 19700 + workerIndex*20 per the anvil.spec.ts (19100) / private-key-rpc-client.spec.ts (19510) convention; boots AnvilInstances directly (chainIds 31337/84532/10) and constructs MockWalletController without fixtures. Pins down: post-switch read routing (distinct setBalance per node observed via injected eth_getBalance); the full wagmi flow (switch unknown → assert code 4902, add → null + chainChanged + eth_chainId updated — mirrors wagmi's post-add verification); 4901 on forwarded calls to an unbacked added chain; trustDappRpcUrls probe (accept matching local anvil URL, -32602 on chain-id mismatch and on non-http rpcUrls — the probe targets a local anvil so it stays hermetic); per-chain SentTransactionRecord.chainId with receipt present only on the target node; addChain + switchNetwork test-side path; hex-alias canonicalization ('0xAA36A7' add, '0xaa36a7' switch); approval gating still in front (autoApprove(false) → 4001 on switch). (2) tests/fixtures-multichain.spec.ts — test.use({ extraChains: [...] }) (worker option ⇒ dedicated worker), pins the chains fixture map (primary included), wallet wiring, the extras port band not colliding with the primary, and snapshot/revert isolation: test A mutates balance on the extra chain, test B asserts the pristine value. (3) Regression in mock-wallet.spec.ts that a chains-less controller behaves exactly as before (no 4901 anywhere, default forwards intact). Live multi-chain (real Sepolia + Base Sepolia keys) cannot be hermetic; instead the PrivateKeyRpcClient-per-chain composition is proven hermetically in (1) by backing a second chain with a PrivateKeyRpcClient pointed at a local anvil (same pattern private-key-rpc-client.spec.ts already uses), and the env-gated fjord-live suites remain the real-network check.

### Effort

4 focused days. Controller routing + EIP-3085 probe + canonicalization ≈ 1d; fixtures (extra Anvils, port banding, multi-snapshot wallet teardown) ≈ 0.5–1d; the two new multi-Anvil specs dominate (boot orchestration, timing, negative probe cases) ≈ 1.5d; docs/API.md + CHANGELOG + dist rebuild + typecheck/verify ≈ 0.5d.

### Depends on

Nothing (but see the sequencing plan — shared-substrate ordering still applies).

### Risks

- **Behavior change: today a dapp/test that switches chains and keeps reading silently hits the default node and 'works'; after this it gets 4901. Downstream suites (e.g. fjord wrong-network-banner tests that read through the provider post-switch) could break on upgrade.**
  Mitigation: knownChainIds-only switches still succeed and eth_chainId/net_version/mirror props stay wallet-local, so banner tests that don't forward reads are unaffected; CHANGELOG 0.3.0 documents the change with the one-line migration (chains: { '0xaa36a7': chain } aliases the old behavior explicitly); single-chain controllers without a chains option are bit-identical by construction and pinned by a regression test.
- **Port collisions from the new extras band (workers * extra chains) against developer-run nodes or the primary band on big CI matrices.**
  Mitigation: Dedicated +1000 offset band, 20 ports per worker, shifted wholesale by the existing ANVIL_PORT env; AnvilInstance.start already fails loudly (bind error + wrong-chain-id probe) rather than adopting a stranger node; band documented next to workerPort.
- **trustDappRpcUrls performs a network probe inside the request handler — a hung URL would stall the dapp's promise, and enabling it in live mode lets a page-controlled URL receive requests from the test process.**
  Mitigation: Probe timeout bounded (AbortSignal.timeout(5_000)) with unreachable → -32602 immediately; default is false and live-fixtures never enables it; docs state explicitly that live tests should pre-register chains via walletOptions.chains instead.
- **URL-backed chains cannot service node-side signing (eth_sendTransaction/personal_sign forward to a public RPC that won't sign), which users may misread as a routing bug.**
  Mitigation: docs/API.md caveat plus a deliberate spec asserting the surfaced node error; fixture-created chains are always Anvil-backed (full signing), and PrivateKeyRpcClient is the documented signing backend for remote chains.
- **Each extraChains worker boots additional Anvil processes, growing npm test wall-time and per-worker memory.**
  Mitigation: Anvils are worker-scoped (started once, snapshot/revert per test); the new fixture spec uses exactly one extra chain; multichain controller spec manages its own short-lived instances in beforeAll/afterAll.

### External facts verified by the designer

- @johanneskares/wallet-mock current API: installMockWallet({ page, account, defaultChain, transports }) with transports as a per-chain-id map of viem Transports (e.g. { [sepolia.id]: http() }), custom transports via factory functions — verified at github.com/johanneskares/wallet-mock README; it does not document dynamic wallet_addEthereumChain handling, so our dapp-driven add is a differentiator, not parity
- wagmi injected connector switchChain flow: falls back to wallet_addEthereumChain when error.code === 4902 OR error.data?.originalError?.code === 4902 (MetaMask Mobile wrapping); passes { chainId: numberToHex, chainName, rpcUrls (default chain.rpcUrls.default.http[0]), nativeCurrency, blockExplorerUrls }; after add it verifies the wallet's current eth_chainId equals the target and throws UserRejectedRequestError otherwise — verified in raw.githubusercontent.com/wevm/wagmi/main/packages/core/src/connectors/injected.ts; this is why the mock keeps auto-switching after wallet_addEthereumChain
- EIP-3085 normative requirements: only chainId is required; 'The wallet must reject the request if the chainId does not match the value of the eth_chainId method for any of the RPC urls'; MUST return null on success; 'The chain MUST NOT be assumed to be automatically selected'; dapp rpcUrls 'cannot be assumed to be honest, correct, or even pointing to the same chain' (basis for trustDappRpcUrls default-false and the probe) — verified at eips.ethereum.org/EIPS/eip-3085; we knowingly deviate from its https-only rule to allow localhost http
- MetaMask behavior with an added-but-unreachable chain: the switch itself can succeed and subsequent interaction surfaces 'Internal JSON-RPC error' when the wallet cannot reach the RPC (support.metamask.io networks troubleshooting; MetaMask extension/mobile issue trackers) — basis for letting the switch succeed and deferring failure to forwarded calls; we use EIP-1193's 4901 ('Chain Disconnected — the Provider is not connected to the requested chain') for a more diagnosable harness error, flagged as an open question
- viem transport-as-RpcClient pattern: a viem Transport is factory(config) => ({ request }), so http(url)({}).request({ method, params }) is a valid EIP-1193 request fn — confirmed by wallet-mock's documented custom-transport example http()(config).request({ method, params }); viem is already a peer dep so httpRpcClient adds zero deps
- In-repo facts re-verified by reading source: switchNetwork/wallet_addEthereumChain currently only touch this.chainId/knownChainIds while every forward hits the single this.rpcClient (src/mock-wallet-controller.ts:373-378, 526-539, 553-607); 4902 already thrown for unknown chains (line 516-521); workerPort = (ANVIL_PORT ?? 8645) + workerIndex (src/fixtures.ts:26-27); test port bands 19100/19510 + workerIndex*20 (tests/anvil.spec.ts:6, tests/private-key-rpc-client.spec.ts:154); live walletOptions spreads into MockWalletControllerOptions (src/live-fixtures.ts:81-97) so chains passes through with zero live-fixtures changes; current normalizeChainId does not canonicalize hex case/leading zeros (src/mock-wallet-controller.ts:106-107)

### Open questions

- Error code for forwarded calls on a registered-but-unbacked chain: I chose EIP-1193 4901 ('Chain Disconnected', semantically exact and grep-able in test failures) over MetaMask's real-world -32603 'Internal JSON-RPC error' for unreachable RPCs. If strict MetaMask fidelity wins, swap the code in one place (activeRpcClient) — tests/docs are written against a named constant either way.
- Should wallet_addEthereumChain without trustDappRpcUrls still auto-switch (proposed: yes, because wagmi's post-add eth_chainId verification hard-fails otherwise), or refuse to switch into a 4901 state? Yes matches the flow we exist to test; no is more honest but breaks wagmi.
- chains worker fixture includes the primary chain under its chainId (proposed: yes, so chains.get(id) is total over all running chains) — or extras-only to mirror the controller option exactly?
- Add a LiveFixtureOptions.extraChains convenience (auto-building one PrivateKeyRpcClient per viem Chain from env-var RPC URLs) now, or ship the documented walletOptions.chains composition first and let real usage decide? I scoped only the latter.
- Is overwrite-on-addChain (test-side rewiring allowed) vs first-registration-wins for dapp wallet_addEthereumChain the right asymmetry, or should a trusted dapp re-add with new rpcUrls be allowed to replace a probe-registered backend?

### Adversarial review

**Corrections:**
- EIP-3085 fact as stated is wrong: the design claims 'only chainId is required' as the basis for accepting chainId-only wallet_addEthereumChain. The current spec text at eips.ethereum.org/EIPS/eip-3085 also normatively says 'The wallet MUST reject the request if the rpcUrls field is not provided, or if the rpcUrls field is an empty array' and 'MUST reject ... if the rpcUrls contains any strings that are not valid URLs' (the 'only chainId is required' sentence is immediately qualified by 'a wallet MAY require any other fields ... or ignore them outright'). Real MetaMask likewise rejects adds lacking rpcUrls/chainName/nativeCurrency. The proposed default (trustDappRpcUrls=false: ignore rpcUrls entirely, return null) is therefore a deliberate permissive deviation from both the spec and MetaMask, not spec compliance — reframe the docs/changelog text accordingly (the behavior itself is fine for a test harness and matches the existing handler at src/mock-wallet-controller.ts:526-539).
- Internal contradiction in wallet_switchEthereumChain ordering: the design specifies '-32602 ... ; 4902 ...; otherwise approval-gated as today', but TODAY assertUserApproved runs FIRST (src/mock-wallet-controller.ts:510-521 — approval, then -32602, then 4902). These cannot both hold. As currently coded, in deny-by-default live mode a switch to an unknown chain yields 4001 (or silently consumes an armed approveNext grant and then throws 4902), whereas real MetaMask returns 4902 immediately without showing any prompt. The design's written order (validate → 4902 → approve) is the better, more faithful one, but it is a behavior change to existing deny-mode semantics (an unapproved unknown-chain switch flips from 4001 to 4902) that the design's own test plan contradicts ('autoApprove(false) → 4001 on switch' only stays true for known chains). Pick the order explicitly, add a deny-mode 4902-without-approval test, and note it in the CHANGELOG. Relatedly, the goal text 'switching to a registered-but-unbacked chain fails loudly (4901)' contradicts the behavior section (the switch SUCCEEDS; only subsequent forwarded calls throw 4901) — the behavior section is the correct one.
- 'Single-chain controllers without a chains option are bit-identical by construction' is false: the normalizeChainId rewrite (toHex(BigInt(...))) changes observable output for any existing consumer passing non-canonical hex. Today new MockWalletController(page, client, { chainId: '0xAA36A7' }) round-trips '0xAA36A7' verbatim through eth_chainId, currentChainId, chainChanged payloads, and the injected provider's chainId mirror (src/mock-wallet-controller.ts:106-107 is a pass-through; src/injected-provider.ts:137-139 stores the payload as-is); after the change these become '0xaa36a7'. Benign and arguably a fix, but the planned 'byte-for-byte unchanged' regression test cannot pin that claim, and canonicalization must be listed as its own CHANGELOG behavior change. Also note BigInt('garbage') throws SyntaxError, not providerError — the -32602 wrapping for dapp params (and a plain Error for constructor/chains-key parsing) must be explicit code, since today's switch handler only checks truthiness of chainId.
- Fixture extras as written break under supported Anvil configurations: AnvilChainSpec omits only port/host/allowNonLoopbackHost, and the design never says extra instances inherit the worker anvilOptions. test.use({ extraChains: [{ chainId: 84532 }] }) would call AnvilInstance.start with executable/runtime/dockerImage/silent undefined, falling back to process.env.ANVIL_EXECUTABLE ?? 'anvil' on PATH (src/anvil.ts:152) — which fails on machines using ANVIL_RUNTIME=docker or the tools/foundry local binary that resolveAnvilExecutable (src/fixtures.ts:29-40) exists to serve. The extras fixture must spread { ...anvilOptions, ...spec } (keeping fixture-managed port, and anvilOptions-managed host/allowNonLoopbackHost) so extras start wherever the primary does.
- 'Same pattern as AnvilInstance.reportedChainId' is loose: reportedChainId (src/anvil.ts:289-311) is private (not reusable) and has NO timeout or AbortSignal — the bounded-5s probe is new code, not reuse. Fine, but don't cite it as an existing primitive; and AbortSignal.timeout(5_000) is available on Node >=20 per the engines field, so that part holds.
- 'Extras band ... cannot collide with the primary band' is overstated: primary 8645+workerIndex reaches the extras base 9645 at workerIndex 1000 — practically fine, but state the bound instead of 'cannot'. Also the proposed spec band 19700 + workerIndex*20 sits at the same mod-20 sub-offset (0) as anvil.spec.ts's 19100 + workerIndex*20 + {0..3}, so anvil.spec worker 30 collides with the new spec's worker 0; the in-repo convention is actually distinct sub-offsets within the shared 20-stride (private-key-rpc-client.spec.ts:151-154 explicitly picks offsets 10-12 for this reason). Use unused sub-offsets (e.g. +13..19) or document the <30-worker assumption.
- All other load-bearing claims verified true: wagmi injected connector falls back on error.code === 4902 OR error.data?.originalError?.code === 4902, sends rpcUrls from chain defaults, and after wallet_addEthereumChain verifies eth_chainId === target and throws UserRejectedRequestError without re-calling switch (confirmed in wevm/wagmi main injected.ts — so the mock's auto-switch-after-add is mandatory, as designed); EIP-1193 4901 = 'Chain Disconnected: The Provider is not connected to the requested chain' (exact fit); @johanneskares/wallet-mock uses a transports map keyed by chain.id with http()(config).request custom-transport pattern and documents no dynamic addEthereumChain handling; viem 2.52.0 http(url)({}) returns { config, request, value } with a callable EIP-1193 request fn (verified against installed node_modules); live walletOptions spreads into MockWalletControllerOptions last (src/live-fixtures.ts:83-97) so chains passes through with zero live-fixtures changes; chainChanged refreshes the page-side chainId/networkVersion mirrors (src/injected-provider.ts:137-139); the review report's multichain findings (lines 169-176, 297-304, 432-437) match the design's premise; playwright.config.ts testMatch is an explicit allowlist so both new spec entries are required; no name collisions for httpRpcClient/addChain/backedChainIds/ChainBackend/AnvilChainSpec/chains-extraAnvils-extraChains fixtures in src/index.ts, src/fixtures.ts, or package.json exports.

**Improvements:**
- Resolve the walletOptions.chains vs extraChains clobber: MockWalletFixtureOptions = Omit<Partial<MockWalletControllerOptions>,'accounts'|'chainId'> will automatically include the new chains key, and the wallet fixture spreads ...customWalletOptions LAST (src/fixtures.ts:101-107), so a user-supplied walletOptions.chains silently replaces the fixture-built extras map while the extra Anvils keep running unreferenced. Merge ({ ...Object.fromEntries(extras), ...customWalletOptions.chains }) or throw on overlap, and document precedence.
- httpRpcClient should pin transport config: viem http defaults to retryCount 3 and timeout 10_000ms (verified on installed 2.52.0), so a dead URL-backed chain costs ~4 attempts before surfacing and retries can mask deterministic test failures. Use http(url, { retryCount: 0 })({}) or expose httpRpcClient(url, { timeout?, retryCount? }).
- Even with trustDappRpcUrls=false, validate rpcUrls shape per EIP-3085 (-32602 when present-but-not-an-array-of-valid-URL-strings, and decide explicitly whether missing/empty rpcUrls is accepted as today or rejected like MetaMask). wagmi always sends rpcUrls, so rejecting missing rpcUrls costs nothing for the flagship flow and removes the spec deviation; if kept permissive, say so in docs/API.md instead of citing 'only chainId is required'.
- Skip the chainChanged emit when the target equals the current chain in the wallet_switchEthereumChain handler (and optionally switchNetwork): MetaMask returns null with no event for a same-chain switch, and the current unconditional emit in switchNetwork (src/mock-wallet-controller.ts:373-378) can double-fire dapp listeners during the add-then-switch path the design preserves.
- Document that chain-scoped JSON-RPC state does not survive a switch: filter ids from eth_newFilter/eth_getFilterChanges and any subscription-ish state were created on the previous backend, so post-switch polls hit a different node and surface node-level 'filter not found' errors — a one-line docs/API.md caveat next to the routing table prevents misdiagnosis as a routing bug.
- Add the missing CHANGELOG items beyond the 4901 change: (a) hex canonicalization of chainId outputs (lowercase, minimal), (b) the wallet_switchEthereumChain validation/approval reorder if adopted (4001→4902 for unapproved unknown-chain switches in deny-by-default mode), since env-gated live suites assert error codes.
- In the deny-mode live recipe, document the two-arm sequence the wagmi 4902 flow needs (approveNext for the failing switch — or none if the reorder lands — plus approveNext('wallet_addEthereumChain')), and assert it in the hermetic multichain spec with autoApprove(false) so the live path is pinned without secrets.
- Consider exposing the per-chain port mapping on the chains/extraAnvils fixtures docs with the exact formula and its interaction with ANVIL_PORT, mirroring the existing workerPort comment style at src/fixtures.ts:24-27 — consumers running dev nodes near 9645+ need the number, not just 'a dedicated band'.


## Multi-account and two-user fixtures (multiaccount)

**Review verdict:** needs-revision.

### Goal

A consumer can start a mock-wallet test already connected with several Anvil accounts (via `walletOptions.accounts` or `accountIndexes`), switch the selected account mid-test with `wallet.switchAccount(address)` (MetaMask-faithful `accountsChanged` with the selected account first), and spin up a second user — its own browser context, page, and MockWalletController bound to a different account on the same worker Anvil — with one call to the new `createUser()` factory fixture. Misconfigured accounts (not signable by the backing node) fail fast at injection/setAccounts time with an actionable error instead of dying later inside the dapp with Anvil's opaque `-32602 No Signer available`, while `chain.impersonateAccount` flows keep working through an explicit escape hatch. Per-test snapshot/revert isolation now covers every user sharing the worker's Anvil, not just the primary `wallet` fixture.

### API surface

```ts
// ── src/mock-wallet-controller.ts ─────────────────────────────────────────
export type MockWalletControllerOptions = {
  accounts: readonly Address[];
  chainId: number | Hex;
  providerInfo?: Partial<WalletProviderInfo>;
  additionalProviders?: readonly Partial<WalletProviderInfo>[];
  autoApprove?: boolean;
  connected?: boolean;
  allowedOrigins?: readonly string[];
  /**
   * NEW — skip validation of accounts against the node's signers. For
   * impersonation flows (chain.impersonateAccount) and exotic RpcClients.
   * eth_sendTransaction works for impersonated accounts; signing methods
   * still fail in the node (anvil has no key). Default: false.
   */
  allowUnsignableAccounts?: boolean;
};

export class MockWalletController {
  /** NEW — current account list; index 0 is the selected account. */
  get currentAccounts(): readonly Address[];

  /**
   * NEW — re-select one of the wallet's existing accounts. Moves it to
   * accounts[0] (MetaMask orders eth_accounts most-recently-selected first)
   * and emits accountsChanged with the full reordered array. No-op (no
   * event) if already selected. Throws if the address is not in
   * currentAccounts — use setAccounts() to change the set.
   */
  switchAccount(address: Address): Promise<void>;

  /** CHANGED — validates against node signers; per-call escape hatch. */
  setAccounts(
    accounts: readonly Address[],
    options?: { allowUnsignable?: boolean },
  ): Promise<void>;

  /** CHANGED — now validates options.accounts before exposing the bridge. */
  injectMockProvider(): Promise<void>;
}

// ── src/fixtures.ts ───────────────────────────────────────────────────────
/** CHANGED — 'accounts' is no longer Omit'ed; accountIndexes added. */
export type MockWalletFixtureOptions = Omit<
  Partial<MockWalletControllerOptions>,
  'chainId' // chainId stays fixture-managed (multichain feature owns routing)
> & {
  /** Indexes into chain.accounts(); mutually exclusive with `accounts`. */
  accountIndexes?: readonly number[];
};

export type UserSession = {
  context: BrowserContext;
  page: Page;
  wallet: MockWalletController;
};

export type CreateUserOptions = MockWalletFixtureOptions & {
  /** Passed to browser.newContext(); baseURL is forwarded by default. */
  contextOptions?: Parameters<Browser['newContext']>[0];
};

export type CreateUser = (options?: CreateUserOptions) => Promise<UserSession>;

export type Web3Fixtures = {
  wallet: MockWalletController;
  walletOptions: MockWalletFixtureOptions;
  /** NEW — factory: fresh context + page + wallet on the shared worker Anvil. */
  createUser: CreateUser;
  /** NEW (internal) — per-test anvil snapshot/revert shared by wallet & createUser. */
  _chainIsolation: void;
};

// ── Usage ─────────────────────────────────────────────────────────────────
import { expect, test } from '@marigoldlabs/web3-tester/fixtures';

// Start connected with three accounts and flip between them:
test.describe('account switcher', () => {
  test.use({ walletOptions: { accountIndexes: [0, 1, 2] } });

  test('dapp follows the selected account', async ({ page, wallet }) => {
    await page.goto('/');
    const [, second] = wallet.currentAccounts;
    await wallet.switchAccount(second!);            // emits accountsChanged([second, first, third])
    await expect(page.getByText(second!.slice(0, 6))).toBeVisible();
  });
});

// Two users, one chain: seller lists, buyer purchases.
test('buyer sees the seller’s listing', async ({ page, wallet, chain, createUser }) => {
  await page.goto('/listings/new');                 // user A = anvil account 0
  // ... seller publishes via wallet (eth_sendTransaction → shared anvil) ...

  const buyer = await createUser();                 // user B = anvil account 1, own context
  await buyer.page.goto('/listings/1');
  const txHash = buyer.wallet.waitForNextTransaction();
  await buyer.page.getByRole('button', { name: 'Buy' }).click();
  await chain.client.waitForTransactionReceipt({ hash: await txHash });
  // teardown: buyer.context closes, then ONE evm_revert restores the chain
});

// Whale impersonation escape hatch (send-only; signing has no key):
test('act as a whale on a fork', async ({ wallet, chain }) => {
  const whale = '0xf977814e90da44bfa03b6295a0616a897441acec';
  await chain.impersonateAccount(whale);
  await chain.setBalance(whale, 10_000n * 10n ** 18n);
  await wallet.setAccounts([whale], { allowUnsignable: true });
});
```

### Behavior

**1. walletOptions.accounts / accountIndexes (src/fixtures.ts).** The `Omit<..., 'accounts'>` is lifted (the review's verifier note confirmed the restriction was type-level only — the `...customWalletOptions` spread at fixtures.ts:106 already honored a casted `accounts` at runtime, unvalidated). A shared `resolveAccounts(chain, { accounts, accountIndexes }, fallbackIndex)` helper: passing both throws `Error('Pass either accounts or accountIndexes, not both.')`; `accountIndexes` map against `await chain.accounts()` with a bounds check that names the remedy (`anvilOptions: { accounts: n }` — anvil's `--accounts` flag already plumbed through AnvilOptions); neither ⇒ `[available[fallbackIndex]]` (0 for the `wallet` fixture, preserving today's default exactly). `chainId` stays omitted — it remains fixture-managed so the parallel multichain routing work owns it.

**2. Fail-fast signable-account validation (src/mock-wallet-controller.ts).** New private `assertAccountsSignable(accounts, operation)`: lazily probes `this.rpcClient.request({ method: 'eth_accounts' })` once, caches the lowercased signer set. Fail-open rule: if the probe throws OR returns a non-array/empty array, validation is skipped — this is what keeps live mode and third-party RpcClients safe (remote RPC nodes answer `[]`). When the node does expose signers (anvil returns its 10 unlocked accounts), every wallet account must be in the set (case-insensitive) or a plain `Error` (test-side misconfiguration, not a providerError — it never crosses the page bridge) is thrown naming the offending addresses, the count of node signers, and both remedies: use `chain.accounts()` entries, or `chain.impersonateAccount(addr)` + `allowUnsignable` for send-only flows (with the explicit warning that personal_sign/typed-data will still fail node-side with `-32602 No Signer available` — empirically verified in the review). Called from `injectMockProvider()` (before `exposeBinding`, so a bad fixture config fails in fixture setup with a readable message) and `setAccounts()` (per-call `{ allowUnsignable: true }` override, plus the constructor-wide `allowUnsignableAccounts` option for fixture-configured impersonation tests). `switchAccount` needs no validation — it only reorders the already-validated set. Behavioral break: `setAccounts(['0x0…01'])` (today's README example!) now throws instead of failing later; README/docs updated, CHANGELOG flags it.

**3. PrivateKeyRpcClient local eth_accounts (src/private-key-rpc-client.ts).** Add `case 'eth_accounts': return [this.account.address];` before the default passthrough. Today the method falls through to the remote node (verified: no case exists), which returns `[]` — fail-open would neuter validation in live mode and cost a network roundtrip per injection. With the local answer the probe is hermetic and live-fixture accounts (`[liveClient.account.address]`) validate exactly. Live `walletOptions` keeps `'accounts'` omitted — one private key means one account; no change to deny-by-default arming or allowedOrigins scoping.

**4. switchAccount semantics.** Find the address case-insensitively in `this.accounts`; absent ⇒ throw Error pointing at `setAccounts`. Index 0 ⇒ return without emitting (MetaMask emits `accountsChanged` only when the value of `eth_accounts` changes). Otherwise move it to the front preserving the relative order of the rest (MetaMask's documented "most recently used first" ordering; accounts[0] is the dapp-visible selected account, which is the existing contract — injected-provider.ts already mirrors `payload[0]` into `provider.selectedAddress` on `accountsChanged`, and `eth_sendTransaction` defaults `from` to `primaryAccount`). Emit `accountsChanged` with the full reordered array only when `connected`; while disconnected the reorder is internal (dapp sees `[]` either way) and the new order surfaces on reconnect. `metamask_getProviderState` and the post-navigation `refresh()` in injected-provider.ts pick the new order up for free; `wallet_getPermissions` already spreads `this.accounts` into the `restrictReturnedAccounts` caveat, so multi-account permission responses are correct with zero changes.

**5. createUser factory fixture (src/fixtures.ts).** Test-scoped fixture depending on `{ browser, chain, baseURL, _chainIsolation }`. Each call: `browser.newContext({ baseURL, ...options.contextOptions })` → `newPage()` → `resolveAccounts(chain, options, nextDefaultIndex)` → `new MockWalletController(page, chain, { accounts, chainId: chain.chainId, autoApprove: true, connected: true, ...overrides })` → `injectMockProvider()` → push session, return `{ context, page, wallet }`. Default account assignment: index 0 is reserved for the primary `wallet` fixture; createUser calls without explicit accounts take indexes 1, 2, 3… in creation order (deterministic, documented; >9 users on default anvil hits the bounds error naming `anvilOptions.accounts`). Teardown after `use()`: `context.close()` for every session (catch-swallowed, mirroring existing teardown style). The duplicate-binding guard ("Create one MockWalletController per context", mock-wallet-controller.ts:249-255) is never tripped because every user owns a fresh context — and it keeps correctly rejecting a second controller on an existing context. Fresh contexts mean fresh storage/cookies (genuine two-user semantics) and per-context event delivery: `emit()` iterates `this.page.context().pages()`, so user A's `accountsChanged` never leaks into user B's pages.

**6. Snapshot/revert with two contexts on one Anvil (`_chainIsolation`).** The snapshot/revert pair moves out of the `wallet` fixture into a test-scoped `_chainIsolation` fixture (`snapshot()` before `use()`, `revert(id)` in `finally`), which both `wallet` and `createUser` depend on. Playwright memoizes fixtures per test, so a test using both takes exactly ONE snapshot; teardown runs in reverse dependency order, so all user contexts close before the single `evm_revert` (anvil snapshot IDs are consumed by revert — one shared snapshot avoids the nested-revert trap of each fixture snapshotting independently). Net semantics: chain state is intentionally SHARED across users within a test (that is the feature — seller's tx is buyer-visible immediately), and the whole multi-user episode reverts atomically at test end. This also fixes a latent gap: a test using only `createUser` (never `wallet`) now gets isolation, where today it would get none. Tests touching only the `chain` fixture remain un-snapshotted (unchanged). Per-worker Anvil + Playwright's one-test-at-a-time-per-worker means snapshot windows never overlap under `fullyParallel`.

**Error codes recap:** unchanged provider semantics — 4001/4100/4200/4902 paths untouched; the new failures are test-side `Error`s (fixture/config misuse), and the documented impersonation signing limitation surfaces anvil's own `-32602 No Signer available` passthrough, now mentioned in the fail-fast message instead of being discovered in the dapp.

### Files touched

| Path | Change |
| --- | --- |
| `/Users/adhyr/Repos/web3-tester/src/mock-wallet-controller.ts` | Add switchAccount(address), currentAccounts getter, allowUnsignableAccounts option, lazy signable-set probe + assertAccountsSignable(); call it from injectMockProvider() and setAccounts() (new per-call { allowUnsignable } second parameter). |
| `/Users/adhyr/Repos/web3-tester/src/fixtures.ts` | Lift 'accounts' from MockWalletFixtureOptions Omit, add accountIndexes; new resolveAccounts() helper; extract per-test snapshot/revert into _chainIsolation fixture; rework wallet fixture to use both; add createUser factory fixture with context teardown; export UserSession/CreateUserOptions/CreateUser types. |
| `/Users/adhyr/Repos/web3-tester/src/private-key-rpc-client.ts` | Add local `case 'eth_accounts': return [this.account.address];` so the validation probe is hermetic and meaningful in live mode (currently falls through to the remote node, which answers []). |
| `/Users/adhyr/Repos/web3-tester/src/index.ts` | Export new types: UserSession, CreateUserOptions, CreateUser (values flow through the existing test/expect export). |
| `/Users/adhyr/Repos/web3-tester/tests/mock-wallet.spec.ts` | Add specs: multi-account start via accountIndexes (eth_accounts order, permissions caveat, selectedAddress); switchAccount event/reorder/no-op/unknown-address; setAccounts fail-fast on non-Anvil address; impersonation escape hatch (send succeeds, personal_sign surfaces node -32602). |
| `/Users/adhyr/Repos/web3-tester/tests/multi-user.spec.ts` | New hermetic spec: two-user ETH transfer across contexts (distinct selectedAddress, shared chain); default account assignment 1,2,…; describe.serial pair proving createUser-only tests revert chain state; duplicate-binding guard still rejects a second controller on an existing user context. |
| `/Users/adhyr/Repos/web3-tester/playwright.config.ts` | Add '**/multi-user.spec.ts' to the library project's testMatch so npm test runs it. |
| `/Users/adhyr/Repos/web3-tester/docs/API.md` | Document walletOptions.accounts/accountIndexes, switchAccount + currentAccounts + setAccounts options in the MockWalletController table, the createUser fixture and UserSession shape, single-snapshot isolation semantics, and the impersonation signing limitation. |
| `/Users/adhyr/Repos/web3-tester/README.md` | Fix the Wallet Control example (line ~237) that demonstrates setAccounts with a non-Anvil address — it now throws by design; add a short two-user createUser recipe and the impersonation actAs-style recipe with its signing caveat. |
| `/Users/adhyr/Repos/web3-tester/CHANGELOG.md` | 0.3.0 entry: new features plus the behavioral break (setAccounts/injectMockProvider now validate accounts against node signers; allowUnsignable escape hatch). |
| `/Users/adhyr/Repos/web3-tester/dist/` | Rebuild committed dist (npm run build) to satisfy the CI freshness gate. |

### New dependencies

None.

### Test strategy

All hermetic — everything runs in the `library` Playwright project against the per-worker Anvil; nothing is env-gated. tests/mock-wallet.spec.ts additions pin: (a) a `test.use({ walletOptions: { accountIndexes: [0,1,2] } })` block asserting `eth_accounts` returns three anvil accounts in order, `wallet_getPermissions` caveat lists all three, and `selectedAddress` mirrors accounts[0]; (b) switchAccount — page-side `accountsChanged` listener receives the reordered array with the target first, `selectedAddress` flips, switching to the already-selected account emits nothing, unknown address rejects with the setAccounts hint; (c) fail-fast validation — `new MockWalletController(page, chain, { accounts: ['0x…beef'], chainId: chain.chainId })` has `injectMockProvider()` reject with the signable-accounts message (the page context is free since `wallet` is not referenced), and `wallet.setAccounts(['0x…beef'])` rejects likewise; (d) escape hatch — `chain.impersonateAccount` + `chain.setBalance` + `setAccounts([whale], { allowUnsignable: true })`: page `eth_sendTransaction` succeeds while `personal_sign` surfaces anvil's `-32602`, pinning the documented limitation. tests/multi-user.spec.ts pins: the two-user transfer (wallet fixture account 0 sends to `createUser()` account 1; buyer's provider reads its own distinct `selectedAddress`; recipient balance moves on the shared chain); deterministic default assignment (two createUser calls get `chain.accounts()[1]` and `[2]`); a `describe.serial` pair where test 1 uses ONLY createUser to move 1 ETH to a sentinel address and test 2 asserts the balance reverted — this is the regression test for _chainIsolation covering createUser-only tests and for revert ordering after context close; accountIndexes out-of-range error naming `anvilOptions`; and the duplicate-binding guard message when constructing a second controller inside an existing user context. Existing specs (provider-injection, mock-wallet, live-fixtures) double as regression cover for the snapshot-extraction refactor — any ordering mistake breaks their isolation visibly.

### Effort

2.5–3 focused days. Controller changes (switchAccount, validation, probe cache) are ~0.5d; the fixtures rework (snapshot extraction, resolveAccounts, createUser factory with correct teardown ordering) is ~0.5–1d and is the riskiest code; the test suite dominates (~1d — the serial revert-isolation pair and the impersonation matrix need care to be flake-free); docs/README/CHANGELOG/dist ~0.5d.

### Depends on

Nothing (but see the sequencing plan — shared-substrate ordering still applies).

### Risks

- **Behavioral break: setAccounts/constructor accounts that are not anvil signers now throw — and the current README itself demonstrates exactly that call, so existing consumer tests copied from it will start failing at the call site.**
  Mitigation: Fail-fast error names the offending address, the node's signers, and both remedies (chain.accounts() / impersonate + allowUnsignable); README and docs/API.md updated in the same change; CHANGELOG 0.3.0 flags it as breaking; per-call { allowUnsignable: true } makes migration a one-line diff for intentional cases.
- **Fail-open probe (skip validation when eth_accounts throws or returns []) silently disables the guard for custom RpcClients — users may believe they are protected when they are not.**
  Mitigation: Document the fail-open rule in API.md; PrivateKeyRpcClient gets a local eth_accounts so the in-repo live path validates for real; the mock path (ChainController→anvil) always returns signers so the primary foot-gun is always guarded.
- **browser.newContext() in createUser does not inherit test.use context options (viewport, locale, storageState, recordVideo…) — second-user pages may behave differently from the primary page and confuse consumers.**
  Mitigation: Forward baseURL explicitly (the one option dapp navigation depends on), expose contextOptions on CreateUserOptions for the rest, and document the non-inheritance prominently in the createUser section.
- **Moving snapshot/revert into _chainIsolation changes fixture topology; a dependency-ordering mistake would revert the chain while user contexts still have in-flight requests, or double-revert a consumed snapshot ID.**
  Mitigation: Single memoized snapshot per test (both wallet and createUser depend on the same fixture; Playwright tears dependents down first, so contexts close before the one revert); the describe.serial isolation test plus the entire existing mock suite pin the ordering.
- **Coordination with the parallel multichain feature: createUser binds wallets to the same worker rpcClient (`chain`) and `chainId: chain.chainId`; if multichain replaces the wallet fixture's rpc routing, createUser must consume the same routed client or two-user tests fork off the wrong chain.**
  Mitigation: createUser takes its rpcClient/chainId from the identical fixture inputs the wallet fixture uses (no second source of truth), and MockWalletFixtureOptions keeps chainId omitted so multichain owns that axis; flag the merge-order touchpoint to the maintainer.

### External facts verified by the designer

- Synpress v4 MetaMask class account-management method names — switchAccount(accountName), addNewAccount(accountName), importWalletFromPrivateKey(privateKey), renameAccount(current, new) — verified by reading wallets/metamask/src/playwright/MetaMask.ts in the Synthetixio/synpress repo via the GitHub API (gh api); parity naming drives our switchAccount choice. Also: https://docs.synpress.io/docs/migration-guide
- MetaMask accounts-ordering contract: eth_accounts returns the caller's permitted accounts 'with the most recently used account first', and accounts[0] is treated as the selected account; accountsChanged fires when the eth_accounts return value changes — verified via MetaMask developer docs (https://docs.metamask.io/metamask-connect/evm/reference/provider-api/ and https://docs.metamask.io/wallet/how-to/access-accounts/). This is why switchAccount moves the target to index 0 and why an already-selected no-op emits nothing.
- @johanneskares/wallet-mock installs a single viem Account per installMockWallet call (no multi-account or multi-user API) — verified from its README via the GitHub API (https://www.npmjs.com/package/@johanneskares/wallet-mock); first-class two-user fixtures are a real differentiator, matching the review's competitor framing.
- Anvil answers personal_sign and eth_sendTransaction for unmanaged addresses with {code:-32602, message:'No Signer available'}, and anvil_impersonateAccount rescues only eth_sendTransaction, never signing — empirically verified by the review's verifier (reports/web3-tester-library-review-2026-06-09.md lines 786–793 and 649); drives the fail-fast message text and the allowUnsignable escape-hatch scope.
- PrivateKeyRpcClient has no eth_accounts case (read src/private-key-rpc-client.ts:87-160 — it falls through to the remote node, which returns [] on public RPCs); this is the load-bearing fact behind the fail-open probe rule and the new local eth_accounts case, without which validation would either break live mode or be skipped there.
- Playwright multi-user pattern: per-user browser.newContext() from the worker-scoped browser fixture, factory fixture returning sessions, contexts closed in fixture teardown; newContext() does NOT inherit test.use context options — confirmed against current community/docs patterns (https://dev.to/gustavomeilus/scaling-your-playwright-tests-a-fixture-for-multi-user-multi-context-worlds-53i4, https://circleci.com/blog/playwright-fixtures-a-deep-dive/), motivating explicit baseURL forwarding and the contextOptions passthrough.
- Verifier correction in the review (line 201): the existing fixtures.ts spread order means walletOptions.accounts already overrides at runtime despite the type-level Omit — so unblocking the type is formalizing existing runtime behavior plus adding the missing validation, not a semantic rewrite.

### Open questions

- Should eth_sendTransaction enforce `from ∈ currentAccounts` (MetaMask rejects sends from non-permitted accounts; anvil happily signs with ANY unlocked account today, so a dapp bug sending from the wrong account silently passes)? It is a 5-line, more-faithful hardening and impersonation still works (the impersonated address is in accounts after setAccounts), but it is a second behavioral break in the same release — include here or split out?
- Naming: the review suggested createWallet(page) attaching to a caller-supplied page; this design's createUser() owns context+page creation (cleaner teardown, never trips the one-controller-per-context guard). Is `createUser` the preferred name and shape, or do you also want a low-level exported attachWallet(page, rpcClient, options) for callers who build their own contexts?
- Should the review's `wallet.actAs(address)` sugar (impersonate + setBalance + setAccounts allowUnsignable in one call, finding at report line 649) ship as part of this feature, or land with deal-helpers where the funding/forking ergonomics live?
- Is the underscore-named `_chainIsolation` fixture acceptable in the exported Web3Fixtures type (Playwright-internal style, documented one-line as plumbing), or would you rather it be a documented public fixture name so consumers extending `test` can depend on it explicitly?
- Default account assignment reserves index 0 for the `wallet` fixture and hands createUser 1,2,3… in creation order — if a test passes walletOptions.accountIndexes that overlap user defaults, both wallets share a signer (allowed, occasionally desired). OK to document rather than detect?

### Adversarial review

**Corrections:**
- The design's node-signer model is wrong for any anvil built after Aug 2023: eth_accounts returns the dev signers PLUS currently-impersonated accounts (foundry PR #5734, merged 2023-08-27, closing issue #5732; verified in current crates/anvil/src/eth/api.rs — accounts() extends signer accounts with backend.cheats().impersonated_accounts()). Three consequences: (a) 'assertAccountsSignable' is a misnomer — probe membership guarantees only that eth_sendTransaction will be accepted, NOT that signing works; an impersonated whale passes validation yet personal_sign still fails node-side with -32602 'No Signer available', so the design's fail-fast promise has a hole that must be documented as such. (b) The lazy-once probe cache is what forces allowUnsignable for impersonation: a FRESH probe taken after chain.impersonateAccount(whale) would include the whale and setAccounts([whale]) would validate with no escape hatch. The designed error message ('not signable by the backing node') would be factually false at that point. Re-probe on validation miss (extra RPC only on the failure path) and the documented impersonation flow needs no flag at all. (c) The planned test (d) asserting allowUnsignable is REQUIRED for the whale flow would pin the stale-cache artifact, not node behavior.
- Related: anvil --auto-impersonate (and PR #5740) auto-impersonates every sender, under which validation passes for ANY address — the fail-fast guard is silently inert in that configuration. The review itself mentions --auto-impersonate (report line ~793); docs should state validation is best-effort under it.
- The design says switchAccount 'emits accountsChanged only when connected; while disconnected the reorder is internal' but omits that the existing setAccounts (src/mock-wallet-controller.ts:351-359) sets connected = true and emits unconditionally — i.e., setAccounts reconnects a disconnected wallet, switchAccount won't. The asymmetry is defensible (MetaMask-faithful) but it is an unstated behavioral divergence between two adjacent methods; the spec and docs/API.md table (line 253) must pin it explicitly or tests will encode it by accident.
- Minor scope claim: '_chainIsolation ... Per-test snapshot/revert isolation now covers every user' is true only for chain STATE. anvil impersonation lives in CheatsManager (crates/anvil/src/eth/backend/cheats.rs has no snapshot hooks), so evm_revert does not clear impersonation — the design's own escape-hatch test would leak an impersonated whale into subsequent tests on the same worker anvil. Pre-existing gap, but this feature's tests make it observable.
- All other load-bearing claims verified true: fixtures.ts:106 spread honors a casted accounts at runtime (Omit is type-level only, matching the review's verifier correction); duplicate-binding guard at mock-wallet-controller.ts:248-255; emit() iterates this.page.context().pages() so events never cross contexts; injected-provider.ts mirrors payload[0] into selectedAddress and refresh() re-reads metamask_getProviderState; wallet_getPermissions spreads this.accounts into restrictReturnedAccounts; eth_sendTransaction defaults from to primaryAccount (line 556); PrivateKeyRpcClient has no eth_accounts case (falls to publicClient passthrough); README.md:237 demonstrates setAccounts with 0x...01; playwright.config.ts library testMatch lists specs explicitly so multi-user.spec.ts must be added; AnvilOptions.accounts is plumbed to --accounts; no existing in-repo spec breaks under the new validation (mock-wallet.spec.ts:194 uses chain.accounts(); provider-injection.spec.ts:142 constructs with a beef account but never calls injectMockProvider). MetaMask most-recently-used-first ordering and accountsChanged-on-value-change confirmed against docs.metamask.io; Synpress switchAccount(accountName)/addNewAccount/importWalletFromPrivateKey/renameAccount confirmed by reading MetaMask.ts via the GitHub API; wallet-mock installMockWallet takes a single viem account.

**Improvements:**
- Rename assertAccountsSignable to something honest (assertAccountsKnownToNode / 'sendable'), re-probe on miss instead of caching forever, and split the error/docs into two facts: (1) address not in the node's eth_accounts → fail fast with chain.accounts() / impersonateAccount remedies; (2) address present via impersonation → sends work, personal_sign/typed-data still -32602. allowUnsignable then shrinks to an override for non-probing custom RpcClients and could plausibly be dropped from the public surface entirely, avoiding an option that exists mainly to work around the design's own cache.
- Hard sequencing constraint, must ship atomically: the PrivateKeyRpcClient local eth_accounts case must land in the same change as the injectMockProvider probe. tests/live-fixtures.spec.ts (hermetic, in the library project) builds PrivateKeyRpcClient with NO rpcUrl — viem falls back to the chain's default public Sepolia transport — so a probe without the local case makes npm test perform a real network call during fixture setup, violating the hermetic rule even though fail-open would mask it.
- Probe robustness: RpcClient is just an interface, so a custom client's request() may hang rather than throw — the fail-open rule only catches throws. Race the probe against a short timeout (e.g. 2-3s) and fail open on timeout, otherwise a dead RPC turns every test's fixture setup into a 10s+ stall (viem http default timeout) or a hang.
- createUser ignores the test's walletOptions: test.use({ walletOptions: { autoApprove: false, allowedOrigins: [...] } }) hardens the primary wallet while every createUser() session silently defaults to autoApprove: true with no origin scoping. Either merge walletOptions as the base layer under per-call options (excluding accounts/accountIndexes, which resolveAccounts owns) or document the divergence in bold; the current design only documents contextOptions non-inheritance, not walletOptions non-inheritance.
- Have the escape-hatch/impersonation test (or _chainIsolation teardown) call chain.stopImpersonatingAccount, since impersonation survives evm_revert and leaks across tests on the worker anvil; alternatively pin the leak in a test and document it.
- Add UserSession.close() (idempotent context.close + session deregistration) for mid-test 'user leaves' scenarios; the design only tears sessions down at test end, and Synpress/dappwright users will reach for explicit disposal in long multi-user flows.
- Export consistency: src/index.ts currently exports NO fixture types (MockWalletFixtureOptions and Web3Fixtures exist only on the /fixtures subpath). Adding UserSession/CreateUserOptions/CreateUser to index.ts while MockWalletFixtureOptions stays subpath-only is inconsistent — export the fixture option types from both entry points or keep all fixture types on /fixtures and document that.
- Answer open question 1 affirmatively in this release: enforce from ∈ currentAccounts on eth_sendTransaction with providerError(4100, ...) now, because (a) anvil signs with ANY unlocked dev account so a wrong-account dapp bug passes silently today (transaction.from ??= primaryAccount at mock-wallet-controller.ts:556 only covers the missing-from case), and (b) 0.3.0 already carries a behavioral break — bundling both is one migration instead of two breaking releases.
- Implementation nit: resolveAccounts must strip accountIndexes (and accounts) before spreading the remaining fixture options into MockWalletControllerOptions — spreading a wider object into a typed literal compiles without excess-property errors, silently leaking an unknown key into the constructor options.
- Test-plan tightening: the planned switchAccount spec should also pin eth_requestAccounts and metamask_getProviderState returning the reordered array (both read this.accounts, so it is free), and the escape-hatch test should be rewritten against the re-probe design (impersonate → setAccounts succeeds WITHOUT any flag; personal_sign still surfaces -32602).


## EIP-5792 wallet_sendCalls + EIP-7702 support (eip5792-7702)

**Review verdict:** needs-revision.

### Goal

A consumer testing a 2026-era dapp (wagmi useSendCalls / viem sendCalls / AppKit batch flows) can run the full EIP-5792 journey against the hermetic mock wallet: capability probing per chain, batch submission with MetaMask-faithful validation and the exact 57xx error codes, deterministic batch status with real anvil receipts (100/200/400/500/600), all-or-nothing "atomic" execution emulated via evm_snapshot/evm_revert, and the existing approval-gating primitives (autoApprove, approveNext, holdNextRequest, simulateRejection) covering the whole batch as one user decision. Separately, ChainController gains EIP-7702 helpers (signAuthorization / delegate / revokeDelegation / getDelegation) so tests can put real type-4 delegations on anvil (verified working today on anvil 1.5.1 default hardfork), and PrivateKeyRpcClient stops dropping authorizationList and can sign authorizations for live-testnet 7702 tests. No competitor (Synpress v4, wallet-mock, dappwright) covers any of this.

### API surface

```typescript
// ── src/mock-wallet-controller.ts ──────────────────────────────────────────
export type AtomicCapabilityStatus = 'supported' | 'ready' | 'unsupported';

export type Eip5792Options = {
  /** Master switch. false = legacy wallet: all four methods throw 4200 (current behavior). Default: true. */
  enabled?: boolean;
  /** Atomic capability advertised for the backed chain. Default: 'supported' (mock fixtures); live-fixtures passes 'unsupported'. */
  atomic?: AtomicCapabilityStatus;
  /** Extra/override capability objects merged into the per-chain response, keyed by hex chainId; '0x0' = cross-chain per spec. */
  capabilities?: Record<Hex, Record<string, unknown>>;
  /** Batches with more calls throw 5740. Default: 100. */
  maxCallsPerBatch?: number;
};

export type MockWalletControllerOptions = {
  /* ...existing options unchanged... */
  eip5792?: boolean | Eip5792Options;   // new
};

export type CallsBatchRecord = {
  id: Hex;                               // 0x + 64 hex (crypto.randomBytes(32)) unless caller-supplied
  chainId: Hex;
  from: Address;
  version: '2.0.0';
  atomic: boolean;                       // execution mode actually used (spec: MUST reflect actual execution)
  calls: readonly { to?: Hex; data?: Hex; value?: Hex }[];
  txHashes: readonly Hex[];              // submitted hashes, call order
  failure?: 'offchain' | 'atomic-rollback' | 'partial';
};

export class MockWalletController {
  /** Every accepted wallet_sendCalls batch, for test assertions (parallels sentTransactionRequests). */
  readonly sentCallBatches: CallsBatchRecord[];
  /** Ids the page passed to wallet_showCallsStatus (headless no-op otherwise). */
  readonly shownCallsStatusIds: Hex[];
  /** One-shot: next atomicRequired sendCalls while atomic === 'ready' throws 5750 instead of upgrading. */
  simulateAtomicUpgradeRejection(): void;
  // approveNext('wallet_sendCalls') / holdNextRequest('wallet_sendCalls') /
  // simulateRejection() already work — wallet_sendCalls joins SIGNING_METHODS.
}

// ── src/anvil.ts (ChainController) ─────────────────────────────────────────
import type { Account, SignedAuthorization } from 'viem';

export type ChainAuthorizationOptions = {
  account: Account | Hex;        // authority: viem local account or raw private key
  contractAddress: Address;      // zero address revokes
  nonce?: number;
  chainId?: number;              // default this.chainId; 0 = valid-on-any-chain
  executor?: 'self';             // authority sends its own type-4 tx (nonce+1 handling via viem)
};
export type DelegateOptions = {
  account: Account | Hex;        // authority (its key signs the authorization)
  contractAddress: Address;
  sponsor?: Address;             // unlocked anvil account paying gas; default accounts()[0]
};

export class ChainController {
  signAuthorization(options: ChainAuthorizationOptions): Promise<SignedAuthorization>;
  /** Signs + submits a type-4 tx from an unlocked sponsor; resolves once code is 0xef0100‖address. */
  delegate(options: DelegateOptions): Promise<{ hash: Hex; authority: Address }>;
  /** Authorization to the zero address; resets code to 0x. */
  revokeDelegation(options: Omit<DelegateOptions, 'contractAddress'>): Promise<{ hash: Hex; authority: Address }>;
  /** Parses the EIP-7702 designator out of eth_getCode; null when not delegated. */
  getDelegation(authority: Address): Promise<Address | null>;
}

// ── src/private-key-rpc-client.ts ──────────────────────────────────────────
export class PrivateKeyRpcClient {
  /** viem walletClient.signAuthorization with this client's local account (local-account-only per viem). */
  signAuthorization(options: {
    contractAddress: Address; chainId?: number; nonce?: number; executor?: 'self';
  }): Promise<SignedAuthorization>;
  // eth_sendTransaction now maps params[0].authorizationList (currently silently dropped)
  // into viem sendTransaction's authorizationList.
}

// ── usage ──────────────────────────────────────────────────────────────────
import { test, expect } from '@marigoldlabs/web3-tester/fixtures';

test('approve+deposit as one batch', async ({ page, wallet, chain }) => {
  await page.goto('/');
  const { id } = await page.evaluate(({ token, vault, approveData, depositData }) =>
    window.ethereum.request({
      method: 'wallet_sendCalls',
      params: [{
        version: '2.0.0', chainId: '0x7a69', atomicRequired: true,
        calls: [{ to: token, data: approveData }, { to: vault, data: depositData }],
      }],
    }), fixtures);

  const status = await page.evaluate((batchId) =>
    window.ethereum.request({ method: 'wallet_getCallsStatus', params: [batchId] }), id);
  expect(status).toMatchObject({ status: 200, atomic: true, chainId: '0x7a69' });
  expect(status.receipts).toHaveLength(2);
  expect(wallet.sentCallBatches[0].txHashes).toHaveLength(2);
});

test('delegated EOA via 7702', async ({ chain }) => {
  const authority = privateKeyToAccount(ANVIL_KEY_1); // default-mnemonic key, hermetic
  await chain.delegate({ account: authority, contractAddress: batchExecutorAddress });
  expect(await chain.getDelegation(authority.address)).toBe(batchExecutorAddress);
  await chain.revokeDelegation({ account: authority });
  expect(await chain.getDelegation(authority.address)).toBeNull();
});
```

### Behavior

All four methods are handled in MockWalletController.handleRpcRequest as new switch cases ahead of the wallet_* 4200 default. With eip5792 disabled, all four keep today's providerError(4200) legacy behavior. Per the EIP-5792 Final spec (verified at eips.ethereum.org 2026-06-10):

wallet_getCapabilities([address, chainIds?]): NOT approval-gated. Throws 4100 if the wallet is disconnected or address is not in this.accounts (spec privacy rule; case-insensitive compare). Returns a hex-chainId-keyed map covering only chains the wallet can actually execute on (a new private backedChainIds set initialized to the construction chainId — deliberately NOT knownChainIds, since cosmetically added/switched chains have no backing client). Each entry defaults to { atomic: { status: options.atomic ?? 'supported' } }, deep-merged with options.capabilities (which may add '0x0' cross-chain entries). Optional chainIds param filters; unsupported chains are omitted (MetaMask behavior). Note anvil itself answers wallet_getCapabilities with {} experimentally, but requests never reach anvil — the case branch intercepts.

wallet_sendCalls([{version, id?, from?, chainId, atomicRequired, calls, capabilities?}]): joins SIGNING_METHODS, so it inherits 4100-when-disconnected, APPROVAL_GATED_METHODS membership, default simulateRejection() coverage, and holdNextRequest support. Validation order: (1) version !== '2.0.0' → -32602 (spec assigns no code; MetaMask requires 2.0.0 — documented decision); malformed params/empty calls/non-boolean atomicRequired/bad hex chainId → -32602; (2) from (default primaryAccount) not in accounts → 4100; (3) chainId !== current chainId or current chain not backed → 5710 (MetaMask-faithful: batch must target the active network); (4) calls.length > maxCallsPerBatch → 5740; (5) caller-supplied id (validated 0x-hex, ≤8194 chars per spec) already in the batch map → 5720; (6) any top-level or per-call capability key not advertised for the chain and not marked optional:true → 5700 (spec MUST); (7) atomicRequired && atomic==='unsupported' → 5760; (8) atomicRequired && atomic==='ready' && simulateAtomicUpgradeRejection() armed → 5750. Then ONE assertUserApproved('wallet_sendCalls', params) gates the entire batch — a single approveNext('wallet_sendCalls') arms all N calls (live mode: N real transactions from one arm; documented loudly in API.md); rejection → 4001 with zero calls sent (spec MUST NOT send any calls on rejection). Execution: atomic mode (atomicRequired, or atomic!=='unsupported' — matching a wallet that executes atomically when it can) takes evm_snapshot via this.rpcClient, then submits each call sequentially as eth_sendTransaction {from, to, data, value} through a new private clientForChain(chainId) seam (v1: returns this.rpcClient; the multichain feature swaps in its routing table here). Every hash is also pushed to sentTransactions/sentTransactionRequests so waitForNextTransaction and the parallel matchers feature keep working. On any submission failure in atomic mode: evm_revert(snapshot), record failure 'atomic-rollback'. Non-atomic mode: no snapshot, stop at first failure (spec is silent; documented decision), failure 'partial' if anything landed, 'offchain' if the first call failed. The id (caller's, else 0x+64-hex from node:crypto randomBytes(32) — spec requires unpredictable ids) is returned as { id } and the CallsBatchRecord is stored in a Map plus the public sentCallBatches array. Successful atomicRequired batch on an atomic:'ready' wallet flips status to 'supported' (emulates MetaMask's EOA→smart-account upgrade).

wallet_getCallsStatus([id]): NOT gated. Unknown id → 5730. Fetches eth_getTransactionReceipt per recorded hash through the same routed client and returns { version: '2.0.0', id, chainId, status, atomic, receipts } with spec status codes: any receipt still null → 100 (pending; happens with anvil blockTime>0); failure 'atomic-rollback' → 500, receipts omitted, atomic:true (divergence from real MetaMask, which would return one reverted 7702-tx receipt — see risks); failure 'offchain' → 400 with empty receipts; failure 'partial' or any landed receipt with status 0x0 → 600 with landed receipts, atomic:false; all receipts present and 0x1 → 200. Receipts carry exactly the spec fields (logs{address,data,topics}, status, blockHash, blockNumber, gasUsed, transactionHash), in call order (= onchain order on anvil); non-atomic responses always use an array (spec MUST), atomic responses use an array too (spec MAY).

wallet_showCallsStatus([id]): unknown id → 5730; known → push to shownCallsStatusIds, return null (headless no-op a test can assert).

EIP-7702 (all verified empirically on anvil 1.5.1, default hardfork): ChainController.signAuthorization wraps client.signAuthorization (viem 2.52 walletActions already includes it) with privateKeyToAccount coercion for raw-Hex authorities. delegate() signs and submits a type-4 tx from an unlocked sponsor via raw eth_sendTransaction with an RPC-shaped authorizationList (hex chainId/nonce/yParity, address field), passing executor:'self' when sponsor === authority so viem signs nonce+1; receipt type is 0x4 and eth_getCode becomes 0xef0100‖address. revokeDelegation() authorizes the zero address (code resets to 0x — verified). getDelegation() parses the designator. There is no anvil_signAuthorization RPC and viem signAuthorization is local-account-only, hence the account: Account|Hex parameter (anvil's default-mnemonic keys keep it hermetic). True-atomic sendCalls through a consumer-deployed 7702 delegator is deliberately out of v1: snapshot-rollback gives equivalent observable atomicity for tests; docs/API.md gets a recipe combining chain.delegate + a batch-executor contract for consumers who need single-tx semantics. PrivateKeyRpcClient additionally maps params[0].authorizationList (currently dropped by the explicit field mapping in its eth_sendTransaction case) into viem's sendTransaction, and live-fixtures passes eip5792: { atomic: 'unsupported' } so atomicRequired batches fail 5760 instead of pretending to roll back a public testnet.

### Files touched

| Path | Change |
| --- | --- |
| `/Users/adhyr/Repos/web3-tester/src/mock-wallet-controller.ts` | Add Eip5792Options/AtomicCapabilityStatus/CallsBatchRecord types and eip5792 option; add 'wallet_sendCalls' to SIGNING_METHODS; new switch cases for the four wallet_* methods; private batch Map + backedChainIds + clientForChain(chainId) seam; public sentCallBatches, shownCallsStatusIds, simulateAtomicUpgradeRejection(); ready→supported flip after first atomic success |
| `/Users/adhyr/Repos/web3-tester/src/anvil.ts` | ChainController.signAuthorization/delegate/revokeDelegation/getDelegation + ChainAuthorizationOptions/DelegateOptions types; RPC-shape authorization serializer (hex chainId/nonce/yParity, address field) |
| `/Users/adhyr/Repos/web3-tester/src/private-key-rpc-client.ts` | Map authorizationList through eth_sendTransaction (currently dropped); public signAuthorization() delegating to walletClient with the local account |
| `/Users/adhyr/Repos/web3-tester/src/live-fixtures.ts` | Default eip5792: { atomic: 'unsupported' } in the wallet fixture's MockWalletControllerOptions (before ...options.walletOptions so consumers can override) |
| `/Users/adhyr/Repos/web3-tester/src/index.ts` | Export Eip5792Options, AtomicCapabilityStatus, CallsBatchRecord, ChainAuthorizationOptions, DelegateOptions types |
| `/Users/adhyr/Repos/web3-tester/tests/eip5792.spec.ts` | New hermetic spec: capabilities shape/filter/4100, happy path 200+receipts, full 57xx error matrix, approval gating (approveNext arms batch, 4001 sends nothing, holdNextRequest), atomic rollback 500 with state assert, non-atomic 600 partial, ready→supported flip, eip5792:false legacy 4200 |
| `/Users/adhyr/Repos/web3-tester/tests/eip7702.spec.ts` | New hermetic spec: delegate/getDelegation/revokeDelegation, receipt type 0x4, sponsor==authority (executor self) path, designator parsing |
| `/Users/adhyr/Repos/web3-tester/playwright.config.ts` | Add **/eip5792.spec.ts and **/eip7702.spec.ts to the library project's testMatch list |
| `/Users/adhyr/Repos/web3-tester/docs/API.md` | New EIP-5792 subsection under MockWalletController (options, error/status tables, live-mode N-real-tx warning, atomic-emulation caveats) and EIP-7702 helpers under ChainController/PrivateKeyRpcClient + delegator recipe |
| `/Users/adhyr/Repos/web3-tester/CHANGELOG.md` | 0.3.0 entry; call out default-on capability advertisement as a behavior change with the eip5792:false escape hatch |
| `/Users/adhyr/Repos/web3-tester/dist/` | Rebuild committed dist (CI freshness gate) |

### New dependencies

None.

### Test strategy

Everything is hermetic and joins the `library` Playwright project (npm test / CI gate) — anvil 1.5.1's default hardfork already executes type-4 transactions, so no fork URL, network, or secrets are needed. tests/eip5792.spec.ts drives the injected provider via raw page.evaluate(window.ethereum.request(...)) rather than viem's client so the spec suite pins our wire shapes, not viem's; it covers: getCapabilities map shape/chainIds filter/4100-unauthorized; sendCalls happy path (id format 0x+64-hex, sentTransactions grows per call, getCallsStatus 200 with ordered receipts, atomic:true, on-chain balance change); the full validation matrix (-32602 bad version/empty calls, 4100 foreign from, 5710 chain mismatch and cosmetic-switch chain, 5720 duplicate id, 5740 oversize, 5700 non-optional unknown capability with optional:true counter-case, 5760 atomic-unsupported, 5750 upgrade rejection, 5730 unknown bundle on both status methods); approval semantics (autoApprove(false)+single approveNext arms a 3-call batch, simulateRejection→4001 with sentTransactions unchanged per spec MUST, holdNextRequest exposes batch params before approve); atomic rollback (batch with a reverting call → 500, prior call's state change reverted via balance assert); non-atomic partial (atomic:'unsupported' wallet → 600, landed receipts only); ready→supported flip; eip5792:false legacy 4200 for all four methods. tests/eip7702.spec.ts exercises ChainController helpers against the worker anvil using default-mnemonic-derived keys (delegate → code 0xef0100‖addr + receipt type 0x4, revoke → 0x, getDelegation round-trip, sponsor==authority self-executor path). PrivateKeyRpcClient's authorizationList mapping and signAuthorization get hermetic coverage too — private-key-rpc-client.spec.ts already runs against local anvil with a known key, which is a valid 7702 target. Real-MetaMask 5792 behavior is explicitly out of scope here (belongs to the env-gated realwallet-surface smoke suite).

### Effort

4–5 focused days. Dominated by wallet_sendCalls execution/status semantics and the breadth of the error-path test matrix (~10 distinct codes × gating interactions, plus rollback/partial/pending state assertions — roughly 60% of the work). The 7702 chain helpers are ~1 day since the anvil surface is verified working; docs/API.md tables, CHANGELOG, and dist rebuild ~0.5 day; remainder is hardening (blockTime pending path, live-fixtures wiring, multichain seam review).

### Depends on

- multichain

### Risks

- **Default-on capability advertisement changes existing consumer test behavior: dapps probing wallet_getCapabilities (wagmi/viem do this automatically) currently get a 4200 and fall back to eth_sendTransaction; after this ships they will take the sendCalls path in tests**
  Mitigation: eip5792: false restores legacy behavior exactly; CHANGELOG flags it as the one behavior change in 0.3.0; the default-on choice is also listed as an open question for the maintainer
- **Snapshot-rollback 'atomicity' diverges from real MetaMask: N transactions/receipts instead of one 7702 tx, and a failed atomic batch returns 500 with no receipts where MetaMask would return one reverted receipt (anvil automine rejects reverting txs at submission, so no receipt ever exists)**
  Mitigation: Documented divergence table in API.md; status code and atomic flag (what dapps actually branch on) match the spec; future delegator-based true-atomic path is sketched as a recipe via chain.delegate for consumers who assert receipt counts
- **With anvilOptions.blockTime > 0 the atomic guarantee weakens: rollback only covers submission-time failures, and a mined-later revert yields 500 without state rollback after the response was already returned**
  Mitigation: getCallsStatus returns 100 while receipts are pending (spec-correct); the limitation is documented next to blockTime in API.md; library tests pin the automine default where the guarantee is exact
- **Collision with the parallel multichain feature: both touch how handleRpcRequest reaches a backing client, and sendCalls must execute on the chain named in the request once routing exists**
  Mitigation: All 5792 execution goes through one private clientForChain(chainId) seam (v1: returns this.rpcClient, 5710 for anything but the backed active chain); multichain only swaps that function and extends backedChainIds from its routing table — agreed integration point, no shared state otherwise
- **Wallet-side 5792 conventions still drift (MetaMask has shipped behavior changes around version strings and per-chain omission through 2025)**
  Mitigation: Semantics pinned to the Final EIP text (immutable) with MetaMask-specific decisions (version '2.0.0' → -32602, active-chain-only 5710, omit unsupported chains) isolated and individually documented so they can be relaxed without touching spec-mandated codes

### External facts verified by the designer

- EIP-5792 is Final; exact error codes 5700 (unsupported non-optional capability), 5710 (unsupported chain id), 5720 (duplicate id), 5730 (unknown bundle id), 5740 (bundle too large), 5750 (atomic-ready upgrade rejected), 5760 (atomicity not supported), plus 4001/4100/-32602; status codes 100/200/400/500/600; atomic capability statuses supported/ready/unsupported; id rules (0x-hex, ≤4096 bytes / 8194 chars, unique per sender per app, MUST be unpredictable); 'MUST NOT send any calls if user rejects'; atomic field MUST reflect actual execution; non-atomic MUST return an array of receipts; spec silent on stop-on-failure during non-atomic execution and on version-mismatch error codes — fetched https://eips.ethereum.org/EIPS/eip-5792 and the raw EIP markdown, 2026-06-10
- MetaMask requires version '2.0.0' in wallet_sendCalls, returns capabilities only for supported chains (omits others), uses atomic 'ready'→EOA-upgrade-prompt→'supported' via EIP-7702, and errors rather than executing sequentially when atomic is unsupported — https://docs.metamask.io/wallet/how-to/send-transactions/send-batch-transactions/
- Anvil 1.5.1-stable (locally installed, built 2025-12-22): default hardfork ('latest') executes EIP-7702 — eth_sendTransaction from an UNLOCKED account with an authorizationList returns a hash, receipt type 0x4 status 0x1, and the authority's eth_getCode becomes 0xef0100‖delegate; zero-address authorization resets code to 0x; there is NO anvil_signAuthorization RPC; anvil answers wallet_getCapabilities with {} (experimental namespace) but wallet_sendCalls/wallet_getCallsStatus are -32601 — verified empirically by running anvil + viem locally
- evm_snapshot/evm_revert rolls back transactions submitted between them (balance restored, revert returns true) — verified empirically on local anvil, underpinning the atomic-emulation design
- viem 2.52.0 (the installed dev dep; peer floor is >=2.39.3): walletActions decorator includes stable (non-experimental) sendCalls, getCallsStatus, getCapabilities, showCallsStatus, waitForCallsStatus, and signAuthorization, so ChainController.client already has signAuthorization; viem sendCalls defaults version '2.0.0' and offers experimental_fallback to sequential eth_sendTransaction; signAuthorization works only with local accounts (privateKeyToAccount exposes account.signAuthorization — verified against node_modules) — viem.sh docs + local node_modules inspection

### Open questions

- Default posture: ship eip5792 enabled with atomic:'supported' (MetaMask-2026-faithful, my recommendation — matches the library's MetaMask-faithfulness convention and the differentiation goal) or disabled by default as the review suggested (zero behavior change for existing consumers whose dapps probe capabilities)? This is the only consumer-visible behavior change in the feature.
- Failed atomic batch representation: 500 with receipts omitted (proposed — honest about the rollback emulation) vs synthesizing a single MetaMask-style reverted receipt (more faithful wire shape, but the receipt would reference a transaction that no longer exists on the rolled-back chain)?
- Non-atomic execution stops at the first failed call (status 600 with landed receipts) — the spec is silent and MetaMask never executes non-atomically; confirm stop-on-failure over continue-all before tests pin it.
- Is the v1 cut of 7702 right: designator-level helpers plus a documented delegator recipe, deferring single-tx true-atomic wallet_sendCalls (needs a consumer-deployed batch-executor contract and authority private keys in the controller) to a follow-up?

### Adversarial review

**Blockers (must change before implementation):**
- The atomic-emulation mechanism as written cannot deliver its headline guarantee: because anvil mines reverting eth_sendTransaction calls with status 0x0 instead of erroring (verified empirically, no gas field needed), 'submission failure' detection never fires for the dominant failure mode, so atomicRequired batches with a reverting call silently execute partially with no evm_revert and the 500 path is unreachable. The design must be revised to a receipt-status-checked execution loop: in atomic mode under automine, after each eth_sendTransaction fetch eth_getTransactionReceipt (synchronously available) and on status 0x0 OR submission error do evm_revert(snapshot), record failure, and only then return the id. This also forces an explicit decision for anvilOptions.blockTime > 0, where receipts are NOT available at submission time: either (a) sendCalls returns the id immediately and atomic mode is documented as submission-error-only (no revert-on-mined-failure — the current risk note, but it must be stated as 'no rollback at all for mined reverts', stronger than written), or (b) atomic mode briefly polls for receipts before responding (diverges from real wallet latency semantics). Without this revision the centerpiece feature is broken as specified; with it, the design is implementable on verified primitives.

**Corrections:**
- The claim 'anvil automine rejects reverting txs at submission, so no receipt ever exists' is FALSE. Verified empirically on the exact anvil 1.5.1-stable binary (b0a9dd9): eth_sendTransaction to an always-revert contract (runtime 0x60006000fd) WITHOUT a gas field returns a hash and mines a receipt with status 0x0; only eth_estimateGas returns the 'execution reverted' error. Anvil applies a default gas limit instead of estimating, so reverting calls are never rejected at submission. Consequence: the design's atomic failure path ('On any submission failure in atomic mode: evm_revert(snapshot)') never triggers for on-chain reverts — an atomicRequired batch with a reverting middle call would land call 1, mine call 2 with status 0x0, record everything as success, and getCallsStatus's own mapping ('any landed receipt with status 0x0 → 600, atomic:false') would then contradict the recorded atomic:true execution with no rollback ever happening. The risk-section premise ('no receipt ever exists') and the second open question are built on this false fact. What is actually true: under automine the receipt is available synchronously after eth_sendTransaction, so the fix is to fetch each call's receipt immediately after submission and treat status 0x0 as failure → evm_revert (verified: after evm_revert, eth_getTransactionReceipt for the rolled-back tx returns null, so '500 with receipts omitted' stays coherent). Submission-time errors (insufficient funds, bad nonce/params) still exist as a second failure class and both must be handled.
- The externalFactsVerified entry 'anvil answers wallet_getCapabilities with {}' (echoing the review's verifier correction) is imprecise: verified that anvil 1.5.1 returns {} only for EMPTY/absent params; the spec-shaped probe a real dapp sends — params [address] or [address, [chainIds]] — gets -32602 'invalid type: string, expected unit'. Immaterial to the design (the new case branch intercepts before anvil), but the stated fact is wrong for every realistic probe shape.
- dependsOn: ["multichain"] contradicts the design's own v1 description. The behavior section says clientForChain(chainId) 'v1: returns this.rpcClient' with 5710 for anything but the backed active chain, and that multichain 'only swaps that function' later — i.e., nothing in this feature requires multichain to land first; the dependency is inverted (multichain consumes the seam this feature introduces). Listing it as a hard dependency needlessly serializes the roadmap; downgrade to a coordinate-with note.
- The non-atomic failure taxonomy is misclassified given the corrected anvil reality: the design maps 'first call failed' → 'offchain' (status 400), but a first call that mines with status 0x0 IS included onchain — per the spec (verified at eips.ethereum.org), 400 means 'not been included onchain and wallet will not retry', 500 means 'reverted completely', 600 'reverted partially'. Correct mapping: 400 only when no call landed (pure submission errors); all-calls-reverted-but-mined → 500 even in non-atomic mode (e.g. a 1-call batch whose call mines status 0x0); 600 only when a mix landed. Also, detecting 'failure' in non-atomic mode requires the same receipt-status check, not just submission errors.
- Verified-true claims worth recording so the implementer doesn't re-litigate them: every EIP-5792 code/status/id/capability claim in externalFactsVerified matches the Final spec text (5700/5710/5720/5730/5740/5750/5760, 100/200/400/500/600, 4096-byte/8194-char unpredictable ids, '0x0' cross-chain key, per-call capabilities, 'MUST NOT send any calls' on rejection, atomic-true MAY return multiple receipts); MetaMask docs confirm version '2.0.0' required, chainId-must-match-selected-network, ready→7702-upgrade→supported, and per-chain omission in getCapabilities; viem walletActions ships stable sendCalls/getCallsStatus/getCapabilities/showCallsStatus/signAuthorization at BOTH the installed 2.52.0 and the 2.39.3 peer floor (checked unpkg), SignedAuthorization is a top-level type export, contractAddress is a valid alias of address in AuthorizationRequest, and executor?: 'self' | Account | Address exists on prepareAuthorization; anvil 7702 via raw eth_sendTransaction from an unlocked sponsor with hex-shaped authorizationList works exactly as claimed (receipt type 0x4 status 0x1, code 0xef0100‖addr, zero-address revoke resets to 0x); PrivateKeyRpcClient really does silently drop authorizationList (src/private-key-rpc-client.ts:157-174 explicit field list); 'wallet_sendCalls joins SIGNING_METHODS' inherits exactly what the design claims (src/mock-wallet-controller.ts:68-92 builds APPROVAL_GATED_METHODS by spreading SIGNING_METHODS at module load; line 469 gives 4100-when-disconnected); no existing test breaks under default-on (the 4200 fallback test uses wallet_definitelyNotAMethod, tests/mock-wallet.spec.ts:379).

**Improvements:**
- Serialize snapshot-scoped execution: handleRpcRequest invocations are concurrent (each exposeBinding call is independent, src/mock-wallet-controller.ts:231-247), so between evm_snapshot and evm_revert an interleaved page-initiated eth_sendTransaction (or a second wallet_sendCalls) gets silently rolled back by the batch's revert, or persists into a half-batch state. Add a simple promise-chain mutex on the controller covering atomic-batch execution (and ideally eth_sendTransaction) — a few lines, and it makes the rollback guarantee actually sound. The fixture-level snapshot nesting is safe (verified: reverting a later snapshot id leaves the fixture's earlier id from src/fixtures.ts:95 valid).
- Pin the authorizationList shape conversion in PrivateKeyRpcClient: dapp-supplied entries are RPC-shaped hex (chainId/nonce/yParity per execution-apis) while viem's sendTransaction authorizationList expects numeric chainId/nonce (viem _types/types/authorization.d.ts: Authorization<uint32 = number>), so a passthrough behind the existing 'as never' cast would serialize wrong RLP or throw deep in viem — exactly the silent-failure class this fix exists to remove. Specify hex→number coercion plus validation that rejects malformed entries loudly.
- Live-mode blast radius under deny-by-default: a bare approveNext() (no methods, no match) now covers a wallet_sendCalls batch of up to maxCallsPerBatch=100 real-key transactions where it previously covered exactly one. Consider a smaller live-fixtures default (e.g. maxCallsPerBatch: 10 alongside atomic:'unsupported'), and have the promised API.md warning specifically call out the bare-arm case and recommend approveNext('wallet_sendCalls', match). Alternatively default eip5792 enabled:false in live-fixtures only — capability-probing dapps then keep today's eth_sendTransaction fallback path with per-tx arming.
- Guard the snapshot seam against the live-override footgun: if a consumer overrides atomic to 'supported' in live mode, the controller will issue evm_snapshot against a public RPC mid-request and leak a raw transport error to the dapp. Wrap the snapshot call and convert failure into a clear providerError (or auto-degrade to atomic:'unsupported' semantics with a console warning) so the failure mode is diagnosable.
- delegate() with sponsor === authority (executor:'self') only works via raw eth_sendTransaction if the authority is one of anvil's unlocked accounts; for arbitrary Account|Hex authorities, reuse the existing ChainController.impersonateAccount (src/anvil.ts:352) around the send, or document the constraint. Also pin where the authorization nonce defaults come from (viem's prepareAuthorization fetches the authority's getTransactionCount and adds 1 for executor:'self' — worth stating so the sponsored vs self paths are testable).
- Apply the same case-insensitive account comparison to wallet_sendCalls' from validation as the design already specifies for getCapabilities — this.accounts stores checksummed addresses and dapps routinely send lowercase; the existing eth_sendTransaction path never validates from, so this is the first place the comparison matters. Also record atomicRequired and per-call capabilities on CallsBatchRecord so tests can assert what the dapp actually requested, not just what executed.
- Pin two spec-edge tests the strategy misses: (a) a 1-call non-atomic batch whose call mines with status 0x0 must report 500 (reverted completely), not 600 — falls out of the corrected status taxonomy; (b) eip5792:false must assert wallet_getCapabilities still returns 4200 via the wallet_-namespace guard (src/mock-wallet-controller.ts:601), pinning the legacy posture the CHANGELOG escape hatch promises.
- Effort: add ~0.5–1 day to the 4–5 day estimate for the receipt-status failure-detection rework and the mutex — the error-path matrix the estimate already calls 60% of the work grows by the mined-revert × {atomic, non-atomic} × {automine, blockTime} grid.


## Transaction assertion matchers (expect helpers) — key: matchers

**Review verdict:** needs-revision. In-workflow verifier died on an API error; this verdict is from a standalone re-run (2026-06-10).

### Goal

After this ships, a consumer imports `expect` from `@marigoldlabs/web3-tester` (or `/matchers`) and writes hardhat-chai-matchers-style assertions directly in Playwright tests: `await expect(wallet.waitForNextTransaction()).toEmitEvent(chain, abi, 'Transfer', { args: { to: addr } })`, `toChangeBalance(s)`, `toChangeTokenBalance(s)`, `toBeReverted` / `toBeRevertedWith(reason|RegExp)` / `toBeRevertedWithCustomError(abi, name)`, and `toHaveTokenBalance` — with decoded-log failure diffs, plus a first-class `chain.waitForTransaction(hash, { abi })` that returns a receipt with decoded logs and an extracted revert reason. Matchers work identically in mock mode (ChainController), live mode (PrivateKeyRpcClient via a new `.client` getter), and real-wallet mode (any viem PublicClient), and compose with consumer matchers via `mergeExpects` or by spreading the exported `web3Matchers` record.

### API surface

```typescript
// ─── src/transactions.ts (new) — chain-side helpers shared by matchers and ChainController ───
import type { Abi, Address, Hex, Log, TransactionReceipt } from 'viem';

/** Anything the matchers can read a chain through. ChainController, PrivateKeyRpcClient
 *  (via the new `client` getter), or a bare viem PublicClient all satisfy it structurally. */
export type ReadClient = {
  getTransactionReceipt(args: { hash: Hex }): Promise<TransactionReceipt>;
  waitForTransactionReceipt(args: { hash: Hex; timeout?: number }): Promise<TransactionReceipt>;
  getTransaction(args: { hash: Hex }): Promise<{ from: Address; to: Address | null; input: Hex; value: bigint; gas: bigint }>;
  getBalance(args: { address: Address; blockNumber?: bigint }): Promise<bigint>;
  readContract(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
  call(args: Record<string, unknown>): Promise<unknown>;
  getBlock(args: { blockNumber: bigint }): Promise<{ transactions: readonly Hex[] }>;
};
export type ChainLike = ReadClient | { client: ReadClient };          // ChainController fits the second arm

export type TransactionRef = Hex | { hash: Hex };                     // SentTransactionRecord fits { hash }
export type TransactionTarget = TransactionRef | Promise<TransactionRef>; // waitForNextTransaction() fits
export type RevertTarget = TransactionTarget | Promise<unknown> | (() => Promise<unknown>);

export type RevertInfo =
  | { kind: 'reason'; reason: string; data: Hex }                      // Error(string)
  | { kind: 'panic'; code: bigint; description: string; data: Hex }    // Panic(uint256)
  | { kind: 'custom'; errorName: string; args?: readonly unknown[]; selector: Hex; data: Hex }
  | { kind: 'unknown'; data?: Hex; message?: string };                 // reverted, nothing decodable

export type DecodedTransaction = {
  receipt: TransactionReceipt;
  status: 'success' | 'reverted';
  /** parseEventLogs({ abi, logs, strict: false }) result when an abi is supplied, else []. */
  logs: (Log & { eventName: string; args: unknown })[];
  /** Populated when status === 'reverted' and the reason is recoverable (call replay). */
  revertReason?: string;
  revertInfo?: RevertInfo;
};

export function waitForDecodedTransaction(
  client: ReadClient, hash: Hex,
  options?: { abi?: Abi; timeoutMs?: number },
): Promise<DecodedTransaction>;

/** Walks an error's `cause` chain for revert data (ContractFunctionRevertedError.raw,
 *  RpcRequestError.data, nested `.data.data`, "execution reverted: …" message text). */
export function extractRevertInfo(error: unknown, abi?: Abi): RevertInfo | undefined;

// ─── src/matchers.ts (new) ───
import { expect as baseExpect, type ExpectMatcherState, type MatcherReturnType } from '@playwright/test';

export type EventArgsExpectation = Record<string, unknown> | readonly unknown[]; // named or positional; positional `undefined` = wildcard; values may be `(actual) => boolean` predicates
export type EventMatchOptions = { args?: EventArgsExpectation; address?: Address; count?: number; timeout?: number };
export type BalanceChange = { address: Address; delta: bigint | number | string };

/** hardhat-chai-matchers `anyValue` parity for arg wildcards. */
export const anyValue: (value: unknown) => boolean;

export const web3Matchers: {
  toEmitEvent(this: ExpectMatcherState, tx: TransactionTarget, chain: ChainLike, abi: Abi, eventName: string, options?: EventMatchOptions): Promise<MatcherReturnType>;
  toChangeBalance(this: ExpectMatcherState, tx: TransactionTarget, chain: ChainLike, address: Address, delta: bigint | number | string, options?: { includeFee?: boolean; timeout?: number }): Promise<MatcherReturnType>;
  toChangeBalances(this: ExpectMatcherState, tx: TransactionTarget, chain: ChainLike, changes: readonly BalanceChange[], options?: { includeFee?: boolean; timeout?: number }): Promise<MatcherReturnType>;
  toChangeTokenBalance(this: ExpectMatcherState, tx: TransactionTarget, chain: ChainLike, token: Address, address: Address, delta: bigint | number | string, options?: { timeout?: number }): Promise<MatcherReturnType>;
  toChangeTokenBalances(this: ExpectMatcherState, tx: TransactionTarget, chain: ChainLike, token: Address, changes: readonly BalanceChange[], options?: { timeout?: number }): Promise<MatcherReturnType>;
  toBeReverted(this: ExpectMatcherState, tx: RevertTarget, chain: ChainLike, options?: { timeout?: number }): Promise<MatcherReturnType>;
  toBeRevertedWith(this: ExpectMatcherState, tx: RevertTarget, chain: ChainLike, reason: string | RegExp, options?: { timeout?: number }): Promise<MatcherReturnType>;
  toBeRevertedWithCustomError(this: ExpectMatcherState, tx: RevertTarget, chain: ChainLike, abi: Abi, errorName: string, options?: { args?: readonly unknown[]; timeout?: number }): Promise<MatcherReturnType>;
  toHaveTokenBalance(this: ExpectMatcherState, holder: Address, chain: ChainLike, token: Address, expected: bigint | number | string | ((balance: bigint) => boolean), options?: { timeout?: number }): Promise<MatcherReturnType>;
};

/** Pre-extended expect; Expect<typeof web3Matchers> so all matchers are fully typed. */
export const expect: ReturnType<typeof baseExpect.extend<typeof web3Matchers>>;

// ─── src/anvil.ts — ChainController addition ───
class ChainController {
  // ...existing...
  waitForTransaction(hash: Hex, options?: { abi?: Abi; timeoutMs?: number }): Promise<DecodedTransaction>;
}

// ─── src/private-key-rpc-client.ts — one-line addition so live mode satisfies ChainLike ───
class PrivateKeyRpcClient {
  /** Read-only viem public client backing this wallet (for matchers / receipt waits). */
  get client(): PublicClient;
}

// ─── Realistic usage (mock mode) ───
import { test, expect } from '@marigoldlabs/web3-tester';
import { erc20Abi, parseEther } from 'viem';

test('buy flow transfers tokens and emits Purchased', async ({ page, chain, wallet }) => {
  const pending = wallet.waitForNextTransaction();
  await page.getByRole('button', { name: 'Buy' }).click();

  await expect(pending).toEmitEvent(chain, saleAbi, 'Purchased', {
    args: { buyer: wallet.primaryAccount, amount: (v: bigint) => v > 0n },
  });
  await expect(wallet.sentTransactions[0]).toChangeBalance(chain, wallet.primaryAccount, -parseEther('1'));
  await expect(wallet.primaryAccount).toHaveTokenBalance(chain, TOKEN, 100n);

  const { logs } = await chain.waitForTransaction(wallet.sentTransactions[0], { abi: saleAbi });
});

test('over-cap purchase reverts with CapExceeded', async ({ chain }) => {
  await expect(
    chain.client.writeContract({ address: SALE, abi: saleAbi, functionName: 'buy', args: [HUGE], account: buyer, chain: null }),
  ).toBeRevertedWithCustomError(chain, saleAbi, 'CapExceeded', { args: [HUGE] });
});

// ─── Composing with the consumer's own matchers ───
import { mergeExpects, expect as baseExpect } from '@playwright/test';
import { expect as web3Expect, web3Matchers } from '@marigoldlabs/web3-tester/matchers';
export const expect = mergeExpects(web3Expect, myExpect);            // option A
export const expect2 = baseExpect.extend({ ...web3Matchers, ...myMatchers }); // option B
```

### Behavior

RECEIVER RESOLUTION (all tx matchers): the receiver may be a Hex hash, a `{ hash }` record (so `wallet.sentTransactionRequests[0]` works), or a promise of either (so `expect(wallet.waitForNextTransaction()).toEmitEvent(...)` reads naturally). Runtime-validates `/^0x[0-9a-f]{64}$/i` and fails the matcher (not a throw) with a clear "received is not a transaction hash" message otherwise. `ChainLike` is normalized via `'client' in chain ? chain.client : chain`, so `chain` (ChainController), `liveClient` (via the new `client` getter), or any viem PublicClient all work — this is what keeps the matchers mode-agnostic and ready for the multichain feature (the chain is always an explicit argument, never ambient).

toEmitEvent: `waitForTransactionReceipt({ hash, timeout: options.timeout ?? this.timeout })` (Playwright's configured expect timeout is the default, available as `ExpectMatcherState.timeout`), then `parseEventLogs({ abi, logs: receipt.logs, eventName, strict: false })`, filtered by `options.address` (emitter, case-insensitive) when given. Args matching: named object compares per-key; positional array compares in ABI input order with `undefined` as wildcard; values may be predicates `(actual) => boolean` (exported `anyValue` = hardhat parity, verified against the hardhat-chai-matchers reference). Equality is bigint-aware (number/decimal-string expected values are coerced to bigint when the decoded value is bigint) and hex strings compare case-insensitively (addresses). `count` asserts the exact number of matching logs; default passes on >=1. Failure message uses `this.utils.matcherHint('toEmitEvent', …, { isNot: this.isNot, promise: this.promise })` and lists every decoded event in the receipt as `EventName(name: value, …)` (undecodable logs shown as `topic0` + address) — and if the receipt status is 'reverted' it says so explicitly, since "no events because it reverted" is the classic confusion. `expected`/`actual` MatcherReturnType fields are populated so reporters/trace show a structured diff.

toChangeBalance(s): waits for the receipt, then computes `getBalance({ address, blockNumber: receipt.blockNumber }) - getBalance({ address, blockNumber: receipt.blockNumber - 1n })`. Per verified hardhat semantics, transaction fees are EXCLUDED by default for the sender: when `address` equals `receipt.from` (case-insensitive) and `includeFee` is not true, `receipt.gasUsed * receipt.effectiveGasPrice` is added back, so a 1 ETH transfer asserts cleanly as `-parseEther('1')`. Anvil keeps full in-memory historical state so block-N-1 reads always work (fork mode: receipt blocks are post-fork). Edge: with `blockTime` mining, multiple txs can share a block and pollute the diff — on failure the matcher fetches the block and, if it contains >1 transaction, appends "N other transactions in this block also moved balances" to the message. Failure shows a per-address expected/observed delta table via `printDiffOrStringify`. toChangeTokenBalance(s) are identical but read `balanceOf(address)` via `readContract` with viem's exported `erc20Abi` at the two block heights (no fee adjustment — tokens don't pay gas).

toBeReverted / toBeRevertedWith / toBeRevertedWithCustomError — two entry paths:
(1) Promise/function receiver (test-driven writes, or a dapp promise surfaced to the test): await it. If it REJECTS, run `extractRevertInfo`: walk the `cause` chain (viem `BaseError.walk`-style manual walk so plain objects work too) looking for `ContractFunctionRevertedError` (use its decoded `data`/`raw`), any `.data` that is revert-shaped hex (covers viem `RpcRequestError.data`, which is set from the raw JSON-RPC error — anvil puts revert bytes there on estimation failure), nested `.data.data`, else parse `execution reverted: <reason>` / `revert: <reason>` out of the message. If nothing revert-shaped is found, the error is NOT swallowed — it is rethrown wrapped with context; specifically a wallet 4001/4100 (`providerError` shape from the deny-by-default live gating or `simulateRejection`) rethrows with the hint "the wallet rejected the request (code 4001) — wallet approval failure, not a chain revert", so `.not.toBeReverted` can never mask a gating bug. If the promise RESOLVES to a tx ref, fall through to path 2; if it resolves to anything else, fail with "expected revert, but the call succeeded".
(2) Hash receiver: wait for the receipt. `status === 'success'` ⇒ fail ("expected transaction to revert; it succeeded, gasUsed=…"). `status === 'reverted'` ⇒ plain toBeReverted passes immediately; the reason-checking variants replay the tx: `getTransaction(hash)` then `call({ account: tx.from, to: tx.to, data: tx.input, value: tx.value, gas: tx.gas, blockNumber: receipt.blockNumber - 1n })` and extract revert data from the throw. This is the standard anvil technique (anvil mines reverting txs only when explicit gas skips estimation; on default auto-mine each tx is alone in its block so parent-block replay is exact — verified via foundry issue discussion). If the replay unexpectedly succeeds (multi-tx block state divergence), the matcher fails with an explicit diagnostic naming the limitation rather than guessing.
Decoding uses viem `decodeErrorResult({ abi: userAbi, data })`, which (verified in viem 2.52.0 source) always appends the built-in `Error(string)`/`Panic(uint256)` ABIs: `toBeRevertedWith` matches `Error(string)` reason by EXACT string equality or `RegExp.test` (hardhat parity); a Panic or custom error fails it with the decoded panic code+description (inline 0x01/0x11/0x12/0x21/0x22/0x31/0x32/0x41/0x51 map) or the custom error name/selector. `toBeRevertedWithCustomError` compares `errorName` against the provided ABI and optional `args` with the same equality rules as toEmitEvent; an undecodable selector fails with the 4-byte selector printed.

toHaveTokenBalance: receiver is the holder Address; single `readContract` balanceOf; `expected` is bigint-coerced exact or a predicate. It is a non-retrying read by design, but custom matchers are surfaced on `expect.poll` (verified: PollMatchers includes ToUserMatcherObject in 1.59 types), so `expect.poll(() => holder).toHaveTokenBalance(chain, token, 100n)` re-reads each poll — documented as the eventual-consistency pattern.

NEGATION/PROMISE MODIFIERS: all matchers honor `this.isNot` purely through the returned `pass` flag plus isNot-aware messages via matcherHint; `this.promise` is included in hints. No `.resolves/.rejects` needed since matchers are async and accept promises directly.

chain.waitForTransaction(hash, { abi, timeoutMs }): ChainController method delegating to `waitForDecodedTransaction(this.client, …)` — returns `{ receipt, status, logs, revertReason?, revertInfo? }` with logs decoded (`strict: false` so foreign logs don't throw) and the revert reason recovered via the same replay path when reverted. No change to existing ChainController methods, snapshot/revert semantics, or the wallet fixture; no new RPC methods are handled by the wallet (this feature is read-side only — `sentTransactions`, `sentTransactionRequests`, and `waitForNextTransaction` already exist on MockWalletController, so the review's "mock records nothing" half is already fixed on this branch).

SHIPPING/COMPOSITION: `src/matchers.ts` builds `expect = baseExpect.extend(web3Matchers)` once at module load (extend is pure/typed — returns `Expect<{} & typeof web3Matchers>`, verified in installed types). `src/fixtures.ts:120`, `src/live-fixtures.ts:107`, and `src/real-wallet-fixtures.ts:115` switch their `export { expect } from '@playwright/test'` to re-export the extended expect, so existing imports gain matchers with zero migration. Consumers with their own matchers use `mergeExpects(web3Expect, theirs)` (verified exported at playwright/test.mjs:33 and typed via MergedExpect) or spread `web3Matchers` into their own `.extend` call. No global `PlaywrightTest.Matchers` declaration merging — typing flows entirely through the `Expect<T>` generic, so nothing pollutes consumers who don't opt in. Typing caveat (from the verified `ToUserMatcherObject` mapping): a matcher only appears on `expect(x)` when x's type is assignable to the receiver parameter, so hashes must be typed `Hex` (everything the library hands out already is); documented in API.md.

### Files touched

| Path | Change |
| --- | --- |
| `/Users/adhyr/Repos/web3-tester/src/transactions.ts` | NEW (~220 lines): ReadClient/ChainLike/TransactionTarget/RevertTarget/RevertInfo/DecodedTransaction types, resolveClient, resolveTxHash, waitForDecodedTransaction, extractRevertInfo (cause-chain walker), replayRevert (eth_call at parent block via client.call), decodeRevertData (decodeErrorResult + panic map), bigint/hex-aware equality + stringify helpers shared with matchers. |
| `/Users/adhyr/Repos/web3-tester/src/matchers.ts` | NEW (~450 lines): web3Matchers record (toEmitEvent, toChangeBalance/toChangeBalances, toChangeTokenBalance/toChangeTokenBalances, toBeReverted, toBeRevertedWith, toBeRevertedWithCustomError, toHaveTokenBalance), anyValue, failure-message builders using this.utils.matcherHint/printDiffOrStringify, exported extended `expect`. |
| `/Users/adhyr/Repos/web3-tester/src/anvil.ts` | Add ChainController.waitForTransaction(hash, { abi, timeoutMs }) delegating to waitForDecodedTransaction(this.client, ...); import type Abi + DecodedTransaction from './transactions.js'. |
| `/Users/adhyr/Repos/web3-tester/src/private-key-rpc-client.ts` | Add `get client()` returning the (currently private) publicClient so PrivateKeyRpcClient satisfies ChainLike's { client } arm for live-mode matcher usage. |
| `/Users/adhyr/Repos/web3-tester/src/fixtures.ts` | Line 120: `export { expect } from './matchers.js';` (was '@playwright/test'). |
| `/Users/adhyr/Repos/web3-tester/src/live-fixtures.ts` | Line 107: same expect re-export switch. |
| `/Users/adhyr/Repos/web3-tester/src/real-wallet-fixtures.ts` | Line 115: same expect re-export switch (real-wallet users pass their own viem PublicClient as the chain arg). |
| `/Users/adhyr/Repos/web3-tester/src/index.ts` | Re-export web3Matchers, anyValue from './matchers.js' and types (ChainLike, TransactionTarget, RevertTarget, DecodedTransaction, RevertInfo, EventMatchOptions, BalanceChange) from './transactions.js' / './matchers.js'. The existing `export { test, expect } from './fixtures.js'` now carries the extended expect automatically. |
| `/Users/adhyr/Repos/web3-tester/package.json` | Add './matchers' and './transactions' subpath exports (types + import, dist-pointing) per existing per-module convention. |
| `/Users/adhyr/Repos/web3-tester/tests/matchers.spec.ts` | NEW hermetic spec (library project): every matcher's pass, fail (assert thrown message content), and .not paths; promise/hash/record receivers; live-shaped ChainLike variants ({client} vs bare client); composition smoke test with mergeExpects and matcher-spread; chain.waitForTransaction decoded logs + revertReason. |
| `/Users/adhyr/Repos/web3-tester/tests/matchers-contracts.ts` | NEW test-only module: committed solc-compiled runtime bytecode constants (source in comments) for an Emitter (emits a 3-arg indexed event), a Reverter (revert with Error('boom'), a custom error with args, and a Panic via assert), and a MiniToken (mint/transfer/balanceOf) — planted with chain.client.setCode (anvil_setCode), no compiler at runtime. |
| `/Users/adhyr/Repos/web3-tester/playwright.config.ts` | Add '**/matchers.spec.ts' to the library project's testMatch list so npm test runs it. |
| `/Users/adhyr/Repos/web3-tester/docs/API.md` | New 'Transaction assertion matchers' section: full matcher reference, ChainLike contract, fee-exclusion semantics, revert-extraction caveats (multi-tx blocks, fork mode), composition recipes (mergeExpects / spread), expect.poll pattern, receiver-typing caveat; document ChainController.waitForTransaction and PrivateKeyRpcClient.client. |
| `/Users/adhyr/Repos/web3-tester/CHANGELOG.md` | 0.3.0 entry; rebuild and commit dist/ (matchers.js/.d.ts, transactions.js/.d.ts and updated modules) to keep the CI dist-freshness gate green. |

### New dependencies

None.

### Test strategy

All new coverage is hermetic and joins the `library` Playwright project (anvil only, no network/secrets), so npm test stays self-contained. tests/matchers-contracts.ts commits pre-compiled runtime bytecode (solidity source kept in comments) planted via chain.client.setCode — no solc, no fork. Spec matrix in tests/matchers.spec.ts: (1) toEmitEvent pass via a page-driven eth_sendTransaction (reusing the requestFromPage pattern from tests/mock-wallet.spec.ts) asserted on `expect(wallet.waitForNextTransaction())` — pins promise receivers and the wallet-recording integration; named/positional/predicate/anyValue arg matching, bigint coercion, address case-insensitivity, `count`, `address` filter; failure path catches the thrown expect error and asserts the message lists the actually-emitted decoded events and flags reverted receipts; `.not` both directions. (2) toChangeBalance: 1 ETH transfer asserts -1 ETH for sender (pins default fee exclusion), `includeFee: true` asserts -1 ETH - gasUsed*effectiveGasPrice computed from the receipt (pins the exact adjustment), recipient +1 ETH, toChangeBalances multi-address, failure diff content. (3) Revert family: a tx sent with explicit `gas` so anvil mines it with status 'reverted' (pins the mined-revert + parent-block replay path), toBeRevertedWith exact string and RegExp, mismatch failure shows the actual decoded reason; toBeRevertedWithCustomError with and without args; a rejected writeContract promise (estimation failure) pins the error-walk extraction path; panic (assert overflow) failure message shows the panic code map; a wallet.simulateRejection() 4001 rejection pins the rethrow-with-hint behavior (revert matchers must not swallow approval-gating errors); success-tx failure path. (4) Token matchers against MiniToken: toHaveTokenBalance exact + predicate + expect.poll re-read, toChangeTokenBalance(s) after a transfer. (5) chain.waitForTransaction: decoded logs with abi, [] without, revertReason populated for the mined-reverted tx. (6) Composition: mergeExpects(web3Expect, expect.extend({toBeCustom...})) and baseExpect.extend({...web3Matchers, ...own}) both resolve both matcher families at runtime; tsc (npm run typecheck) pins the typed Expect<T> surface since the spec uses the typed signatures throughout. (7) ChainLike polymorphism: same assertion run with `chain`, `{ client: chain.client }`, and bare `chain.client`. Nothing in this feature needs env gating; live-mode PrivateKeyRpcClient.client is pinned hermetically by pointing a PrivateKeyRpcClient at the worker anvil (chain id 31337 is already allowlisted), mirroring tests/private-key-rpc-client.spec.ts.

### Effort

5–6 focused days. Dominated by (a) robust revert-data extraction across the three error shapes (viem walked causes, raw JSON-RPC error data, message-text fallback) plus the parent-block replay path and its diagnostics (~2 days), and (b) the hermetic test matrix with failure-path message assertions and the committed bytecode fixtures (~2 days). The matcher bodies, ChainController/PrivateKeyRpcClient additions, exports wiring, docs, and dist rebuild fill the remainder (~1.5 days).

### Depends on

Nothing (but see the sequencing plan — shared-substrate ordering still applies).

### Risks

- **Anvil version drift around reverted-tx handling: reverting sends are rejected at gas estimation unless explicit gas is supplied, and foundry has open quirks about revert status reporting (foundry#8094, #5365). The mined-reverted test path could behave differently across anvil versions.**
  Mitigation: The spec pins the explicit-gas mined-revert path so CI catches drift; the matcher handles both worlds anyway (rejected promise path and mined-receipt path share the same decode), and the replay-success edge fails with an explanatory diagnostic instead of a wrong answer.
- **Receiver-type filtering in Playwright's ToUserMatcherObject hides matchers when the receiver is typed plain `string` (e.g. a hash from consumer code not typed as Hex), looking like the matcher 'does not exist'.**
  Mitigation: Everything the library emits is already Hex-typed; API.md documents the constraint with an `as Hex` escape hatch; runtime validation gives a precise message if an invalid value slips through a cast.
- **Parent-block balance/replay reads assume historical state availability and one-tx-per-block; `blockTime` mining or dense fork blocks can make toChangeBalance diffs include unrelated txs or make replay diverge.**
  Mitigation: Default fixture mode is auto-mine (one tx per block) where both are exact; on failure the matcher detects multi-tx blocks and says so in the message; documented caveat in API.md rather than silent wrongness.
- **Failure-message rendering of bigints/decoded args through this.utils.stringify could be ugly or lossy (pretty-format vs bigint), degrading the headline feature (message quality).**
  Mitigation: Custom bigint-aware stringifier in transactions.ts used for the event/delta tables (only matcherHint/diff come from utils); failure-path tests assert on actual message substrings so regressions are caught.
- **Swapping the re-exported expect in fixtures/live-fixtures/real-wallet-fixtures changes the exported type from Expect<{}> to Expect<web3Matchers>; consumers who built their own extend on top of the re-export get a (benign but visible) type shape change.**
  Mitigation: Purely additive at runtime; CHANGELOG notes it and API.md shows the mergeExpects/spread recipes; consumers can still import the untouched expect from @playwright/test.

### External facts verified by the designer

- @playwright/test 1.59.1 (installed; peer >=1.56): expect.extend accepts async custom matchers shaped (this: ExpectMatcherState, receiver, ...args) => MatcherReturnType | Promise<MatcherReturnType>; ExpectMatcherState = { isNot, promise, utils, timeout }; ExpectMatcherUtils provides matcherHint/printDiffOrStringify/printExpected/printReceived/diff/stringify (no jest-style this.equals, hence the in-house bigint-aware equality) — node_modules/playwright/types/test.d.ts lines 8400–8521
- Playwright composition: mergeExpects(...expects) exists at type level (MergedExpect, test.d.ts:8567) and runtime (playwright/test.mjs:33); custom matchers are surfaced on expect() and expect.poll() through ToUserMatcherObject, which filters by assignability of the receiver type to the matcher's first parameter (test.d.ts:8431–8434, 8500–8507) — this drives both the typed-Hex receiver caveat and the expect.poll(toHaveTokenBalance) pattern
- viem 2.52.0 (installed): decodeErrorResult always appends built-in solidityError/solidityPanic ABIs to the user abi (_esm/utils/abi/decodeErrorResult.js: `const abi_ = [...(abi || []), solidityError, solidityPanic]`); parseEventLogs({ abi, logs, eventName, strict }) exported with strict:false skipping undecodable logs; RpcRequestError sets this.data = error.data from the raw JSON-RPC error (_esm/errors/request.js:93); BaseError.walk exists; ContractFunctionRevertedError carries decoded reason/panic; erc20Abi is a public export; setCode test action issues `${mode}_setCode` i.e. anvil_setCode (_esm/actions/test/setCode.js:32)
- hardhat-chai-matchers reference (hardhat.org, fetched 2026-06-10): full parity list (reverted, revertedWith accepting string OR regexp with exact-string semantics, revertedWithCustomError(+withArgs), revertedWithPanic, revertedWithoutReason, emit+withArgs with anyValue/custom predicates, changeEtherBalance(s), changeTokenBalance(s)); changeEtherBalance EXCLUDES transaction fees by default with { includeFee: true } to include them — adopted exactly
- Anvil revert behavior (foundry-rs/foundry issues #8094/#5365/#12812 + ecosystem docs, searched 2026-06-10): reverting eth_sendTransaction without explicit gas fails at estimation (error carries revert data), explicit gas yields a mined receipt with status reverted, and the standard reason-recovery technique is replaying via eth_call with the same fields at the parent block; known foundry quirks around revert status reporting justify pinning this in CI
- Current repo state (read, not assumed): MockWalletController already records sentTransactions/sentTransactionRequests and has waitForNextTransaction (src/mock-wallet-controller.ts:158–159, 336–349), so the review's 'mock records nothing' half is already fixed; ChainController.client is a viem test client extended with publicActions+walletActions (src/anvil.ts:327–333); PrivateKeyRpcClient.publicClient is private (src/private-key-rpc-client.ts:60); expect is re-exported untouched at src/fixtures.ts:120, src/live-fixtures.ts:107, src/real-wallet-fixtures.ts:115; hermetic specs drive the wallet via data: URLs and window.ethereum.request (tests/mock-wallet.spec.ts)

### Open questions

- toChangeBalances argument shape: this design uses readonly { address, delta }[] (self-documenting, hard to misalign) instead of hardhat's parallel (addresses[], deltas[]) arrays — confirm the deviation is acceptable or whether 1:1 hardhat call-shape matters for migration marketing
- Should toBeRevertedWithPanic(chain, code?) ship in this set for full hardhat parity, or is surfacing panic codes inside toBeReverted/toBeRevertedWith failure messages enough for 0.3.0? (Adding it later is ~30 lines; the decode path already exists)
- toBeRevertedWith string semantics: exact equality + RegExp (current hardhat behavior, adopted here) vs substring match (legacy waffle behavior some users expect) — exact is stricter and chosen, but worth a deliberate call
- MiniToken/Emitter/Reverter test bytecode: committed solc output with source-in-comments is proposed; if the parallel deal-helpers feature ships a deployContract/deal helper first, the token tests could reuse it instead — soft synergy only, no blocking dependency either way
- Naming of the live-mode accessor: `get client()` on PrivateKeyRpcClient mirrors ChainController.client but slightly blurs that it is read-only; alternative is exposing `publicClient` verbatim — pick one before it lands in docs/API.md

### Adversarial review

**Blockers (must change before implementation):**
- The hermetic test 'wallet.simulateRejection() 4001 rejection pins the rethrow-with-hint behavior' is unimplementable as specified — no test-process promise rejection produced by simulateRejection carries code 4001 across page.evaluate. Respecify the detection heuristic (message-text/envelope) before implementation.

**Corrections:**
- 4001 detection-by-code cannot work for dapp-surfaced rejections: the code is thrown test-process-side in MockWalletController, but any promise crossing back via page.evaluate loses the code property (playwright-core parseSerializedValue rebuilds errors with name/message/stack only; verified in installed 1.59.1). The repo's own requestFromPage pattern resolves an {ok:false, error:{code,message}} envelope rather than rejecting. Detection must be respecified to message-text/envelope matching, and the planned simulateRejection-pins-rethrow test must change accordingly.
- parseEventLogs({strict:false}) mechanism is wrong: in viem 2.52.0, logs whose topic0 matches no ABI event are silently dropped regardless of strict; strict:false only governs partial decoding of selector-matching logs. The promised 'undecodable logs shown as topic0 + address' failure rendering must come from diffing receipt.logs against the parsed set.
- 'extend is pure' is inaccurate: Playwright's expect.extend mutates the shared matcher registry (registers plain + GUID-qualified names) and returns a proxy routed through qualified names. Composition behavior is still as designed; only the mechanism claim is wrong.
- Type-machinery claims verified against installed 1.59.1; the peer floor >=1.56.0 was separately confirmed (ToUserMatcherObject present in MakeMatchers and PollMatchers in 1.56.0, mergeExpects exported) — pin claims to the floor, not the installed version.
- dependsOn:[] conflicts with the sequencer's shared contracts/ pipeline ruling: the design commits its own MiniToken/Emitter/Reverter bytecode while the pipeline owns test tokens. Use the shared TestERC20 artifact instead of a second bytecode source of truth.

**Improvements:**
- Fix the code-loss at the source: embed the EIP-1193 code in the error message (e.g. 'User rejected the request. (code 4001)') in serializeRpcError/injected provider so it survives Playwright's error serialization for every consumer.
- Use anvil debug_traceTransaction as primary/fallback revert-reason recovery for mined reverted txs — immune to multi-tx-block and block-env-dependent divergence (deadline/timestamp reverts) that parent-block eth_call replay glosses over.
- Specify rejected-receiver behavior for non-revert matchers (expect(wallet.waitForNextTransaction()).toEmitEvent(...) when the wallet rejects/times out), and reconcile the 15s waitForNextTransaction default vs 5s expect timeout.
- Runtime 20-byte address-shape check for toHaveTokenBalance receivers (Address and Hex are both 0x-strings, so a 32-byte hash type-checks).
- Pin .not + args semantics for toEmitEvent now (hardhat's '.not.emit().withArgs' ambiguity; also count:0 vs .not).
- Ship toBeRevertedWithPanic in 0.3.0 (~30 lines on the already-built decode path) to close the visible hardhat-parity gap.


## deal-helpers

**Review verdict:** needs-revision.

### Goal

After this ships, a consumer arranging on-chain state for a test can do it in one line each: `chain.dealErc20(usdc, user, 1_000_000n * 10n ** 6n)` sets any standard ERC-20 balance (forge-std `deal` parity, including on an ANVIL_FORK_URL mainnet fork, with optional totalSupply adjustment and a clear typed failure for non-standard tokens); `chain.deployContract({ abi, bytecode, args })` deploys any artifact through Anvil's unlocked accounts and returns the mined address; `chain.deployErc20({ symbol: 'USDX' })` deploys a batteries-included precompiled test token (artifact committed in-repo like dist, no solc step for consumers); and `chain.getErc20Balance(token, user)` reads a balance without importing an ABI. All of it is hermetic against the per-worker Anvil, closing review findings "No ERC-20 deal / token seeding helper" (line 219) and "No contract deployment helper" (line 605) and the fork-recipe doc gap (line 167).

### API surface

```ts
// ── src/erc20.ts (new module, exported as "@marigoldlabs/web3-tester/erc20") ──
import type { Address, Hex } from 'viem';
import type { RpcClient } from './types.js';

export type Erc20StorageLayout = 'solidity' | 'vyper';

export type Erc20SlotInfo = {
  layout: Erc20StorageLayout;
  /** Mapping base slot: small integer for plain layouts, or an ERC-7201 namespace root (e.g. OZ v5 upgradeable). */
  balanceSlot: bigint;
  /** Discovered lazily on first adjustTotalSupply use. */
  totalSupplySlot?: bigint;
};

export type DealErc20Options = {
  /** forge-std deal(token,to,give,adjust) parity: shift totalSupply by the balance delta. Default false. */
  adjustTotalSupply?: boolean;
  /** Highest integer mapping base slot probed per layout. Default 64 (covers OZ-upgradeable-v4 slot 51, USDC slot 9). */
  maxSlot?: number;
  /** Skip discovery with a known mapping base slot. */
  slot?: bigint | number;
  /** Layout used with `slot`. Default 'solidity'. */
  layout?: Erc20StorageLayout;
  /** Contract whose storage holds balances when it differs from `token` (external-storage proxies). */
  storageAddress?: Address;
};

export class Erc20DealError extends Error {
  readonly token: Address;
  readonly probedSlots: number; // candidates tried across both layouts
}

/** Core primitives are transport-agnostic over RpcClient so multichain/live modes can reuse them. */
export function discoverErc20BalanceSlot(
  client: RpcClient,
  token: Address,
  holder: Address,
  options?: { maxSlot?: number; storageAddress?: Address },
): Promise<Erc20SlotInfo>;

export function dealErc20(
  client: RpcClient,
  token: Address,
  account: Address,
  amount: bigint,
  options?: DealErc20Options,
  cache?: Map<string, Erc20SlotInfo>, // caller-owned; ChainController passes its instance cache
): Promise<void>;

export function getErc20Balance(client: RpcClient, token: Address, account: Address): Promise<bigint>;

// Committed artifact re-exports (generated module src/contracts/test-erc20.ts):
export { TEST_ERC20_ABI, TEST_ERC20_BYTECODE, TEST_ERC20_SOLC_VERSION, TEST_ERC20_SOURCE_KECCAK256 }
  from './contracts/test-erc20.js';

// ── src/anvil.ts additions on ChainController ──
export type DeployContractOptions = {
  abi: Abi;
  bytecode: Hex;
  args?: readonly unknown[];
  from?: Address;   // default: first Anvil unlocked account
  value?: bigint;
};
export type DeployedContract = { address: Address; hash: Hex; receipt: TransactionReceipt };

export type DeployErc20Options = {
  name?: string;          // default 'Test Token'
  symbol?: string;        // default 'TEST'
  decimals?: number;      // default 18
  initialSupply?: bigint; // default 0n, minted to mintTo in the constructor
  mintTo?: Address;       // default: deployer
  from?: Address;
};
export type DeployedErc20 = DeployedContract & {
  abi: typeof TEST_ERC20_ABI;
  name: string; symbol: string; decimals: number;
};

class ChainController {
  // existing members unchanged…
  deployContract(options: DeployContractOptions): Promise<DeployedContract>;
  deployErc20(options?: DeployErc20Options): Promise<DeployedErc20>;
  dealErc20(token: Address, account: Address, amount: bigint, options?: DealErc20Options): Promise<void>;
  getErc20Balance(token: Address, account: Address): Promise<bigint>;
  setStorageAt(address: Address, slot: Hex | bigint, value: Hex): Promise<void>; // thin passthrough (review line 224)
  private readonly erc20SlotCache: Map<string, Erc20SlotInfo>; // worker-lifetime, survives snapshot/revert (slots are immutable)
}

// ── Realistic usage (hermetic, mock-wallet mode) ──
import { test, expect } from '@marigoldlabs/web3-tester/fixtures';

test('swap quotes against seeded balances', async ({ page, chain, wallet }) => {
  const token = await chain.deployErc20({ symbol: 'USDX', decimals: 6 });
  await chain.dealErc20(token.address, wallet.primaryAccount, 5_000_000_000n, { adjustTotalSupply: true });
  expect(await chain.getErc20Balance(token.address, wallet.primaryAccount)).toBe(5_000_000_000n);
  await page.goto('/');
  // dapp now sees a funded user; snapshot/revert in the wallet fixture undoes everything after the test
});

// Fork mode: ANVIL_FORK_URL=https://eth-mainnet... npx playwright test
//   await chain.dealErc20(USDC, wallet.primaryAccount, 1_000_000n * 10n ** 6n); // slot 9 discovered through the proxy, then cached
```

### Behavior

DEAL ALGORITHM (dealErc20): (1) Validate amount: bigint in [0, 2^256) else RangeError before any RPC. (2) Fail-fast precheck: `eth_call` balanceOf(account) (encodeFunctionData with viem's exported `erc20Abi`); revert/empty result → Erc20DealError "does not implement balanceOf — not an ERC-20?". (3) Slot resolution order: explicit options.slot → instance cache (key: lowercased storageAddress ?? token; per-ChainController so inherently per-chain) → discovery. (4) Discovery probes candidate mapping base slots: integers 0..maxSlot (default 64) plus the OZ v5 ERC-7201 namespace root 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00 (verified: ERC20Storage._balances is the first struct member, so the mapping base IS the root), under both layouts: Solidity `keccak256(encodeAbiParameters([address, uint256], [holder, base]))` and Vyper `keccak256(encodeAbiParameters([uint256, address], [base, holder]))` — exactly the two layouts hardhat-deal brute-forces. Per candidate: read prev via `eth_getStorageAt`, write probe value via `anvil_setStorageAt` (forge-std heuristic: probe = prevBalance == 0 ? maxUint256 : 0), `eth_call` balanceOf; match → found; always restore prev before moving on (forge-std restores probe writes; hardhat-deal can leave stray writes — we must not, because the worker chain outlives the call when used outside the `wallet` fixture's snapshot/revert, per review finding 549). balanceOf reverting under the probe (e.g. maxUint256 trips checked math) is treated as not-found + restore. (5) Write `pad32(amount)` at the account's slot via anvil_setStorageAt, then verify balanceOf == amount; mismatch → evict cache + Erc20DealError (catches coincidental probe matches and computed/shares balanceOf). (6) adjustTotalSupply (default false, matching forge-std's 3-arg deal): read totalSupply (selector 0x18160ddd), newSupply = totSup + (amount - prevBal) with underflow → descriptive error (forge-std parity: it reverts on underflow); totalSupply slot discovered by probing PLAIN slots — base+1..base+3 first when the balance base was a namespace root (OZ struct puts _totalSupply at root+2), else integers 0..maxSlot — same write/verify/restore discipline; cached in the same Erc20SlotInfo. (7) Discovery exhaustion → Erc20DealError listing token, probedSlots, and remediations: rebasing/shares tokens (stETH, aTokens) compute balanceOf and are fundamentally not dealable this way; solady-style seeded slots (keccak256(owner‖seed), verified non-standard) need explicit `{ slot }`… actually need chain.client.setStorageAt with hand-computed slots; external-storage proxies → `{ storageAddress }`; deep layouts → raise `maxSlot`. ERROR CONVENTION: these are chain-side helpers, not EIP-1193 provider paths — plain Error/Erc20DealError, NOT providerError(4xxx); no interaction with approval gating (deal/deploy bypass the wallet entirely by design, like Anvil cheatcodes; sentTransactions and holdNextRequest are unaffected; deployContract transactions are sent via chain.client, never through MockWalletController, so they are not approval-gated and not recorded — document this explicitly). RPC METHODS USED: eth_call, eth_getStorageAt, anvil_setStorageAt (verified live against anvil 1.5.1: returns true; works as a local overlay on forks), eth_sendTransaction + eth_getTransactionReceipt via viem walletActions for deploys. DEPLOYCONTRACT: from ?? (await this.accounts())[0] (throw if Anvil exposes none — matches fixtures.ts guard wording); `this.client.deployContract({ abi, bytecode, args, account: from, chain: this.client.chain })` (chain.client already extends walletActions, AnvilViemClient src/anvil.ts:42-44; viem returns the tx hash); `waitForTransactionReceipt({ hash })`; status !== 'success' || !contractAddress → Error('constructor reverted…'); works under blockTime mining too since waitForTransactionReceipt polls. DEPLOYERC20: deploys the committed TEST_ERC20 artifact with args [name, symbol, decimals, initialSupply, mintTo ?? from]; the contract is a hand-written ~70-line MIT TestERC20 with the CLASSIC layout — balanceOf mapping at slot 0, allowance slot 1, totalSupply slot 2 — deliberately standard so chain.dealErc20 hermetically exercises the Solidity probe path against our own token; includes open mint/burn for tests; solady was rejected as the artifact source precisely because its seeded-slot layout (verified) would make our flagship token undealable by our flagship helper. ARTIFACT PIPELINE: contracts/TestERC20.sol + contracts/foundry.toml pinning solc 0.8.x with `bytecode_hash = "none"` and `cbor_metadata = false` for byte-reproducible output; maintainer-only `npm run build:contracts` (scripts/build-contracts.mjs shells to `forge build`, extracts abi+bytecode into the generated TS module src/contracts/test-erc20.ts — a .ts constant, not JSON, so it flows through the existing tsc build into the committed dist with .d.ts typing and no resolveJsonModule change); test-fixture contracts (VyperLayoutToken with assembly keccak(slot‖addr) balanceOf emulating Vyper, SharesToken whose balanceOf returns shares*2) are emitted to tests/contracts/fixtures.ts so they never ship. FORK INTERPLAY (documented in API.md + README fork recipe): with ANVIL_FORK_URL set (fixtures.ts:59 already plumbs it), eth_getStorageAt/eth_call fall through to the upstream RPC for cold slots and anvil_setStorageAt overlays locally (empirically verified with a fork-of-local-anvil), so dealing real mainnet USDC works and discovery latency is network-bound only on the first deal per token (cache: 3 RPCs thereafter). EDGE CASES: dealing to 0 (works; adjust shrinks supply); proxy tokens fine (delegatecall keeps balances in proxy storage); deal outside the `wallet` fixture permanently mutates worker state (existing snapshot caveat, restated in docs); cache survives chain.revert() because slot positions are code-determined, not state.

### Files touched

| Path | Change |
| --- | --- |
| `/Users/adhyr/Repos/web3-tester/src/erc20.ts` | NEW: discoverErc20BalanceSlot, dealErc20, getErc20Balance, Erc20DealError, layout/slot types; pure functions over RpcClient using viem erc20Abi/encodeAbiParameters/keccak256/pad; re-exports the generated artifact constants |
| `/Users/adhyr/Repos/web3-tester/src/contracts/test-erc20.ts` | NEW (generated, committed): TEST_ERC20_ABI as const, TEST_ERC20_BYTECODE, TEST_ERC20_SOLC_VERSION, TEST_ERC20_SOURCE_KECCAK256 provenance header |
| `/Users/adhyr/Repos/web3-tester/contracts/TestERC20.sol` | NEW: hand-written MIT minimal ERC-20 (slot-0 balances mapping, open mint/burn, 5-arg constructor); plus test-only VyperLayoutToken and SharesToken contracts |
| `/Users/adhyr/Repos/web3-tester/contracts/foundry.toml` | NEW: pinned solc version, optimizer settings, bytecode_hash = "none", cbor_metadata = false for reproducible bytecode |
| `/Users/adhyr/Repos/web3-tester/scripts/build-contracts.mjs` | NEW maintainer-only generator: forge build → emit src/contracts/test-erc20.ts and tests/contracts/fixtures.ts with source keccak provenance |
| `/Users/adhyr/Repos/web3-tester/src/anvil.ts` | ChainController: add deployContract, deployErc20, dealErc20, getErc20Balance, setStorageAt passthrough, private erc20SlotCache; new option/result types |
| `/Users/adhyr/Repos/web3-tester/src/index.ts` | Export dealErc20/getErc20Balance/discoverErc20BalanceSlot/Erc20DealError/TEST_ERC20_ABI + new types (DeployContractOptions, DeployedContract, DeployErc20Options, DeployedErc20, DealErc20Options, Erc20SlotInfo, Erc20StorageLayout) |
| `/Users/adhyr/Repos/web3-tester/package.json` | Add "./erc20" subpath export (dist/erc20.js + .d.ts); add build:contracts script |
| `/Users/adhyr/Repos/web3-tester/playwright.config.ts` | Add '**/erc20.spec.ts' to the library project testMatch (without this the new spec silently never runs under npm test) |
| `/Users/adhyr/Repos/web3-tester/tests/erc20.spec.ts` | NEW hermetic spec: deploy/deal/adjust/vyper/failure/override/fork-of-local-anvil/cache coverage (see testStrategy) |
| `/Users/adhyr/Repos/web3-tester/tests/contracts/fixtures.ts` | NEW (generated, committed, unshipped): VyperLayoutToken + SharesToken abi/bytecode for the spec |
| `/Users/adhyr/Repos/web3-tester/docs/API.md` | Extend ChainController table; new 'Seeding tokens and deploying contracts' section incl. forge-std parity notes, non-dealable token list, ANVIL_FORK_URL recipe (pin block + impersonate + deal — closes review line 167 doc ask) |
| `/Users/adhyr/Repos/web3-tester/README.md` | Quickstart snippet for deployErc20 + dealErc20; fork recipe pointer |
| `/Users/adhyr/Repos/web3-tester/CHANGELOG.md` | 0.3.0 (or 0.2.x) entry |
| `/Users/adhyr/Repos/web3-tester/.github/workflows/ci.yml` | Optional: artifact freshness gate mirroring the dist gate — run npm run build:contracts && git diff --exit-code src/contracts tests/contracts (CI already installs foundry for anvil) |
| `/Users/adhyr/Repos/web3-tester/dist/` | Rebuilt and committed (existing CI dist-freshness gate enforces this) |

### New dependencies

None.

### Test strategy

All in tests/erc20.spec.ts, fully hermetic, added to the library project (runs under npm test); follows tests/anvil.spec.ts conventions (own AnvilInstance per describe block on a dedicated port band, silent: true) rather than the fixtures, so cache and state assertions are deterministic. (1) deployErc20: defaults + custom name/symbol/decimals/initialSupply/mintTo asserted via readContract and getErc20Balance — behaviorally pins the committed artifact. (2) deployContract: constructor args + from override; a reverting constructor (SharesToken with a require, or bad args) yields the descriptive error, pinning receipt.status handling. (3) dealErc20 on the standard token: exact balance; restoration discipline pinned by asserting another holder's balance and totalSupply unchanged after discovery. (4) Cache: wrap the ChainController in a counting RpcClient (the core takes RpcClient, so the test passes a wrapper to dealErc20 directly) and assert the second deal performs zero anvil_setStorageAt probe writes (exactly one final write) — pins the per-token slot cache without exposing internals. (5) adjustTotalSupply: up and down deltas match; underflow throws. (6) VyperLayoutToken fixture: discovered via the [slot, address] hash order — pins the Vyper probe path without a Vyper toolchain. (7) SharesToken: rejects with Erc20DealError (message names token + remediation), and its balanceOf/storage are unchanged afterwards — pins probe-restore on the failure path. (8) Explicit { slot } override: counting wrapper shows no discovery traffic. (9) Fork dealing WITHOUT network: start upstream AnvilInstance, deployErc20 there, start a second AnvilInstance({ forkUrl: upstream.rpcUrl }), dealErc20 on the fork and assert balance + upstream untouched — this is the hermetic stand-in for ANVIL_FORK_URL mainnet forking (mechanism verified empirically against anvil 1.5.1). (10) Validation: negative amount / >= 2^256 throw before any RPC. (11) Artifact freshness: keccak256 of contracts/*.sol equals the pinned TEST_ERC20_SOURCE_KECCAK256 — local hermetic drift guard; the full recompile gate runs in CI where foundry is installed. NOT hermetic (documented only, not tested): dealing real mainnet tokens (USDC slot 9, OZ-v5 7201 tokens) — optionally a single env-gated spec behind ANVIL_FORK_URL following the real-wallet smoke gating pattern, but the fork-of-anvil test already pins the mechanism.

### Effort

3.5 days. Dominated by (a) the artifact pipeline done right — contract authoring, reproducible forge build (pinned solc, stripped metadata), generator script, freshness gating (~1 day), and (b) the discovery engine's failure-path polish — probe/restore discipline, 7201 candidates, totalSupply discovery, cache semantics, error messages (~1 day). Tests ~1 day (the counting-RpcClient wrapper and fork-of-anvil specs are fiddly but mechanical). Docs (API.md section + fork recipe + README + CHANGELOG) + dist rebuild + CI tweak ~0.5 day.

### Depends on

Nothing (but see the sequencing plan — shared-substrate ordering still applies).

### Risks

- **Committed bytecode drifts from contract source, or differs depending on which forge/solc version the maintainer has installed**
  Mitigation: Pin solc in contracts/foundry.toml and strip metadata (bytecode_hash = "none", cbor_metadata = false) so output is byte-reproducible; hermetic source-keccak test catches local drift; CI recompile gate (foundry already installed for anvil) mirrors the existing dist-freshness gate
- **False-positive slot match during probing (a candidate write coincidentally changes balanceOf, e.g. shares slot where balanceOf == shares for the probe value) corrupts token state or caches a wrong slot**
  Mitigation: Final write is always verified with balanceOf == amount and the cache entry evicted on mismatch (discovery resumes from the next candidate); every non-matching probe is restored to its prior value before moving on, so the chain is never left dirty — pinned by the SharesToken failure-path test
- **maxUint256 probe value makes exotic balanceOf implementations revert or trip supply caps, masking an otherwise discoverable slot**
  Mitigation: Treat eth_call revert as not-found (restore and continue); on full exhaustion, retry the integer range once with the alternate probe value (prevBalance + 1) before throwing — forge-std uses the same zero/max heuristic, so parity holds for the common case
- **Discovery on a real remote fork is slow (each cold candidate costs remote eth_getStorageAt + eth_call) or burns rate limits**
  Mitigation: Per-token cache makes it one-time per worker; default maxSlot 64 bounds worst case (~4 RPCs per candidate, integers tried before 7201 roots so common tokens like USDT slot 2 / USDC slot 9 resolve in well under 50 candidates); maxSlot and explicit { slot } are escape hatches and API.md ships known-slot examples
- **Consumers expect forge-std-equivalent coverage but record-based stdStorage (vm.record/vm.accesses) finds slots that keccak probing cannot (solady seeded slots, arbitrary layouts)**
  Mitigation: Erc20DealError states the limitation and remediations explicitly; docs carry a 'not dealable' table (solady-layout, rebasing stETH/aTokens, external-storage proxies); a debug_traceCall SLOAD-capture fallback is left as a flagged follow-up (see openQuestions) rather than silently promised
- **deployContract transactions bypass MockWalletController, so wallet.sentTransactions and approval gating do not see them — could surprise users writing assertions (and the parallel matchers feature)**
  Mitigation: Documented prominently in API.md ('chain.* helpers are cheatcodes: no wallet, no approval, no sentTransactions record'); semantics identical to forge cheatcodes so the mental model is familiar

### External facts verified by the designer

- forge-std deal(token,to,give[,adjust]) implementation: writes via stdStorage sig 0x70a08231 with_key(to), optional totalSupply (0x18160ddd) adjustment by the balance delta, adjust defaults false — verified from foundry-rs/forge-std master src/StdCheats.sol
- forge-std stdStorage.find() is record-based (vm.record + vm.accesses), verifies candidates with probe writes (testVal = prev==0 ? UINT256_MAX : 0) restored afterwards, throws 'Slot(s) not found.' — verified from forge-std master src/StdStorage.sol; this confirms RPC-side keccak probing is a parity approximation, not the same algorithm (informs the documented limitation + probe-value heuristic)
- hardhat-deal brute-forces both layouts — Solidity keccak256(abi.encode([address, uint256], [recipient, slot])) and Vyper keccak256(abi.encode([uint256, address], [slot, recipient])) — default max slot 12, persistent per-token slot cache, writes via hardhat_setStorageAt — verified from Rubilmax/hardhat-deal master src/helpers.ts and README
- anvil_setStorageAt <address> <slot> <value> (plus anvil_setBalance/setCode/setNonce/impersonateAccount) is the current documented method set — verified at getfoundry.sh/anvil/custom-methods; ALSO verified empirically against local anvil 1.5.1-stable: returns true, eth_getStorageAt reflects the write, and on a fork (--fork-url pointing at another local anvil) reads fall through to upstream while setStorageAt overlays locally — proves the hermetic fork-of-anvil test design
- viem deployContract: walletClient.deployContract({ abi, account, bytecode, args, value? }) returns the tx hash; deployed address comes from waitForTransactionReceipt(...).contractAddress — verified at viem.sh/docs/contract/deployContract; chain.client already composes walletActions (src/anvil.ts:42-44, 327-333)
- viem testClient.setStorageAt({ address, index: number | Hash, value }) exists for mode 'anvil' — verified at viem.sh/docs/actions/test/setStorageAt
- viem 2.52.0 (the repo's installed version) exports erc20Abi (allowance/approve/balanceOf/decimals/name/symbol/totalSupply/transfer/transferFrom), keccak256, encodeAbiParameters, encodeFunctionData, pad — verified by importing from the repo's node_modules
- solady ERC20 uses a NON-standard balance slot — keccak256 over owner ++ _BALANCE_SLOT_SEED (0x87a211a2) via manual memory layout, not keccak256(abi.encode(owner, slotIndex)) — verified from Vectorized/solady main src/tokens/ERC20.sol; this both justifies the documented 'not dealable by probing' caveat and rules solady out as the shipped artifact source
- OpenZeppelin v5 upgradeable ERC20 uses ERC-7201 namespaced storage: ERC20StorageLocation = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00 with _balances as the FIRST struct member (so the mapping base slot equals the root, _totalSupply at root+2) — verified from OpenZeppelin/openzeppelin-contracts-upgradeable master ERC20Upgradeable.sol; included as an extra probe candidate beyond integer slots

### Open questions

- Add a debug_traceCall(structLogs)-based SLOAD-capture fallback when keccak probing fails? It is the true RPC equivalent of forge-std's vm.record and would make solady-layout tokens dealable, hermetically testable against our own fixtures — but it roughly doubles the discovery engine's complexity. Proposed: ship probing now, name the fallback in the Erc20DealError follow-up note, scope it separately.
- deployErc20 initialSupply default: 0n (explicit mint-after, no magic) vs a batteries-included 1_000_000 * 10^decimals. Design assumes 0n; Synpress-refugee ergonomics might favor the latter.
- Should TestERC20.mint stay unrestricted? Maximally convenient for tests but slightly hazardous if someone deploys the artifact to a public testnet; alternative is deployer-only mint with chain.impersonateAccount as the workaround. Design assumes unrestricted with a doc warning.
- Ship contracts/*.sol in the npm files array for auditability of the committed bytecode (a few KB), or keep them repo-only? Design assumes repo-only since dist provenance is recorded via TEST_ERC20_SOURCE_KECCAK256.
- Version bump: do deal-helpers land in 0.2.x on library-hardening or wait to batch with the other scoped features as 0.3.0 (affects the CHANGELOG entry only).

### Adversarial review

**Corrections:**
- Behavior step 5 contradicts risk 2's mitigation: step 5 says final-write verification mismatch → 'evict cache + Erc20DealError' (throw), while risk 2 says 'the cache entry evicted on mismatch (discovery resumes from the next candidate)'. Pick one — it must be: restore the previous slot value, evict, rerun discovery once (skipping the failed candidate), throw only if rediscovery fails. As specified, the throw path also leaves pad32(amount) written at the wrong slot with no restore, violating the design's own restore-discipline rationale (review finding at reports/web3-tester-library-review-2026-06-09.md ~line 549: worker chain outlives the call outside the wallet fixture's snapshot/revert).
- The claim 'cache survives chain.revert() because slot positions are code-determined, not state' is unsound in this harness. Slot positions are immutable per contract, but the address→contract binding is not immutable across revert: the wallet fixture (src/fixtures.ts:95,115) snapshots/reverts per test, resetting deployer nonces, so CREATE reuses addresses — test A's deployErc20 at address X (cache: slot 0 solidity, worker-lifetime cache) can be followed by test B's deployContract(VyperLayoutToken) at the same X. The cached-slot write then misses, and under the design's written step-5 behavior test B's perfectly dealable token throws Erc20DealError with a stray write left behind. Cache-by-address is only safe with the restore+rediscover fallback from the previous correction.
- externalFactsVerified overstates hardhat-deal: 'default max slot 12' — the README comment says 12 but the actual code in src/helpers.ts (current master, fetched) is `maxSlot = 256`. Not load-bearing for the design's own default of 64, but it is asserted as verified from helpers.ts and is wrong against that file.
- 'hardhat-deal can leave stray writes' is wrong for its probing path: trySlot() reads storageBefore and restores it on every failed candidate (verified from current master src/helpers.ts). The only unverified-write path is when a configured/cached dealSlot is wrong (cached=true skips verification entirely). The design's differentiation claim should be restated as: hardhat-deal does not verify cached slots; we must verify even cache hits.
- Minor: ChainController.setStorageAt(address, slot: Hex | bigint, value: Hex) cannot pass bigint straight to viem — viem's setStorageAt action takes `index: number | Hash` (verified at viem.sh and in viem 2.52.0 types). The passthrough must convert via toHex(slot, { size: 32 }) or issue a raw anvil_setStorageAt request (empirically: anvil accepts '0x0' and 32-byte forms). Name the conversion so the implementer doesn't hit a type error late.

**Improvements:**
- Use eth_call state overrides (stateDiff) for slot discovery instead of anvil_setStorageAt write/probe/restore — empirically verified working on anvil 1.5.1, both on a plain chain and on cold slots of a fork (override applied per-call, nothing persists, upstream untouched). This eliminates the entire restore-discipline machinery, removes the window where a concurrently-polling dapp page (or an auto-approved tx landing mid-discovery) observes maxUint256 balances or corrupted arbitrary slots, makes a crash mid-discovery harmless, cuts fork discovery from ~4 serial remote RPCs per candidate to 1, and — because override calls are stateless — allows probing candidates concurrently with Promise.all batches. Keep anvil_setStorageAt only for the single final verified write. Keep write/restore as a fallback only if a non-anvil RpcClient rejects the override param (ChainController is always mode 'anvil', so the primary path never needs it).
- Probe with the target amount or a unique sentinel value (hardhat-deal style: write hexAmount, check balanceOf == hexAmount) rather than forge-std's prev==0 ? maxUint256 : 0 heuristic. forge-std uses that heuristic because stdStorage probes record-discovered generic slots; for balanceOf probing it just invites checked-math/supply-cap reverts (the design's risk 3) and coincidental matches. With stateDiff-override probing this costs nothing and risk 3's 'retry integer range with prevBalance + 1' pass disappears.
- Add setCode and setNonce passthroughs alongside setStorageAt — the review's line-224 verifier correction names the trio (setStorageAt/setCode/setNonce) as the convenience gap; shipping only setStorageAt closes the finding incompletely. Each is a 3-line method matching the existing setBalance pattern (src/anvil.ts:360-362).
- Make the CI artifact-freshness gate non-optional. filesTouched marks .github/workflows/ci.yml 'Optional', but risk 1's mitigation explicitly depends on the CI recompile gate; foundry-toolchain@v1 is already installed in ci.yml (lines 20-21) so forge is available, and the gate mirrors the existing dist gate (lines 35-41). Note `forge build` will download the pinned solc via svm on first CI run — fine (network is available in CI; npm test stays hermetic since the local guard is the source-keccak check only).
- Give dealErc20 a clear failure when pointed at a non-anvil RpcClient: the core is deliberately transport-agnostic, so a consumer can pass PrivateKeyRpcClient (live chain) where anvil_setStorageAt returns method-not-found — wrap that in Erc20DealError ('dealErc20 requires an anvil-backed client; live chains cannot be dealt') instead of leaking a raw JSON-RPC error. Costs one error-mapping branch.
- On cache-hit deals, do the cheap verification path explicitly: compute the slot from cache, write, verify balanceOf == amount, and on mismatch restore + evict + rerun discovery (per the corrections). Worth pinning with a dedicated test: deploy TestERC20, deal (populates cache), chain.revert to before deployment, deploy a different-layout contract at the same address, deal again — asserts the rediscovery fallback. This is cheap to write with the existing snapshot/revert primitives and turns the nastiest identified failure mode into a covered regression.


## WalletConnect / AppKit simulation (key: walletconnect)

**Review verdict:** needs-revision.

### Goal

A consumer can E2E-test the QR/WalletConnect connect path of an AppKit (or any WC v2) dapp without a phone or extension: a headless WalletConnect v2 wallet peer pairs with the dapp's modal (URI auto-extracted from AppKit's wui-qr-code, with a getUri override hook), approves the session with the fixture's accounts/chain, and answers every session_request by dispatching through the existing MockWalletController — so wallet.approveNext()/autoApprove()/holdNextRequest()/simulateRejection() and wallet.sentTransactions/waitForNextTransaction() work identically for WC traffic and injected traffic, in both mock-anvil and live-key modes. Ships as a separate './walletconnect' subpath with @walletconnect/* as optional peers, keeping the core at zero hard deps.

### API surface

```ts
// ── src/walletconnect.ts → '@marigoldlabs/web3-tester/walletconnect' ──
import type { Page } from '@playwright/test';
import type { Hex } from 'viem';
import type { CoreTypes, SessionTypes } from '@walletconnect/types'; // types-only; optional peer
import type { MockWalletController } from './mock-wallet-controller.js';

export type WalletConnectWalletOptions = {
  /** Existing mock/live controller. ALL session_requests dispatch through its
   *  approval gating and transaction recording — the differentiator. */
  wallet: MockWalletController;
  /** Reown dashboard project id (required by the public relay). */
  projectId: string;
  /** Defaults to the SDK default, wss://relay.walletconnect.org (verified constant). */
  relayUrl?: string;
  /** Chains offered in the approved eip155 namespace. Default: [wallet.currentChainId]. */
  chains?: readonly (number | Hex)[];
  /** Namespace methods. Default DEFAULT_WALLETCONNECT_METHODS (signing + wallet_* set below). */
  methods?: readonly string[];
  /** Namespace events. Default ['chainChanged', 'accountsChanged']. */
  events?: readonly string[];
  /** Peer metadata shown in the dapp UI. Defaults to a 'web3-tester Wallet' identity. */
  metadata?: Partial<CoreTypes.Metadata>;
  /** SignClient storage; default = fresh MemoryKeyValueStorage per instance (nothing on disk). */
  storage?: WalletConnectStorage; // structural IKeyValueStorage shape, no hard type dep at runtime
};

export type WalletConnectSession = {
  topic: string;
  namespaces: SessionTypes.Namespaces;
  peerMetadata: CoreTypes.Metadata;
};

export type GetUriOptions = {
  timeoutMs?: number;            // default 15_000
  selector?: string;             // default 'wui-qr-code[uri], wcm-qrcode[uri]'
};

export class WalletConnectWallet {
  /** Async factory: dynamic-imports @walletconnect/sign-client + utils and throws a
   *  clear install hint when the optional peers are missing. */
  static create(options: WalletConnectWalletOptions): Promise<WalletConnectWallet>;
  /** Underlying SignClient instance — escape hatch (typed via @walletconnect/types ISignClient). */
  readonly client: import('@walletconnect/types').ISignClient;
  readonly sessions: readonly WalletConnectSession[];
  /** Pairs with a wc: URI, gates the proposal through the controller, settles the session.
   *  Rejects with the controller's 4001 ProviderRpcErrorLike when gating denies. */
  pair(options: { uri: string; timeoutMs?: number }): Promise<WalletConnectSession>;
  /** Convenience: getWalletConnectUri(page) (or options.getUri) then pair(). */
  connect(page: Page, options?: GetUriOptions & { getUri?: (page: Page) => Promise<string> }): Promise<WalletConnectSession>;
  /** Wallet-initiated disconnect; all sessions when topic omitted (USER_DISCONNECTED, 6000). */
  disconnect(topic?: string): Promise<void>;
  /** Disconnect sessions (best effort), unsubscribe controller listener, relayer.transportClose(),
   *  heartbeat.stop(), removeAllListeners. Always call in finally/fixture teardown. */
  close(): Promise<void>;
}

/** Polls the AppKit/W3M modal for the pairing URI: locator pierces shadow DOM, reads the
 *  reflected `uri` attribute off wui-qr-code (AppKit's own E2E suite does exactly this),
 *  loops until the value starts with 'wc:'. Throws a descriptive timeout error naming the
 *  getUri override hook for non-AppKit modals. */
export function getWalletConnectUri(page: Page, options?: GetUriOptions): Promise<string>;

/** Map-backed structural IKeyValueStorage (getKeys/getEntries/getItem/setItem/removeItem). */
export class MemoryKeyValueStorage { /* ... */ }

export const DEFAULT_WALLETCONNECT_METHODS: readonly string[];
// ['eth_sendTransaction','eth_sendRawTransaction','personal_sign','eth_sign',
//  'eth_signTypedData','eth_signTypedData_v3','eth_signTypedData_v4','eth_accounts',
//  'eth_requestAccounts','eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain',
//  'wallet_getPermissions','wallet_requestPermissions','wallet_watchAsset']

// ── src/mock-wallet-controller.ts additions (public, reused by future features) ──
class MockWalletController {
  /** Dispatches a request that arrived outside the injected provider (e.g. a WC
   *  session_request) through the same gating + handling as injected requests. */
  handleExternalRequest(request: JsonRpcRequest): Promise<unknown>; // -> this.handleRpcRequest
  /** Node-side observer for provider events (chainChanged/accountsChanged/connect/disconnect);
   *  emit() notifies these listeners in addition to the pages. Returns unsubscribe. */
  onProviderEvent(listener: (event: string, payload: unknown) => void): () => void;
}

// ── Realistic usage ──
import { test, expect } from '@marigoldlabs/web3-tester/fixtures';
import { WalletConnectWallet } from '@marigoldlabs/web3-tester/walletconnect';

test('user connects via AppKit QR and signs', async ({ page, wallet }) => {
  const wc = await WalletConnectWallet.create({
    wallet,
    projectId: process.env.WEB3_TESTER_WC_PROJECT_ID!,
  });
  try {
    await page.goto('/');
    await page.getByTestId('connect-wallet').click();
    await page.getByText('WalletConnect').click();        // dapp-specific: open the QR view

    wallet.autoApprove(false);
    wallet.approveNext('eth_requestAccounts');            // arms the WC session approval
    const session = await wc.connect(page);               // extract wui-qr-code[uri] → pair → settle
    expect(session.peerMetadata.name).toBeTruthy();

    const held = wallet.holdNextRequest('personal_sign'); // WC session_request parks here
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/confirm in your wallet/i)).toBeVisible();
    (await held).approve();                               // anvil signs, result relayed to the dapp

    await wallet.switchNetwork(31338);                    // pushes chainChanged to the WC session too
  } finally {
    await wc.close();
  }
});
```

### Behavior

**Library choice.** @walletconnect/sign-client (2.23.9, published 2026-03-27, not deprecated) used wallet-side, NOT @reown/walletkit: WalletKit 1.5.5 is a thin wrapper around the same sign-client 2.23.9 but drags in @walletconnect/pay. sign-client is the lean primitive with identical capabilities (pair/approve/reject/respond/emit/update/disconnect).

**Pairing & session approval (pair()).** parseUri(uri) → pairingTopic; one-shot 'session_proposal' listener filtered on proposal.params.pairingTopic; then client.pair({ uri }). On proposal: (1) gate by dispatching `wallet.handleExternalRequest({ method: 'eth_requestAccounts', params: [{ origin: verifyContext.verified.origin, proposer: proposal.params.proposer.metadata, requiredNamespaces, optionalNamespaces }] })` — so approveNext('eth_requestAccounts'), holdNextRequest, simulateRejection, and deny-by-default live mode all govern WC connects with zero new gating machinery; the dispatch also flips controller `connected` state and returns the accounts used for the namespace. On ProviderRpcErrorLike → client.reject({ id, reason: getSdkError('USER_REJECTED') /* 5000 */ }) and pair() rejects with the original 4001 error. (2) namespaces = buildApprovedNamespaces({ proposal: proposal.params, supportedNamespaces: { eip155: { chains: ['eip155:31337', ...], methods, events, accounts: ['eip155:31337:0x...'] } } }); a throw (dapp requires unsupported chain) → client.reject(getSdkError('UNSUPPORTED_CHAINS') /* 5100 */) + pair() rejects with a descriptive Error telling the user to pass `chains`. (3) client.approve({ id, namespaces }) → await acknowledged() → resolve { topic, namespaces, peerMetadata }. Default timeoutMs 30_000 (relay round-trips).

**Request loop.** 'session_request' handler receives { id, topic, params: { request: { method, params, expiryTimestamp? }, chainId: 'eip155:N' }, verifyContext } (shape verified from @walletconnect/types 2.23.9). Semantics: (a) requested chain ∉ configured `chains` → respond error { code: 5100, message: 'Requested chain is not approved for this session.' } (dapp violated the namespace); (b) chain approved but ≠ wallet.currentChainId → `wallet.switchNetwork(chainHex)` first (single-network-wallet semantics: emits chainChanged to pages, node listeners, and WC sessions) — when the `multichain` feature lands this becomes per-request routing via the dispatch context instead of a switch; (c) `result = await wallet.handleExternalRequest({ method, params: request.params })` → respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } }). Errors map via the existing serializeRpcError: 4001 user-rejected (rejection queue / deny-by-default / held.reject), 4902 unknown chain from wallet_switchEthereumChain, 4200 unsupported wallet_* method, -32602 bad params — codes and messages cross the relay verbatim ({ id, jsonrpc: '2.0', error: { code, message, data? } }; `data` forwarded only when string, ErrorResponse types it as string). eth_sendTransaction therefore lands in wallet.sentTransactions/sentTransactionRequests, so waitForNextTransaction() and the parallel `matchers` feature work unchanged for WC traffic. Held requests: WC requests carry a ~5 min expiry; a hold parked longer than that gets a dapp-side expiry first (documented).

**Event pushes / lifecycle.** A controller `onProviderEvent` subscription forwards state changes to every active session: chainChanged(hex) → if the chain is missing from the session namespace, client.update({ topic, namespaces: extended }) first (MetaMask-mobile behavior), then client.emit({ topic, event: { name: 'chainChanged', data: Number(hex) }, chainId: 'eip155:N' }); accountsChanged → client.emit with plain address array (matches WalletKit docs example); controller disconnect() → disconnectSession(getSdkError('USER_DISCONNECTED') /* 6000 */) on all topics. Dapp-initiated 'session_delete' removes the session from `sessions` (controller connection state is left alone — other tabs/transports may still be connected; documented). wc.disconnect(topic?) is the wallet-initiated path.

**URI acquisition.** Primary: `page.locator('wui-qr-code[uri], wcm-qrcode[uri]').first()`, poll getAttribute('uri') until it starts with 'wc:'. Verified against current AppKit source: w3m-connecting-wc-qrcode renders `<wui-qr-code uri=${this.uri} data-testid="wui-qr-code">` — a Lit attribute binding, so the URI is a real DOM attribute, and Playwright CSS locators pierce the shadow DOM; Reown's own laboratory ModalPage.getConnectUri() uses exactly `locator('wui-qr-code').getAttribute('uri')`, which makes this the most-stable possible contract — but it is still an undocumented internal, so: honest brittleness note in docs, `selector` option, clipboard fallback recipe via the AppKit `[data-testid="copy-wc2-uri"]` copy button (needs clipboard-read permission, documented not default), and the `getUri: (page) => Promise<string>` override hook for dapps that expose display_uri or custom modals.

**Storage & cleanup.** SignClient persists to `./walletconnect.db` (unstorage fs driver) by default in Node — unacceptable test pollution. Default `storage` = our MemoryKeyValueStorage (CoreTypes.Options.storage accepts a structural IKeyValueStorage: getKeys/getEntries/getItem/setItem/removeItem — verified), one per WalletConnectWallet, so nothing touches disk and tests are isolated without cross-test cleanup. close() = best-effort disconnect of all sessions (5s cap) → core.relayer.transportClose() → core.heartbeat.stop() → removeAllListeners; there is no official SignClient destroy, so stray timers may briefly outlive close() (Playwright worker teardown reaps them).

**Hermeticity.** The relay cannot be self-hosted in practice in 2026: WalletConnect/relay on GitHub is archived (last push 2023-04) and labeled an educational sample; the production relay (Irn) is closed-source and the decentralized WalletConnect Network is permissioned staking nodes, not a CI container. Anything that actually pairs needs wss://relay.walletconnect.org + a projectId → the live spec is env-gated on WEB3_TESTER_WC_PROJECT_ID following the WEB3_TESTER_REAL_WALLET_SMOKE pattern. Everything else (gating dispatch, error mapping, namespace construction, URI extraction, storage) is tested hermetically by exporting the internal session-request handler factory and feeding it synthetic events.

**Modularity.** src/walletconnect.ts top level contains no @walletconnect runtime imports (types-only imports + dynamic `await import('@walletconnect/sign-client')` / '@walletconnect/utils' inside create(), wrapped to throw: "The './walletconnect' module requires optional peer dependencies. Install with: npm i -D @walletconnect/sign-client @walletconnect/utils"). Not re-exported from src/index.ts; subpath-only, so core consumers resolve nothing new.

### Files touched

| Path | Change |
| --- | --- |
| `/Users/adhyr/Repos/web3-tester/src/walletconnect.ts` | New module (~400 lines): WalletConnectWallet, getWalletConnectUri, MemoryKeyValueStorage, DEFAULT_WALLETCONNECT_METHODS, internal createSessionRequestHandler(wallet, config, respond) exported for hermetic tests; dynamic optional-peer imports with install-hint error. |
| `/Users/adhyr/Repos/web3-tester/src/mock-wallet-controller.ts` | Add public handleExternalRequest(request) (delegates to private handleRpcRequest) and onProviderEvent(listener) with a listeners Set; emit() additionally notifies node-side listeners (errors swallowed). ~25 lines, no behavior change for existing paths. |
| `/Users/adhyr/Repos/web3-tester/package.json` | Add './walletconnect' to exports; add @walletconnect/sign-client, @walletconnect/utils, @walletconnect/types as peerDependencies with peerDependenciesMeta optional:true (range '>=2.17 <3'); add all three as devDependencies for build/tests. |
| `/Users/adhyr/Repos/web3-tester/playwright.config.ts` | Add '**/walletconnect.spec.ts' and '**/walletconnect-live.spec.ts' to the library project testMatch (live file self-skips without WEB3_TESTER_WC_PROJECT_ID, mirroring real-wallet-smoke). |
| `/Users/adhyr/Repos/web3-tester/tests/walletconnect.spec.ts` | New hermetic spec: gating dispatch + error-code mapping via synthetic session_request events over the anvil-backed wallet fixture; URI extraction against a local HTML page rendering a shadow-DOM wui-qr-code stand-in; MemoryKeyValueStorage semantics + isolation; namespace construction snapshot via buildApprovedNamespaces. |
| `/Users/adhyr/Repos/web3-tester/tests/walletconnect-live.spec.ts` | New env-gated spec (WEB3_TESTER_WC_PROJECT_ID): in-process dapp-side SignClient over the real relay — connect approval/arming/rejection, personal_sign round-trip verified with recoverMessageAddress, eth_sendTransaction recorded + mined on anvil, chainChanged push received by dapp client, disconnect propagation both directions. |
| `/Users/adhyr/Repos/web3-tester/docs/API.md` | New '## WalletConnect' section: full surface, gating-parity table, AppKit URI extraction contract + brittleness note + getUri hook, env-gating and projectId setup, close() requirement. |
| `/Users/adhyr/Repos/web3-tester/README.md` | AppKit/WalletConnect recipe + WEB3_TESTER_WC_PROJECT_ID in the env table; note that the subpath needs the optional peers installed. |
| `/Users/adhyr/Repos/web3-tester/CHANGELOG.md` | 0.3.0 entry for the walletconnect module and the two MockWalletController additions. |
| `/Users/adhyr/Repos/web3-tester/dist` | Rebuilt committed dist including dist/walletconnect.js/.d.ts (CI freshness gate). |

### New dependencies

- @walletconnect/sign-client >=2.17 <3 — optional peerDependency (peerDependenciesMeta.optional=true) + devDependency; the WC v2 wallet-side protocol client, dynamically imported only inside the './walletconnect' subpath
- @walletconnect/utils >=2.17 <3 — optional peer + devDependency; buildApprovedNamespaces (CAIP namespace negotiation is genuinely fiddly: AppKit dapps put everything in optionalNamespaces), getSdkError, parseUri. Declared explicitly because pnpm-strict consumers cannot rely on it being hoisted from sign-client's deps
- @walletconnect/types >=2.17 <3 — optional peer + devDependency; types-only (erased at runtime), needed so our emitted d.ts and consumers' type-checking resolve CoreTypes/SessionTypes
- Zero new hard runtime deps: core install remains dependency-free; dist/walletconnect.js references @walletconnect/* only via lazy dynamic import

### Test strategy

Hermetic (runs in `npm test`, library project): tests/walletconnect.spec.ts never touches the relay. (1) Gating parity — instantiate the normal anvil wallet fixture, drive the exported createSessionRequestHandler with synthetic session_request events: personal_sign auto-approved returns a signature recoverable to the account; simulateRejection → response error {code:4001}; deny-by-default (autoApprove(false)) → 4001; approveNext arming → success; holdNextRequest parks the response until approve()/reject(); eth_sendTransaction lands in wallet.sentTransactions and mines on anvil; wallet_switchEthereumChain to unknown chain → 4902; off-namespace chainId → 5100. This pins the differentiator without a network. (2) URI extraction — local data: page whose script attaches a shadow root containing <wui-qr-code uri="wc:...@2?...">, asserting shadow-piercing read, polling past an initially-empty uri attribute, and the timeout error message; getUri override path via connect(). (3) MemoryKeyValueStorage CRUD + instance isolation (pins the no-disk cleanup story). (4) Namespace construction — buildApprovedNamespaces with an AppKit-style optionalNamespaces-only proposal snapshot (devDep import, no network). Env-gated (WEB3_TESTER_WC_PROJECT_ID, mirrors the WEB3_TESTER_REAL_WALLET_SMOKE pattern; serial mode, generous timeouts, not a CI gate): tests/walletconnect-live.spec.ts runs a dapp-side SignClient in-process against the real relay — full pair→propose→approve→settle, request round-trips, chainChanged/accountsChanged pushes, bidirectional disconnect, and a second create() in the same worker proving storage isolation. A true AppKit-modal E2E against a public lab dapp is deliberately excluded from CI (third-party availability) and shipped as a documented recipe instead; the modal DOM contract itself is covered by the hermetic fixture page.

### Effort

5–6 focused days. Breakdown: sign-client integration + controller plumbing (handleExternalRequest/onProviderEvent, proposal gating, request loop, event forwarding) ~2d; URI extraction helper + connect() ~0.5d; lifecycle/cleanup hardening (close() semantics, storage isolation, listener leaks) ~1d; tests ~1.5–2d — the env-gated relay suite dominates (relay latency/flakiness tuning, proposal/ack timeouts, making the in-process dapp client deterministic); docs + dist + review ~0.5d.

### Depends on

- multichain (soft, not blocking): walletconnect ships standalone with chains defaulting to [wallet.currentChainId] and switch-then-dispatch for other approved chains; once multichain lands, the session_request chainId routes per-request through the controller's chain map instead of switching, and multi-chain namespace approval stops being a footgun. The dispatch already passes chainId context to make that a drop-in.

### Risks

- **AppKit modal DOM drift breaks getWalletConnectUri (wui-qr-code uri attribute / shadow structure is an undocumented internal)**
  Mitigation: The attribute is what Reown's own Playwright laboratory suite reads (locator('wui-qr-code').getAttribute('uri')), making it de-facto stable; we also accept a selector override, document the copy-wc2-uri clipboard fallback, ship the getUri hook as the supported escape hatch, and the hermetic fixture page pins our extraction logic independent of AppKit releases.
- **Relay dependence makes the live suite flaky or unavailable (rate limits, projectId policy changes, WalletConnect Network migration)**
  Mitigation: Live suite is opt-in env-gated and never gates CI; generous timeouts + serial mode; all protocol-independent logic is covered hermetically; relayUrl is configurable if a usable alternative relay ever appears.
- **SignClient has no destroy(); leaked websocket/heartbeat timers keep Playwright workers alive or 'WalletConnect Core is already initialized' style cross-test interference**
  Mitigation: close() does disconnect-all → relayer.transportClose() → heartbeat.stop() → removeAllListeners; per-instance in-memory storage removes all cross-test state; docs mandate close() in finally; Playwright worker teardown is the backstop.
- **WalletConnect SDK churn: Reown may deprecate @walletconnect/sign-client in favor of @reown/walletkit, or break minor-version behavior (it pins exact internal versions)**
  Mitigation: sign-client 2.23.9 was published 2026-03-27 on the same release train as WalletKit (which merely wraps it), so deprecation risk is low-near-term; peer range >=2.17 <3 plus the raw `client` escape hatch; the surface we use (pair/approve/reject/respond/emit/update/disconnect) is the frozen protocol API shared with WalletKit, so a wrapper swap stays internal.
- **pnpm/strict installs fail to resolve @walletconnect/utils or types when consumers install only sign-client**
  Mitigation: All three declared as optional peers with the exact install command in the create() error message and docs.
- **Gating WC session proposals via a synthetic eth_requestAccounts dispatch could surprise tests that also exercise injected connects in the same test (one armed approval consumed by whichever arrives first)**
  Mitigation: Documented explicitly (it is also the existing approveNext race caveat); approveNext's match callback receives the proposal payload (proposer metadata, verified origin) so grants can be bound to the WC connect; open question offers a dedicated method id alternative.

### External facts verified by the designer

- @walletconnect/sign-client latest is 2.23.9, published 2026-03-27, NOT deprecated (npm registry JSON); @reown/walletkit 1.5.5 (2026-03-27) wraps the same sign-client 2.23.9 and additionally depends on @walletconnect/pay — verified via registry.npmjs.org dependency metadata
- Wallet-side API shapes: pair({uri}), approve({id, namespaces}) → {topic, acknowledged}, reject({id, reason: ErrorResponse}), respond({topic, response: JsonRpcResponse}), emit({topic, event:{name,data}, chainId}), update({topic, namespaces}), disconnect({topic, reason}) — verified from @walletconnect/types@2.23.9 dist/types/sign-client/engine.d.ts and client.d.ts (jsdelivr) plus docs.walletconnect.network/wallet-sdk/web/usage
- session_request event payload is { id, topic, params: { request: { method, params, expiryTimestamp? }, chainId: 'eip155:N' }, verifyContext }; session_proposal carries verifyContext + ProposalTypes.Struct (types client.d.ts)
- CoreTypes.Options accepts storage?: IKeyValueStorage and storageOptions?: KeyValueStorageOptions (types core/core.d.ts); IKeyValueStorage = getKeys/getEntries/getItem/setItem/removeItem (keyvaluestorage@1.1.1 types); Node default storage writes ./walletconnect.db via unstorage fs driver with a ':memory:' in-memory mode (keyvaluestorage dist bundle)
- Default relay URL constant in @walletconnect/core@2.23.9 dist is wss://relay.walletconnect.org; projectId is required in Core/SignClient init per Reown/WalletConnect docs
- AppKit (reown-com/appkit, current main) renders <wui-qr-code uri=${this.uri} data-testid="wui-qr-code"> as a Lit attribute binding inside w3m-connecting-wc-qrcode, with a Copy-link button data-testid="copy-wc2-uri"; Reown's own laboratory tests extract the URI via page.locator('wui-qr-code').getAttribute('uri') (ModalPage.ts) — verified by fetching the repo sources via gh api
- buildApprovedNamespaces(params: { proposal, supportedNamespaces }) and parseUri(str) are exported from @walletconnect/utils@2.23.9 (dist/types/namespaces.d.ts, uri.d.ts)
- getSdkError codes in @walletconnect/utils@2.23.9: USER_REJECTED=5000, UNSUPPORTED_CHAINS=5100, USER_DISCONNECTED=6000 (dist bundle constants)
- Self-hosting the relay is not practical in 2026: github.com/WalletConnect/relay is archived (pushed_at 2023-04-14) and described as a minimal/educational sample; production relay is closed-source and the WalletConnect Network is permissioned node operators (GitHub API + Reown FAQ/spec search results)

### Open questions

- Proposal gating identity: gate WC session proposals as a synthetic 'eth_requestAccounts' dispatch (shared arming with injected connects, zero new API — the proposed default) or introduce a distinct method id (e.g. 'wc_sessionPropose') so approveNext/holdNextRequest can target WC connects separately from injected connects in the same test?
- Pre-multichain semantics for a session_request on an approved-but-not-current chain: switch-then-dispatch (proposed; emits chainChanged like a single-network wallet) vs responding 5100 until multichain lands — switch-then-dispatch is friendlier but mutates wallet state as a side effect of dapp traffic
- Env var name and docs placement for the relay project id: WEB3_TESTER_WC_PROJECT_ID (proposed, parallel to WEB3_TESTER_REAL_WALLET_SMOKE) — and should the team provision a shared free-tier Reown project id for maintainer runs, or leave it per-developer?
- Peer floor: '>=2.17 <3' keeps older 2.x installs working but only 2.23.x is what we test against — pin tighter ('>=2.21 <3') or accept the wider range with the live suite as the compatibility canary?
- Should an AppKit-laboratory recipe (driving https://appkit-lab.reown.com end-to-end including the real modal) ship as a third, doubly-gated spec, or docs-only as proposed (third-party uptime makes it a poor suite member)?

### Adversarial review

**Corrections:**
- The behavior section calls the response/disconnect APIs 'respondSessionRequest(...)' and 'disconnectSession(...)' — those are @reown/walletkit method names. @walletconnect/sign-client@2.23.9 exposes respond({ topic, response: JsonRpcResponse }) and disconnect({ topic, reason: ErrorResponse }) (verified in @walletconnect/types@2.23.9 dist/types/sign-client/engine.d.ts lines 311-323 and client.d.ts). The design's own externalFactsVerified section has the correct names; the behavior narrative contradicts it and must use respond/disconnect.
- The goal text frames WC traffic as governed by live mode's 'deny-by-default with approveNext arming and allowedOrigins scoping' — the allowedOrigins half is false as designed. assertOriginAllowed runs only inside the exposeBinding handler installed by injectMockProvider (src/mock-wallet-controller.ts:231-247), not inside handleRpcRequest (line 465); the proposed handleExternalRequest delegates straight to handleRpcRequest, so every WC session_proposal and session_request bypasses the origin allowlist that live fixtures set to [baseURL] (src/live-fixtures.ts:92). Deny-by-default approval gating still applies, but the design must either enforce origins (call assertOriginAllowed with verifyContext.verified.origin — shape verified: { verified: { origin, validation: 'UNKNOWN'|'VALID'|'INVALID', verifyUrl, isScam? } } in types core/verify.d.ts) or strike the scoping claim and document the exemption.
- The advertised holdNextRequest parity ('works identically for WC traffic') is qualified by an unmentioned sign-client default: incoming session_requests are serialized through an internal sessionRequestQueue — the engine only emits the next request after the current one is responded (verified in the sign-client@2.23.9 dist bundle: onSessionRequest branches on this.client.signConfig?.disableRequestQueue, else addSessionRequestToSessionRequestQueue + processSessionRequestQueue). A request parked by holdNextRequest therefore silently blocks delivery of every subsequent WC request on that client until resolved. As written the design ships this surprise, and the hermetic suite cannot catch it because it feeds synthetic events directly to the handler, bypassing SignClient entirely. Fix: init with signConfig: { disableRequestQueue: true } (SignClientTypes.SignConfig, verified in client.d.ts) or document the serialization explicitly.
- Minor: the Node keyvaluestorage@1.1.1 backend uses unstorage's fs-lite driver (require('unstorage/drivers/fs-lite')), not the 'fs driver'; the substantive claims (defaults to ./walletconnect.db on disk, ':memory:' in-memory mode exists, Core skips constructing the default storage when opts.storage is provided — verified in the core 2.23.9 bundle: storage = t?.storage ? t.storage : new KeyValueStorage(...)) are all correct.
- The 'wcm-qrcode[uri]' half of the default selector is asserted, not verified — wcm is the deprecated legacy WalletConnect Modal and I could not confirm its qrcode element reflects uri as a DOM attribute. Harmless as a secondary selector, but it should not sit next to the genuinely verified wui-qr-code contract (which I confirmed: w3m-connecting-wc-qrcode renders <wui-qr-code uri=${this.uri} data-testid="wui-qr-code">, the copy button is data-testid="copy-wc2-uri", and Reown's laboratory ModalPage.getConnectUri does page.locator('wui-qr-code').getAttribute('uri') — all fetched from reown-com/appkit main).
- Everything else load-bearing checked out exactly: sign-client latest 2.23.9 published 2026-03-27T08:59Z not deprecated; @reown/walletkit 1.5.5 (same day) depends on sign-client 2.23.9 + @walletconnect/pay; default relay constant wss://relay.walletconnect.org in core 2.23.9; getSdkError codes USER_REJECTED=5000/UNSUPPORTED_CHAINS=5100/USER_DISCONNECTED=6000 in the utils 2.23.9 bundle; buildApprovedNamespaces/parseUri exported; approve() returns Promise<{ topic, acknowledged: () => Promise<SessionTypes.Struct> }>; session_request payload { id, topic, params: { request: { method, params, expiryTimestamp? }, chainId }, verifyContext }; ProposalTypes.Struct carries pairingTopic and proposer.metadata; ErrorResponse.data is typed string; IKeyValueStorage is getKeys/getEntries/getItem/setItem/removeItem; core.relayer.transportClose() and core.heartbeat.stop() exist; WalletConnect/relay GitHub repo archived, last push 2023-04-14. The repo-side integration points also all exist as named: private handleRpcRequest and emit, approveNext/holdNextRequest/simulateRejection/autoApprove queues, sentTransactions recording at src/mock-wallet-controller.ts:553-578, serializeRpcError (src/errors.ts:16), the shared MockWalletController across mock and live fixtures (src/live-fixtures.ts:83 wraps PrivateKeyRpcClient in the same class, so the wallet option works in both modes), the real-wallet-smoke self-skip precedent in the library project, and the CI dist-freshness gate.

**Improvements:**
- Handle the One-Click Auth / SIWE connect path explicitly — the design never mentions it, yet it is the default AppKit flow for SIWE dapps in 2026. Verified mechanism in sign-client 2.23.9: shouldIgnorePairingRequest only suppresses the fallback wc_sessionPropose when the wallet has registered a 'session_authenticate' listener (this.client.events.listenerCount("session_authenticate") > 0); with zero listeners the fallback proposal flows through onSessionProposeRequest normally and the dapp falls back to session + personal_sign SIWE (per Reown's One-Click Auth docs, https://docs.reown.com/appkit/ios/core/one-click-auth). So the design works — but only by accident of never subscribing. Make 'WalletConnectWallet must never register a session_authenticate listener' an explicit invariant in src/walletconnect.ts, document the fallback in docs/API.md, exercise it in the live spec via the dapp client's authenticate(), and note approveSessionAuthenticate as a future surface.
- Set signConfig: { disableRequestQueue: true } in SignClient.init (or expose it as an option defaulting to true) so a holdNextRequest park cannot starve subsequent session_requests, and add a live-suite case with two overlapping requests — the hermetic handler-injection strategy is structurally blind to this class of SignClient-side behavior.
- Thread origin enforcement through the new controller API: handleExternalRequest(request, context?: { origin?: string }) calling the existing assertOriginAllowed when allowedOrigins is configured, fed with verifyContext.verified.origin at both proposal and session_request time. Since validation can be 'UNKNOWN' (origin then derives from unattested proposer metadata), make it opt-out via a WalletConnectWalletOptions flag and document the trust level.
- Specify onProviderEvent dispatch semantics: the WC forwarder performs relay round-trips (client.update + client.emit), and MockWalletController.emit is awaited by switchNetwork/disconnect/setAccounts — if emit awaits node-side listeners, a dead relay connection makes wallet.switchNetwork() hang. Notify node listeners fire-and-forget (queueMicrotask + swallowed errors) or with a short bounded await.
- MemoryKeyValueStorage can be replaced (or backed) by the SDK's own in-memory path: storageOptions: { database: ':memory:' } hits keyvaluestorage's MEMORY_DB branch, which creates a fresh non-shared unstorage memory instance per Db (verified in the 1.1.1 bundle — Db.create returns a new instance for ':memory:' rather than the shared instances map). One less class to maintain; keep the custom class only if you want the storage option type to stay structural.
- Account for git-install weight: the package is consumed from git and "prepare": "npm run build" makes npm install the repo's devDependencies in every consumer install — adding sign-client/utils/types pulls the full WC tree (core, @noble/*, @scure/base, ox, unstorage, es-toolkit, msgpack, ws transport) into every consumer's install even when they never import './walletconnect'. Consider making prepare skip the build when committed dist/ is present, or at least document the cost alongside the optional-peer story.
- close() detail: ISignClientEvents.removeAllListeners is typed per-event (<E extends Event>(event: E) => this), so a zero-arg removeAllListeners() will not type-check — remove per event name or go through client.events (plain EventEmitter). Also remember to close the dapp-side SignClient in the live spec teardown for the same timer-leak reasons.
- Offer a fixture wrapper alongside the manual factory — e.g. an extendable wcWallet fixture (option-pattern like walletOptions/liveOptions) that creates from WEB3_TESTER_WC_PROJECT_ID and auto-closes in teardown — so the mandatory close()-in-finally discipline isn't pushed onto every consumer test; the manual create/close pattern is the one place the design departs from the repo's fixture conventions.
- The missing-optional-peer install-hint path in create() is untestable as designed (the peers are devDeps, so they always resolve in-repo, and hermetic tests never call create()). Inject the importer (e.g. a module-private importImpl that tests can stub) so the hint message and the './walletconnect' isolation contract get hermetic coverage instead of zero coverage in npm test.


## realwallet-surface — Real-wallet MetaMask surface completion to Synpress v4 parity (key: realwallet-surface)

**Review verdict:** needs-revision.

### Goal

After this ships, a consumer driving the real MetaMask extension (12.23.1 or the default 13.34.1) through @marigoldlabs/web3-tester/real-wallet can do everything Synpress v4's MetaMask class does for account/token/settings/activity flows without touching the extension UI themselves: import an Anvil dev private key mid-test, create/switch/rename accounts, lock and unlock the wallet, clear activity/nonce data after restarting Anvil, enable test networks, import an ERC-20 manually or approve a dapp's wallet_watchAsset prompt, and confirm a transaction while waiting for it to appear confirmed in the activity tab — with the tx hash returned when readable. All methods span both pinned MetaMask UI generations via the existing fallback-selector-stack pattern, and account mutations made during cached-profile setup survive profile close on 13.x's debounced IndexedDB persistence.

### API surface

```typescript
// src/real-wallet.ts — additions to existing types

export type RealWalletToken = {
  /** ERC-20 contract address (0x + 40 hex). */
  address: string;
  /** Optional symbol override; MetaMask usually autofills from the contract. */
  symbol?: string;
  /** Optional decimals override. */
  decimals?: number;
  /**
   * 13.x only: network to import the token on (name as shown in the import
   * modal's network selector). Defaults to the wallet's active network.
   */
  networkName?: string;
};

export type RealWalletController = {
  // ── existing 13 methods unchanged ──
  addNetwork(network: RealWalletNetwork): Promise<void>;
  approveNewNetwork(): Promise<void>;
  approveSwitchNetwork(): Promise<void>;
  approveTokenPermission(options?: { gasSetting?: RealWalletGasSettings; spendLimit?: 'max' | number }): Promise<void>;
  confirmSignature(): Promise<void>;
  confirmTransaction(options?: { gasSetting?: RealWalletGasSettings }): Promise<void>;
  connectToDapp(accounts?: string[]): Promise<void>;
  getAccountAddress(): Promise<string>;
  rejectNewNetwork(): Promise<void>;
  rejectSignature(): Promise<void>;
  rejectSwitchNetwork(): Promise<void>;
  rejectTransaction(): Promise<void>;
  switchNetwork(name: string, options?: { chainId?: number }): Promise<void>;

  // ── new in this feature ──
  /** Creates the next derived account on the active SRP. 12.x types the name in the create dialog; 13.x creates then renames. */
  addNewAccount(name?: string): Promise<void>;
  /** Approves a pending wallet_watchAsset ("Add suggested tokens") prompt. Synpress-parity alias: addNewToken(). */
  approveAddToken(): Promise<void>;
  rejectAddToken(): Promise<void>;
  /** confirmTransaction, then watch the newest activity row until status is confirmed; returns the tx hash when readable via "Copy transaction ID". */
  confirmTransactionAndWaitForMining(options?: {
    gasSetting?: RealWalletGasSettings;
    /** Wait budget for the activity row to reach confirmed. Default 60_000. */
    timeoutMs?: number;
  }): Promise<{ txHash?: `0x${string}` }>;
  /** Manual token import: tokens tab → Import tokens → Custom token form. */
  importToken(token: RealWalletToken): Promise<void>;
  /** Imports a private-key account ("Imported" keyring). Accepts with or without 0x prefix; throws on MetaMask-side errors (e.g. duplicate). */
  importWalletFromPrivateKey(privateKey: string): Promise<void>;
  /** Global menu → Lock; resolves once the unlock screen is visible. */
  lock(): Promise<void>;
  renameAccount(currentName: string, newName: string): Promise<void>;
  /** Clears activity/nonce data (12.x: Settings→Advanced "Clear activity tab data"; 13.x: Settings→Developer tools "Delete activity and nonce data"). */
  resetAccount(): Promise<void>;
  /** Selects an account in the account picker by display name, or by address (full/shortened row text match). */
  switchAccount(nameOrAddress: string): Promise<void>;
  /** Idempotent when `on` is given (reads toggle state first); blind toggle when omitted. */
  toggleShowTestNetworks(on?: boolean): Promise<void>;
  /** Unlocks with the given password or the password from launch setup. */
  unlock(password?: string): Promise<void>;
};

// src/real-wallet-cache.ts — additions
export type BuildWalletProfileOptions = {
  extensionPath: string;
  setup: RealWalletSetup;
  cacheDir?: string;
  headless?: boolean;
  force?: boolean;
  /**
   * Synpress defineWalletSetup-style one-time customization (import keys, add
   * accounts/networks/tokens) baked into the cached profile. `key` is hashed
   * into the cache key; bump it when `run` changes. After `run`, the builder
   * waits for extension state to flush to disk (13.x IndexedDB debounce)
   * before closing, so imported accounts survive profile close.
   */
  customize?: { key: string; run(session: RealWalletSession): Promise<void> };
};

/** Polls Default/IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb and
 *  Default/Local Extension Settings/<id> mtimes from Node until a write newer
 *  than `since` lands and the directory is quiet for `quietMs`. */
export async function waitForExtensionStatePersisted(
  profileDir: string,
  extensionId: string,
  options?: { since?: number; quietMs?: number; timeoutMs?: number },
): Promise<void>;

// src/real-wallet-fixtures.ts — RealWalletFixtureOptions gains:
//   profileSetup?: BuildWalletProfileOptions['customize'];

// ── usage ──
import { test, expect } from '@marigoldlabs/web3-tester/real-wallet-fixtures';

test.use({
  realWalletOptions: {
    setup: { seedPhrase: 'test test ... junk' },
    profileSetup: {
      key: 'qa-accounts-v1',
      run: async (wallet) => {
        await wallet.importWalletFromPrivateKey('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
        await wallet.addNewAccount('Treasury');
      },
    },
  },
});

test('treasury pays the user', async ({ page, realWallet }) => {
  await realWallet.switchAccount('Treasury');
  await page.goto(dappUrl);
  await page.evaluate(() => window.connect());
  await realWallet.connectToDapp();
  await page.evaluate(() => window.send());
  const { txHash } = await realWallet.confirmTransactionAndWaitForMining();
  expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
  await realWallet.resetAccount(); // clear nonce cache after anvil restart
});
```

### Behavior

All methods are wallet-side UI drivers on MetaMaskRealWallet (src/real-wallet.ts), built from the existing primitives: clickFirstVisible/fillFirstVisible/findVisibleLocator fallback stacks, this.home() (openExtensionHome + unlockMetaMaskIfNeeded), this.notificationPage(), confirmFooterAction/rejectFooterAction, closeMetaMaskOverlay, readClipboardViaPaste (LavaMoat blocks page.evaluate on extension pages — all reads stay locator/clipboard-based). New private helpers that generalize existing code: openAccountPicker(page) (testid account-menu-icon, both gens), openGlobalMenu(page) (account-options-menu-button, both gens), openSettings(page) (global-menu-settings, both gens), accountRows(page) (12.x `.multichain-account-menu-popover__list--menu-item`; 13.x `.multichain-account-cell` — both classes verified in the respective shipped bundles), and activityStatusLocators(page) (testids transaction-status-label--pending/--confirmed/--failed, verified present in BOTH shipped builds; `[data-tx-status]` exists only in 13.34.1 so it is a 13.x-only secondary signal).

Per-method semantics (every selector below was verified in the shipped 12.23.1 / 13.34.1 zips and the v-tagged e2e page objects):
- importWalletFromPrivateKey: validate /^(0x)?[0-9a-fA-F]{64}$/ (throw synchronously otherwise). 12.x: picker → multichain-account-menu-popover-action-button → multichain-account-menu-popover-add-imported-account. 13.x: picker → account-list-add-wallet-button → choose-wallet-type-import-account (dynamic `choose-wallet-type-${id}`). Both converge on `#private-key-box` + import-account-confirm-button (both bundles). On failure MetaMask renders `.mm-help-text` (e.g. duplicate-key); method throws with that text. Edge: imported accounts live outside the SRP — they change getAccountAddress's 13.x account-tree shape; the existing expectedAddress-based cell disambiguation already handles it.
- addNewAccount(name?): 12.x: action-button → multichain-account-menu-popover-add-account → optional name into `#account-name`/testid account-name-input → submit-add-account-with-name. 13.x (multichain tree): picker → testid add-multichain-account-button (first wallet's button; static testid with keyed siblings per SRP) → wait for the "Adding account…" state to clear; if name given, run renameAccount on the default-named account. Document: multi-SRP profiles get the first wallet (srpIndex escape hatch deferred).
- switchAccount(nameOrAddress): picker → accountRows filtered by exact name text, falling back to full/shortAddress() row-text match (12.x rows contain account-list-address; 13.x cells show names — address matching is best-effort there, error message says to use names). Click row; wait picker hidden. Throws a descriptive error listing the requested identifier if no row matches.
- renameAccount(current, new): 12.x: row's account-list-item-menu-button (aria-label "<name> Options") → account-list-menu-details → account-details-modal → editable-label-button → `[data-testid="editable-input"] input` (fallback account-name-input) → save-account-label-input → close. 13.x: cell's multichain-account-cell-end-accessory (aria-label "<name> options") → `.multichain-account-cell-menu-item[aria-label="Rename"]` (text fallback 'Rename') → `[data-testid="account-name-input"] input` → `.mm-button-base[aria-label="Confirm"]`.
- lock(): openGlobalMenu → global-menu-lock (identical testid both gens) → assert unlock screen (isMetaMaskUnlockVisible) within DEFAULT_TIMEOUT_MS. unlock(password?): reuse unlockMetaMask with password ?? walletPassword; throw the existing descriptive error if neither exists. Note 13.x has no unlock-password/unlock-submit testids in the shipped bundle — the existing fallbacks (`input[type="password"]`, role button 'Unlock') are the verified working path and stay.
- resetAccount(): 12.x: settings → 'Advanced' tab → testid advanced-setting-reset-account button ('Clear activity tab data') → modal confirm button 'Clear'. 13.x (V2 settings): settings → `settings-tab-item-developer-tools` (dynamic `settings-tab-item-${id}`; the shipped bundle's tab array places delete-activity-and-nonce-data under tabId "developer-tools") → developer-options-delete-activity-and-nonce-data → modal delete-activity-and-nonce-data-modal → delete-activity-and-nonce-data-button. Fallback when the tab is flag-hidden: settings-header-search-button → settings-header-search-input ('Clear activity') → settings-search-result-item. Smoke must confirm prod-build visibility (top risk).
- toggleShowTestNetworks(on?): 12.x: network picker (network-display/sort-by-networks) → row containing text 'Show test networks' → its `label.toggle-button` (no testid in 12.x; state read from toggle-button--on/--off class). 13.x: network manager → testid networks-page-show-test-networks. With `on` defined, read state first and click only on mismatch (no-op otherwise); with `on` undefined, blind toggle (Synpress parity). Close picker via closeMetaMaskOverlay.
- importToken: home → tokens tab → asset-list-control-bar-action-button → testid importTokens menu item (both bundles; text fallback 'Import tokens') → import-tokens-modal → 'Custom token' tab (import-tokens-modal-custom-token-tab; 12.x text fallback) → on 13.x, if token.networkName given, drive the network dropdown (test-import-tokens-drop-down-custom-import), else keep active network → fill import-tokens-modal-custom-address (+ -symbol/-decimals only while import-tokens-button-next is disabled, mirroring the upstream re-render race workaround) → import-tokens-button-next → import-tokens-modal-import-button → wait modal hidden.
- approveAddToken/rejectAddToken (aliases addNewToken/—): notificationPage() + confirmFooterAction/rejectFooterAction. metaMaskActionContentLocators gains /Add suggested tokens?/i (locale string verified identical in both builds) so findMetaMaskActionPage recognizes the prompt. Dapp-visible semantics: approve resolves wallet_watchAsset with true; reject yields EIP-1193 4001 (matches the existing rejectTransaction → 4001 contract; no providerError() involvement since the real extension produces the codes).
- confirmTransactionAndWaitForMining: run confirmTransaction(options) (popup settle loop unchanged) → this.home() → account-overview__activity-tab (both bundles) → first transaction-list-item/activity-list-item → poll until transaction-status-label--confirmed visible OR (row visible AND --pending/--queued absent), failing on --failed/--dropped with a descriptive error; deadline options.timeoutMs ?? 60_000. Edge: on instant-mining Anvil the pending state may never render — therefore confirmed-or-absent-pending, never "pending first". Hash extraction (best-effort, never throws): click the row → transaction-list-item-details view → button text 'Copy transaction ID' (verified as a text button in both shipped bundles) → readClipboardViaPaste() → return match of /^0x[0-9a-fA-F]{64}$/ as txHash, else undefined → close via popover-close/closeMetaMaskOverlay.
- Persistence (the cloneWalletProfile interaction): per-test clones are disposable, so mid-test account mutations never pollute the cache — by design nothing survives the test. What must survive close is buildWalletProfile's output: the new customize hook runs after onboarding inside buildWalletProfile, its key joins the sha256 cacheKey (alongside seedPhrase/password/extensionVersion), and before session.close() the builder calls waitForExtensionStatePersisted(profileDir, extensionId) — a Node-side fs poll of Default/IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb and Default/Local Extension Settings/<id> (both confirmed present in the existing 13.x profile cache) waiting for a post-mutation write plus a quiet period, replacing blind dwell. finishMetaMaskOnboarding's fixed 3s wait stays as a fallback when profileDir/extensionId are unknown. RealWalletLaunchOptions/launchRealWallet are unchanged; session wiring in launchRealWallet adds the 10 new delegating entries to keep the flat-session convention.

Error convention: all failures throw plain Errors with actionable messages naming the missing UI affordance and the MetaMask version implication ("…update web3-tester for this MetaMask version"), matching the file's existing style. No provider error codes are minted by this feature; codes observed by dapps (4001 on rejections) come from MetaMask itself.

### Files touched

| Path | Change |
| --- | --- |
| `/Users/adhyr/Repos/web3-tester/src/real-wallet.ts` | Core of the feature (~500 lines): extend RealWalletController type and RealWalletSession wiring with the 10 new methods (+ addNewToken alias); add RealWalletToken type; new locator-group helpers (openAccountPicker, openGlobalMenu, openSettings, accountRows, activityStatusLocators, settingsTabLocators); implement methods on MetaMaskRealWallet reusing confirmFooterAction/rejectFooterAction, closeMetaMaskOverlay, readClipboardViaPaste, shortAddress; extend metaMaskActionContentLocators with /Add suggested tokens?/i; export small pure helpers (normalizePrivateKey, isFullTxHash, accountRowMatcher) for hermetic unit testing. |
| `/Users/adhyr/Repos/web3-tester/src/real-wallet-cache.ts` | Add customize?: { key, run } to BuildWalletProfileOptions, fold key into cacheKey(), invoke run(session) after launchRealWallet succeeds and before close; add exported waitForExtensionStatePersisted(profileDir, extensionId, options) fs-polling helper watching the IndexedDB leveldb and Local Extension Settings dirs; call it before closing the builder session. |
| `/Users/adhyr/Repos/web3-tester/src/real-wallet-fixtures.ts` | Add profileSetup?: BuildWalletProfileOptions['customize'] to RealWalletFixtureOptions and pass it to buildWalletProfile; document that explicit profileDir bypasses it. |
| `/Users/adhyr/Repos/web3-tester/tests/real-wallet-smoke.spec.ts` | Extend the env-gated serial suite: extend DAPP_HTML with window.watchAsset(); add test 2 'account, token, settings, activity surface' exercising importWalletFromPrivateKey (anvil key #1 → address 0x70997970C51812dc3A010C7d01b50e0d17dc79C8), addNewAccount/switchAccount/renameAccount, lock/unlock, confirmTransactionAndWaitForMining (hash cross-checked via chain.client.getTransactionReceipt when returned), resetAccount (activity list empties), toggleShowTestNetworks (Sepolia row appears in picker; do not select it — no external RPC), inline minimal ERC-20 deploy on anvil then importToken and wallet_watchAsset → approveAddToken (dapp resolves true) and rejectAddToken (4001). |
| `/Users/adhyr/Repos/web3-tester/tests/real-wallet.spec.ts` | Hermetic unit tests (run in default npm test) for the newly exported pure helpers: normalizePrivateKey accept/reject cases, tx-hash pattern, accountRowMatcher name/full-address/short-address matching. |
| `/Users/adhyr/Repos/web3-tester/docs/API.md` | Document all new RealWalletController methods with both-generation behavior notes (13.x resetAccount lives under Developer tools; addNewAccount naming difference; txHash best-effort), RealWalletToken, customize/profileSetup, waitForExtensionStatePersisted, and the WEB3_TESTER_METAMASK_VERSION=12.23.1 smoke matrix. |
| `/Users/adhyr/Repos/web3-tester/CHANGELOG.md` | 0.3.0 entry: real-wallet Synpress v4 surface parity list. |
| `/Users/adhyr/Repos/web3-tester/README.md` | Update the real-wallet capability table / Synpress comparison. |
| `/Users/adhyr/Repos/web3-tester/dist/` | Rebuild and commit (repo convention: committed dist with CI freshness gate covers real-wallet.js, real-wallet-cache.js, real-wallet-fixtures.js and .d.ts/.map siblings). |

### New dependencies

None.

### Test strategy

Two layers, preserving the hermetic npm test contract. (1) Hermetic (library project, runs on every npm test): unit specs in tests/real-wallet.spec.ts for the exported pure helpers (private-key normalization/validation, tx-hash regex, account-row matching predicate) — these pin the input-validation and matching semantics without a browser. Nothing else in this feature can be hermetic: every method is real-extension UI automation. (2) Env-gated smoke (WEB3_TESTER_REAL_WALLET_SMOKE=true, serial, already wired into the library project with skip guard): one new test in tests/real-wallet-smoke.spec.ts sharing the existing per-suite Anvil + local dapp server and the cached profile, covering the full new surface end-to-end with on-chain assertions (receipt for the returned txHash, balance delta, activity emptied after resetAccount, watchAsset promise resolving true/4001). Version matrix: the suite must pass twice — default (13.34.1) and WEB3_TESTER_METAMASK_VERSION=12.23.1 — which the extension/profile caches already key correctly; document both invocations in docs/API.md and add them to the release checklist (and a manual/nightly CI job if/when CI exists). The profileSetup/customize path gets its own smoke assertion: build a customized profile, close, relaunch from the clone, and verify the imported account is still present (this is the regression trap for the 13.x IndexedDB debounce).

### Effort

9–12 focused days. Dominated by UI archaeology and smoke-iteration latency (each full smoke run is minutes; every selector tweak needs runs against BOTH extension builds, and 13.x has feature-flag-dependent UI states). Rough split: importWalletFromPrivateKey 0.5d; addNewAccount+renameAccount 1.5d (13.x account-tree menus); switchAccount 0.5d; lock/unlock 0.25d; resetAccount 1d (13.x Developer-tools visibility risk + search fallback); toggleShowTestNetworks 0.5d (12.x testid-less toggle, idempotent state read); importToken 1.5d (13.x network-selector modal and re-render races); approve/rejectAddToken 0.25d; confirmTransactionAndWaitForMining 1.5d (activity polling, clipboard hash, popup→home interplay); cache customize hook + fs persistence-flush helper 1d; smoke-suite extension + dual-version stabilization passes + docs/dist 1.5–2d. The selector groundwork is unusually de-risked because both shipped bundles were greped directly for every testid, but budget assumes the usual 20–30% of selectors needing live adjustment.

### Depends on

Nothing (but see the sequencing plan — shared-substrate ordering still applies).

### Risks

- **13.x resetAccount path: 'Delete activity and nonce data' sits under the Settings 'Developer tools' tab in the shipped 13.34.1 bundle's tab array, but that tab may be hidden by a (remote) feature flag in production profiles, breaking the primary path.**
  Mitigation: Implement the settings-search fallback (settings-header-search-button → 'Clear activity' → settings-search-result-item) in the same selector stack from day one; verify the primary path in the very first 13.x smoke run and demote/promote paths accordingly; throw a descriptive version-specific error if neither resolves.
- **13.x ships BOTH the legacy account-list popover and the multichain account tree (legacy classes and testids are still in the bundle); MetaMask's remote feature flags could flip which renders, so a selector stack tuned to one state silently takes the other path.**
  Mitigation: Every account method's locator stack covers both states (legacy popover testids + multichain-account-cell ids), mirroring how getAccountAddress already handles it; the smoke suite asserts outcomes (account visible/renamed/switched) rather than which path executed.
- **Clipboard-based tx-hash read (Copy transaction ID → synthetic paste) can fail under --headless=new, OS clipboard contention, or future UI changes, and there is no DOM fallback because the details view shows a shortened hash and LavaMoat blocks evaluate.**
  Mitigation: txHash is typed optional and the method never throws on hash-read failure (mining wait still completes); docs point consumers needing guaranteed hashes to mock/live modes; smoke asserts hash presence only on the headed default configuration.
- **13.x debounced IndexedDB persistence: profile customization (imported keys, new accounts) flushed too late is silently lost on close, producing cached profiles missing accounts — failures appear one test run later and look unrelated.**
  Mitigation: waitForExtensionStatePersisted polls actual leveldb mtimes (IndexedDB + Local Extension Settings) for a post-mutation write plus quiet period with a hard timeout fallback to the existing 3s dwell; the smoke suite includes a build→close→relaunch-from-clone assertion that the imported account survived.
- **Token import on 13.x multichain asset list varies with how many networks are enabled (network dropdown step appears conditionally) and the form has known re-render races that clear inputs.**
  Mitigation: Default to the active network (skip the dropdown unless token.networkName is provided) and adopt upstream's own e2e mitigation: only fill symbol/decimals while the Next button is disabled, then wait for the modal to close.
- **Scope creep into a never-green two-version matrix: ten new UI methods × two generations is exactly the surface that rotted Synpress.**
  Mitigation: Everything funnels through the four shared click/fill/find primitives and shared locator groups so a MetaMask change is a one-place fix; the pinned-version downloader plus the version-keyed profile cache already freeze the target builds, and the release checklist gains the explicit dual-version smoke commands.

### External facts verified by the designer

- Synpress v4 MetaMask class exact signatures (fetched wallets/metamask/src/playwright/MetaMask.ts, Synthetixio/synpress dev branch): importWalletFromPrivateKey(privateKey: string), addNewAccount(accountName: string), switchAccount(accountName: string), renameAccount(current, new), lock(), unlock(), resetAccount(), toggleShowTestNetworks(), addNewToken() (no args — acts on the notification popup, i.e. watchAsset approval), confirmTransactionAndWaitForMining(options?), openTransactionDetails(txIndex), closeTransactionDetails().
- Shipped production bundles for BOTH pinned versions greped directly (local cache ~/.cache/web3-tester/metamask/metamask-chrome-{12.23.1,13.34.1}, the exact zips the harness downloads): #private-key-box, import-account-confirm-button, account-name-input, account-menu-icon, account-options-menu-button, global-menu-lock, global-menu-settings, importTokens, asset-list-control-bar-action-button, import-tokens-modal-custom-{address,symbol,decimals}, import-tokens-button-next, import-tokens-modal-import-button, activity-list-item, transaction-list-item, transaction-list-item-details, transaction-status-label--{pending,confirmed,failed,dropped,queued} all present in BOTH builds.
- Generation-specific testids verified by presence/absence in the shipped bundles: 12.23.1-only — multichain-account-menu-popover-{action-button,add-account,add-imported-account,import-srp}, submit-add-account-with-name, advanced-setting-reset-account, editable-label-button; 13.34.1-only — account-list-add-wallet-button, add-multichain-account-button (static testid, keyed siblings), choose-wallet-type-${id} (dynamic; id=import-account), multichain-account-cell-* (end-accessory, menu-item, popover-menu), networks-page-show-test-networks, settings-tab-item-${id} (dynamic), developer-options-delete-activity-and-nonce-data, delete-activity-and-nonce-data-{modal,button}; data-tx-status attribute exists only in 13.34.1 (so cross-gen mining wait uses transaction-status-label--* testids).
- 13.x resetAccount location: the shipped 13.34.1 settings bundle contains the tab array {tabId:"developer-tools", items:{"show-fiat-in-testnets","delete-activity-and-nonce-data"}} and the modal renders `${t("clearActivity")}?` ('Clear activity and nonce data?') with submitText t('clear') — extracted from minified chunk 5671.*/js-84e32abe.* in the production zip.
- 12.x 'Show test networks' toggle has NO testid in the shipped 12.23.1 bundle — it renders t("showTestnetNetworks") text next to a ToggleButton component (extracted render context), so the 12.x path must be text-row + label.toggle-button; the 13.x equivalent carries dataTestId networks-page-show-test-networks.
- MetaMask's own e2e page objects at the exact tags (raw.githubusercontent.com, v13.34.1 and v12.23.1, test/e2e/page-objects/pages/...): 13.x add account = add-multichain-account-button click + wait for 'Adding account...' to clear; 13.x rename = '<name> options' accessory → menu item aria-label 'Rename' → '[data-testid="account-name-input"] input' → '.mm-button-base[aria-label="Confirm"]'; 12.x rename = account-details-modal → editable-label-button → '[data-testid="editable-input"] input' → save-account-label-input; 12.x addAccount name field = '#account-name'; lock = openGlobalMenu → '[data-testid="global-menu-lock"]'; activity waits use '[data-tx-status="confirmed"]' (13.x) and count-polling.
- 'Copy transaction ID' is a plain text button inside the transaction-list-item-details view in BOTH shipped bundles (render context extracted from each: onClick:this.handleCopyTxId with t("copyTransactionId"); locale message identical in both _locales/en/messages.json) — basis for the clipboard tx-hash read; the wallet_watchAsset prompt copy 'Add suggested tokens' is also identical in both locales.
- 13.x persistence layout confirmed in the existing local profile cache (~/.cache/web3-tester/profiles/ab3603f0326fbc02): both Default/IndexedDB/chrome-extension_<extensionId>_0.indexeddb.leveldb/ and Default/Local Extension Settings/<extensionId>/ exist — the two directories waitForExtensionStatePersisted must watch.

### Open questions

- Multi-SRP profiles on 13.x: should addNewAccount/importWalletFromPrivateKey expose a wallet/srpIndex option now (the 13.x UI keys add-multichain-account-button per wallet), or is first-wallet-only acceptable for 0.3.0 given the harness only ever onboards one SRP today?
- confirmTransactionAndWaitForMining return shape: is { txHash?: Hex } (best-effort, never throws on hash-read failure) the right contract, or should there be a strict option that fails the test when the hash cannot be read?
- Naming parity vs clarity: ship Synpress's addNewToken() as a documented alias of approveAddToken() (recommended for migration ergonomics), or expose only the clearer name and document the mapping?
- If the first 13.x smoke run shows the Settings 'Developer tools' tab is flag-hidden in production builds AND the settings-search fallback also fails, is shipping resetAccount() as 12.x-only (throwing a clear unsupported-version error on 13.x) acceptable for this release?
- Should the buildWalletProfile customize hook land in this feature (it is what makes imported accounts survive profile close, and the smoke suite wants it) or be split into its own follow-up to keep this PR strictly controller-surface? Design assumes it lands here.
- toggleShowTestNetworks(on) defaulting: when `on` is omitted the method blind-toggles for Synpress parity — would the maintainer prefer defaulting to on=true (the overwhelmingly common intent) instead?

### Adversarial review

**Blockers (must change before implementation):**
- The smoke-test plan as written will likely fail on the default 13.34.1 run: it imports anvil dev key #1 (0x59c6...90d → 0x70997970C51812dc3A010C7d01b50e0d17dc79C8) into a wallet onboarded from the SAME anvil mnemonic (TEST_SEED in tests/real-wallet-smoke.spec.ts:18). The repo's own smoke comment (tests/real-wallet-smoke.spec.ts:83-85) documents that 13.x multichain onboarding derives several SRP accounts, and the anvil mnemonic's account #1 has public mainnet activity, so discovery will derive exactly that address — making importWalletFromPrivateKey throw the duplicate-account error the design itself documents (.mm-help-text). Even when discovery doesn't trigger, the test hinges on nondeterministic remote account discovery. Fix: import a random, non-mnemonic private key and fund it via chain.setBalance; assert the imported address equals privateKeyToAccount(key).address.

**Corrections:**
- FALSE verified-fact: "13.x has no unlock-password/unlock-submit testids in the shipped bundle". Both exist in 13.34.1 — grep of ~/.cache/web3-tester/metamask/metamask-chrome-13.34.1 shows `"data-testid":"unlock-password"` (TextField inputProps) and `"data-testid":"unlock-submit"` (submit button). Harmless to the implementation (the existing stack in src/real-wallet.ts metaMaskUnlockPasswordLocators/metaMaskUnlockSubmitLocators lists these testids first and they will simply match), but the design's caveat and the planned docs note for unlock() are wrong and should be dropped.
- FALSE verified-fact: editable-label-button is listed as "12.23.1-only". It is present in the 13.34.1 bundle too: `l:this.context.t("edit"),"data-testid":"editable-label-button"`. Not load-bearing, but the 13.x rename stack could include it as a free fallback.
- Wrong label claim in the 13.x resetAccount modal: the design says submitText is t('clear'); the 13.34.1 bundle shows the confirm button is created with `I=p("delete")` then `createElement(o.$,{"data-testid":"delete-activity-and-nonce-data-button",...},I)` — the label is "Delete", not "Clear". The testid-based click is still correct, so only the documented text fallback must change. (The rest of this path verified exactly: `{tabId:"developer-tools",items:t(c)}` with c containing "delete-activity-and-nonce-data", plus settings-header-search/settings-search-result-item present in 13.34.1 only.)
- Risk #2 is internally inconsistent with the design's own externalFactsVerified: it claims 13.x "ships BOTH the legacy account-list popover and the multichain account tree (legacy classes and testids are still in the bundle)". Legacy popover classes/CSS do appear in 13.34.1, but the actionable legacy testids the 12.x paths rely on (multichain-account-menu-popover-action-button/-add-account/-add-imported-account, submit-add-account-with-name, advanced-setting-reset-account) are ABSENT from the 13.34.1 bundle (verified by grep). A remote-flag flip to a "legacy state" therefore cannot be handled by those testids — the components are not shipped. The mitigation is harmless dead weight; the real cross-state coverage comes from the multichain testids.
- Count/shape errors in the API surface: launchRealWallet wiring needs 12 new delegating entries (addNewAccount, approveAddToken, rejectAddToken, confirmTransactionAndWaitForMining, importToken, importWalletFromPrivateKey, lock, renameAccount, resetAccount, switchAccount, toggleShowTestNetworks, unlock) plus the addNewToken alias = 13, not "10". Also the RealWalletController type block in apiSurface omits the addNewToken() alias that filesTouched promises to ship — if it is on the session it must be in the type.
- Overstated: "imported accounts change getAccountAddress's 13.x account-tree shape; the existing expectedAddress-based cell disambiguation already handles it." The actual code (src/real-wallet.ts:902 + pageContainsAddress at 560-571) has a fast-path that returns this.expectedAddress whenever its leading/trailing fragments appear anywhere in the home-page body, and the 13.x picker fallback (openAccountDetailsModal, lines 984-990) explicitly prefers the expectedAddress cell. After switchAccount()/importWalletFromPrivateKey() changes the active account, a session constructed with expectedAddress (which buildWalletProfile ALWAYS does — real-wallet-cache.ts:117 — so every customize hook runs in exactly this state) can return the stale SRP-#0 address instead of the active account. This needs explicit handling, not "already handled".
- filesTouched omits /Users/adhyr/Repos/web3-tester/src/index.ts. package.json has NO ./real-wallet-cache subpath export — buildWalletProfile/cloneWalletProfile and BuildWalletProfileOptions reach consumers only via the root index (src/index.ts:11,42). The new waitForExtensionStatePersisted function and RealWalletToken type must be added to src/index.ts re-exports or they are unreachable through the package's public entry points.
- Everything else checked out under independent verification: all both-generation testids (private-key-box, import-account-confirm-button, account-name-input, global-menu-lock/settings, importTokens, asset-list-control-bar-action-button, import-tokens-modal-custom-*, import-tokens-button-next/-import-button, activity-list-item, transaction-list-item-details, transaction-status-label--{pending,confirmed,failed,dropped,queued}, account-overview__activity-tab, handleCopyTxId/copyTransactionId, addSuggestedTokens='Add suggested tokens', showTestnetNetworks render contexts), the 13.x-only set (account-list-add-wallet-button, add-multichain-account-button with keyed siblings, choose-wallet-type-${e.id}, multichain-account-cell[-end-accessory], networks-page-show-test-networks, data-tx-status), the profile layout (Default/IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb and Default/Local Extension Settings/<id> both present in ~/.cache/web3-tester/profiles/ab3603f0326fbc02), Synpress v4's MetaMask method list (fetched from the dev branch — matches, including confirmTransactionAndWaitForMining(options?): Promise<void>), wallet_watchAsset rejection = providerErrors.userRejectedRequest() i.e. 4001 (confirmed in ui/pages/confirm-add-suggested-token/confirm-add-suggested-token.js at the v13.34.1 tag), WEB3_TESTER_METAMASK_VERSION (src/metamask-extension.ts:69), the hermetic gating (library project includes real-wallet-smoke.spec.ts behind WEB3_TESTER_REAL_WALLET_SMOKE), and chain.client.getTransactionReceipt (AnvilViemClient extends publicActions, src/anvil.ts:332).

**Improvements:**
- Add src/index.ts to filesTouched (see corrections): re-export waitForExtensionStatePersisted and RealWalletToken; RealWalletController/Session type changes flow through the existing type re-exports automatically.
- buildWalletProfile lock heartbeat: the stale-lock threshold is 5 minutes measured from lockDir creation mtime (src/real-wallet-cache.ts:71-77) and is never refreshed during a build. A customize hook adds arbitrary UI-automation time on top of onboarding; once a build exceeds 5 minutes, a concurrently waiting worker declares the lock stale, deletes it, and starts a second builder against the same profileDir — corrupting the cache. Touch the lockDir mtime periodically while the builder runs (or scale the threshold when customize is present).
- Goal says "everything Synpress v4's MetaMask class does for account/token/settings/activity flows", but three Synpress methods are silently dropped: rejectTokenPermission() (trivial — rejectFooterAction on the spending-cap prompt; web3-tester currently has only approveTokenPermission), and openTransactionDetails(txIndex)/closeTransactionDetails() (partially absorbed into the hash-read of confirmTransactionAndWaitForMining but not exposed). Review finding #891 also named providePublicEncryptionKey()/decrypt() (eth_getEncryptionPublicKey/eth_decrypt) which the design neither ships nor descopes. Ship rejectTokenPermission in this pass; explicitly descope the others in docs/API.md and the changelog so the parity claim is honest.
- Make account mutations update the session's address bookkeeping: after switchAccount/importWalletFromPrivateKey/addNewAccount, clear or update the private expectedAddress used by getAccountAddress's fast-path and the 13.x picker-cell disambiguation (src/real-wallet.ts:902, 984-990), otherwise getAccountAddress returns stale results in any session constructed with expectedAddress — which includes every customize-hook session.
- waitForExtensionStatePersisted should resolve layout via the existing resolveRealWalletProfile (src/real-wallet.ts:87) instead of hardcoding Default/: a consumer-supplied profileDir can itself be a Chrome 'Default'/'Profile N' directory, in which case the IndexedDB dir is a sibling of profileDir, not under profileDir/Default. Also watch the .indexeddb.blob sibling directory (present in the real cache next to the .leveldb dir) since large state values land there.
- The 13.x rename stack can add editable-label-button as a fallback (it ships in 13.34.1, see corrections), and drop the planned doc caveat about missing 13.x unlock testids — the primary unlock-password/unlock-submit stack works on both generations.
- Exported pure helpers (normalizePrivateKey, isFullTxHash, accountRowMatcher) become part of the public ./real-wallet subpath surface, and repo convention says docs/API.md documents every public surface. Either document them as stable utilities or move them to a non-exported internal module — tests already import from ../src directly (tests/real-wallet.spec.ts imports ../src/real-wallet.js), so they don't need to be on the package surface to be unit-testable.
- Document the customize-hook end-state contract: whatever account/network customize leaves selected is what every cloned per-test profile boots with (MetaMask auto-selects newly imported accounts). Recommend the builder (or docs) switch back to the primary account before close so connectToDapp/getAccountAddress defaults stay stable across tests that don't call switchAccount.
- Smoke detail: when asserting the wallet_watchAsset approve path resolves true on anvil, deploy the minimal ERC-20 BEFORE calling watchAsset — MetaMask reads symbol/decimals over the active network RPC and the prompt copy degrades when the contract reads revert; anvil_setCode alone won't satisfy balanceOf/symbol unless the bytecode hardcodes returns, so prefer a real deployment transaction via chain.client (walletActions are already extended, src/anvil.ts:333).
- Effort estimate (9-12 days) and dependsOn:[] are honest — the selector groundwork survived independent re-verification at near-100%, so the dominant remaining cost really is dual-version smoke iteration, as budgeted.


---

# Part 2 — Sequencing, consistency rulings, shared infrastructure

## Implementation phases

### Phase 1 — Controller substrate + multichain (serial, lands first)

- Shared substrate in src/mock-wallet-controller.ts, built once: canonical normalizeChainId via toHex(BigInt(...)) with providerError(-32602) wrapping for dapp-supplied ids and plain Error for constructor/config ids; chainBackends Map<Hex, RpcClient> registry with clientForChain(chainId)/activeRpcClient throwing providerError(4901) for unbacked chains; public backedChainIds getter; handleExternalRequest(request, context?: { origin }) that threads assertOriginAllowed; onProviderEvent(listener) with fire-and-forget (queueMicrotask, errors swallowed) node-side dispatch; promise-chain request mutex around forwarded send paths; bounded-RPC-probe helper (AbortSignal.timeout)
- Handler reorder per ruling: wallet_switchEthereumChain validates (-32602) then 4902 then assertUserApproved (today src/mock-wallet-controller.ts:510-521 gates first); same-chain switch/add emits no chainChanged; deny-mode unknown-chain switch flips 4001→4902 with a pinning test
- multichain proper (review corrections folded): chains/trustDappRpcUrls options, httpRpcClient(url, { retryCount: 0 }) adapter, EIP-3085 rpcUrls shape rejection (missing/empty/malformed → -32602, reframed as MetaMask-faithful not 'only chainId required'), first-registration-wins for dapp adds vs overwrite for test-side addChain, SentTransactionRecord.chainId
- Fixtures: extraChains/extraAnvils/chains worker fixtures spreading { ...anvilOptions, ...spec } (extras inherit executable/runtime/docker), +1000 port band with the documented workerIndex<1000 bound, ANVIL_PORT as whole-band shifter, spec port bands using unused sub-offsets (anvil.spec 0-3, pkrc 10-12, new specs 13+)
- tests/mock-wallet-multichain.spec.ts + tests/fixtures-multichain.spec.ts + regression that a chains-less controller has no 4901 paths; CHANGELOG entries for 4901, hex canonicalization, and the switch reorder

*Rationale:* Four of seven features edit mock-wallet-controller.ts and two rewrite fixtures.ts; landing the registry, dispatch hooks, mutex, and canonicalization once eliminates serial merge conflicts and an N-way rebase war. multichain owns the registry that eip5792 (clientForChain + backedChainIds) and walletconnect (per-chain dispatch) consume, so it anchors the phase. ~5 focused days (4d design estimate + ~1d substrate/hook work pulled forward from walletconnect/eip5792).

### Phase 2 — multiaccount (serial, after Phase 1)

- resolveAccounts + accountIndexes (lift the type-level 'accounts' Omit at src/fixtures.ts:19-22, formalizing existing runtime spread behavior)
- _chainIsolation test-scoped fixture as the single snapshot/revert owner, generalized over the Phase-1 chains map (snapshot EVERY ChainController before use, revert all in finally) — supersedes multichain's 'wallet fixture snapshots every controller' wording
- createUser factory: inherits the test's walletOptions as base layer under per-call overrides (accounts/accountIndexes owned by resolveAccounts), binds to the same chain/chains fixtures as the wallet fixture, UserSession.close(), context teardown before the single revert
- switchAccount/currentAccounts with most-recently-selected-first ordering and no-event-on-no-change; renamed assertAccountsKnownToNode validation with RE-PROBE-ON-MISS (not lazy-once cache — anvil eth_accounts includes impersonated accounts per foundry #5734), bounded probe timeout, fail-open on throw/timeout/[]; constructor-wide allowUnsignableAccounts dropped, one narrow per-call escape hatch for non-probing custom RpcClients
- PrivateKeyRpcClient local 'eth_accounts' case — MUST land in the same commit as the injectMockProvider probe (tests/live-fixtures.spec.ts builds a PrivateKeyRpcClient with no rpcUrl; without the local case npm test would hit public Sepolia)
- from ∈ accounts → providerError(4100) on eth_sendTransaction (case-insensitive), bundled into 0.3.0 so it shares one migration with the accounts-validation break; stopImpersonatingAccount hygiene in the impersonation spec; README setAccounts example fix

*Rationale:* Must follow multichain: _chainIsolation snapshots every chain in the chains map and createUser binds to the registry — building it against the single-chain fixture then reworking it would churn fixtures.ts twice. 2.5–3 focused days. After this phase the controller/fixture core is stable and the remaining tracks fan out.

### Phase 3 — Parallel tracks (start after Phase 1; realwallet track starts day 1)

- Track A, eip5792-7702 (5–6d, after Phase 1 since it consumes clientForChain/backedChainIds; dependsOn:['multichain'] inverted per review): BLOCKER rework — receipt-status-checked atomic loop (anvil mines reverting txs with status 0x0, so fetch eth_getTransactionReceipt synchronously after each send under automine; status 0x0 OR submission error → evm_revert; explicit documented posture for blockTime>0), corrected 400=nothing-landed / 500=all-reverted-or-rolled-back / 600=mixed taxonomy, batch execution inside the Phase-1 mutex, snapshot calls wrapped with a clear providerError on non-anvil backends, case-insensitive from→4100, atomicRequired+capabilities recorded on CallsBatchRecord; ChainController 7702 helpers (delegate/revoke/getDelegation, impersonate fallback for non-unlocked self-executors); PrivateKeyRpcClient authorizationList hex→number coercion + signAuthorization; live-fixtures defaults eip5792 disabled (ruling 10)
- Track B, matchers (5–6d + 0.5d verification pass — it is the ONE design that never received adversarial review): src/transactions.ts (ReadClient, waitForDecodedTransaction, extractRevertInfo) + src/matchers.ts, ChainController.waitForTransaction, PrivateKeyRpcClient.client getter, extended expect re-exported from all three fixture modules; its test token should be the deal-helpers TestERC20 artifact, not a second hand-rolled bytecode path
- Track C, deal-helpers (3.5d): discovery via eth_call stateDiff state-overrides (per-call, nothing persists, concurrency-safe — replaces write/probe/restore machinery), sentinel-amount probe values, single verified anvil_setStorageAt final write, cache-hit verify→restore→evict→rediscover-once (resolves the step-5/risk-2 contradiction and the address-reuse-after-revert hazard), setStorageAt/setCode/setNonce passthrough trio with toHex(slot, { size: 32 }), contracts/ + scripts/build-contracts.mjs pipeline with a NON-optional CI artifact-freshness gate, Erc20DealError mapping for non-anvil clients
- Track D, realwallet-surface (9–12d, fully independent file set — start day 1 alongside Phase 1): BLOCKER rework — smoke imports a random non-mnemonic key funded via chain.setBalance (anvil key #1 collides with 13.x SRP discovery and throws the duplicate-account error); 12 delegating session entries + addNewToken alias + rejectTokenPermission; corrections folded (13.x resetAccount confirm label is 'Delete', unlock-password/unlock-submit DO exist in 13.34.1 so drop the caveat, editable-label-button usable on 13.x rename, expectedAddress invalidation after switchAccount/import/addNewAccount, src/index.ts re-exports for waitForExtensionStatePersisted/RealWalletToken, buildWalletProfile lock-heartbeat during customize, waitForExtensionStatePersisted resolves layout via resolveRealWalletProfile and watches the .indexeddb.blob sibling); explicit descope note for openTransactionDetails/encryption methods

*Rationale:* These four touch disjoint or coordinatable files. anvil.ts and private-key-rpc-client.ts are each touched by three tracks (eip5792, matchers, deal-helpers) — assign one owner per file or merge in the order C→A→B (deal-helpers' anvil additions are largest); the changes are additive methods so conflicts are mechanical. realwallet is the wall-clock long pole and shares zero files with the controller work, so it runs the whole window.

### Phase 4 — walletconnect (last feature; needs Phase 1 hooks, benefits from landed multichain)

- src/walletconnect.ts on @walletconnect/sign-client with corrected API names: client.respond({ topic, response }) and client.disconnect({ topic, reason }) — NOT the walletkit respondSessionRequest/disconnectSession names the behavior section used
- SignClient.init with signConfig: { disableRequestQueue: true } so a holdNextRequest park cannot starve subsequent session_requests; live-suite case with two overlapping requests
- Origin enforcement made true, not stricken: proposal and session_request dispatch through Phase-1 handleExternalRequest(request, { origin: verifyContext.verified.origin }) hitting assertOriginAllowed, opt-out flag documented with the UNKNOWN-validation trust caveat
- Explicit invariant: never register a session_authenticate listener (keeps One-Click Auth dapps on the wc_sessionPropose fallback), documented and pinned; per-event removeAllListeners (zero-arg form does not type-check); onProviderEvent forwarding does relay round-trips off the controller's await path
- Storage via storageOptions { database: ':memory:' } or MemoryKeyValueStorage; injectable importer so the missing-optional-peer hint is hermetically testable; optional wcWallet fixture wrapper with auto-close; optional peers (sign-client/utils/types '>=2.17 <3') + './walletconnect' subpath; decide the prepare-script/git-install devDependency weight (skip build when committed dist present, or document the cost)
- Hermetic handler-injection spec + env-gated WEB3_TESTER_WC_PROJECT_ID relay spec (never a CI gate)

*Rationale:* Sequenced last among features: it is the only pure consumer of the controller hooks (handleExternalRequest/onProviderEvent), the only one adding dependencies, and its pre-multichain switch-then-dispatch fallback becomes dead code once multichain is already in — landing after Phase 1+2 means it ships the final per-request-routing form directly. 5–6 focused days.

### Phase 5 — 0.3.0 release integration

- docs/API.md consolidation (every public surface, per repo convention) and one CHANGELOG 0.3.0 entry enumerating ALL behavior changes in a single migration list: 4901 on unbacked-chain forwards, chainId hex canonicalization, switch-handler reorder (4001→4902 deny-mode), rpcUrls-shape rejection in wallet_addEthereumChain, accounts-known-to-node validation, from∈accounts→4100, eip5792 default-on in mock mode, extended expect type shape
- playwright.config.ts testMatch union for all new specs (the library project is an explicit allowlist — a missed entry silently skips a suite)
- Single final dist rebuild + npm run verify (typecheck, build, hermetic npm test); per-PR rebases rebuild dist to satisfy the CI freshness gate, resolving dist conflicts by regeneration never by merge
- Manual release-checklist runs of the env-gated suites: real-wallet smoke twice (default 13.34.1 and WEB3_TESTER_METAMASK_VERSION=12.23.1), walletconnect-live (WEB3_TESTER_WC_PROJECT_ID), fjord live suites

*Rationale:* The repo convention is committed dist + CI freshness gate, so dist churn must be process-managed; consolidating seven features' behavior changes into one documented migration is materially cheaper for consumers than seven incremental notes, and the dual-version real-wallet matrix plus relay suite only make sense once everything is merged.

## Consistency rulings (binding across all features)

1. RULING (error code, unbacked chain): forwarded calls on a registered-but-unbacked chain throw providerError(4901, ...) — EIP-1193 'Chain Disconnected' — not MetaMask's real-world -32603. The library's existing convention (src/errors.ts providerError + the implemented 4001/4100/4200/4902 set) is EIP-1193-faithful named codes, and 4901 is in the same EIP-1193 table; emit it from the single clientForChain seam so a future fidelity swap is one line.
2. RULING (handler ordering, library-wide): param validation (-32602) → state/known-chain checks (4902, 5710, 5720, ...) → assertUserApproved → execution. This adopts the multichain design's written order over the current code (assertUserApproved runs first at src/mock-wallet-controller.ts:510/527), matches real MetaMask (4902 with no prompt shown), and is already the order eip5792's wallet_sendCalls specifies — so one rule covers both. Behavior change (deny-mode unknown-chain switch: 4001→4902) goes in the CHANGELOG with a pinning test.
3. RULING (event semantics): provider events fire only when the observable value changes — same-chain wallet_switchEthereumChain/switchNetwork emit no chainChanged; already-selected switchAccount emits no accountsChanged. setAccounts keeps its existing reconnect-and-emit behavior (src/mock-wallet-controller.ts:351-359) but the asymmetry vs switchAccount is pinned in docs/API.md and a test, per the multiaccount review.
4. RULING (one chain registry): multichain's chainBackends map IS eip5792's backedChainIds and IS the clientForChain seam — eip5792 must not create a private parallel set. backedChainIds is one public readonly Hex[] getter; every chain-id key everywhere (registry, knownChainIds, SentTransactionRecord.chainId, CallsBatchRecord.chainId, getCapabilities keys, eip155:N parsing in walletconnect) is canonical lowercase minimal hex produced by the rewritten normalizeChainId.
5. RULING (error-class convention): providerError(code) is reserved for errors that cross the page/WC bridge; test-side misconfiguration throws plain Error (multiaccount validation, fixture misuse, real-wallet failures); chain-side helpers may subclass Error for structured fields (Erc20DealError) but never mint provider codes — deal/deploy are cheatcodes outside the wallet. Revert matchers rethrow wallet 4001/4100 with a 'wallet approval failure, not a chain revert' hint, never swallow.
6. RULING (fixture option layering): fixture defaults → fixture-computed values (extras chains map, resolved accounts) → user walletOptions spread LAST and winning, matching existing src/fixtures.ts:101-107. walletOptions.chains merges as { ...fixtureExtras, ...userChains } (user wins per key; running extra Anvils are never silently orphaned — documented). createUser inherits the test's walletOptions as its base layer under per-call overrides; accounts/accountIndexes are owned by resolveAccounts and stripped before spreading into MockWalletControllerOptions.
7. RULING (snapshot ownership): _chainIsolation (test-scoped, memoized) is the single snapshot/revert owner and it snapshots/reverts EVERY ChainController in the chains map; wallet and createUser both depend on it. The multichain design's 'wallet fixture snapshots every controller' is superseded — implementing it there and moving it in Phase 2 would churn fixtures.ts twice.
8. RULING (account validation naming/semantics): the probe is assertAccountsKnownToNode (membership in node eth_accounts = sendable, NOT signable — anvil lists impersonated accounts), re-probes on miss instead of caching forever, and fails open on probe throw/timeout/empty-from-remote. The constructor-wide allowUnsignableAccounts option is dropped; a single per-call escape hatch remains for non-probing custom RpcClients. Documented separately: impersonated accounts pass validation but personal_sign/typed-data still fail node-side with -32602.
9. RULING (from-account enforcement): from ∈ currentAccounts (case-insensitive) → providerError(4100) applies to BOTH eth_sendTransaction and wallet_sendCalls, shipped together in 0.3.0 so consumers face one migration, not two breaking releases.
10. RULING (eip5792 defaults): mock fixtures default eip5792 enabled with atomic:'supported' (the library's MetaMask-faithful convention — 2026 MetaMask advertises it); live-fixtures default eip5792 DISABLED entirely (consistent with live mode's deny-by-default conservatism and capping the bare-approveNext blast radius at one real transaction), overridable via walletOptions. This resolves the design's open question and replaces its atomic:'unsupported' live default.
11. RULING (WC gating identity): WalletConnect session proposals gate as a synthetic eth_requestAccounts dispatch (reuses APPROVAL_GATED_METHODS, approveNext match callbacks receive the proposal payload for targeting) — no new method id. Origin scoping is enforced for real via handleExternalRequest(request, { origin }) → assertOriginAllowed with a documented opt-out, so the live-mode allowedOrigins claim becomes true instead of being stricken.
12. RULING (export surface): every new module gets a './name' subpath (matchers, transactions, walletconnect, erc20) per the package.json convention; module-level values/types are also re-exported from src/index.ts (the existing idiom — index already re-exports real-wallet-cache, which has no subpath). Fixture-scoped types stay on their fixture subpaths ONLY (index.ts exports zero fixture types today): UserSession/CreateUserOptions/CreateUser export from /fixtures, not root — overruling the multiaccount design's index.ts plan. realwallet's waitForExtensionStatePersisted and RealWalletToken must be added to index.ts; matchers' pure helpers (normalizePrivateKey etc. analogues) stay unexported-internal since tests import from ../src directly.
13. RULING (env gating + naming): WEB3_TESTER_WC_PROJECT_ID approved, mirroring WEB3_TESTER_REAL_WALLET_SMOKE; all non-hermetic suites live in the library project with self-skip guards and never gate CI. Synpress-parity names win on the real-wallet surface (switchAccount/addNewAccount/importWalletFromPrivateKey/resetAccount/lock/unlock), with aliases only where Synpress's name is unclear (addNewToken → approveAddToken). Mock-side switchAccount(address) vs real-side switchAccount(nameOrAddress) coexist — different surfaces, documented difference.
14. RULING (port bands): primary (ANVIL_PORT ?? 8645) + workerIndex; fixture extras at +1000 + workerIndex*20 + index with the workerIndex<1000 bound stated (not 'cannot collide'); spec-managed anvils use base + workerIndex*20 + subOffset with unique sub-offsets registered in a comment table next to workerPort (anvil.spec 0-3, private-key-rpc-client 10-12, multichain specs 13+) — matching the in-repo convention the review identified.

## Shared infrastructure (build once)

- Canonical chain-id helpers in mock-wallet-controller.ts (or a small shared module): normalizeChainId via toHex(BigInt(...)) plus parse wrappers that throw providerError(-32602) for dapp params and plain Error for constructor/config input. Consumers: multichain routing keys, eip5792 5710/getCapabilities keys, walletconnect eip155:N chainIds, fixtures duplicate-chain guards. BigInt('garbage') throws SyntaxError — wrapping must be explicit code.
- chainBackends registry + clientForChain(chainId)/activeRpcClient + public backedChainIds + the 4901 constant on MockWalletController — the single seam multichain (routing), eip5792 (batch execution + capability advertisement), and walletconnect (per-chain session_request dispatch) all route through. Build in Phase 1, never duplicated.
- handleExternalRequest(request, context?: { origin }) threading assertOriginAllowed (today only the exposeBinding handler enforces origins, src/mock-wallet-controller.ts:231-247) + onProviderEvent(listener) with fire-and-forget node-side dispatch. Built in Phase 1 for walletconnect; also the integration point for any future non-injected transport.
- Controller promise-chain mutex serializing forwarded sends and snapshot-scoped batch execution — required by eip5792's evm_snapshot/evm_revert window (exposeBinding handlers run concurrently), and protects multichain switch+forward interleavings. A few lines; shared, not per-feature.
- Bounded RPC probe utility (AbortSignal.timeout / Promise.race wrapper) — multichain's trustDappRpcUrls eth_chainId probe (5s), multiaccount's eth_accounts node probe (2-3s, fail-open on timeout since custom RpcClients may hang rather than throw). Note: AnvilInstance.reportedChainId is private and timeout-less — this is new code, not reuse.
- _chainIsolation fixture + resolveAccounts helper in fixtures.ts — single snapshot/revert owner spanning the chains map, shared by wallet, createUser, and any future fixture that mutates chain state; createUser/wallet take rpcClient+chainId from the identical fixture inputs (no second source of truth).
- src/transactions.ts decoding layer (ReadClient structural type, waitForDecodedTransaction, extractRevertInfo, bigint-aware stringify/equality) — consumed by matchers, ChainController.waitForTransaction, eip5792's getCallsStatus receipt fetch + spec-field projection, and the real-wallet smoke's tx-hash cross-check via chain.client.
- PrivateKeyRpcClient additions coordinated as one file-owner bundle: public client getter (matchers), local eth_accounts case (multiaccount — atomic with the probe), authorizationList hex→number mapping + signAuthorization (7702). Three tracks touch this file; one owner avoids three conflicting PRs.
- One contracts pipeline: contracts/*.sol + contracts/foundry.toml (pinned solc, bytecode_hash none, cbor_metadata false) + scripts/build-contracts.mjs emitting committed src/contracts/*.ts and tests/contracts/fixtures.ts, with a NON-optional CI recompile gate mirroring the dist gate. deal-helpers' TestERC20/VyperLayoutToken/SharesToken and matchers' Emitter/Reverter token fixtures all come from this generator — matchers' MiniToken should simply BE TestERC20, not a second artifact path.
- Test scaffolding shared across specs: a counting/recording RpcClient wrapper (deal-helpers cache assertions, multichain routing assertions, multiaccount probe-traffic assertions) and the documented port-band sub-offset table next to workerPort in fixtures.ts.
- Release machinery used once: consolidated 0.3.0 CHANGELOG behavior-change list, playwright.config testMatch union (explicit allowlist — every new spec must be added or it silently never runs), rebase-then-rebuild dist discipline against the CI freshness gate.

## Total effort

~37–44 focused engineer-days total: Phase 1 (substrate + multichain) ~5d; Phase 2 (multiaccount) ~2.5–3d; eip5792-7702 ~5–6d (design's 4–5d + the review's +0.5–1d for the receipt-status rework and mutex); matchers ~5.5–6.5d (5–6d + 0.5d verification pass since it skipped adversarial review); deal-helpers ~3.5d (stateDiff-override rework roughly nets out against deleted restore machinery); walletconnect ~5–6d; realwallet-surface ~9–12d; plus ~2–3d cross-feature integration (anvil.ts/private-key-rpc-client.ts merge coordination, docs/API.md + CHANGELOG consolidation, final dist + dual-version smoke runs). Critical path is substrate → multichain → multiaccount → walletconnect ≈ 13–15d; realwallet (9–12d, disjoint files) and tracks A–C parallelize inside that window, so two implementers land 0.3.0 in roughly 4–5 calendar weeks, three in 3–4 weeks. The dominant schedule risks are realwallet's dual-version smoke iteration latency and the breadth of eip5792's error-path matrix.

## Must fix before implementation

- eip5792-7702 (BLOCKER): rewrite the atomic execution loop to be receipt-status-checked — anvil 1.5.1 mines reverting eth_sendTransaction with status 0x0 (verified; no submission error without a gas field), so the designed 'submission failure → evm_revert' path never fires for the dominant failure mode. Fetch each call's receipt synchronously under automine, evm_revert on status 0x0 or submission error, adopt the corrected status taxonomy (400 = nothing landed; 500 = all reverted/rolled back, including a mined-0x0 single-call non-atomic batch; 600 = mixed), and state an explicit blockTime>0 posture. Also invert dependsOn: ['multichain'] — eip5792 introduces the clientForChain seam that multichain consumes (resolved by the Phase 1 ordering anyway).
- realwallet-surface (BLOCKER): the smoke test must not import anvil dev key #1 — 13.x multichain onboarding's SRP discovery derives that exact address from the same TEST_SEED (the repo's own smoke comment documents multi-account derivation), making importWalletFromPrivateKey throw the duplicate-account error. Import a random non-mnemonic key, fund via chain.setBalance, assert the address equals privateKeyToAccount(key).address. Additionally fix the expectedAddress staleness contract (getAccountAddress's fast-path at src/real-wallet.ts:902/560-571 returns stale results after switchAccount/import — and every customize hook runs in exactly that state) before writing the account methods.
- multiaccount: replace the lazy-once 'assertAccountsSignable' model with re-probe-on-miss 'known-to-node' semantics — anvil's eth_accounts includes impersonated accounts (foundry #5734), so the designed fail-fast error text, the allowUnsignable-required whale flow, and planned test (d) are all wrong as written. PrivateKeyRpcClient's local eth_accounts case MUST ship atomically with the injectMockProvider probe, or npm test performs a real Sepolia call via tests/live-fixtures.spec.ts (hermeticity violation masked by fail-open).
- multichain: resolve the wallet_switchEthereumChain ordering self-contradiction by adopting validate→4902→approve (ruling 2) with the deny-mode 4902 test and CHANGELOG note; drop the false 'bit-identical single-chain' regression claim and the goal text 'switching to an unbacked chain fails loudly 4901' (the switch succeeds, forwards fail); extras fixtures must spread { ...anvilOptions, ...spec } or ANVIL_RUNTIME=docker / tools-foundry setups break; fix the spec port band to unused sub-offsets; reframe the EIP-3085 claim ('only chainId is required' is wrong — the spec mandates rpcUrls rejection) and adopt rpcUrls-shape validation per ruling.
- walletconnect: use the real sign-client API names respond({ topic, response }) and disconnect({ topic, reason }) — respondSessionRequest/disconnectSession are walletkit names that don't exist on SignClient; init with signConfig: { disableRequestQueue: true } or holdNextRequest silently starves every subsequent WC request (the hermetic suite is structurally blind to this); thread origin enforcement through handleExternalRequest context per ruling 11 (the design's allowedOrigins claim is currently false); fix the per-event removeAllListeners typing; add the session_authenticate never-subscribe invariant (One-Click Auth fallback) as explicit code + docs, not an accident.
- deal-helpers: resolve the step-5 vs risk-2 contradiction as restore→evict→rediscover-once on verification mismatch (the written throw path leaves pad32(amount) at a wrong slot), and treat cache-by-address as unsound across snapshot/revert (nonce reset reuses CREATE addresses) — cache hits must be verified with the same fallback. Switch discovery to eth_call stateDiff state-overrides (verified working on anvil 1.5.1, plain and fork) so probe writes never touch persistent state; convert setStorageAt bigint slots via toHex(slot, { size: 32 }) (viem takes number | Hash); make the CI artifact gate non-optional since risk 1's mitigation depends on it.
- matchers: ~~it is the only design that received NO adversarial review~~ — the sequencer wrote this before the verification was re-run standalone (2026-06-10, see the matchers Adversarial review section above). Outcome: needs-revision — respecify wallet-rejection detection (the EIP-1193 `code` does not survive page.evaluate error serialization; detect via message/envelope, and embed the code in the message in serializeRpcError), render undecodable logs by diffing receipt.logs against parseEventLogs output, use the shared contracts/ TestERC20 artifact, prefer debug_traceTransaction for mined-revert reasons, pin .not/args semantics and the 5s-vs-15s timeout mismatch, and add a 20-byte address check to toHaveTokenBalance. All repo symbol/line citations and the Playwright 1.56 type-machinery floor were verified accurate.
- Cross-cutting gate: the consistency rulings that change shared semantics (registry unification, _chainIsolation ownership, validation-before-approval ordering, canonical hex chain ids, live eip5792-off default, fixture option layering) must be agreed and reflected in each design BEFORE any controller PR opens — four features edit mock-wallet-controller.ts and two rewrite fixtures.ts, and divergence here is the largest integration risk in the plan.
