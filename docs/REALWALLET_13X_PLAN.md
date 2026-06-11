# MetaMask 13.x speedup + usability plan — 2026-06-10

How to make the real-wallet 13.x path fast and fully usable: version-aware selector
dispatch, dead-sleep removal, headless modernization, and stabilizing the 0.3.0 surface
methods that ship `test.fixme`'d. Produced by a 9-agent workflow (4 grounded analyses +
adversarial verification + synthesis); every analysis is verified against the actual code and
the shipped 12.23.1/13.34.1 bundles.

## The honest cost picture (a key correction)

The "126 call sites × 2s" framing is **overstated**. `findVisibleLocator` only pays
`min(250ms, remaining)` per *absent* locator, and most fallback stacks contain selectors
present in **both** generations — so a leading wrong-gen entry usually costs one 250ms probe,
not 2s. The real tax concentrates in:

- **Single-locator wrong-gen stacks that spin to the full timeout** — the biggest is
  `importWalletFromPrivateKey`'s wrong wallet-type selector, which dead-probes the **full 30s**
  (`DEFAULT_TIMEOUT_MS`) per import; `getAccountAddress`'s 12.x-only `app-header-copy-button`
  costs ~2s on **every call and every launch** (it runs in `prepareMetaMask`); `addNewAccount`
  and `resetAccount` each pay ~2s on a 12.x-only leading probe.
- **Compounded modal-animation probes** — the Custom-tab methods (`addNetwork`,
  `toggleShowTestNetworks`) re-probe dead leading locators each animation spin (~1-3s).

So the headline wins are: kill the 30s import dead-probe (FIX 1), short-circuit the handful of
12.x-only single-locator spinners on 13.x, and reorder the animating stacks.

## End state

A full 13.34.1 surface smoke run (currently: 1 passing "full journey" test + 2 test.fixme'd blocks) goes GREEN with the fixme'd surface and customize-persistence tests un-fixme'd and split into ~6 focused tests. Honest speed picture: the dominant win is removing dead-12.x-selector probes on 13.x via version-aware dispatch — concentrated in ~6-8 hot methods at ~2s each (getAccountAddress when its expectedAddress fast-path misses, importWalletFromPrivateKey which today pays a FULL 30s dead-probe, addNewAccount, resetAccount ~4s, plus 1-3s on the animating Custom-tab network methods). FIX 1 alone (importWalletFromPrivateKey selector) removes a 30s timeout per private-key import. Secondary levers: lean clone saves ~110ms/test (measured warm: 165ms→52ms, 95MB→19MB), and removing the two 3s IndexedDB cold-build dwells saves ~3-4s per cold profile build (replaced by the existing state-based poll). Headless boot is NOT a speed win (measured: warm headed and warm channel:chromium-headless boots are statistically identical ~650-750ms) — it is a CI/container-portability win. Realistic headline: the previously-30s-blocked private-key import becomes instant; per-method 13.x interactions shed ~2s each on the hot paths; a representative surface smoke run drops from roughly ~5-6min to ~3.5-4.5min once the un-fixme'd methods run, with the single biggest absolute saving being the eliminated 30s import timeout and ~8-14s of dead-probe time across the fixme'd surface methods once they execute live. 12.x stays a first-class fallback (reorder-not-filter); hermetic CI, LavaMoat, and the dist freshness gate are untouched.

## Phases

### Phase 0 — Lean clone (ship independently, first, zero conditions)

*Effort: 0.25 (a few hours + one re-verify smoke run)*

- In cloneWalletProfile (src/real-wallet-cache.ts:260) add a fs.cpSync filter that prunes regenerable Chromium cache subtrees BEFORE copy. Define SKIP_CLONE_DIRS = Set{'Service Worker','Code Cache','Cache','GPUCache','GraphiteDawnCache','ShaderCache','GrShaderCache','DawnWebGPUCache','DawnGraphiteCache','component_crx_cache','extensions_crx_cache'} next to SINGLETON_FILES (line 18). Filter returns false for a dir whose basename is in the set (Node fs.cpSync prunes the whole subtree when the filter returns false for a directory, verified Node v23.4.0).
- KEEP the existing post-copy deletion of READY_MARKER + SINGLETON_FILES (line 262) — the pre-copy filter and post-copy delete coexist.
- Do NOT skip 'Local Extension Settings' (the MetaMask vault, ~16MB) or 'IndexedDB' (13.x debounced state, ~1MB) — those must survive.
- Re-run the env-gated smoke once on 13.34.1 to confirm the cloned profile still resolves expectedAddress (a vault-less clone fails the build's address check, so this is self-verifying).

*Rationale:* This is the ONLY unconditional, already-measured win with zero coupling to any other change. Version-agnostic, 12.x-safe, LavaMoat-safe, no new deps. Shipping it first banks a guaranteed ~110ms/test and ~75% less disk churn while the riskier changes are validated. Use the HONEST measured numbers (~110ms, not the analysis's inflated ~280ms).

### Phase 1 — Version-aware dispatch (the foundation everything builds on)

*Effort: 1.5-2.5*

- Thread the generation into the wallet. In launchRealWallet (src/real-wallet.ts:2222) compute `const generation = Number(extensionManifestVersion(options.extensionPath).split('.')[0]) >= 13 ? '13x' : '12x'` (extensionManifestVersion is already imported and used for the cache key at src/real-wallet-cache.ts:119 — free at launch, no DOM probe). Pass it into the single constructor site (src/real-wallet.ts:2240); MetaMaskRealWallet is constructed at exactly one place and is not exported, so this is a safe single-site signature change. Add `private readonly generation: '12x'|'13x'` (default '13x', the shipped version).
- Adopt the ANNOTATED-STACK approach (not per-method version branches, not pure reorder). Introduce `type GenLocator = Locator | { gen: '12x'|'13x'|'both'; loc: Locator }`. A plain Locator is treated as 'both' so the ~110 untouched call sites compile and behave identically with zero edits (Locator[] is assignable to readonly GenLocator[]).
- Change findVisibleLocator/clickFirstVisible/fillFirstVisible to accept readonly GenLocator[] plus the active generation. A normalizer orders entries [active-gen + 'both'] first, ['other-gen'] last as a trailing SAFETY NET (never filtered out), and probes the other-gen tail at a reduced OTHER_GEN_PROBE_MS = 250ms (= existing LOCATOR_PROBE_MS, not lower). Bare-Locator order among 'both' entries is preserved exactly.
- Inject the instance generation via thin private method wrappers (this.clickFirst([...]) calling the free function with this.generation) so call sites inside methods don't repeat the gen arg. Free functions and wrappers coexist; only hot methods migrate.
- Annotate ONLY the ~6-8 verified gen-divergent stacks and short-circuit the single-locator wrong-gen spinners: tag app-header-copy-button (line 997, 12x-only) gen:'12x' so on 13.x it probes once at 250ms instead of spinning SHORT_TIMEOUT_MS=2s before openAccountDetailsModal; tag multichain-account-menu-popover-action-button (lines 1342, 1412, 12x-only) the same; tag advanced-setting-reset-account (lines 1538/1558/1613, 12x-only) the same.
- Do NOT tag the importWalletFromPrivateKey wallet-type stack by generation — choose-wallet-type-private-key greps ABSENT in BOTH bundles (runtime-built testid), so a grep-based gen tag would be unsafe. That stack is fixed by FIX 1 in Phase 3, not by tagging.
- Do NOT globally reduce DEFAULT_TIMEOUT_MS/SHORT_TIMEOUT_MS — they bound legitimate slow-render/animation waits. Savings come from eliminating dead probes, not shrinking real budgets.
- Add a focused unit test on the normalizer (bare-Locator back-compat order preserved; active-gen first; other-gen present as tail) so a subtle ordering bug can't silently regress all 126 sites.

*Rationale:* This is the systemic time tax and the architectural foundation: surface-stabilization's selector fixes and the sleeps work compose with it but it must land first so they build on a generation-aware substrate. The reframe is honest — findVisibleLocator already costs only min(250ms, remaining) per ABSENT locator, so the dominant tax is the handful of single-locator wrong-gen stacks that spin to full timeout (and the compounded modal-animation probes), not 126×2s. Reorder-not-filter keeps 12.x first-class and survives version mis-detection.

### Phase 2 — Kill the cold-build IndexedDB dwells (sleeps)

*Effort: 0.5-1*

- Customize flush (src/real-wallet-cache.ts:223-226): DELETE the unconditional `await sleep(3_000)` and rely solely on waitForExtensionStatePersisted with `{ since: mutationsStartedAt, quietMs, timeoutMs: 20_000 }`. The poll already waits for a write newer than `since` to land AND stay quiet for quietMs — the separate 3s dwell is redundant.
- Onboarding dwell (src/real-wallet.ts:848): replace `await page.waitForTimeout(3_000)` with a short ~500ms load-bearing dwell, and move the real flush guarantee to buildWalletProfile (real-wallet-cache.ts) which already has profileDir + session.extensionId. Capture `const onboardStartedAt = Date.now()` immediately before launchRealWallet, then waitForExtensionStatePersisted({ since: onboardStartedAt, quietMs, timeoutMs: 15_000 }) before close — same pattern the customize path uses.
- Set quietMs to the EXISTING default 1500ms (500ms margin above the verified 1000ms debounce), NOT 1200ms. Only tighten to 1200 if a live cold-build+clone+relaunch+getAccountAddress assert proves it holds.
- Custom-tab waits (src/real-wallet.ts:1135 and 1643 — exactly TWO sites; switchNetwork at 1262 has NO band-aid wait): drop the bare wait(300) and rely on clickFirstVisible's findVisibleLocator probe + Playwright actionability (stable-bounding-box check waits out the slide-in). Guard with assert-tab-visible and cap any retained dwell at ~150ms if a flake surfaces. No-op on 12.x (no Custom tab).
- LEAVE as-is (bounded poll ticks / load-bearing input pacing, not unconditional dwells): real-wallet.ts:215, 285, 343, 961, 1764, 1837 and real-wallet-cache.ts:106, 181.
- Fix the debounce attribution in any code comment to the correct v13.34.1 source: the 1000ms debounce lives in app/scripts/lib/safe-reload.ts (OperationSafener, lodash trailing-edge, wait:1000, no maxWait) wrapping persistenceManager.set() — NOT in persistence-manager.ts and NOT a storeAsStream pipeline (that's the develop branch).

*Rationale:* Secondary lever — these are cold-build-path dwells amortized to ~0 across a warm run, but they make the build snappier and remove the conspicuous 3s+3s IndexedDB guesses. Lands after version-dispatch because the Custom-tab readiness becomes cleaner once the dead-selector probing is gone, and the two changes both touch findVisibleLocator-adjacent code (coordinate OTHER_GEN_PROBE_MS so they don't conflict). The load-bearing validation is a real cold-build+clone+relaunch assert (failure mode is silent onboarding replay).

### Phase 3 — Surface stabilization: selector fixes + un-fixme

*Effort: 1.5-2.5*

- FIX 1 (blocks the most; removes a 30s dead-probe per private-key import): in importWalletFromPrivateKey (src/real-wallet.ts:1359-1369) replace the wallet-type stack [choose-wallet-type-private-key, wallet-type-private-key, getByText(/Private key|Import account/)] with [testId('choose-wallet-type-import-account'), getByRole('button',{name:/Import an account/i})], keeping #private-key-box + import-account-confirm-button. The import-account page defaults to Private Key (#private-key-box renders with autoFocus), so no dropdown interaction is needed — but VERIFY headed once that it never defaults to JSON.
- FIX 2 (near-zero-risk consistency fix): in renameAccountRow (src/real-wallet.ts:1911) put page.locator(testId('multichain-account-menu-item-rename')) FIRST, keeping role/text as fallbacks. Precedent already in code at lines 1092/1095 (multichain-account-menu-item-addresses / -accountDetails). The current .multichain-account-cell-menu-item[aria-label="Rename"] fails because no aria-label is set, not because the class is wrong.
- FIX 3 (new-row targeting): in addNewAccount (src/real-wallet.ts:1446-1460) after add-multichain-account-button, capture accountRowLocator(page).count() before the click and wait for it to increment, then target the newly-appeared cell — do NOT use .last() (unreliable in a virtualized multichain tree) and prefer count-increment over 'Account N' name-matching (ambiguous if several exist).
- Harden openAccountPicker (src/real-wallet.ts:~1881) to wait for the virtualized list to stop growing before a scroll, or retry scroll+click in importWalletFromPrivateKey/addNewAccount.
- Split the monolithic fixme'd test (tests/real-wallet-smoke.spec.ts:148) into focused tests so one flake doesn't red the whole block, and un-fixme in value order: TIER A (after FIX 1+2): (1) addNewAccount+switchAccount+renameAccount; (2) lock+unlock+getAccountAddress; (3) importToken against a deployErc20; (4) confirmTransactionAndWaitForMining (already validated live); (5) approveAddToken/rejectAddToken; (6) resetAccount. TIER B (after FIX 3 + headed loop): addNewAccount(name) and importWalletFromPrivateKey run ~20x headed before declaring green.
- Un-fixme the customize-hook persistence test (tests/real-wallet-smoke.spec.ts:262) LAST — it depends on FIX 1 (imports a key during build) and FIX 3.
- KEEP toggleShowTestNetworks as an expected-rejection assertion (it is environment-gated: the toggle is conditionally rendered, force-ON+disabled when the active network is a testnet). Do NOT chase an enable-path assertion.
- resetAccount needs a small per-method tweak beyond tagging: on 13.x it pays ~4s (advanced-setting-reset-account 2s + a getByRole/class 'Advanced' tab probe at line ~1547 that is NOT grep-taggable). Short-circuit the second spin for 13.x explicitly (the tag in Phase 1 only kills the first 2s).

*Rationale:* These methods are fixme'd not because they're broken but because of ONE real selector bug (FIX 1, a 30s tax) and one fragile rename selector (FIX 2), plus virtualized-list/animation timing. With Phase 1's dispatch and Phase 2's timing fixes underneath, the selector corrections make ~7 of 11 methods reliably un-fixme-able on 13.34.1. Splitting the test isolates flakes. The customize-persistence test is the strongest regression trap for the debounced-flush bug class but is downstream of FIX 1 — fix that first or it stays red for the wrong reason.

### Phase 4 — Headless as opt-in (channel:chromium modernization)

*Effort: 1-1.5*

- In launchRealWallet (src/real-wallet.ts:2222-2232) switch from the conditional '--headless=new' arg injection + headless:false to the Playwright-blessed pattern: channel:'chromium' + headless: <resolved boolean>. Keep --load-extension / --disable-extensions-except. This makes headless trace/screenshots behave and is the official chrome-extensions form (the doc no longer mentions --headless=new).
- Add env resolution (net-new): headless OPT-IN via WEB3_TESTER_REAL_WALLET_HEADLESS==='true' (default OFF/headed initially). Thread the same resolution through buildWalletProfile (real-wallet-cache.ts) and the fixtures (real-wallet-fixtures.ts:90 and :103) so onboarding and per-test launch stay consistent.
- Add a channel-availability guard: fail fast with a clear message if the full chromium binary is absent when headless is requested (channel:'chromium' needs the FULL chromium-1217; an env with only chromium_headless_shell silently fails to load the extension).
- Fix the clipboard comment if touched: the COPY half is a MetaMask extension copy button using document.execCommand('copy') (app-header-copy-button 12.x / multichain-address-row-copy-button 13.x), only the PASTE is synthetic keyboard ControlOrMeta+v — NOT 'keyboard copy'. (execCommand copy + paste round-trips headless in all three modes, verified.)
- Do NOT flip the default to headless until the FULL-journey smoke (import + connect + confirmTransaction + txHash read through the forced notification.html) PASSES headless on BOTH 13.34.1 AND 12.23.1. Only the extension-load + clipboard round-trip + empty-notification-render are proven headless today; the real pending-confirmation render driven to completion is UNVERIFIED.
- After the full-journey headless smoke passes on both versions, optionally flip the default with a WEB3_TESTER_REAL_WALLET_HEADED debug escape hatch — this is a maintainer call.

*Rationale:* Re-framed as a CI/container-PORTABILITY win, not a speed win: warm headed and warm headless boots are statistically identical (~650-750ms; the analysis's '~2x faster headless' was a cold-vs-warm artifact). The dappwright ecosystem cited for 'headless is the industry direction' ALSO warns headless extension popup windows can hang — the mitigation (this driver force-opens notification.html instead of relying on the popup window) is exactly the unproven part, so the default flip is a HARD-GATED blocker, not a footnote. Lands last because it composes with surface-stabilization (timing can shift headless) and must be validated against the now-green surface methods.

## Architecture decisions

- Version-aware dispatch = ANNOTATED STACKS + generation flag (hybrid), NOT per-method version branches and NOT pure reordering. Justification: pure reordering is impossible without knowing which locator targets which gen (locators are plain Playwright Locators with no metadata today); per-method branches would duplicate ~126 call sites and double maintenance. Annotated stacks (type GenLocator = Locator | {gen,loc}) let the ~110 unchanged sites keep bare-Locator arrays (treated as 'both', assignable to readonly GenLocator[], zero edits) while only the ~6-8 genuinely divergent stacks get tagged. This extends the existing fallback-stack model by reordering + reduced tail budget rather than rewriting it.
- REORDER-AND-REDUCE-TAIL, NEVER FILTER. The other-generation entry stays as a trailing safety net probed at OTHER_GEN_PROBE_MS=250ms. This survives version mis-detection (future 14.x, custom builds) and keeps 12.x first-class — flipping which slice is 'active' is the only difference between the two versions.
- Generation is derived from extensionManifestVersion(options.extensionPath) at launch (already imported, already used for the cache key) — NO DOM probe, free at launch. Single insertion point: the one MetaMaskRealWallet construction site (src/real-wallet.ts:2240).
- Thin per-instance method wrappers (this.clickFirst) inject this.generation; free functions and wrappers COEXIST (only hot methods migrate) to avoid touching all 126 sites at once.
- Do NOT globally shrink DEFAULT_TIMEOUT_MS (30s) / SHORT_TIMEOUT_MS (2s). The savings come from eliminating DEAD probes, not from cutting the budget for the real wait — shrinking them risks flakiness on slow-rendering UI and animating modals (the surface-stabilization area depends on adequate budgets).
- Cold-build flush is proven by the existing state-based waitForExtensionStatePersisted mtime poll (preserve its since/quiet logic exactly), NOT by fixed dwells. Replace guesses with observed flushes.
- Lean clone uses an fs.cpSync pre-copy filter (prunes whole cache subtrees) and coexists with the existing post-copy singleton deletion; only well-known Chromium cache dirs are skipped — never Local Extension Settings / IndexedDB.
- Headless uses channel:'chromium' + headless:boolean (Playwright-blessed), replacing the older '--headless=new' arg injection.

## Sleeps to remove

- src/real-wallet-cache.ts:223 — DELETE the unconditional `await sleep(3_000)` in the customize-flush path; rely solely on waitForExtensionStatePersisted (since/quietMs poll already proves the flush). Saves ~3s+ per customized cold build.
- src/real-wallet.ts:848 — REPLACE `await page.waitForTimeout(3_000)` onboarding dwell with a short ~500ms dwell, moving the real flush guarantee to buildWalletProfile via waitForExtensionStatePersisted({ since: onboardStartedAt, quietMs:1500, timeoutMs:15000 }). Saves ~1.5-2s per cold profile build.
- src/real-wallet.ts:1135 — DROP `await wait(300)` before the addNetwork Custom tab; rely on Playwright actionability + clickFirstVisible probe (cap retained dwell at ~150ms only if a flake surfaces). No-op on 12.x.
- src/real-wallet.ts:1643 — DROP `await wait(300)` before the toggleShowTestNetworks Custom tab (same reasoning). These are the ONLY two wait(300) Custom-tab sites; switchNetwork at line 1262 has no such band-aid.
- Reduce customize quietMs from 3000ms to the existing default 1500ms (500ms margin above the verified 1000ms OperationSafener debounce), with timeoutMs=20000 as the backstop.

### Sleeps to keep (load-bearing)

- src/real-wallet.ts:215 (wait 250) and :285 (wait 100 per seed word) — load-bearing input pacing for MetaMask's seed-grid paste/advance handler; driving inputs too fast drops words. Onboarding-only, one-time, low ROI to change.
- src/real-wallet.ts:343 (wait 250 in closeMetaMaskOverlay) — bounded, conditional (only after a modal closed, capped 4 iterations, short-circuits if nothing closed).
- src/real-wallet.ts:961 (wait LOCATOR_PROBE_MS in confirmTransaction follow-up-window poll), :1764 (wait 250 in importToken metadata poll), :1837 (wait LOCATOR_PROBE_MS in confirmTransactionAndWaitForMining activity poll) — bounded inter-probe poll ticks inside while-loops that break the instant the condition holds; on instant-mining anvil they exit on the first/second tick. Converting to expect.poll is cosmetic churn with no measurable speedup.
- src/real-wallet-cache.ts:106 (sleep 250) — the poll interval of the already-state-based waitForExtensionStatePersisted.
- src/real-wallet-cache.ts:181 (sleep 250) — stale-lock poll tick, irrelevant to speed.

## Headless decision

Headless is an OPT-IN initially via WEB3_TESTER_REAL_WALLET_HEADLESS=true, default OFF (headed). Modernize the launch to channel:'chromium' + headless:boolean (replacing the '--headless=new' arg injection) because that is the Playwright-blessed form and makes headless trace/screenshots work — but do NOT borrow headless as a speed win: measured warm headed and warm channel:chromium-headless boots are statistically identical (~650-750ms); the analysis's '~2x faster' was a cold-vs-warm artifact. The case for headless is CI/container portability (no display server) and future-proofing. Flipping the default to headless is a HARD-GATED maintainer decision blocked on a full-journey smoke (import + connect + confirmTransaction + txHash read driven to completion through the forced notification.html) PASSING headless on BOTH 13.34.1 and 12.23.1 — today only extension-load + clipboard round-trip + an EMPTY notification render are proven headless, and the dappwright ecosystem explicitly warns headless extension popup windows can hang (the driver's force-open of notification.html is the mitigation but is the exact unproven part). Add a channel-availability guard that fails fast if only chromium_headless_shell is installed (the full chromium binary is required to load the extension). For CI: headless should be the eventual target once the full-journey smoke passes both versions, but the smoke stays env-gated (WEB3_TESTER_REAL_WALLET_SMOKE) and never gates hermetic CI regardless.

## Stabilization order

- PREREQUISITE: FIX 1 (importWalletFromPrivateKey selector — choose-wallet-type-import-account, removes a 30s dead-probe) and FIX 2 (renameAccount — multichain-account-menu-item-rename testid first) land before any un-fixme.
- TIER A (un-fixme after FIX 1+2, high confidence on 13.34.1, split into focused tests): (1) addNewAccount(no-name)+switchAccount+renameAccount; (2) lock+unlock+getAccountAddress; (3) importToken against a deployErc20; (4) confirmTransactionAndWaitForMining (already validated live); (5) approveAddToken/rejectAddToken; (6) resetAccount (with the extra 13.x second-spin short-circuit).
- TIER B (after FIX 3 new-row targeting + ~20x headed loop): addNewAccount(name) and importWalletFromPrivateKey — the two most flake-prone (virtualized-list scroll + import-keyring delay).
- LAST: customize-hook persistence test (depends on FIX 1 import + FIX 3 addNewAccount(name)) — un-fixme only after Tier B is green; it is the strongest regression trap for the debounced-flush bug class.
- KEEP AS-IS (do NOT un-fixme into an enable-path): toggleShowTestNetworks stays an expected-rejection assertion — the toggle is environment-gated (conditionally rendered, force-ON+disabled when the active network is a testnet).
- DUAL-VERSION MATRIX CALL: gate the green smoke on 13.34.1 ONLY; document 12.23.1 as best-effort. The two generations use structurally different DOM (12.x multichain-account-menu-popover-* / add-imported-account vs 13.x choose-wallet-type / add-multichain-account-button / account-list-add-wallet-button), already carried as the first fallback branch. Keep the 12.x arms in as reduced-budget fallbacks (Phase 1 preserves them), but do NOT block the un-fixme on re-validating 12.23.1 live — 13.34.1 is the default shipped version, and keeping both green doubles the slow live loop for little added coverage of the default.

## Total effort

6.25-9.5 days total. Phase 0 lean clone ~0.25d; Phase 1 version-aware dispatch 1.5-2.5d (the foundation); Phase 2 sleeps 0.5-1d; Phase 3 surface stabilization 1.5-2.5d; Phase 4 headless opt-in 1-1.5d. The single highest-ROI day is FIX 1 inside Phase 3 (removes a 30s per-import timeout) plus the Phase 1 short-circuits of the 12.x-only spinners. Phases 0 and 1 are the unconditional foundation; Phase 4's default-flip is gated on validation and can slip without blocking the rest.

## Maintainer decisions

- DUAL-VERSION MATRIX: confirm 13.34.1-only as the green smoke gate with 12.23.1 documented best-effort (recommended), versus keeping both versions green (doubles the slow live loop). The plan assumes 13.34.1-only. ## Agreed
- HEADLESS DEFAULT FLIP: after the full-journey headless smoke passes on BOTH 13.34.1 and 12.23.1, decide whether to flip the default to headless (with a WEB3_TESTER_REAL_WALLET_HEADED debug escape hatch) or keep headed default with headless opt-in. This is gated on the validation, not a code question. ## Force an explicit choice, no default.
- CI ENVIRONMENT: confirm CI that runs the opt-in smoke installs the FULL chromium binary (`npx playwright install chromium`), not just chromium_headless_shell — channel:'chromium' silently fails to load the extension on shell-only environments. ## I'll defer to your judgement here.
- quietMs TIGHTENING: accept the safer 1500ms (existing default, 500ms margin above the 1000ms debounce) as shipped, or authorize tightening to 1200ms only after a live cold-build+clone+relaunch+getAccountAddress assert proves it holds on the target CI hardware.
- toggleShowTestNetworks ENABLE-PATH: decide whether the expected-rejection contract is sufficient for release (recommended) or whether to add a dedicated 13.x-only test that configures an unusual-chain-id testnet to exercise the enable path. ## Add the 13.x dedicated test too.
- 12.x FALLBACK LIFESPAN: decide whether to keep the 12.23.1 fallback selectors indefinitely or remove them once 13.34.1 is the sole gated version (removing them cuts fallback-stack probe cost but drops 12.x support). ## Do not keep these fallbacks but also dont drop 12.x support -- we need to support both but not as "fallbacks" but instead as actual configuration options.
- RELEASE GUARD: because the un-fixme'd surface tests are env-gated and never gate CI, decide a process commitment to run the smoke loop on 13.34.1 before tagging a release (the dist freshness gate does not cover live behavior). ## I'll defer this decision to you - lets do this most idiomatically.
