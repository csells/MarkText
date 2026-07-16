import type { Token, Tokens } from 'marked';
import type { IMathToken } from './extensions/math';
import type { Heading, ILexOption } from './types';

/**
 * Visit every lexed token exactly like `Marked.walkTokens`, without its
 * result accumulator: marked concatenates each callback result into a
 * growing array, which is O(tokens^2) on the flat inline token list of a
 * large paragraph. The lex walker mutates tokens in place and returns
 * nothing, so a plain recursive visit is behavior-identical.
 *
 * `childTokens` is the marked instance's `defaults.extensions.childTokens`
 * registry, so extension-declared child fields (e.g. a substitution's
 * `oldTokens`/`newTokens`) are covered the same way marked covers them.
 */
export function walkLexedTokens(
    tokens: readonly Token[],
    callback: (token: Token) => void,
    childTokens?: Record<string, string[]>,
): void {
    for (const token of tokens) {
        callback(token);
        switch (token.type) {
            case 'table': {
                const tableToken = token as Tokens.Table;
                for (const cell of tableToken.header)
                    walkLexedTokens(cell.tokens, callback, childTokens);
                for (const row of tableToken.rows) {
                    for (const cell of row)
                        walkLexedTokens(cell.tokens, callback, childTokens);
                }
                break;
            }
            case 'list': {
                const listToken = token as Tokens.List;
                walkLexedTokens(listToken.items, callback, childTokens);
                break;
            }
            case 'critic_addition':
            case 'critic_deletion':
            case 'critic_substitution':
            case 'critic_highlight':
            case 'critic_comment': {
                walkLexedTokens(
                    (token as Tokens.CriticMarkupFragment).tokens,
                    callback,
                    childTokens,
                );
                break;
            }
            default: {
                const genericToken = token as Tokens.Generic;
                const childFields = childTokens?.[genericToken.type];
                if (childFields) {
                    for (const field of childFields) {
                        walkLexedTokens(
                            (genericToken[field] as Token[]).flat(
                                Number.POSITIVE_INFINITY,
                            ),
                            callback,
                            childTokens,
                        );
                    }
                }
                else if (genericToken.tokens) {
                    walkLexedTokens(genericToken.tokens, callback, childTokens);
                }
            }
        }
    }
}

function isHeadingToken(token: Token | Heading): token is Heading {
    return token.type === 'heading';
}

function isMathToken(token: Token | IMathToken): token is IMathToken {
    return token.type === 'code' && token.lang === 'math';
}

function walkTokens(options: ILexOption) {
    return (token: Token | Heading) => {
        const { math, isGitlabCompatibilityEnabled } = options;
        // marked mixes atx and setext headers, which we distinguish by headingStyle,
        // and markers are unique to setext heading
        if (isHeadingToken(token)) {
            const matches = /\n {0,3}(=+|-+)/.exec(token.raw);
            token.headingStyle = matches ? 'setext' : 'atx';
            token.marker = matches ? matches[1] : '';
        }

        if (token.type === 'code') {
            // Only strip the language tag for indented code blocks — those are
            // never fenced and can't carry a language. For fenced blocks we
            // tag them once; subsequent visits are no-ops, so this stays
            // idempotent even if walkTokens accidentally runs multiple times.
            if (token.codeBlockStyle === 'indented')
                token.lang = '';
            else if (!token.codeBlockStyle && typeof token.lang === 'string')
                token.codeBlockStyle = 'fenced';
        }

        if (isMathToken(token) && math && isGitlabCompatibilityEnabled) {
            // Transform the marked code-block token in place into the
            // multiplemath token shape that downstream consumers expect.
            // After the assignment the old `lang`/`codeBlockStyle` fields no
            // longer belong on the value, so strip them via a structural view.
            token.type = 'multiplemath';
            token.mathStyle = 'gitlab';
            token.displayMode = true;
            const codeFields = token as IMathToken & Partial<{ lang: unknown; codeBlockStyle: unknown }>;
            delete codeFields.lang;
            delete codeFields.codeBlockStyle;
        }
    };
}

export default walkTokens;
