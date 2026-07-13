import type {
    HooksObject,
    IMarkedProvenanceBinding,
    MarkedOptions,
    MarkedParseTrace,
    MarkedSourceView,
    Token,
    TokensList,
} from 'marked';
import type {
    PreparedCriticMarkupSourceContext,
} from './criticMarkupSourceContext';
import {
    createMarkedProvenanceBinding,
    Lexer,
    MarkedSourceDocument,
} from 'marked';

interface ICriticMarkupParseSessionAuthority {
    readonly level: 'block' | 'inline';
    readonly sourceContext: PreparedCriticMarkupSourceContext;
    readonly parserSource: string;
    readonly tokens: Token[];
    readonly trace: MarkedParseTrace<PreparedCriticMarkupSourceContext>;
}

export interface ICriticMarkupParseSession {
    readonly hasCandidateOpener: boolean;
    readonly level: 'block' | 'inline';
}

export interface IAuthenticatedCriticMarkupParseSession {
    readonly level: 'block' | 'inline';
    readonly sourceContext: PreparedCriticMarkupSourceContext;
    readonly parserSource: string;
    readonly tokens: Token[];
    readonly trace: MarkedParseTrace<PreparedCriticMarkupSourceContext>;
}

const SESSION_AUTHORITY = new WeakMap<
    object,
    ICriticMarkupParseSessionAuthority
>();
const CLAIMED_SESSIONS = new WeakSet<object>();

function createSession(
    tokens: Token[],
    parserSource: string,
    sourceContext: PreparedCriticMarkupSourceContext,
    trace: MarkedParseTrace<PreparedCriticMarkupSourceContext>,
): ICriticMarkupParseSession {
    trace.assertUnchanged();
    if (
        trace.tokens !== tokens
        || trace.input.document.id !== sourceContext
        || trace.input.document.text !== sourceContext.source
        || trace.input.text !== parserSource
    ) {
        throw new TypeError(
            'Marked provenance differs from its prepared CriticMarkup parser session.',
        );
    }
    const session: ICriticMarkupParseSession = Object.freeze({
        hasCandidateOpener: sourceContext.hasCandidateOpener,
        level: trace.level,
    });
    SESSION_AUTHORITY.set(session, Object.freeze({
        level: session.level,
        sourceContext,
        parserSource,
        tokens,
        trace,
    }));
    return session;
}

function assertOptions(
    sourceContext: PreparedCriticMarkupSourceContext,
    options: unknown,
): void {
    sourceContext.assertSourceAndParserOptions(
        sourceContext.source,
        options,
    );
}

/**
 * Marked hook owner for one exact mapped parser source. Candidate token arrays
 * must carry the parser-owned trace from their actual Lexer instance.
 */
export function createCriticMarkupSessionHooks(
    sourceContext: PreparedCriticMarkupSourceContext,
    expectedParserSource: string,
    provenance: IMarkedProvenanceBinding<PreparedCriticMarkupSourceContext>,
    process: (
        session: ICriticMarkupParseSession,
        tokens: TokensList,
        options: MarkedOptions,
    ) => TokensList,
): HooksObject {
    return {
        preprocess(source) {
            if (source !== expectedParserSource) {
                throw new TypeError(
                    'Marked source differs from its prepared CriticMarkup parser session.',
                );
            }
            return source;
        },
        processAllTokens(tokens) {
            const tokenList = tokens as TokensList;
            if (!sourceContext.hasCandidateOpener) {
                assertOptions(sourceContext, this.options);
                return tokenList;
            }
            const trace = provenance.claim(tokenList);
            assertOptions(sourceContext, trace.lexerOptions);
            const lexerOptions = trace.lexerOptions as MarkedOptions;
            return process(
                createSession(
                    tokenList as Token[],
                    expectedParserSource,
                    sourceContext,
                    trace,
                ),
                tokenList,
                lexerOptions,
            );
        },
    };
}

/** Exact-source/profile hooks for ordinary Markdown with no Critic opener. */
export function createNoCandidateCriticMarkupHooks(
    sourceContext: PreparedCriticMarkupSourceContext,
    expectedParserSource: string,
): HooksObject {
    return {
        preprocess(source) {
            if (source !== expectedParserSource) {
                throw new TypeError(
                    'Marked source differs from its prepared CriticMarkup parser session.',
                );
            }
            return source;
        },
        processAllTokens(tokens) {
            assertOptions(sourceContext, this.options);
            return tokens;
        },
    };
}

/** High-level owner used by focused adapters/tests without raw token stamping. */
export function withCriticMarkupParseSession<Result>(
    sourceContext: PreparedCriticMarkupSourceContext,
    parserSource: string,
    options: MarkedOptions,
    block: boolean,
    consume: (
        session: ICriticMarkupParseSession,
        tokens: Token[],
    ) => Result,
    parserInput?: MarkedSourceView<PreparedCriticMarkupSourceContext>,
): Result {
    assertOptions(sourceContext, options);
    const document = new MarkedSourceDocument(
        sourceContext,
        sourceContext.source,
    );
    const input = parserInput ?? document.identity();
    if (input.text !== parserSource) {
        throw new TypeError(
            'Focused CriticMarkup parse requires an exact mapped parser input.',
        );
    }
    const provenance = createMarkedProvenanceBinding(input);
    const parserOptions: MarkedOptions = {
        ...options,
        sourceProvenance: provenance.extension.sourceProvenance,
    };
    const tokens = block
        ? Lexer.lex(parserSource, parserOptions)
        : Lexer.lexInline(parserSource, parserOptions);
    const trace = provenance.claim(tokens);
    return consume(
        createSession(
            tokens,
            parserSource,
            sourceContext,
            trace,
        ),
        tokens,
    );
}

export function beginCriticMarkupParseSession(
    session: ICriticMarkupParseSession,
): IAuthenticatedCriticMarkupParseSession {
    const authority = SESSION_AUTHORITY.get(session);
    if (!authority || CLAIMED_SESSIONS.has(session)) {
        throw new TypeError(
            'CriticMarkup context requires an authenticated one-use parser session.',
        );
    }
    authority.trace.assertUnchanged();
    CLAIMED_SESSIONS.add(session);
    return authority;
}

export function completeCriticMarkupParseSession(
    session: ICriticMarkupParseSession,
): void {
    const authority = SESSION_AUTHORITY.get(session);
    if (!authority || !CLAIMED_SESSIONS.has(session)) {
        throw new TypeError(
            'CriticMarkup parser session was not claimed by its context owner.',
        );
    }
    authority.trace.assertUnchanged();
    SESSION_AUTHORITY.delete(session);
}

export function abandonCriticMarkupParseSession(
    session: ICriticMarkupParseSession,
): void {
    SESSION_AUTHORITY.delete(session);
}
