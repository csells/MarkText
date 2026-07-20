// @vitest-environment happy-dom

import type { Muya as MuyaType } from '../../muya';
import type { TState } from '../types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const editors: MuyaType[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string): MuyaType {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function allStates(states: readonly TState[]): TState[] {
    return states.flatMap(state => [
        state,
        ...('children' in state
            ? allStates(state.children as TState[])
            : []),
    ]);
}

describe('parser-owned structural CriticMarkup state', () => {
    it.each([
        '{>>note<<}{--# head\n--}\n',
        '{--# head--}{>>note<<}\n',
    ])('loads same-line projected block boundaries into the editor: %j', (source) => {
        const muya = boot(source);

        expect(muya.getMarkdown()).toBe(source);
        expect(allStates(muya.getState()).some(state =>
            state.sourceTrivia?.suppressBlockTerminatorAfter === true))
            .toBe(true);
    });

    it('keeps valid CriticMarkup native across documented Markdown normalization', () => {
        const source = '\uFEFF😀 {++🚀++}\r\n{--旧--}\r\n';
        const normalized = '\uFEFF😀 {++🚀++}\n{--旧--}\r\n';
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(muya.getMarkdown()).toBe(normalized);
        expect(muya.getCriticMarkupItems().map(item => item.type))
            .toEqual(['addition', 'deletion']);
    });

    it.each([
        '{++++}',
        '{++text++}',
        '{++text++}\r\n',
    ])('keeps terminal-EOL form %j native instead of whole-document residue', (source) => {
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(muya.getMarkdown()).toBe(source);
    });

    it('reconciles a whole-table substitution without separator normalization', () => {
        const source = [
            '{~~| OLD |',
            '| --- |',
            '~>| NEW |',
            '| --- |',
            '~~}',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        const tables = flattened.filter(state => state.name === 'table');
        expect(tables).toHaveLength(2);
        expect(tables.map(table =>
            table.name === 'table'
                ? table.children[0].children[0].text
                : null))
            .toEqual(['OLD', 'NEW']);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(['| OLD |', '| --- |', '', ''].join('\n'));
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(['| NEW |', '| --- |', '', ''].join('\n'));
    });

    it('loads a deleted nested list item as native list AST plus an annotation overlay', () => {
        const source = [
            '- parent',
            '{--  - same',
            '--}  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const original = [
            '- parent',
            '  - same',
            '  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const revised = [
            '- parent',
            '  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const states = muya.getState();
        const flattened = allStates(states);
        const structural = flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.length
            || state.sourceTrivia?.criticAfter?.length);

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(states[0].name).toBe('bullet-list');
        expect(flattened.filter(state =>
            state.name === 'paragraph' && state.text === 'same'))
            .toHaveLength(2);
        expect(structural).toHaveLength(1);
        expect(structural[0]).toMatchObject({
            name: 'list-item',
            sourceTrivia: {
                criticBefore: [{
                    type: 'deletion',
                    marker: 'open',
                    raw: '{--',
                }],
                criticAfter: [{
                    type: 'deletion',
                    marker: 'close',
                    raw: '--}',
                }],
            },
        });

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(original);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(revised);

        const structuralNode = muya.domNode.querySelector(
            '[data-critic-structural-id]',
        );
        expect(structuralNode?.tagName).toBe('LI');
        expect(muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )).toHaveLength(1);
        expect(structuralNode?.getAttribute('data-critic-type'))
            .toBe('deletion');
    });

    it('loads an added nested list item from the Revised native carrier', () => {
        const source = [
            '- parent',
            '{++  - NEW',
            '++}  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const original = [
            '- parent',
            '  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const revised = [
            '- parent',
            '  - NEW',
            '  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.some(state =>
            state.name === 'paragraph' && state.text === 'NEW')).toBe(true);
        expect(flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'addition'
                && marker.marker === 'open'))).toHaveLength(1);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(original);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(revised);
        expect(muya.domNode.querySelector(
            '[data-critic-structural-id]',
        )?.tagName).toBe('LI');
        expect(muya.domNode.querySelector(
            '[data-critic-structural-id]',
        )?.getAttribute('data-critic-type')).toBe('addition');
    });

    it('binds one deletion across a contiguous run of native sibling items', () => {
        const source = [
            '- parent',
            '{--  - A',
            '  - B',
            '  - C',
            '--}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const original = [
            '- parent',
            '  - A',
            '  - B',
            '  - C',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const revised = [
            '- parent',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.length
            || state.sourceTrivia?.criticAfter?.length)).toHaveLength(2);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(original);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(revised);
        expect(muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )).toHaveLength(3);
    });

    it('reconciles multiple structural deletions into one native carrier tree', () => {
        const source = [
            '- parent',
            '{--  - A',
            '--}  - KEEP-1',
            '{--  - B',
            '--}  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const original = [
            '- parent',
            '  - A',
            '  - KEEP-1',
            '  - B',
            '  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const revised = [
            '- parent',
            '  - KEEP-1',
            '  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'deletion'
                && marker.marker === 'open'))).toHaveLength(2);
        for (const text of ['A', 'KEEP-1', 'B', 'KEEP-2']) {
            expect(flattened.some(state =>
                state.name === 'paragraph' && state.text === text)).toBe(true);
        }
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(original);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(revised);
        expect(muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )).toHaveLength(2);
    });

    it('reconciles mixed Original and Revised structural runs in canonical order', () => {
        const source = [
            '- parent',
            '{--  - OLD',
            '--}  - KEEP-1',
            '{++  - NEW',
            '++}  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const original = [
            '- parent',
            '  - OLD',
            '  - KEEP-1',
            '  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const revised = [
            '- parent',
            '  - KEEP-1',
            '  - NEW',
            '  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        for (const text of ['OLD', 'KEEP-1', 'NEW', 'KEEP-2']) {
            expect(flattened.some(state =>
                state.name === 'paragraph' && state.text === text)).toBe(true);
        }
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(original);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(revised);
        expect([...muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )].map(node => node.getAttribute('data-critic-type')))
            .toEqual(['deletion', 'addition']);
    });

    it('keeps inline Critic syntax native while reconciling a structural sibling', () => {
        const source = [
            'Intro {++inline++}.',
            '',
            '- parent',
            '{--  - OLD',
            '--}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.some(state =>
            state.name === 'paragraph'
            && state.text === 'Intro {++inline++}.')).toBe(true);
        expect(flattened.some(state =>
            state.name === 'paragraph' && state.text === 'OLD')).toBe(true);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems().map(item => item.type))
            .toEqual(['addition', 'deletion']);
        expect(muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )).toHaveLength(1);
        expect(muya.domNode.querySelector(
            '[data-critic-structural-id]',
        )?.tagName).toBe('LI');
        expect(muya.domNode.querySelector(
            '[data-critic-id]',
        )).not.toBeNull();
    });

    it('keeps nested inline feedback inside a native structural carrier', () => {
        const source = [
            '- parent',
            '{--  - OLD {++nested++}',
            '--}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.some(state =>
            state.name === 'paragraph'
            && state.text === 'OLD {++nested++}')).toBe(true);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems().map(item => item.type))
            .toEqual(['deletion', 'addition']);
        expect(muya.domNode.querySelector(
            '[data-critic-structural-id]',
        )?.tagName).toBe('LI');
        expect(muya.domNode.querySelector(
            '[data-critic-id]',
        )).not.toBeNull();
    });

    it('keeps payload escape bytes in native state while projections decode them', () => {
        const source = [
            String.raw`{--- literal \{++ nope`,
            '--}- KEEP',
            '',
        ].join('\n');
        const muya = boot(source);
        const states = muya.getState();
        const flattened = allStates(states);

        expect(states[0].name).toBe('bullet-list');
        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.some(state =>
            state.name === 'paragraph'
            && state.text === String.raw`literal \{++ nope`)).toBe(true);
        expect(flattened.some(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'deletion'))).toBe(true);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe('- literal {++ nope\n- KEEP\n');
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe('- KEEP\n');
    });

    it('merges whole-node substitution arms into one native union list', () => {
        const source = [
            '- parent',
            '{~~  - OLD',
            '~>  - NEW',
            '~~}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const original = [
            '- parent',
            '  - OLD',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const revised = [
            '- parent',
            '  - NEW',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        for (const text of ['OLD', 'NEW', 'KEEP']) {
            expect(flattened.some(state =>
                state.name === 'paragraph' && state.text === text)).toBe(true);
        }
        expect(flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.length
            || state.sourceTrivia?.criticAfter?.length)).toHaveLength(2);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(original);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(revised);
        expect(muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )).toHaveLength(2);
        const structuralNodes = [...muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )];
        expect(structuralNodes.every(node => node.tagName === 'LI')).toBe(true);
        expect(structuralNodes.map(node =>
            node.getAttribute('data-critic-role'))).toEqual(['old', 'new']);
    });

    it('preserves projection-local ordered markers in a native substitution union', () => {
        const source = [
            '1. parent',
            '{~~   1. OLD',
            '~>   1. NEW',
            '~~}   2. KEEP',
            '2. tail',
            '',
        ].join('\n');
        const original = [
            '1. parent',
            '   1. OLD',
            '   2. KEEP',
            '2. tail',
            '',
        ].join('\n');
        const revised = [
            '1. parent',
            '   1. NEW',
            '   2. KEEP',
            '2. tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        for (const text of ['OLD', 'NEW', 'KEEP']) {
            expect(flattened.some(state =>
                state.name === 'paragraph' && state.text === text)).toBe(true);
        }
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(original);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(revised);
        expect([...muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )].map(node => node.getAttribute('data-critic-role')))
            .toEqual(['old', 'new']);
    });

    it('preserves per-item blank-line syntax in a mixed-looseness native union', () => {
        const source = [
            '{--- OLD',
            '',
            '--}{++- NEW',
            '++}- KEEP',
            '',
        ].join('\n');
        const muya = boot(source);
        const states = muya.getState();
        const flattened = allStates(states);

        expect(states[0].name).toBe('bullet-list');
        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        for (const text of ['OLD', 'NEW', 'KEEP']) {
            expect(flattened.some(state =>
                state.name === 'paragraph' && state.text === text)).toBe(true);
        }
        expect(muya.getMarkdown()).toBe(source);
        expect([...muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )].map(node => node.getAttribute('data-critic-type')))
            .toEqual(['deletion', 'addition']);
    });

    it('binds one structural item across exact native runs with different parents', () => {
        const source = [
            '- parent',
            '{--  - nested',
            '',
            'root paragraph',
            '--}',
            '# tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const states = muya.getState();
        const flattened = allStates(states);

        expect(states.map(state => state.name))
            .toEqual(['bullet-list', 'paragraph', 'atx-heading']);
        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.some(state =>
            state.name === 'paragraph' && state.text === 'nested')).toBe(true);
        expect(flattened.some(state =>
            state.name === 'paragraph'
            && state.text === 'root paragraph')).toBe(true);
        expect(flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.length
            || state.sourceTrivia?.criticAfter?.length)).toHaveLength(2);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe([
                '- parent',
                '  - nested',
                '',
                'root paragraph',
                '',
                '# tail',
                '',
            ].join('\n'));
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(['- parent', '', '# tail', ''].join('\n'));
        const structuralNodes = [...muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )];
        expect(structuralNodes.map(node => node.tagName)).toEqual(['LI', 'P']);
        expect(new Set(structuralNodes.map(node =>
            node.getAttribute('data-critic-structural-id'))).size).toBe(1);
    });

    it('loads a block-structured comment body into a native annotated carrier', () => {
        const source = [
            '- parent',
            '{>>  - COMMENT',
            '<<}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const projected = [
            '- parent',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.some(state =>
            state.name === 'paragraph' && state.text === 'COMMENT')).toBe(true);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(projected);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(projected);
        const structuralComment = muya.domNode.querySelector(
            '[data-critic-structural-id]',
        );
        expect(structuralComment?.getAttribute('data-critic-type'))
            .toBe('comment');
        expect(structuralComment?.hasAttribute('hidden')).toBe(true);
    });

    it('keeps a visible block unhidden when an empty comment is bound only to its boundary', () => {
        const source = [
            '- parent',
            '{>><<}  - child',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const document = muya.editor.criticMarkupDocument.get();
        const comment = document.items.find(item => item.syntax.type === 'comment');

        expect(comment).toBeDefined();
        expect(comment?.structuralFragments).toHaveLength(1);
        expect(comment?.structuralFragments[0]).toMatchObject({
            kind: 'boundary',
        });
        const [fragment] = comment!.structuralFragments;
        const carrier = muya.editor.scrollPage?.queryBlock([...fragment.path]);
        expect(carrier?.domNode?.textContent).toContain('child');
        expect(carrier?.domNode?.hasAttribute('hidden')).toBe(false);
        expect(muya.getMarkdown()).toBe(source);
    });

    it('reconciles nested structural items into one native annotated tree', () => {
        const source = [
            '- parent',
            '{--  - OLD-PARENT',
            '{++    - NESTED',
            '++}  - OLD',
            '--}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        for (const text of ['OLD-PARENT', 'NESTED', 'OLD', 'KEEP']) {
            expect(flattened.some(state =>
                state.name === 'paragraph' && state.text === text)).toBe(true);
        }
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems().map(item => item.type))
            .toEqual(['deletion', 'addition']);
        const sharedNested = muya.domNode.querySelector(
            '.mu-critic-structural-multiple[data-critic-type~="addition"]',
        );
        expect(sharedNested).not.toBeNull();
        expect(sharedNested?.getAttribute('data-critic-type')?.split(' '))
            .toEqual(['deletion', 'addition']);
        expect(sharedNested?.getAttribute('data-critic-id')?.split(' '))
            .toHaveLength(2);
        expect(sharedNested?.hasAttribute('data-critic-structural-id'))
            .toBe(false);
    });

    it('keeps nested structural identities independently addressable on a shared native block', () => {
        const source = [
            '{--{++# NESTED',
            '++}--}',
            '# tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const document = muya.editor.criticMarkupDocument.get();
        const sharedPath = document.pathsWithStructuralFragments().find(path =>
            document.structuralFragmentsForPath(path).length > 1);

        expect(sharedPath).toBeDefined();
        if (!sharedPath)
            throw new TypeError('Fixture has no shared structural path.');
        const sharedEntries = document.structuralFragmentsForPath(sharedPath);
        const sharedIds = [...new Set(sharedEntries.map(entry => entry.item.id))];
        expect(sharedIds).toHaveLength(2);
        const block = muya.editor.scrollPage?.queryBlock([...sharedPath]);
        expect(block?.criticMarkupStructuralFragments.map(entry =>
            entry.item.id)).toEqual(sharedEntries.map(entry => entry.item.id));
        expect(block?.domNode?.getAttribute('data-critic-id')?.split(' '))
            .toEqual(sharedIds);
        expect(block?.domNode?.hasAttribute('data-critic-structural-id'))
            .toBe(false);
        for (const itemId of sharedIds) {
            expect(muya.domNode.querySelector(
                `[data-critic-id~="${itemId}"]`,
            )).not.toBeNull();
        }
    });

    it('anchors an empty structural item at the exact next native boundary', () => {
        const source = [
            '- parent',
            '{++++}  - child',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const flattened = allStates(muya.getState());
        const anchored = flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'addition'));

        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(anchored).toHaveLength(1);
        expect(anchored[0]).toMatchObject({
            name: 'list-item',
            sourceTrivia: {
                criticBefore: [
                    { type: 'addition', marker: 'open', raw: '{++' },
                    { type: 'addition', marker: 'close', raw: '++}' },
                ],
            },
        });
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(['- parent', '  - child', '- tail', ''].join('\n'));
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe(['- parent', '  - child', '- tail', ''].join('\n'));
        const boundaryNode = muya.domNode.querySelector(
            '[data-critic-structural-id]',
        );
        expect(boundaryNode?.tagName).toBe('LI');
        expect(boundaryNode?.getAttribute('data-critic-role'))
            .toBe('boundary');
        expect(boundaryNode?.getAttribute('data-critic-boundary'))
            .toBe('before');
    });

    it('keeps a partial lazy-continuation item native with parser-owned prefixes', () => {
        const source = [
            '- parent',
            '{--  continuation OLD',
            '--}  continuation KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const states = muya.getState();
        const flattened = allStates(states);

        expect(states[0].name).toBe('bullet-list');
        expect(flattened.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(flattened.some(state =>
            state.name === 'paragraph'
            && state.text === [
                'parent',
                '{--  continuation OLD',
                '--}  continuation KEEP',
            ].join('\n'))).toBe(true);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems()).toHaveLength(1);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe([
                '- parent',
                '  continuation OLD',
                '  continuation KEEP',
                '- tail',
                '',
            ].join('\n'));
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe([
                '- parent',
                '  continuation KEEP',
                '- tail',
                '',
            ].join('\n'));
    });

    it.each([
        { decision: 'accept' as const, value: 'NEW' },
        { decision: 'reject' as const, value: 'OLD' },
    ])('$decision resolves a whole-node substitution and undo restores both arms', async ({
        decision,
        value,
    }) => {
        const source = [
            '- parent',
            '{~~  - OLD',
            '~>  - NEW',
            '~~}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const expected = [
            '- parent',
            `  - ${value}`,
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const [item] = muya.getCriticMarkupItems();

        expect(muya.resolveCriticMarkup(decision, item)).toBe(true);
        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )).toHaveLength(0);

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        expect([...muya.domNode.querySelectorAll(
            '[data-critic-structural-id]',
        )].map(node => node.getAttribute('data-critic-role')))
            .toEqual(['old', 'new']);
    });

    it.each([
        {
            decision: 'accept' as const,
            expected: [
                '- parent',
                '  - same',
                '  - KEEP',
                '- tail',
                '',
            ].join('\n'),
        },
        {
            decision: 'reject' as const,
            expected: [
                '- parent',
                '  - same',
                '  - same',
                '  - KEEP',
                '- tail',
                '',
            ].join('\n'),
        },
    ])('$decision resolves native structural deletion and undo restores its trivia', async ({
        decision,
        expected,
    }) => {
        const source = [
            '- parent',
            '{--  - same',
            '--}  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const [item] = muya.getCriticMarkupItems();

        expect(muya.resolveCriticMarkup(decision, item)).toBe(true);
        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.domNode.querySelector(
            '[data-critic-structural-id]',
        )).toBeNull();

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        expect(muya.domNode.querySelector(
            '[data-critic-structural-id]',
        )?.tagName).toBe('LI');
        expect(allStates(muya.getState()).filter(state =>
            state.sourceTrivia?.criticBefore?.length
            || state.sourceTrivia?.criticAfter?.length)).toHaveLength(1);
    });
});
