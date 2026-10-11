// @vitest-environment happy-dom
import type { DocumentEditing } from '../../editor/documentEditingTypes';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { legacyMarkdownReaches, setLegacyMarkdownStrict } from '../legacyMarkdownGuard';

const hosts: HTMLElement[] = [];
afterEach(() => {
    setLegacyMarkdownStrict(false);
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host);
    muya.init();
    muya.setContent(markdown);
    hosts.push(muya.domNode);
    return muya;
}

function bind(muya: Muya): () => void {
    return muya.editor.bindDocumentEditing({
        prepareImage() { throw new Error('Unexpected image preparation'); },
        prepareClipboard() { throw new Error('Unexpected clipboard preparation'); },
        emojiContext: () => undefined,
        codeLanguage: () => undefined,
        activeFormats: () => [],
        input: () => false,
        clipboard: () => { throw new Error('Unexpected clipboard'); },
        format: () => { throw new Error('Unexpected format'); },
        compositionStart: () => { throw new Error('Unexpected composition'); },
        compositionUpdate: () => { throw new Error('Unexpected composition'); },
        compositionEnd: () => { throw new Error('Unexpected composition'); },
    } as DocumentEditing);
}

it('lets an unbound Muya parse and serialize its own Markdown', () => {
    setLegacyMarkdownStrict(true);
    const muya = boot('# a\n');
    expect(muya.getMarkdown()).toBe('# a\n');
    expect(muya.editor.jsonState.markdownToState('b')).toHaveLength(1);
});

it('throws in strict mode when a bound Muya reaches either legacy module', () => {
    const muya = boot('# a\n');
    const unbind = bind(muya);
    setLegacyMarkdownStrict(true);
    expect(() => muya.getMarkdown()).toThrow('StateToMarkdown was reached while a document model is bound');
    expect(() => muya.editor.jsonState.markdownToState('b')).toThrow('MarkdownToState was reached while a document model is bound');
    unbind();
    expect(muya.getMarkdown()).toBe('# a\n');
});

it('records a reach without changing behavior outside strict mode', () => {
    const muya = boot('# a\n');
    bind(muya);
    const before = legacyMarkdownReaches().length;
    expect(muya.getMarkdown()).toBe('# a\n');
    expect(legacyMarkdownReaches().length).toBe(before + 1);
    expect(legacyMarkdownReaches().at(-1)?.module).toBe('StateToMarkdown');
});

// Every construction of a legacy module must report itself, or a bound path
// could reach it unseen.
it('reports every construction of a legacy module', () => {
    const root = join(import.meta.dirname, '..', '..');
    const sources: string[] = [];
    const walk = (directory: string): void => {
        for (const name of readdirSync(directory)) {
            const path = join(directory, name);
            if (statSync(path).isDirectory()) {
                if (name !== '__tests__')
                    walk(path);
            }
            else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
                sources.push(path);
            }
        }
    };
    walk(root);
    const unreported: string[] = [];
    let constructions = 0;
    for (const path of sources) {
        const lines = readFileSync(path, 'utf8').split('\n');
        lines.forEach((line, index) => {
            const constructed = /new (MarkdownToState|StateToMarkdown)\b/.exec(line);
            if (!constructed)
                return;
            constructions += 1;
            const preceding = lines.slice(Math.max(0, index - 2), index + 1).join('\n');
            if (!preceding.includes(`reachLegacyMarkdown(`) || !preceding.includes(`'${constructed[1]}'`))
                unreported.push(`${relative(root, path)}:${index + 1}`);
        });
    }
    expect(constructions).toBeGreaterThan(0);
    expect(unreported).toEqual([]);
});
