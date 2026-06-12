const svgIcon = (label, background, foreground = 'ffffff') => {
    const initials = encodeURIComponent(label.slice(0, 3).toUpperCase());
    return ('data:image/svg+xml,' +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<rect width="64" height="64" rx="14" fill="%23${background}"/>` +
        `<text x="32" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="%23${foreground}">${initials}</text>` +
        `</svg>`);
};
export const mockWalletPersona = (overrides = {}) => createWalletPersona({
    uuid: '00000000-0000-4000-8000-000000000001',
    name: 'Mock Wallet',
    icon: svgIcon('Mock', '111827', '38bdf8'),
    rdns: 'dev.invisible-wallet.mock',
    flags: { isMetaMask: true, isMock: true },
    walletConnect: {
        name: 'web3-tester Wallet',
        description: 'Headless wallet for E2E tests',
        url: 'https://github.com/AndyMarigoldLabs/web3-tester',
        icons: [],
    },
    ...overrides,
});
export const walletPersonas = {
    mock: mockWalletPersona,
    metamask: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000101',
        name: 'MetaMask',
        icon: svgIcon('MM', 'f6851b'),
        rdns: 'io.metamask',
        flags: { isMetaMask: true },
        walletConnect: {
            name: 'MetaMask',
            description: 'MetaMask-compatible test wallet',
            url: 'https://metamask.io',
            icons: [],
            links: {
                mobile: 'https://metamask.app.link/wc?uri={uri}',
                qrCode: 'https://metamask.app.link/wc?uri={uri}',
            },
        },
        ...overrides,
    }),
    rabby: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000102',
        name: 'Rabby Wallet',
        icon: svgIcon('Rabby', '8697ff'),
        rdns: 'io.rabby',
        flags: { isRabby: true },
        walletConnect: {
            name: 'Rabby Wallet',
            description: 'Rabby-compatible test wallet',
            url: 'https://rabby.io',
            icons: [],
        },
        ...overrides,
    }),
    coinbase: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000103',
        name: 'Coinbase Wallet',
        icon: svgIcon('CB', '0052ff'),
        rdns: 'io.coinbase',
        flags: { isCoinbaseWallet: true },
        aliases: ['coinbaseWalletExtension'],
        walletConnect: {
            name: 'Coinbase Wallet',
            description: 'Coinbase Wallet-compatible test wallet',
            url: 'https://wallet.coinbase.com',
            icons: [],
            links: {
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    phantomEvm: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000104',
        name: 'Phantom',
        icon: svgIcon('PH', 'ab9ff2'),
        rdns: 'app.phantom',
        flags: { isPhantom: true },
        aliases: ['phantom.ethereum'],
        solana: {
            publicKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
            flags: { isPhantom: true },
            aliases: ['phantom.solana', 'solana'],
        },
        walletConnect: {
            name: 'Phantom',
            description: 'Phantom EVM-compatible test wallet',
            url: 'https://phantom.com',
            icons: [],
        },
        ...overrides,
    }),
    rainbow: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000105',
        name: 'Rainbow',
        icon: svgIcon('RBW', 'ff5bcb'),
        rdns: 'me.rainbow',
        flags: { isRainbow: true },
        walletConnect: {
            name: 'Rainbow',
            description: 'Rainbow-compatible test wallet',
            url: 'https://rainbow.me',
            icons: [],
            links: {
                mobile: 'rainbow://wc?uri={uri}&connector=web3-tester',
                qrCode: 'https://rnbwapp.com/wc?uri={uri}&connector=web3-tester',
            },
        },
        ...overrides,
    }),
    okx: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000106',
        name: 'OKX Wallet',
        icon: svgIcon('OKX', '000000'),
        rdns: 'com.okex.wallet',
        flags: { isOkxWallet: true, isOKExWallet: true },
        aliases: ['okxwallet'],
        walletConnect: {
            name: 'OKX Wallet',
            description: 'OKX Wallet-compatible test wallet',
            url: 'https://www.okx.com/web3',
            icons: [],
            links: {
                mobile: 'okex://main/wc?uri={uri}',
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    trust: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000107',
        name: 'Trust Wallet',
        icon: svgIcon('TR', '0500ff'),
        rdns: 'com.trustwallet.app',
        flags: { isTrust: true, isTrustWallet: true },
        aliases: ['trustwallet'],
        walletConnect: {
            name: 'Trust Wallet',
            description: 'Trust Wallet-compatible test wallet',
            url: 'https://trustwallet.com',
            icons: [],
            links: {
                mobile: 'trust://wc?uri={uri}',
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    brave: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000108',
        name: 'Brave Wallet',
        icon: svgIcon('BRV', 'fb542b'),
        rdns: 'com.brave.wallet',
        flags: { isBraveWallet: true, isMetaMask: true },
        walletConnect: {
            name: 'Brave Wallet',
            description: 'Brave Wallet-compatible test wallet',
            url: 'https://brave.com/wallet',
            icons: [],
        },
        ...overrides,
    }),
    zerion: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000109',
        name: 'Zerion Wallet',
        icon: svgIcon('ZER', '2962ef'),
        rdns: 'io.zerion.wallet',
        flags: { isZerion: true },
        walletConnect: {
            name: 'Zerion Wallet',
            description: 'Zerion-compatible test wallet',
            url: 'https://zerion.io',
            icons: [],
        },
        ...overrides,
    }),
    backpack: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000110',
        name: 'Backpack',
        icon: svgIcon('BP', 'e33e3f'),
        rdns: 'app.backpack',
        flags: { isBackpack: true },
        aliases: ['backpack.ethereum'],
        solana: {
            publicKey: '8xX7qT9N4z2Wm6YQNz3dLqHpspRrQ2Xrcrk22eL8D4sP',
            flags: { isBackpack: true },
            aliases: ['backpack.solana'],
        },
        walletConnect: {
            name: 'Backpack',
            description: 'Backpack EVM-compatible test wallet',
            url: 'https://backpack.app',
            icons: [],
        },
        ...overrides,
    }),
    solflare: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000126',
        name: 'Solflare',
        icon: svgIcon('SOL', 'ffdf46', '2a1557'),
        rdns: 'com.solflare',
        evm: false,
        flags: { isSolflare: true },
        aliases: ['solflare'],
        solana: {
            publicKey: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWkDD5DdnYwB5xP',
            flags: { isSolflare: true },
            aliases: ['solflare'],
        },
        walletConnect: {
            name: 'Solflare',
            description: 'Solflare-compatible test wallet',
            url: 'https://solflare.com',
            icons: [],
        },
        ...overrides,
    }),
    ledger: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000111',
        name: 'Ledger Wallet',
        icon: svgIcon('LED', '1a1a1a'),
        rdns: 'com.ledger',
        flags: { isLedger: true, isLedgerWallet: true },
        walletConnect: {
            name: 'Ledger Wallet',
            description: 'Ledger-compatible test wallet',
            url: 'https://www.ledger.com',
            icons: [],
        },
        ...overrides,
    }),
    trezor: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000112',
        name: 'Trezor',
        icon: svgIcon('TRZ', '0f6148'),
        rdns: 'io.trezor',
        flags: { isTrezor: true },
        walletConnect: {
            name: 'Trezor',
            description: 'Trezor-compatible test wallet',
            url: 'https://trezor.io',
            icons: [],
        },
        ...overrides,
    }),
    safe: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000113',
        name: 'Safe',
        icon: svgIcon('SAFE', '12ff80', '111827'),
        rdns: 'global.safe',
        flags: { isSafe: true },
        walletConnect: {
            name: 'Safe',
            description: 'Safe-compatible test wallet',
            url: 'https://safe.global',
            icons: [],
        },
        ...overrides,
    }),
    bitget: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000114',
        name: 'Bitget Wallet',
        icon: svgIcon('BG', '00f0ff', '111827'),
        rdns: 'com.bitget.web3',
        flags: { isBitKeep: true, isBitgetWallet: true },
        aliases: ['bitkeep', 'bitkeep.ethereum'],
        walletConnect: {
            name: 'Bitget Wallet',
            description: 'Bitget Wallet-compatible test wallet',
            url: 'https://web3.bitget.com',
            icons: [],
            links: {
                mobile: 'bitkeep://wc?uri={uri}',
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    tokenPocket: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000115',
        name: 'TokenPocket',
        icon: svgIcon('TP', '2980fe'),
        rdns: 'pro.tokenpocket',
        flags: { isTokenPocket: true },
        aliases: ['tokenpocket', 'tokenpocket.ethereum'],
        walletConnect: {
            name: 'TokenPocket',
            description: 'TokenPocket-compatible test wallet',
            url: 'https://www.tokenpocket.pro',
            icons: [],
            links: {
                mobile: 'tpoutside://wc?uri={uri}',
            },
        },
        ...overrides,
    }),
    safePal: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000116',
        name: 'SafePal',
        icon: svgIcon('SP', '4a21ef'),
        rdns: 'com.safepal',
        flags: { isSafePal: true },
        aliases: ['safepalProvider'],
        solana: {
            publicKey: '7uLt9S3qJbXf6YoTvtWKybB7FKYSMNmV7oyG4iXKPrHM',
            flags: { isSafePal: true },
            aliases: ['safepal'],
        },
        walletConnect: {
            name: 'SafePal',
            description: 'SafePal-compatible test wallet',
            url: 'https://www.safepal.com',
            icons: [],
            links: {
                mobile: 'safepalwallet://wc?uri={uri}',
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    binance: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000117',
        name: 'Binance Wallet',
        icon: svgIcon('BNB', 'f3ba2f', '111827'),
        rdns: 'com.binance.wallet',
        flags: { isBinance: true, isExtension: true },
        aliases: ['binancew3w', 'binancew3w.ethereum'],
        walletConnect: {
            name: 'Binance Wallet',
            description: 'Binance Wallet-compatible test wallet',
            url: 'https://www.binance.com/en/binancewallet',
            icons: [],
            links: {
                mobile: 'bnc://app.binance.com/cedefi/wc?uri={uri}',
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    imToken: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000118',
        name: 'imToken',
        icon: svgIcon('IM', '098de6'),
        rdns: 'im.token',
        flags: { isImToken: true },
        aliases: ['imToken'],
        walletConnect: {
            name: 'imToken',
            description: 'imToken-compatible test wallet',
            url: 'https://token.im',
            icons: [],
            links: {
                mobile: 'imtokenv2://wc?uri={uri}',
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    mathWallet: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000119',
        name: 'MathWallet',
        icon: svgIcon('MTH', '2f72ff'),
        rdns: 'org.mathwallet',
        flags: { isMathWallet: true },
        walletConnect: {
            name: 'MathWallet',
            description: 'MathWallet-compatible test wallet',
            url: 'https://mathwallet.org',
            icons: [],
        },
        ...overrides,
    }),
    frame: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000120',
        name: 'Frame',
        icon: svgIcon('FRM', '121c20'),
        rdns: 'sh.frame',
        flags: { isFrame: true },
        walletConnect: {
            name: 'Frame',
            description: 'Frame-compatible test wallet',
            url: 'https://frame.sh',
            icons: [],
        },
        ...overrides,
    }),
    enkrypt: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000121',
        name: 'Enkrypt Wallet',
        icon: svgIcon('ENK', '111827', 'f3ff68'),
        rdns: 'com.enkrypt',
        flags: { isEnkrypt: true },
        aliases: ['enkrypt.providers.ethereum'],
        walletConnect: {
            name: 'Enkrypt Wallet',
            description: 'Enkrypt-compatible test wallet',
            url: 'https://www.enkrypt.com',
            icons: [],
        },
        ...overrides,
    }),
    core: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000122',
        name: 'Core',
        icon: svgIcon('COR', 'e84142'),
        rdns: 'app.core.extension',
        flags: { isAvalanche: true, isCoreWallet: true },
        aliases: ['avalanche'],
        walletConnect: {
            name: 'Core',
            description: 'Core Wallet-compatible test wallet',
            url: 'https://core.app',
            icons: [],
            links: {
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    frontier: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000123',
        name: 'Frontier Wallet',
        icon: svgIcon('FRT', 'cc703c'),
        rdns: 'xyz.frontier.wallet',
        flags: { isFrontier: true },
        aliases: ['frontier', 'frontier.ethereum'],
        walletConnect: {
            name: 'Frontier Wallet',
            description: 'Frontier Wallet-compatible test wallet',
            url: 'https://www.frontier.xyz',
            icons: [],
            links: {
                mobile: 'frontier://wc?uri={uri}',
                qrCode: '{rawUri}',
            },
        },
        ...overrides,
    }),
    oneKey: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000124',
        name: 'OneKey',
        icon: svgIcon('1K', '00b812', '111827'),
        rdns: 'so.onekey.app.wallet',
        flags: { isOneKey: true },
        aliases: ['$onekey', '$onekey.ethereum'],
        walletConnect: {
            name: 'OneKey',
            description: 'OneKey-compatible test wallet',
            url: 'https://www.onekey.so',
            icons: [],
        },
        ...overrides,
    }),
    ctrl: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000125',
        name: 'CTRL Wallet',
        icon: svgIcon('CTRL', 'f7f7f7', '111827'),
        rdns: 'xyz.ctrl',
        flags: { isCTRL: true, isXDEFI: true },
        aliases: ['ctrl', 'ctrl.ethereum', 'xfi', 'xfi.ethereum'],
        walletConnect: {
            name: 'CTRL Wallet',
            description: 'CTRL/XDEFI-compatible test wallet',
            url: 'https://ctrl.xyz',
            icons: [],
        },
        ...overrides,
    }),
    uniswap: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000127',
        name: 'Uniswap Wallet',
        icon: svgIcon('UNI', 'ff007a'),
        rdns: 'org.uniswap',
        flags: { isUniswapWallet: true },
        walletConnect: {
            name: 'Uniswap Wallet',
            description: 'Uniswap Wallet-compatible test wallet',
            url: 'https://wallet.uniswap.org',
            icons: [],
        },
        ...overrides,
    }),
    argent: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000128',
        name: 'Argent',
        icon: svgIcon('ARG', 'ff875b', '111827'),
        rdns: 'xyz.argent',
        flags: { isArgent: true },
        walletConnect: {
            name: 'Argent',
            description: 'Argent-compatible test wallet',
            url: 'https://www.argent.xyz',
            icons: [],
        },
        ...overrides,
    }),
    exodus: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000129',
        name: 'Exodus Web3 Wallet',
        icon: svgIcon('EXO', '7b3ff2'),
        rdns: 'com.exodus',
        flags: { isExodus: true },
        walletConnect: {
            name: 'Exodus Web3 Wallet',
            description: 'Exodus-compatible test wallet',
            url: 'https://www.exodus.com/web3-wallet',
            icons: [],
        },
        ...overrides,
    }),
    fireblocks: (overrides = {}) => createWalletPersona({
        uuid: '00000000-0000-4000-8000-000000000130',
        name: 'Fireblocks DeFi',
        icon: svgIcon('FIR', '4f46e5'),
        rdns: 'com.fireblocks',
        flags: { isFireblocks: true },
        walletConnect: {
            name: 'Fireblocks DeFi',
            description: 'Fireblocks DeFi-compatible test wallet',
            url: 'https://www.fireblocks.com',
            icons: [],
        },
        ...overrides,
    }),
};
export const majorWalletPersonas = () => [
    walletPersonas.metamask(),
    walletPersonas.rabby(),
    walletPersonas.coinbase(),
    walletPersonas.phantomEvm(),
    walletPersonas.rainbow(),
    walletPersonas.okx(),
    walletPersonas.trust(),
    walletPersonas.brave(),
    walletPersonas.zerion(),
    walletPersonas.backpack(),
    walletPersonas.solflare(),
    walletPersonas.ledger(),
    walletPersonas.trezor(),
    walletPersonas.safe(),
    walletPersonas.bitget(),
    walletPersonas.tokenPocket(),
    walletPersonas.safePal(),
    walletPersonas.binance(),
    walletPersonas.imToken(),
    walletPersonas.mathWallet(),
    walletPersonas.frame(),
    walletPersonas.enkrypt(),
    walletPersonas.core(),
    walletPersonas.frontier(),
    walletPersonas.oneKey(),
    walletPersonas.ctrl(),
    walletPersonas.uniswap(),
    walletPersonas.argent(),
    walletPersonas.exodus(),
    walletPersonas.fireblocks(),
];
const personaProfile = (persona) => ({ persona });
export const walletProfiles = {
    mock: (options = {}) => personaProfile(walletPersonas.mock(options.persona)),
    metamask: (options = {}) => personaProfile(walletPersonas.metamask(options.persona)),
    rabby: (options = {}) => personaProfile(walletPersonas.rabby(options.persona)),
    coinbase: (options = {}) => ({
        persona: walletPersonas.coinbase(options.persona),
        ...(options.coinbase !== undefined ? { coinbase: options.coinbase } : {}),
    }),
    phantomEvm: (options = {}) => personaProfile(walletPersonas.phantomEvm(options.persona)),
    rainbow: (options = {}) => personaProfile(walletPersonas.rainbow(options.persona)),
    okx: (options = {}) => personaProfile(walletPersonas.okx(options.persona)),
    trust: (options = {}) => personaProfile(walletPersonas.trust(options.persona)),
    brave: (options = {}) => personaProfile(walletPersonas.brave(options.persona)),
    zerion: (options = {}) => personaProfile(walletPersonas.zerion(options.persona)),
    backpack: (options = {}) => personaProfile(walletPersonas.backpack(options.persona)),
    solflare: (options = {}) => personaProfile(walletPersonas.solflare(options.persona)),
    ledger: (options = {}) => ({
        persona: walletPersonas.ledger(options.persona),
        hardwareWallet: options.hardwareWallet ?? true,
    }),
    trezor: (options = {}) => ({
        persona: walletPersonas.trezor(options.persona),
        hardwareWallet: options.hardwareWallet ?? true,
    }),
    safe: (options = {}) => personaProfile(walletPersonas.safe(options.persona)),
    bitget: (options = {}) => personaProfile(walletPersonas.bitget(options.persona)),
    tokenPocket: (options = {}) => personaProfile(walletPersonas.tokenPocket(options.persona)),
    safePal: (options = {}) => personaProfile(walletPersonas.safePal(options.persona)),
    binance: (options = {}) => personaProfile(walletPersonas.binance(options.persona)),
    imToken: (options = {}) => personaProfile(walletPersonas.imToken(options.persona)),
    mathWallet: (options = {}) => personaProfile(walletPersonas.mathWallet(options.persona)),
    frame: (options = {}) => personaProfile(walletPersonas.frame(options.persona)),
    enkrypt: (options = {}) => personaProfile(walletPersonas.enkrypt(options.persona)),
    core: (options = {}) => personaProfile(walletPersonas.core(options.persona)),
    frontier: (options = {}) => personaProfile(walletPersonas.frontier(options.persona)),
    oneKey: (options = {}) => personaProfile(walletPersonas.oneKey(options.persona)),
    ctrl: (options = {}) => personaProfile(walletPersonas.ctrl(options.persona)),
    uniswap: (options = {}) => personaProfile(walletPersonas.uniswap(options.persona)),
    argent: (options = {}) => personaProfile(walletPersonas.argent(options.persona)),
    exodus: (options = {}) => personaProfile(walletPersonas.exodus(options.persona)),
    fireblocks: (options = {}) => personaProfile(walletPersonas.fireblocks(options.persona)),
};
export function createWalletPersona(input) {
    const baseInfo = {
        uuid: input.uuid ?? '00000000-0000-4000-8000-ffffffffffff',
        name: input.name ?? 'Mock Wallet',
        icon: input.icon ?? svgIcon(input.name ?? 'Wallet', '111827'),
        rdns: input.rdns ?? 'dev.invisible-wallet.mock',
    };
    return {
        ...baseInfo,
        ...(input.evm !== undefined ? { evm: input.evm } : {}),
        ...(input.flags ? { flags: { ...input.flags } } : {}),
        ...(input.aliases ? { aliases: [...input.aliases] } : {}),
        ...(input.solana
            ? {
                solana: {
                    ...input.solana,
                    ...(input.solana.chains ? { chains: [...input.solana.chains] } : {}),
                    ...(input.solana.flags ? { flags: { ...input.solana.flags } } : {}),
                    ...(input.solana.aliases ? { aliases: [...input.solana.aliases] } : {}),
                },
            }
            : {}),
        ...(input.walletConnect
            ? {
                walletConnect: {
                    ...input.walletConnect,
                    ...(input.walletConnect.links ? { links: { ...input.walletConnect.links } } : {}),
                },
            }
            : {}),
    };
}
export function walletPersonaToProviderInfo(persona) {
    return {
        uuid: persona.uuid,
        name: persona.name,
        icon: persona.icon,
        rdns: persona.rdns,
    };
}
export function walletConnectMetadataForPersona(persona) {
    return {
        name: persona.walletConnect?.name ?? persona.name,
        description: persona.walletConnect?.description ?? `${persona.name} test wallet powered by web3-tester`,
        url: persona.walletConnect?.url ?? 'https://github.com/AndyMarigoldLabs/web3-tester',
        icons: persona.walletConnect?.icons ?? (persona.icon ? [persona.icon] : []),
    };
}
export function walletConnectLinksForPersona(persona) {
    return { ...(persona.walletConnect?.links ?? {}) };
}
export function formatWalletConnectUriForPersona(uri, persona, target = 'mobile') {
    const links = persona.walletConnect?.links;
    const template = links?.[target] ??
        (target === 'mobile' ? links?.universal ?? links?.native : undefined) ??
        (target === 'qrCode' ? links?.qrCode : undefined);
    if (!template) {
        return uri;
    }
    return template
        .replaceAll('{rawUri}', uri)
        .replaceAll('{uri}', encodeURIComponent(uri));
}
//# sourceMappingURL=wallet-personas.js.map