import type { TBlockPath } from '../block/types';
import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentItem,
    ICriticMarkupLocalPosition,
} from '../criticMarkup/document';
import type { Muya } from '../muya';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import { localOffset, sourceOffset } from '../mappedText';
import { markdownStatePath } from '../state/markdownSourceMap';

export type THiddenCriticCommentCaretAffinity
    = 'nearest' | 'previous' | 'next';

export interface IVisibleCriticCommentCaretPosition {
    readonly path: TBlockPath;
    readonly offset: number;
}

function outermostContainingComment(
    item: ICriticMarkupDocumentItem,
    sourcePosition: number,
    itemById: (id: string) => ICriticMarkupDocumentItem | null,
): ICriticMarkupDocumentItem | null {
    let candidate: ICriticMarkupDocumentItem | null = null;
    let current: ICriticMarkupDocumentItem | null = item;

    while (current) {
        if (
            current.syntax.type === 'comment'
            && current.syntax.range.start < sourcePosition
            && sourcePosition < current.syntax.range.end
        ) {
            candidate = current;
        }
        current = current.parentId ? itemById(current.parentId) : null;
    }

    return candidate;
}

interface IHiddenStructuralCommentOwner {
    readonly hidden: boolean;
    readonly comment: ICriticMarkupDocumentItem<TMarkdownStatePath> | null;
}

function outermostCommentAncestor(
    item: ICriticMarkupDocumentItem<TMarkdownStatePath>,
    itemById: (
        id: string,
    ) => ICriticMarkupDocumentItem<TMarkdownStatePath> | null,
): ICriticMarkupDocumentItem<TMarkdownStatePath> | null {
    let comment: ICriticMarkupDocumentItem<TMarkdownStatePath> | null = null;
    let current: ICriticMarkupDocumentItem<TMarkdownStatePath> | null = item;
    while (current) {
        if (current.syntax.type === 'comment')
            comment = current;
        current = current.parentId ? itemById(current.parentId) : null;
    }
    return comment;
}

function hiddenStructuralCommentOwner(
    document: CriticMarkupDocument<TMarkdownStatePath>,
    position: ICriticMarkupLocalPosition<TMarkdownStatePath>,
): IHiddenStructuralCommentOwner {
    // Structural annotations bind to semantic parent paths (for example a list
    // item), while the caret path names a descendant text leaf. Walk the native
    // path prefixes just as CriticMarkupDocument.itemAt does, but distinguish a
    // real hidden comment-content carrier from a visible boundary-only carrier.
    for (let length = position.path.length; length > 0; length--) {
        const path = markdownStatePath(position.path.slice(0, length));
        const comment = document.structuralFragmentsForPath(path).find(
            ({ item, fragment }) => item.syntax.type === 'comment'
                && fragment.kind === 'content'
                && fragment.arm === 'comment',
        );
        if (comment) {
            return {
                hidden: true,
                comment: outermostCommentAncestor(
                    comment.item,
                    id => document.itemById(id),
                ),
            };
        }
    }
    return { hidden: false, comment: null };
}

function visiblePositionInDirection(
    document: CriticMarkupDocument<TMarkdownStatePath>,
    initialComment: ICriticMarkupDocumentItem<TMarkdownStatePath>,
    edge: 'previous' | 'next',
): ICriticMarkupLocalPosition<TMarkdownStatePath> | null {
    const visited = new Set<string>();
    let comment = initialComment;

    while (!visited.has(comment.id)) {
        visited.add(comment.id);
        const boundary = edge === 'previous'
            ? comment.syntax.range.start
            : comment.syntax.range.end;
        const position = document.localPositionAt(sourceOffset(boundary), edge);
        if (!position)
            return null;

        const owner = hiddenStructuralCommentOwner(document, position);
        if (!owner.hidden)
            return position;
        if (!owner.comment || visited.has(owner.comment.id))
            return null;
        comment = owner.comment;
    }

    return null;
}

/**
 * Resolve a collapsed caret to a visible edge of its outermost hidden comment.
 *
 * The result is a document position rather than a same-leaf offset because a
 * CriticMarkup item may span Markdown blocks. All topology and source/local
 * translation comes from the revision-cached parser document; Selection does
 * not infer comment extent from rendered DOM or rescan source text.
 */
export function visibleCriticCommentCaretPosition(
    muya: Muya,
    path: TBlockPath,
    offset: number,
    affinity: THiddenCriticCommentCaretAffinity = 'nearest',
): IVisibleCriticCommentCaretPosition | null {
    const unchanged = { path: [...path], offset };
    if (muya.options.criticMarkupProjection !== 'marked')
        return unchanged;

    const document = muya.editor.criticMarkupDocument.get();
    const statePath = markdownStatePath(path);
    const mappedOffset = localOffset(offset);
    const item = document.itemAt(statePath, mappedOffset);
    if (!item)
        return unchanged;

    const sourcePosition = document.sourceOffsetAt(statePath, mappedOffset)
        ?? document.sourceOffsetAt(statePath, mappedOffset, 'next')
        ?? document.sourceOffsetAt(statePath, mappedOffset, 'previous');
    if (sourcePosition === null)
        return unchanged;

    const comment = outermostContainingComment(
        item,
        sourcePosition,
        id => document.itemById(id),
    );
    if (!comment)
        return unchanged;

    const preferredEdge = affinity === 'previous'
        ? 'previous'
        : affinity === 'next'
            ? 'next'
            : sourcePosition - comment.syntax.range.start
                <= comment.syntax.range.end - sourcePosition
                ? 'previous'
                : 'next';
    const edges: readonly ('previous' | 'next')[] = preferredEdge === 'previous'
        ? ['previous', 'next']
        : ['next', 'previous'];

    for (const edge of edges) {
        // Resolve away from this comment and transitively cross adjacent hidden
        // structural comments. At a document edge the source map can return the
        // same hidden carrier; the visited guard treats that as no owner and the
        // caller tries the opposite outer direction.
        const position = visiblePositionInDirection(document, comment, edge);
        if (!position)
            continue;

        return {
            path: [...position.path],
            offset: position.offset,
        };
    }

    // A document made entirely of structural comment content has no legal
    // visible insertion point. Returning the original hidden endpoint would
    // violate the hard caret invariant; Selection collapses the native caret
    // when it receives null.
    return null;
}
