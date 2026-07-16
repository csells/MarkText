import type { Token, Tokens } from 'marked';
import type { TState } from '../../../state/types';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../../../state/markdownToState';
import StateToMarkdown from '../../../state/stateToMarkdown';
import { analyzeMarkdownBlockSource } from '../lexBlock';

const OPTIONS = {
    criticMarkup: true,
    criticMarkupProjection: 'marked' as const,
    footnote: false,
    frontMatter: false,
    gfm: true,
    isGitlabCompatibilityEnabled: false,
    math: false,
    superSubScript: false,
};

function nativeCriticFragments(tokens: readonly Token[]): Tokens.CriticMarkupFragment[] {
    const result: Tokens.CriticMarkupFragment[] = [];
    const pending = [...tokens];
    while (pending.length) {
        const token = pending.pop()!;
        if (
            token.type === 'critic_addition'
            || token.type === 'critic_deletion'
            || token.type === 'critic_substitution'
            || token.type === 'critic_highlight'
            || token.type === 'critic_comment'
        ) {
            const fragment = token as Tokens.CriticMarkupFragment;
            result.push(fragment);
            pending.push(...fragment.tokens);
        }
        else if ('tokens' in token && Array.isArray(token.tokens)) {
            pending.push(...token.tokens);
        }
        else if (token.type === 'list') {
            pending.push(...token.items);
        }
    }
    return result.sort((left, right) =>
        left.range.start - right.range.start
        || left.range.end - right.range.end);
}

function flattenStates(states: readonly TState[]): TState[] {
    return states.flatMap(state => [
        state,
        ...('children' in state
            ? flattenStates(state.children as TState[])
            : []),
    ]);
}

describe('parser-native CriticMarkup AST', () => {
    it('owns a whole-table substitution and recursively parses each arm', () => {
        const source = [
            '{~~| OLD |',
            '| --- |',
            '~>| NEW |',
            '| --- |',
            '~~}',
            '',
        ].join('\n');
        const oldRaw = ['| OLD |', '| --- |', ''].join('\n');
        const newRaw = ['| NEW |', '| --- |', ''].join('\n');
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        const fragments = parsed.tokens.filter(candidate =>
            candidate.type === 'critic_substitution') as
            Tokens.CriticSubstitution[];

        expect(parsed.tokens.criticMarkup).not.toBeNull();
        expect(parsed.tokens.criticMarkup?.roots).toHaveLength(1);
        expect(parsed.tokens.criticMarkup?.items).toHaveLength(1);
        expect(parsed.tokens.criticMarkup?.items[0]).toMatchObject({
            criticType: 'substitution',
            raw: source.slice(0, -1),
            arms: [
                { name: 'old', raw: oldRaw },
                { name: 'new', raw: newRaw },
            ],
        });
        expect(fragments).toHaveLength(2);
        expect(fragments[0]).toMatchObject({
            type: 'critic_substitution',
            level: 'block',
            fragmentKind: 'content',
            arm: 'old',
            role: 'start',
            contentRaw: oldRaw,
            before: [{ raw: '{~~' }],
            after: [{ raw: '~>' }],
        });
        expect(fragments[1]).toMatchObject({
            type: 'critic_substitution',
            level: 'block',
            fragmentKind: 'content',
            arm: 'new',
            role: 'end',
            contentRaw: newRaw,
            before: [],
            after: [{ raw: '~~}' }],
        });
        expect(fragments[0].itemId).toBe(fragments[1].itemId);
        expect(fragments[0].tokens.map(child => child.type)).toEqual(['table']);
        expect(fragments[1].tokens.map(child => child.type)).toEqual(['table']);
        const oldTable = fragments[0].tokens[0] as Tokens.Table;
        const newTable = fragments[1].tokens[0] as Tokens.Table;
        expect(oldTable.header.map(cell => cell.text)).toEqual(['OLD']);
        expect(oldTable.rows).toEqual([]);
        expect(newTable.header.map(cell => cell.text)).toEqual(['NEW']);
        expect(newTable.rows).toEqual([]);

        expect(fragments.flatMap(fragment =>
            parsed.trace.tokenConsumptions(fragment))
            .map(consumption => consumption.source.text)
            .join(''))
            .toBe(parsed.parserSource);
        expect(parsed.parserSource).toBe([
            '| OLD |',
            '| --- |',
            '| NEW |',
            '| --- |',
            '',
            '',
        ].join('\n'));
        const oldInvocations = parsed.trace.invocationsForTokens(
            fragments[0].tokens,
        )
            .filter(invocation => invocation.level === 'block');
        const newInvocations = parsed.trace.invocationsForTokens(
            fragments[1].tokens,
        )
            .filter(invocation => invocation.level === 'block');
        expect(oldInvocations.map(invocation => invocation.input.text))
            .toEqual([oldRaw]);
        expect(newInvocations.map(invocation => invocation.input.text))
            .toEqual([newRaw]);
        expect(parsed.trace.residues).toEqual([]);
    });

    it('lowers independent block arms directly into native Muya states', () => {
        const source = [
            '{~~| OLD |',
            '| --- |',
            '~>| NEW |',
            '| --- |',
            '~~}',
            '',
        ].join('\n');
        const states = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generate(source);
        const tables = states.filter(state => state.name === 'table');

        expect(tables).toHaveLength(2);
        expect(tables.map(table =>
            table.name === 'table'
                ? table.children[0].children[0].text
                : null))
            .toEqual(['OLD', 'NEW']);
        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
    });

    it('emits linked native inline fragments inside the Markdown paragraph AST', () => {
        const source = 'before {~~*old*~>**new**~~} after\n';
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        const paragraph = parsed.tokens[0] as Tokens.Paragraph;
        const fragments = paragraph.tokens.filter(token =>
            token.type === 'critic_substitution') as
            Tokens.CriticSubstitution[];

        expect(fragments).toHaveLength(2);
        expect(fragments.map(fragment => ({
            level: fragment.level,
            arm: fragment.arm,
            role: fragment.role,
            contentRaw: fragment.contentRaw,
            children: fragment.tokens.map(token => token.type),
        }))).toEqual([
            {
                level: 'inline',
                arm: 'old',
                role: 'start',
                contentRaw: '*old*',
                children: ['em'],
            },
            {
                level: 'inline',
                arm: 'new',
                role: 'end',
                contentRaw: '**new**',
                children: ['strong'],
            },
        ]);
        expect(fragments[0].itemId).toBe(fragments[1].itemId);
        expect(parsed.trace.invocationsForTokens(fragments[0].tokens)
            .map(invocation => invocation.input.text))
            .toContain('*old*');
        expect(parsed.trace.invocationsForTokens(fragments[1].tokens)
            .map(invocation => invocation.input.text))
            .toContain('**new**');
    });

    it('keeps incompatible block alternatives in isolated parser contexts', () => {
        const source = [
            '{~~```',
            'old',
            '~># new',
            '~~}',
            '',
        ].join('\n');
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        const fragments = parsed.tokens.filter(token =>
            token.type === 'critic_substitution') as
            Tokens.CriticSubstitution[];

        expect(fragments).toHaveLength(2);
        expect(fragments[0].tokens).toMatchObject([{
            type: 'code',
            text: 'old',
        }]);
        expect(fragments[1].tokens).toMatchObject([{
            type: 'heading',
            depth: 1,
            text: 'new',
        }]);

        const states = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generate(source);
        expect(states.map(state => state.name))
            .toEqual(['code-block', 'atx-heading']);
        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
    });

    it('splits one cross-parent item into linked native fragments', () => {
        const source = [
            'before {--old',
            '- item',
            'after--} tail',
            '',
        ].join('\n');
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        const fragments = nativeCriticFragments(parsed.tokens);

        expect(parsed.tokens.criticMarkup?.items).toMatchObject([{
            criticType: 'deletion',
            arms: [{
                name: 'content',
                raw: ['old', '- item', 'after'].join('\n'),
            }],
        }]);
        // A mixed (inline-anchored, block-spanning) item lowers to per-line
        // literal inline fragments; the covered lines parse natively (the
        // `- item` line becomes a native list) and each line piece binds
        // inside whichever leaf hosts it.
        expect(fragments.map(fragment => ({
            level: fragment.level,
            role: fragment.role,
            contentRaw: fragment.contentRaw,
            children: fragment.tokens.map(token => token.type),
            before: fragment.before.map(value => value.name),
            after: fragment.after.map(value => value.name),
        }))).toEqual([
            {
                level: 'inline',
                role: 'start',
                contentRaw: 'old',
                children: ['text'],
                before: ['open'],
                after: [],
            },
            {
                level: 'inline',
                role: 'middle',
                contentRaw: 'item',
                children: ['text'],
                before: [],
                after: [],
            },
            {
                level: 'inline',
                role: 'end',
                contentRaw: 'after',
                children: ['text'],
                before: [],
                after: ['close'],
            },
        ]);
        expect(new Set(fragments.map(fragment => fragment.itemId)).size)
            .toBe(1);
        expect(parsed.trace.residues).toEqual([]);
    });

    it('binds parser-owned mixed-item identity to produced state paths', () => {
        const source = [
            'before {--old',
            '- item',
            'after--} tail',
            '',
        ].join('\n');
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        const fragments = nativeCriticFragments(parsed.tokens);
        const itemId = fragments[0]?.itemId;
        if (!itemId)
            throw new TypeError('Fixture produced no native critic fragment.');

        const lowered = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generateWithMetadata(source);

        // The mixed item's covered `- item` line parses as a native list
        // between the two paragraphs; every fragment binds inline in the
        // exact leaf hosting its line.
        expect(lowered.states.map(state => state.name)).toEqual([
            'paragraph',
            'bullet-list',
        ]);
        expect(lowered.criticMarkupBindings.block).toEqual([]);
        expect(lowered.criticMarkupBindings.inline).toMatchObject([
            { itemId, path: [0, 'text'], role: 'start' },
            {
                itemId,
                path: [1, 'children', 0, 'children', 0, 'text'],
                role: 'middle',
            },
            {
                itemId,
                path: [1, 'children', 0, 'children', 0, 'text'],
                role: 'end',
            },
        ]);
        expect(Object.isFrozen(lowered.criticMarkupBindings)).toBe(true);
        expect(Object.isFrozen(lowered.criticMarkupBindings.inline)).toBe(true);
        expect(Object.isFrozen(lowered.criticMarkupBindings.inline[0]))
            .toBe(true);
        expect(Object.isFrozen(
            lowered.criticMarkupBindings.inline[0].localRange,
        )).toBe(true);
        expect(Object.isFrozen(
            lowered.criticMarkupBindings.inline[0].sourceRange,
        )).toBe(true);
    });

    it('binds zero-width block attachments without inventing content', () => {
        const source = '{++++}';
        const lowered = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generateWithMetadata(source);
        const item = lowered.criticMarkup?.items[0];
        if (!item)
            throw new TypeError('Fixture produced no native CriticMarkup item.');

        expect(lowered.criticMarkupBindings.block).toEqual([{
            kind: 'boundary',
            path: [0],
            itemId: item.id,
            criticType: 'addition',
            arm: 'content',
            role: 'only',
            edge: 'after',
            sourceRange: { start: 0, end: source.length },
            localRange: { start: 3, end: 3 },
        }]);
    });

    it('nests structural items through transparent ancestor markers', () => {
        const source = [
            '{--{++# NESTED',
            '++}--}',
            '# tail',
            '',
        ].join('\n');
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        const outer = parsed.tokens[0] as Tokens.CriticDeletion;
        const inner = outer.tokens[0] as Tokens.CriticAddition;

        expect(outer).toMatchObject({
            type: 'critic_deletion',
            level: 'block',
            role: 'only',
            before: [{ name: 'open' }],
            after: [{ name: 'close' }],
        });
        expect(inner).toMatchObject({
            type: 'critic_addition',
            level: 'block',
            role: 'only',
            before: [{ name: 'open' }],
            after: [{ name: 'close' }],
            tokens: [{
                type: 'heading',
                depth: 1,
                text: 'NESTED',
            }],
        });
        expect(parsed.tokens.criticMarkup?.items.map(item => ({
            id: item.id,
            parentId: item.parentId,
            criticType: item.criticType,
        }))).toEqual([
            {
                id: outer.itemId,
                parentId: null,
                criticType: 'deletion',
            },
            {
                id: inner.itemId,
                parentId: outer.itemId,
                criticType: 'addition',
            },
        ]);

        const states = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generate(source);
        expect(states.map(state => state.name))
            .toEqual(['atx-heading', 'atx-heading']);
        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
    });

    it('lowers an empty native boundary in canonical marker order', () => {
        const source = '{++++}';
        const states = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generate(source);

        expect(states).toMatchObject([{
            name: 'paragraph',
            text: '',
            sourceTrivia: {
                criticBefore: [
                    { marker: 'open', raw: '{++' },
                    { marker: 'close', raw: '++}' },
                ],
            },
        }]);
        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
    });

    it('uses Markdown parsing to distinguish a nested list arm from lazy text', () => {
        const source = [
            '- parent',
            '{--  - same',
            '--}  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        // A pure-list structural arm welds into the surrounding native list;
        // its coverage attachments land on the exact semantic list item, not
        // on a fragment token or the containing list.
        expect(nativeCriticFragments(parsed.tokens)).toEqual([]);
        const rootList = parsed.tokens[0] as Tokens.List;
        const nestedList = rootList.items[0].tokens.find(token =>
            token.type === 'list') as Tokens.List | undefined;
        const coveredItem = nestedList?.items[0] as (
            Tokens.ListItem & Tokens.CriticMarkupBoundaryCarrier
        ) | undefined;
        expect(coveredItem?.criticMarkupBefore).toMatchObject([{
            criticType: 'deletion',
            arm: 'content',
            edge: 'before',
            coverage: 'content',
            markers: [{ name: 'open', raw: '{--' }],
        }]);
        expect(coveredItem?.criticMarkupAfter).toMatchObject([{
            criticType: 'deletion',
            edge: 'after',
            coverage: 'content',
            markers: [{ name: 'close', raw: '--}' }],
        }]);
        const states = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generate(source);
        const flattened = flattenStates(states);

        expect(states[0].name).toBe('bullet-list');
        expect(flattened.filter(state =>
            state.name === 'paragraph' && state.text === 'same'))
            .toHaveLength(2);
        expect(flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'deletion')))
            .toHaveLength(1);
        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
    });

    it('preserves every native marker across multiple structural siblings', () => {
        const source = [
            '- parent',
            '{--  - A',
            '--}  - KEEP-1',
            '{--  - B',
            '--}  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const lowered = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generateWithMetadata(source);
        const states = lowered.states;
        // Each sibling deletion keeps its own identity and binds its exact
        // native list item.
        expect(new Set(lowered.criticMarkupBindings.block
            .map(binding => binding.itemId)).size).toBe(2);
        expect(lowered.criticMarkupBindings.block.map(binding => ({
            kind: binding.kind,
            path: binding.path,
        }))).toEqual([
            {
                kind: 'content',
                path: [0, 'children', 0, 'children', 1, 'children', 0],
            },
            {
                kind: 'content',
                path: [0, 'children', 0, 'children', 1, 'children', 2],
            },
        ]);
        const structural = flattenStates(states).filter(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'deletion'
                && marker.marker === 'open'));
        expect(structural).toHaveLength(2);
        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
    });

    it('keeps arm-internal blank lines before the closing marker', () => {
        const source = [
            '{--- OLD',
            '',
            '--}{++- NEW',
            '++}- KEEP',
            '',
        ].join('\n');
        const lowered = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generateWithMetadata(source);
        const states = lowered.states;

        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
        const deletion = lowered.criticMarkup?.items.find(item =>
            item.criticType === 'deletion');
        expect(lowered.criticMarkupBindings.block.filter(binding =>
            binding.itemId === deletion?.id)).toMatchObject([{
            kind: 'content',
            arm: 'content',
        }]);
    });

    it('keeps an empty structural item transparent to surrounding list topology', () => {
        const source = [
            '- parent',
            '{++++}  - child',
            '- tail',
            '',
        ].join('\n');
        const transparentSource = [
            '- parent',
            '  - child',
            '- tail',
            '',
        ].join('\n');
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);

        expect(parsed.tokens.criticMarkup?.items).toMatchObject([{
            criticType: 'addition',
            arms: [{ name: 'content', raw: '' }],
        }]);
        const rootList = parsed.tokens[0] as Tokens.List;
        const childList = rootList.items[0].tokens.find(token =>
            token.type === 'list') as Tokens.List | undefined;
        // The zero-width boundary anchors to the exact semantic list item
        // the marker precedes, not to its containing list.
        const childItem = childList?.items[0] as (
            Tokens.ListItem & Tokens.CriticMarkupBoundaryCarrier
        ) | undefined;
        expect(childItem?.criticMarkupBefore).toMatchObject([{
            itemId: parsed.tokens.criticMarkup?.items[0].id,
            criticType: 'addition',
            arm: 'content',
            role: 'only',
            edge: 'before',
            coverage: 'empty',
            markers: [
                { name: 'open', raw: '{++' },
                { name: 'close', raw: '++}' },
            ],
        }]);
        expect(nativeCriticFragments(parsed.tokens)).toEqual([]);

        const states = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generate(source);
        const flattened = flattenStates(states);
        const anchored = flattened.filter(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'addition'));

        expect(states.map(state => state.name)).toEqual(['bullet-list']);
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
        expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
            .toBe(source);
        expect(parsed.parserSource).toBe(transparentSource);
    });
});
