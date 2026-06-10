import type { RealWalletSetup } from './real-wallet.js';

export const DEFAULT_WALLET_PASSWORD = 'web3-tester-wallet';

export function passwordForSetup(setup: RealWalletSetup | undefined) {
  return setup?.password ?? (setup?.seedPhrase ? DEFAULT_WALLET_PASSWORD : undefined);
}
