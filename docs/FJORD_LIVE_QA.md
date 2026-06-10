# Fjord V4 Live QA

The Fjord QA specs in `tests/fjord*.spec.ts` are the working executable version of the manual QA document.

Target:

```text
https://v4.fjordfoundry.com
```

Network:

```text
Sepolia
```

Any legacy "mainnet" wording in the manual QA doc is treated as Sepolia for this test harness.

## Test Categories

| Category | Specs | Default behavior |
| --- | --- | --- |
| Public read-only | `fjord-public`, `fjord`, public parts of other specs | Runs without private key where possible. |
| Live wallet read-only | `fjord-live-sepolia`, `fjord-auth-edge`, `fjord-partials-live` | Requires `FJORD_PRIVATE_KEY`. Opt into `autoApprove: true`; read-only by exercised flow, not wallet-enforced. |
| Live wallet read-only (wallet-enforced) | `fjord-token-deployment-readonly` | Requires `FJORD_PRIVATE_KEY`. Default-deny wallet armed only for the SIWE `personal_sign`, so any transaction attempt is rejected with `4001`. |
| Live transaction | `fjord-live-transaction` | Requires `FJORD_RUN_TRANSACTIONS=true`. |
| Live mutations | `fjord-live-mutations` | Requires `FJORD_MUTATE_STATE=true`. |
| Sale publishing | `fjord-live-mutations` publish branch | Requires `FJORD_PUBLISH_SALES=true`. |
| Admin mutations | `fjord-admin-mutations` | Requires `FJORD_ADMIN_MUTATE=true`. |

## Read-Only Run

```powershell
$env:FJORD_PRIVATE_KEY = '<runtime-only-key>'
$env:DAPP_URL = 'https://v4.fjordfoundry.com'
npm test -- --reporter=list tests/fjord-public.spec.ts tests/fjord-live-sepolia.spec.ts tests/fjord-auth-edge.spec.ts tests/fjord-partials-live.spec.ts
```

## Live Mutation Run

```powershell
$env:FJORD_PRIVATE_KEY = '<runtime-only-key>'
$env:DAPP_URL = 'https://v4.fjordfoundry.com'
$env:FJORD_MUTATE_STATE = 'true'
$env:FJORD_QA_RUN_ID = 'YYYYMMDDXX'
npm test -- --reporter=list tests/fjord-live-mutations.spec.ts
```

## Sale Publish Attempt

```powershell
$env:FJORD_PRIVATE_KEY = '<runtime-only-key>'
$env:FJORD_MUTATE_STATE = 'true'
$env:FJORD_PUBLISH_SALES = 'true'
$env:FJORD_QA_RUN_ID = 'YYYYMMDDPX'
npm test -- --reporter=list tests/fjord-live-mutations.spec.ts
```

## Admin Mutation Attempt

```powershell
$env:FJORD_PRIVATE_KEY = '<runtime-only-key>'
$env:FJORD_ADMIN_MUTATE = 'true'
npm test -- --reporter=list tests/fjord-admin-mutations.spec.ts
```

## Reporting Rules

- Record `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, `NOT RUN`, or `N/A` for every doc line.
- When a line fails, note the observable behavior and continue to the next line.
- Do not collapse a doc mismatch into a product failure if the live UI has moved the control.
- Never paste private keys into reports.
- Include transaction hashes and deployed QA addresses when they help debugging.

## Current Report Artifacts

- `reports/fjord-full-line-by-line-qa-2026-05-14.md`
- `reports/fjord-qa-results-2026-05-14.md`

## Known Findings From The 2026-05-14 Run

- ERC-20 deployment from the Fjord UI succeeded.
- Token supply input minted raw units rather than the expected human-token amount.
- Fixed-price sale draft creation reached review.
- The review step did not show the documented full sale summary.
- Publishing submitted an ERC-20 approval transaction but did not continue to pool creation.
- Saved QA drafts were not listed in the resume dialog.
- `/admin/cache` failed loading admin data with backend `401`.
