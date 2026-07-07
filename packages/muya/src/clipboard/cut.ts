import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type TreeNode from '../block/base/treeNode';
import type Table from '../block/gfm/table';
import type TableBodyCell from '../block/gfm/table/cell';
import type { Nullable } from '../types';
import type Clipboard from './index';
import Format from '../block/base/format';
import { ScrollPage } from '../block/scrollPage';
import {
    commentMarkerKindsInText,
    commentMarkerKindsInTexts,
    orphansCounterpart,
    realCommentMarkersInText,
} from '../comments/markerScan';
import { isUnsafeCommentMarkerTextEdit, scanEditedCommentMarkers } from '../comments/source';
import {
    NON_COMMENT_SCANNABLE_LEAF_BLOCKS,
    parseCommentMetadataDefinition,
} from '../comments/syntax';
import { CLASS_NAMES } from '../config';
import { SelectionDirection, SelectionType } from '../selection/types';
import { getBlock } from '../utils/dom';

/**
 * Whole-document selection predicate: the selection spans from the very first
 * content leaf at offset 0 to the very last content leaf at its end.
 */
function isSelectAll(
    clipboard: Clipboard,
    startBlock: Content,
    startOffset: number,
    endBlock: Content,
    endOffset: number,
): boolean {
    const firstContent = clipboard.scrollPage?.firstContentInDescendant();
    const lastContent = clipboard.scrollPage?.lastContentInDescendant();

    return (
        firstContent === startBlock
        && startOffset === 0
        && lastContent === endBlock
        && endOffset === endBlock.text.length
    );
}

/**
 * Replace the whole document with a single empty paragraph and seat the
 * caret in it.
 */
function resetToEmptyParagraph(clipboard: Clipboard): void {
    const { scrollPage } = clipboard;
    if (scrollPage == null)
        return;

    scrollPage.forEach((child) => {
        (child as Parent).remove();
    });

    const newParagraphBlock = ScrollPage.loadBlock('paragraph').create(
        clipboard.muya,
        { name: 'paragraph', text: '' },
    );
    scrollPage.append(newParagraphBlock, 'user');

    const cursorBlock = newParagraphBlock.firstContentInDescendant();
    cursorBlock?.setCursor(0, 0, true);
}

// Seat the caret and re-evaluate the block's type from its new text — a cut can
// add or remove a block-leading marker (`# `, `- `, …).
function setCursorAndConvert(block: Content, offset: number): void {
    block.setCursor(offset, offset, true);
    if (block instanceof Format)
        block.checkInlineUpdate();
}

// Collapse the document to a single empty paragraph once a cut empties it.
function resetIfEmpty(clipboard: Clipboard): void {
    if (clipboard.scrollPage?.length() === 0)
        resetToEmptyParagraph(clipboard);
}

function contentBlocks(clipboard: Clipboard): Content[] {
    const blocks: Content[] = [];
    let block: Nullable<Content> = clipboard.scrollPage?.firstContentInDescendant() ?? null;
    while (block) {
        blocks.push(block);
        block = block.nextContentInContext();
    }

    return blocks;
}

function findEmptyCommentRangeAroundOffset(
    text: string,
    offset: number,
): Nullable<{ id: string; start: number; end: number }> {
    const markers = realCommentMarkersInText(text);
    for (let index = 0; index < markers.length - 1; index += 1) {
        const open = markers[index];
        const close = markers[index + 1];
        if (
            open.kind !== 'open'
            || close.kind !== 'close'
            || open.id !== close.id
            || open.end !== close.start
        ) {
            continue;
        }

        const start = open.start;
        const end = close.end;
        if (offset >= start && offset <= end) {
            return {
                id: open.id,
                start,
                end,
            };
        }
    }

    return null;
}

// Content leaves whose text the comment parser actually scans — marker-shaped
// text in code fences / thematic breaks is literal and must not influence
// marker existence or counterpart checks.
function scannableContentBlocks(clipboard: Clipboard): Content[] {
    return contentBlocks(clipboard).filter(
        block => !NON_COMMENT_SCANNABLE_LEAF_BLOCKS.has(block.blockName),
    );
}

// Real comment ids in `text` (tokenizer-based, so marker-shaped text inside
// inline code/math is ignored — the same definition the document scan uses).
export function commentIdsInText(text: string): string[] {
    return [...commentMarkerKindsInText(text).keys()];
}

interface ISelectedCommentMarkers {
    ids: string[];
    isPartial: boolean;
    kindsById: Map<string, Set<'open' | 'close'>>;
}

// Which markers a [startOffset, endOffset) selection fully covers in `text`,
// via the shared tokenizer scan so "selected marker" means exactly what
// "document marker" means (no inline-code false positives).
function selectedCommentMarkers(text: string, startOffset: number, endOffset: number): ISelectedCommentMarkers {
    const { selectedKindsById, partial } = scanEditedCommentMarkers(text, startOffset, endOffset);
    return { ids: [...selectedKindsById.keys()], isPartial: partial, kindsById: selectedKindsById };
}

function mergeSelectedCommentMarkers(...selections: ISelectedCommentMarkers[]): ISelectedCommentMarkers {
    const ids = new Set<string>();
    const kindsById = new Map<string, Set<'open' | 'close'>>();

    for (const selection of selections) {
        for (const id of selection.ids)
            ids.add(id);

        for (const [id, kinds] of selection.kindsById) {
            const mergedKinds = kindsById.get(id) ?? new Set<'open' | 'close'>();
            for (const kind of kinds)
                mergedKinds.add(kind);
            kindsById.set(id, mergedKinds);
        }
    }

    return {
        ids: [...ids],
        isPartial: selections.some(selection => selection.isPartial),
        kindsById,
    };
}

function commentMarkerKindsInBlocks(blocks: Content[]): Map<string, Set<'open' | 'close'>> {
    return commentMarkerKindsInTexts(blocks.map(block => block.text));
}

// Marker kinds present anywhere in the document, for the edit guards'
// cross-block counterpart checks. Shared with paste.
export function documentCommentMarkerKinds(clipboard: Clipboard): Map<string, Set<'open' | 'close'>> {
    return commentMarkerKindsInBlocks(scannableContentBlocks(clipboard));
}

// Whether a same-block cut over [startOffset, endOffset) would orphan a comment
// marker. Marker-shaped text inside a non-scannable leaf (a code fence) is
// literal, not a comment endpoint, so its edit is never blocked. Shared by the
// pre-cut check (blockedCommentMarkerCut) and the executor (cutSelection) so the
// two cannot drift.
function sameBlockCutUnsafe(
    clipboard: Clipboard,
    block: Content,
    startOffset: number,
    endOffset: number,
): boolean {
    if (NON_COMMENT_SCANNABLE_LEAF_BLOCKS.has(block.blockName))
        return false;

    return isUnsafeCommentMarkerTextEdit(block.text, startOffset, endOffset, () =>
        documentCommentMarkerKinds(clipboard));
}

function selectedCommentMarkersInCrossBlockRange(
    startBlock: Content,
    startOffset: number,
    endBlock: Content,
    endOffset: number,
): ISelectedCommentMarkers {
    const selections: ISelectedCommentMarkers[] = [];
    let block: Nullable<Content> = startBlock;

    while (block) {
        selections.push(selectedCommentMarkers(
            block.text,
            block === startBlock ? startOffset : 0,
            block === endBlock ? endOffset : block.text.length,
        ));
        if (block === endBlock)
            break;

        block = block.nextContentInContext();
    }

    return mergeSelectedCommentMarkers(...selections);
}

// A removed range can swallow hidden [MC:id] definition paragraphs. Removing
// a definition whose markers survive outside the range strands the thread
// (missing-metadata, thread content lost); slicing THROUGH a hidden
// definition corrupts its bytes. Both block the cut.
function unsafeCrossBlockDefinitionCut(
    startBlock: Content,
    startOffset: number,
    endBlock: Content,
    endOffset: number,
    removedKindsById: ReadonlyMap<string, ReadonlySet<'open' | 'close'>>,
    documentKinds: ReadonlyMap<string, ReadonlySet<'open' | 'close'>>,
): boolean {
    let block: Nullable<Content> = startBlock;
    while (block) {
        if (!NON_COMMENT_SCANNABLE_LEAF_BLOCKS.has(block.blockName)) {
            const definition = parseCommentMetadataDefinition(block.text);
            if (definition) {
                const from = block === startBlock ? startOffset : 0;
                const to = block === endBlock ? endOffset : block.text.length;
                if (to > from) {
                    if (from !== 0 || to !== block.text.length)
                        return true;

                    const survivingKinds = documentKinds.get(definition.id);
                    const removedKinds = removedKindsById.get(definition.id);
                    if (
                        survivingKinds
                        && ![...survivingKinds].every(kind => removedKinds?.has(kind))
                    ) {
                        return true;
                    }
                }
            }
        }
        if (block === endBlock)
            break;
        block = block.nextContentInContext();
    }

    return false;
}

function unsafeCrossBlockCommentMarkerCut(
    clipboard: Clipboard,
    startBlock: Content,
    startOffset: number,
    endBlock: Content,
    endOffset: number,
): { unsafe: boolean; removedIds: string[] } {
    const selectedMarkers = selectedCommentMarkersInCrossBlockRange(
        startBlock,
        startOffset,
        endBlock,
        endOffset,
    );
    if (selectedMarkers.isPartial)
        return { unsafe: true, removedIds: [] };

    const documentKinds = documentCommentMarkerKinds(clipboard);
    for (const [id, kinds] of selectedMarkers.kindsById) {
        const allKinds = documentKinds.get(id);
        if (allKinds && orphansCounterpart(kinds, allKinds))
            return { unsafe: true, removedIds: [] };
    }

    if (
        unsafeCrossBlockDefinitionCut(
            startBlock,
            startOffset,
            endBlock,
            endOffset,
            selectedMarkers.kindsById,
            documentKinds,
        )
    ) {
        return { unsafe: true, removedIds: [] };
    }

    return { unsafe: false, removedIds: selectedMarkers.ids };
}

// Frozen table-selection edits wipe whole cells, so the guard mirrors the
// cross-block rule: removing one endpoint marker while its counterpart
// survives anywhere else in the document is unsafe.
function unsafeTableCellsCommentCut(clipboard: Clipboard, cells: TableBodyCell[]): boolean {
    const selections: ISelectedCommentMarkers[] = [];
    for (const cell of cells) {
        const content = cell.firstChild;
        if (!content?.isContent())
            continue;

        const { text } = content as Content;
        selections.push(selectedCommentMarkers(text, 0, text.length));
    }

    const selectedMarkers = mergeSelectedCommentMarkers(...selections);
    if (selectedMarkers.ids.length === 0)
        return false;

    const documentKinds = documentCommentMarkerKinds(clipboard);
    for (const [id, kinds] of selectedMarkers.kindsById) {
        const allKinds = documentKinds.get(id);
        if (allKinds && orphansCounterpart(kinds, allKinds))
            return true;
    }

    return false;
}

function commentIdsInTableCells(cells: TableBodyCell[]): string[] {
    const ids = new Set<string>();
    for (const cell of cells) {
        const content = cell.firstChild;
        if (!content?.isContent())
            continue;

        for (const id of commentIdsInText((content as Content).text))
            ids.add(id);
    }

    return [...ids];
}

export function removeCommentMetadataForUnreferencedIds(clipboard: Clipboard, ids: string[]): void {
    if (ids.length === 0)
        return;
    clipboard.scrollPage?.removeUnreferencedCommentMetadata(ids);
}

function pruneEmptyCommentRangesAtCutCursor(
    clipboard: Clipboard,
    block: Content,
    offset: number,
): number {
    const removedIds: string[] = [];
    let nextText = block.text;
    let nextOffset = offset;

    for (;;) {
        const emptyRange = findEmptyCommentRangeAroundOffset(nextText, nextOffset);
        if (!emptyRange)
            break;

        nextText = nextText.slice(0, emptyRange.start) + nextText.slice(emptyRange.end);
        nextOffset = emptyRange.start;
        removedIds.push(emptyRange.id);
    }

    if (removedIds.length === 0)
        return offset;

    block.text = nextText;

    removeCommentMetadataForUnreferencedIds(clipboard, removedIds);

    return nextOffset;
}

// Empty every cell content leaf from `start` up to and including `after`,
// keeping the table grid intact.
function emptyCellContentsUntil(
    start: Nullable<Content>,
    after: TreeNode,
): void {
    let cellContent = start;
    while (cellContent) {
        if (cellContent.text !== '')
            cellContent.text = '';

        if (cellContent === after)
            break;

        cellContent = cellContent.nextContentInContext();
    }
}

function removeBlocksWithinTable(before: TreeNode, after: TreeNode): void {
    emptyCellContentsUntil(before.nextContentInContext(), after);
}

/**
 * Handle a cross-block cut whose end lands inside a table. The table grid is
 * exempt from structural removal: remove
 * the outmost blocks strictly between `before` and the table, then empty —
 * not remove — every cell from the table's first cell up to and including
 * `after`'s cell.
 */
function removeBlocksIntoTable(
    before: TreeNode,
    after: TreeNode,
    table: Parent,
): void {
    const beforeOutMost = before.outMostBlock;

    // Remove every outmost block strictly between `before`'s outmost block
    // and the table.
    if (beforeOutMost != null) {
        let between: Nullable<TreeNode> = beforeOutMost.next;
        while (between && between !== table) {
            const temp = between.next;
            between.remove();
            between = temp;
        }
    }

    // Empty the cell content leaves from the table start through `after`'s
    // cell, keeping the grid intact.
    emptyCellContentsUntil(table.firstContentInDescendant(), after);
}

function removePrecedingSiblings(node: TreeNode): void {
    let prev = node.prev;
    while (prev) {
        const temp = prev.prev;
        prev.remove();
        prev = temp;
    }
}

// `after`'s branch is removed but later siblings inside `afterBranch` survive.
// Walk up from `after` to the direct child of `afterBranch`, removing each
// on-path node's preceding siblings and any ancestor it leaves empty, stopping
// below `afterBranch`. Finally remove the on-path direct child itself; later
// siblings survive.
function pruneAfterBranch(afterBranch: TreeNode, after: TreeNode): void {
    let onPath: TreeNode = after;
    while (onPath.parent && onPath.parent !== afterBranch) {
        removePrecedingSiblings(onPath);
        const parent = onPath.parent;
        onPath.remove();
        if (parent.children.length > 0)
            return;

        onPath = parent;
    }

    removePrecedingSiblings(onPath);
    onPath.remove();
}

/**
 * Remove the document-order span between the `before` content leaf and the
 * `after` content leaf — every block strictly between them, plus `after`
 * and any container `after` leaves empty — while preserving `before`'s
 * container chain and any block that follows `after`. Equivalent to legacy
 * `contentState.removeBlocks(before, after)` (`before`'s head + `after`'s
 * tail already live in `before.text`).
 *
 * Nodes are removed children-before-parents so each dispatched json removal
 * targets a still-attached path.
 */
function removeBlocks(before: TreeNode, after: TreeNode): void {
    // A table is exempt from structural removal: empty the spanned cells in
    // place and keep the grid rather than deleting cells/rows.
    const beforeTable = before.closestBlock('table');
    const afterTable = after.closestBlock('table');

    if (beforeTable != null && beforeTable === afterTable) {
        removeBlocksWithinTable(before, after);

        return;
    }

    // `after` lands inside a table that does not also contain `before`:
    // remove only the blocks between `before` and the table, then empty the
    // spanned cells.
    if (afterTable != null) {
        removeBlocksIntoTable(before, after, afterTable as Parent);

        return;
    }

    const beforeAncestors = new Set<TreeNode>();
    for (let node: Nullable<TreeNode> = before; node; node = node.parent)
        beforeAncestors.add(node);

    // The shared container: the lowest ancestor of `after` that also
    // contains `before`.
    let afterBranch: TreeNode = after;
    while (
        afterBranch.parent
        && !afterBranch.parent.isScrollPage
        && !beforeAncestors.has(afterBranch.parent)
    ) {
        afterBranch = afterBranch.parent;
    }

    const commonParent = afterBranch.parent;
    const beforeBranch = commonParent
        ? [...beforeAncestors].find(node => node.parent === commonParent)
        : null;

    // Remove every sibling strictly between `beforeBranch` and
    // `afterBranch` inside the shared container.
    let between = beforeBranch ? beforeBranch.next : afterBranch.prev;
    while (between && between !== afterBranch) {
        const temp = between.next;
        between.remove();
        between = temp;
    }

    // Does any content leaf after `after` survive inside `afterBranch`? If
    // not, `afterBranch` is fully consumed — remove it once (this also keeps
    // atomic blocks like code/math/html/diagram/frontmatter, whose inner
    // tree collapses to a single json node, from being double-removed).
    const nextContent = after.nextContentInContext();
    const afterHasSurvivors
        = nextContent != null && nextContent.isInBlock(afterBranch as Parent);

    if (!afterHasSurvivors) {
        if (afterBranch.parent)
            afterBranch.remove();

        return;
    }

    pruneAfterBranch(afterBranch, after);
}

/**
 * Resolve the frozen table selection to its table and the list of selected
 * body cells, reading the highlighted cell DOM nodes. Returns `null` when
 * there is no resolvable selection.
 */
function selectedTableCells(
    clipboard: Clipboard,
): Nullable<{ table: Table; cells: TableBodyCell[] }> {
    const { domNode } = clipboard.muya;
    const selectedDoms = domNode.querySelectorAll(`.${CLASS_NAMES.MU_TABLE_CELL_SELECTED}`);
    const cells: TableBodyCell[] = [];
    let table: Nullable<Table> = null;

    for (const dom of selectedDoms) {
        const block = getBlock(dom);
        if (block == null || block.blockName !== 'table.cell')
            continue;

        const cell = block as TableBodyCell;
        cells.push(cell);
        table ??= cell.table;
    }

    if (table == null || cells.length === 0)
        return null;

    return { table, cells };
}

// Remove the whole table block and seat the caret just outside it (or reset to
// a single empty paragraph when the table was the only block).
function removeWholeTable(clipboard: Clipboard, table: Table): void {
    clipboard.selection.table.clear();
    const outsideContent
        = table.nextContentInContext() ?? table.previousContentInContext();
    table.remove();
    if (clipboard.scrollPage?.length() === 0)
        resetToEmptyParagraph(clipboard);
    else
        outsideContent?.setCursor(0, 0, true);
}

// For an already-empty frozen selection: if the rectangle covers whole
// column(s), whole row(s), or the whole table, delete that structure and return
// `true`; a partial rectangle returns `false` so the caller just drops the
// selection. Multiple whole columns / rows are removed high-index-first so the
// remaining offsets stay valid.
function removeEmptyTableStructure(clipboard: Clipboard): boolean {
    const selectedCells = selectedTableCells(clipboard);
    if (selectedCells == null)
        return false;

    const { table, cells } = selectedCells;
    const rows = new Set(cells.map(cell => cell.rowOffset));
    const columns = new Set(cells.map(cell => cell.columnOffset));
    const spansAllRows = rows.size === table.rowCount;
    const spansAllColumns = columns.size === table.columnCount;

    if (spansAllRows && spansAllColumns) {
        removeWholeTable(clipboard, table);

        return true;
    }

    if (spansAllRows) {
        clipboard.selection.table.clear();
        let cursorBlock: Nullable<Content> = null;
        for (const column of [...columns].sort((a, b) => b - a))
            cursorBlock = table.removeColumn(column);
        cursorBlock?.setCursor(0, 0, true);

        return true;
    }

    if (spansAllColumns) {
        clipboard.selection.table.clear();
        let cursorBlock: Nullable<Content> = null;
        for (const row of [...rows].sort((a, b) => b - a))
            cursorBlock = table.removeRow(row);
        cursorBlock?.setCursor(0, 0, true);

        return true;
    }

    return false;
}

// Clipboard cut over a frozen table selection: a whole-table selection is
// deleted even with content; otherwise content cells fall back to an in-place
// clear, and an empty whole column/row selection deletes that structure.
function cutTableStructure(clipboard: Clipboard): boolean {
    const selectedCells = selectedTableCells(clipboard);
    if (selectedCells == null)
        return false;

    const { table, cells } = selectedCells;
    const rows = new Set(cells.map(cell => cell.rowOffset));
    const columns = new Set(cells.map(cell => cell.columnOffset));

    if (rows.size === table.rowCount && columns.size === table.columnCount) {
        removeWholeTable(clipboard, table);

        return true;
    }

    if (cells.some(cell => (cell.firstChild as Content)?.text))
        return false;

    return removeEmptyTableStructure(clipboard);
}

// Pure evaluation of the same guards cutSelection applies, with no mutation:
// lets the cut-event handler skip the clipboard write entirely for a blocked
// cut, instead of Ctrl+X silently degrading to copy and clobbering whatever
// the user had on the clipboard.
export function blockedCommentMarkerCut(clipboard: Clipboard): boolean {
    if (clipboard.selection.image)
        return false;

    if (clipboard.selection.table.hasSelection) {
        const selectedCells = selectedTableCells(clipboard);
        return selectedCells != null && unsafeTableCellsCommentCut(clipboard, selectedCells.cells);
    }

    const selection = clipboard.selection.getSelection();
    if (selection == null)
        return false;

    const { isSelectionInSameBlock, anchor, focus, direction } = selection;
    const startOffset = direction === SelectionDirection.FORWARD ? anchor.offset : focus.offset;
    const endOffset = direction === SelectionDirection.FORWARD ? focus.offset : anchor.offset;

    if (isSelectionInSameBlock)
        return sameBlockCutUnsafe(clipboard, anchor.block, startOffset, endOffset);

    const startBlock = direction === SelectionDirection.FORWARD ? anchor.block : focus.block;
    const endBlock = direction === SelectionDirection.FORWARD ? focus.block : anchor.block;

    return unsafeCrossBlockCommentMarkerCut(
        clipboard,
        startBlock,
        startOffset,
        endBlock,
        endOffset,
    ).unsafe;
}

// Returns false when a comment-marker guard blocked the cut — the document
// was left untouched, so the caller must also suppress the browser's native
// edit (e.g. a printable key replacing a cross-block selection) or the DOM
// would diverge from the model.
export function cutSelection(clipboard: Clipboard): boolean {
    // Cut a selected image: the copy half wrote its raw markdown; remove it here.
    const selectedImage = clipboard.selection.image;
    if (selectedImage) {
        const { block, ...imageInfo } = selectedImage;
        block.deleteImage(imageInfo);
        clipboard.selection.activate(SelectionType.TEXT);

        return true;
    }

    if (clipboard.selection.table.hasSelection) {
        const selectedCells = selectedTableCells(clipboard);
        if (selectedCells && unsafeTableCellsCommentCut(clipboard, selectedCells.cells))
            return false;
        const removedCommentIds = selectedCells ? commentIdsInTableCells(selectedCells.cells) : [];
        if (!cutTableStructure(clipboard))
            clipboard.selection.table.clearSelectedCells();

        removeCommentMetadataForUnreferencedIds(clipboard, removedCommentIds);

        return true;
    }

    const selection = clipboard.selection.getSelection();
    if (selection == null)
        return true;

    const {
        isSelectionInSameBlock,
        anchor,
        focus,
        direction,
    } = selection;
    const anchorBlock = anchor.block;
    const focusBlock = focus.block;

    // Handler `cut` event in the same block.
    if (isSelectionInSameBlock) {
        const { text } = anchorBlock;
        const startOffset
            = direction === SelectionDirection.FORWARD ? anchor.offset : focus.offset;
        const endOffset = direction === SelectionDirection.FORWARD ? focus.offset : anchor.offset;
        if (sameBlockCutUnsafe(clipboard, anchorBlock, startOffset, endOffset))
            return false;
        // Scan the FULL block text (with offsets), not the cut fragment: the
        // tokenizer re-evaluates inline-code boundaries per string, so a marker
        // that is live in the block can fall inside a spurious code span when
        // only the removed slice is tokenized, leaving its metadata orphaned.
        const removedCommentIds = selectedCommentMarkers(text, startOffset, endOffset).ids;

        anchorBlock.text
            = text.substring(0, startOffset) + text.substring(endOffset);

        const cursorOffset = pruneEmptyCommentRangesAtCutCursor(clipboard, anchorBlock, startOffset);
        removeCommentMetadataForUnreferencedIds(clipboard, removedCommentIds);
        setCursorAndConvert(anchorBlock, cursorOffset);

        return true;
    }

    const startBlock = direction === SelectionDirection.FORWARD ? anchorBlock : focusBlock;
    const endBlock = direction === SelectionDirection.FORWARD ? focusBlock : anchorBlock;
    const startOffset = direction === SelectionDirection.FORWARD ? anchor.offset : focus.offset;
    const endOffset = direction === SelectionDirection.FORWARD ? focus.offset : anchor.offset;
    const markerCut = unsafeCrossBlockCommentMarkerCut(
        clipboard,
        startBlock,
        startOffset,
        endBlock,
        endOffset,
    );
    if (markerCut.unsafe)
        return false;

    // Whole-document selection collapses to a single empty paragraph.
    if (isSelectAll(clipboard, startBlock, startOffset, endBlock, endOffset)) {
        resetToEmptyParagraph(clipboard);

        return true;
    }

    // #918: a cross-block cut that starts inside a code fence's language line
    // collapses the start code block to a paragraph holding the merged text,
    // rather than corrupting the code block's language with the merged content.
    if (startBlock.blockName === 'language-input') {
        collapseLanguageInputCut(clipboard, startBlock, endBlock, startOffset, endOffset);
        // Same unreferenced-metadata sweep as the general cross-block tail —
        // the cut may have removed a comment's last markers.
        removeCommentMetadataForUnreferencedIds(clipboard, markerCut.removedIds);

        return true;
    }

    // Leaf-level merge: keep the
    // start head and the end tail in the start content block, then remove
    // only the structure strictly between the two leaves (and the emptied
    // end-side containers). The start block keeps its container — a list
    // item stays a list item, a quote stays a quote.
    startBlock.text
        = startBlock.text.substring(0, startOffset)
            + endBlock.text.substring(endOffset);

    removeBlocks(startBlock, endBlock);

    const cursorOffset = pruneEmptyCommentRangesAtCutCursor(clipboard, startBlock, startOffset);
    removeCommentMetadataForUnreferencedIds(clipboard, markerCut.removedIds);
    setCursorAndConvert(startBlock, cursorOffset);
    resetIfEmpty(clipboard);

    return true;
}

// #918: collapse the start code block (whose language line begins the
// selection) into a paragraph carrying the merged head + end-tail text, then
// remove the spanned structure.
function collapseLanguageInputCut(
    clipboard: Clipboard,
    startBlock: Content,
    endBlock: Content,
    startOffset: number,
    endOffset: number,
): void {
    const mergedText
        = startBlock.text.substring(0, startOffset)
            + endBlock.text.substring(endOffset);
    const codeBlock = startBlock.outMostBlock;

    removeBlocks(startBlock, endBlock);

    const paragraph = ScrollPage.loadBlock('paragraph').create(clipboard.muya, {
        name: 'paragraph',
        text: mergedText,
    });
    codeBlock?.replaceWith(paragraph);

    paragraph.firstContentInDescendant()?.setCursor(startOffset, startOffset, true);

    resetIfEmpty(clipboard);
}

// Keyboard delete over a frozen table selection (two-stage, muyajs parity):
// the first press clears the selected cells' text but keeps the rectangle
// frozen; once the cells are empty, the next press removes whole column(s) /
// row(s) / the whole table, or drops the selection for a partial rectangle.
export function deleteTableSelection(clipboard: Clipboard): void {
    const selectedCells = selectedTableCells(clipboard);
    // The caller already suppressed the native edit, so a blocked delete is a
    // clean no-op.
    if (selectedCells && unsafeTableCellsCommentCut(clipboard, selectedCells.cells))
        return;
    const removedCommentIds = selectedCells ? commentIdsInTableCells(selectedCells.cells) : [];

    if (clipboard.selection.table.emptySelectedCells()) {
        removeCommentMetadataForUnreferencedIds(clipboard, removedCommentIds);

        return;
    }

    if (!removeEmptyTableStructure(clipboard))
        clipboard.selection.table.clear();

    removeCommentMetadataForUnreferencedIds(clipboard, removedCommentIds);
}
