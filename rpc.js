/** Solana JSON-RPC. The only network dependency of the wallet. */

export async function rpcCall(rpcUrl, method, params, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is not available');
    }
    let response;
    try {
        response = await fetchImpl(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
    } catch (err) {
        throw new Error(err?.message || 'RPC request failed');
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const message = body?.error?.message || `RPC HTTP ${response.status}`;
        throw new Error(message);
    }
    if (body?.error) {
        const message = body.error.message || 'RPC error';
        throw new Error(message);
    }
    return body.result;
}

export function getBalance(rpcUrl, address, fetchImpl) {
    return rpcCall(rpcUrl, 'getBalance', [address, { commitment: 'confirmed' }], fetchImpl);
}

export function getLatestBlockhash(rpcUrl, fetchImpl) {
    return rpcCall(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }], fetchImpl);
}

export function getFeeForMessage(rpcUrl, messageBase64, fetchImpl) {
    return rpcCall(
        rpcUrl,
        'getFeeForMessage',
        [messageBase64, { commitment: 'confirmed' }],
        fetchImpl,
    );
}

export function sendTransaction(rpcUrl, wireBase64, fetchImpl) {
    return rpcCall(rpcUrl, 'sendTransaction', [
        wireBase64,
        { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
    ], fetchImpl);
}

export function simulateTransaction(rpcUrl, wireBase64, fetchImpl) {
    return rpcCall(rpcUrl, 'simulateTransaction', [
        wireBase64,
        {
            encoding: 'base64',
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: 'confirmed',
        },
    ], fetchImpl);
}

export function getSignatureStatuses(rpcUrl, signature, fetchImpl) {
    return rpcCall(rpcUrl, 'getSignatureStatuses', [
        [signature],
        { searchTransactionHistory: true },
    ], fetchImpl);
}

export function getMinimumBalanceForRentExemption(rpcUrl, dataLength = 0, fetchImpl) {
    return rpcCall(rpcUrl, 'getMinimumBalanceForRentExemption', [dataLength], fetchImpl);
}

export function getGenesisHash(rpcUrl, fetchImpl) {
    return rpcCall(rpcUrl, 'getGenesisHash', [], fetchImpl);
}

export function getAccountInfo(rpcUrl, address, config = { encoding: 'base64' }, fetchImpl) {
    return rpcCall(rpcUrl, 'getAccountInfo', [address, config], fetchImpl);
}

export function getTokenAccountsByOwner(rpcUrl, owner, mint, fetchImpl) {
    return rpcCall(rpcUrl, 'getTokenAccountsByOwner', [
        owner,
        { mint },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
    ], fetchImpl);
}

export async function confirmSignature(rpcUrl, signature, {
    fetchImpl,
    timeoutMs = 60_000,
    intervalMs = 1_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const result = await getSignatureStatuses(rpcUrl, signature, fetchImpl);
        const status = result?.value?.[0];
        if (status?.err) {
            throw new Error('Transaction failed on chain');
        }
        if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
            return status;
        }
        await sleep(intervalMs);
    }
    throw new Error('Timed out waiting for confirmation');
}
