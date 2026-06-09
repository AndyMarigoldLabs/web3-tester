export const providerError = (code, message, data) => {
    const error = new Error(message);
    error.code = code;
    if (data !== undefined) {
        error.data = data;
    }
    return error;
};
export const serializeRpcError = (error) => {
    if (typeof error === 'object' && error !== null) {
        const maybeError = error;
        return {
            code: typeof maybeError.code === 'number' ? maybeError.code : -32603,
            message: typeof maybeError.message === 'string'
                ? maybeError.message
                : 'Internal JSON-RPC error',
            data: maybeError.data,
        };
    }
    return {
        code: -32603,
        message: typeof error === 'string' ? error : 'Internal JSON-RPC error',
    };
};
//# sourceMappingURL=errors.js.map