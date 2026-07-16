import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentFragment,
    ICriticMarkupDocumentItem,
    TCriticMarkupDocumentToken,
} from './document';
import type { IExcludedRange } from './excludedRanges';
import type { IProjectedCriticMarkupSourceSegment } from './project';
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
import { mappedPathsEqual } from '../mapped-range';
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
    decodeCriticMarkupPayloadEscapes,
    parseCriticMarkupAt,
} from './parser';
import { projectedCriticMarkupSourceSegments } from './project';
import { createCriticMarkupReviewSnapshot } from './reviewSnapshot';
import { createCriticMarkup } from './transform';

export type {
    ICriticMarkupCommandState,
    ICriticMarkupTarget,
    TCriticMarkupAuthorInput,
    TCriticMarkupAuthorType,
    TCriticMarkupFocusTarget,
    TCriticMarkupNavigationDirection,
} from './reviewContract';

export interface ICriticMarkupItem extends ICriticMarkupTarget {
    id: string;
    sourceStart: number;
    sourceEnd: number;
    type: TCriticMarkupDocumentToken['type'];
    fragments: readonly ICriticMarkupDocumentFragment[];
    content?: string;
    oldContent?: string;
    newContent?: string;
}

interface ILeafAuthoringContext {
    kind: 'leaf';
    block: Format;
    start: number;
    end: number;
    selection: IHistorySelection;
}

interface IDocumentAuthoringContext {
    kind: 'document';
    start: number;
    end: number;
    selection: IHistorySelection;
    source: string;
}

type IAuthoringContext = ILeafAuthoringContext | IDocumentAuthoringContext;

interface ICriticMarkupEntry {
    documentItem: ICriticMarkupDocumentItem;
    item: ICriticMarkupItem;
}

interface ICriticMarkupDocumentSnapshot {
    model: CriticMarkupDocument;
    entries: ICriticMarkupEntry[];
}

interface ICriticMarkupAuthoringDraft {
    text: string;
    selectionStart: number;
    selectionEnd: number;
}

function itemFromDocumentItem(
    documentItem: ICriticMarkupDocumentItem,
): ICriticMarkupItem {
    const { syntax: critic } = documentItem;
    const firstFragment = documentItem.fragments[0];
    const common = {
        id: documentItem.id,
        type: critic.type,
        path: firstFragment ? [...firstFragment.path] : [],
        start: firstFragment?.localRange.start ?? critic.range.start,
        end: firstFragment?.localRange.end ?? critic.range.end,
        sourceStart: critic.range.start,
        sourceEnd: critic.range.end,
        raw: critic.raw,
        fragments: documentItem.fragments,
    };

    return critic.type === 'substitution'
        ? {
                ...common,
                oldContent: critic.oldContent,
                newContent: critic.newContent,
            }
        : { ...common, content: critic.content };
}

function criticMarkupAuthoringDraft(
    input: TCriticMarkupAuthorInput,
    selected: string,
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
    if (input.type === 'comment' && !selected) {
        return { text, selectionStart: text.length, selectionEnd: text.length };
    }
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

/**
 * Canonical junction spelling after a resolution erased a whole-line item.
 * The junction must touch a line boundary on both sides — an inline erasure
 * never changes surrounding bytes. A qualifying junction collapses the
 * blank-line gap the erasure left behind:
 *
 * - mid-document, the leading newline run is removed so the erased block's
 *   own terminator run re-supplies the separation to its surviving neighbor;
 * - when the trailing run reaches EOF, the document ends with exactly one
 *   final newline;
 * - when the leading run reaches BOF, the whole run collapses so the next
 *   block starts the document; erasing the whole document leaves exactly
 *   one newline.
 */
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

/**
 * Materialize one projected source segment exactly as the document
 * projection does: payload bytes decode their protective escapes while
 * parser-excluded slices stay byte-for-byte opaque.
 */
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
        const clearExplicitFocus = () => {
            this._navigationCursor = null;
        };
        _muya.eventCenter.on('selection-change', clearExplicitFocus);
        _muya.eventCenter.on('json-change', clearExplicitFocus);
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
        );
        if (!sourceRange)
            return null;

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
        if (
            start === end
            && type !== 'addition'
            && type !== 'comment'
        ) {
            return null;
        }

        return { kind: 'leaf', block, start, end, selection };
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
        const draft = criticMarkupAuthoringDraft(input, selected);

        return context.kind === 'leaf'
            ? this._applyLeafAuthoring(context, draft)
            : this._applyDocumentAuthoring(context, draft);
    }

    private _documentSnapshot(): ICriticMarkupDocumentSnapshot {
        const model = this._muya.editor.criticMarkupDocument.get();
        const entries = model.items.map(documentItem => ({
            documentItem,
            item: itemFromDocumentItem(documentItem),
        }));

        return { model, entries };
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

    private _entryForTarget(
        snapshot: ICriticMarkupDocumentSnapshot,
        target: TCriticMarkupFocusTarget,
    ): ICriticMarkupEntry | null {
        if (typeof target === 'string') {
            const documentItem = snapshot.model.itemById(target);
            return documentItem
                ? snapshot.entries.find(entry =>
                    entry.documentItem === documentItem) ?? null
                : null;
        }

        if (
            target.sourceStart !== undefined
            && target.sourceEnd !== undefined
        ) {
            return snapshot.entries.find(({ item }) =>
                item.sourceStart === target.sourceStart
                && item.sourceEnd === target.sourceEnd
                && item.raw === target.raw) ?? null;
        }

        return snapshot.entries.find(({ item }) =>
            mappedPathsEqual(item.path, target.path)
            && item.start === target.start
            && item.end === target.end
            && item.raw === target.raw) ?? null;
    }

    private _currentEntry(
        snapshot: ICriticMarkupDocumentSnapshot,
    ): ICriticMarkupEntry | null {
        if (this._navigationCursor?.model === snapshot.model) {
            const explicit = snapshot.entries.find(entry =>
                entry.item.id === this._navigationCursor?.itemId);
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
            ? snapshot.entries.find(entry =>
                entry.documentItem.id === documentItem.id) ?? null
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
        if (reference) {
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
        const entry = this._entryForTarget(snapshot, target);
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

        return snapshot.entries.find(entry =>
            entry.item.id === this._navigationCursor?.itemId) ?? null;
    }

    private _selectionNavigationIndex(
        snapshot: ICriticMarkupDocumentSnapshot,
        direction: TCriticMarkupNavigationDirection,
    ): number {
        const { entries, model } = snapshot;
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
        const { entries } = snapshot;
        if (!entries.length)
            return null;

        const current = this._navigationEntry(snapshot);
        let targetIndex = this._selectionNavigationIndex(
            snapshot,
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

    resolve(
        decision: TCriticMarkupDecision,
        target: ICriticMarkupTarget | undefined,
    ): boolean {
        // A review resolution is a new history boundary. Land any same-frame
        // typing first so the source map and replacement op share one state.
        this._muya.flush();
        const snapshot = this._documentSnapshot();
        const entry = target
            ? this._entryForTarget(snapshot, target)
            : this._currentEntry(snapshot);
        if (!entry)
            return false;

        const { syntax } = entry.documentItem;
        const replacement = snapshot.model.resolveItem(
            entry.documentItem.id,
            decision,
        );
        let nextMarkdown
            = snapshot.model.markdown.slice(0, syntax.range.start)
                + replacement
                + snapshot.model.markdown.slice(syntax.range.end);
        if (!/\S/.test(replacement)) {
            nextMarkdown = collapseErasedJunction(
                nextMarkdown,
                syntax.range.start + replacement.length,
            );
        }
        const selection = this._selectionSnapshot();
        if (!this._muya.replaceContent(nextMarkdown, selection))
            return false;

        const nextSnapshot = this._documentSnapshot();
        const cursor = nextSnapshot.model.localPositionAt(
            mappedSourceOffset(syntax.range.start + replacement.length),
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
