/** SOL/USD from the Pyth push-oracle account on mainnet. One RPC, every network. */

import { rpcCall } from './rpc.js';

export const PRICE_RPC_URL = 'https://solana-rpc.publicnode.com';

/** Shard 0 of the SOL/USD feed on the Pyth push oracle. */
export const PYTH_SOL_USD_ACCOUNT = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';

export const SOL_USD_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

export const PYTH_PRICE_MAX_AGE_SEC = 20 * 60;

const DISCRIMINATOR = Uint8Array.from([0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]);
const FEED_OFFSET = 41;
const PRICE_OFFSET = 73;
const EXPO_OFFSET = 89;
const PUBLISH_OFFSET = 93;

const usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function readBigInt64LE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(offset, true);
}

function readInt32LE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true);
}

function feedIdBytes() {
    const hex = SOL_USD_FEED_ID;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/**
 * Decode a Pyth `priceUpdateV2` account.
 * Returns a positive USD number, or null when the layout, feed, or age does not check out.
 */
export function parsePythPriceUpdate(bytes, nowSec = Math.floor(Date.now() / 1000)) {
    if (!(bytes instanceof Uint8Array) || bytes.length < PUBLISH_OFFSET + 8) {
        return null;
    }
    for (let i = 0; i < DISCRIMINATOR.length; i++) {
        if (bytes[i] !== DISCRIMINATOR[i]) {
            return null;
        }
    }
    const expectedFeed = feedIdBytes();
    for (let i = 0; i < expectedFeed.length; i++) {
        if (bytes[FEED_OFFSET + i] !== expectedFeed[i]) {
            return null;
        }
    }
    const price = readBigInt64LE(bytes, PRICE_OFFSET);
    const exponent = readInt32LE(bytes, EXPO_OFFSET);
    const publishTime = readBigInt64LE(bytes, PUBLISH_OFFSET);
    if (price <= 0n || exponent > 0 || exponent < -18) {
        return null;
    }
    const publish = Number(publishTime);
    if (!Number.isSafeInteger(publish)) {
        return null;
    }
    if (publish > nowSec + 5 * 60 || nowSec - publish > PYTH_PRICE_MAX_AGE_SEC) {
        return null;
    }
    const usd = Number(price) * (10 ** exponent);
    if (!Number.isFinite(usd) || usd <= 0) {
        return null;
    }
    return usd;
}

export function base64ToBytes(value) {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

export async function fetchSolUsdPrice({
    rpcUrl = PRICE_RPC_URL,
    account = PYTH_SOL_USD_ACCOUNT,
    fetchImpl,
    nowSec,
} = {}) {
    const result = await rpcCall(
        rpcUrl,
        'getAccountInfo',
        [account, { encoding: 'base64', commitment: 'confirmed' }],
        fetchImpl,
    );
    const encoded = result?.value?.data?.[0];
    if (!encoded) {
        return null;
    }
    const price = parsePythPriceUpdate(base64ToBytes(encoded), nowSec);
    return price == null ? null : { SOL: price };
}

export function usdPriceForSymbol(prices, symbol) {
    if (!prices || !symbol) return null;
    const price = Number(prices[String(symbol).toUpperCase()]);
    return Number.isFinite(price) && price > 0 ? price : null;
}

export function tokenAmountToUsd(tokenAmount, usdPrice) {
    const amount = Number(tokenAmount);
    const price = Number(usdPrice);
    if (!Number.isFinite(amount) || !Number.isFinite(price) || price <= 0) {
        return null;
    }
    return amount * price;
}

export function formatUsdValue(usdAmount) {
    if (usdAmount == null || usdAmount === '') {
        return '';
    }
    const n = Number(usdAmount);
    if (!Number.isFinite(n)) {
        return '';
    }
    if (n === 0) {
        return usdFormatter.format(0);
    }
    if (Math.abs(n) < 0.01) {
        return n < 0 ? '-<$0.01' : '<$0.01';
    }
    return usdFormatter.format(n);
}

export function formatTokenUsd(tokenAmount, usdPrice) {
    const usd = tokenAmountToUsd(tokenAmount, usdPrice);
    return usd == null ? '' : formatUsdValue(usd);
}
