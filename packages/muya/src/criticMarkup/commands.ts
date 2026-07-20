import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import type { ICriticMarkupAuthoringDraft } from './authoringDraft';
import type {
    CriticMarkupDocument,
} from './document';
import type { IExcludedRange } from './excludedRanges';
import type { IProjectedCriticMarkupSourceSegment } from './project';
import type {
    ICriticMarkupDocumentSnapshot,
    ICriticMarkupEntry,
    ICriticMarkupItem,
} from './commandSnapshot';
import type {
    ICriticMarkupCommandState,
    ICriticMarkupReviewSnapshot,
    ICriticMarkupTarget,
    TCriticMarkupAuthorInput,
    TCriticMarkupAuthorType,
    TCriticMarkupDecision,
    TCriticMarkupFocusTarget,
    TCriticMarkupNavigationDirection,
} from './reviewContract';
import FormatBlock from '../block/base/format';
import {
    localOffset,
    localRange,
    sourceOffset as mappedSourceOffset,
} from '../mappedText';
import {
    SelectionCaretType,
    SelectionDirection,
} from '../selection/types';
import { markdownStatePath } from '../state/markdownSourceMap';
import {
    criticMarkupAuthoringDraft,
} from './authoringDraft';
import {
    criticMarkupCommentedSpanFor,
    criticMarkupEntryForTarget,
    createCriticMarkupDocumentSnapshot,
} from './commandSnapshot';
import { planCriticMarkupCommentEdit } from './commentEditing';
import { criticMarkupItemsFromDomTarget } from './domIdentity';
import { ExcludedRanges } from './excludedRanges';
import {
    decodeCriticMarkupPayloadEscapes,
} from './parser';
import { nestedPointCommentSource } from './pointComments';
import { projectedCriticMarkupSourceSegments } from './project';
import { createCriticMarkupReviewSnapshot } from './reviewSnapshot';

export type {
    ICriticMarkupCommandState,
    ICriticMarkupTarget,
    TCriticMarkupAuthorInput,
    TCriticMarkupAuthorType,
    TCriticMarkupFocusTarget,
    TCriticMarkupNavigationDirection,
} from './reviewContract';
export type { ICriticMarkupItem } from './commandSnapshot';

interface ILeafAuthoringContext {
    kind: 'leaf';
    block: Format;
    start: number;
    end: number;
    selection: IHistorySelection;
    nestedItems: ExcludedRanges;
}

interface IDocumentAuthoringContext {
    kind: 'document';
    start: number;
    end: number;
    selection: IHistorySelection;
    source: string;
    nestedItems: ExcludedRanges;
}

type IAuthoringContext = ILeafAuthoringContext | IDocumentAuthoringContext;

/** Collapse a whole-line junction left by an erased review item. */
function collapseErasedJunction(
    markdown: string,
    junction: number,
): string {
    let leading = 0;
    while (junction - leading > 0 && markdown[junction - leading - 1] === '\n')
        leading++;
    let trailing = 0;
    while (
        junction + trailing < markdown.length
        && markdown[junction + trailing] === '\n'
    ) {
        trailing++;
    }
    const atLineStart = junction - leading === 0 || leading > 0;
    const atLineEnd = junction + trailing === markdown.length || trailing > 0;
    if (!atLineStart || !atLineEnd)
        return markdown;
    if (junction - leading === 0) {
        return junction + trailing === markdown.length
            ? (markdown.length ? '\n' : markdown)
            : markdown.slice(junction + trailing);
    }
    if (junction + trailing === markdown.length)
        return `${markdown.slice(0, junction - leading)}\n`;
    return markdown.slice(0, junction - leading) + markdown.slice(junction);
}

/** Decode one retained projection segment without touching excluded bytes. */
function materializedProjectedSegment(
    source: string,
    segment: IProjectedCriticMarkupSourceSegment,
    excludedRanges: readonly Readonly<IExcludedRange>[],
): string {
    const { range, owner } = segment;
    if (!owner)
        return source.slice(range.start, range.end);

    const parts: string[] = [];
    let cursor = range.start;
    for (const opaque of excludedRanges) {
        if (opaque.end <= cursor)
            continue;
        if (range.end <= opaque.start)
            break;
        if (cursor < opaque.start) {
            parts.push(decodeCriticMarkupPayloadEscapes(
                owner,
                source.slice(cursor, opaque.start),
            ));
        }
        const opaqueStart = Math.max(cursor, opaque.start);
        cursor = Math.min(range.end, opaque.end);
        parts.push(source.slice(opaqueStart, cursor));
        if (range.end <= cursor)
            break;
    }
    if (cursor < range.end) {
        parts.push(decodeCriticMarkupPayloadEscapes(
            owner,
            source.slice(cursor, range.end),
        ));
    }

    return parts.join('');
}

export class MuyaCriticMarkup {
    /**
     * Review navigation has its own revision-scoped cursor. Some canonical
     * items (currently CriticMarkup inside an image alternative) render as an
     * HTML attribute and therefore cannot own a browser text selection. The
     * document identity prevents this cursor from leaking across revisions.
     */
    private _navigationCursor: {
        model: CriticMarkupDocument;
        itemId: string;
    } | null = null;

    constructor(private readonly _muya: Muya) {
        const publish = () => {
            this._navigationCursor = null;
            this.publishReviewSnapshot();
        };
        _muya.eventCenter.on('selection-change', publish);
        _muya.eventCenter.on('json-change', publish);
    }

    publishReviewSnapshot(): void {
        this._muya.eventCenter.emit(
            'critic-markup-review-change',
            this.getReviewSnapshot(),
        );
    }

    private _selectionSnapshot(): IHistorySelection | null {
        // Original/revised views are reparsed projections. Their block paths
        // and offsets do not identify positions in the canonical Markdown, so
        // even a browser-created selection inside the read-only DOM must not
        // drive authoring or current-item resolution.
        if (this._muya.options.criticMarkupProjection !== 'marked')
            return null;

        const live = this._muya.editor.selection.getSelection();
        if (
            live
            && live.anchor.block.outMostBlock
            && live.focus.block.outMostBlock
        ) {
            return live;
        }

        const selection = this._muya.editor.selection;
        const { anchor, focus, anchorBlock, focusBlock } = selection;
        if (!anchor || !focus || !anchorBlock || !focusBlock)
            return null;
        if (!anchorBlock.outMostBlock || !focusBlock.outMostBlock)
            return null;

        const isSelectionInSameBlock = anchorBlock === focusBlock;
        const isCollapsed
            = isSelectionInSameBlock && anchor.offset === focus.offset;
        let direction = SelectionDirection.NONE;
        if (!isCollapsed && isSelectionInSameBlock) {
            direction = anchor.offset <= focus.offset
                ? SelectionDirection.FORWARD
                : SelectionDirection.BACKWARD;
        }

        return {
            anchor: {
                offset: anchor.offset,
                block: anchorBlock,
                path: anchorBlock.path,
            },
            focus: {
                offset: focus.offset,
                block: focusBlock,
                path: focusBlock.path,
            },
            isCollapsed,
            isSelectionInSameBlock,
            direction,
            type: isCollapsed
                ? SelectionCaretType.CARET
                : SelectionCaretType.RANGE,
        };
    }

    private _authoringContext(
        type: TCriticMarkupAuthorType,
    ): IAuthoringContext | null {
        const selection = this._selectionSnapshot();
        if (
            !selection
            || !(selection.anchor.block instanceof FormatBlock)
            || !(selection.focus.block instanceof FormatBlock)
        ) {
            return null;
        }

        const model = this._muya.editor.criticMarkupDocument.getContext();
        const sourceRange = model.authoringRange(
            {
                path: markdownStatePath(selection.anchor.path),
                offset: selection.anchor.offset,
            },
            {
                path: markdownStatePath(selection.focus.path),
                offset: selection.focus.offset,
            },
            { allowNestedItems: type === 'comment' },
        );
        if (!sourceRange)
            return null;
        const nestedItems = ExcludedRanges.from(
            sourceRange.end - sourceRange.start,
            type === 'comment'
                ? model.itemsContainedBySourceRange(sourceRange).map(item => ({
                        start: item.syntax.range.start - sourceRange.start,
                        end: item.syntax.range.end - sourceRange.start,
                    }))
                : [],
        );

        if (
            !selection.isSelectionInSameBlock
            || selection.anchor.block !== selection.focus.block
        ) {
            if (sourceRange.start === sourceRange.end)
                return null;

            return {
                kind: 'document',
                start: sourceRange.start,
                end: sourceRange.end,
                selection,
                source: model.markdown,
                nestedItems,
            };
        }

        const block = selection.anchor.block;
        const start = Math.min(
            selection.anchor.offset,
            selection.focus.offset,
        );
        const end = Math.max(
            selection.anchor.offset,
            selection.focus.offset,
        );
        if (
            start !== end
            && type !== 'addition'
            && type !== 'deletion'
            && type !== 'substitution'
            && type !== 'highlight'
            && type !== 'comment'
        ) {
            return null;
        }
        // Only an addition can start at a collapsed caret. A comment must have
        // a selection so every app-made comment has a highlighted anchor; the
        // bare `{>>note<<}` form still renders and round-trips, but is not
        // authored here.
        if (start === end && type !== 'addition') {
            return null;
        }

        // A single visual leaf can still span non-leaf Markdown bytes such as
        // the generated `> ` prefix on every line of a blockquote. In that
        // case the parser-owned nested/excluded ranges above are source-local,
        // not leaf-local. Route the mutation through the canonical document
        // slice so the draft payload and every range share one coordinate
        // domain; leaf editing is safe only when both selected byte strings
        // are exactly identical.
        if (
            block.text.slice(start, end)
            !== model.markdown.slice(sourceRange.start, sourceRange.end)
        ) {
            return {
                kind: 'document',
                start: sourceRange.start,
                end: sourceRange.end,
                selection,
                source: model.markdown,
                nestedItems,
            };
        }

        return { kind: 'leaf', block, start, end, selection, nestedItems };
    }

    canCreate(type: TCriticMarkupAuthorType): boolean {
        if (this._muya.options.criticMarkupProjection !== 'marked')
            return false;

        return this._authoringContext(type) !== null;
    }

    private _stableAuthoringContext(
        type: TCriticMarkupAuthorType,
    ): IAuthoringContext | null {
        let context = this._authoringContext(type);
        if (!context)
            return null;
        if (context.kind === 'document') {
            this._muya.flush();
            context = this._authoringContext(type);
            if (!context || context.kind !== 'document')
                return null;
        }

        return context;
    }

    private _applyLeafAuthoring(
        context: ILeafAuthoringContext,
        draft: ICriticMarkupAuthoringDraft,
    ): boolean {
        const { block, selection, start, end } = context;
        const nextText = block.text.slice(0, start)
            + draft.text
            + block.text.slice(end);

        this._muya.editor.history.runTransaction(selection, () => {
            block.text = nextText;
            block.setCursor(
                start + draft.selectionStart,
                start + draft.selectionEnd,
                true,
            );
        });

        return true;
    }

    private _applyDocumentAuthoring(
        context: IDocumentAuthoringContext,
        draft: ICriticMarkupAuthoringDraft,
    ): boolean {
        const { selection, source, start, end } = context;
        const nextMarkdown = source.slice(0, start)
            + draft.text
            + source.slice(end);
        if (!this._muya.replaceContent(nextMarkdown, selection))
            return false;

        const model = this._muya.editor.criticMarkupDocument.get();
        const anchor = model.localPositionAt(
            mappedSourceOffset(start + draft.selectionStart),
        );
        const focus = model.localPositionAt(
            mappedSourceOffset(start + draft.selectionEnd),
        );
        if (!anchor || !focus)
            return true;

        const anchorBlock = this._muya.editor.scrollPage?.queryBlock([
            ...anchor.path,
        ]);
        const focusBlock = this._muya.editor.scrollPage?.queryBlock([
            ...focus.path,
        ]);
        if (
            anchorBlock instanceof FormatBlock
            && focusBlock instanceof FormatBlock
        ) {
            this._muya.editor.selection.setSelection(
                {
                    offset: anchor.offset,
                    block: anchorBlock,
                    path: anchorBlock.path,
                },
                {
                    offset: focus.offset,
                    block: focusBlock,
                    path: focusBlock.path,
                },
            );
        }

        return true;
    }

    create(input: TCriticMarkupAuthorInput): boolean {
        const context = this._stableAuthoringContext(input.type);
        if (!context || (input.type === 'comment' && !input.comment))
            return false;

        const { start, end } = context;
        const selected = context.kind === 'leaf'
            ? context.block.text.slice(start, end)
            : context.source.slice(start, end);
        const draft = criticMarkupAuthoringDraft(
            input,
            selected,
            context.nestedItems,
        );

        return context.kind === 'leaf'
            ? this._applyLeafAuthoring(context, draft)
            : this._applyDocumentAuthoring(context, draft);
    }

    private _documentSnapshot(): ICriticMarkupDocumentSnapshot {
        const model = this._muya.editor.criticMarkupDocument.get();
        return createCriticMarkupDocumentSnapshot(model);
    }

    getItems(): ICriticMarkupItem[] {
        return this._documentSnapshot().entries.map(({ item }) => item);
    }

    private _commandState(
        snapshot: ICriticMarkupDocumentSnapshot,
        current: ICriticMarkupEntry | null = this._currentEntry(snapshot),
    ): ICriticMarkupCommandState {
        return {
            canCreateAddition: this.canCreate('addition'),
            canCreateDeletion: this.canCreate('deletion'),
            canCreateSubstitution: this.canCreate('substitution'),
            canCreateHighlight: this.canCreate('highlight'),
            canCreateComment: this.canCreate('comment'),
            canResolveCurrent: current !== null,
            canResolveAll: snapshot.entries.length > 0,
            trackChanges: this._muya.options.criticMarkupTrackChanges,
            projection: this._muya.options.criticMarkupProjection,
        };
    }

    getCommandState(): ICriticMarkupCommandState {
        return this._commandState(this._documentSnapshot());
    }

    getReviewSnapshot(): ICriticMarkupReviewSnapshot {
        const snapshot = this._documentSnapshot();
        const current = this._currentEntry(snapshot);

        return createCriticMarkupReviewSnapshot(
            snapshot.entries.map(({ item }) => item),
            current?.item ?? null,
            this._commandState(snapshot, current),
        );
    }

    commentAtPoint(
        clientX: number,
        clientY: number,
    ): ICriticMarkupReviewSnapshot['items'][number] | null {
        if (this._muya.options.criticMarkupProjection !== 'marked')
            return null;

        const target = this._muya.domNode.ownerDocument.elementFromPoint(
            clientX,
            clientY,
        );
        if (!target || !this._muya.domNode.contains(target))
            return null;

        const identities = criticMarkupItemsFromDomTarget(
            this._muya.editor.criticMarkupDocument.get(),
            this._muya.domNode,
            target,
        );
        if (!identities.length)
            return null;

        const comments = this.getReviewSnapshot().items.filter(
            item => item.type === 'comment',
        );
        for (const identity of identities) {
            const comment = comments.find(item =>
                item.id === identity.id || item.anchorId === identity.id);
            if (comment)
                return comment;
        }
        return null;
    }

    private _currentEntry(
        snapshot: ICriticMarkupDocumentSnapshot,
    ): ICriticMarkupEntry | null {
        if (this._navigationCursor?.model === snapshot.model) {
            const explicit = snapshot.entryById.get(
                this._navigationCursor.itemId,
            );
            if (!explicit) {
                throw new TypeError(
                    'Explicit CriticMarkup focus is stale for its document revision.',
                );
            }
            return explicit;
        }
        const selection = this._selectionSnapshot();
        if (
            !selection
            || !selection.isSelectionInSameBlock
            || selection.anchor.block !== selection.focus.block
            || !(selection.anchor.block instanceof FormatBlock)
        ) {
            return null;
        }

        const block = selection.anchor.block;
        const start = Math.min(
            selection.anchor.offset,
            selection.focus.offset,
        );
        const end = Math.max(
            selection.anchor.offset,
            selection.focus.offset,
        );
        const documentItem = snapshot.model.itemContaining(
            markdownStatePath(block.path),
            localRange(start, end),
        );

        return documentItem
            ? snapshot.entryById.get(documentItem.id) ?? null
            : null;
    }

    getCurrentItem(): ICriticMarkupItem | null {
        return this._currentEntry(this._documentSnapshot())?.item ?? null;
    }

    private _focusEntry(
        snapshot: ICriticMarkupDocumentSnapshot,
        entry: ICriticMarkupEntry,
    ): ICriticMarkupItem | null {
        const { syntax } = entry.documentItem;
        const sourceOffset = syntax.type === 'substitution'
            ? syntax.oldRange.start
            : syntax.contentRange.start;
        const position = snapshot.model.localPositionAt(mappedSourceOffset(sourceOffset))
            ?? (entry.documentItem.fragments[0]
                ? {
                        path: entry.documentItem.fragments[0].path,
                        offset:
                            entry.documentItem.fragments[0].localRange.start,
                    }
                : null)
            ?? this._structuralFocusPosition(entry);
        if (!position)
            return null;

        const block = this._muya.editor.scrollPage?.queryBlock([
            ...position.path,
        ]);
        if (!(block instanceof FormatBlock))
            return null;

        block.setCursor(position.offset, position.offset, true);
        const selector = `[data-critic-id~="${entry.item.id}"]`;
        const reference = block.domNode?.matches(selector)
            ? block.domNode
            : block.domNode?.querySelector<HTMLElement>(selector)
                ?? block.domNode?.closest<HTMLElement>(selector)
                ?? block.domNode;
        const isCommentFocus = entry.item.type === 'comment'
            || criticMarkupCommentedSpanFor(snapshot, entry) !== null;
        if (reference && !isCommentFocus) {
            this._muya.eventCenter.emit('muya-critic-markup-tool', {
                item: entry.item,
                reference,
            });
        }
        this._navigationCursor = {
            model: snapshot.model,
            itemId: entry.item.id,
        };
        return entry.item;
    }

    /**
     * A structural item has no inline fragment to place a cursor in; focus
     * lands at the start of its native carrier's first content leaf.
     */
    private _structuralFocusPosition(
        entry: ICriticMarkupEntry,
    ): { path: TMarkdownStatePath; offset: number } | null {
        const carrierPath = entry.documentItem.structuralFragments[0]?.path;
        if (!carrierPath)
            return null;
        const carrier = this._muya.editor.scrollPage?.queryBlock([
            ...carrierPath,
        ]);
        const content = carrier && 'firstContentInDescendant' in carrier
            ? carrier.firstContentInDescendant()
            : carrier;
        if (!content)
            return null;
        return {
            path: markdownStatePath(content.path),
            offset: 0,
        };
    }

    focus(target: TCriticMarkupFocusTarget): ICriticMarkupItem | null {
        // Clean projections have reparsed block paths. Only the marked view
        // can safely position a selection in the canonical Markdown tree.
        if (this._muya.options.criticMarkupProjection !== 'marked')
            return null;

        const snapshot = this._documentSnapshot();
        const entry = criticMarkupEntryForTarget(snapshot, target);
        return entry ? this._focusEntry(snapshot, entry) : null;
    }

    private _navigationEntry(
        snapshot: ICriticMarkupDocumentSnapshot,
    ): ICriticMarkupEntry | null {
        const selected = this._currentEntry(snapshot);
        if (selected)
            return selected;
        if (this._navigationCursor?.model !== snapshot.model)
            return null;

        return snapshot.entryById.get(this._navigationCursor.itemId) ?? null;
    }

    private _selectionNavigationIndex(
        snapshot: ICriticMarkupDocumentSnapshot,
        entries: readonly ICriticMarkupEntry[],
        direction: TCriticMarkupNavigationDirection,
    ): number {
        const { model } = snapshot;
        const selection = this._selectionSnapshot();
        const endpoint = direction === 'next'
            ? selection?.focus
            : selection?.anchor;
        const sourceOffset = endpoint?.block
            ? model.sourceOffsetAt(
                    markdownStatePath(endpoint.block.path),
                    localOffset(endpoint.offset),
                )
            : null;
        if (sourceOffset === null)
            return direction === 'next' ? 0 : entries.length - 1;
        if (direction === 'next') {
            const next = entries.findIndex(({ item }) =>
                item.sourceStart > sourceOffset);
            return next === -1 ? 0 : next;
        }

        for (let index = entries.length - 1; index >= 0; index--) {
            if (entries[index].item.sourceEnd <= sourceOffset)
                return index;
        }
        return entries.length - 1;
    }

    navigate(
        direction: TCriticMarkupNavigationDirection,
    ): ICriticMarkupItem | null {
        // Navigation currently positions the canonical document selection.
        // Clean projections need an explicit provenance map before their
        // reparsed paths can support that operation safely.
        if (this._muya.options.criticMarkupProjection !== 'marked')
            return null;

        const snapshot = this._documentSnapshot();
        const entries = snapshot.entries.filter(entry =>
            !snapshot.model.commentForAnchor(entry.documentItem.id));
        if (!entries.length)
            return null;

        const rawCurrent = this._navigationEntry(snapshot);
        const currentDocumentItem = rawCurrent
            ? snapshot.model.commentForAnchor(rawCurrent.documentItem.id)
            ?? rawCurrent.documentItem
            : null;
        const current = currentDocumentItem
            ? snapshot.entryById.get(currentDocumentItem.id) ?? null
            : null;
        let targetIndex = this._selectionNavigationIndex(
            snapshot,
            entries,
            direction,
        );
        if (current) {
            const delta = direction === 'next' ? 1 : -1;
            targetIndex = (
                entries.indexOf(current) + delta + entries.length
            ) % entries.length;
        }

        return this._focusEntry(snapshot, entries[targetIndex]);
    }

    private _emptiedCommentAnchorFor(
        snapshot: ICriticMarkupDocumentSnapshot,
        entry: ICriticMarkupEntry,
        replacement: string,
    ): ICriticMarkupEntry | null {
        if (replacement)
            return null;
        const parentId = entry.documentItem.parentId;
        const parent = parentId === null
            ? null
            : snapshot.entryById.get(parentId) ?? null;
        if (
            parent?.documentItem.syntax.type !== 'highlight'
            || entry.documentItem.syntax.range.start
                !== parent.documentItem.syntax.contentRange.start
            || entry.documentItem.syntax.range.end
                !== parent.documentItem.syntax.contentRange.end
        ) {
            return null;
        }
        return criticMarkupCommentedSpanFor(snapshot, parent)?.highlight ?? null;
    }

    private _pointCommentReplacement(
        snapshot: ICriticMarkupDocumentSnapshot,
        emptiedAnchor: ICriticMarkupEntry,
        entry: ICriticMarkupEntry,
    ): string {
        const anchorSyntax = emptiedAnchor.documentItem.syntax;
        const precedingHighlight = snapshot.model.childrenOf(
            emptiedAnchor.documentItem.parentId,
        ).some(candidate =>
            candidate.id !== emptiedAnchor.documentItem.id
            && candidate.syntax.type === 'highlight'
            && candidate.syntax.range.end === anchorSyntax.range.start);
        const boundary = precedingHighlight
            && anchorSyntax.type === 'highlight'
            ? snapshot.model.markdown.slice(
                    anchorSyntax.range.start,
                    anchorSyntax.contentRange.start,
                )
                + snapshot.model.markdown.slice(
                    anchorSyntax.contentRange.end,
                    anchorSyntax.range.end,
                )
            : '';
        return boundary + nestedPointCommentSource(entry.documentItem.syntax);
    }

    resolve(
        decision: TCriticMarkupDecision,
        target: ICriticMarkupTarget | undefined,
    ): boolean {
        // A review resolution is a new history boundary. Land any same-frame
        // typing first so the source map and replacement op share one state.
        this._muya.flush();
        const snapshot = this._documentSnapshot();
        const entry = target
            ? criticMarkupEntryForTarget(snapshot, target)
            : this._currentEntry(snapshot);
        if (!entry)
            return false;

        // A comment and its anchor highlight are one commented span: resolving
        // either half resolves both in the same splice, so the pair is never
        // stranded. The highlight always precedes the comment in source.
        const span = criticMarkupCommentedSpanFor(snapshot, entry);
        const entryReplacement = snapshot.model.resolveItem(
            entry.documentItem.id,
            decision,
        );
        const emptiedAnchor = span
            ? null
            : this._emptiedCommentAnchorFor(
                    snapshot,
                    entry,
                    entryReplacement,
                );
        const removalStart = span
            ? span.highlight.documentItem.syntax.range.start
            : emptiedAnchor
                ? emptiedAnchor.documentItem.syntax.range.start
            : entry.documentItem.syntax.range.start;
        const removalEnd = span
            ? span.comment.documentItem.syntax.range.end
            : emptiedAnchor
                ? emptiedAnchor.documentItem.syntax.range.end
            : entry.documentItem.syntax.range.end;
        const replacement = span
            ? snapshot.model.resolveItem(span.highlight.documentItem.id, decision)
            + snapshot.model.resolveItem(span.comment.documentItem.id, decision)
            : emptiedAnchor
                ? this._pointCommentReplacement(
                        snapshot,
                        emptiedAnchor,
                        entry,
                    )
                : entryReplacement;
        let nextMarkdown
            = snapshot.model.markdown.slice(0, removalStart)
                + replacement
                + snapshot.model.markdown.slice(removalEnd);
        if (!/\S/.test(replacement)) {
            nextMarkdown = collapseErasedJunction(
                nextMarkdown,
                removalStart + replacement.length,
            );
        }
        const selection = this._selectionSnapshot();
        if (!this._muya.replaceContent(nextMarkdown, selection))
            return false;

        const nextSnapshot = this._documentSnapshot();
        const cursor = nextSnapshot.model.localPositionAt(
            mappedSourceOffset(removalStart + replacement.length),
        );
        if (cursor) {
            const block = this._muya.editor.scrollPage?.queryBlock([
                ...cursor.path,
            ]);
            if (block instanceof FormatBlock)
                block.setCursor(cursor.offset, cursor.offset, true);
        }

        return true;
    }

    // Rewrite a comment's body in place: the `{>>…<<}` content is replaced,
    // the anchor and the comment's position are untouched. Refuses a
    // non-comment target or an empty body (a comment always carries text).
    editComment(target: ICriticMarkupTarget, text: string): boolean {
        const content = text;
        if (!content.trim())
            return false;

        this._muya.flush();
        const snapshot = this._documentSnapshot();
        const entry = criticMarkupEntryForTarget(snapshot, target);
        if (!entry || entry.documentItem.syntax.type !== 'comment')
            return false;

        const { syntax } = entry.documentItem;
        const plan = planCriticMarkupCommentEdit(
            snapshot.model.analysis.source,
            syntax,
            snapshot.model.excludedRanges,
            content,
        );
        if (plan.outcome === 'unchanged')
            return true;
        if (plan.outcome === 'rejected')
            return false;
        const nextMarkdown
            = snapshot.model.markdown.slice(0, syntax.range.start)
                + plan.replacement
                + snapshot.model.markdown.slice(syntax.range.end);
        const selection = this._selectionSnapshot();
        return this._muya.replaceContent(nextMarkdown, selection);
    }

    resolveAll(decision: TCriticMarkupDecision): number {
        this._muya.flush();
        const snapshot = this._documentSnapshot();
        const count = snapshot.entries.length;
        if (!count)
            return 0;

        const selection = this._selectionSnapshot();
        const projection = decision === 'accept' ? 'revised' : 'original';
        // One full-document projection resolves nested items with their
        // parents (never regress to per-root splicing). Segments never cross
        // a root's source range, so containment identifies each root's
        // retained bytes and its junction — the projected offset right after
        // them, or where the root would have appeared when it retained none.
        const source = snapshot.model.markdown;
        const segments = projectedCriticMarkupSourceSegments(
            source.length,
            projection,
            snapshot.model.roots,
        );
        const excludedRanges = snapshot.model.excludedRanges.ranges;
        const rootBounds = snapshot.model.roots.map(root => ({
            range: root.range,
            junction: -1,
            content: false,
        }));
        const parts: string[] = [];
        let offset = 0;
        let rootIndex = 0;
        for (const segment of segments) {
            while (
                rootIndex < rootBounds.length
                && rootBounds[rootIndex].range.end <= segment.range.start
            ) {
                if (rootBounds[rootIndex].junction < 0)
                    rootBounds[rootIndex].junction = offset;
                rootIndex++;
            }
            const text = materializedProjectedSegment(
                source,
                segment,
                excludedRanges,
            );
            parts.push(text);
            const current = rootBounds[rootIndex];
            if (
                current
                && segment.range.start >= current.range.start
                && segment.range.end <= current.range.end
            ) {
                current.junction = offset + text.length;
                if (/\S/.test(text))
                    current.content = true;
            }
            offset += text.length;
        }
        for (; rootIndex < rootBounds.length; rootIndex++) {
            if (rootBounds[rootIndex].junction < 0)
                rootBounds[rootIndex].junction = offset;
        }
        let nextMarkdown = parts.join('');
        // Collapse in descending junction order so offsets that earlier
        // collapses have not passed remain valid.
        const erased = rootBounds
            .filter(bounds => !bounds.content)
            .sort((left, right) => right.junction - left.junction);
        for (const bounds of erased) {
            nextMarkdown = collapseErasedJunction(
                nextMarkdown,
                bounds.junction,
            );
        }
        if (!this._muya.replaceContent(nextMarkdown, selection)) {
            throw new TypeError(
                'CriticMarkup bulk projection produced no document change.',
            );
        }

        return count;
    }
}
