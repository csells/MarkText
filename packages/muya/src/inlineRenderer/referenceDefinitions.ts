import type { IParagraphState, TContainerState, TState } from '../state/types';
import type { Labels } from './types';
import { beginRules } from './rules';

/** Reference-definition label and target parsed from one paragraph text. */
export function referenceDefinitionLabelInfo(text: string) {
    const tokens = beginRules.reference_definition.exec(text);
    let label = null;
    let info = null;
    if (tokens) {
        label = (tokens[2] + tokens[3]).toLowerCase();
        info = {
            href: tokens[6],
            title: tokens[10] || '',
        };
    }

    return { label, info };
}

/**
 * Reference-link labels declared anywhere in a state tree. Definitions are
 * stored as paragraph text (see `state/types.ts`), so this scans paragraph
 * states rather than a dedicated definition node.
 */
export function collectReferenceDefinitions(states: readonly TState[]): Labels {
    const labels: Labels = new Map();

    const travel = (sts: readonly TState[]) => {
        if (Array.isArray(sts) && sts.length) {
            for (const st of sts) {
                if (st.name === 'paragraph') {
                    const { label, info } = referenceDefinitionLabelInfo(
                        (st as IParagraphState).text,
                    );
                    if (label && info)
                        labels.set(label, info);
                }
                else if ((st as TContainerState).children) {
                    travel((st as TContainerState).children);
                }
            }
        }
    };

    travel(states);

    return labels;
}
