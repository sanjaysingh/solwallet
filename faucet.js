/** Devnet and Testnet faucet client (Cloudflare Worker API). */

export const FAUCET_API_BASE = 'https://sol-faucet-api.times2.workers.dev';
export const FAUCET_TURNSTILE_SITE_KEY = '0x4AAAAAAFNrgxVXJd78eOr1';
export const FAUCET_NETWORKS = ['devnet', 'testnet'];
export const FAUCET_CHAIN_SLUG = 'devnet';

export function isFaucetNetwork(networkId) {
    return FAUCET_NETWORKS.includes(networkId);
}

/**
 * True when a Turnstile widget is already in the faucet container.
 * Visiting Receive again should reuse it; a new challenge is only needed
 * after a claim (reset) or when the token expires.
 */
export function isFaucetTurnstileAlreadyMounted(widgetId, container) {
    return widgetId != null && Boolean(container && container.childNodes.length > 0);
}

/** Mount on network switch only if Receive is already visible (avoid hidden widgets). */
export function shouldMountFaucetTurnstileOnNetworkChange(networkId, receivePane) {
    if (!isFaucetNetwork(networkId)) {
        return false;
    }
    return Boolean(
        receivePane?.classList?.contains('show') || receivePane?.classList?.contains('active')
    );
}

/**
 * Request a drip from the faucet API.
 * @param {{ address: string, turnstileToken: string, apiBase?: string, chain?: string }} params
 */
export async function requestFaucetDrip({
    address,
    turnstileToken,
    apiBase = FAUCET_API_BASE,
    chain = FAUCET_CHAIN_SLUG,
}) {
    const base = apiBase.replace(/\/$/, '');
    const res = await fetch(
        `${base}/api/${encodeURIComponent(chain)}/drip`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, turnstileToken }),
        },
    );

    let data = {};
    try {
        data = await res.json();
    } catch {
        // ignore JSON parse errors
    }

    if (!res.ok) {
        const err = new Error(
            typeof data.error === 'string'
                ? data.error
                : `Faucet request failed (${res.status})`,
        );
        if (typeof data.nextClaimAt === 'number') {
            err.nextClaimAt = data.nextClaimAt;
        }
        throw err;
    }

    return data;
}
