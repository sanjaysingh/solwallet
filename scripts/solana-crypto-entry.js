/**
 * Browser entry for the vendored Solana crypto bundle.
 * esbuild turns this into one IIFE on `SolanaCrypto`.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import {
    generateMnemonic,
    mnemonicToSeedSync,
    validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { base58 } from '@scure/base';

export function randomSeed() {
    return ed25519.utils.randomSecretKey();
}

export function publicKeyFromSeed(seed) {
    return ed25519.getPublicKey(seed);
}

export function sign(message, seed) {
    return ed25519.sign(message, seed);
}

export function verify(signature, message, publicKey) {
    return ed25519.verify(signature, message, publicKey);
}

/** True when the 32 bytes decompress as an ed25519 point (Solana on-curve check). */
export function isOnCurve(bytes) {
    try {
        ed25519.Point.fromBytes(bytes);
        return true;
    } catch {
        return false;
    }
}

export function sha256Hash(data) {
    return sha256(data);
}

export function hmacSha512(key, data) {
    return hmac(sha512, key, data);
}

export function encodeBase58(bytes) {
    return base58.encode(bytes);
}

export function decodeBase58(text) {
    return base58.decode(text);
}

export function generateMnemonicPhrase() {
    return generateMnemonic(wordlist, 128);
}

export function mnemonicToSeed(phrase) {
    return mnemonicToSeedSync(phrase, '');
}

export function isValidMnemonic(phrase) {
    return validateMnemonic(phrase, wordlist);
}
