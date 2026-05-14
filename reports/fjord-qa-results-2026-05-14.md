# Fjord Foundry QA Results

Date: 2026-05-14
Target: https://v4.fjordfoundry.com
Plan: Fjord Foundry Manual QA Testing Plan v2.0, dated 2026-03-20
Wallet: provided Sepolia wallet, referenced only by shortened address in test output

Current line-by-line status: 97 PASS, 8 FAIL, 5 PARTIAL, 85 BLOCKED, 75 NOT RUN, 1 N/A.

## Automated Coverage Added

- Public unauthenticated homepage checks from Chapter 1 and Chapter 2.
- Public search checks from Chapter 2.
- Live & Upcoming card view plus pool status, sale type, chain, and combined filter checks.
- Staking read-only/empty-state checks.
- Public curation and launch-partner gated route checks.
- Injected-wallet smoke checks against Fjord.
- Live Sepolia wallet checks using a runtime-only private key environment variable.
- SIWE authentication on Sepolia.
- Sepolia sale-detail route navigation.
- Authenticated profile route checks.
- Mobile wallet connection and mobile sale-detail checks.
- Provider-disconnect edge-case check.
- Provider network-switching check.
- Wallet selector connection and rejected account-access checks with the injected MetaMask provider.
- Sepolia token deployment modal access and pre-transaction field entry checks.
- Live Sepolia token deployment and contract verification.
- Live fixed-price sale creation fields, WETH collateral selection, named draft save, Step 3 transition, and publish attempts.
- Admin read-only route access checks for the provided wallet.
- Admin cache mutation probe.
- Live Sepolia sale purchase path with WETH collateral.

## Commands Run

```powershell
npm run typecheck
npm test -- --reporter=list tests/provider-injection.spec.ts tests/fjord.spec.ts
npm test -- --reporter=list tests/fjord-public.spec.ts
$env:FJORD_PRIVATE_KEY = '<redacted>'
npm test -- --reporter=list tests/fjord-partials-live.spec.ts
npm test -- --reporter=list tests/fjord-wallet-connect-edge.spec.ts
npm test -- --reporter=list tests/fjord-token-deployment-readonly.spec.ts
npm test -- --reporter=list tests/fjord-live-sepolia.spec.ts
$env:FJORD_RUN_TRANSACTIONS = 'true'
npm test -- --reporter=list tests/fjord-live-transaction.spec.ts
$env:FJORD_MUTATE_STATE = 'true'
npm test -- --reporter=list tests/fjord-live-mutations.spec.ts --grep "deploys"
npm test -- --reporter=list tests/fjord-live-mutations.spec.ts --grep "fixed-price"
$env:FJORD_PUBLISH_SALES = 'true'
npm test -- --reporter=list tests/fjord-live-mutations.spec.ts --grep "fixed-price"
$env:FJORD_ADMIN_MUTATE = 'true'
npm test -- --reporter=list tests/fjord-admin-mutations.spec.ts
```

## Passing Results

- TypeScript typecheck passed.
- Provider/Fjord smoke suite passed: 4 passed.
- Live Sepolia suite passed serially: 5 passed.
- Public unauthenticated homepage passed.
- Public partials suite passed: 5 passed.
- Wallet-backed partials suite passed: 4 passed.
- Wallet connect edge suite passed: 2 passed.
- Token deployment read-only suite passed: 1 passed.
- Fjord detected the live Sepolia injected wallet.
- SIWE completed successfully after fixing `personal_sign` parameter-order handling.
- Sepolia sale detail opened from the gallery.
- Profile participation/connections routes loaded after authentication.
- Card view and gallery filters passed:
  - Status: `Live`, `Coming`, `All`
  - Sale type: `LBP` for the Price Discovery row, `Fixed` for the Fixed Price row
  - Chain: `Sepolia`, `Polygon`
  - Combined filters: `Live` + `Fixed` + `Polygon`
- Staking hydrated after the initial loading state and showed metrics, BUY FJO, staking amount input, disabled deposit/NFT/withdraw controls, My Positions rewards/claim controls, and Airdrops wallet-required empty state.
- `/apply-for-curation` and `/become-launch-partner` showed their expected sign-in gates.
- Mobile viewport showed the connected Sepolia wallet, completed SIWE, and rendered the Sepolia sale detail.
- Provider-level disconnect emitted mid-session returned Fjord to the Connect Wallet state.
- Provider-level `chainChanged` updated the connected wallet display from Sepolia to Polygon and back to Sepolia.
- Connect Wallet opened Fjord's wallet selector, displayed the injected MetaMask provider, and connected successfully when account access was approved.
- Rejected provider account access kept Fjord disconnected.
- Full Launch Step 2 on Sepolia opened the Deploy a token modal; Symbol, Name, Total Supply, and Decimals accepted valid input before any deploy transaction was submitted.
- Live ERC-20 deployment succeeded through Fjord's Sepolia modal:
  - Token: `0xC981EA8597122A248F2b04Dea1387D16E5027d7f`
  - Deploy tx: `0x2bb9ec56f977d2688ed02876fff195d33378157093a56c05c7288bcc7db2c622`
- Fixed-price creation reached review and saved a named draft:
  - Review-token artifact: `0x3839004b31Aa1A81f2ac3a6A866E86235D66eec3`
  - Deploy tx: `0x092fe30052da1b3f3015295c5f7766d5efd31b3ceb81a8a9d91d130e65d5a8fe`
- Broad admin route smoke checks did not show `unauthorized` / `forbidden` / `access denied` strings for the provided wallet, but the stricter cache mutation probe later found a backend 401 data-load failure on `/admin/cache`:
  - `/admin/pools`
  - `/admin/applications`
  - `/admin/users`
  - `/admin/curators`
  - `/admin/spotlights`
  - `/admin/pool-order`
  - `/admin/presales`
  - `/admin/analytics`
  - `/admin/cache`
  - `/admin/faucet`
  - `/admin/audit`
- The active Sepolia sale uses WETH collateral, not native ETH:
  - Input asset: Wrapped Ether (`WETH`) at `0xf531B8F309Be94191af87605CfBf600D71C2cFe0`
  - Output/share asset: `M18ERC20` at `0x3d7DEF435b2038858B6792454e0cdaA480866725`
- The wallet had Sepolia ETH but initially had `0 WETH`, explaining the sale card's `Balance 0` display.
- Wrapped `0.05` Sepolia ETH into WETH successfully:
  - Transaction: `0x2ecbaae8e1b3641e7af21efba7c0813e765e4b21aad1f2db96dce739cdec7fcb`
- Submitted WETH approval successfully:
  - Transaction: `0x367b565b5b0cc6f263146ea5577c083cb70c30b96dd818dd92e66d26999a5d28`
  - Decoded call: `approve(0xb25900DEd088ecCf13a3Ca79E1316914eD9De3A6, 0.001 WETH)`
- Submitted Sepolia sale swap successfully:
  - Transaction: `0xff4b340ad49b4bcf78de42143260f7c5c6d066888ec05dd87e7b1b62bce57b3c`
  - Receipt status: `success`
  - Destination: `0xb25900DEd088ecCf13a3Ca79E1316914eD9De3A6`
  - WETH balance changed from `0.05` to `0.049`

## Failed Findings

- Partner dashboard authorization/nav mismatch: the signed-in provided Admin wallet sees a `Partners Dashboard` tab, but `/profile/partners-dashboard` returns `Unable to load the partner dashboard` with `{"message":"Unauthorized"}`.
- ERC-20 token deployment Symbol field does not enforce the documented max 6 characters before submit. `QATESTLONG` was accepted in the Symbol input.
- ERC-20 token deployment supply handling is likely wrong for 18-decimal tokens: entering `1000000` minted raw `1000000`, formatted as `0.000000000001`.
- Fixed-price Review step did not show the documented full sale summary; it only showed Terms & Conditions and Create & Publish Pool.
- Fixed-price publish submitted approval but did not proceed to pool creation:
  - QA token: `0x2c24a56aF95dC1ccBd5414fa158767dA5649870f`
  - Deploy tx: `0xc8495daf0801188141aa6927dd95d43610d26bbf3879a244f787fd72030fa0ee`
  - Approval tx: `0x87e4f54e887a1a0fc431f74f17bf3aebf377bbe147cc09ebda193970c5e45abb`
- Named QA drafts showed `Draft Created!` but were not discoverable in the resume-draft dialog.
- `/admin/cache` mutation attempt failed before purge: `Unable to load admin data` with backend 401 from `/api/auth/admin/curators`.

Earlier search failures were due to not opening `Sort And Filter`; the Live & Upcoming search input is mounted there and passes matching, no-results, and clear-search checks.

## Blocked Or Not Executed

The plan contains 271 checks. The following areas remain blocked or not fully executed:

- Steps that mention Mainnet are interpreted as Sepolia per user instruction; remaining unexecuted items require specific Sepolia staking/application/role state, successful sale publish, or additional role/social accounts.
- Separate Wallet B/C/D role matrix checks. Only one provided wallet was available; it appears to have Admin access.
- Discord, Telegram, and Twitter/X OAuth linking.
- Destructive admin mutations such as approving/rejecting applications, curator actions, spotlights, pool ordering, or faucet changes.
- Sale editing, published-sale gallery verification, and curation submission flows are blocked by the fixed-price publish failure or missing role/social prerequisites.
- Remaining transactional participation variants, staking deposit/claim/unstake, and sale creation/deployment/editing flows.
- Mobile sale creation/admin/notification/profile checks not yet covered.
- Network throttling and real browser-extension-specific MetaMask edge cases from Appendix B.

## Notes

- Live Sepolia tests are intentionally serial. Running multiple SIWE requests in parallel with the same wallet can race the backend nonce and produce invalid/expired nonce errors.
- The private key was not committed to the repo. Tests consume it only through `FJORD_PRIVATE_KEY`.
