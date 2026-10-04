import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function installSolanaCrypto() {
    if (globalThis.SolanaCrypto?.publicKeyFromSeed) {
        return globalThis.SolanaCrypto;
    }
    const code = readFileSync(join(ROOT, 'libs', 'solana-crypto-2.4.0.min.js'), 'utf8');
    const lib = vm.runInThisContext(`${code}\nSolanaCrypto`);
    globalThis.SolanaCrypto = lib;
    return lib;
}
