import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Runtime import edges of one module: relative `import ... from` /
// `export ... from` specifiers, excluding pure `import type` (type-only
// edges carry no runtime coupling — the contract mirrors check-circular).
function runtimeImports(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    const edges: string[] = [];
    // Source is prettier-formatted, so `from` is always followed by exactly
    // one space and a quoted specifier.
    const pattern = /^(import|export) ([^;'"]*?)from '(\.[^']+)'/gm;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        if (match[1] === 'import' && /^type\s/.test(match[2].trim()))
            continue;

        const specifier = match[3];
        const base = resolve(dirname(file), specifier);
        const candidates = [base, `${base}.ts`, resolve(base, 'index.ts')];
        const target = candidates.find(candidate => candidate.endsWith('.ts') && existsSync(candidate));
        if (target)
            edges.push(target);
    }
    return edges;
}

function transitiveRuntimeReach(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [resolve(SRC_ROOT, entry)];
    while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file))
            continue;
        seen.add(file);
        queue.push(...runtimeImports(file));
    }
    return seen;
}

describe('comment feature dependency boundaries', () => {
    // The architectural rule from specs/architecture/parser-integration.md:
    // the dependency points ONE way — parser -> syntax <- analysis. The base
    // parser (and the marked pipeline under it) must never reach a comments
    // module beyond the grammar owner; the one time it did, it shipped a
    // dependency cycle and a mutual-recursion hazard. Resolved over the real
    // transitive import graph so a rename or re-export cannot dodge it.
    it('the base parser reaches no comments module beyond the grammar owner', () => {
        for (const entry of ['state/markdownToState.ts', 'utils/marked/index.ts']) {
            const offenders = [...transitiveRuntimeReach(entry)]
                .filter(file => file.includes('/comments/') && !file.endsWith('/comments/syntax.ts'))
                .map(file => `${entry} -> ${file.slice(SRC_ROOT.length + 1)}`);

            expect(offenders).toEqual([]);
        }
    });

    it('keeps inline rendering on the authoritative analyzer instead of the parser internals', () => {
        const source = readFileSync(new URL('../inlineRenderer/index.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('from \'../comments/parse\'');
        expect(source).not.toContain('from "../comments/parse"');
    });

    it('keeps metadata source edits on analyzer source maps instead of the raw source-index builder', () => {
        const source = readFileSync(new URL('../comments/edit.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('from \'./source\'');
        expect(source).not.toContain('buildCommentSourceIndex');
    });

    it('keeps markdown import restoration on analyzer source maps instead of the raw source-index builder', () => {
        const source = readFileSync(new URL('../state/markdownToState.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('from \'../comments/source\'');
        expect(source).not.toContain('buildCommentSourceIndex');
    });

    it('keeps HTML export stripping on the analyzer-backed helper', () => {
        const asyncExportSource = readFileSync(new URL('../state/markdownToHtml.ts', import.meta.url), 'utf8');
        const staticExportSource = readFileSync(new URL('../state/renderToStaticHTML.ts', import.meta.url), 'utf8');

        expect(asyncExportSource).toContain('stripAnalyzedCommentSyntaxFromMarkdown');
        expect(staticExportSource).toContain('stripAnalyzedCommentSyntaxFromMarkdown');
    });

    it('keeps paste id remapping on analyzer source maps instead of raw id/source-index helpers', () => {
        const source = readFileSync(new URL('../clipboard/paste.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('collectSourceCommentIds');
        expect(source).not.toContain('buildCommentSourceIndex');
    });
});
