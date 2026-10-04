/** WebAuthn passkey helpers. PRF output is hashed into an ed25519 seed. */

export const PASSKEY_RP_NAME = 'Solana Wallet (Testing Only)';
export const PASSKEY_USER_NAME = 'solwallet-passkey';
export const PASSKEY_USER_DISPLAY_NAME = 'Passkey Wallet';
export const PASSKEY_PRF_SALT_LABEL = 'solwallet:v1:prf';
export const PASSKEY_DERIVATION_VERSION = 'v1';

export function isValidPasskeyRpId(rpId) {
    if (!rpId || rpId === 'localhost') {
        return rpId === 'localhost';
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rpId)) {
        return false;
    }
    if (rpId.startsWith('[') || rpId.includes(':')) {
        return false;
    }
    return true;
}

export function isPasskeySupported(env = globalThis) {
    const hostname = env.location?.hostname;
    if (hostname && !isValidPasskeyRpId(hostname)) {
        return false;
    }
    return Boolean(
        env.isSecureContext &&
        env.navigator?.credentials &&
        typeof env.navigator.credentials.create === 'function' &&
        typeof env.navigator.credentials.get === 'function' &&
        env.PublicKeyCredential
    );
}

export function bufferToBase64Url(buffer) {
    const bytes = toUint8Array(buffer);
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBuffer(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export async function getPrfSalt(subtle = globalThis.crypto?.subtle) {
    if (!subtle?.digest) {
        throw new Error('Web Crypto is required to derive a passkey wallet.');
    }
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(PASSKEY_PRF_SALT_LABEL));
    return new Uint8Array(digest);
}

export function buildCreateOptions({ challenge, userId, rpId, salt, rpName = PASSKEY_RP_NAME }) {
    return {
        challenge,
        rp: {
            name: rpName,
            id: rpId
        },
        user: {
            id: userId,
            name: PASSKEY_USER_NAME,
            displayName: PASSKEY_USER_DISPLAY_NAME
        },
        pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 }
        ],
        timeout: 60_000,
        authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'required'
        },
        attestation: 'none',
        extensions: {
            prf: {
                eval: {
                    first: salt
                }
            }
        }
    };
}

export function buildGetOptions({ challenge, rpId, salt, credentialId }) {
    const options = {
        challenge,
        rpId,
        timeout: 60_000,
        userVerification: 'required',
        extensions: {
            prf: {
                eval: {
                    first: salt
                }
            }
        }
    };

    if (credentialId) {
        options.allowCredentials = [
            {
                type: 'public-key',
                id: toUint8Array(credentialId)
            }
        ];
    }

    return options;
}

export function extractPrfOutput(extensionResults) {
    const first = extensionResults?.prf?.results?.first;
    if (!first) {
        return null;
    }
    return toUint8Array(first);
}

export function readPrfFromCredential(credential) {
    if (!credential || typeof credential.getClientExtensionResults !== 'function') {
        return null;
    }
    return extractPrfOutput(credential.getClientExtensionResults());
}

/** SHA-256 the PRF output into a 32-byte ed25519 seed. */
export async function deriveSeedFromPrf(prfOutput, subtle = globalThis.crypto?.subtle) {
    if (!subtle?.digest) {
        throw new Error('Web Crypto is required to derive a passkey wallet.');
    }
    const bytes = toUint8Array(prfOutput);
    if (bytes.length === 0) {
        throw new Error('Passkey PRF output was empty.');
    }
    const digest = await subtle.digest('SHA-256', bytes);
    return new Uint8Array(digest);
}

export function isPasskeyCancellation(err) {
    if (!err) {
        return false;
    }
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
        return true;
    }
    return /cancelled/i.test(err.message || '');
}

function passkeyCancellationError(message) {
    const err = new Error(message);
    err.name = 'NotAllowedError';
    return err;
}

export function passkeyErrorMessage(err) {
    if (!err) {
        return 'Passkey request failed.';
    }
    if (isPasskeyCancellation(err)) {
        return 'Passkey request was cancelled.';
    }
    if (err.name === 'SecurityError') {
        return 'Passkeys require HTTPS or http://localhost. IP addresses such as 127.0.0.1 are not valid origins.';
    }
    if (err.name === 'InvalidStateError') {
        return 'A passkey already exists for this device. Use Import passkey instead.';
    }
    if (err.name === 'NotSupportedError') {
        return 'This browser or authenticator does not support passkeys.';
    }
    return err.message || 'Passkey request failed.';
}

export async function createPasskeyWallet({
    credentials,
    rpId,
    salt,
    challenge,
    userId,
    env = globalThis
} = {}) {
    const creds = credentials || env.navigator?.credentials;
    if (!credentials) {
        assertPasskeyAvailable(env);
    }
    if (!creds?.create || !creds?.get) {
        throw new Error('Passkeys are not available in this browser.');
    }

    const resolvedRpId = rpId || hostnameFrom(env);
    const resolvedSalt = salt || await getPrfSalt(env.crypto?.subtle);
    const resolvedChallenge = challenge || randomBytes(env, 32);
    const resolvedUserId = userId || randomBytes(env, 16);

    const credential = await creds.create({
        publicKey: buildCreateOptions({
            challenge: resolvedChallenge,
            userId: resolvedUserId,
            rpId: resolvedRpId,
            salt: resolvedSalt
        })
    });

    if (!credential) {
        throw passkeyCancellationError('Passkey creation was cancelled.');
    }

    let prf = readPrfFromCredential(credential);
    if (!prf) {
        const assertion = await creds.get({
            publicKey: buildGetOptions({
                challenge: randomBytes(env, 32),
                rpId: resolvedRpId,
                salt: resolvedSalt,
                credentialId: credential.rawId
            })
        });
        prf = readPrfFromCredential(assertion);
    }

    if (!prf) {
        throw new Error('This authenticator does not support passkey PRF, which is required to derive a wallet key.');
    }

    return {
        seed: await deriveSeedFromPrf(prf, env.crypto?.subtle),
        credentialId: bufferToBase64Url(credential.rawId),
        source: 'passkey'
    };
}

export async function unlockPasskeyWallet({
    credentials,
    rpId,
    salt,
    challenge,
    credentialId,
    env = globalThis
} = {}) {
    const creds = credentials || env.navigator?.credentials;
    if (!credentials) {
        assertPasskeyAvailable(env);
    }
    if (!creds?.get) {
        throw new Error('Passkeys are not available in this browser.');
    }

    const assertion = await creds.get({
        publicKey: buildGetOptions({
            challenge: challenge || randomBytes(env, 32),
            rpId: rpId || hostnameFrom(env),
            salt: salt || await getPrfSalt(env.crypto?.subtle),
            credentialId
        })
    });

    if (!assertion) {
        throw passkeyCancellationError('Passkey unlock was cancelled.');
    }

    const prf = readPrfFromCredential(assertion);
    if (!prf) {
        throw new Error('This authenticator does not support passkey PRF, which is required to derive a wallet key.');
    }

    return {
        seed: await deriveSeedFromPrf(prf, env.crypto?.subtle),
        credentialId: bufferToBase64Url(assertion.rawId || credentialId || new Uint8Array()),
        source: 'passkey'
    };
}

function assertPasskeyAvailable(env) {
    const hostname = env.location?.hostname;
    if (hostname && !isValidPasskeyRpId(hostname)) {
        throw new Error('Passkeys require HTTPS or http://localhost. IP addresses such as 127.0.0.1 are not valid origins.');
    }
    if (!isPasskeySupported(env)) {
        throw new Error('Passkeys require a supported browser in a secure context (HTTPS or localhost).');
    }
}

function hostnameFrom(env) {
    return env.location?.hostname || 'localhost';
}

function randomBytes(env, length) {
    const bytes = new Uint8Array(length);
    const cryptoObj = env.crypto || globalThis.crypto;
    if (!cryptoObj?.getRandomValues) {
        throw new Error('Secure randomness is required to create a passkey wallet.');
    }
    cryptoObj.getRandomValues(bytes);
    return bytes;
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new Error('Expected binary data');
}
