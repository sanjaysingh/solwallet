# Solana Wallet (Testing Only)

A self-contained Solana wallet for testing and development. Create or import a key, then use Wallet, Send, and Receive. The site is published at [solwallet.sanjaysingh.net](https://solwallet.sanjaysingh.net).

## Critical security warning

**This wallet is for testing and development.** Private keys stay in browser memory only. It is not a production custody wallet. Prefer small amounts and clear the session when you are done.

## Features

- Create a private key, a 12-word seed phrase, or a device passkey
- Import a seed phrase, a Phantom-style base58 secret (32-byte seed or 64-byte secret key), a `0x` hex secret, or a Solana CLI JSON byte array
- Import passkey reopens the same address
- Five accounts from a seed phrase at `m/44'/501'/i'/0'` (Phantom and Solflare)
- Devnet (default), Testnet, Mainnet, and a custom RPC, with `?network=` deep links
- SOL balances, a USD estimate from the Pyth SOL/USD push-oracle account on mainnet, and SPL token sends
- Network fee quote, rent check, simulation, then send, with a Solana Explorer link
- Receive QR codes, and a 1 SOL airdrop on Devnet and Testnet via `requestAirdrop`
- In-memory previous sessions on this page load, cleared on refresh

Passkey wallets need HTTPS or `http://localhost` and an authenticator with the WebAuthn PRF extension. The PRF output is SHA-256'd into an ed25519 seed (`solwallet:v1:prf`). Importing that passkey reopens the same address.

## Quick start

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

Devnet is the default so the airdrop works. Public devnet RPCs rate-limit airdrops; the page shows the RPC error when that happens.

## Technical details

- Frontend: Vue.js <!-- vendor-version:vue -->3.5.43<!-- /vendor-version:vue --> and Bootstrap <!-- vendor-version:bootstrap -->5.3.8<!-- /vendor-version:bootstrap -->
- Icons: Bootstrap Icons <!-- vendor-version:bootstrap-icons -->1.13.1<!-- /vendor-version:bootstrap-icons -->
- QR codes: qrcode <!-- vendor-version:qrcode -->1.5.4<!-- /vendor-version:qrcode -->
- Keys and signing: a local bundle <!-- vendor-version:solana-crypto -->2.4.0<!-- /vendor-version:solana-crypto --> of `@noble/curves`, `@noble/hashes`, `@scure/bip39`, and `@scure/base`
- Chain access: Solana JSON-RPC only (`fetch`). No `@solana/web3.js`, no indexer, and no CDN scripts

Signing uses one vendored file built from `@noble/curves`, `@noble/hashes`, `@scure/bip39`, and `@scure/base`: ed25519, BIP39, base58, and the hashes for Phantom-style HD paths. Web Crypto covers passkey hashing and randomness. Chain calls are `fetch` JSON-RPC.

The legacy Pyth SOL/USD account is no longer updated. The USD line reads the Pyth push-oracle price account `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` (shard 0 of feed `ef0d8b6f…b56d`) through mainnet `getAccountInfo`, on every cluster. If that account is stale or the layout does not match, the USD line stays blank.

### Local dependencies

Browser libraries live in `libs/` and are pinned in `libs/manifest.json`. To bump one, edit its version and run `npm run vendor`. Details: [`libs/README.md`](libs/README.md).

<!-- vendor-libs:begin -->
```
libs/
├── bootstrap-5.3.8.bundle.min.js
├── bootstrap-5.3.8.min.css
├── bootstrap-icons-1.13.1.min.css
├── fonts/bootstrap-icons.woff
├── fonts/bootstrap-icons.woff2
├── qrcode-1.5.4.min.js
├── solana-crypto-2.4.0.min.js
└── vue-3.5.43-vue.global.prod.min.js
```
<!-- vendor-libs:end -->

### Networks

| Network | RPC | Explorer |
| --- | --- | --- |
| Devnet (default) | `https://api.devnet.solana.com` | `?cluster=devnet` |
| Testnet | `https://api.testnet.solana.com` | `?cluster=testnet` |
| Mainnet | `https://solana-rpc.publicnode.com` | Solana Explorer |
| Custom | User-defined | none |

Connected state checks `getGenesisHash` against the known cluster hash. A custom RPC only reports that it connected.

`https://api.mainnet-beta.solana.com` rejects browser requests, so Mainnet and the SOL/USD read use PublicNode. Devnet and Testnet use the cluster RPCs, which accept them. All three are still plain JSON-RPC.

## Development

```bash
npm install
npm test
```

`npm test` runs Vitest, including the vendored-library check (`vendor:check` does the same check with no network). CI runs `npm test` on every pull request and push to `main`.

```bash
npm run vendor
```

## Security

Keys are not stored, there is no account registration, and signing stays in the browser. Clear the session when you are finished, and confirm Devnet versus Mainnet before sending.

## License

MIT. See [LICENSE](LICENSE).
