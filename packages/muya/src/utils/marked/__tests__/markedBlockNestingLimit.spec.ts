import type { Token, Tokens } from 'marked';
import type {
    IMarkdownParserResidueState,
    TState,
} from '../../../state/types';
import type { TLexedToken } from '../types';
import { Lexer, Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { plainMarkdown } from '../../../state/markdownSourceMap';
import { MarkdownToState } from '../../../state/markdownToState';
import {
    parserResidueTerminalNewlines,
} from '../../../state/parserResidueNewlines';
import StateToMarkdown from '../../../state/stateToMarkdown';
import { parseCriticMarkupDocument } from '../criticMarkupDocument';
import { getHighlightHtml } from '../getHighlightHtml';
import { analyzeMarkdownBlockSource, lexBlock } from '../lexBlock';

function deepestBlockquoteToken(tokens: readonly Token[]): {
    depth: number;
    token: Token;
} {
    let depth = 0;
    let token = tokens[0];
    while (token?.type === 'blockquote') {
        depth++;
        token = (token as Tokens.Blockquote).tokens[0];
    }
    if (!token)
        throw new TypeError('Expected a terminal token inside nested blockquotes.');
    return { depth, token };
}

function tokenInventory(tokens: readonly Token[]): {
    blockquotes: number;
    lists: number;
    residues: Tokens.ParserResidue[];
} {
    const pending = [...tokens];
    const result = {
        blockquotes: 0,
        lists: 0,
        residues: [] as Tokens.ParserResidue[],
    };
    while (pending.length) {
        const token = pending.pop()!;
        if (token.type === 'blockquote')
            result.blockquotes++;
        if (token.type === 'list') {
            result.lists++;
            pending.push(...token.items);
        }
        if (token.type === 'parser_residue')
            result.residues.push(token as Tokens.ParserResidue);
        if ('tokens' in token && Array.isArray(token.tokens))
            pending.push(...token.tokens);
    }
    return result;
}

function reachableTokenSet(tokens: readonly Token[]): Set<Token> {
    const pending = [...tokens];
    const reachable = new Set<Token>();
    while (pending.length) {
        const token = pending.pop()!;
        if (reachable.has(token))
            continue;
        reachable.add(token);
        if (token.type === 'list')
            pending.push(...token.items);
        if ('tokens' in token && Array.isArray(token.tokens))
            pending.push(...token.tokens);
    }
    return reachable;
}

function reachableTokenArraySet(tokens: readonly Token[]): Set<readonly Token[]> {
    const pending = [tokens];
    const reachable = new Set<readonly Token[]>();
    while (pending.length) {
        const children = pending.pop()!;
        if (reachable.has(children))
            continue;
        reachable.add(children);
        for (const token of children) {
            if (token.type === 'list') {
                pending.push(token.items);
                for (const item of token.items)
                    pending.push(item.tokens);
            }
            else if (token.type === 'table') {
                for (const cell of token.header)
                    pending.push(cell.tokens);
                for (const row of token.rows) {
                    for (const cell of row)
                        pending.push(cell.tokens);
                }
            }
            else if ('tokens' in token && Array.isArray(token.tokens)) {
                pending.push(token.tokens);
            }
        }
    }
    return reachable;
}

function parserResidueStates(
    states: readonly TState[],
): IMarkdownParserResidueState[] {
    return states.flatMap((state) => {
        const own = state.name === 'markdown-parser-residue' ? [state] : [];
        const nested = 'children' in state
            ? parserResidueStates(state.children as TState[])
            : [];
        return [...own, ...nested];
    });
}

describe('marked block nesting resource contract', () => {
    it('keeps vendored Marked unlimited unless an application opts in', () => {
        const source = `${'> '.repeat(160)}ordinary\n`;
        const inventory = tokenInventory(Lexer.lex(source));

        expect(inventory.blockquotes).toBe(160);
        expect(inventory.residues).toEqual([]);
    });

    it.each([
        { depth: 127, residues: 0 },
        { depth: 128, residues: 1 },
        { depth: 129, residues: 1 },
    ])('defines the 128-level application threshold at depth $depth', ({
        depth,
        residues,
    }) => {
        const source = `${'> '.repeat(depth)}ordinary\n`;
        const inventory = tokenInventory(lexBlock(source, {
            criticMarkup: false,
            frontMatter: false,
        }) as Token[]);

        expect(inventory.blockquotes).toBe(depth < 128 ? depth : 128);
        expect(inventory.residues).toHaveLength(residues);
    });

    it('defines a zero budget as a literal root document', () => {
        const source = '**literal** {++critic++}\n';
        const inventory = tokenInventory(lexBlock(source, {
            criticMarkup: false,
            frontMatter: false,
            maxBlockNesting: 0,
        }) as Token[]);

        expect(inventory.blockquotes).toBe(0);
        expect(inventory.residues).toHaveLength(1);
        expect(inventory.residues[0].text).toBe(source.slice(0, -1));
    });

    it('preserves excess native Markdown literally in a parser-owned token', () => {
        const limit = 128;
        const source = `${'> '.repeat(limit + 32)}{++literal++}\n`;
        const analysis = analyzeMarkdownBlockSource(source, {
            criticMarkup: false,
            frontMatter: false,
        });
        const tokens = analysis.tokens as Token[];
        const deepest = deepestBlockquoteToken(tokens);
        const token = deepest.token as Tokens.ParserResidue;
        const { trace } = analysis;
        const residue = trace.residues.find(entry =>
            entry.literalToken === token);

        expect(deepest.depth).toBe(limit);
        expect(token.type).toBe('parser_residue');
        expect(token.diagnostic).toMatchObject({
            code: 'marked-block-nesting-limit',
            depth: limit,
            limit,
        });
        expect(token.text).toBe(`${'> '.repeat(32)}{++literal++}`);
        expect(residue).toMatchObject({
            kind: 'residue',
            reason: 'parser-resource-limit',
            coverage: 'source-envelope',
            literalToken: token,
        });
        expect(trace.tokenConsumptions(token)).toEqual([]);
        expect(trace.sourceConsumptions(token)).toEqual([residue]);
        expect(analysis.literalRanges).toEqual([{
            start: limit * 2,
            end: source.length - 1,
        }]);

        const document = parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        );
        expect(document.items).toEqual([]);
        expect(document.project('marked')).toBe(source);
    });

    it('enforces the same ceiling through lazy blockquote continuation reparsing', () => {
        const limit = 128;
        const hostileTail = [
            'lazy **bold** [link](javascript:alert(1))',
            '<img src=x onerror=alert(1)> {++literal++}',
        ].join('\n');
        const source = `${'> '.repeat(limit + 32)}leading\n${hostileTail}\n`;
        const analysis = analyzeMarkdownBlockSource(source, {
            criticMarkup: false,
            frontMatter: false,
        });
        const tokens = analysis.tokens as Token[];
        const inventory = tokenInventory(tokens);

        expect(inventory.blockquotes).toBe(limit);
        expect(inventory.residues).toHaveLength(1);
        expect(inventory.residues.some(token =>
            token.text.includes(hostileTail))).toBe(true);
        const { trace } = analysis;
        const resourceResidues = trace.residues.filter(residue =>
            residue.reason === 'parser-resource-limit');
        expect(resourceResidues).toHaveLength(1);
        expect(resourceResidues[0].literalToken).toBe(inventory.residues[0]);
        expect(trace.invocations.length).toBeLessThanOrEqual(limit * 2 + 2);
        expect(resourceResidues[0].source.text.length)
            .toBeLessThanOrEqual(source.length);
        const reachable = reachableTokenSet(tokens);
        const reachableArrays = reachableTokenArraySet(tokens);
        const delegatedEntries = trace.invocations.flatMap(invocation =>
            invocation.ledger.filter(entry => entry.kind === 'delegated'));
        expect(delegatedEntries.length).toBeGreaterThan(0);
        for (const entry of delegatedEntries) {
            expect(entry).not.toHaveProperty('token');
            expect(entry).not.toHaveProperty('literalToken');
        }
        for (const invocation of trace.invocations) {
            expect(reachableArrays.has(invocation.tokens)).toBe(true);
            expect(invocation.ledger.map(entry => entry.source.text).join(''))
                .toBe(invocation.input.text);
            for (const entry of invocation.ledger) {
                if (entry.kind === 'token')
                    expect(reachable.has(entry.token)).toBe(true);
                else if (entry.kind === 'residue' && entry.literalToken)
                    expect(reachable.has(entry.literalToken)).toBe(true);
            }
        }

        const document = parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        );
        expect(document.items).toEqual([]);
        expect(document.project('marked')).toBe(source);

        const html = getHighlightHtml(source, {
            criticMarkup: true,
            frontMatter: false,
        });
        expect(html).toContain(
            'data-markdown-diagnostic="marked-block-nesting-limit"',
        );
        expect(html).not.toContain('<strong>');
        expect(html).not.toContain('<a ');
        expect(html).not.toContain('<img ');
        expect(html).not.toContain('<ins ');

        const states = new MarkdownToState().generate(source);
        expect(new StateToMarkdown().generate(states)).toBe(
            `${'> '.repeat(limit + 32)}leading\n`
            + `${'> '.repeat(limit)}${hostileTail.split('\n').join(
                `\n${'> '.repeat(limit)}`,
            )}\n`,
        );
    });

    it('round-trips fully prefixed multiline residue byte-for-byte', () => {
        const prefix = '> '.repeat(160);
        const source = `${prefix}first\n${prefix}**literal** {++critic++}\n`;
        const states = new MarkdownToState().generate(source);

        expect(new StateToMarkdown().generate(states)).toBe(source);
        expect(parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        ).items).toEqual([]);
    });

    it.each([
        {
            name: 'blockquotes without final LF',
            prefix: '> '.repeat(160),
            ending: '',
            trailingNewline: false,
        },
        {
            name: 'blockquotes with final LF',
            prefix: '> '.repeat(160),
            ending: '\n',
            trailingNewline: true,
        },
    ])('preserves nested residue terminal ownership through $name', ({
        prefix,
        ending,
        trailingNewline,
    }) => {
        const source = `${prefix}literal${ending}`;
        const inventory = tokenInventory(lexBlock(source, {
            criticMarkup: false,
            frontMatter: false,
        }) as Token[]);
        const states = new MarkdownToState().generate(source);
        const residues = parserResidueStates(states);

        expect(inventory.residues).toHaveLength(1);
        expect(inventory.residues[0].raw.endsWith('\n')).toBe(false);
        expect(residues).toHaveLength(1);
        expect(residues[0].meta.trailingNewline).toBe(trailingNewline);
        expect(new StateToMarkdown().generate(states)).toBe(source);
    });

    it.each([
        {
            name: 'lists without final LF',
            source: `${'- '.repeat(4)}literal`,
            trailingNewline: false,
        },
        {
            name: 'lists with final LF',
            source: `${'- '.repeat(4)}literal\n`,
            trailingNewline: true,
        },
        {
            name: 'alternating containers without final LF',
            source: `${'> - '.repeat(3)}literal`,
            trailingNewline: false,
        },
        {
            name: 'alternating containers with final LF',
            source: `${'> - '.repeat(3)}literal\n`,
            trailingNewline: true,
        },
    ])('propagates terminal ownership through shallow $name', ({
        source,
        trailingNewline,
    }) => {
        const tokens = lexBlock(source, {
            criticMarkup: false,
            frontMatter: false,
            maxBlockNesting: 2,
        }) as TLexedToken[];
        const inventory = tokenInventory(tokens);
        const ownership = parserResidueTerminalNewlines(tokens);

        expect(inventory.residues).toHaveLength(1);
        expect(inventory.residues[0].raw.endsWith('\n')).toBe(false);
        expect(ownership.get(inventory.residues[0])).toBe(trailingNewline);
    });

    it('attributes LF to a nested residue before a later non-terminated root block', () => {
        const source = `${'> '.repeat(160)}literal\n\noutside`;
        const states = new MarkdownToState().generate(source);
        const residues = parserResidueStates(states);

        expect(residues).toHaveLength(1);
        expect(residues[0].meta.trailingNewline).toBe(true);
    });

    it('maps CRLF and tab bytes at the residue envelope exactly', () => {
        const source = `${'> '.repeat(160)}\t{++literal++}\r\n`;
        const analysis = analyzeMarkdownBlockSource(source, {
            criticMarkup: false,
            frontMatter: false,
        });
        const inventory = tokenInventory(analysis.tokens as Token[]);
        const document = parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        );

        expect(inventory.residues).toHaveLength(1);
        expect(analysis.literalRanges).toEqual([{
            start: 128 * 2,
            end: source.length - 2,
        }]);
        expect(document.items).toEqual([]);
        expect(document.project('marked')).toBe(source);
    });

    it('keeps delegated lazy reconstruction semantic below the resource limit', () => {
        const source = '> > leading\nlazy {++semantic++}\n';
        const analysis = analyzeMarkdownBlockSource(source, {
            criticMarkup: false,
            frontMatter: false,
        });
        const delegatedEntries = analysis.trace.invocations.flatMap(invocation =>
            invocation.ledger.filter(entry => entry.kind === 'delegated'));

        expect(delegatedEntries.length).toBeGreaterThan(0);
        expect(delegatedEntries.every(entry =>
            entry.reason === 'superseded-token')).toBe(true);
        expect(analysis.trace.residues).toEqual([]);
        expect(analysis.literalRanges).toEqual([]);
        expect(parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        ).items).toHaveLength(1);
    });

    it.each([
        {
            name: 'nested lists',
            source: `${'- '.repeat(160)}{++literal++}\n`,
            blockquotes: 0,
            lists: 128,
        },
        {
            name: 'alternating blockquotes and lists',
            source: `${'> - '.repeat(80)}{++literal++}\n`,
            blockquotes: 64,
            lists: 64,
        },
    ])('preserves excess $name as one literal residue', ({
        source,
        blockquotes,
        lists,
    }) => {
        const tokens = lexBlock(source, {
            criticMarkup: false,
            frontMatter: false,
        }) as Token[];
        const inventory = tokenInventory(tokens);

        expect(inventory.blockquotes).toBe(blockquotes);
        expect(inventory.lists).toBe(lists);
        expect(inventory.residues).toHaveLength(1);
        expect(parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        ).items).toEqual([]);
    });

    it.each([
        {
            name: 'a blockquote containing nested lists',
            source: `> ${'- '.repeat(160)}leading\nlazy {++literal++}\n`,
            blockquotes: 1,
            lists: 127,
        },
        {
            name: 'alternating blockquotes and lists',
            source: `${'> - '.repeat(80)}leading\nlazy {++literal++}\n`,
            blockquotes: 64,
            lists: 64,
        },
    ])('keeps one complete residue envelope for lazy text beneath $name', ({
        source,
        blockquotes,
        lists,
    }) => {
        const analysis = analyzeMarkdownBlockSource(source, {
            criticMarkup: false,
            frontMatter: false,
        });
        const tokens = analysis.tokens as Token[];
        const inventory = tokenInventory(tokens);
        const { trace } = analysis;

        expect(inventory.blockquotes).toBe(blockquotes);
        expect(inventory.lists).toBe(lists);
        expect(inventory.residues).toHaveLength(1);
        expect(trace.residues.filter(residue =>
            residue.reason === 'parser-resource-limit')).toHaveLength(1);
        expect(analysis.literalRanges).toEqual([{
            start: 256,
            end: source.length - 1,
        }]);
        expect(parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        ).items).toEqual([]);
    });

    it('bounds a 5,000-level lazy continuation without overflowing', () => {
        const source = `${'> '.repeat(5_000)}leading\nlazy {++literal++}\n`;
        const analysis = analyzeMarkdownBlockSource(source, {
            criticMarkup: false,
            frontMatter: false,
        });
        const tokens = analysis.tokens as Token[];
        const inventory = tokenInventory(tokens);

        expect(inventory.blockquotes).toBe(128);
        expect(inventory.residues).toHaveLength(1);
        const { trace } = analysis;
        expect(trace.residues.filter(residue =>
            residue.reason === 'parser-resource-limit')).toHaveLength(1);
        expect(trace.invocations.length).toBeLessThanOrEqual(258);
    });

    it.each([
        '> '.repeat(128),
        `${'> '.repeat(128)}\n`,
    ])('does not invent residue for an empty terminal source', (source) => {
        const tokens = lexBlock(source, {
            criticMarkup: false,
            frontMatter: false,
        }) as Token[];
        const inventory = tokenInventory(tokens);

        expect(inventory.blockquotes).toBe(128);
        expect(inventory.residues).toEqual([]);
        expect(parseCriticMarkupDocument(
            plainMarkdown(source),
            { frontMatter: false },
        ).project('marked')).toBe(source);
    });

    it('rejects invalid block nesting budgets before parsing', () => {
        expect(() => lexBlock('text\n', {
            maxBlockNesting: -1,
        })).toThrow(/non-negative safe integer/);
        expect(() => lexBlock('text\n', {
            maxBlockNesting: 1.5,
        })).toThrow(/non-negative safe integer/);
    });

    it('uses a block/preformatted renderer and honors extension fallback', () => {
        const marked = new Marked();
        marked.use({
            extensions: [{
                name: 'parser_residue',
                level: 'block',
                renderer() {
                    return false;
                },
            }],
        });
        const html = marked.parse('> first\n> **second**\n', {
            maxBlockNesting: 1,
        });

        expect(html).toContain(
            '<pre class="marked-block-nesting-limit"',
        );
        expect(html).toContain('first\n**second**');
        expect(html).not.toContain('<strong>');
    });
});
