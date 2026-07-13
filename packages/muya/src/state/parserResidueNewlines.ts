import type {
    TBlockToken,
    TLexedToken,
} from '../utils/marked/types';

type TParserResidueToken = Extract<TLexedToken, { type: 'parser_residue' }>;

/**
 * Resolve the LF owned by each literal parser envelope before state lowering
 * flattens the native token graph. Nested container tokenizers trim their
 * child input, so the final LF can live on an enclosing native carrier.
 */
export function parserResidueTerminalNewlines(
    tokens: readonly TLexedToken[],
): WeakMap<TParserResidueToken, boolean> {
    const result = new WeakMap<TParserResidueToken, boolean>();

    const visitSequence = (
        values: readonly TBlockToken[],
        inheritedNewline: boolean,
    ): void => {
        let lastSemantic = -1;
        for (let index = values.length - 1; index >= 0; index--) {
            if (values[index].type !== 'space') {
                lastSemantic = index;
                break;
            }
        }

        values.forEach((token, index) => {
            if (
                token.type === 'space'
                || token.type === 'block-end'
                || token.type === 'critic-fragment-end'
                || token.type === 'critic-boundary-end'
            )
                return;
            const following = values[index + 1];
            const followingNewline = following?.type === 'space'
                && following.raw.startsWith('\n');
            const terminalNewline = token.raw.endsWith('\n')
                || followingNewline
                || (index === lastSemantic && inheritedNewline);

            switch (token.type) {
                case 'parser_residue':
                    result.set(token, terminalNewline);
                    break;

                case 'blockquote':
                case 'footnote':
                case 'list_item':
                case 'critic_addition':
                case 'critic_deletion':
                case 'critic_substitution':
                case 'critic_highlight':
                case 'critic_comment':
                    visitSequence(
                        token.tokens as TBlockToken[],
                        terminalNewline,
                    );
                    break;

                case 'list':
                    token.items.forEach((item, itemIndex) => {
                        const itemNewline = item.raw.endsWith('\n')
                            || itemIndex < token.items.length - 1
                            || (
                                itemIndex === token.items.length - 1
                                && terminalNewline
                            );
                        visitSequence(
                            item.tokens as TBlockToken[],
                            itemNewline,
                        );
                    });
                    break;
            }
        });
    };

    visitSequence(tokens as TBlockToken[], false);
    return result;
}

export type { TParserResidueToken };
