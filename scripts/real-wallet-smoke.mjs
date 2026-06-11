// Cross-platform runner for the opt-in real-MetaMask smoke suite. Defaults
// to headed (the fully validated mode); export
// WEB3_TESTER_REAL_WALLET_HEADLESS=true to opt into headless.
//
// Runs SINGLE-worker by default: the live extension UI (account-tree
// background sync, modal animations) is timing-sensitive, and two concurrent
// MetaMask instances under CPU contention flake a different test each run.
// One worker matches the reliability the methods show in isolation; the run
// is slower but the gate is stable. `--retries=1` stays as a backstop. Pass
// `--workers=N` to override for a faster (flakier) local run.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    '--project=library',
    'real-wallet-smoke',
    '--workers=1',
    '--retries=1',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      WEB3_TESTER_REAL_WALLET_SMOKE: 'true',
      WEB3_TESTER_REAL_WALLET_HEADLESS: process.env.WEB3_TESTER_REAL_WALLET_HEADLESS ?? 'false',
    },
  },
);

process.exit(result.status ?? 1);
