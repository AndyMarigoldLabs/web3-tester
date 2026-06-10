export const DEFAULT_WALLET_PASSWORD = 'web3-tester-wallet';
export function passwordForSetup(setup) {
    return setup?.password ?? (setup?.seedPhrase ? DEFAULT_WALLET_PASSWORD : undefined);
}
//# sourceMappingURL=real-wallet-setup.js.map