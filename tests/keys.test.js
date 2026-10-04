import { beforeAll, describe, expect, it } from 'vitest';
import { installSolanaCrypto } from './helpers.js';
import {
    DERIVED_ACCOUNT_COUNT,
    accountsFromSecret,
    deriveSlip10Ed25519,
    generateMnemonicPhrase,
    generatePrivateKeySecret,
    keypairFromSeed,
} from '../keys.js';

beforeAll(() => {
    installSolanaCrypto();
});

function hexToBytes(hex) {
    return Uint8Array.from(Buffer.from(hex, 'hex'));
}

describe('SLIP-0010', () => {
    const seed = hexToBytes('000102030405060708090a0b0c0d0e0f');

    it('matches ed25519 test vector 1', () => {
        expect(Buffer.from(deriveSlip10Ed25519(seed, 'm')).toString('hex')).toBe(
            '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
        );
        expect(Buffer.from(deriveSlip10Ed25519(seed, "m/0'")).toString('hex')).toBe(
            '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
        );
    });
});

describe('accountsFromSecret', () => {
    const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('derives the Phantom account for the abandon phrase', () => {
        const accounts = accountsFromSecret(phrase);
        expect(accounts).toHaveLength(DERIVED_ACCOUNT_COUNT);
        expect(accounts[0].address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
        expect(new Set(accounts.map((account) => account.address)).size).toBe(DERIVED_ACCOUNT_COUNT);
    });

    it('rejects a bad phrase', () => {
        expect(() => accountsFromSecret('not a real phrase at all')).toThrow('Invalid seed phrase');
    });

    it('round-trips a 64-byte secret, a 32-byte seed, JSON, and 0x hex', () => {
        const secret = generatePrivateKeySecret();
        const [fromSecret] = accountsFromSecret(secret);
        const seed58 = globalThis.SolanaCrypto.encodeBase58(fromSecret.seed);
        expect(accountsFromSecret(seed58)[0].address).toBe(fromSecret.address);
        expect(accountsFromSecret(JSON.stringify([...fromSecret.seed, ...fromSecret.publicKey]))[0].address)
            .toBe(fromSecret.address);
        const hex = `0x${Buffer.from(fromSecret.seed).toString('hex')}`;
        expect(accountsFromSecret(hex)[0].address).toBe(fromSecret.address);

        const corrupted = Uint8Array.from([...fromSecret.seed, ...fromSecret.publicKey]);
        corrupted[63] ^= 1;
        expect(() => accountsFromSecret(JSON.stringify([...corrupted]))).toThrow('does not match');
    });

    it('creates a phrase that opens five accounts', () => {
        const phrase = generateMnemonicPhrase();
        expect(phrase.split(' ')).toHaveLength(12);
        expect(accountsFromSecret(phrase)).toHaveLength(5);
    });
});

describe('keypairFromSeed', () => {
    it('rejects the wrong length', () => {
        expect(() => keypairFromSeed(new Uint8Array(16))).toThrow('32 bytes');
    });
});
