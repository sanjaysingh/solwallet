/** Key generation, Phantom-compatible derivation, and secret import. */

export const DERIVED_ACCOUNT_COUNT = 5;

function cryptoLib() {
    const lib = globalThis.SolanaCrypto;
    if (!lib?.publicKeyFromSeed || !lib?.hmacSha512) {
        throw new Error('Solana crypto library is not loaded.');
    }
    return lib;
}

function bytesEqual(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < left.length; i++) {
        diff |= left[i] ^ right[i];
    }
    return diff === 0;
}

function hexToBytes(hex) {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
        throw new Error('Invalid hex');
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/**
 * SLIP-0010 ed25519 private derivation. Every path segment must be hardened.
 * `seed` is the BIP39 seed (or any 16–64 byte master secret).
 */
export function deriveSlip10Ed25519(seed, path) {
    const { hmacSha512 } = cryptoLib();
    if (!path.startsWith('m')) {
        throw new Error('Invalid derivation path');
    }
    const segments = path.split('/').slice(1).filter(Boolean).map((part) => {
        const hardened = part.endsWith("'") || part.endsWith('h') || part.endsWith('H');
        if (!hardened) {
            throw new Error('ed25519 derivation requires hardened path segments');
        }
        const index = Number(part.slice(0, -1));
        if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
            throw new Error('Invalid derivation path');
        }
        return (index + 0x80000000) >>> 0;
    });

    let derived = hmacSha512(new TextEncoder().encode('ed25519 seed'), seed);
    let key = derived.slice(0, 32);
    let chain = derived.slice(32);
    for (const index of segments) {
        const data = new Uint8Array(37);
        data[0] = 0;
        data.set(key, 1);
        new DataView(data.buffer).setUint32(33, index, false);
        derived = hmacSha512(chain, data);
        key = derived.slice(0, 32);
        chain = derived.slice(32);
    }
    return key;
}

export function keypairFromSeed(seed) {
    const { publicKeyFromSeed, encodeBase58 } = cryptoLib();
    if (!(seed instanceof Uint8Array) || seed.length !== 32) {
        throw new Error('Ed25519 seed must be 32 bytes');
    }
    const publicKey = publicKeyFromSeed(seed);
    const secretKey = new Uint8Array(64);
    secretKey.set(seed, 0);
    secretKey.set(publicKey, 32);
    return {
        seed,
        publicKey,
        address: encodeBase58(publicKey),
        secretKeyBase58: encodeBase58(secretKey),
    };
}

export function formatSecretKey(seed) {
    return keypairFromSeed(seed).secretKeyBase58;
}

export function generatePrivateKeySecret() {
    return formatSecretKey(cryptoLib().randomSeed());
}

export function generateMnemonicPhrase() {
    return cryptoLib().generateMnemonicPhrase();
}

function secretBytesFromText(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('[')) {
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            throw new Error('Invalid private key');
        }
        if (!Array.isArray(parsed) || parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
            throw new Error('Invalid private key');
        }
        return Uint8Array.from(parsed);
    }
    if (trimmed.startsWith('0x')) {
        const bytes = hexToBytes(trimmed);
        if (bytes.length !== 32 && bytes.length !== 64) {
            throw new Error('Invalid private key');
        }
        return bytes;
    }
    try {
        return cryptoLib().decodeBase58(trimmed);
    } catch {
        throw new Error('Invalid private key');
    }
}

function accountFromSecretBytes(bytes) {
    if (bytes.length === 32) {
        return keypairFromSeed(bytes);
    }
    if (bytes.length === 64) {
        const seed = bytes.slice(0, 32);
        const account = keypairFromSeed(seed);
        if (!bytesEqual(account.publicKey, bytes.slice(32))) {
            throw new Error('Public key does not match this secret key');
        }
        return account;
    }
    throw new Error('Invalid private key');
}

/** Phrase, base58 seed or 64-byte secret, hex, or a Solana CLI JSON byte array. */
export function accountsFromSecret(input) {
    const trimmed = String(input ?? '').trim();
    if (!trimmed) {
        throw new Error('Enter a seed phrase or private key');
    }
    if (trimmed.includes(' ')) {
        const phrase = trimmed.split(/\s+/).join(' ');
        if (!cryptoLib().isValidMnemonic(phrase)) {
            throw new Error('Invalid seed phrase');
        }
        const master = cryptoLib().mnemonicToSeed(phrase);
        const accounts = [];
        for (let i = 0; i < DERIVED_ACCOUNT_COUNT; i++) {
            const seed = deriveSlip10Ed25519(master, `m/44'/501'/${i}'/0'`);
            accounts.push(keypairFromSeed(seed));
        }
        return accounts;
    }
    return [accountFromSecretBytes(secretBytesFromText(trimmed))];
}
