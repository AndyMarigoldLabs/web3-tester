# Release Checklist

Use this before publishing a new version or pinning it inside Fjord v4.

## Required

- `npm run typecheck`
- `npm run build`
- `npm test`
- `rg -n "FJORD_PRIVATE_KEY\\s*=\\s*0x[0-9a-fA-F]{64}|PRIVATE_KEY=.*[0-9a-fA-F]{64}" . -g "!node_modules/**" -g "!dist/**" -g "!.npm-cache/**"`
- Confirm `.env` is ignored.
- Confirm `dist/` is generated locally but not required in source review unless the team wants committed build output.

## Dependency Consumer Check

From a clean consumer repo:

```bash
npm install --save-dev @marigoldlabs/web3-tester@<version>
```

Then import:

```ts
import { expect, test } from '@marigoldlabs/web3-tester/fixtures';
```

Run one provider smoke test.

## Live QA Check

Run live tests only with runtime secrets:

```powershell
$env:FJORD_PRIVATE_KEY = '<runtime-only-key>'
$env:DAPP_URL = 'https://v4.fjordfoundry.com'
npm test -- --reporter=list tests/fjord-live-sepolia.spec.ts
```

Mutation runs require explicit flags and should not be part of default CI.

## Push

```bash
git status --short
git add .
git commit -m "Document and package Web3 tester"
git push -u origin main
```

## Distribute

The package is deliberately private (`"private": true`, UNLICENSED): npm
refuses to publish it. Consumers install straight from git — `dist/` is
committed and CI gates on its freshness:

```bash
npm install git+https://github.com/AndyMarigoldLabs/web3-tester.git#<tag-or-sha>
```

If it ever goes public, pick a license (MIT/Apache-2.0), flip `private`, and
replace this section with `npm publish --access public`.
