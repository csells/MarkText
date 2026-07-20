import type TableBodyCell from '../block/gfm/table/cell';
import type { Muya } from '../muya';
import type { THiddenCriticCommentCaretAffinity } from './hiddenCriticCommentCaret';
import type { IAnchorFocusInfo, IImageSelectionData, ISelection } from './types';
import { CLASS_NAMES } from '../config';
import { renderedBlockProvesNoHiddenCriticComment } from '../criticMarkup/renderedBlockState';
import {
    getCursorCoords,
    getCursorYOffset,
    getSelectionStart,
} from './cursorCoords';
import { visibleCriticCommentCaretPosition } from './hiddenCriticCommentCaret';
import ImageSelection from './ImageSelection';
import TableRectSelection from './TableRectSelection';
import TextSelection from './TextSelection';
import { SelectionType } from './types';

class Selection {
    static getCursorYOffset(paragraph: HTMLElement) {
        return getCursorYOffset(paragraph);
    }

    static getCursorCoords(preferEnd = false) {
        return getCursorCoords(preferEnd);
    }

    static getSelectionStart() {
        return getSelectionStart();
    }

    private _text: TextSelection;
    private _image: ImageSelection;
    private _table: TableRectSelection;
    private _nativeCommentCaretAffinity: THiddenCriticCommentCaretAffinity
        = 'nearest';

    private _normalizingHiddenCommentCaret = false;

    constructor(private _muya: Muya) {
        this._text = new TextSelection(this._muya, this);
        this._image = new ImageSelection(this._muya, this);
        this._image.attach();
        this._table = TableRectSelection.create(this._muya);
    }

    get type(): SelectionType {
        if (this._image.selected)
            return SelectionType.IMAGE;
        if (this._table.hasSelection)
            return SelectionType.TABLE;
        return SelectionType.TEXT;
    }

    get current(): TextSelection | TableRectSelection | ImageSelection {
        switch (this.type) {
            case SelectionType.IMAGE: return this._image;
            case SelectionType.TABLE: return this._table;
            default: return this._text;
        }
    }

    get image(): IImageSelectionData | null {
        return this._image.selected;
    }

    get table(): TableRectSelection {
        return this._table;
    }

    get anchorBlock() {
        return this._text.anchorBlock;
    }

    get anchorPath() {
        return this._text.anchorPath;
    }

    get focusBlock() {
        return this._text.focusBlock;
    }

    get focusPath() {
        return this._text.focusPath;
    }

    get anchor() {
        return this._text.anchor;
    }

    get focus() {
        return this._text.focus;
    }

    get isSelectionInSameBlock() {
        return this._text.isSelectionInSameBlock;
    }

    selectImage(data: IImageSelectionData): void {
        this._image.selected = data;
        this._muya.editor.activeContentBlock = null;
        this.activate(SelectionType.IMAGE);
    }

    activate(type: SelectionType): void {
        if (type !== SelectionType.TEXT)
            this._text.collapse();
        if (type !== SelectionType.TABLE)
            this._table.clear();
        if (type !== SelectionType.IMAGE)
            this._image.clear();

        if (type !== SelectionType.TEXT) {
            this._muya.eventCenter.emit('selection-change', {
                kind: type,
            });
        }
    }

    clear(): void {
        this._text.collapse();
        this._table.clear();
        this._image.clear();
    }

    clearImage(): void {
        this._image.clear();
    }

    getSelection(): ISelection | null {
        return this._text.getSelection();
    }

    setSelection(anchor: IAnchorFocusInfo, focus: IAnchorFocusInfo): void {
        const requestedBlock = anchor.block;
        if (anchor.block === focus.block && anchor.offset === focus.offset) {
            const visible = this._visibleCriticCommentEndpoint(
                anchor,
                this._nativeCommentCaretAffinity,
            );
            if (!visible) {
                this._muya.editor.activeContentBlock = null;
                this._text.collapse();
                return;
            }
            anchor = visible;
            focus = visible;
        }
        if (anchor.block !== requestedBlock)
            this._muya.editor.activeContentBlock = anchor.block;
        this._text.setSelection(anchor, focus);
    }

    commitSelectionToModel(anchor: IAnchorFocusInfo, focus: IAnchorFocusInfo): void {
        this._text.commitSelectionToModel(anchor, focus);
    }

    preventHiddenCriticCommentInput(event: Event): boolean {
        const selection = this.getSelection();
        const unsafeTargetRange = this._beforeInputTargetsHiddenCriticCommentDom(
            event,
        );
        if (!selection || selection.anchor.block.muya !== this._muya) {
            if (unsafeTargetRange)
                event.preventDefault();
            return unsafeTargetRange;
        }
        if (!selection.isCollapsed) {
            if (unsafeTargetRange)
                event.preventDefault();
            return unsafeTargetRange;
        }

        const { anchor } = selection;
        const visible = this._visibleCriticCommentEndpoint(anchor);
        const unsafeNativeCaret = this._nativeCaretIsInsideHiddenCriticCommentDom();
        if (
            visible
            && visible.block === anchor.block
            && visible.offset === anchor.offset
            && !unsafeNativeCaret
            && !unsafeTargetRange
        ) {
            return false;
        }

        event.preventDefault();
        if (!visible) {
            this._muya.editor.activeContentBlock = null;
            this._text.collapse();
            return true;
        }
        this._muya.editor.activeContentBlock = visible.block;
        this._text.setSelection(visible, visible);
        return true;
    }

    normalizeHiddenCriticCommentCaret(
        affinity: THiddenCriticCommentCaretAffinity
            = this._nativeCommentCaretAffinity,
    ): boolean {
        if (this._normalizingHiddenCommentCaret)
            return false;

        const selection = this.getSelection();
        if (
            !selection?.isCollapsed
            || selection.anchor.block.muya !== this._muya
        ) {
            return false;
        }

        const { anchor } = selection;
        const visible = this._visibleCriticCommentEndpoint(
            anchor,
            affinity,
        );
        if (
            visible
            && visible.block === anchor.block
            && visible.offset === anchor.offset
            && !this._nativeCaretIsInsideHiddenCriticCommentDom()
        ) {
            return false;
        }

        this._normalizingHiddenCommentCaret = true;
        try {
            if (!visible) {
                this._muya.editor.activeContentBlock = null;
                this._text.collapse();
                return true;
            }
            this._muya.editor.activeContentBlock = visible.block;
            this._text.setSelection(visible, visible);
        }
        finally {
            this._normalizingHiddenCommentCaret = false;
        }
        return true;
    }

    prepareHiddenCriticCommentCaretNavigation(event: KeyboardEvent): void {
        const activeBlock = this.getSelection()?.anchor.block;
        const isRtl = activeBlock?.domNode
            ?.closest('[dir]')?.getAttribute('dir') === 'rtl';
        const horizontalNext = isRtl ? 'ArrowLeft' : 'ArrowRight';
        const horizontalPrevious = isRtl ? 'ArrowRight' : 'ArrowLeft';
        this._nativeCommentCaretAffinity
            = [horizontalNext, 'ArrowDown', 'End', 'PageDown']
                    .includes(event.key)
                ? 'next'
                : [horizontalPrevious, 'ArrowUp', 'Home', 'PageUp']
                        .includes(event.key)
                        ? 'previous'
                        : 'nearest';
    }

    /**
     * Record the semantic block traversal selected by Content.arrowHandler.
     * This deliberately overrides physical Left/Right key mapping so RTL
     * navigation still skips hidden comment carriers in document order.
     */
    preferHiddenCriticCommentCaretNavigation(
        affinity: Exclude<THiddenCriticCommentCaretAffinity, 'nearest'>,
    ): void {
        this._nativeCommentCaretAffinity = affinity;
    }

    finishHiddenCriticCommentCaretNavigation(event: KeyboardEvent): boolean {
        this.prepareHiddenCriticCommentCaretNavigation(event);
        const normalized = this.normalizeHiddenCriticCommentCaret();
        this._nativeCommentCaretAffinity = 'nearest';
        return normalized;
    }

    resetHiddenCriticCommentCaretNavigation(): void {
        this._nativeCommentCaretAffinity = 'nearest';
    }

    private _nativeCaretIsInsideHiddenCriticCommentDom(): boolean {
        const selection = this._muya.domNode.ownerDocument.getSelection();
        if (!selection?.isCollapsed || !selection.anchorNode)
            return false;
        return this._nodeIsInsideHiddenCriticCommentDom(selection.anchorNode);
    }

    private _beforeInputTargetsHiddenCriticCommentDom(event: Event): boolean {
        const inputEvent = event as InputEvent;
        if (typeof inputEvent.getTargetRanges !== 'function')
            return false;
        try {
            return [...inputEvent.getTargetRanges()].some(range =>
                this._nodeIsInsideHiddenCriticCommentDom(range.startContainer)
                || this._nodeIsInsideHiddenCriticCommentDom(range.endContainer));
        }
        catch {
            // A browser exposing but failing its target-range API gives us no
            // safe mutation target. Reject the edit rather than risk changing
            // hidden source markers.
            return true;
        }
    }

    private _nodeIsInsideHiddenCriticCommentDom(node: Node): boolean {
        const element = node.nodeType === Node.ELEMENT_NODE
            ? node as Element
            : node.parentElement;
        if (!element || !this._muya.domNode.contains(element))
            return false;

        const commentClass = `.${CLASS_NAMES.MU_CRITIC_COMMENT}`;
        return Boolean(element.closest([
            commentClass,
            `[hidden][data-critic-type~="comment"]`,
        ].join(', ')));
    }

    private _renderedCarrierProvesNoHiddenComment(
        endpoint: IAnchorFocusInfo,
    ): boolean {
        const { domNode } = endpoint.block;
        if (
            !domNode?.isConnected
            || !this._muya.domNode.contains(domNode)
        ) {
            return false;
        }
        return renderedBlockProvesNoHiddenCriticComment(
            endpoint.block,
            this._muya.options.criticMarkupProjection,
        );
    }

    private _visibleCriticCommentEndpoint(
        endpoint: IAnchorFocusInfo,
        affinity: THiddenCriticCommentCaretAffinity = 'nearest',
    ): IAnchorFocusInfo | null {
        // This is only a negative proof: a completed parser-owned render with
        // current per-block text/structural metadata means the endpoint is
        // already visible. Every positive relocation still comes exclusively
        // from the parser document and its source map below.
        if (this._renderedCarrierProvesNoHiddenComment(endpoint))
            return endpoint;
        const visible = visibleCriticCommentCaretPosition(
            this._muya,
            endpoint.path,
            endpoint.offset,
            affinity,
        );
        if (!visible)
            return null;
        if (
            visible.offset === endpoint.offset
            && visible.path.length === endpoint.path.length
            && visible.path.every((part, index) => part === endpoint.path[index])
        ) {
            return endpoint;
        }

        const block = this._muya.editor.scrollPage?.queryBlock([...visible.path]);
        if (!block?.isContent())
            return null;

        return {
            block,
            path: visible.path,
            offset: visible.offset,
        };
    }

    selectAll(): void {
        const tableSelection = this._table;

        // A frozen rectangular table selection escalates: the whole table jumps
        // to the whole document; any partial rectangle (a single cell included)
        // grows to the whole table first.
        if (tableSelection.hasSelection) {
            if (tableSelection.isWholeTableSelected()) {
                tableSelection.clear();
                this._text.selectAllContent();
            }
            else {
                tableSelection.selectWholeTable();
            }
            return;
        }

        // Read the live DOM selection so the caret the user actually sees is
        // honored. selectAll is driven from the application menu, so the cached
        // endpoints may be stale — e.g. after a whole-document selection blurred
        // the editor and the user clicked back into a single block.
        const live = this.getSelection();
        const anchorBlock = live ? live.anchor.block : this._text.anchorBlock;
        const focusBlock = live ? live.focus.block : this._text.focusBlock;
        const anchorOffset = live ? live.anchor.offset : this._text.anchor?.offset;
        const focusOffset = live ? live.focus.offset : this._text.focus?.offset;

        // A caret or selection contained in a single content block.
        if (anchorBlock && anchorBlock === focusBlock && anchorOffset != null && focusOffset != null) {
            // Inside one table cell: freeze it as a 1x1 rectangle.
            if (anchorBlock.blockName === 'table.cell.content') {
                const cellBlock = anchorBlock.closestBlock('table.cell') as TableBodyCell | null;
                if (cellBlock) {
                    tableSelection.selectSingleCell(cellBlock);
                    return;
                }
            }

            // A partial selection grows to the whole block; a full-block
            // selection falls through to the whole document.
            if (Math.abs(focusOffset - anchorOffset) < anchorBlock.text.length) {
                const path = anchorBlock.path;
                this._text.setSelection(
                    { offset: 0, block: anchorBlock, path },
                    { offset: anchorBlock.text.length, block: anchorBlock, path },
                );
                return;
            }
        }

        // Spanning multiple blocks, or a single block already fully selected.
        this._text.selectAllContent();
    }
}

export function getCursorReference() {
    const rect = getCursorCoords();

    if (!rect)
        return null;

    return {
        getBoundingClientRect() {
            return rect;
        },
        clientWidth: rect.width,
        clientHeight: rect.height,
    };
}

export default Selection;
