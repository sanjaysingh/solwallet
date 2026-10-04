import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    applyHtmlLibRefs,
    applyReadmeTree,
    checkVendored,
    listCdnUrls,
    loadManifest,
    resolveTemplate,
} from '../scripts/vendor-libs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('vendored library manifest', () => {
    it('pins dest files that exist, match hashes, and are referenced locally', async () => {
        const raw = await readFile(join(ROOT, 'libs/manifest.json'), 'utf8');
        const html = await readFile(join(ROOT, 'index.html'), 'utf8');
        const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
        const { files } = loadManifest(raw);
        expect(files.length).toBeGreaterThan(0);
        const errors = await checkVendored(files, html, readme);
        expect(errors).toEqual([]);
    });

    it('has no CDN script or stylesheet in index.html', async () => {
        const html = await readFile(join(ROOT, 'index.html'), 'utf8');
        expect(listCdnUrls(html)).toEqual([]);
    });

    it('rewrites HTML data-lib refs and README tree from the manifest', () => {
        const files = [
            {
                htmlId: 'vue',
                dest: 'vue-9.9.9-vue.global.prod.min.js',
            },
            {
                htmlId: null,
                dest: 'fonts/bootstrap-icons.woff2',
            },
        ];
        const html = applyHtmlLibRefs(
            '<script src="libs/vue-3.5.40-vue.global.prod.min.js" data-lib="vue"></script>',
            files,
        );
        expect(html).toContain('libs/vue-9.9.9-vue.global.prod.min.js');
        expect(html).toContain('data-lib="vue"');

        const readme = applyReadmeTree(
            'before\n<!-- vendor-libs:begin -->\nold\n<!-- vendor-libs:end -->\nafter',
            files,
        );
        expect(readme).toContain('vue-9.9.9-vue.global.prod.min.js');
        expect(readme).toContain('fonts/bootstrap-icons.woff2');
        expect(resolveTemplate('solana-crypto-{{version}}.min.js', '2.4.0')).toBe(
            'solana-crypto-2.4.0.min.js',
        );
    });
});
