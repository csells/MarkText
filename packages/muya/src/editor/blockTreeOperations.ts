import type { JSONOpComponent, JSONOpList } from 'ot-json1';
import type { Muya } from '../muya';
import type { TState } from '../state/types';
import * as otText from 'ot-text-unicode';
import { ScrollPage } from '../block/scrollPage';
import { hasPick } from '../utils';
import logger from '../utils/logger';

const debug = logger('editor:block-tree-operations');

// The pick/drop walkers operate on live block-tree nodes (ScrollPage,
// Parent, Content). The tree's instance methods are not all exposed on one
// TypeScript type, while ot-json1 descents are dynamically shaped. Keep that
// intentionally loose boundary private to this adapter.
type BlockNode = {
    queryBlock?: (path: (string | number)[]) => BlockNode | undefined;
    find?: (key: number | string) => BlockNode;
    remove?: (source: string) => void;
    replaceWith?: (newBlock: BlockNode, source: string) => void;
    insertBefore?: (newBlock: BlockNode, ref: BlockNode, source: string) => void;
    append?: (newBlock: BlockNode, source: string) => void;
    update?: (value?: unknown, source?: string) => void;
    applyCheckedFromState?: (checked: boolean) => void;
    applyAlignmentFromState?: (value: string) => void;
    applyLanguageFromState?: (value: string) => void;
    applyTypeFromState?: (value: string) => void;
    blockName?: string;
    align?: string;
    _text?: string;
    text?: string;
    meta?: { lang?: string; type?: string };
    parent?: BlockNode;
} | undefined;

function descend(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
): { subDoc: BlockNode; i: number } {
    let i = 0;

    for (; i < descent.length; i++) {
        const d = descent[i];
        if (Array.isArray(d))
            break;
        if (typeof d === 'object')
            continue;
        stack.push(subDoc);
        // It is valid to descend into a null space; it just cannot be picked.
        subDoc = subDoc == null ? undefined : subDoc.queryBlock?.([d]);
    }

    return { subDoc, i };
}

function restore(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
    i: number,
): BlockNode {
    for (--i; i >= 0; i--) {
        const d = descent[i];
        if (typeof d !== 'object') {
            const container = stack.pop();
            if (
                subDoc
                === (container == null
                    ? undefined
                    : container.queryBlock?.([d as string | number]))
            ) {
                subDoc = container;
            }
            else {
                if (subDoc === undefined) {
                    // TODO: handle typeof d === 'string'.
                    if (typeof d === 'number')
                        container?.find?.(d)?.remove?.('api');
                    subDoc = container;
                }
                else {
                    if (typeof d === 'number')
                        container?.find?.(d)?.replaceWith?.(subDoc, 'api');
                    subDoc = container;
                }
            }
        }
        else if (!Array.isArray(d) && hasPick(d)) {
            subDoc = undefined;
        }
    }

    return subDoc;
}

function pick(subDoc: BlockNode, descent: JSONOpList): BlockNode {
    const stack: BlockNode[] = [];
    const descended = descend(subDoc, descent, stack);
    subDoc = descended.subDoc;

    // Children must be traversed in reverse order during the pick phase.
    for (let j = descent.length - 1; j >= descended.i; j--)
        subDoc = pick(subDoc, descent[j] as JSONOpList);

    return restore(subDoc, descent, stack, descended.i);
}

function drop(root: BlockNode, descent: JSONOpList, muya: Muya): BlockNode {
    let subDoc = root;
    let i = 0;
    let m = 0;
    const rootContainer: { root: BlockNode } = { root };
    let container: BlockNode | { root: BlockNode } = rootContainer;
    let key: string | number = 'root';

    const descendToMutation = () => {
        for (; m < i; m++) {
            const d = descent[m];
            if (typeof d === 'object')
                continue;
            if (key === 'root') {
                const wrap = container as { root: BlockNode };
                container = wrap.root;
            }
            else {
                container = (container as BlockNode)?.queryBlock?.([key]);
            }
            key = d as string | number;
        }
    };

    const applyInsert = (component: JSONOpComponent) => {
        descendToMutation();
        const current = container as BlockNode;
        const reference = current?.find?.(key);
        if (typeof key === 'number') {
            const newBlock = ScrollPage.createStateBlock(
                muya,
                component.i as TState,
            );
            // The OT adapter needs only this private structural view; Parent's
            // callback variance prevents a direct assignment to it.
            // eslint-disable-next-line no-restricted-syntax
            const newBlockNode = newBlock as unknown as BlockNode;
            if (current && newBlockNode) {
                if (reference)
                    current.insertBefore?.(newBlockNode, reference, 'api');
                else
                    current.append?.(newBlockNode, 'api');
            }
            subDoc = newBlockNode;
            return;
        }

        switch (key) {
            case 'checked': {
                if (typeof component.i !== 'boolean') {
                    throw new TypeError(
                        'Prepared task-list checked value must be boolean.',
                    );
                }
                if (!reference?.applyCheckedFromState) {
                    throw new TypeError(
                        'Prepared task-list operation has no checkbox applier.',
                    );
                }
                reference.applyCheckedFromState(component.i);
                break;
            }
            case 'meta':
                break;
            default:
                debug.warn(`Unknown operation path ${key}`);
                break;
        }
    };

    const applyTextEdit = (edit: NonNullable<JSONOpComponent['es']>) => {
        descendToMutation();
        const state = subDoc!;
        if (state.blockName === 'table.cell') {
            if (!state.applyAlignmentFromState) {
                throw new TypeError(
                    'Prepared table operation has no alignment applier.',
                );
            }
            state.applyAlignmentFromState(
                otText.type.apply(state.align ?? '', edit) as string,
            );
        }
        else if (state.blockName === 'language-input') {
            const nextText = otText.type.apply(state.text ?? '', edit) as string;
            state._text = nextText;
            if (!state.parent?.applyLanguageFromState) {
                throw new TypeError(
                    'Prepared language input has no code-block applier.',
                );
            }
            state.parent.applyLanguageFromState(nextText);
            state.update?.();
        }
        else if (state.blockName === 'code-block') {
            if (!state.applyTypeFromState) {
                throw new TypeError(
                    'Prepared code block has no type applier.',
                );
            }
            state.applyTypeFromState(
                otText.type.apply(state.meta?.type ?? '', edit) as string,
            );
        }
        else {
            state._text = otText.type.apply(state.text ?? '', edit) as string;
            state.update?.();
        }
    };

    for (; i < descent.length; i++) {
        const d = descent[i];
        if (Array.isArray(d)) {
            const child = drop(subDoc, d, muya);
            if (child !== subDoc && child !== undefined) {
                descendToMutation();
                if (key === 'root')
                    (container as { root: BlockNode }).root = child;
                else
                    (container as Record<string, BlockNode>)[key] = child;
                subDoc = child;
            }
        }
        else if (typeof d === 'object') {
            const component = d as JSONOpComponent;
            if (component.i !== undefined)
                applyInsert(component);
            if (component.es)
                applyTextEdit(component.es);
        }
        else {
            subDoc = subDoc != null ? subDoc.queryBlock?.([d]) : undefined;
        }
    }

    return rootContainer.root;
}

/** Apply one prepared ot-json1 operation to the live Muya block tree. */
export function applyBlockTreeOperations(
    root: ScrollPage,
    operations: JSONOpList,
    muya: Muya,
): void {
    const snapshot = pick(root as unknown as BlockNode, operations);
    drop(snapshot, operations, muya);
}
