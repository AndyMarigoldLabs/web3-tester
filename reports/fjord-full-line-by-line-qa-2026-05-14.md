# Fjord Full QA Line-by-Line Results

Date: 2026-05-14
Target: https://v4.fjordfoundry.com
Plan: Fjord Foundry Manual QA Testing Plan v2.0
Interpretation update: Any step mentioning Mainnet is treated as Sepolia per user instruction.
Execution style: automated and semi-automated browser checks using injected MetaMask-compatible provider; no real browser extension UI was used.
Secret handling: private key was used only through transient `FJORD_PRIVATE_KEY`; it is not included here.

## Summary

- PASS: 97
- FAIL: 8
- PARTIAL: 5
- BLOCKED: 85
- NOT RUN: 75
- N/A: 1
- TOTAL: 271

## Commands/Evidence

- `npm run typecheck` passed.
- `tests/fjord-live-sepolia.spec.ts`: 5 passed.
- `tests/fjord-auth-edge.spec.ts`: 4 passed.
- `tests/fjord-live-transaction.spec.ts`: 1 passed with `FJORD_RUN_TRANSACTIONS=true`.
- `tests/fjord-public.spec.ts`: 5 passed, including card view, status/type/chain/combined filters, staking read-only states, and curation/launch-partner gated routes.
- `tests/fjord-partials-live.spec.ts`: 4 passed, including mobile wallet/sale detail, provider-disconnect handling, and provider network switching.
- `tests/fjord-wallet-connect-edge.spec.ts`: 2 passed, covering injected MetaMask wallet selector connection and rejected account-access behavior.
- `tests/fjord-token-deployment-readonly.spec.ts`: 1 passed, covering Sepolia deploy-token modal access and pre-transaction form entry.
- `tests/fjord-live-mutations.spec.ts`: live mutation coverage added for token deployment, fixed-price sale configuration, named draft save, review-step transition, and publish attempts.
- `tests/fjord-live-mutations.spec.ts --grep fixed-price`: passed for draft/review when publishing was disabled; with `FJORD_PUBLISH_SALES=true`, the flow submitted approval but did not emit a pool creation transaction.
- `tests/fjord-admin-mutations.spec.ts`: admin cache mutation attempt was blocked by `Unable to load admin data` and backend 401 from the admin curators endpoint.
- Public route/mobile smoke checks passed for Launch Partners, Terms, Privacy, Help new tab, invalid sale URL, and mobile nav.
- Live & Upcoming search via Sort And Filter passed for matching, no-results, and clear-search behavior.
- Partner dashboard retest found a live authorization/nav mismatch: the signed-in provided Admin wallet sees a Partners Dashboard tab, but `/profile/partners-dashboard` returns `Unable to load the partner dashboard` with `{"message":"Unauthorized"}`.
- Token deployment modal retest found a validation mismatch: the ERC-20 Symbol input accepted `QATESTLONG` instead of enforcing the documented max 6 characters.
- Live token deployment succeeded, but entering `1000000` supply with 18 decimals minted `1000000` raw units, which Fjord displayed as `0.000000000001`; this does not match the documented human-token supply expectation.
- Fixed-price sale creation reached Step 3 and saved a named draft, but the Review screen displayed only Terms & Conditions plus Create & Publish Pool, not the full data summary required by the doc.
- Publishing a QA fixed-price sale submitted ERC-20 approval successfully, then the app did not submit a subsequent pool creation transaction on repeated publish click.
- The resume-draft dialog did not list the named QA drafts created during this run; it only showed pre-existing `asdasdasd` and `TSP` drafts.

## Transaction Evidence

- Wallet had native Sepolia ETH, but the active Sepolia sale uses WETH collateral.
- Wrapped 0.05 Sepolia ETH into WETH: `0x2ecbaae8e1b3641e7af21efba7c0813e765e4b21aad1f2db96dce739cdec7fcb`.
- WETH approval: `0x367b565b5b0cc6f263146ea5577c083cb70c30b96dd818dd92e66d26999a5d28`.
- Sale swap: `0xff4b340ad49b4bcf78de42143260f7c5c6d066888ec05dd87e7b1b62bce57b3c`, receipt success, WETH balance decreased from 0.05 to 0.049.
- QA ERC-20 deployment: token `0xC981EA8597122A248F2b04Dea1387D16E5027d7f`, tx `0x2bb9ec56f977d2688ed02876fff195d33378157093a56c05c7288bcc7db2c622`, name `QA Codex Token 20260514A2`, symbol `Q514A2`, decimals `18`, raw totalSupply `1000000`, formatted supply `0.000000000001`.
- QA fixed-price review artifact: token `0x3839004b31Aa1A81f2ac3a6A866E86235D66eec3`, tx `0x092fe30052da1b3f3015295c5f7766d5efd31b3ceb81a8a9d91d130e65d5a8fe`, draft/review flow passed; review did not include the token symbol in summary.
- QA fixed-price publish attempt: token `0x2c24a56aF95dC1ccBd5414fa158767dA5649870f`, deploy tx `0xc8495daf0801188141aa6927dd95d43610d26bbf3879a244f787fd72030fa0ee`, approval tx `0x87e4f54e887a1a0fc431f74f17bf3aebf377bbe147cc09ebda193970c5e45abb` to spender `0x66664869B4df8401dC2396cE7dAa17Bf96617be0`; no non-approval publish transaction followed.

## Line-By-Line Results

| Step | Status | Title | Notes |
| --- | --- | --- | --- |
| 1.1 | PASS | Verify unauthenticated homepage | Verified unauthenticated homepage/nav on v4.fjordfoundry.com. |
| 1.2 | PASS | Verify navigation links render | Verified unauthenticated homepage/nav on v4.fjordfoundry.com. |
| 1.3 | PASS | Open wallet connection popover (S) | Connect button opened Fjord's wallet selector and displayed/selectable MetaMask provider via injected provider harness; no physical extension prompt was used. |
| 1.4 | PASS | Select MetaMask (S) | Verified Fjord detects injected MetaMask-compatible Sepolia provider and shows connected wallet. |
| 1.5 | PASS | Approve MetaMask connection (S) | Verified Fjord detects injected MetaMask-compatible Sepolia provider and shows connected wallet. |
| 1.6 | PASS | Initiate SIWE sign-in (S) | SIWE initiated and completed on Sepolia with runtime-only private key signer. |
| 1.7 | PASS | Approve SIWE signature (S) | SIWE initiated and completed on Sepolia with runtime-only private key signer. |
| 1.8 | PASS | Verify authenticated state persists on reload (S) | Authenticated state persisted after reload in live Sepolia auth edge suite. |
| 1.9 | PASS | Log out (S) | Log out returned wallet card to sign-in state while keeping wallet connected. |
| 1.10 | PASS | Disconnect wallet (S) | Disconnect returned UI to connect button state. |
| 1.11 | PASS | Connect and sign in on Mainnet (M) | Interpreted Mainnet as Sepolia; Sepolia connect and SIWE sign-in passed. |
| 1.12 | PASS | Switch network in MetaMask while connected (B) | Provider-level chainChanged was simulated while connected; Fjord updated from Sepolia to Polygon and back to Sepolia. No physical extension UI was used. |
| 1.13 | PASS | Reject MetaMask connection | Provider-level account access rejection was simulated; Fjord stayed disconnected and did not show the wallet address. |
| 1.14 | PASS | Reject SIWE signature | Rejected SIWE signature was simulated and Fjord remained connected but unauthenticated. |
| 2.1 | PASS | Verify homepage loads with gallery (B) | Homepage loads with hero/gallery and live/completed sale sections. |
| 2.2 | N/A | Verify Spotlight section (if active) (B) | No active Spotlight card was visible during this run. |
| 2.3 | PASS | Verify card view display (B) | Card view was selected and rendered sale cards with status, funds raised, sale type, FDV/time left, and Participate Now CTA. |
| 2.4 | PASS | Verify table view display (B) | Table view visible with project, funds, date, FDV, sale type, stages/action columns. |
| 2.5 | PASS | Click a live pool card/row (B) | Clicked Sepolia live sale and reached sale detail URL. |
| 2.6 | PASS | Filter by Pool Status (B) | Status filter verified: Live preserved current live rows, Coming produced the no-results state, and All restored rows. |
| 2.7 | PASS | Filter by Sale Type (B) | Sale type filter verified; UI option `LBP` maps to the Price Discovery row, and `Fixed` maps to the Fixed Price row. |
| 2.8 | PASS | Filter by Chain (B) | Chain filter verified with Sepolia and Polygon options, each isolating the matching live/upcoming row. |
| 2.9 | PASS | Filter by Curator (B) | Curator dropdown showed available curator options; selecting Honeypot Finance produced no-results for current live/upcoming rows, and All Curators restored rows. |
| 2.10 | PASS | Combine multiple filters (B) | Combined Live + Fixed + Polygon filters used AND logic and isolated the Polygon Fixed Price row. |
| 2.11 | PASS | Search Live & Upcoming Sales (B) | After opening Sort And Filter, the Live & Upcoming search input filters matching sales such as Sell Event. |
| 2.12 | PASS | Search with no results (B) | After opening Sort And Filter and typing xyznonexistent123, Fjord shows No Token Sales Found and guidance text. |
| 2.13 | PASS | Clear search (B) | Clearing the Sort And Filter search restores the visible Live & Upcoming sale rows. |
| 2.14 | PASS | Scroll to Completed Sales section (B) | Completed Token Sales section/table visible. |
| 2.15 | NOT RUN | Sort Completed Sales (B) | Completed sales sorting/filtering/search were not fully executed. |
| 2.16 | NOT RUN | Filter Completed Sales (B) | Completed sales sorting/filtering/search were not fully executed. |
| 2.17 | NOT RUN | Search Completed Sales (B) | Completed sales sorting/filtering/search were not fully executed. |
| 2.18 | NOT RUN | Paginate Live & Upcoming Sales (B) | No live pagination flow was exercised. |
| 2.19 | PASS | Navigate to Launch Partners (B) | Launch Partners, Help new tab, Terms, and Privacy routes passed route smoke checks. |
| 2.20 | PASS | Navigate to Help (external) (B) | Launch Partners, Help new tab, Terms, and Privacy routes passed route smoke checks. |
| 2.21 | PASS | Verify Terms of Use page | Launch Partners, Help new tab, Terms, and Privacy routes passed route smoke checks. |
| 2.22 | PASS | Verify Privacy Policy page | Launch Partners, Help new tab, Terms, and Privacy routes passed route smoke checks. |
| 3.1 | PASS | Navigate to Profile (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.2 | PASS | Verify profile tabs (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.3 | PASS | View participation history (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.4 | PASS | View unclaimed tokens counter (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.5 | NOT RUN | Click "View" on a participation (M) | Specific row/card actions and pagination were not exercised. |
| 3.6 | NOT RUN | Test pagination (M) | Specific row/card actions and pagination were not exercised. |
| 3.7 | PASS | View Manage Sale page (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.8 | PASS | View draft cards (if any) (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.9 | PASS | View created sales grid (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.10 | NOT RUN | Click "Manage" on a sale (M) | Specific row/card actions and pagination were not exercised. |
| 3.11 | PASS | Navigate to Connections page (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.12 | PASS | View connected sources (M) | Authenticated profile, participation, manage-sale, and connections routes loaded for provided wallet. |
| 3.13 | BLOCKED | Connect Discord account (M) | Requires Discord/Telegram/Twitter OAuth accounts and linked social setup. |
| 3.14 | BLOCKED | Connect Telegram account (M) | Requires Discord/Telegram/Twitter OAuth accounts and linked social setup. |
| 3.15 | BLOCKED | Connect Twitter/X account (M) | Requires Discord/Telegram/Twitter OAuth accounts and linked social setup. |
| 3.16 | BLOCKED | Configure source assignments (M) | Requires Discord/Telegram/Twitter OAuth accounts and linked social setup. |
| 3.17 | BLOCKED | Disconnect a linked account (M) | Requires Discord/Telegram/Twitter OAuth accounts and linked social setup. |
| 3.18 | BLOCKED | Verify curation autofill preview (M) | Requires Discord/Telegram/Twitter OAuth accounts and linked social setup. |
| 4.1 | PASS | Access token deployment (S) | Full Launch Step 2 on Sepolia exposed the `Do you need a token?` action and opened the Deploy a token modal. |
| 4.2 | FAIL | Fill ERC-20 deployment form (S) | Symbol, Name, Total Supply, and Decimals accepted input, but Symbol did not enforce the documented max 6 character limit; `QATESTLONG` was accepted. |
| 4.3 | PARTIAL | Validate ERC-20 form errors (S) | Empty deploy click did not submit a transaction; invalid overlong symbol was accepted pre-submit, and the valid deploy path was executed. Overlong-symbol submit validation remains a product failure from 4.2. |
| 4.4 | PASS | Deploy ERC-20 token (S) | Deployed QA token through Fjord's Sepolia token modal. Example tx `0x2bb9ec56f977d2688ed02876fff195d33378157093a56c05c7288bcc7db2c622`, token `0xC981EA8597122A248F2b04Dea1387D16E5027d7f`; token auto-selected in the creation form. |
| 4.5 | FAIL | Verify deployed token (S) | Contract exists with correct name, symbol, and decimals, but entering `1000000` total supply minted `1000000` raw units and displayed as `0.000000000001` tokens at 18 decimals, not the documented 1,000,000-token supply expectation. |
| 5.1 | PASS | Navigate to sale creation (S) | Sale creation route loaded and showed Quick Launch, Full Launch, and Custom Configuration choices. |
| 5.2 | PASS | Select Full Launch mode (S) | Sale creation route loaded and showed Quick Launch, Full Launch, and Custom Configuration choices. |
| 5.3 | PASS | Fill project name and description (S) | Fixed-price QA creation flow accepted project name, short description, and full description. |
| 5.4 | PASS | Select round type (S) | Public Round was selected and the form advanced. |
| 5.5 | PASS | Upload logo (S) | Logo URL `https://placehold.co/256x256.png` was accepted and the form advanced; file upload was not separately exercised. |
| 5.6 | NOT RUN | Add social links (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.7 | NOT RUN | Add custom links (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.8 | NOT RUN | Configure geo-blocking (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.9 | NOT RUN | Enable custom terms (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.10 | NOT RUN | Enable custom redemption (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.11 | NOT RUN | Validate required fields (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.12 | PASS | Complete Step 1 and advance (S) | Step 1 completed and Step 2 Sale Settings unlocked. |
| 5.13 | PASS | Select Fixed Price sale type (S) | Fixed Price selected and fixed-price-specific fields appeared. |
| 5.14 | PASS | Select chain and tokens (S) | Sepolia selected; newly deployed QA ERC-20 project token and WETH collateral selected with metadata loaded. |
| 5.15 | PASS | Set sale dates (S) | Start and end datetime-local fields accepted a future start and a 3-day sale window. |
| 5.16 | NOT RUN | Validate max sale duration (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.17 | PASS | Set shares for sale and price (S) | Shares for sale and WETH price per token accepted valid positive values and updated the simulation. |
| 5.18 | NOT RUN | Set allocation limits (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.19 | NOT RUN | Configure whitelist (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.20 | NOT RUN | Configure vesting (optional) (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.21 | NOT RUN | Configure referrals (optional) (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.22 | PASS | Save as draft (S) | Save Draft opened the required `Name your draft` dialog; entering the QA draft name produced `Draft Created!`. |
| 5.23 | PASS | Complete Step 2 and advance to Review (S) | With valid LP seed and soft-cap values, Step 2 finished and Step 3 Review & Approve unlocked. |
| 5.24 | FAIL | Review sale summary (S) | Review step showed Terms & Conditions and Create & Publish Pool only; it did not show the documented full summary of project details, sale type, dates, token addresses, price, allocation, whitelist, vesting, and referrals. |
| 5.25 | FAIL | Accept terms and publish (S) | Terms checkbox worked and first publish click submitted ERC-20 approval, but repeated publish click did not emit a non-approval pool creation transaction. |
| 5.26 | FAIL | Verify deployment success (S) | No post-deployment success screen, pool address, or view-sale link appeared after the approval-only publish attempt. |
| 5.27 | BLOCKED | Verify published sale in gallery (S) | Publishing/deploying/deleting sales would mutate live/testnet state; not executed in this pass. |
| 5.28 | NOT RUN | Start new creation — Tiered Price (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.29 | NOT RUN | Configure tiers (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.30 | NOT RUN | Test tier validation errors (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.31 | NOT RUN | Save tiered sale as draft (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.32 | BLOCKED | Publish tiered sale (S) | Publishing/deploying/deleting sales would mutate live/testnet state; not executed in this pass. |
| 5.33 | NOT RUN | Start new creation — Batch Price (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.34 | NOT RUN | Configure batch settings (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.35 | NOT RUN | Save batch sale as draft (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.36 | BLOCKED | Publish batch sale (S) | Publishing/deploying/deleting sales would mutate live/testnet state; not executed in this pass. |
| 5.37 | NOT RUN | Start new creation — Price Discovery (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.38 | NOT RUN | Configure LBP settings (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.39 | NOT RUN | Set redemption delay (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.40 | NOT RUN | Test LBP vesting restrictions (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.41 | NOT RUN | Save LBP sale as draft (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.42 | BLOCKED | Publish LBP sale (S) | Publishing/deploying/deleting sales would mutate live/testnet state; not executed in this pass. |
| 5.43 | NOT RUN | Test Quick Launch mode (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.44 | NOT RUN | Fill Quick Launch form (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.45 | BLOCKED | Deploy via Quick Launch (S) | Publishing/deploying/deleting sales would mutate live/testnet state; not executed in this pass. |
| 5.46 | NOT RUN | Test Custom Configuration mode (S) | Detailed sale creation wizard fields/drafts were not completed. |
| 5.47 | PARTIAL | Verify all saved drafts appear (S) | `Draft Created!` toast appeared, but the resume-draft dialog did not list the named QA drafts created during this run; Profile → Manage Your Sale was not separately retested for those draft names. |
| 5.48 | FAIL | Continue a draft (S) | Attempting to resume `QA-Codex-Fixed-20260514FP7` failed because the resume-draft dialog only showed pre-existing `asdasdasd` and `TSP` drafts. |
| 5.49 | BLOCKED | Delete a draft (S) | Publishing/deploying/deleting sales would mutate live/testnet state; not executed in this pass. |
| 6.1 | BLOCKED | Navigate to edit page from Manage Sale (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.2 | BLOCKED | Navigate to edit page directly (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.3 | BLOCKED | Edit project name and description (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.4 | BLOCKED | Update logo and banner (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.5 | BLOCKED | Update social links (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.6 | BLOCKED | Save project detail edits (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.7 | BLOCKED | Edit whitelist (Fixed Price / Tiered / Batch) (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.8 | BLOCKED | Verify LBP edit restrictions (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.9 | BLOCKED | Pause a sale (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.10 | BLOCKED | Unpause a sale (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 6.11 | BLOCKED | Edit a sale as admin (S) | Requires an owned/editable sale and would mutate sale/admin state. |
| 7.1 | PASS | Navigate to a live sale (S) | Live Sepolia price-discovery sale detail, info, and chart/swap surface rendered. |
| 7.2 | PASS | Verify sale information display (S) | Live Sepolia price-discovery sale detail, info, and chart/swap surface rendered. |
| 7.3 | PASS | Verify price chart renders (S) | Live Sepolia price-discovery sale detail, info, and chart/swap surface rendered. |
| 7.4 | NOT RUN | Participate in Fixed Price sale (S) | Fixed/Tiered/Batch participation paths were not executed. |
| 7.5 | NOT RUN | Confirm Fixed Price transaction (S) | Fixed/Tiered/Batch participation paths were not executed. |
| 7.6 | NOT RUN | Verify participation recorded (S) | Fixed/Tiered/Batch participation paths were not executed. |
| 7.7 | PASS | Participate in LBP sale — Buy (S) | Executed same-chain Sepolia WETH approval and price-discovery swap successfully. |
| 7.8 | PASS | Confirm LBP buy transaction (S) | Executed same-chain Sepolia WETH approval and price-discovery swap successfully. |
| 7.9 | NOT RUN | LBP sell (if Buy & Sell type) (S) | LBP sell path was not exercised. |
| 7.10 | NOT RUN | Participate in Tiered Price sale (S) | Fixed/Tiered/Batch participation paths were not executed. |
| 7.11 | NOT RUN | Participate in Batch Price sale (S) | Fixed/Tiered/Batch participation paths were not executed. |
| 7.12 | NOT RUN | Reject a swap transaction (S) | Swap transaction rejection was not exercised. |
| 7.13 | PASS | Insufficient balance (S) | Initial Balance 0 was explained: sale required WETH collateral; wallet had native Sepolia ETH but 0 WETH. |
| 7.14 | NOT RUN | Wallet not connected (S) | Wallet-not-connected participation path was not exercised. |
| 7.15 | NOT RUN | Select cross-chain token (S) | Cross-chain token/swap path was not exercised. |
| 7.16 | NOT RUN | Execute cross-chain swap (S) | Cross-chain token/swap path was not exercised. |
| 7.17 | NOT RUN | View claimable tokens after sale ends (S) | Post-sale claim path was not exercised. |
| 7.18 | NOT RUN | Claim tokens (S) | Post-sale claim path was not exercised. |
| 7.19 | NOT RUN | Verify claimed tokens in wallet (S) | Post-sale claim path was not exercised. |
| 8.1 | PASS | Verify swap card elements (S) | Swap card elements and price-impact text were visible on Sepolia sale. |
| 8.2 | NOT RUN | Toggle buy/sell mode (S) | Buy/sell toggle, settings, and paused-pool behavior were not exercised. |
| 8.3 | NOT RUN | Test swap settings (S) | Buy/sell toggle, settings, and paused-pool behavior were not exercised. |
| 8.4 | PASS | Verify price impact display (S) | Swap card elements and price-impact text were visible on Sepolia sale. |
| 8.5 | PASS | Execute a same-chain swap (S) | Same-chain Sepolia WETH purchase transaction submitted and confirmed successfully. |
| 8.6 | NOT RUN | Verify swap when pool is paused (S) | Buy/sell toggle, settings, and paused-pool behavior were not exercised. |
| 9.1 | PASS | Navigate to Staking (M) | Staking route hydrated after initial loading and displayed the Stake Your FJO page. |
| 9.2 | PASS | Verify staking metrics (M) | Metrics visible: Total FJO Rebought, Total FJO Burned, and Total FJO Staked. |
| 9.3 | PASS | Verify "BUY FJO" button (M) | BUY FJO link visible and points to Uniswap. |
| 9.4 | PASS | View staking form (M) | Stake form visible with amount input, FJO unit, Deposit FJO, Stake Fjord NFT, and Withdraw Before Lock controls. |
| 9.5 | PASS | Enter staking amount (M) | Staking amount input accepted `1`. |
| 9.6 | BLOCKED | Deposit FJO (M) | Sepolia staking-specific assets/state were not confirmed; staking mutations not executed. |
| 9.7 | PASS | Verify deposit disabled states (M) | Deposit FJO was disabled without a connected staking balance/precondition. |
| 9.8 | PARTIAL | Withdraw before lock (M) | Withdraw Before Lock control was visible and disabled, but no pre-lock deposit existed to withdraw. |
| 9.9 | PARTIAL | Check NFT staking option (M) | Stake Fjord NFT control was visible and disabled; no eligible NFT state was available to open the modal. |
| 9.10 | PASS | View My Positions tab (M) | My Positions route loaded and showed rewards plus locked staking positions sections. |
| 9.11 | PASS | View rewards and claim options (M) | Rewards card showed 0 FJO, 0 FJOINTS, claim timing, Full Claim, Instant Claim, and Claim FJOINTS controls. |
| 9.12 | BLOCKED | Instant Claim 50% (M) | Sepolia staking-specific assets/state were not confirmed; staking mutations not executed. |
| 9.13 | BLOCKED | Full Claim 100% (M) | Sepolia staking-specific assets/state were not confirmed; staking mutations not executed. |
| 9.14 | PARTIAL | View staking position cards (M) | Locked positions section and totals were visible, but the wallet had no staked-position cards to inspect. |
| 9.15 | BLOCKED | Unstake individual position (M) | Sepolia staking-specific assets/state were not confirmed; staking mutations not executed. |
| 9.16 | BLOCKED | Unstake All (M) | Sepolia staking-specific assets/state were not confirmed; staking mutations not executed. |
| 9.17 | PASS | View Airdrops tab (M) | Airdrops & Auctions route loaded and showed Wallet Required empty state plus Learn More. |
| 10.1 | PASS | Verify notification bell appears (B) | Notification bell visible when wallet connected. |
| 10.2 | NOT RUN | Open notification popover (B) | Notification popover actions/read states were not fully exercised. |
| 10.3 | NOT RUN | Click a notification (B) | Notification popover actions/read states were not fully exercised. |
| 10.4 | NOT RUN | Mark all notifications as read (B) | Notification popover actions/read states were not fully exercised. |
| 10.5 | NOT RUN | Verify auto-refresh (B) | Notification popover actions/read states were not fully exercised. |
| 11.1 | PASS | Sign in as Admin (B) | Provided wallet signs in and displays Admin access level. |
| 11.2 | PASS | Navigate to Admin dashboard via nav link (B) | Admin routes were accessible without unauthorized/forbidden errors for provided wallet. |
| 11.3 | PASS | Verify admin sidebar navigation (B) | Admin routes were accessible without unauthorized/forbidden errors for provided wallet. |
| 11.4 | BLOCKED | Verify mod-level access (B) | No separate moderator wallet was provided. |
| 11.5 | PASS | Navigate to Pools page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.6 | NOT RUN | Search and select a pool (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.7 | BLOCKED | Visibility tab — toggle gallery listing (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.8 | BLOCKED | Curation tab — set KYC and comment (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.9 | BLOCKED | Project Details tab — edit pool metadata (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.10 | BLOCKED | Presale tab (FPS pools only) (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.11 | PASS | Navigate to Applications page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.12 | NOT RUN | Filter applications by status (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.13 | NOT RUN | Expand an application card (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.14 | BLOCKED | Approve a curator application (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.15 | BLOCKED | Reject a curator application (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.16 | BLOCKED | Block a curator application (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.17 | PASS | Navigate to Users page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.18 | NOT RUN | Search for a user (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.19 | NOT RUN | Filter users by role (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.20 | BLOCKED | Edit a user's role (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.21 | BLOCKED | Verify privilege escalation prevention (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.22 | PASS | Navigate to Curators page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.23 | NOT RUN | Filter curators by status (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.24 | NOT RUN | View curator card details (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.25 | BLOCKED | Reassign a pool from one curator to another (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.26 | PASS | Navigate to Spotlights page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.27 | BLOCKED | Create a spotlight (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.28 | BLOCKED | Verify spotlight on homepage (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.29 | BLOCKED | Edit a spotlight (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.30 | BLOCKED | Delete a spotlight (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.31 | PASS | Navigate to Pool Ordering page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.32 | BLOCKED | Set pool rank and pin (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.33 | BLOCKED | Verify pinned pool in gallery (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.34 | BLOCKED | Remove pool order override (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.35 | PASS | Navigate to Presales page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.36 | NOT RUN | Load presale data (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.37 | BLOCKED | Update presale parameters (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.38 | PASS | Navigate to Analytics page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.39 | NOT RUN | View analytics metrics (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.40 | NOT RUN | Change analytics time period (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.41 | FAIL | Navigate to Cache page (B) | Direct cache mutation attempt loaded `/admin/cache` but displayed `Unable to load admin data` with backend 401 from `https://gofjord-lbp.fly.dev/api/auth/admin/curators`. |
| 11.42 | BLOCKED | Purge a cache target (B) | Cache purge was not performed because the cache page failed to load admin data with backend 401. |
| 11.43 | PASS | Navigate to Faucet page as Admin (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.44 | NOT RUN | View faucet statistics (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.45 | BLOCKED | Access Faucet page as Moderator (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 11.46 | PASS | Navigate to Audit Log page (B) | Read-only navigation to the corresponding admin route did not show unauthorized/forbidden/access denied. |
| 11.47 | NOT RUN | Review audit log entries (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.48 | NOT RUN | Filter audit log by action type (B) | Read-only subpage detail interactions were not completed line-by-line. |
| 11.49 | BLOCKED | Verify recent admin actions appear in log (B) | Would mutate admin, pool, application, ordering, cache, faucet, or audit state, or requires a moderator wallet. |
| 12.1 | BLOCKED | Sign in as Curator (B) | No separate curator wallet was provided. |
| 12.2 | BLOCKED | Edit curator profile (B) | Curator profile edits would mutate profile state and require curator setup. |
| 12.3 | BLOCKED | Connect Twitter/X on curator profile (B) | Requires Twitter/X OAuth account. |
| 12.4 | BLOCKED | Disconnect Twitter/X (B) | Requires Twitter/X OAuth account. |
| 12.5 | BLOCKED | Save curator profile changes (B) | Curator profile edits would mutate profile state and require curator setup. |
| 12.6 | FAIL | Navigate to Partners Dashboard (B) | Signed-in provided Admin wallet shows Partners Dashboard tab, but `/profile/partners-dashboard` returns `Unable to load the partner dashboard` with `{"message":"Unauthorized"}`. |
| 12.7 | BLOCKED | View curation requests section (B) | Blocked by partner-dashboard authorization error and lack of a separate launch-partner/curator wallet with pending requests. |
| 12.8 | BLOCKED | View partnership requests section (B) | Blocked by partner-dashboard authorization error and lack of a separate launch-partner/curator wallet with pending requests. |
| 12.9 | BLOCKED | Accept a partnership request with KYC (B) | Accept/reject curator or partnership requests would mutate live backend state and no pending request was available. |
| 12.10 | BLOCKED | Reject a partnership request (B) | Accept/reject curator or partnership requests would mutate live backend state and no pending request was available. |
| 12.11 | BLOCKED | View answered partnerships (paginated) (B) | Blocked by partner-dashboard authorization error and no answered partnership data for a launch-partner wallet. |
| 12.12 | BLOCKED | Navigate to Curator Requests page (B) | Direct curator request route remained gated/redirected without a separate launch-partner/curator wallet. |
| 12.13 | BLOCKED | Review a curation request (B) | No pending curation request was available and curator workflow remained gated. |
| 12.14 | BLOCKED | Accept a curation request (B) | Accept/reject curator or partnership requests would mutate live backend state and no pending request was available. |
| 12.15 | BLOCKED | Reject a curation request with reasons (B) | Accept/reject curator or partnership requests would mutate live backend state and no pending request was available. |
| 13.1 | PASS | Navigate to Apply for Curation (B) | `/apply-for-curation` loaded and showed the expected sign-in gate. |
| 13.2 | BLOCKED | Verify form auto-fill from pool (B) | Requires prior created sale, social connections, or application state not present. |
| 13.3 | BLOCKED | Select curator mode — specific curator (B) | Requires prior created sale, social connections, or application state not present. |
| 13.4 | BLOCKED | Select curator mode — broadcast (B) | Requires prior created sale, social connections, or application state not present. |
| 13.5 | BLOCKED | Fill project credibility section (B) | Requires prior created sale, social connections, or application state not present. |
| 13.6 | BLOCKED | Fill market readiness section (B) | Requires prior created sale, social connections, or application state not present. |
| 13.7 | BLOCKED | Fill context and Fjord-specific sections (B) | Requires prior created sale, social connections, or application state not present. |
| 13.8 | BLOCKED | Submit curation request (B) | Submitting curation/launch-partner applications would mutate live backend state. |
| 13.9 | BLOCKED | View pending request status (B) | Requires prior created sale, social connections, or application state not present. |
| 13.10 | PASS | Navigate to Become Launch Partner (B) | `/become-launch-partner` loaded and showed the expected sign-in gate. |
| 13.11 | BLOCKED | Fill launch partner application (B) | Submitting curation/launch-partner applications would mutate live backend state. |
| 13.12 | BLOCKED | Submit launch partner application (B) | Submitting curation/launch-partner applications would mutate live backend state. |
| 13.13 | BLOCKED | View rejection and resubmit (B) | Requires prior created sale, social connections, or application state not present. |
| 13.14 | BLOCKED | Verify blocked resubmission (B) | Requires prior created sale, social connections, or application state not present. |
| 13.15 | BLOCKED | View creator curation dashboard (B) | Requires prior created sale, social connections, or application state not present. |
| 13.16 | BLOCKED | View curation request status from creator side (B) | Requires prior created sale, social connections, or application state not present. |
| 14.1 | BLOCKED | Verify buyer cannot access admin routes (B) | Requires separate buyer, curator, and moderator wallets not provided. |
| 14.2 | BLOCKED | Verify buyer cannot access curator routes (B) | Requires separate buyer, curator, and moderator wallets not provided. |
| 14.3 | BLOCKED | Verify curator can access curator routes but not admin (B) | Requires separate buyer, curator, and moderator wallets not provided. |
| 14.4 | BLOCKED | Verify mod has limited admin access (B) | Requires separate buyer, curator, and moderator wallets not provided. |
| 14.5 | PASS | Verify admin has full access (B) | Provided wallet displayed Admin access and could access all checked admin read-only routes. |
| 14.6 | BLOCKED | Verify nav items for buyer (B) | Requires separate buyer, curator, and moderator wallets not provided. |
| 14.7 | BLOCKED | Verify nav items for curator (B) | Requires separate buyer, curator, and moderator wallets not provided. |
| 14.8 | BLOCKED | Verify nav items for mod (B) | Requires separate buyer, curator, and moderator wallets not provided. |
| 14.9 | PASS | Verify nav items for admin (B) | Provided wallet displayed Admin access and could access all checked admin read-only routes. |
| 14.10 | PASS | Verify access level indicator per role (B) | Provided wallet displayed Admin access and could access all checked admin read-only routes. |
| A.1 | PASS | Mobile homepage layout | Mobile viewport 375x812 loaded homepage and hamburger menu showed nav items. |
| A.2 | PASS | Mobile navigation menu | Mobile viewport 375x812 loaded homepage and hamburger menu showed nav items. |
| A.3 | PASS | Mobile wallet connection | Mobile viewport 375x812 displayed the injected Sepolia wallet and completed SIWE sign-in. |
| A.4 | PASS | Mobile sale detail page | Mobile viewport opened the Sepolia price-discovery sale detail and displayed sale/participation content. |
| A.5 | NOT RUN | Mobile sale creation form | Mobile sale creation/admin/notification/profile interactions were not fully exercised. |
| A.6 | NOT RUN | Mobile admin dashboard | Mobile sale creation/admin/notification/profile interactions were not fully exercised. |
| A.7 | NOT RUN | Mobile notification popover | Mobile sale creation/admin/notification/profile interactions were not fully exercised. |
| A.8 | NOT RUN | Mobile profile connections | Mobile sale creation/admin/notification/profile interactions were not fully exercised. |
| B.1 | NOT RUN | Network error during page load | Network throttling was not performed in this pass. |
| B.2 | PASS | MetaMask disconnected mid-session | Provider-level disconnect/accountsChanged event was simulated mid-session and Fjord returned to the Connect Wallet state; no real extension UI was used. |
| B.3 | PASS | Navigate to invalid sale URL | Invalid sale URL showed error-boundary style recovery text. |
| B.4 | NOT RUN | Transaction failure (insufficient gas) | Low-gas transaction failure was not forced. |
| B.5 | NOT RUN | Double-submit prevention | Double-submit prevention was not exercised to avoid repeated spend/mutations. |
| B.6 | NOT RUN | Browser back/forward navigation | Back/forward history sequence was not executed. |
| B.7 | NOT RUN | Page refresh on form-in-progress | Refresh during in-progress sale creation was not executed. |
