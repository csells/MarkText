import type {
    IMarkedLexInvocation,
    MarkedOptions,
    MarkedParseTrace,
    MarkedSourceView,
    Token,
    Tokens,
    TokensList,
} from 'marked';
import {
    createMarkedProvenanceBinding,
    Lexer,
    Marked,
    markedDocumentOffset,
    MarkedSourceDocument,
    markedViewOffset,
} from 'marked';
import { describe, expect, it, vi } from 'vitest';
import { localOffset } from '../../../mappedText';
import { markedProvenanceSourceView } from '../markedSourceView';

interface IParsedSource {
    readonly tokens: TokensList;
    readonly trace: MarkedParseTrace<{ readonly name: string }>;
}

function lexWithProvenance(
    source: string,
    options: MarkedOptions = {},
    name = 'test-document',
): IParsedSource {
    const document = new MarkedSourceDocument({ name }, source);
    const binding = createMarkedProvenanceBinding(document.identity());
    const marked = new Marked();
    let tokens: Token[] | TokensList | undefined;
    marked.use({
        hooks: {
            processAllTokens(result) {
                tokens = result;
                return result;
            },
        },
    });
    marked.use(binding.extension);
    marked.parse(source, options);
    if (!tokens || !('links' in tokens))
        throw new TypeError('The block parser did not expose its token root.');
    return { tokens, trace: binding.claim(tokens) };
}

function rootInvocation<SourceId extends object>(
    trace: MarkedParseTrace<SourceId>,
): IMarkedLexInvocation<SourceId> {
    const roots = trace.invocationsForTokens(trace.tokens)
        .filter(invocation => invocation.level === trace.level);
    expect(roots).toHaveLength(1);
    return roots[0];
}

function expectExactPartitions<SourceId extends object>(
    trace: MarkedParseTrace<SourceId>,
): void {
    for (const invocation of trace.invocations) {
        expect(invocation.ledger.map(entry => entry.source.text).join(''))
            .toBe(invocation.input.text);
        let offset = 0;
        for (const entry of invocation.ledger) {
            expect(entry.range).toEqual({
                start: offset,
                end: offset + entry.source.text.length,
            });
            offset += entry.source.text.length;
        }
        expect(offset).toBe(invocation.input.text.length);
    }
}

function coalescedDocumentRanges<SourceId extends object>(
    views: readonly MarkedSourceView<SourceId>[],
): Array<{ start: number; end: number }> {
    const ranges = views.flatMap(view => view.spans.map(span => ({
        start: Number(span.documentStart),
        end: Number(span.documentEnd),
    }))).sort((left, right) => left.start - right.start || left.end - right.end);
    const result: Array<{ start: number; end: number }> = [];
    for (const range of ranges) {
        const previous = result.at(-1);
        if (previous && range.start <= previous.end)
            previous.end = Math.max(previous.end, range.end);
        else
            result.push({ ...range });
    }
    return result;
}

function tokenRanges<SourceId extends object>(
    trace: MarkedParseTrace<SourceId>,
    token: Token,
): Array<{ start: number; end: number }> {
    return coalescedDocumentRanges(
        trace.tokenConsumptions(token).map(consumption => consumption.source),
    );
}

describe('marked parser-owned source provenance', () => {
    it.each([
        { name: 'head', start: 0, end: 1 },
        { name: 'middle', start: 1, end: 2 },
        { name: 'tail', start: 2, end: 3 },
    ])('honors half-open affinity across a collapsed $name gap', ({
        start,
        end,
    }) => {
        const document = new MarkedSourceDocument(
            { name: 'collapsed-gap' },
            'abc',
        );
        const parts = [
            ...(start > 0
                ? [document.slice(
                        markedDocumentOffset(0),
                        markedDocumentOffset(start),
                    )]
                : []),
            document.replacement(
                '',
                markedDocumentOffset(start),
                markedDocumentOffset(end),
            ),
            ...(end < document.text.length
                ? [document.slice(
                        markedDocumentOffset(end),
                        markedDocumentOffset(document.text.length),
                    )]
                : []),
        ];
        const view = document.compose(parts);
        const converted = markedProvenanceSourceView(view);
        const path = converted.sourceMap.spans[0]?.path
            ?? converted.sourceMap.boundaries[0].path;

        expect(view.text).toBe(document.text.slice(0, start)
            + document.text.slice(end));
        expect(view.documentOffsetAt(markedViewOffset(start), 'previous'))
            .toBe(markedDocumentOffset(start));
        expect(view.documentOffsetAt(markedViewOffset(start), 'next'))
            .toBe(markedDocumentOffset(end));
        expect(view.documentOffsetAt(markedViewOffset(start)))
            .toBe(markedDocumentOffset(end));
        expect(converted.sourceMap.localToSource(
            path,
            localOffset(start),
            'previous',
        )).toBe(start);
        expect(converted.sourceMap.localToSource(
            path,
            localOffset(start),
            'next',
        )).toBe(end);
    });

    it('records an exact flat block-consumption ledger', () => {
        const source = '# alpha\n\nbeta\n';
        const { tokens, trace } = lexWithProvenance(source);
        const root = rootInvocation(trace);

        expect(trace).toMatchObject({ level: 'block', input: { text: source } });
        expect(trace.tokens).toBe(tokens);
        expect(root.input).toBe(trace.input);
        expect(root.tokens).toBe(tokens);
        expect(root.ledger.map(entry => entry.source.text).join('')).toBe(source);
        expect(trace.invocations.flatMap(invocation =>
            invocation.ledger.filter(entry => entry.kind === 'delegated')))
            .toEqual([]);
        expect(trace.residues).toEqual([]);
        expectExactPartitions(trace);
    });

    it('keeps a discarded duplicate definition as explicit residue', () => {
        const duplicate = '[foo]: /{++second++}';
        const source = `[foo]\n\n[foo]: first\n${duplicate}\n`;
        const { tokens, trace } = lexWithProvenance(source);
        const definition = tokens.find(token => token.type === 'def')!;
        const duplicateStart = source.indexOf(duplicate);
        const finalNewline = source.length - 1;
        const consumptions = trace.tokenConsumptions(definition);

        expect(trace.residues).toHaveLength(1);
        expect(trace.residues[0]).toMatchObject({
            reason: 'discarded-token',
            discardedTokenType: 'def',
            source: { text: duplicate },
        });
        expect(coalescedDocumentRanges([trace.residues[0].source])).toEqual([{
            start: duplicateStart,
            end: duplicateStart + duplicate.length,
        }]);
        expect(consumptions.map(consumption => consumption.source.text).join(''))
            .toBe(definition.raw);
        expect(tokenRanges(trace, definition)).toEqual([
            { start: source.indexOf('[foo]: first'), end: duplicateStart },
            { start: finalNewline, end: source.length },
        ]);
        expectExactPartitions(trace);
    });

    it.each([
        { name: 'drops the removed token', retainAsMetadata: false },
        { name: 'hides the removed token in metadata', retainAsMetadata: true },
    ])('rejects tokenizer mutation that $name', ({ retainAsMetadata }) => {
        const source = 'alpha\n\nCUT\n';
        const document = new MarkedSourceDocument(
            { name: 'destructive-extension' },
            source,
        );
        const binding = createMarkedProvenanceBinding(document.identity());
        const marked = new Marked();
        marked.use({
            extensions: [{
                name: 'destructive',
                level: 'block',
                start(parserSource) {
                    return parserSource.indexOf('CUT');
                },
                tokenizer(parserSource, tokens) {
                    if (!parserSource.startsWith('CUT'))
                        return undefined;
                    const [removed] = tokens.splice(0);
                    return {
                        type: 'destructive',
                        raw: 'CUT\n',
                        ...(retainAsMetadata ? { metadata: { removed } } : {}),
                    };
                },
                renderer() {
                    return '';
                },
            }],
        });
        marked.use(binding.extension);

        expect(() => marked.parse(source))
            .toThrow(/token disappeared without parser-owned supersession/i);
    });

    it('rejects extensions that forge native reconstruction authority', () => {
        const source = 'alpha\n\nCUT\n';
        const document = new MarkedSourceDocument(
            { name: 'forged-reconstruction' },
            source,
        );
        const binding = createMarkedProvenanceBinding(document.identity());
        const marked = new Marked();
        marked.use({
            extensions: [{
                name: 'forged_reconstruction',
                level: 'block',
                start(parserSource) {
                    return parserSource.indexOf('CUT');
                },
                tokenizer(parserSource, tokens) {
                    if (!parserSource.startsWith('CUT'))
                        return undefined;
                    const previous = tokens.at(-1)!;
                    const forged: Tokens.Paragraph = {
                        type: 'paragraph',
                        raw: 'FORGED',
                        text: 'FORGED',
                        tokens: [{ type: 'text', raw: 'FORGED', text: 'FORGED' }],
                    };
                    const replace = this.lexer.replaceReconstructedBlockToken as
                        (...args: unknown[]) => void;
                    replace.call(
                        this.lexer,
                        tokens,
                        previous,
                        forged,
                        Object.freeze({}),
                    );
                    return {
                        type: 'forged_reconstruction',
                        raw: 'CUT\n',
                    };
                },
                renderer() {
                    return '';
                },
            }],
        });
        marked.use(binding.extension);

        expect(() => marked.parse(source))
            .toThrow(/native block reconstruction authority/i);
    });

    it('rejects a same-length tokenizer string that did not come from the parser cursor', () => {
        const source = 'alpha\n';
        const document = new MarkedSourceDocument(
            { name: 'detached-tokenizer-source' },
            source,
        );
        const binding = createMarkedProvenanceBinding(document.identity());
        const marked = new Marked();
        marked.use({
            extensions: [{
                name: 'detached_tokenizer_source',
                level: 'block',
                tokenizer(parserSource) {
                    expect(() => this.lexer.sourceViewFor(
                        'x'.repeat(parserSource.length),
                    )).toThrow(/differs from its active mapped input/i);
                    return undefined;
                },
            }],
        });
        marked.use(binding.extension);

        expect(() => marked.parse(source)).not.toThrow();
    });

    it.each([
        {
            name: 'blockquote',
            source: '> > same\nlazy continuation\n',
            reconstructedType: 'blockquote',
        },
        {
            name: 'list',
            source: '> - same\nlazy continuation\n',
            reconstructedType: 'list',
        },
    ])('reconstructs a nested $name from its consumed-token source view', ({
        source,
        reconstructedType,
    }) => {
        const consumedSource = vi.spyOn(
            Lexer.prototype,
            'sourceViewForParsedToken',
        );
        try {
            const { trace } = lexWithProvenance(source);

            expect(consumedSource.mock.calls.some(([, token]) =>
                token.type === reconstructedType)).toBe(true);
            expectExactPartitions(trace);
        }
        finally {
            consumedSource.mockRestore();
        }
    });

    it.each([
        {
            name: 'blockquote',
            source: '> > same\n> > same\nlazy\n',
            leaves(tokens: TokensList) {
                const outer = tokens[0] as Tokens.Blockquote;
                const inner = outer.tokens[0] as Tokens.Blockquote;
                return [(inner.tokens[0] as Tokens.Paragraph).tokens[0]];
            },
            ranges: [[
                { start: 4, end: 9 },
                { start: 13, end: 22 },
            ]],
        },
        {
            name: 'list',
            source: '> - same\n> - same\nlazy\n',
            leaves(tokens: TokensList) {
                const outer = tokens[0] as Tokens.Blockquote;
                const list = outer.tokens[0] as Tokens.List;
                return list.items.map(item =>
                    (item.tokens[0] as Tokens.Text).tokens![0]!);
            },
            ranges: [
                [{ start: 4, end: 8 }],
                [{ start: 13, end: 22 }],
            ],
        },
    ])('keeps contiguous duplicate nested $name source structurally distinct', ({
        source,
        leaves,
        ranges,
    }) => {
        const { tokens, trace } = lexWithProvenance(source);

        expect(leaves(tokens).map(token => tokenRanges(trace, token)))
            .toEqual(ranges);
        expectExactPartitions(trace);
    });

    it('partitions source bytes when an EOF list token normalizes a space to a newline', () => {
        const source = '1. ';
        const { tokens, trace } = lexWithProvenance(source);
        const list = tokens[0] as Tokens.List;

        expect(list.raw).toBe('1.\n');
        expect(trace.tokenConsumptions(list).map(entry => entry.source.text).join(''))
            .toBe(source);
        expect(tokenRanges(trace, list)).toEqual([{ start: 0, end: 3 }]);
        expectExactPartitions(trace);
    });

    it('owns each parsed list-item marker instead of reconstructing it from raw text', () => {
        const { tokens } = lexWithProvenance('  3)   first\n  7) second\n');
        const list = tokens[0] as Tokens.List;

        expect(list.items.map(item => item.marker)).toEqual(['3)', '7)']);
        expect(list.items.map(item => item.leadingPrefix)).toEqual(['  ', '  ']);
        expect(list.items.map(item => item.markerPadding)).toEqual(['   ', ' ']);
    });

    it('owns each list item trailing blank-line count', () => {
        const { tokens } = lexWithProvenance('- first\n\n\n- second\n- third\n');
        const list = tokens[0] as Tokens.List;

        expect(list.items.map(item => item.trailingBlankLines))
            .toEqual([2, 0, 0]);
    });

    it('owns exact lazy-continuation prefixes on each list item', () => {
        const { tokens } = lexWithProvenance([
            '- parent',
            'lazy',
            '  indented',
            '- tail',
            '',
        ].join('\n'));
        const list = tokens[0] as Tokens.List;

        expect(list.items[0].continuationPrefixes).toEqual(['', '  ']);
        expect(list.items[1].continuationPrefixes).toEqual([]);
    });

    it('partitions nested continuation prefixes by parser recursion level', () => {
        const { tokens } = lexWithProvenance([
            '- first',
            '- second',
            '  - nested first',
            '  - nested second',
            '    - deep first',
            '    - deep second',
            '      - deepest',
            '  - nested tail',
            '- tail',
            '',
        ].join('\n'));
        const outer = tokens[0] as Tokens.List;
        const outerSecond = outer.items[1];
        const nested = outerSecond.tokens[1] as Tokens.List;
        const nestedSecond = nested.items[1];
        const deep = nestedSecond.tokens[1] as Tokens.List;
        const deepSecond = deep.items[1];

        // Each parser invocation owns only the indentation it removed while
        // deriving its child source. Descendant indentation is deliberately
        // not duplicated in an ancestor token's provenance.
        expect(outerSecond.continuationPrefixes).toEqual([
            '  ',
            '  ',
            '  ',
            '  ',
            '  ',
            '  ',
        ]);
        expect(nestedSecond.continuationPrefixes).toEqual([
            '  ',
            '  ',
            '  ',
        ]);
        expect(deepSecond.continuationPrefixes).toEqual(['  ']);
    });

    it.each([
        {
            name: 'blockquote setext continuation',
            source: '> foo\nbar\n===\n',
            leaf: (tokens: TokensList) => {
                const quote = tokens[0] as Tokens.Blockquote;
                const paragraph = quote.tokens[0] as Tokens.Paragraph;
                return paragraph.tokens[0];
            },
            text: 'foo\nbar\n    ===',
            start: 2,
            end: 13,
        },
        {
            name: 'list indentation',
            source: '1.     indented code\n\n   paragraph\n\n       more code\n',
            leaf: (tokens: TokensList) => {
                const list = tokens[0] as Tokens.List;
                const paragraph = list.items[0].tokens[2] as Tokens.Paragraph;
                return paragraph.tokens[0];
            },
            text: 'paragraph',
            start: 25,
            end: 34,
        },
        {
            name: 'list blank-item and fenced-code continuation',
            source: '-\n  foo\n-\n  ```\n  bar\n  ```\n-\n      baz\n',
            leaf: (tokens: TokensList) =>
                (tokens[0] as Tokens.List).items[2].tokens[1],
            text: '    baz',
            start: 32,
            end: 39,
        },
        {
            name: 'escaped link label',
            source: '[link \\[bar](/uri)\n',
            leaf: (tokens: TokensList) => {
                const paragraph = tokens[0] as Tokens.Paragraph;
                const link = paragraph.tokens[0] as Tokens.Link;
                return link.tokens[0];
            },
            text: 'link [bar',
            ranges: [
                { start: 1, end: 6 },
                { start: 7, end: 11 },
            ],
        },
    ])('maps recursive $name input to exact document bytes', ({
        source,
        leaf,
        text,
        start,
        end,
        ranges,
    }) => {
        const { tokens, trace } = lexWithProvenance(source);
        const token = leaf(tokens);

        expect(token.raw).toBe(text);
        expect(trace.tokenConsumptions(token).map(entry => entry.source.text).join(''))
            .toBe(text);
        expect(tokenRanges(trace, token)).toEqual(
            ranges ?? [{ start, end }],
        );
        expectExactPartitions(trace);
    });

    it('maps a repeated link label to the label rather than its destination', () => {
        const source = '[same](same)';
        const { tokens, trace } = lexWithProvenance(source);
        const paragraph = tokens[0] as Tokens.Paragraph;
        const link = paragraph.tokens[0] as Tokens.Link;
        const leaf = link.tokens[0];

        expect(tokenRanges(trace, leaf)).toEqual([{ start: 1, end: 5 }]);
        expectExactPartitions(trace);
    });

    it('maps repeated table-cell text to each distinct source occurrence', () => {
        const source = [
            '| same | same |',
            '| --- | --- |',
            '| same | same |',
            '',
        ].join('\n');
        const { tokens, trace } = lexWithProvenance(source);
        const table = tokens[0] as Tokens.Table;
        const cells = [...table.header, ...table.rows.flat()];
        const starts = [2, 9, 32, 39];

        expect(cells.map(cell =>
            tokenRanges(trace, cell.tokens[0])))
            .toEqual(starts.map(start => [{ start, end: start + 4 }]));
        expectExactPartitions(trace);
    });

    it('owns exact table row templates from the parser cell split', () => {
        const source = [
            '| a  | b \\| c |',
            '|:--- | ---:|',
            '| x | |',
            '',
        ].join('\n');
        const { tokens } = lexWithProvenance(source);
        const table = tokens[0] as Tokens.Table;
        const rows = [
            table.sourceSyntax.header,
            table.sourceSyntax.delimiter,
            ...table.sourceSyntax.rows,
        ];
        const reconstruct = (row: Tokens.TableRowSourceSyntax) =>
            row.cells.reduce(
                (text, cell, index) =>
                    text + cell + row.segments[index + 1],
                row.segments[0],
            );

        expect(rows.map(reconstruct)).toEqual(source.trimEnd().split('\n'));
        expect(table.sourceSyntax.header.cells).toEqual(['a', 'b \\| c']);
        expect(table.sourceSyntax.rows[0].cells).toEqual(['x', '']);
    });

    it('rejects a detached provider clone and claims an authentic root once', () => {
        const source = 'alpha';
        const document = new MarkedSourceDocument({ name: 'provider' }, source);
        const binding = createMarkedProvenanceBinding(document.identity());
        const marked = new Marked();
        let authentic: TokensList | undefined;
        let detached: TokensList | undefined;
        marked.use(binding.extension);
        marked.use({
            hooks: {
                provideLexer() {
                    return ((parserSource: string, options: MarkedOptions) => {
                        authentic = Lexer.lex(parserSource, options);
                        detached = authentic.slice() as TokensList;
                        detached.links = authentic.links;
                        return detached;
                    }) as never;
                },
            },
        });

        marked.parse(source);
        expect(() => binding.claim(detached!)).toThrow(/unclaimed lexer provenance/i);
        expect(binding.claim(authentic!).tokens).toBe(authentic);
        expect(() => binding.claim(authentic!)).toThrow(/unclaimed lexer provenance/i);
    });

    it('rejects token mutation between lexer completion and provenance claim', () => {
        const source = '> original\n';
        const document = new MarkedSourceDocument({ name: 'mutation' }, source);
        const binding = createMarkedProvenanceBinding(document.identity());
        const tokens = Lexer.lex(source, {
            sourceProvenance: binding.extension.sourceProvenance,
        });
        const quote = tokens[0] as Tokens.Blockquote;
        const paragraph = quote.tokens[0] as Tokens.Paragraph;
        paragraph.raw = 'forged';

        expect(() => binding.claim(tokens)).toThrow(/token graph changed/i);
    });

    it('rejects an accessor mutation without invoking the accessor', () => {
        const source = 'original\n';
        const document = new MarkedSourceDocument({ name: 'accessor' }, source);
        const binding = createMarkedProvenanceBinding(document.identity());
        const tokens = Lexer.lex(source, {
            sourceProvenance: binding.extension.sourceProvenance,
        });
        let reads = 0;
        Object.defineProperty(tokens[0], 'raw', {
            configurable: true,
            enumerable: true,
            get() {
                reads++;
                return source;
            },
        });

        expect(() => binding.claim(tokens)).toThrow(/token graph changed/i);
        expect(reads).toBe(0);
    });

    it('isolates equal parser inputs by source-document identity', () => {
        const first = lexWithProvenance('same', {}, 'first');
        const second = lexWithProvenance('same', {}, 'second');

        expect(first.trace.input.document).not.toBe(second.trace.input.document);
        expect(first.trace.input.document.id).toEqual({ name: 'first' });
        expect(second.trace.input.document.id).toEqual({ name: 'second' });
        expect(() => first.trace.tokenConsumptions(second.tokens[0]))
            .not
            .toThrow();
        expect(first.trace.tokenConsumptions(second.tokens[0])).toEqual([]);
    });
});
