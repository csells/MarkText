import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type { TBlockPath } from '../block/types';
import type { Muya } from '../muya';
import type { Nullable } from '../types';
import type Selection from './index';
import type { IAnchorFocusInfo, INodeOffset, ISelection } from './types';
import { BLOCK_DOM_PROPERTY, CLASS_NAMES } from '../config';
import { isHTMLElement, isMouseEvent } from '../utils';
import {
    buildSelectionAffiliation,
    endpointBlockInfo,
} from './affiliation';
import { getCursorCoords } from './cursorCoords';
import {
    compareParagraphsOrder,
    findContentDOM,
    getLegalOffset,
    getNodeAndOffset,
    getOffsetOfParagraph,
    getTextContent,
    getTextOffset,
} from './dom';
import { SelectionCaretType, SelectionDirection, SelectionType } from './types';

const ELEMENT_NODE_TYPE = 1;

function isNodeOwnedBy(
    value: unknown,
    ownerDocument: Document,
): value is Node {
    if (!value || typeof value !== 'object')
        return false;

    const candidate = value as Partial<Node>;
    return typeof candidate.nodeType === 'number'
        && candidate.ownerDocument === ownerDocument;
}

function computeDirection(
    anchorBlock: Content,
    focusBlock: Content,
    anchorOffset: number,
    focusOffset: number,
    isSelectionInSameBlock: boolean,
): SelectionDirection {
    if (isSelectionInSameBlock) {
        return anchorOffset < focusOffset
            ? SelectionDirection.FORWARD
            : SelectionDirection.BACKWARD;
    }

    return compareParagraphsOrder(anchorBlock.domNode!, focusBlock.domNode!)
        ? SelectionDirection.FORWARD
        : SelectionDirection.BACKWARD;
}

function computeCaretType(
    anchorBlock: Nullable<Content>,
    focusBlock: Nullable<Content>,
    isCollapsed: boolean,
): SelectionCaretType {
    if (!anchorBlock && !focusBlock)
        return SelectionCaretType.NONE;

    return isCollapsed ? SelectionCaretType.CARET : SelectionCaretType.RANGE;
}

function visibleDomEndpoint(
    paragraph: Node,
    modelOffset: number,
): ReturnType<typeof getNodeAndOffset> {
    const endpoint = getNodeAndOffset(paragraph, modelOffset);
    const startElement = endpoint.node.nodeType === ELEMENT_NODE_TYPE
        ? endpoint.node as HTMLElement
        : endpoint.node.parentElement;
    if (!startElement)
        return endpoint;

    // getNodeAndOffset deliberately descends into the child that owns an exact
    // text-boundary equality. At a hidden comment boundary that can put the
    // native caret in the open/close marker even though the model offset is at
    // a legal visible edge. Lift the endpoint out of the *outermost* enclosing
    // comment wrapper so nested comments cannot leave it inside a hidden parent.
    let outerComment: HTMLElement | null = null;
    let ancestor: HTMLElement | null = startElement;
    while (ancestor && ancestor !== paragraph) {
        if (
            ancestor.classList.contains(CLASS_NAMES.MU_CRITIC_MARKUP)
            && ancestor.classList.contains(CLASS_NAMES.MU_CRITIC_COMMENT)
        ) {
            outerComment = ancestor;
        }
        ancestor = ancestor.parentElement;
    }
    if (!outerComment?.parentNode)
        return endpoint;

    const parent = outerComment.parentNode;
    const childIndex = [...parent.childNodes].indexOf(outerComment);
    if (childIndex < 0)
        return endpoint;
    const commentStart = getOffsetOfParagraph(outerComment, paragraph as HTMLElement);
    const commentEnd = commentStart + getTextContent(outerComment).length;

    return {
        node: parent,
        offset: modelOffset - commentStart
            <= commentEnd - modelOffset
            ? childIndex
            : childIndex + 1,
    };
}

class TextSelection {
    public anchorPath: TBlockPath = [];
    public anchorBlock: Nullable<Content> = null;
    public focusPath: TBlockPath = [];
    public focusBlock: Nullable<Content> = null;
    public anchor: Nullable<INodeOffset> = null;
    public focus: Nullable<INodeOffset> = null;

    private readonly _doc: Document;

    private _selectInfo: {
        isSelect: boolean;
        selection: { anchor: IAnchorFocusInfo; focus: IAnchorFocusInfo } | null;
    } = {
        isSelect: false,
        selection: null,
    };

    constructor(private _muya: Muya, private _selection: Selection) {
        this._doc = _muya.domNode.ownerDocument;
        this._listenSelectActions();
    }

    private get _scrollPage() {
        return this._muya.editor.scrollPage;
    }

    private get _isCollapsed() {
        const { anchorBlock, focusBlock, anchor, focus } = this;

        if (anchor == null || focus == null)
            return false;

        return anchorBlock === focusBlock && anchor.offset === focus.offset;
    }

    get isSelectionInSameBlock() {
        const { anchorBlock, focusBlock, anchor, focus } = this;

        if (anchor == null || focus == null)
            return false;

        return anchorBlock === focusBlock;
    }

    private get _direction() {
        const {
            anchor,
            focus,
            anchorBlock,
            focusBlock,
            isSelectionInSameBlock,
            _isCollapsed: isCollapsed,
        } = this;
        if (anchor == null || focus == null || !anchorBlock || !focusBlock)
            return SelectionDirection.NONE;

        if (isCollapsed)
            return SelectionDirection.NONE;

        return computeDirection(
            anchorBlock,
            focusBlock,
            anchor.offset,
            focus.offset,
            isSelectionInSameBlock,
        );
    }

    private get _type() {
        const { anchorBlock, focusBlock, _isCollapsed: isCollapsed } = this;

        return computeCaretType(anchorBlock, focusBlock, isCollapsed);
    }

    collapse(): void {
        this.anchor = null;
        this.focus = null;
        this.anchorBlock = null;
        this.focusBlock = null;
        this.anchorPath = [];
        this.focusPath = [];
        this._updateSelection();
        this._emitSelectionChange();
    }

    selectAllContent() {
        const { _scrollPage: scrollPage } = this;
        const aBlock = scrollPage?.firstContentInDescendant();
        const fBlock = scrollPage?.lastContentInDescendant();

        if (aBlock == null || fBlock == null)
            return;

        this.setSelection(
            { offset: 0, block: aBlock, path: aBlock.path },
            { offset: fBlock.text.length, block: fBlock, path: fBlock.path },
        );
        const activeEle = this._doc.activeElement;
        if (isHTMLElement(activeEle) && activeEle.classList.contains('mu-content'))
            activeEle.blur();
    }

    getSelection(): ISelection | null {
        const selection = this._doc.getSelection();

        if (!selection)
            return null;

        const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;

        if (!anchorNode || !focusNode)
            return null;

        const anchorDomNode = findContentDOM(anchorNode);
        const focusDomNode = findContentDOM(focusNode);

        if (!anchorDomNode || !focusDomNode)
            return null;

        const anchorBlock = anchorDomNode[BLOCK_DOM_PROPERTY] as Content | undefined;
        const focusBlock = focusDomNode[BLOCK_DOM_PROPERTY] as Content | undefined;
        // An `mu-content` span cloned by the browser's native edit
        // behavior is not linked back to a block. Bail out instead of
        // crashing — the caller treats null the same as "no selection".
        if (!anchorBlock || !focusBlock)
            return null;

        if (!anchorBlock.outMostBlock || !focusBlock.outMostBlock)
            return null;

        const anchorPath = anchorBlock.path;
        const focusPath = focusBlock.path;

        const aOffset = getOffsetOfParagraph(anchorNode, anchorDomNode)
            + getTextOffset(anchorNode, anchorOffset);
        const fOffset = getOffsetOfParagraph(focusNode, focusDomNode)
            + getTextOffset(focusNode, focusOffset);
        const anchor = { offset: aOffset };
        const focus = { offset: fOffset };

        const isCollapsed = anchorBlock === focusBlock && anchor.offset === focus.offset;
        const isSelectionInSameBlock = anchorBlock === focusBlock;

        const direction = computeDirection(
            anchorBlock,
            focusBlock,
            anchor.offset,
            focus.offset,
            isSelectionInSameBlock,
        );
        const type = computeCaretType(anchorBlock, focusBlock, isCollapsed);

        return {
            anchor: { offset: anchor.offset, block: anchorBlock, path: anchorPath },
            focus: { offset: focus.offset, block: focusBlock, path: focusPath },
            isCollapsed,
            isSelectionInSameBlock,
            direction,
            type,
        };
    }

    setSelection(anchor: IAnchorFocusInfo, focus: IAnchorFocusInfo) {
        this.anchor = { offset: anchor.offset };
        this.anchorBlock = anchor.block;
        this.anchorPath = anchor.path;
        this.focus = { offset: focus.offset };
        this.focusBlock = focus.block;
        this.focusPath = focus.path;
        this._updateSelection();
        this._emitSelectionChange();
    }

    // Persist an already-live selection into the stored model WITHOUT rewriting
    // the DOM. Unlike setSelection, this never calls _updateSelection: restoring
    // a range to the DOM re-anchors it via collapse()+extend(), which cannot
    // reproduce a selection that spans two blocks and so collapses it to a
    // caret. Authoring capture only needs the model to remember the live range
    // (so it survives a later blur) — the DOM already holds the user's real
    // selection, and must be left untouched.
    commitSelectionToModel(anchor: IAnchorFocusInfo, focus: IAnchorFocusInfo) {
        this.anchor = { offset: anchor.offset };
        this.anchorBlock = anchor.block;
        this.anchorPath = anchor.path;
        this.focus = { offset: focus.offset };
        this.focusBlock = focus.block;
        this.focusPath = focus.path;
        this._emitSelectionChange();
    }

    private _emitSelectionChange() {
        const { _isCollapsed: isCollapsed, isSelectionInSameBlock, _direction: direction, _type: type } = this;
        const anchorBlock = this.anchorBlock ?? null;
        const focusBlock = this.focusBlock ?? null;

        // Follow the caret (focus end) for forward selections so typewriter
        // scrolling tracks the cursor rather than the selection start.
        const cursorCoords = getCursorCoords(direction === SelectionDirection.FORWARD);
        // Duck-type the Format block — a value import of Format here would
        // create a selection -> format circular dependency.
        const anchorBlockRef = anchorBlock as Format | null;
        const formats
            = isSelectionInSameBlock
                && anchorBlockRef
                && typeof anchorBlockRef.getFormatsInRange === 'function'
                ? anchorBlockRef.getFormatsInRange().formats
                : [];

        const affiliation = buildSelectionAffiliation(anchorBlock, focusBlock);

        this._muya.eventCenter.emit('selection-change', {
            anchor: this.anchor,
            focus: this.focus,
            anchorBlock,
            anchorPath: this.anchorPath,
            focusBlock,
            focusPath: this.focusPath,
            isCollapsed,
            isSelectionInSameBlock,
            direction,
            type,
            kind: SelectionType.TEXT,
            selectedImage: this._selection.image,
            cursorCoords,
            formats,
            affiliation,
            anchorBlockInfo: endpointBlockInfo(anchorBlock),
            focusBlockInfo: endpointBlockInfo(focusBlock),
        });
    }

    private _listenSelectActions() {
        const { eventCenter, domNode } = this._muya;

        const handleMousedown = () => {
            this._selection.resetHiddenCriticCommentCaretNavigation();
            this._selectInfo = {
                isSelect: true,
                selection: null,
            };
        };

        const handleMouseupOrLeave = () => {
            if (this._selectInfo.selection)
                this.commitSelectionToModel(this._selectInfo.selection.anchor, this._selectInfo.selection.focus);

            this._selectInfo = {
                isSelect: false,
                selection: null,
            };
        };

        const handleMousemoveOrClick = (event: Event) => {
            if (!isMouseEvent(event))
                return;

            const { type, shiftKey } = event;
            if (type === 'mousemove' && !this._selectInfo.isSelect)
                return;

            if (type === 'click' && !shiftKey)
                return;

            const selection = this.getSelection();
            if (!selection)
                return;

            const { anchor, focus, isCollapsed } = selection;

            // A collapsed caret (a plain click, or the drag-start collapse) must
            // not be committed here — that would disturb caret placement and
            // typing. A real range, whether same-block or cross-block, falls
            // through so its endpoints are stashed on `mousemove` and committed
            // on `mouseup`. Previously a same-block range early-returned, so a
            // same-block drag never reached the persistent selection model and
            // an authoring command (Add Comment) could not recover it after the
            // editor blurred.
            if (isCollapsed) {
                return;
            }

            const anchorBlock = anchor.block;
            const focusBlock = focus.block;
            const endpointAnchor = { offset: anchor.offset, block: anchorBlock, path: anchorBlock.path };
            const endpointFocus = { offset: focus.offset, block: focusBlock, path: focusBlock.path };

            if (type === 'mousemove')
                this._selectInfo.selection = { anchor: endpointAnchor, focus: endpointFocus };
            else
                this.setSelection(endpointAnchor, endpointFocus);
        };

        eventCenter.attachDOMEvent(domNode, 'mousedown', handleMousedown);
        eventCenter.attachDOMEvent(domNode, 'mousemove', handleMousemoveOrClick);
        eventCenter.attachDOMEvent(domNode, 'mouseup', handleMouseupOrLeave);
        eventCenter.attachDOMEvent(domNode, 'mouseleave', handleMouseupOrLeave);
        eventCenter.attachDOMEvent(domNode, 'click', handleMousemoveOrClick);
        eventCenter.attachDOMEvent(this._doc, 'selectionchange', () => {
            this._selection.normalizeHiddenCriticCommentCaret();
        });
    }

    private _updateSelection() {
        const {
            anchor,
            focus,
            anchorBlock,
            anchorPath,
            focusBlock,
            focusPath,
            _scrollPage: scrollPage,
        } = this;

        if (!anchor || !focus) {
            const selection = this._doc.getSelection();

            if (selection)
                selection.removeAllRanges();

            return;
        }

        const anchorParagraph = anchorBlock
            ? anchorBlock.domNode
            : scrollPage?.queryBlock(anchorPath);
        const focusParagraph = focusBlock
            ? focusBlock.domNode
            : scrollPage?.queryBlock(focusPath);

        // getNodeAndOffset expects a DOM Node. The fallback branch can hand
        // back a Parent/Content block (from scrollPage.queryBlock); narrow to
        // an actual Node here, preserving the existing not-found behavior.
        if (
            !isNodeOwnedBy(anchorParagraph, this._doc)
            || !isNodeOwnedBy(focusParagraph, this._doc)
        ) {
            return;
        }
        // Only a collapsed caret is normalized out of hidden comments. Ranges
        // retain exact source endpoints for history/programmatic restoration;
        // lifting one endpoint would make the live DOM disagree with the stored
        // model and silently change the range.
        const endpointAt = this._isCollapsed
            ? visibleDomEndpoint
            : getNodeAndOffset;
        const { node: anchorNode, offset: anchorOffset } = endpointAt(
            anchorParagraph,
            anchor.offset,
        );
        const { node: focusNode, offset: focusOffset } = endpointAt(
            focusParagraph,
            focus.offset,
        );

        // setBaseAndExtent restores anchor→focus in one call, so a cross-block
        // range (anchor in one paragraph, focus in another) survives intact and
        // keeps its direction. The older collapse()+extend() pair dropped the
        // focus back into the anchor's block when the two straddled a block
        // boundary, silently shrinking a cross-paragraph selection to a caret.
        const domSelection = this._doc.getSelection();
        if (domSelection) {
            domSelection.setBaseAndExtent(
                anchorNode,
                getLegalOffset(anchorNode, anchorOffset),
                focusNode,
                getLegalOffset(focusNode, focusOffset),
            );
        }
    }
}

export default TextSelection;
