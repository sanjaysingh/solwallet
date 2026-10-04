import { describe, expect, it } from 'vitest';
import {
    PASSKEY_PRF_SALT_LABEL,
    PASSKEY_RP_NAME,
    buildCreateOptions,
    deriveSeedFromPrf,
    getPrfSalt,
    isPasskeyCancellation,
    isValidPasskeyRpId,
    passkeyErrorMessage,
} from '../passkey.js';

describe('passkey derivation', () => {
    it('hashes the PRF output into 32 bytes', async () => {
        const input = new TextEncoder().encode('prf-output');
        const seed = await deriveSeedFromPrf(input);
        const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
        expect(seed).toEqual(expected);
        expect(seed).toHaveLength(32);
    });

    it('rejects an empty PRF output', async () => {
        await expect(deriveSeedFromPrf(new Uint8Array())).rejects.toThrow('empty');
    });

    it('salts the ceremony with the solwallet label', async () => {
        const salt = await getPrfSalt();
        const expected = new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PASSKEY_PRF_SALT_LABEL)),
        );
        expect(salt).toEqual(expected);
        expect(PASSKEY_PRF_SALT_LABEL).toBe('solwallet:v1:prf');
    });
});

describe('passkey options', () => {
    it('asks for PRF on a Solana relying party', () => {
        const salt = new Uint8Array(32);
        const options = buildCreateOptions({
            challenge: new Uint8Array(32),
            userId: new Uint8Array(16),
            rpId: 'localhost',
            salt,
        });
        expect(options.rp.name).toBe(PASSKEY_RP_NAME);
        expect(options.extensions.prf.eval.first).toBe(salt);
        expect(options.authenticatorSelection.residentKey).toBe('required');
    });

    it('rejects IP relying party ids', () => {
        expect(isValidPasskeyRpId('localhost')).toBe(true);
        expect(isValidPasskeyRpId('127.0.0.1')).toBe(false);
    });

    it('treats cancellation as a quiet failure', () => {
        const err = new Error('nope');
        err.name = 'NotAllowedError';
        expect(isPasskeyCancellation(err)).toBe(true);
        expect(passkeyErrorMessage(err)).toBe('Passkey request was cancelled.');
    });
});
