# Vendored browser libraries

This app is a static site. Runtime libraries live in this folder, are committed to git, and are loaded from `libs/` (no CDN). Versions are pinned in `manifest.json`.

## Libraries

| Library | Pin | Role |
| --- | --- | --- |
| Vue | 3.5.43 | UI |
| Bootstrap | 5.3.8 | Layout |
| Bootstrap Icons | 1.13.1 | Icons, including `fonts/*.woff` and `fonts/*.woff2` |
| qrcode | 1.5.4 | Address QR codes. Bundled with esbuild because the package has no UMD build |
| Solana crypto | 2.4.0 | One IIFE built from `scripts/solana-crypto-entry.js` |

The crypto bundle installs these exact packages and tree-shakes them:

- `@noble/curves` 2.4.0 — ed25519 sign, verify, and the on-curve check used for program addresses
- `@noble/hashes` 2.4.0 — SHA-256 and HMAC-SHA-512
- `@scure/bip39` 2.4.0 — seed phrases
- `@scure/base` 2.4.0 — base58

## Upgrade

1. Edit `version` for a UI library, or a `bundle.packages` version for the crypto bundle, in `manifest.json`. Bump the crypto bundle's own `version` if the filename should change.
2. Run `npm run vendor` (needs network once).
3. Run `npm test`.
4. Open `index.html`, create a wallet, and check a Receive QR code.

`npm run vendor` copies or rebuilds files, rewrites `data-lib` tags, refreshes the README file tree and version markers, and records SHA-256 hashes.

`npm run vendor:check` verifies files, hashes, HTML refs, and that `index.html` has no `http(s)` script or stylesheet. It does not use the network. Unit tests run that check.

Rebuild even when the hash still matches:

```bash
npm run vendor -- --force
```

## Policy

- Do not add jsDelivr, unpkg, cdnjs, or other CDN tags.
- Cloudflare Turnstile `api.js` is the one allowed remote script. The faucet captcha has to talk to Cloudflare.
- Commit the files in this folder. GitHub Pages deploys the repo as-is.
- Blockchain RPCs and the faucet worker are allowed network calls. They are not UI libraries.
- Vitest and jsdom are dev-only and are not loaded by `index.html`.
