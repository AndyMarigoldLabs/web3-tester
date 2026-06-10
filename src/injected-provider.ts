import type { MockWalletConfig } from './types.js';

const BRIDGE_NAME = '__invisibleWalletRpcBridge';
const EMITTER_NAME = '__invisibleWalletEmit';

export const rpcBridgeName = BRIDGE_NAME;
export const emitterName = EMITTER_NAME;

export const buildInjectedProviderScript = (config: MockWalletConfig): string => `
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
  const createProviderEntry = (info) => {
    const listeners = new Map();

    const getListeners = (event) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      return listeners.get(event);
    };

    const provider = {
      isMetaMask: true,
      isMock: true,
      selectedAddress: config.connected && config.accounts.length > 0 ? config.accounts[0] : null,
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
        request(payload)
          .then((result) => callback?.(null, { id: payload.id, jsonrpc: '2.0', result }))
          .catch((error) => callback?.(error, null));
      },
      sendAsync: (payload, callback) => {
        request(payload)
          .then((result) => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
          .catch((error) => callback(error, null));
      },
      on: (event, handler) => {
        getListeners(event).add(handler);
        return provider;
      },
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
      removeAllListeners: (event) => {
        if (event) {
          listeners.delete(event);
        } else {
          listeners.clear();
        }
        return provider;
      },
      _metamask: {
        isUnlocked: async () => true,
      },
    };

    return { info, provider, listeners };
  };

  const entries = config.providers.map(createProviderEntry);

  const emit = (event, payload) => {
    if (event === 'connect') {
      chainDisconnected = false;
    }
    if (event === 'disconnect') {
      chainDisconnected = true;
    }

    for (const entry of entries) {
      if (event === 'accountsChanged') {
        entry.provider.selectedAddress =
          Array.isArray(payload) && payload.length > 0 ? payload[0] : null;
      }

      if (event === 'chainChanged') {
        entry.provider.chainId = payload;
        entry.provider.networkVersion = toNetworkVersion(payload);
      }

      const callbacks = entry.listeners.get(event);
      if (!callbacks) {
        continue;
      }

      for (const callback of [...callbacks]) {
        callback(payload);
      }
    }
  };

  const announceProviders = () => {
    for (const entry of entries) {
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

  Object.defineProperty(window, 'ethereum', {
    value: entries[0].provider,
    configurable: true,
    enumerable: true,
    writable: true,
  });

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
      for (const entry of entries) {
        entry.provider.selectedAddress = state.accounts.length > 0 ? state.accounts[0] : null;
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
