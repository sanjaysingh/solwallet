import { describe, expect, it } from 'vitest';
import {
    PYTH_PRICE_MAX_AGE_SEC,
    SOL_USD_FEED_ID,
    fetchSolUsdPrice,
    formatTokenUsd,
    formatUsdValue,
    parsePythPriceUpdate,
} from '../price.js';

const DISCRIMINATOR = Uint8Array.from([0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]);

function feedBytes() {
    return Uint8Array.from(Buffer.from(SOL_USD_FEED_ID, 'hex'));
}

function priceAccount({ price = 12_160_014_910n, exponent = -8, publishTime = 1_700_000_000n, feed = feedBytes(), magic = DISCRIMINATOR } = {}) {
    const bytes = new Uint8Array(134);
    bytes.set(magic, 0);
    bytes[40] = 1;
    bytes.set(feed, 41);
    const view = new DataView(bytes.buffer);
    view.setBigInt64(73, price, true);
    view.setInt32(89, exponent, true);
    view.setBigInt64(93, publishTime, true);
    return bytes;
}

describe('parsePythPriceUpdate', () => {
    const now = 1_700_000_100;

    it('decodes a fresh SOL/USD price', () => {
        expect(parsePythPriceUpdate(priceAccount(), now)).toBeCloseTo(121.6001491, 6);
    });

    it('returns null for a stale quote, a bad magic, or the wrong feed', () => {
        expect(parsePythPriceUpdate(priceAccount(), now + PYTH_PRICE_MAX_AGE_SEC + 5)).toBe(null);
        const badMagic = priceAccount();
        badMagic[0] = 0;
        expect(parsePythPriceUpdate(badMagic, now)).toBe(null);
        const wrongFeed = feedBytes();
        wrongFeed[0] ^= 0xff;
        expect(parsePythPriceUpdate(priceAccount({ feed: wrongFeed }), now)).toBe(null);
    });
});

describe('fetchSolUsdPrice', () => {
    it('reads the account through an injected RPC fetch', async () => {
        const bytes = priceAccount();
        let binary = '';
        for (const byte of bytes) {
            binary += String.fromCharCode(byte);
        }
        const encoded = btoa(binary);
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({
                result: { value: { data: [encoded, 'base64'] } },
            }),
        });
        const prices = await fetchSolUsdPrice({
            fetchImpl,
            nowSec: 1_700_000_100,
        });
        expect(prices.SOL).toBeCloseTo(121.6001491, 6);
    });
});

describe('USD formatting', () => {
    it('formats token amounts and hides missing quotes', () => {
        expect(formatTokenUsd('2', 121.6)).toBe('$243.20');
        expect(formatTokenUsd('1', null)).toBe('');
        expect(formatUsdValue(0.001)).toBe('<$0.01');
    });
});
