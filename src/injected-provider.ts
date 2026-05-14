import type { MockWalletConfig } from './types.js';

const BRIDGE_NAME = '__invisibleWalletRpcBridge';
const EMITTER_NAME = '__invisibleWalletEmit';

export const rpcBridgeName = BRIDGE_NAME;
export const emitterName = EMITTER_NAME;

export const buildInjectedProviderScript = (config: MockWalletConfig): string => `
(() => {
  const config = ${JSON.stringify(config)};
  const listeners = new Map();

  const getListeners = (event) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    return listeners.get(event);
  };

  const emit = (event, payload) => {
    if (event === 'accountsChanged') {
      provider.selectedAddress = Array.isArray(payload) && payload.length > 0 ? payload[0] : null;
    }

    if (event === 'chainChanged') {
      provider.chainId = payload;
      provider.networkVersion = String(Number(BigInt(payload)));
    }

    const callbacks = listeners.get(event);
    if (!callbacks) {
      return;
    }

    for (const callback of [...callbacks]) {
      callback(payload);
    }
  };

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

  const provider = {
    isMetaMask: true,
    isMock: true,
    selectedAddress: config.connected && config.accounts.length > 0 ? config.accounts[0] : null,
    chainId: config.chainId,
    networkVersion: String(Number(BigInt(config.chainId))),
    request,
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

  const announceProviders = () => {
    for (const info of config.providers) {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info,
            provider,
          },
        }),
      );
    }
  };

  Object.defineProperty(window, 'ethereum', {
    value: provider,
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
})();
`;
