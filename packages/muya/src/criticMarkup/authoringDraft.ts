import type { ExcludedRanges } from './excludedRanges';
import type { TCriticMarkupAuthorInput } from './reviewContract';
import { parseCriticMarkupAt } from './parser';
import { createCriticMarkup } from './transform';

export interface ICriticMarkupAuthoringDraft {
    readonly text: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
}

/**
 * Serialize one authoring command and derive the semantic payload selection
 * from the grammar result. Existing parser items selected for a nested comment
 * are opaque: their already-valid syntax must not be protective-escaped as if
 * it were newly typed payload text.
 */
export function criticMarkupAuthoringDraft(
    input: TCriticMarkupAuthorInput,
    selected: string,
    nestedItems: ExcludedRanges,
): ICriticMarkupAuthoringDraft {
    let text: string;
    switch (input.type) {
        case 'addition':
        case 'deletion':
        case 'highlight':
            text = createCriticMarkup({
                type: input.type,
                content: selected,
            });
            break;
        case 'substitution':
            text = createCriticMarkup({
                type: 'substitution',
                oldContent: selected,
                newContent: input.replacement,
            });
            break;
        case 'comment':
            text = selected
                ? createCriticMarkup({
                        type: 'highlight',
                        content: selected,
                    }, {
                        content: nestedItems,
                    }) + createCriticMarkup({
                        type: 'comment',
                        content: input.comment,
                    })
                : createCriticMarkup({
                        type: 'comment',
                        content: input.comment,
                    });
            break;
    }

    const critic = parseCriticMarkupAt(text, 0);
    if (!critic) {
        throw new TypeError(
            'CriticMarkup serializer produced syntax its grammar cannot parse.',
        );
    }
    if (input.type === 'comment' && !selected)
        return { text, selectionStart: text.length, selectionEnd: text.length };
    if (input.type === 'substitution') {
        if (critic.type !== 'substitution') {
            throw new TypeError(
                'CriticMarkup substitution serializer changed semantic type.',
            );
        }
        return {
            text,
            selectionStart: critic.newRange.start,
            selectionEnd: critic.newRange.end,
        };
    }
    if (critic.type === 'substitution') {
        throw new TypeError(
            'CriticMarkup content serializer changed semantic type.',
        );
    }
    return {
        text,
        selectionStart: critic.contentRange.start,
        selectionEnd: critic.contentRange.end,
    };
}
