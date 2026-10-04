import { describe, it, expect } from 'vitest';
import {
    DEFAULT_NETWORK_ID,
    GENESIS_HASHES,
    clusterFromGenesisHash,
    formatAddressShort,
    getNetworkFromSearch,
    buildUrlWithNetwork,
    getTxExplorerUrl,
    lamportsToSol,
    solToLamports,
    uiToRaw,
    rawToUi,
} from '../utils.js';

describe('formatAddressShort', () => {
    it('shortens a Solana address', () => {
        const address = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
        expect(formatAddressShort(address)).toBe('HAgk...Kpqk');
    });

    it('returns short values unchanged', () => {
        expect(formatAddressShort('short')).toBe('short');
        expect(formatAddressShort('')).toBe('');
        expect(formatAddressShort(null)).toBe(null);
    });
});

describe('network links', () => {
    const href = 'https://solwallet.example/';

    it('reads the network query param', () => {
        expect(getNetworkFromSearch('?network=mainnet')).toBe('mainnet');
        expect(getNetworkFromSearch('')).toBe(null);
    });

    it('omits the param for the default network', () => {
        expect(buildUrlWithNetwork(href, DEFAULT_NETWORK_ID)).toBe(href);
        expect(buildUrlWithNetwork(`${href}?network=mainnet`, 'devnet')).toBe(href);
    });

    it('sets the param for non-default networks', () => {
        expect(buildUrlWithNetwork(href, 'mainnet')).toBe(`${href}?network=mainnet`);
    });

    it('builds explorer URLs', () => {
        expect(getTxExplorerUrl('sig', 'devnet')).toBe('https://explorer.solana.com/tx/sig?cluster=devnet');
        expect(getTxExplorerUrl('sig', 'mainnet')).toBe('https://explorer.solana.com/tx/sig');
        expect(getTxExplorerUrl('sig', 'custom')).toBe('');
        expect(getTxExplorerUrl('', 'devnet')).toBe('');
    });
});

describe('amounts', () => {
    it('converts SOL and lamports', () => {
        expect(solToLamports('1')).toBe(1_000_000_000n);
        expect(solToLamports('1.5')).toBe(1_500_000_000n);
        expect(solToLamports('0.000000001')).toBe(1n);
        expect(lamportsToSol(5000n)).toBe('0.000005');
        expect(lamportsToSol(solToLamports('2.25'))).toBe('2.25');
    });

    it('rejects bad SOL amounts', () => {
        expect(() => solToLamports('-1')).toThrow('Invalid amount');
        expect(() => solToLamports('1.0000000001')).toThrow('9 decimal');
    });

    it('converts token UI amounts', () => {
        expect(uiToRaw('1.25', 6)).toBe(1_250_000n);
        expect(rawToUi(1_250_000n, 6)).toBe('1.25');
        expect(() => uiToRaw('0.0000001', 6)).toThrow('decimal');
    });
});

describe('clusterFromGenesisHash', () => {
    it('names the public clusters', () => {
        expect(clusterFromGenesisHash(GENESIS_HASHES.devnet)).toBe('devnet');
        expect(clusterFromGenesisHash(GENESIS_HASHES.mainnet)).toBe('mainnet');
        expect(clusterFromGenesisHash('not-a-cluster')).toBe('');
    });
});
