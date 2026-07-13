// @vitest-environment happy-dom

import type { TState } from '../../../state/types';
import type Parent from '../parent';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';
import { ScrollPage } from '../../scrollPage';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BLOCK_DIRECTORY = resolve(TEST_DIRECTORY, '../..');
const LEGACY_META_MODULE = resolve(TEST_DIRECTORY, '../immutableMeta.ts');

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown: 'seed\n' });
    muya.init();
    editors.push(muya);
    return muya;
}

function productionTypeScriptFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__tests__')
            continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory())
            files.push(...productionTypeScriptFiles(path));
        else if (entry.name.endsWith('.ts'))
            files.push(path);
    }
    return files;
}

function rawMetaSurfaces(): string[] {
    const violations: string[] = [];
    for (const file of productionTypeScriptFiles(BLOCK_DIRECTORY)) {
        const sourceFile = ts.createSourceFile(
            file,
            readFileSync(file, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
        );
        const visit = (node: ts.Node): void => {
            if (
                (
                    ts.isPropertyDeclaration(node)
                    || ts.isGetAccessor(node)
                    || ts.isSetAccessor(node)
                )
                && node.name?.getText(sourceFile) === 'meta'
            ) {
                if (
                    !ts.isGetAccessor(node)
                    || !node.body?.getText(sourceFile).includes('readBlockMeta')
                    || !node.type?.getText(sourceFile).startsWith('Readonly<')
                ) {
                    const position = sourceFile.getLineAndCharacterOfPosition(
                        node.getStart(sourceFile),
                    );
                    violations.push(`${file}:${position.line + 1}`);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return violations.sort();
}

describe('block serialization metadata architecture', () => {
    it('has no raw exported metadata store or writable class metadata surface', () => {
        expect(existsSync(LEGACY_META_MODULE)).toBe(false);
        expect(rawMetaSurfaces()).toEqual([]);
    });

    it('returns detached mutable state metadata while retaining immutable live metadata', () => {
        const muya = boot();
        const cases: TState[] = [
            {
                name: 'atx-heading',
                meta: { level: 2 },
                text: '## heading',
            },
            {
                name: 'setext-heading',
                meta: { level: 1, underline: '===' },
                text: 'heading',
            },
            {
                name: 'math-block',
                meta: { mathStyle: '' },
                text: 'x',
            },
            {
                name: 'diagram',
                meta: { lang: '', type: 'mermaid' },
                text: 'graph TD',
            },
        ];

        for (const input of cases) {
            const block = ScrollPage.loadBlock(input.name).create(
                muya,
                structuredClone(input),
            ) as Parent & {
                meta: Readonly<Record<string, unknown>>;
                getState: () => TState;
            };
            const liveMeta = block.meta;
            const state = block.getState() as TState & {
                meta: Record<string, unknown>;
            };
            const key = Object.keys(state.meta)[0];
            const original = liveMeta[key];

            expect(Object.isFrozen(liveMeta)).toBe(true);
            expect(state.meta).not.toBe(liveMeta);
            expect(() => {
                state.meta[key] = '__detached-state-edit__';
            }).not.toThrow();
            expect(liveMeta[key]).toBe(original);
            expect((block.getState() as typeof state).meta[key]).toBe(original);
        }
    });

    it('guards every runtime-reachable metadata replacement method', () => {
        const muya = boot();
        const block = muya.editor.scrollPage!.firstChild as Parent;
        const runtimeBlock = block as unknown as Record<string, unknown>;
        const documentEdit = runtimeBlock.replaceBlockMetaForDocumentEdit as (
            meta: object,
            operation: string,
        ) => void;
        const preparedState = runtimeBlock.replaceBlockMetaFromPreparedState as (
            meta: object,
            operation: string,
        ) => void;

        expect(() => documentEdit.call(block, {}, 'Raw metadata replacement'))
            .toThrowError(/mutation gateway/i);
        expect(() => preparedState.call(
            block,
            {},
            'Raw prepared metadata replacement',
        )).toThrowError(/mutation gateway/i);
    });

    it('rejects nested metadata from untyped JavaScript callers', () => {
        const muya = boot();

        expect(() => ScrollPage.loadBlock('atx-heading').create(muya, {
            name: 'atx-heading',
            meta: {
                level: 2,
                nestedBypass: { mutable: true },
            },
            text: '## heading',
        } as never)).toThrowError(/metadata.*scalar/i);
    });

    it('preserves __proto__ as inert metadata instead of invoking its setter', () => {
        const muya = boot();
        const meta = { level: 2 } as Record<string, unknown>;
        Object.defineProperty(meta, '__proto__', {
            configurable: true,
            enumerable: true,
            value: 'literal-metadata',
            writable: true,
        });

        const block = ScrollPage.loadBlock('atx-heading').create(muya, {
            name: 'atx-heading',
            meta,
            text: '## heading',
        } as never) as Parent & { meta: Record<string, unknown> };

        expect(Reflect.ownKeys(block.meta)).toContain('__proto__');
        expect(Reflect.get(block.meta, '__proto__')).toBe('literal-metadata');
        expect(Object.getPrototypeOf(block.meta)).toBe(Object.prototype);
    });

    it('rejects accessors and non-finite numbers before metadata enters storage', () => {
        const muya = boot();
        let accessorReads = 0;
        const accessorMeta = { level: 2 } as Record<string, unknown>;
        Object.defineProperty(accessorMeta, 'dynamic', {
            enumerable: true,
            get: () => {
                accessorReads++;
                return 'dynamic';
            },
        });

        expect(() => ScrollPage.loadBlock('atx-heading').create(muya, {
            name: 'atx-heading',
            meta: accessorMeta,
            text: '## heading',
        } as never)).toThrowError(/metadata.*data propert/i);
        expect(accessorReads).toBe(0);

        expect(() => ScrollPage.loadBlock('atx-heading').create(muya, {
            name: 'atx-heading',
            meta: { level: Number.NaN },
            text: '## heading',
        } as never)).toThrowError(/metadata.*finite/i);
    });
});
