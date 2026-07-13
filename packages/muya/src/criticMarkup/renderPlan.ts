import type {
    ICriticMarkupContentFragmentSegment,
    ICriticMarkupDocumentFragment,
    ICriticMarkupDocumentItem,
    ICriticMarkupMarkerFragmentSegment,
} from './document';
import type { ICriticMarkupRenderLimitDiagnostic } from './renderPolicy';
import {
    CRITIC_MARKUP_RENDER_DEPTH_LIMIT,
    criticMarkupRenderLimitDiagnostic,
    exceedsCriticMarkupRenderDepth,
} from './renderPolicy';

export interface ICriticMarkupRenderContentSegment
    extends ICriticMarkupContentFragmentSegment {
    readonly children: ICriticMarkupRenderSequence;
}

export type TCriticMarkupRenderSegment
    = | ICriticMarkupMarkerFragmentSegment
        | ICriticMarkupRenderContentSegment;

export type ICriticMarkupRenderItem = Pick<
    ICriticMarkupDocumentItem,
    'id' | 'parentId' | 'depth' | 'syntax'
>;

export type ICriticMarkupRenderFragment = Pick<
    ICriticMarkupDocumentFragment,
    'role' | 'localRange' | 'sourceRange' | 'segments'
>;

export interface ICriticMarkupRenderInput {
    readonly item: ICriticMarkupRenderItem;
    readonly fragment: ICriticMarkupRenderFragment;
}

export interface ICriticMarkupRenderNode {
    readonly input: ICriticMarkupRenderInput;
    readonly item: ICriticMarkupRenderItem;
    readonly fragment: ICriticMarkupRenderFragment;
    readonly presentation: 'semantic' | 'literal-depth-limit';
    readonly diagnostic?: ICriticMarkupRenderLimitDiagnostic;
    readonly segments: readonly TCriticMarkupRenderSegment[];
}

export interface ICriticMarkupRenderSequence {
    readonly nodes: readonly ICriticMarkupRenderNode[];
}

export interface ICriticMarkupPathRenderPlan {
    readonly roots: ICriticMarkupRenderSequence;
    /** Descendants always precede their parent; adapters lower this iteratively. */
    readonly postorder: readonly ICriticMarkupRenderNode[];
}

interface IMutableRenderNode {
    input: ICriticMarkupRenderInput;
    item: ICriticMarkupRenderItem;
    fragment: ICriticMarkupRenderFragment;
    presentation: ICriticMarkupRenderNode['presentation'];
    diagnostic?: ICriticMarkupRenderLimitDiagnostic;
    childNodes: Map<number, IMutableRenderNode[]>;
}

const EMPTY_RENDER_SEQUENCE: ICriticMarkupRenderSequence = Object.freeze({
    nodes: Object.freeze([]),
});
const EMPTY_RENDER_PLAN: ICriticMarkupPathRenderPlan = Object.freeze({
    roots: EMPTY_RENDER_SEQUENCE,
    postorder: Object.freeze([]),
});
const renderPlanCache = new WeakMap<
    readonly ICriticMarkupRenderInput[],
    ICriticMarkupPathRenderPlan
>();

function compareNodes(
    left: IMutableRenderNode,
    right: IMutableRenderNode,
): number {
    return left.fragment.localRange.start
        - right.fragment.localRange.start
        || left.fragment.localRange.end
        - right.fragment.localRange.end;
}

function validateAndSortSiblings(
    nodes: IMutableRenderNode[],
): void {
    nodes.sort(compareNodes);
    let previousEnd = -1;
    for (const node of nodes) {
        const { item, fragment } = node;
        if (fragment.localRange.start < previousEnd) {
            throw new RangeError(
                `CriticMarkup sibling fragments overlap at ${fragment.localRange.start}.`,
            );
        }
        if (fragment.localRange.start >= fragment.localRange.end) {
            throw new RangeError(
                `CriticMarkup fragment ${item.id} has an empty or reversed range.`,
            );
        }
        previousEnd = fragment.localRange.end;
    }
}

function owningContentSegment(
    parent: IMutableRenderNode,
    child: IMutableRenderNode,
): number {
    const childRange = child.fragment.localRange;
    const matches: number[] = [];
    parent.fragment.segments.forEach((segment, index) => {
        if (
            segment.kind === 'content'
            && segment.localRange.start <= childRange.start
            && childRange.end <= segment.localRange.end
        ) {
            matches.push(index);
        }
    });
    if (matches.length !== 1) {
        throw new RangeError(
            `CriticMarkup fragment ${child.item.id} belongs to ${matches.length} `
            + `semantic arms of ${parent.item.id}.`,
        );
    }
    return matches[0];
}

/** Build the one backend-neutral forest for a canonical document path. */
export function buildCriticMarkupRenderPlan(
    inputs: readonly ICriticMarkupRenderInput[],
): ICriticMarkupPathRenderPlan {
    if (!inputs.length)
        return EMPTY_RENDER_PLAN;
    const cached = renderPlanCache.get(inputs);
    if (cached)
        return cached;

    // The first over-budget item owns the literal bytes of all deeper items.
    const mutableNodes: IMutableRenderNode[] = [];
    for (const input of inputs) {
        const item = input.item;
        if (item.depth > CRITIC_MARKUP_RENDER_DEPTH_LIMIT)
            continue;
        const limited = exceedsCriticMarkupRenderDepth(item.depth);
        mutableNodes.push({
            input,
            item,
            fragment: input.fragment,
            presentation: limited ? 'literal-depth-limit' : 'semantic',
            ...(limited
                ? {
                        diagnostic: criticMarkupRenderLimitDiagnostic(
                            item.depth,
                            item.syntax.range,
                        ),
                    }
                : {}),
            childNodes: new Map(),
        });
    }
    const nodeByItemId = new Map(mutableNodes.map(node => [
        node.item.id,
        node,
    ]));
    const roots: IMutableRenderNode[] = [];

    for (const node of mutableNodes) {
        const parentId = node.item.parentId;
        const parent = parentId ? nodeByItemId.get(parentId) : undefined;
        if (!parent) {
            roots.push(node);
            continue;
        }
        if (parent.presentation === 'literal-depth-limit')
            continue;

        const segmentIndex = owningContentSegment(parent, node);
        const children = parent.childNodes.get(segmentIndex) ?? [];
        children.push(node);
        parent.childNodes.set(segmentIndex, children);
    }

    validateAndSortSiblings(roots);
    for (const node of mutableNodes) {
        for (const children of node.childNodes.values())
            validateAndSortSiblings(children);
    }

    const built = new Map<
        IMutableRenderNode,
        ICriticMarkupRenderNode
    >();
    const postorder: ICriticMarkupRenderNode[] = [];
    for (let index = mutableNodes.length - 1; index >= 0; index--) {
        const node = mutableNodes[index];
        const segments: TCriticMarkupRenderSegment[]
            = node.presentation === 'literal-depth-limit'
                ? []
                : node.fragment.segments.map((segment, segmentIndex) => {
                        if (segment.kind === 'marker') {
                            return Object.freeze({
                                ...segment,
                                localRange: Object.freeze({ ...segment.localRange }),
                                sourceRange: Object.freeze({ ...segment.sourceRange }),
                            });
                        }
                        const children = node.childNodes.get(segmentIndex) ?? [];
                        return Object.freeze({
                            ...segment,
                            localRange: Object.freeze({ ...segment.localRange }),
                            sourceRange: Object.freeze({ ...segment.sourceRange }),
                            children: children.length
                                ? Object.freeze({
                                        nodes: Object.freeze(children.map((child) => {
                                            const builtChild = built.get(child);
                                            if (!builtChild) {
                                                throw new TypeError(
                                                    `CriticMarkup child ${child.item.id} `
                                                    + 'was not built before its parent.',
                                                );
                                            }
                                            return builtChild;
                                        })),
                                    })
                                : EMPTY_RENDER_SEQUENCE,
                        });
                    });
        const rendered = Object.freeze({
            input: node.input,
            item: node.item,
            fragment: node.fragment,
            presentation: node.presentation,
            ...(node.diagnostic ? { diagnostic: node.diagnostic } : {}),
            segments: Object.freeze(segments),
        });
        built.set(node, rendered);
        postorder.push(rendered);
    }

    const plan = Object.freeze({
        roots: Object.freeze({
            nodes: Object.freeze(roots.map((root) => {
                const builtRoot = built.get(root);
                if (!builtRoot)
                    throw new TypeError(`CriticMarkup root ${root.item.id} was not built.`);
                return builtRoot;
            })),
        }),
        postorder: Object.freeze(postorder),
    });
    renderPlanCache.set(inputs, plan);
    return plan;
}

export function criticMarkupRenderCursor(
    sequence: ICriticMarkupRenderSequence,
    offset: number,
): number {
    let low = 0;
    let high = sequence.nodes.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (sequence.nodes[middle].fragment.localRange.end <= offset)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}

export function activeCriticMarkupRenderNode(
    sequence: ICriticMarkupRenderSequence,
    cursor: number,
    offset: number,
): ICriticMarkupRenderNode | null {
    const node = sequence.nodes[cursor];
    return node
        && node.fragment.localRange.start <= offset
        && offset < node.fragment.localRange.end
        ? node
        : null;
}
