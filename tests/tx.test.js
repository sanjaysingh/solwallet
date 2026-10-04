import { beforeAll, describe, expect, it } from 'vitest';
import { installSolanaCrypto } from './helpers.js';
import { accountsFromSecret } from '../keys.js';
import { PYTH_SOL_USD_ACCOUNT, SOL_USD_FEED_ID } from '../price.js';
import {
    COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    SOL_COMPUTE_UNIT_LIMIT,
    assertFeeLeavesRent,
    assertSolTransferAffordable,
    associatedTokenAddress,
    buildAndSignSolTransfer,
    bytesToBase64,
    decodePublicKey,
    encodePublicKey,
    encodeShortVec,
    findProgramAddress,
} from '../tx.js';

beforeAll(() => {
    installSolanaCrypto();
});

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const GOLDEN_WIRE = 'AY7zXojglgFHrcNLAHe5mcKc0PnkIFzXII8VPsU5seqiKdYJ9jJCap+sbHvIKVtgfnpUzGfj1pB1GezL02lKXwMBAAIE8DYnYkanW53jNJ7UKxXiMvZRj8IPX81PHWToH5vSWPcGp9UXGSxcUSGMyUw9SvF/WNruCJuh/UTj29mKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwMDAAUC6AMAAAMACQPoAwAAAAAAAAICAAEMAgAAACoAAAAAAAAA';

describe('encodeShortVec', () => {
    it('encodes short and multi-byte lengths', () => {
        expect([...encodeShortVec(1)]).toEqual([1]);
        expect([...encodeShortVec(128)]).toEqual([0x80, 0x01]);
    });
});

describe('transactions', () => {
    it('matches a web3.js system transfer with a priority fee', () => {
        const account = accountsFromSecret(ABANDON)[0];
        const built = buildAndSignSolTransfer({
            seed: account.seed,
            to: 'SysvarRent111111111111111111111111111111111',
            lamports: 42n,
            blockhash: 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx',
            computeUnitLimit: SOL_COMPUTE_UNIT_LIMIT,
            microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
        });
        expect(bytesToBase64(built.wire)).toBe(GOLDEN_WIRE);
        expect(globalThis.SolanaCrypto.verify(
            built.wire.slice(1, 65),
            built.message,
            built.from,
        )).toBe(true);
    });

    it('derives the USDC associated-token address and the Pyth price account', () => {
        const owner = accountsFromSecret(ABANDON)[0].publicKey;
        const usdc = decodePublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        expect(encodePublicKey(associatedTokenAddress(owner, usdc))).toBe(
            '5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt',
        );

        const feed = Uint8Array.from(Buffer.from(SOL_USD_FEED_ID, 'hex'));
        const program = decodePublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');
        expect(encodePublicKey(findProgramAddress([new Uint8Array(2), feed], program))).toBe(
            PYTH_SOL_USD_ACCOUNT,
        );
    });
});

describe('rent checks', () => {
    const rent = 890880n;

    it('allows a transfer that leaves zero or enough rent', () => {
        expect(() => assertSolTransferAffordable({
            balance: 1_000_000_000n,
            lamports: 500_000_000n,
            fee: 5000n,
            rentExemptMinimum: rent,
        })).not.toThrow();
        expect(() => assertSolTransferAffordable({
            balance: 100_000n,
            lamports: 95_000n,
            fee: 5000n,
            rentExemptMinimum: rent,
        })).not.toThrow();
    });

    it('blocks dust left below rent and an unaffordable fee', () => {
        expect(() => assertSolTransferAffordable({
            balance: 1_000_000n,
            lamports: 200_000n,
            fee: 5000n,
            rentExemptMinimum: rent,
        })).toThrow('rent-exempt');
        expect(() => assertFeeLeavesRent({
            balance: 1000n,
            fee: 5000n,
            rentExemptMinimum: rent,
        })).toThrow('network fee');
    });
});
