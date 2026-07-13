import type { MarkedExtension, Token } from 'marked';
import { describe, expect, it } from 'vitest';
import { plainMarkdown } from '../../../state/markdownSourceMap';
import { parseCriticMarkupDocument } from '../criticMarkupDocument';
import {
    prepareNativeCriticMarkupExtension,
} from '../extensions/nativeCriticMarkup';
import {
    analyzeMarkdownBlockSourceWithExtensions,
} from '../lexBlock';

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

function tokenShape(token: Token | undefined): {
    readonly type: string | undefined;
    readonly children: readonly string[];
} {
    return {
        type: token?.type,
        children: token && 'tokens' in token && Array.isArray(token.tokens)
            ? token.tokens.map(child => child.type)
            : [],
    };
}

describe('native CriticMarkup extension parser isolation', () => {
    it('does not suppress a second lexer while the first recursively tokenizes an arm', () => {
        const source = '{++# nested\n++}\n';
        const document = parseCriticMarkupDocument(plainMarkdown(source), {
            ...OPTIONS,
            criticMarkup: false,
        });
        const native = prepareNativeCriticMarkupExtension(
            document,
            fragment => fragment.startsWith('# '),
        );
        let triggered = false;
        let triggerCount = 0;
        let reentrantShape: ReturnType<typeof tokenShape> | undefined;
        const reentrantLexer: MarkedExtension = {
            extensions: [{
                name: 'critic_native_reentrant_lexer_probe',
                level: 'block',
                tokenizer() {
                    if (triggered)
                        return undefined;
                    triggered = true;
                    triggerCount++;
                    const parsed = analyzeMarkdownBlockSourceWithExtensions(
                        source,
                        OPTIONS,
                        [native.extension],
                        undefined,
                        native.transparentMarkerRanges,
                    );
                    reentrantShape = tokenShape(parsed.tokens[0]);
                    return undefined;
                },
            }],
        };

        const parsed = analyzeMarkdownBlockSourceWithExtensions(
            source,
            OPTIONS,
            [reentrantLexer, native.extension],
            undefined,
            native.transparentMarkerRanges,
        );

        expect(triggerCount).toBe(1);
        expect(tokenShape(parsed.tokens[0])).toEqual({
            type: 'critic_addition',
            children: ['heading'],
        });
        expect(reentrantShape).toEqual({
            type: 'critic_addition',
            children: ['heading'],
        });
    });
});
