import { describe, expect, it } from 'vitest';
import { confirmSignature, rpcCall } from '../rpc.js';

function jsonResponse(body, ok = true) {
    return {
        ok,
        status: ok ? 200 : 500,
        json: async () => body,
    };
}

describe('rpcCall', () => {
    it('returns the result of a JSON-RPC call', async () => {
        const fetchImpl = async (url, init) => {
            const body = JSON.parse(init.body);
            expect(url).toBe('https://rpc.example');
            expect(body.method).toBe('getBalance');
            return jsonResponse({ result: { value: 42 } });
        };
        await expect(rpcCall('https://rpc.example', 'getBalance', ['addr'], fetchImpl)).resolves.toEqual({ value: 42 });
    });

    it('surfaces RPC and HTTP errors', async () => {
        await expect(rpcCall('https://rpc.example', 'getBalance', [], async () => jsonResponse({
            error: { message: 'rate limited' },
        }))).rejects.toThrow('rate limited');
        await expect(rpcCall('https://rpc.example', 'getBalance', [], async () => jsonResponse({}, false))).rejects.toThrow('HTTP 500');
        await expect(rpcCall('https://rpc.example', 'getBalance', [], async () => jsonResponse({
            error: { code: 429, message: 'rate limited' },
        }, false))).rejects.toThrow('rate limited');
    });
});

describe('confirmSignature', () => {
    it('resolves when the signature is confirmed and rejects an on-chain error', async () => {
        let calls = 0;
        const fetchImpl = async () => jsonResponse({
            result: {
                value: [{ confirmationStatus: calls++ === 0 ? 'processed' : 'confirmed', err: null }],
            },
        });
        const status = await confirmSignature('https://rpc.example', 'sig', {
            fetchImpl,
            timeoutMs: 5_000,
            intervalMs: 1,
            sleep: async () => {},
        });
        expect(status.confirmationStatus).toBe('confirmed');

        const failing = async () => jsonResponse({
            result: { value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }] },
        });
        await expect(confirmSignature('https://rpc.example', 'sig', {
            fetchImpl: failing,
            sleep: async () => {},
        })).rejects.toThrow('failed on chain');
    });
});
