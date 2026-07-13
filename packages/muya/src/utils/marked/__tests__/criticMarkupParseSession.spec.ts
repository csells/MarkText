import type {
    MarkedOptions,
    Token,
    Tokens,
    TokensList,
} from 'marked';
import { Lexer, Marked } from 'marked';
import { describe, expect, it, vi } from 'vitest';
import criticMarkupDocumentExtension from '../extensions/criticMarkupDocument';
import { lexBlock } from '../lexBlock';
import { analyzeCriticMarkupContext } from '../locatedMarkdown';
import {
    withTestCriticMarkupParseSession,
} from './helpers/criticMarkupParseSession';

describe('criticMarkup Marked parse-session authority', () => {
    it('cannot elevate an ordinary lexBlock token array', () => {
        const source = '{++candidate++}';
        const tokens = lexBlock(source, { criticMarkup: false });

        expect(() => analyzeCriticMarkupContext(tokens as never))
            .toThrow(/authenticated/i);
    });

    it('rejects replacement of a lexed token array before context analysis', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                tokens.splice(0, tokens.length, {
                    type: 'code',
                    raw: source,
                    text: source,
                } as Tokens.Code);
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects in-place mutation of a lexed token before context analysis', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                (tokens[0] as Token).raw = 'forged';
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects non-enumerable token-array behavior changes', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                Object.defineProperty(tokens, 'map', {
                    value: () => [],
                    enumerable: false,
                });
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects non-enumerable token-array iterator changes', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                Object.defineProperty(tokens, Symbol.iterator, {
                    * value() {},
                    enumerable: false,
                });
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects token-array prototype changes', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                Object.setPrototypeOf(tokens, {
                    __proto__: Array.prototype,
                    map: () => [],
                });
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects nested token prototype changes', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                Object.setPrototypeOf(tokens[0], {
                    __proto__: Object.getPrototypeOf(tokens[0]),
                    forged: true,
                });
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects descriptor-only token changes', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                const descriptor = Object.getOwnPropertyDescriptor(
                    tokens[0],
                    'raw',
                )!;
                Object.defineProperty(tokens[0], 'raw', {
                    ...descriptor,
                    writable: false,
                });
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects token extensibility changes', () => {
        const source = 'before {++new++} after';

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                Object.preventExtensions(tokens);
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
    });

    it('rejects accessors without invoking them', () => {
        const source = 'before {++new++} after';
        const rawGetter = vi.fn(() => source);

        expect(() => withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session, tokens) => {
                Object.defineProperty(tokens[0], 'raw', {
                    configurable: true,
                    enumerable: true,
                    get: rawGetter,
                });
                return analyzeCriticMarkupContext(session);
            },
        )).toThrow(/token graph changed/i);
        expect(rawGetter).not.toHaveBeenCalled();
    });

    it('consumes an authenticated parser session exactly once', () => {
        const source = 'before {++new++} after';

        withTestCriticMarkupParseSession(
            source,
            {},
            true,
            (session) => {
                expect(analyzeCriticMarkupContext(session).source).toBe(source);
                expect(() => analyzeCriticMarkupContext(session))
                    .toThrow(/authenticated one-use parser session/i);
            },
        );
    });

    it('cannot relabel an inline parser session as a block parse', () => {
        const source = 'before {++new++} after';

        withTestCriticMarkupParseSession(
            source,
            {},
            false,
            (session) => {
                expect(() => analyzeCriticMarkupContext(session, 'block'))
                    .toThrow(/another lexer mode/i);
                expect(analyzeCriticMarkupContext(session).source).toBe(source);
            },
        );
    });

    it('preserves a legitimate lexer provider installed before CriticMarkup', () => {
        const source = 'before {++new++} after';
        const provider = vi.fn((block: boolean) =>
            block ? Lexer.lex : Lexer.lexInline);
        const marked = new Marked();
        marked.use({
            hooks: {
                provideLexer(block) {
                    return provider(block ?? true);
                },
            },
        });
        marked.use(criticMarkupDocumentExtension(source));

        const html = marked.parse(source) as string;

        expect(provider).toHaveBeenCalledWith(true);
        expect(html).toContain('data-critic-type="addition"');
    });

    it('preserves a lexer provider installed after CriticMarkup', () => {
        const source = 'before {++new++} after';
        const provider = vi.fn((block: boolean) =>
            block ? Lexer.lex : Lexer.lexInline);
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source));
        marked.use({
            hooks: {
                provideLexer(block) {
                    return provider(block ?? true);
                },
            },
        });

        const html = marked.parse(source) as string;

        expect(provider).toHaveBeenCalledWith(true);
        expect(html).toContain('data-critic-type="addition"');
    });

    it('rejects a processAllTokens mutation before CriticMarkup claims provenance', () => {
        const source = 'before {++new++} after';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source));
        marked.use({
            hooks: {
                processAllTokens(tokens) {
                    const token = tokens[0] as Tokens.Generic;
                    token.type = 'code';
                    token.text = source;
                    return tokens;
                },
            },
        });

        expect(() => marked.parse(source)).toThrow(/token graph changed/i);
    });

    it('rejects provider removal of block links metadata after lexing', () => {
        const source = 'before {++new++} after';
        const marked = new Marked();
        marked.use({
            hooks: {
                provideLexer(block) {
                    const isBlock = block ?? true;
                    return ((
                        parserSource: string,
                        options: MarkedOptions,
                    ) => {
                        const tokens = isBlock
                            ? Lexer.lex(parserSource, options)
                            : Lexer.lexInline(parserSource, options);
                        Reflect.deleteProperty(tokens, 'links');
                        return tokens;
                    }) as never;
                },
            },
        });
        marked.use(criticMarkupDocumentExtension(source));

        expect(() => marked.parse(source)).toThrow(/token graph changed/i);
    });

    it('rejects provider addition of inline links metadata after lexing', () => {
        const source = 'before {++new++} after';
        const marked = new Marked();
        marked.use({
            hooks: {
                provideLexer(block) {
                    const isBlock = block ?? true;
                    return ((
                        parserSource: string,
                        options: MarkedOptions,
                    ) => {
                        const tokens = isBlock
                            ? Lexer.lex(parserSource, options)
                            : Lexer.lexInline(parserSource, options);
                        if (!isBlock)
                            Object.assign(tokens, { links: {} });
                        return tokens;
                    }) as never;
                },
            },
        });
        marked.use(criticMarkupDocumentExtension(source));

        expect(() => marked.parseInline(source))
            .toThrow(/token graph changed/i);
    });

    it('rejects provider output detached from the Marked lexer invocation', () => {
        const source = 'before {++new++} after';
        const marked = new Marked();
        marked.use({
            hooks: {
                provideLexer(block) {
                    const isBlock = block ?? true;
                    return ((
                        parserSource: string,
                        options: MarkedOptions,
                    ) => {
                        const authenticated = isBlock
                            ? Lexer.lex(parserSource, options)
                            : Lexer.lexInline(parserSource, options);
                        const detached = authenticated.slice();
                        if (isBlock) {
                            Object.assign(detached, {
                                links: (authenticated as TokensList).links,
                            });
                        }
                        return detached;
                    }) as never;
                },
            },
        });
        marked.use(criticMarkupDocumentExtension(source));

        expect(() => marked.parse(source))
            .toThrow(/authenticated lexer invocation/i);
    });

    it('rejects an authenticated lexer run over a substituted source', () => {
        const source = '{++x++}';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source));
        marked.use({
            hooks: {
                provideLexer() {
                    return ((
                        parserSource: string,
                        options: MarkedOptions,
                    ) => {
                        const tokens = Lexer.lex(
                            `    ${parserSource}`,
                            options,
                        );
                        tokens[0].raw = parserSource;
                        return tokens;
                    }) as never;
                },
            },
        });

        expect(() => marked.parse(source))
            .toThrow(/authenticated lexer invocation/i);
    });

    it('rejects reuse of a previously claimed provider token array', () => {
        const source = 'before {++new++} after';
        let cached: Token[] | TokensList | null = null;
        const marked = new Marked();
        marked.use({
            hooks: {
                provideLexer(block) {
                    const isBlock = block ?? true;
                    return ((
                        parserSource: string,
                        options: MarkedOptions,
                    ) => {
                        cached ??= isBlock
                            ? Lexer.lex(parserSource, options)
                            : Lexer.lexInline(parserSource, options);
                        return cached;
                    }) as never;
                },
            },
        });
        marked.use(criticMarkupDocumentExtension(source));

        expect(marked.parse(source) as string)
            .toContain('data-critic-type="addition"');
        expect(() => marked.parse(source))
            .toThrow(/authenticated lexer invocation/i);
    });

    it('keeps mode identity when an async prior provider completes out of order', async () => {
        const source = 'before {++new++} after';
        const completions: string[] = [];
        let releaseBlock!: () => void;
        const blockGate = new Promise<void>((resolve) => {
            releaseBlock = resolve;
        });
        const marked = new Marked();
        marked.use({
            async: true,
            hooks: {
                provideLexer(block) {
                    const isBlock = block ?? true;
                    return (async (
                        parserSource: string,
                        options: MarkedOptions,
                    ) => {
                        if (isBlock)
                            await blockGate;
                        else
                            releaseBlock();
                        completions.push(isBlock ? 'block' : 'inline');
                        return isBlock
                            ? Lexer.lex(parserSource, options)
                            : Lexer.lexInline(parserSource, options);
                    }) as never;
                },
            },
        });
        marked.use(criticMarkupDocumentExtension(source));

        const [blockHtml, inlineHtml] = await Promise.all([
            marked.parse(source) as Promise<string>,
            marked.parseInline(source) as Promise<string>,
        ]);

        expect(completions).toEqual(['inline', 'block']);
        expect(blockHtml).toContain('data-critic-type="addition"');
        expect(inlineHtml).toContain('data-critic-type="addition"');
    });

    it('uses the exact inline parser view for CRLF source', () => {
        const source = 'before\r\n{++new++}';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source));

        expect(marked.parseInline(source) as string)
            .toContain('data-critic-type="addition"');
    });

    it.each([
        '\tbefore {++new++}',
        '   \n{++new++}',
    ])('accepts the native pedantic block parser view for %j', (source) => {
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source, {
            parserOptions: { pedantic: true },
        }));

        expect(() => marked.parse(source)).not.toThrow();
    });

    it.each([
        'before\t{++new++}',
        '   \n{++new++}',
    ])('maps native pedantic block offsets for %j', (source) => {
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source, {
            parserOptions: { pedantic: true },
        }));

        const html = marked.parse(source) as string;

        expect(html).toContain('data-critic-type="addition"');
        expect(html).toContain(`data-start="${source.indexOf('{++')}"`);
    });

    it.each([
        '1. {++x++}',
        '- {++x++}',
        '1. ab {++x++}',
    ])('renders EOF list CriticMarkup for %j', (source) => {
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source));

        expect(marked.parse(source) as string)
            .toContain('data-critic-type="addition"');
    });

    it('does not let a concurrent parse replace another invocation options', async () => {
        const source = 'before {++new++} after';
        const marked = new Marked();
        marked.use({
            async: true,
            hooks: {
                provideLexer(block) {
                    const isBlock = block ?? true;
                    return (async (
                        parserSource: string,
                        options: MarkedOptions,
                    ) => {
                        await new Promise(resolve => setTimeout(resolve, 30));
                        return isBlock
                            ? Lexer.lex(parserSource, options)
                            : Lexer.lexInline(parserSource, options);
                    }) as never;
                },
            },
        });
        marked.use(criticMarkupDocumentExtension(source, {
            parserOptions: { gfm: false },
        }));

        const [valid, invalid] = await Promise.allSettled([
            marked.parse(source, { gfm: false }) as Promise<string>,
            marked.parse(source, { gfm: true }) as Promise<string>,
        ]);

        expect(valid.status).toBe('fulfilled');
        expect(invalid.status).toBe('rejected');
    });
});
