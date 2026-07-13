import type { MarkedOptions, Token } from 'marked';
import type { CriticMarkupAnalysis } from '../../../../criticMarkup/analysis';
import type {
    ICriticMarkupParseSession,
} from '../../criticMarkupParseSession';
import type { ILexOption } from '../../types';
import {
    Marked,
    markedDocumentOffset,
    MarkedSourceDocument,
} from 'marked';
import {
    withCriticMarkupParseSession,
} from '../../criticMarkupParseSession';
import {
    prepareCriticMarkupSourceContext,
} from '../../criticMarkupSourceContext';
import footnoteExtension from '../../extensions/footnote';
import mathExtension from '../../extensions/math';
import superSubScriptExtension from '../../extensions/superSubscript';
import { DEFAULT_OPTIONS } from '../../options';

export function withTestCriticMarkupParseSession<Result>(
    source: string,
    options: ILexOption,
    block: boolean,
    consume: (
        session: ICriticMarkupParseSession,
        tokens: Token[],
    ) => Result,
    analysis?: CriticMarkupAnalysis,
    canonicalSource = source,
): Result {
    const effective = { ...DEFAULT_OPTIONS, ...options };
    const marked = new Marked();
    marked.options({
        breaks: effective.breaks,
        gfm: effective.gfm,
        pedantic: effective.pedantic,
    });
    if (effective.math) {
        marked.use(mathExtension({
            throwOnError: false,
            useKatexRender: false,
        }));
    }
    if (effective.footnote)
        marked.use(footnoteExtension());
    if (effective.superSubScript)
        marked.use(superSubScriptExtension());

    const parserOptions: MarkedOptions = {
        ...marked.defaults,
        ...effective,
    };
    const sourceContext = prepareCriticMarkupSourceContext(
        canonicalSource,
        effective,
        analysis,
    );
    const document = new MarkedSourceDocument(sourceContext, canonicalSource);
    const parserStart = canonicalSource === source
        ? 0
        : canonicalSource.indexOf(source);
    if (parserStart < 0) {
        throw new TypeError(
            'Test parser source is not contained in its canonical source.',
        );
    }
    const parserInput = document.slice(
        markedDocumentOffset(parserStart),
        markedDocumentOffset(parserStart + source.length),
    );
    return withCriticMarkupParseSession(
        sourceContext,
        source,
        parserOptions,
        block,
        consume,
        parserInput,
    );
}
