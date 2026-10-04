/**
 * Copy pinned browser libraries from npm into libs/.
 *
 *   npm run vendor          # refresh files from libs/manifest.json
 *   npm run vendor:check    # verify dest files, hashes, and HTML refs (no network)
 *
 * Upgrade: change `version` in libs/manifest.json, then `npm run vendor`.
 * The Solana crypto bundle lists its own package versions under `bundle.packages`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'libs', 'manifest.json');
const LIBS_DIR = join(ROOT, 'libs');
const INDEX_HTML = join(ROOT, 'index.html');
const README = join(ROOT, 'README.md');

export function resolveTemplate(template, version) {
    return template.replaceAll('{{version}}', version);
}

export function loadManifest(raw) {
    const manifest = JSON.parse(raw);
    const files = [];
    for (const lib of manifest.libraries) {
        for (const file of lib.files || []) {
            files.push({
                kind: 'copy',
                libraryId: lib.id,
                npm: lib.npm,
                version: lib.version,
                license: lib.license,
                homepage: lib.homepage,
                htmlId: file.id || null,
                from: file.from,
                dest: resolveTemplate(file.dest, lib.version),
                sha256: file.sha256,
                source: file,
            });
        }
        if (lib.bundle) {
            const { bundle } = lib;
            const packages = bundle.packages
                || (lib.npm ? [{ npm: lib.npm, version: lib.version }] : []);
            files.push({
                kind: 'bundle',
                libraryId: lib.id,
                npm: packages[0]?.npm || lib.npm,
                version: lib.version,
                packages,
                license: lib.license,
                homepage: lib.homepage,
                htmlId: bundle.id || null,
                entry: bundle.entry || null,
                localEntry: bundle.localEntry || null,
                globalName: bundle.globalName,
                esbuild: bundle.esbuild,
                dest: resolveTemplate(bundle.dest, lib.version),
                sha256: bundle.sha256,
                source: bundle,
            });
        }
    }
    return { manifest, files };
}

export function sha256Buffer(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

export function listCdnUrls(html) {
    const urls = [];
    const re = /\b(?:src|href)="(https?:[^"]+)"/g;
    let match;
    while ((match = re.exec(html))) {
        urls.push(match[1]);
    }
    return urls;
}

function formatTree(files) {
    const lines = ['libs/'];
    const dests = files.map((f) => f.dest).sort();
    dests.forEach((dest, i) => {
        const prefix = i === dests.length - 1 ? '└── ' : '├── ';
        lines.push(`${prefix}${dest}`);
    });
    return lines.join('\n');
}

export function applyHtmlLibRefs(html, files) {
    let next = html;
    for (const file of files) {
        if (!file.htmlId) {
            continue;
        }
        const attr = file.dest.endsWith('.css') ? 'href' : 'src';
        const re = new RegExp(
            `(${attr}="libs/)[^"]+("\\s+data-lib="${file.htmlId}")`,
        );
        if (!re.test(next)) {
            throw new Error(
                `index.html is missing data-lib="${file.htmlId}" on a ${attr}="libs/..." tag`,
            );
        }
        next = next.replace(re, `$1${file.dest}$2`);
    }
    return next;
}

const README_BEGIN = '<!-- vendor-libs:begin -->';
const README_END = '<!-- vendor-libs:end -->';

export function applyReadmeTree(readme, files) {
    const tree = ['```', formatTree(files), '```'].join('\n');
    const block = `${README_BEGIN}\n${tree}\n${README_END}`;
    if (!readme.includes(README_BEGIN) || !readme.includes(README_END)) {
        throw new Error('README.md is missing vendor-libs markers');
    }
    return readme.replace(
        new RegExp(`${README_BEGIN}[\\s\\S]*?${README_END}`),
        block,
    );
}

export function applyReadmeVersions(readme, manifest) {
    let next = readme;
    for (const lib of manifest.libraries) {
        const token = `<!-- vendor-version:${lib.id} -->`;
        const end = `<!-- /vendor-version:${lib.id} -->`;
        if (!next.includes(token) || !next.includes(end)) {
            continue;
        }
        next = next.replace(
            new RegExp(`${token}[\\s\\S]*?${end}`),
            `${token}${lib.version}${end}`,
        );
    }
    return next;
}

export async function checkVendored(files, html, readme) {
    const errors = [];
    for (const file of files) {
        const abs = join(LIBS_DIR, file.dest);
        let buf;
        try {
            buf = await readFile(abs);
        } catch {
            errors.push(`missing libs/${file.dest}`);
            continue;
        }
        const hash = sha256Buffer(buf);
        if (hash !== file.sha256) {
            errors.push(
                `hash mismatch libs/${file.dest}: expected ${file.sha256}, got ${hash}`,
            );
        }
        if (file.htmlId && !html.includes(`libs/${file.dest}`)) {
            errors.push(`index.html does not reference libs/${file.dest}`);
        }
        if (file.htmlId && !html.includes(`data-lib="${file.htmlId}"`)) {
            errors.push(`index.html is missing data-lib="${file.htmlId}"`);
        }
        if (!readme.includes(file.dest)) {
            errors.push(`README.md does not list ${file.dest}`);
        }
    }
    const cdn = listCdnUrls(html).filter(
        (url) => !url.startsWith('https://challenges.cloudflare.com/turnstile/'),
    );
    if (cdn.length) {
        errors.push(`unexpected CDN urls in index.html: ${cdn.join(', ')}`);
    }
    return errors;
}

function run(command, args, options = {}) {
    return execFileSync(command, args, {
        ...options,
        shell: process.platform === 'win32',
    });
}

async function extractNpmPackage(npm, version, destDir) {
    const packed = run('npm', ['pack', `${npm}@${version}`, '--silent'], {
        cwd: destDir,
        encoding: 'utf8',
    }).trim().split(/\r?\n/).pop();
    run('tar', ['-xzf', packed], { cwd: destDir });
    return join(destDir, 'package');
}

async function vendorCopy(file, packageDir) {
    const destAbs = join(LIBS_DIR, file.dest);
    await mkdir(dirname(destAbs), { recursive: true });
    await copyFile(join(packageDir, file.from), destAbs);
    const buf = await readFile(destAbs);
    file.source.sha256 = sha256Buffer(buf);
    file.sha256 = file.source.sha256;
}

async function vendorBundle(file, force) {
    const destAbs = join(LIBS_DIR, file.dest);
    if (!force) {
        try {
            const existing = await readFile(destAbs);
            if (sha256Buffer(existing) === file.sha256) {
                file.source.sha256 = file.sha256;
                return;
            }
        } catch {
            // missing; build it
        }
    }
    const work = await mkdtemp(join(tmpdir(), 'vendor-bundle-'));
    try {
        run('npm', ['init', '-y'], { cwd: work, stdio: 'ignore' });
        const specs = file.packages.map((pkg) => `${pkg.npm}@${pkg.version}`);
        run('npm', ['install', ...specs, '--silent'], {
            cwd: work,
            stdio: 'inherit',
        });
        let entry = file.entry
            ? join(work, 'node_modules', file.npm, file.entry)
            : null;
        if (file.localEntry) {
            entry = join(work, 'entry.js');
            await copyFile(join(ROOT, file.localEntry), entry);
        }
        await mkdir(dirname(destAbs), { recursive: true });
        run(
            'npx',
            [
                '--yes',
                `esbuild@${file.esbuild}`,
                entry,
                '--bundle',
                '--minify',
                '--format=iife',
                `--global-name=${file.globalName}`,
                '--legal-comments=none',
                `--outfile=${destAbs}`,
            ],
            { cwd: work, stdio: 'inherit' },
        );
        const buf = await readFile(destAbs);
        file.source.sha256 = sha256Buffer(buf);
        file.sha256 = file.source.sha256;
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}

async function removeStaleDests(files) {
    const keep = new Set(files.map((f) => f.dest));
    const { readdir } = await import('node:fs/promises');
    const top = await readdir(LIBS_DIR, { withFileTypes: true });
    for (const entry of top) {
        if (!entry.isFile()) {
            continue;
        }
        if (entry.name === 'manifest.json' || entry.name === 'README.md') {
            continue;
        }
        if (!keep.has(entry.name)) {
            await rm(join(LIBS_DIR, entry.name));
        }
    }
}

async function vendorAll(files, force) {
    const byNpm = new Map();
    for (const file of files) {
        if (file.kind !== 'copy') {
            continue;
        }
        const key = `${file.npm}@${file.version}`;
        if (!byNpm.has(key)) {
            byNpm.set(key, []);
        }
        byNpm.get(key).push(file);
    }
    for (const group of byNpm.values()) {
        const work = await mkdtemp(join(tmpdir(), 'vendor-pack-'));
        try {
            const packageDir = await extractNpmPackage(
                group[0].npm,
                group[0].version,
                work,
            );
            for (const file of group) {
                await vendorCopy(file, packageDir);
            }
        } finally {
            await rm(work, { recursive: true, force: true });
        }
    }
    for (const file of files) {
        if (file.kind === 'bundle') {
            await vendorBundle(file, force);
        }
    }
}

async function writeUpdatedManifest(manifest) {
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(MANIFEST_PATH, json);
}

function fileLabel(file) {
    if (file.packages?.length > 1) {
        return `${file.packages.map((pkg) => `${pkg.npm}@${pkg.version}`).join(' + ')} -> libs/${file.dest}`;
    }
    return `${file.npm}@${file.version} -> libs/${file.dest}`;
}

async function main() {
    const checkOnly = process.argv.includes('--check');
    const force = process.argv.includes('--force');
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    const { manifest, files } = loadManifest(raw);
    let html = await readFile(INDEX_HTML, 'utf8');
    let readme = await readFile(README, 'utf8');

    if (!checkOnly) {
        await vendorAll(files, force);
        html = applyHtmlLibRefs(html, files);
        readme = applyReadmeTree(readme, files);
        readme = applyReadmeVersions(readme, manifest);
        await writeFile(INDEX_HTML, html);
        await writeFile(README, readme);
        await writeUpdatedManifest(manifest);
        await removeStaleDests(files);
    }

    const errors = await checkVendored(files, html, readme);
    if (errors.length) {
        console.error(errors.map((e) => ` - ${e}`).join('\n'));
        process.exit(1);
    }
    const summary = files.map((file) => `  ${fileLabel(file)}`).join('\n');
    console.log(`${checkOnly ? 'Verified' : 'Vendored'} ${files.length} files:\n${summary}`);
}

const isMain = Boolean(
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
);
if (isMain) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
