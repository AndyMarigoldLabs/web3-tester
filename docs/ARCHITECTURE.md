# Architecture

Web3 Tester replaces extension automation with a programmable provider and deterministic chain control.

## Local Test Flow

1. Playwright creates a worker.
2. The worker fixture starts Anvil on a unique port.
3. The test fixture snapshots Anvil state with `evm_snapshot`.
4. `MockWalletController` exposes a Playwright function bridge.
5. `page.addInitScript` injects `window.ethereum` before dApp scripts load.
6. The dApp sends EIP-1193 requests to `window.ethereum.request`.
7. The injected provider forwards requests through the Playwright bridge.
8. The Node-side controller approves, rejects, emits events, or forwards RPC to Anvil.
9. The fixture reverts the chain with `evm_revert`.
10. The worker fixture stops Anvil after worker completion.

## Why This Avoids Synpress-Style Flakiness

No browser extension is installed. There is no extension popup, no wallet UI selector, no browser-extension process boundary, and no cached wallet profile. Tests exercise the dApp's wallet integration contract directly.

## Browser Injection

The injected provider implements the wallet behavior expected by most dApps:

- `window.ethereum`
- `request`
- `send`
- `sendAsync`
- `on`
- `once`
- `removeListener`
- `removeAllListeners`
- `_metamask.isUnlocked`
- EIP-6963 `announceProvider`

The injected script is installed with `page.addInitScript`, so it exists before the application bundle executes. It is also evaluated immediately for pages that have already loaded.

## RPC Boundary

Browser code cannot access Node objects directly. The harness uses a
context-level binding (so pages the dapp opens itself are covered) that
receives the calling frame, letting the controller enforce `allowedOrigins`
before any request is handled:

```ts
context.exposeBinding('__invisibleWalletRpcBridge', async ({ frame }, request) => {
  assertOriginAllowed(frame); // 4100 unless the frame's effective origin is allowed
  return handleRpcRequest(request); // serialized success/error envelope
});
```

The browser receives only a serialized success or error envelope. Provider-shaped errors are rehydrated in the browser with their original `code`, `message`, and optional `data`. When `allowedOrigins` is set, the injected provider also declines to install in out-of-scope frames, so blocked pages never even see `window.ethereum`; live fixtures default the allowlist to Playwright's `baseURL`.

## Chain Isolation

Local tests isolate state with both process and chain controls:

- One Anvil node per Playwright worker.
- One chain snapshot per `wallet` test.
- A revert after each `wallet` test.
- Unique worker ports derived from `ANVIL_PORT + workerIndex`.

This prevents nonce bleeding and lets Playwright run tests in parallel.

## Live Sepolia Mode

Live mode intentionally does not use Anvil snapshots. It uses a runtime-only private key through `PrivateKeyRpcClient` and sends real Sepolia transactions only when an explicit opt-in flag is set.

Live mutation specs should always:

- Check the required opt-in env var.
- Use unique QA names.
- Record transaction hashes.
- Avoid committing any private key.
- Continue to the next doc line after a product failure.

## Package Boundaries

Reusable package code lives in `src/`. Fjord-specific tests and reports live outside the package export surface:

- Exported: `src/*`
- Not exported: `tests/*`, `reports/*`, `tmp/*`, `tools/*`

The `files` field in `package.json` keeps install output focused on `dist`, `docs`, `examples`, `README.md`, and `.env.example`.
