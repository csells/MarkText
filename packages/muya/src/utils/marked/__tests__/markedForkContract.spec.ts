import { spawnSync } from 'node:child_process';
import {
    appendFileSync,
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { replaceArrayRange } from '../../arrayMutation';

const REPOSITORY_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../..',
);
const FORK_ROOT = join(REPOSITORY_ROOT, 'packages/marked');
const VERIFIER = join(FORK_ROOT, 'scripts/verify-fork.mjs');
const temporaryDirectories: string[] = [];

interface IVerifierResult {
    readonly status: number | null;
    readonly output: string;
}

function runVerifier(...args: string[]): IVerifierResult {
    const result = spawnSync(process.execPath, [VERIFIER, ...args], {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
    });
    return {
        status: result.status,
        output: `${result.stdout}${result.stderr}`,
    };
}

function copiedFork(): string {
    const directory = mkdtempSync(join(tmpdir(), 'marktext-marked-contract-'));
    temporaryDirectories.push(directory);
    const copy = join(directory, 'marked');
    cpSync(FORK_ROOT, copy, { recursive: true });
    return copy;
}

function copiedConsumerRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'marktext-marked-consumers-'));
    temporaryDirectories.push(root);
    const muyaRoot = join(root, 'packages/muya');
    mkdirSync(muyaRoot, { recursive: true });
    cpSync(
        join(REPOSITORY_ROOT, 'packages/muya/package.json'),
        join(muyaRoot, 'package.json'),
    );
    cpSync(
        join(REPOSITORY_ROOT, 'pnpm-lock.yaml'),
        join(root, 'pnpm-lock.yaml'),
    );
    return root;
}

afterEach(() => {
    while (temporaryDirectories.length)
        rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
});

describe('vendored Marked fork contract', () => {
    it('authenticates the complete checked-in fork surface offline', () => {
        const result = runVerifier();

        expect(result.output).toContain('Marked fork contract: PASS');
        expect(result.status, result.output).toBe(0);
    });

    it('runs its own negative drift controls without network access', () => {
        const result = runVerifier('--self-test');

        expect(result.output).toContain('Marked fork contract self-test: PASS');
        expect(result.status, result.output).toBe(0);
    });

    it('self-tests all five recorded drift classes', () => {
        // The self-test must keep one offline negative control per drift
        // class the fork contract certifies: source bytes, package version,
        // consumer wiring, manifest classification, and the canonical patch.
        const verifierSource = readFileSync(VERIFIER, 'utf8');
        for (const label of [
            'unrecorded source drift',
            'package-version drift',
            'decoy consumer importer drift',
            'manifest reclassification drift',
            'canonical patch drift',
        ]) {
            expect(verifierSource, `self-test lacks the ${label} control`)
                .toContain(`'${label}'`);
        }
    });

    it('rejects a manifest that reclassifies a modified file as unchanged', () => {
        const copy = copiedFork();
        const manifestPath = join(copy, 'FORK_MANIFEST.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const [reclassified, ...modified] = manifest.fork.surface.modified;
        expect(reclassified).toBeTruthy();
        manifest.fork.surface.modified = modified;
        manifest.fork.surface.unchanged = [
            ...manifest.fork.surface.unchanged,
            reclassified,
        ].sort();
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

        const result = runVerifier('--fork-root', copy);

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/classification|unchanged/i);
    });

    it('rejects a corrupted canonical patch', () => {
        const copy = copiedFork();
        const manifest = JSON.parse(
            readFileSync(join(copy, 'FORK_MANIFEST.json'), 'utf8'),
        );
        const patchPath = join(copy, manifest.fork.canonicalPatch);
        const patchLines = readFileSync(patchPath, 'utf8').split('\n');
        const additionIndex = patchLines.findIndex(line =>
            line.startsWith('+') && !line.startsWith('+++'));
        expect(additionIndex).toBeGreaterThan(0);
        patchLines[additionIndex] = `${patchLines[additionIndex]} /* drifted */`;
        writeFileSync(patchPath, patchLines.join('\n'));

        const result = runVerifier('--fork-root', copy);

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/apply|patch/i);
    });

    it('rejects an unrecorded source edit', () => {
        const copy = copiedFork();
        appendFileSync(join(copy, 'src/rules.ts'), '\n// unrecorded drift\n');

        const result = runVerifier('--fork-root', copy);

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/contract|patch|tree|drift/i);
    });

    it('rejects package-version drift independently of source bytes', () => {
        const copy = copiedFork();
        const packagePath = join(copy, 'package.json');
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
        packageJson.version = '18.0.5-marktext.999';
        writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

        const result = runVerifier('--fork-root', copy);

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/version/i);
    });

    it('rejects a decoy importer that masks broken Muya lock wiring', () => {
        const consumerRoot = copiedConsumerRoot();
        const lockPath = join(consumerRoot, 'pnpm-lock.yaml');
        const lines = readFileSync(lockPath, 'utf8').split('\n');
        const start = lines.indexOf('  packages/muya:');
        const end = lines.findIndex((line, index) =>
            index > start && /^ {2}\S/.test(line));
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const originalImporter = lines.slice(start, end).join('\n');
        const brokenMarkedImporter = originalImporter.replace(
            '      marked:\n        specifier: workspace:*\n        version: link:../marked',
            '      marked:\n        specifier: 18.0.5\n        version: 18.0.5',
        );
        const importer = brokenMarkedImporter.replace(
            '      commonmark-spec:\n        specifier: 0.31.2\n        version: 0.31.2',
            '      commonmark-spec:\n        specifier: 0.31.1\n        version: 0.31.1',
        );
        expect(importer).not.toBe(lines.slice(start, end).join('\n'));
        const replacement = [
            ...importer.split('\n'),
            '  packages/verifier-decoy:',
            '    dependencies:',
            '      marked:',
            '        specifier: workspace:*',
            '        version: link:../marked',
            '    devDependencies:',
            '      commonmark-spec:',
            '        specifier: 0.31.2',
            '        version: 0.31.2',
            '',
        ];
        replaceArrayRange(lines, start, end - start, replacement);
        writeFileSync(lockPath, lines.join('\n'));

        const result = runVerifier('--repository-root', consumerRoot);

        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/Muya lockfile importer/i);
    });
});
