const BRIDGE_NAME = '__invisibleWalletRpcBridge';
const EMITTER_NAME = '__invisibleWalletEmit';
export const rpcBridgeName = BRIDGE_NAME;
export const emitterName = EMITTER_NAME;
export const buildInjectedProviderScript = (config) => `
(() => {
  const config = ${JSON.stringify(config)};

  // Origin-scoped wallets never install in out-of-scope frames, so blocked
  // pages cannot even read the account address or chain off the provider.
  // window.origin (unlike location.origin or the frame URL) is the security
  // origin, which about:blank/srcdoc children inherit from their parent —
  // matching the bridge-side ancestor walk.
  if (config.allowedOrigins && !config.allowedOrigins.includes(window.origin || location.origin)) {
    return;
  }

  const toNetworkVersion = (chainId) => String(Number(BigInt(chainId)));

  const walletError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
  };

  const createPublicKey = (value) => Object.freeze({
    toString: () => value,
    toBase58: () => value,
    equals: (other) => {
      const otherValue =
        typeof other === 'string'
          ? other
          : typeof other?.toBase58 === 'function'
            ? other.toBase58()
            : typeof other?.toString === 'function'
              ? other.toString()
              : '';
      return otherValue === value;
    },
    toBytes: () => base58Decode(value),
    toJSON: () => value,
  });

  const base58Decode = (value) => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes = [0];
    for (const char of String(value)) {
      const carryStart = alphabet.indexOf(char);
      if (carryStart === -1) {
        return new TextEncoder().encode(String(value)).slice(0, 32);
      }
      let carry = carryStart;
      for (let index = 0; index < bytes.length; index += 1) {
        const next = bytes[index] * 58 + carry;
        bytes[index] = next & 0xff;
        carry = next >> 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (const char of String(value)) {
      if (char !== '1') break;
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  };

  const bytesFrom = (input) => {
    if (input instanceof Uint8Array) {
      return [...input];
    }
    if (input instanceof ArrayBuffer) {
      return [...new Uint8Array(input)];
    }
    if (ArrayBuffer.isView(input)) {
      return [...new Uint8Array(input.buffer, input.byteOffset, input.byteLength)];
    }
    if (Array.isArray(input)) {
      return input.map((value) => Number(value) & 255);
    }
    if (typeof input === 'string') {
      return [...new TextEncoder().encode(input)];
    }
    return [...new TextEncoder().encode(JSON.stringify(input ?? null))];
  };

  const deterministicSignature = (publicKey, payload) => {
    const seed = [...new TextEncoder().encode(publicKey), ...bytesFrom(payload)];
    const signature = new Uint8Array(64);
    for (let index = 0; index < signature.length; index += 1) {
      const a = seed[index % seed.length] ?? 0;
      const b = seed[(index * 7 + 13) % seed.length] ?? 0;
      signature[index] = (a + b + index * 17) & 255;
    }
    return signature;
  };

  const hexToBytes = (hex) => {
    const value = String(hex).replace(/^0x/u, '');
    const bytes = new Uint8Array(Math.floor(value.length / 2));
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  };

  // EIP-1193 connectivity means "can the provider reach the chain", which is
  // independent of account authorization. The controller's disconnect()
  // simulates losing the chain via the 'disconnect' event.
  let chainDisconnected = false;

  const request = async (args) => {
    if (!args || typeof args.method !== 'string') {
      const error = new Error('Invalid EIP-1193 request');
      error.code = -32600;
      throw error;
    }

    const response = await window.${BRIDGE_NAME}({
      method: args.method,
      params: args.params ?? [],
    });

    if (!response.ok) {
      const error = new Error(response.error.message);
      error.code = response.error.code;
      error.data = response.error.data;
      throw error;
    }

    return response.result;
  };

  // One distinct provider object per announced wallet so selector tests can
  // detect a dapp talking to the wrong provider. They share request handling
  // and state, but each has its own identity and listener registry.
  const createProviderEntry = (providerConfig) => {
    const { evm = true, flags = {}, aliases = [], solana, ...info } = providerConfig;
    const providerInfo = Object.freeze({ ...info });
    const listeners = new Map();

    const getListeners = (event) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      return listeners.get(event);
    };

    const responseForPayload = (payload, result) => ({
      id: payload.id,
      jsonrpc: payload.jsonrpc ?? '2.0',
      result,
    });

    const errorResponseForPayload = (payload, error) => {
      const rpcError = {
        code: typeof error?.code === 'number' ? error.code : -32603,
        message:
          typeof error?.message === 'string' ? error.message : 'Internal JSON-RPC error',
      };
      if (error?.data !== undefined) {
        rpcError.data = error.data;
      }
      return {
        id: payload.id,
        jsonrpc: payload.jsonrpc ?? '2.0',
        error: rpcError,
      };
    };

    const requestBatch = (payloads) =>
      Promise.all(payloads.map((payload) => request(payload)));

    const requestBatchResponses = (payloads) =>
      Promise.all(
        payloads.map(async (payload) => {
          try {
            return responseForPayload(payload, await request(payload));
          } catch (error) {
            return errorResponseForPayload(payload, error);
          }
        }),
      );

    const provider = {
      info: providerInfo,
      selectedAddress:
        config.connected && config.unlocked && config.accounts.length > 0 ? config.accounts[0] : null,
      chainId: config.chainId,
      networkVersion: toNetworkVersion(config.chainId),
      request,
      isConnected: () => !chainDisconnected,
      enable: () => request({ method: 'eth_requestAccounts' }),
      send: (methodOrPayload, paramsOrCallback) => {
        if (typeof methodOrPayload === 'string') {
          return request({ method: methodOrPayload, params: paramsOrCallback });
        }

        const payload = methodOrPayload;
        const callback = paramsOrCallback;
        if (typeof callback !== 'function') {
          return Array.isArray(payload) ? requestBatch(payload) : request(payload);
        }
        const promise = Array.isArray(payload)
          ? requestBatchResponses(payload)
          : request(payload).then((result) => responseForPayload(payload, result));
        promise
          .then((response) => callback?.(null, response))
          .catch((error) => callback?.(error, null));
        return undefined;
      },
      sendAsync: (payload, callback) => {
        const promise = Array.isArray(payload)
          ? requestBatchResponses(payload)
          : request(payload).then((result) => responseForPayload(payload, result));
        promise
          .then((response) => callback(null, response))
          .catch((error) => callback(error, null));
      },
      on: (event, handler) => {
        getListeners(event).add(handler);
        if (event === 'connect' && config.connected && !chainDisconnected) {
          setTimeout(() => {
            if (listeners.get(event)?.has(handler)) {
              handler({ chainId: provider.chainId });
            }
          }, 0);
        }
        return provider;
      },
      addListener: (event, handler) => provider.on(event, handler),
      once: (event, handler) => {
        const wrapped = (payload) => {
          provider.removeListener(event, wrapped);
          handler(payload);
        };
        provider.on(event, wrapped);
        return provider;
      },
      removeListener: (event, handler) => {
        listeners.get(event)?.delete(handler);
        return provider;
      },
      off: (event, handler) => provider.removeListener(event, handler),
      removeAllListeners: (event) => {
        if (event) {
          listeners.delete(event);
        } else {
          listeners.clear();
        }
        return provider;
      },
      listeners: (event) => [...(listeners.get(event) ?? [])],
      listenerCount: (event) => listeners.get(event)?.size ?? 0,
    };

    for (const [flag, value] of Object.entries(flags)) {
      Object.defineProperty(provider, flag, {
        value: Boolean(value),
        configurable: true,
        enumerable: true,
      });
    }

    if (flags.isMetaMask) {
      Object.defineProperty(provider, '_metamask', {
        value: {
          isUnlocked: async () => {
            try {
              const state = await request({ method: 'metamask_getProviderState' });
              return state.isUnlocked === true;
            } catch {
              return config.unlocked === true;
            }
          },
        },
        configurable: true,
        enumerable: true,
      });
    }

    return { info: providerInfo, provider, listeners, aliases, solana, evm: evm !== false };
  };

  const createSolanaProvider = (entry) => {
    const solanaConfig = entry.solana;
    if (!solanaConfig) {
      return undefined;
    }

    const listeners = new Map();
    const standardListeners = new Map();
    const publicKeyValue =
      solanaConfig.publicKey ?? '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo';
    const publicKey = createPublicKey(publicKeyValue);
    const solanaChains = Object.freeze(
      solanaConfig.chains ?? ['solana:mainnet', 'solana:devnet', 'solana:testnet'],
    );
    const solanaAccountFeatures = Object.freeze([
      'solana:signAndSendTransaction',
      'solana:signIn',
      'solana:signMessage',
      'solana:signTransaction',
    ]);
    const standardAccount = Object.freeze({
      address: publicKeyValue,
      publicKey: base58Decode(publicKeyValue),
      chains: solanaChains,
      features: solanaAccountFeatures,
      label: entry.info.name,
      icon: entry.info.icon,
    });
    let connected = false;
    let trusted = false;
    let hiddenByController = false;

    const getListeners = (event) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      return listeners.get(event);
    };

    const emitSolana = (event, payload) => {
      const callbacks = listeners.get(event);
      if (!callbacks) {
        return;
      }
      for (const callback of [...callbacks]) {
        callback(payload);
      }
    };

    const emitStandardChange = (properties) => {
      const callbacks = standardListeners.get('change');
      if (!callbacks) {
        return;
      }
      for (const callback of [...callbacks]) {
        callback(properties);
      }
    };

    const standardOn = (event, handler) => {
      if (!standardListeners.has(event)) {
        standardListeners.set(event, new Set());
      }
      standardListeners.get(event).add(handler);
      return () => standardListeners.get(event)?.delete(handler);
    };

    const ensureConnected = () => {
      if (!connected) {
        throw walletError(4100, 'The Solana wallet is not connected.');
      }
    };

    const visibleAccounts = () => (connected ? [publicKeyValue] : []);
    const visibleAccountObjects = () =>
      connected
        ? [
            Object.freeze({
              publicKey,
              pubkey: publicKeyValue,
              address: publicKeyValue,
            }),
          ]
        : [];

    const ensureStandardAccount = (account) => {
      if (account?.address && account.address !== publicKeyValue) {
        throw walletError(4100, 'The Solana wallet cannot use the requested account.');
      }
    };

    const transactionsFromParams = (params) => {
      if (Array.isArray(params)) {
        return params;
      }
      if (Array.isArray(params?.transactions)) {
        return params.transactions;
      }
      if (Array.isArray(params?.message)) {
        return params.message;
      }
      if (Array.isArray(params?.[0])) {
        return params[0];
      }
      return [];
    };

    const buildSignInMessage = (input = {}) => {
      const address = input.address ?? publicKeyValue;
      const domain = input.domain ?? window.location.host ?? 'localhost';
      const statement = input.statement ?? 'Sign in with Solana.';
      const lines = [
        \`\${domain} wants you to sign in with your Solana account:\`,
        address,
        '',
        statement,
      ];
      const fields = [
        ['URI', input.uri],
        ['Version', input.version],
        ['Chain ID', input.chainId],
        ['Nonce', input.nonce],
        ['Issued At', input.issuedAt],
        ['Expiration Time', input.expirationTime],
        ['Not Before', input.notBefore],
        ['Request ID', input.requestId],
      ];
      for (const [label, value] of fields) {
        if (value !== undefined) {
          lines.push(\`\${label}: \${value}\`);
        }
      }
      if (Array.isArray(input.resources) && input.resources.length > 0) {
        lines.push('Resources:');
        for (const resource of input.resources) {
          lines.push(\`- \${resource}\`);
        }
      }
      return new TextEncoder().encode(lines.join('\\n'));
    };

    const provider = {
      info: entry.info,
      publicKey: null,
      isConnected: false,
      connect: async (options = {}) => {
        if (options?.onlyIfTrusted && !trusted) {
          throw walletError(4001, 'User rejected the request.');
        }
        if (!trusted) {
          await request({
            method: 'solana_requestAccounts',
            params: { publicKey: publicKeyValue },
          });
        }
        const wasConnected = connected;
        connected = true;
        trusted = true;
        provider.isConnected = true;
        provider.publicKey = publicKey;
        if (!wasConnected) {
          emitSolana('connect', publicKey);
          emitStandardChange({ accounts: standardWallet.accounts });
        }
        return { publicKey };
      },
      disconnect: async () => {
        const wasConnected = connected;
        connected = false;
        hiddenByController = false;
        provider.isConnected = false;
        provider.publicKey = null;
        if (wasConnected) {
          emitSolana('disconnect');
          emitStandardChange({ accounts: standardWallet.accounts });
        }
      },
      request: async ({ method, params } = {}) => {
        switch (method) {
          case 'connect':
            return provider.connect(params ?? {});
          case 'disconnect':
            await provider.disconnect();
            return null;
          case 'getAccounts':
            return visibleAccounts();
          case 'requestAccounts':
            await provider.connect(params ?? {});
            return visibleAccounts();
          case 'solana_getAccounts':
            return visibleAccountObjects();
          case 'solana_requestAccounts':
            await provider.connect(params ?? {});
            return visibleAccountObjects();
          case 'signMessage':
          case 'solana_signMessage':
            return provider.signMessage(params?.message ?? params?.[0] ?? new Uint8Array());
          case 'signTransaction':
          case 'solana_signTransaction':
            return provider.signTransaction(params?.transaction ?? params?.message ?? params?.[0]);
          case 'signAllTransactions':
          case 'solana_signAllTransactions':
            return provider.signAllTransactions(transactionsFromParams(params));
          case 'signAndSendTransaction':
          case 'solana_signAndSendTransaction':
            return provider.signAndSendTransaction(params?.transaction ?? params?.message ?? params?.[0]);
          case 'signAndSendAllTransactions':
          case 'solana_signAndSendAllTransactions':
            return provider.signAndSendAllTransactions(transactionsFromParams(params));
          case 'signIn':
          case 'solana_signIn':
            return provider.signIn(params ?? {});
          default:
            throw walletError(4200, \`The Solana wallet does not support the method "\${String(method)}".\`);
        }
      },
      signIn: async (input = {}) => {
        if (!connected) {
          await provider.connect();
        }
        const signedMessage = buildSignInMessage(input);
        await request({
          method: 'solana_signIn',
          params: { input, publicKey: publicKeyValue, message: [...signedMessage] },
        });
        return {
          address: input.address ?? publicKeyValue,
          publicKey,
          signedMessage,
          signature: deterministicSignature(publicKeyValue, signedMessage),
        };
      },
      signMessage: async (message) => {
        ensureConnected();
        await request({
          method: 'solana_signMessage',
          params: { message, pubkey: publicKeyValue },
        });
        return {
          publicKey,
          signature: deterministicSignature(publicKeyValue, message),
        };
      },
      signTransaction: async (transaction) => {
        ensureConnected();
        await request({
          method: 'solana_signTransaction',
          params: { transaction, pubkey: publicKeyValue },
        });
        return transaction;
      },
      signAllTransactions: async (transactions) => {
        ensureConnected();
        await request({
          method: 'solana_signAllTransactions',
          params: { transactions, pubkey: publicKeyValue },
        });
        return transactions;
      },
      signAndSendTransaction: async (transaction) => {
        ensureConnected();
        await request({
          method: 'solana_signAndSendTransaction',
          params: { transaction, pubkey: publicKeyValue },
        });
        const signature = deterministicSignature(publicKeyValue, transaction);
        return {
          signature: Array.from(signature)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(''),
        };
      },
      signAndSendAllTransactions: async (transactions) => {
        ensureConnected();
        const list = Array.isArray(transactions) ? transactions : [];
        await request({
          method: 'solana_signAndSendAllTransactions',
          params: { transactions: list, pubkey: publicKeyValue },
        });
        return {
          publicKey,
          signatures: list.map((transaction) =>
            Array.from(deterministicSignature(publicKeyValue, transaction))
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join(''),
          ),
        };
      },
      on: (event, handler) => {
        getListeners(event).add(handler);
        return provider;
      },
      addListener: (event, handler) => provider.on(event, handler),
      once: (event, handler) => {
        const wrapped = (payload) => {
          provider.removeListener(event, wrapped);
          handler(payload);
        };
        provider.on(event, wrapped);
        return provider;
      },
      removeListener: (event, handler) => {
        listeners.get(event)?.delete(handler);
        return provider;
      },
      off: (event, handler) => provider.removeListener(event, handler),
      removeAllListeners: (event) => {
        if (event) {
          listeners.delete(event);
        } else {
          listeners.clear();
        }
        return provider;
      },
      listeners: (event) => [...(listeners.get(event) ?? [])],
      listenerCount: (event) => listeners.get(event)?.size ?? 0,
    };

    const hideFromController = () => {
      if (!connected) {
        return;
      }

      connected = false;
      hiddenByController = true;
      provider.isConnected = false;
      provider.publicKey = null;
      emitSolana('accountChanged', null);
      emitStandardChange({ accounts: standardWallet.accounts });
    };

    const restoreFromController = () => {
      if (!hiddenByController) {
        return;
      }

      hiddenByController = false;
      connected = true;
      trusted = true;
      provider.isConnected = true;
      provider.publicKey = publicKey;
      emitSolana('accountChanged', publicKey);
      emitStandardChange({ accounts: standardWallet.accounts });
    };

    const disconnectFromController = () => {
      const wasVisible = connected;
      const shouldEmitDisconnect = connected || hiddenByController;
      connected = false;
      hiddenByController = false;
      provider.isConnected = false;
      provider.publicKey = null;
      if (wasVisible) {
        emitSolana('accountChanged', null);
        emitStandardChange({ accounts: standardWallet.accounts });
      }
      if (shouldEmitDisconnect) {
        emitSolana('disconnect');
      }
    };

    const handleControllerEvent = (event, payload) => {
      if (event === 'accountsChanged') {
        if (Array.isArray(payload) && payload.length > 0) {
          restoreFromController();
        } else {
          hideFromController();
        }
      }
      if (event === 'disconnect') {
        disconnectFromController();
      }
    };

    const standardWallet = Object.freeze({
      version: '1.0.0',
      name: entry.info.name,
      icon: entry.info.icon,
      chains: solanaChains,
      get accounts() {
        return connected ? Object.freeze([standardAccount]) : Object.freeze([]);
      },
      features: Object.freeze({
        'standard:connect': Object.freeze({
          version: '1.0.0',
          connect: async (input = {}) => {
            await provider.connect({ onlyIfTrusted: input?.silent === true });
            return { accounts: standardWallet.accounts };
          },
        }),
        'standard:disconnect': Object.freeze({
          version: '1.0.0',
          disconnect: async () => {
            await provider.disconnect();
          },
        }),
        'standard:events': Object.freeze({
          version: '1.0.0',
          on: standardOn,
        }),
        'solana:signIn': Object.freeze({
          version: '1.0.0',
          signIn: async (...inputs) => {
            const signInInputs = inputs.length > 0 ? inputs : [{}];
            return Promise.all(signInInputs.map(async (input) => {
              const result = await provider.signIn(input);
              return {
                account: standardAccount,
                signedMessage: result.signedMessage,
                signature: result.signature,
              };
            }));
          },
        }),
        'solana:signMessage': Object.freeze({
          version: '1.1.0',
          signMessage: async (...inputs) => {
            return Promise.all(inputs.map(async (input) => {
              ensureStandardAccount(input.account);
              const result = await provider.signMessage(input.message);
              return {
                signedMessage: input.message,
                signature: result.signature,
              };
            }));
          },
        }),
        'solana:signTransaction': Object.freeze({
          version: '1.0.0',
          supportedTransactionVersions: Object.freeze(['legacy', 0]),
          signTransaction: async (...inputs) => {
            return Promise.all(inputs.map(async (input) => {
              ensureStandardAccount(input.account);
              const signedTransaction = await provider.signTransaction(input.transaction);
              return {
                signedTransaction,
              };
            }));
          },
        }),
        'solana:signAndSendTransaction': Object.freeze({
          version: '1.0.0',
          supportedTransactionVersions: Object.freeze(['legacy', 0]),
          signAndSendTransaction: async (...inputs) => {
            return Promise.all(inputs.map(async (input) => {
              ensureStandardAccount(input.account);
              const result = await provider.signAndSendTransaction(input.transaction);
              return {
                signature: hexToBytes(result.signature),
              };
            }));
          },
        }),
      }),
    });

    for (const [flag, value] of Object.entries(solanaConfig.flags ?? {})) {
      Object.defineProperty(provider, flag, {
        value: Boolean(value),
        configurable: true,
        enumerable: true,
      });
    }

    return { provider, aliases: solanaConfig.aliases ?? [], standardWallet, handleControllerEvent };
  };

  const registerStandardWallet = (wallet) => {
    const register = (api) => {
      if (api && typeof api.register === 'function') {
        api.register(wallet);
      }
    };
    window.addEventListener('wallet-standard:app-ready', (event) => register(event.detail));
    window.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', {
        detail: register,
      }),
    );
  };

  const entries = config.providers.map(createProviderEntry);
  const evmEntries = entries.filter((entry) => entry.evm);
  const solanaEntries = entries
    .map((entry) => createSolanaProvider(entry))
    .filter(Boolean);
  if (evmEntries.length > 1) {
    const providers = evmEntries.map((entry) => entry.provider);
    for (const entry of evmEntries) {
      Object.defineProperty(entry.provider, 'providers', {
        value: providers,
        configurable: true,
        enumerable: true,
      });
    }
  }

  const emit = (event, payload) => {
    if (event === 'connect') {
      chainDisconnected = false;
    }
    if (event === 'disconnect') {
      chainDisconnected = true;
    }

    for (const entry of evmEntries) {
      if (event === 'accountsChanged') {
        entry.provider.selectedAddress =
          Array.isArray(payload) && payload.length > 0 ? payload[0] : null;
      }

      if (event === 'chainChanged') {
        entry.provider.chainId = payload;
        entry.provider.networkVersion = toNetworkVersion(payload);
      }

      const callbacks = entry.listeners.get(event);
      if (callbacks) {
        for (const callback of [...callbacks]) {
          callback(payload);
        }
      }

      if (event === 'chainChanged') {
        const networkCallbacks = entry.listeners.get('networkChanged');
        if (networkCallbacks) {
          for (const callback of [...networkCallbacks]) {
            callback(entry.provider.networkVersion);
          }
        }
      }
    }

    for (const entry of solanaEntries) {
      entry.handleControllerEvent(event, payload);
    }
  };

  const announceProviders = () => {
    for (const entry of evmEntries) {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({
            info: Object.freeze({ ...entry.info }),
            provider: entry.provider,
          }),
        }),
      );
    }
  };

  if (evmEntries[0]) {
    Object.defineProperty(window, 'ethereum', {
      value: evmEntries[0].provider,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }

  const assignProviderAlias = (path, provider) => {
    const parts = String(path).split('.').filter(Boolean);
    if (parts.length === 0 || (parts.length === 1 && parts[0] === 'ethereum')) {
      return;
    }

    let target = window;
    for (const part of parts.slice(0, -1)) {
      const current = target[part];
      if (
        current === null ||
        (typeof current !== 'object' && typeof current !== 'function')
      ) {
        Object.defineProperty(target, part, {
          value: {},
          configurable: true,
          enumerable: true,
          writable: true,
        });
      }
      target = target[part];
    }

    Object.defineProperty(target, parts[parts.length - 1], {
      value: provider,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  };

  for (const entry of evmEntries) {
    for (const alias of entry.aliases) {
      assignProviderAlias(alias, entry.provider);
    }
  }

  for (const entry of solanaEntries) {
    for (const alias of entry.aliases) {
      assignProviderAlias(alias, entry.provider);
    }
    registerStandardWallet(entry.standardWallet);
  }

  Object.defineProperty(window, '${EMITTER_NAME}', {
    value: emit,
    configurable: true,
  });

  window.addEventListener('eip6963:requestProvider', announceProviders);
  queueMicrotask(announceProviders);

  // The serialized config snapshot goes stale once the controller mutates
  // accounts or chain and the page navigates; refresh the synchronous mirror
  // properties from the wallet's current state as soon as the bridge is up.
  const refresh = async () => {
    try {
      const response = await window.${BRIDGE_NAME}({
        method: 'metamask_getProviderState',
        params: [],
      });
      if (!response.ok) {
        return;
      }

      const state = response.result;
      for (const entry of evmEntries) {
        entry.provider.selectedAddress =
          state.isUnlocked && state.accounts.length > 0 ? state.accounts[0] : null;
        entry.provider.chainId = state.chainId;
        entry.provider.networkVersion = toNetworkVersion(state.chainId);
      }
    } catch {
      // Bridge not available yet (e.g. detached frame) — sync values fall
      // back to the injected config snapshot.
    }
  };
  refresh();
})();
`;
//# sourceMappingURL=injected-provider.js.map