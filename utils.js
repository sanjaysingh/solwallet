/** Pure helpers shared by the wallet UI and unit tests. */

export const DEFAULT_NETWORK_ID = 'devnet';

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export const GENESIS_HASHES = {
    mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
    devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};

const EXPLORER_TX_BASE = 'https://explorer.solana.com/tx/';

const EXPLORER_CLUSTER = {
    devnet: 'devnet',
    testnet: 'testnet',
    mainnet: '',
};

export function formatAddressShort(address) {
    if (!address || address.length < 10) return address;
    return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
}

/** Parse `network` from a location search string (e.g. `?network=mainnet`). */
export function getNetworkFromSearch(search) {
    const urlParams = new URLSearchParams(search || '');
    return urlParams.get('network');
}

/**
 * Return a URL string with the network query param applied.
 * Omits the param when networkId is the default (Devnet).
 */
export function buildUrlWithNetwork(href, networkId, defaultNetworkId = DEFAULT_NETWORK_ID) {
    const url = new URL(href);
    if (networkId && networkId !== defaultNetworkId) {
        url.searchParams.set('network', networkId);
    } else {
        url.searchParams.delete('network');
    }
    return url.toString();
}

/** Build a Solana Explorer tx URL, or '' when the network has no public explorer. */
export function getTxExplorerUrl(signature, networkId) {
    if (!signature || networkId === 'custom' || !(networkId in EXPLORER_CLUSTER)) {
        return '';
    }
    const cluster = EXPLORER_CLUSTER[networkId];
    return cluster
        ? `${EXPLORER_TX_BASE}${signature}?cluster=${cluster}`
        : `${EXPLORER_TX_BASE}${signature}`;
}

export function clusterFromGenesisHash(hash) {
    for (const [cluster, genesis] of Object.entries(GENESIS_HASHES)) {
        if (genesis === hash) {
            return cluster;
        }
    }
    return '';
}

export function lamportsToSol(lamports) {
    const value = BigInt(lamports);
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const whole = abs / LAMPORTS_PER_SOL;
    const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
    const text = frac ? `${whole}.${frac}` : `${whole}`;
    return negative ? `-${text}` : text;
}

export function solToLamports(amount) {
    const text = String(amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) {
        throw new Error('Invalid amount');
    }
    const [whole, frac = ''] = text.split('.');
    if (frac.length > 9) {
        throw new Error('Amount has more than 9 decimal places');
    }
    return BigInt(whole) * LAMPORTS_PER_SOL + BigInt((frac.padEnd(9, '0') || '0'));
}

export function uiToRaw(amount, decimals) {
    const places = Number(decimals);
    if (!Number.isInteger(places) || places < 0 || places > 18) {
        throw new Error('Invalid token decimals');
    }
    const text = String(amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) {
        throw new Error('Invalid amount');
    }
    const [whole, frac = ''] = text.split('.');
    if (frac.length > places) {
        throw new Error(`Amount has more than ${places} decimal places`);
    }
    const scale = 10n ** BigInt(places);
    const fracPart = places === 0 ? 0n : BigInt(frac.padEnd(places, '0'));
    return BigInt(whole) * scale + fracPart;
}

export function rawToUi(raw, decimals) {
    const places = Number(decimals);
    const value = BigInt(raw);
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const scale = 10n ** BigInt(places);
    const whole = abs / scale;
    if (places === 0) {
        return negative ? `-${whole}` : `${whole}`;
    }
    const frac = (abs % scale).toString().padStart(places, '0').replace(/0+$/, '');
    const text = frac ? `${whole}.${frac}` : `${whole}`;
    return negative ? `-${text}` : text;
}
