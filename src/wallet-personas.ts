import type { WalletProviderIdentity, WalletProviderInfo } from './types.js';
import type {
  CoinbaseWalletSimulationOptions,
  HardwareWalletSimulationOptions,
  MockWalletControllerOptions,
} from './mock-wallet-controller.js';

export type WalletConnectPersonaMetadata = {
  name: string;
  description: string;
  url: string;
  icons: string[];
  links?: WalletConnectPersonaLinks;
};

export type WalletConnectLinkTarget =
  | 'mobile'
  | 'qrCode'
  | 'desktop'
  | 'universal'
  | 'native';

export type WalletConnectPersonaLinks = Partial<Record<WalletConnectLinkTarget, string>>;

export type WalletPersona = WalletProviderIdentity & {
  walletConnect?: Partial<WalletConnectPersonaMetadata>;
};

export type WalletPersonaInput = Partial<WalletPersona>;

export type WalletControllerProfile = Pick<
  MockWalletControllerOptions,
  'persona' | 'hardwareWallet' | 'coinbase'
>;

export type WalletProfileOptions = {
  persona?: WalletPersonaInput;
};

export type HardwareWalletProfileOptions = WalletProfileOptions & {
  hardwareWallet?: boolean | HardwareWalletSimulationOptions;
};

export type CoinbaseWalletProfileOptions = WalletProfileOptions & {
  coinbase?: boolean | CoinbaseWalletSimulationOptions;
};

const svgIcon = (label: string, background: string, foreground = 'ffffff'): string => {
  const initials = encodeURIComponent(label.slice(0, 3).toUpperCase());
  return (
    'data:image/svg+xml,' +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="%23${background}"/>` +
    `<text x="32" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="%23${foreground}">${initials}</text>` +
    `</svg>`
  );
};

export const mockWalletPersona = (overrides: WalletPersonaInput = {}): WalletPersona =>
  createWalletPersona({
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
  metamask: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  rabby: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  coinbase: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  phantomEvm: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  rainbow: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  okx: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  trust: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  brave: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  zerion: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  backpack: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  solflare: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  ledger: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  trezor: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  safe: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  bitget: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  tokenPocket: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  safePal: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  binance: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  imToken: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  mathWallet: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  frame: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  enkrypt: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  core: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  frontier: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  oneKey: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  ctrl: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  uniswap: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  argent: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  exodus: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
  fireblocks: (overrides: WalletPersonaInput = {}): WalletPersona =>
    createWalletPersona({
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
} as const;

export const majorWalletPersonas = (): WalletPersona[] => [
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

const personaProfile = (persona: WalletPersona): WalletControllerProfile => ({ persona });

export const walletProfiles = {
  mock: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.mock(options.persona)),
  metamask: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.metamask(options.persona)),
  rabby: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.rabby(options.persona)),
  coinbase: (options: CoinbaseWalletProfileOptions = {}): WalletControllerProfile => ({
    persona: walletPersonas.coinbase(options.persona),
    ...(options.coinbase !== undefined ? { coinbase: options.coinbase } : {}),
  }),
  phantomEvm: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.phantomEvm(options.persona)),
  rainbow: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.rainbow(options.persona)),
  okx: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.okx(options.persona)),
  trust: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.trust(options.persona)),
  brave: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.brave(options.persona)),
  zerion: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.zerion(options.persona)),
  backpack: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.backpack(options.persona)),
  solflare: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.solflare(options.persona)),
  ledger: (options: HardwareWalletProfileOptions = {}): WalletControllerProfile => ({
    persona: walletPersonas.ledger(options.persona),
    hardwareWallet: options.hardwareWallet ?? true,
  }),
  trezor: (options: HardwareWalletProfileOptions = {}): WalletControllerProfile => ({
    persona: walletPersonas.trezor(options.persona),
    hardwareWallet: options.hardwareWallet ?? true,
  }),
  safe: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.safe(options.persona)),
  bitget: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.bitget(options.persona)),
  tokenPocket: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.tokenPocket(options.persona)),
  safePal: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.safePal(options.persona)),
  binance: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.binance(options.persona)),
  imToken: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.imToken(options.persona)),
  mathWallet: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.mathWallet(options.persona)),
  frame: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.frame(options.persona)),
  enkrypt: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.enkrypt(options.persona)),
  core: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.core(options.persona)),
  frontier: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.frontier(options.persona)),
  oneKey: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.oneKey(options.persona)),
  ctrl: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.ctrl(options.persona)),
  uniswap: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.uniswap(options.persona)),
  argent: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.argent(options.persona)),
  exodus: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.exodus(options.persona)),
  fireblocks: (options: WalletProfileOptions = {}): WalletControllerProfile =>
    personaProfile(walletPersonas.fireblocks(options.persona)),
} as const;

export function createWalletPersona(input: WalletPersonaInput): WalletPersona {
  const baseInfo: WalletProviderInfo = {
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

export function walletPersonaToProviderInfo(persona: WalletPersona): WalletProviderInfo {
  return {
    uuid: persona.uuid,
    name: persona.name,
    icon: persona.icon,
    rdns: persona.rdns,
  };
}

export function walletConnectMetadataForPersona(
  persona: WalletPersona,
): Omit<WalletConnectPersonaMetadata, 'links'> {
  return {
    name: persona.walletConnect?.name ?? persona.name,
    description:
      persona.walletConnect?.description ?? `${persona.name} test wallet powered by web3-tester`,
    url: persona.walletConnect?.url ?? 'https://github.com/AndyMarigoldLabs/web3-tester',
    icons: persona.walletConnect?.icons ?? (persona.icon ? [persona.icon] : []),
  };
}

export function walletConnectLinksForPersona(persona: WalletPersona): WalletConnectPersonaLinks {
  return { ...(persona.walletConnect?.links ?? {}) };
}

export function formatWalletConnectUriForPersona(
  uri: string,
  persona: WalletPersona,
  target: WalletConnectLinkTarget = 'mobile',
): string {
  const links = persona.walletConnect?.links;
  const template =
    links?.[target] ??
    (target === 'mobile' ? links?.universal ?? links?.native : undefined) ??
    (target === 'qrCode' ? links?.qrCode : undefined);

  if (!template) {
    return uri;
  }

  return template
    .replaceAll('{rawUri}', uri)
    .replaceAll('{uri}', encodeURIComponent(uri));
}
