import type { Muya } from '../../../index';
import type { Token } from '../../../inlineRenderer/types';
import type { IRenderCursor } from '../../../selection/types';
import type {
    IBlockQuoteState,
    IBulletListState,
    ICodeBlockState,
    IDiagramMeta,
    IDiagramState,
    IHtmlBlockState,
    IListItemState,
    IMathBlockState,
    IOrderListState,
    IParagraphState,
    IStateSourceTriviaCarrier,
    ITaskListItemState,
    ITaskListState,
} from '../../../state/types';
import type { Nullable } from '../../../types';
import type Content from '../../base/content';
import type Parent from '../../base/parent';
import type BulletList from '../../commonMark/bulletList';
import type Paragraph from '../../commonMark/paragraph';
import { tokenizer } from '../../../inlineRenderer/lexer';
import { isListItemState, isTaskListItemState } from '../../../state/types';
import { isKeyboardEvent } from '../../../utils';
import logger from '../../../utils/logger';
import Format from '../../base/format';
import OrderList from '../../commonMark/orderList';
import TaskList from '../../gfm/taskList';
import { ScrollPage } from '../../scrollPage';

import {
    BOTH_SIDES_FORMATS,
    END_FORMAT_HANDLERS,
    matchBlockConversion,
    parseTableHeader,
} from './textClassification';

// `_unindentListItem` / `_indentListItem` walk parents typed as the loose
// `Parent` super-class; at runtime the relevant nodes are always one of
// these three list kinds, which carry a `meta` field with the bullet/order
// shape. Narrow once instead of casting per access.
type TListBlock = BulletList | OrderList | TaskList;

enum UnindentType {
    INDENT,
    REPLACEMENT,
}

const debug = logger('paragraph:content');

/**
 * Release a re-parented list item's parser-owned marker and physical spacing
 * trivia. That trivia spells the item's OLD position — marker number, leading
 * indent, per-line continuation prefixes — so after a Tab/Shift-Tab move the
 * serializer must re-spell the item from its new context (e.g. a nested
 * ordered list restarts numbering at 1; honoring a stale `2.` would round-trip
 * as a different number than the live document shows). Only the moved item's
 * own layout keys are released: nested descendants keep their still-valid
 * trivia, and non-layout trivia (Critic markers, block spacing) is preserved.
 * The stripped state feeds a fresh block whose insertion op carries it, so no
 * live-tree trivia rewrite is needed.
 */
function releaseListItemLayoutTrivia<T extends IStateSourceTriviaCarrier>(
    state: T,
): T {
    const { sourceTrivia } = state;
    if (!sourceTrivia)
        return state;
    const {
        listItemLeadingPrefix: _leadingPrefix,
        listItemMarker: _marker,
        listItemMarkerPadding: _markerPadding,
        listItemTrailingBlankLines: _trailingBlankLines,
        listItemContinuationPrefixes: _continuationPrefixes,
        ...keptTrivia
    } = sourceTrivia;
    const { sourceTrivia: _stale, ...rest } = state;
    return (Object.keys(keptTrivia).length
        ? { ...rest, sourceTrivia: keptTrivia }
        : rest) as T;
}

/**
 * ParagraphContent
 */
class ParagraphContent extends Format {
    override get parent(): Nullable<Paragraph> {
        return super.parent as Nullable<Paragraph>;
    }

    override set parent(value: Nullable<Paragraph>) {
        super.parent = value;
    }

    static override blockName = 'paragraph.content';

    static create(muya: Muya, text: string) {
        const content = new ParagraphContent(muya, text);

        return content;
    }

    constructor(muya: Muya, text: string) {
        super(muya, text);

        this.classList = [...this.classList, 'mu-paragraph-content'];
        this.attributes['empty-hint'] = muya.i18n.t('Type / to insert...');
        this.createDomNode();
    }

    override getAnchor() {
        return this.parent;
    }

    override update(cursor?: IRenderCursor, highlights = []) {
        this.inlineRenderer.patch(this, cursor, highlights);
        const { label } = this.inlineRenderer.getLabelInfo(this);

        if (this.isAttachedToLiveTree && this.scrollPage && label)
            this.scrollPage.updateRefLinkAndImage(label);
    }

    override backspaceHandler(event: Event) {
        const { start, end } = this.getCursor()!;
        const { eventCenter } = this.muya;

        if (
            start.offset !== 0
            || end.offset !== 0
            || this.caretOffsetOnInlineImage() !== null
        ) {
            super.backspaceHandler(event);
            eventCenter.emit('content-change', { block: this });
            return;
        }

        event.preventDefault();
        const type = this._paragraphParentType();

        switch (type) {
            case 'paragraph':
                return this._handleBackspaceInParagraph();

            case 'block-quote':
                return this._handleBackspaceInBlockQuote();

            case 'list-item': // fall through
            case 'task-list-item':
                return this._handleBackspaceInList();

            default:
                debug.error('Unknown backspace type');
                break;
        }
    }

    override inputHandler(event: Event) {
        super.inputHandler(event);
        const { eventCenter } = this.muya;

        eventCenter.emit('content-change', { block: this });
    }

    private _enterConvert(event: KeyboardEvent) {
        event.preventDefault();
        event.stopPropagation();

        const match = matchBlockConversion(this.text);
        if (!match)
            return super.enterHandler(event);

        switch (match.kind) {
            case 'math': {
                const state: IMathBlockState = {
                    name: 'math-block',
                    text: '',
                    meta: {
                        mathStyle: '',
                    },
                };
                const mathBlock = ScrollPage.createStateBlock(
                    this.muya,
                    state,
                );
                this.parent!.replaceWith(mathBlock);
                mathBlock.firstContentInDescendant()!.setCursor(0, 0);
                break;
            }

            case 'code': {
                const { lang } = match;
                // Diagram fences (```mermaid etc.) become diagram blocks,
                // mirroring the file-load path in markdownToState; everything
                // else is a fenced code block.
                const diagramMatch = /^(?:mermaid|vega-lite|plantuml|flowchart|sequence)$/.exec(lang);
                if (diagramMatch) {
                    const type = lang as IDiagramMeta['type'];
                    const state: IDiagramState = {
                        name: 'diagram',
                        text: '',
                        meta: {
                            type,
                            lang: type === 'vega-lite' ? 'json' : 'yaml',
                        },
                    };
                    const diagramBlock = ScrollPage.createStateBlock(
                        this.muya,
                        state,
                    );

                    this.parent!.replaceWith(diagramBlock);

                    diagramBlock.firstContentInDescendant()!.setCursor(0, 0, true);
                }
                else {
                    const state: ICodeBlockState = {
                        name: 'code-block',
                        meta: {
                            lang,
                            type: 'fenced',
                        },
                        text: '',
                    };
                    const codeBlock = ScrollPage.createStateBlock(
                        this.muya,
                        state,
                    );

                    this.parent!.replaceWith(codeBlock);

                    codeBlock.lastContentInDescendant()!.setCursor(0, 0);
                }
                break;
            }

            case 'table': {
                const tableHeader = parseTableHeader(this.text);
                // Table extends the base `create` shape with a static
                // `createWithHeader(muya, header)` factory; the registry-level
                // IConstructor doesn't surface it. Cast to a structural view
                // that names only the static slot we read.
                const tableCtor = ScrollPage.loadBlock('table') as {
                    createWithHeader?: (muya: Muya, header: string[]) => Parent;
                };
                const tableBlock = tableCtor.createWithHeader!(this.muya, tableHeader);

                this.parent!.replaceWith(tableBlock);

                // Set cursor at the first cell of second row. The runtime chain
                // is: table → table-body (Parent.firstChild) → row (find(1)) →
                // first cell content (firstContentInDescendant). Asserted as
                // Parent at each container hop since createWithHeader guarantees
                // a populated structure.
                const tableBody = tableBlock.firstChild as Parent;
                const secondRow = tableBody.find(1) as Parent;
                secondRow.firstContentInDescendant()?.setCursor(0, 0, true);
                break;
            }

            case 'html': {
                const { tagName } = match;
                const state: IHtmlBlockState = {
                    name: 'html-block',
                    text: `<${tagName}>\n\n</${tagName}>`,
                };
                const htmlBlock = ScrollPage.createStateBlock(
                    this.muya,
                    state,
                );
                this.parent!.replaceWith(htmlBlock);
                const offset = tagName.length + 3;
                htmlBlock.firstContentInDescendant()!.setCursor(offset, offset);
                break;
            }
        }
    }

    private _enterInBlockQuote(event: KeyboardEvent) {
        const { text, parent } = this;
        if (text.length !== 0)
            return super.enterHandler(event);

        event.preventDefault();
        event.stopPropagation();

        const newNode = parent!.clone() as Paragraph;
        const blockQuote = parent!.parent;

        switch (true) {
            case parent!.isOnlyChild():
                blockQuote!.parent!.insertBefore(newNode, blockQuote);
                blockQuote!.remove();
                break;

            case parent!.isFirstChild():
                blockQuote!.parent!.insertBefore(newNode, blockQuote);
                parent!.remove();
                break;

            case parent!.isLastChild():
                blockQuote!.parent!.insertAfter(newNode, blockQuote);
                parent!.remove();
                break;

            default: {
                const newBlockState: IBlockQuoteState = {
                    name: 'block-quote',
                    children: [],
                };
                const offset = blockQuote!.offset(parent!);
                blockQuote!.forEachAt(offset + 1, undefined, (node) => {
                    // forEachAt's callback gets `TreeNode` but the runtime
                    // children of a blockquote are always Parent-derived
                    // blocks (paragraph, list, …). isParent() narrows so
                    // `getState()` (defined on Parent, not TreeNode) resolves.
                    if (node.isParent())
                        newBlockState.children.push(node.getState());
                    node.remove();
                });
                const newBlockQuote = ScrollPage.createStateBlock(
                    this.muya,
                    newBlockState,
                );
                blockQuote!.parent!.insertAfter(newNode, blockQuote);
                blockQuote!.parent!.insertAfter(newBlockQuote, newNode);
                parent!.remove();
                break;
            }
        }

        (newNode.children.head as ParagraphContent).setCursor(0, 0, true);
    }

    private _enterInListItem(event: KeyboardEvent) {
        event.preventDefault();
        event.stopPropagation();

        const { text, parent, muya } = this;
        const { start, end } = this.getCursor()!;
        const listItem = parent!.parent!;
        const list = listItem!.parent! as BulletList | OrderList | TaskList;

        if (text.length === 0) {
            if (parent!.isOnlyChild()) {
                switch (true) {
                    case listItem.isOnlyChild(): {
                        const newParagraph = parent!.clone() as Paragraph;
                        list.replaceWith(newParagraph);
                        newParagraph?.firstContentInDescendant()?.setCursor(0, 0);
                        break;
                    }

                    case listItem.isFirstChild(): {
                        const newParagraph = parent!.clone() as Paragraph;
                        listItem.remove();
                        list.parent!.insertBefore(newParagraph, list);
                        newParagraph?.firstContentInDescendant()?.setCursor(0, 0);
                        break;
                    }

                    case listItem.isLastChild(): {
                        const newParagraph = parent!.clone() as Paragraph;
                        listItem.remove();
                        list.parent!.insertAfter(newParagraph, list);
                        newParagraph?.firstContentInDescendant()?.setCursor(0, 0);
                        break;
                    }

                    default: {
                        const newParagraph = parent!.clone() as Paragraph;
                        const newListState: IBulletListState | IOrderListState | ITaskListState
                            = list instanceof TaskList
                                ? { name: 'task-list', meta: { ...list.meta }, children: [] }
                                : list instanceof OrderList
                                    ? { name: 'order-list', meta: { ...list.meta }, children: [] }
                                    : { name: 'bullet-list', meta: { ...list.meta }, children: [] };
                        const offset = list.offset(listItem);
                        list.forEachAt(offset + 1, undefined, (node) => {
                            if (node.isParent()) {
                                const childState = node.getState();
                                if (newListState.name === 'task-list') {
                                    if (isTaskListItemState(childState))
                                        newListState.children.push(childState);
                                }
                                else if (isListItemState(childState)) {
                                    newListState.children.push(childState);
                                }
                            }
                            node.remove();
                        });
                        const newList = ScrollPage.createStateBlock(
                            this.muya,
                            newListState,
                        );
                        list.parent!.insertAfter(newParagraph, list);
                        list.parent!.insertAfter(newList, newParagraph);
                        listItem.remove();
                        newParagraph?.firstContentInDescendant()?.setCursor(0, 0);
                        break;
                    }
                }
            }
            else {
                const newListItemState: IListItemState | ITaskListItemState
                    = listItem.blockName === 'task-list-item'
                        ? { name: 'task-list-item', meta: { checked: false }, children: [] }
                        : { name: 'list-item', children: [] };

                const offset = listItem.offset(parent!);
                // Splitting from index 0 would empty the original list item,
                // leaving a childless list-item that breaks arrow navigation
                // (#4644). Keep the empty first paragraph and split below it.
                const from = offset === 0 ? 1 : offset;
                listItem.forEachAt(from, undefined, (node) => {
                    if (node.isParent())
                        newListItemState.children.push(node.getState());
                    node.remove();
                });

                const newListItem = ScrollPage.createStateBlock(
                    this.muya,
                    newListItemState,
                );
                list.insertAfter(newListItem, listItem);

                newListItem.firstContentInDescendant()!.setCursor(0, 0);
            }
        }
        else {
            if (parent!.isOnlyChild()) {
                this.text = text.substring(0, start.offset);
                const paragraphChild: IParagraphState = {
                    name: 'paragraph',
                    text: text.substring(end.offset),
                };
                const newNodeState: IListItemState | ITaskListItemState
                    = listItem.blockName === 'task-list-item'
                        ? { name: 'task-list-item', meta: { checked: false }, children: [paragraphChild] }
                        : { name: 'list-item', children: [paragraphChild] };

                const newListItem = ScrollPage.createStateBlock(
                    muya,
                    newNodeState,
                );

                list.insertAfter(newListItem, listItem);

                this.update();
                newListItem.firstContentInDescendant()!.setCursor(0, 0, true);
            }
            else {
                super.enterHandler(event);
            }
        }
    }

    override enterHandler(event: Event) {
        if (!isKeyboardEvent(event))
            return;

        if (event.shiftKey)
            return this.shiftEnterHandler(event);

        // Any paragraph that would convert to a block (code fence, math block,
        // table, HTML block) converts in place, even inside a block-quote or
        // list item — the resulting block stays nested in its container
        // (matches muyajs). Otherwise typing the block syntax in a list would
        // split the item and strand an empty list entry (#2276, plus table /
        // HTML block).
        if (matchBlockConversion(this.text))
            return this._enterConvert(event);

        const type = this._paragraphParentType();

        if (type === 'block-quote')
            this._enterInBlockQuote(event);
        else if (type === 'list-item' || type === 'task-list-item')
            this._enterInListItem(event);
        else
            this._enterConvert(event);
    }

    private _paragraphParentType() {
        if (this.blockName !== 'paragraph.content') {
            debug.warn('Only paragraph content can call _paragraphParentType');

            return;
        }

        let parent: Nullable<Parent> = this.parent;
        let type = 'paragraph';

        while (parent && !parent.isScrollPage) {
            if (
                parent.blockName === 'block-quote'
                || parent.blockName === 'list-item'
                || parent.blockName === 'task-list-item'
            ) {
                type = parent.blockName;
                break;
            }

            parent = parent.parent;
        }

        return type;
    }

    private _handleBackspaceInParagraph(this: ParagraphContent) {
        const previousContentBlock = this.previousContentInContext();
        // Handle no previous content block, the first paragraph in document.
        if (!previousContentBlock)
            return;

        const { text: oldText } = previousContentBlock;
        const offset = oldText.length;
        previousContentBlock.text += this.text;
        const absorbing = previousContentBlock.getAnchor();
        this.parent!.remove();
        // The join removed the block this separator was spelled against.
        absorbing?.releaseBlockSeparatorTrivia();
        previousContentBlock.setCursor(offset, offset, true);
    }

    private _handleBackspaceInBlockQuote() {
        const parent = this.parent!;
        const blockQuote = parent!.parent!;
        let cursorBlock: Content | null;

        if (!parent!.isOnlyChild() && !parent!.isFirstChild())
            return this._handleBackspaceInParagraph();

        if (parent.isOnlyChild()) {
            blockQuote.replaceWith(parent);
            cursorBlock = parent.firstContentInDescendant();
        }
        else if (parent.isFirstChild()) {
            const cloneParagraph = parent.clone() as Paragraph;
            blockQuote.parent!.insertBefore(cloneParagraph, blockQuote);
            parent.remove();
            cursorBlock = cloneParagraph.firstContentInDescendant();
        }

        cursorBlock!.setCursor(0, 0, true);
    }

    private _handleBackspaceInList() {
        const parent = this.parent!;
        const listItem = parent.parent!;
        const list = listItem.parent!;

        if (!parent.isFirstChild())
            return this._handleBackspaceInParagraph();

        if (listItem.isOnlyChild()) {
            listItem.forEach((node, i: number) => {
                const paragraph = (node as Parent).clone() as Parent;
                list.parent!.insertBefore(paragraph, list);
                if (i === 0)
                    paragraph?.firstContentInDescendant()?.setCursor(0, 0, true);
            });

            list.remove();
        }
        else if (listItem.isFirstChild()) {
            listItem.forEach((node, i: number) => {
                const paragraph = (node as Parent).clone() as Parent;
                list.parent!.insertBefore(paragraph, list);
                if (i === 0)
                    paragraph?.firstContentInDescendant()?.setCursor(0, 0, true);
            });

            listItem.remove();
        }
        else {
            const previousListItem = listItem.prev;
            listItem.forEach((node, i: number) => {
                const paragraph = (node as Parent).clone() as Parent;
                previousListItem!.append(paragraph, 'user');
                if (i === 0)
                    paragraph?.firstContentInDescendant()?.setCursor(0, 0, true);
            });

            listItem.remove();
        }
    }

    private _getUnindentType(): Nullable<UnindentType> {
        if (!this.isCollapsed)
            return null;

        const { parent } = this;
        const listItem = parent!.parent;
        const list = listItem?.parent;
        const listParent = list?.parent;

        if (
            listParent
            && (listParent.blockName === 'list-item'
                || listParent.blockName === 'task-list-item')
        ) {
            return list.prev ? UnindentType.INDENT : UnindentType.REPLACEMENT;
        }

        return null;
    }

    private _canIndentListItem() {
        const { parent } = this;
        if (parent!.blockName !== 'paragraph' || !parent!.parent)
            return false;

        const listItem = parent?.parent;
        // Now we know it's a list item. Check whether we can indent the list item.
        const list = listItem?.parent;

        if (listItem == null || list == null)
            return false;

        if (
            (listItem.blockName !== 'list-item'
                && listItem.blockName !== 'task-list-item')
            || !this.isCollapsed
        ) {
            return false;
        }

        return list && /ol|ul/.test(list.tagName) && listItem.prev;
    }

    private _placeCursorIn(block: Nullable<Parent>, startOffset: number, endOffset: number) {
        block?.firstContentInDescendant()?.setCursor(startOffset, endOffset, true);
    }

    private _unindentListItem(type: UnindentType) {
        const { parent } = this;
        const listItem = parent?.parent;
        const list = listItem?.parent;
        const listParent = list?.parent;
        const cursor = this.getCursor();

        if (
            parent == null
            || listItem == null
            || list == null
            || listParent == null
            || cursor == null
        ) {
            return;
        }

        const { start, end } = cursor;

        const cursorParagraphOffset = listItem.offset(parent);

        if (type === UnindentType.REPLACEMENT) {
            const paragraph = parent.clone() as Paragraph;
            listParent.insertBefore(paragraph, list);

            if (listItem.isOnlyChild())
                list.remove();
            else
                listItem.remove();

            this._placeCursorIn(paragraph, start.offset, end.offset);
        }
        else if (type === UnindentType.INDENT) {
            const newListItem = ScrollPage.createStateBlock(
                this.muya,
                releaseListItemLayoutTrivia(listItem.getState()),
            );
            listParent.parent!.insertAfter(newListItem, listParent);

            // At runtime, when unindentListItem runs, the surrounding `list`
            // is always one of the three list block kinds — narrow once
            // so `meta` resolves without `as any`.
            const listAsList = list as TListBlock;

            if (
                (listItem.next || list.next)
                && newListItem.lastChild!.blockName !== list.blockName
            ) {
                const state: IBulletListState | IOrderListState | ITaskListState
                    = listAsList instanceof TaskList
                        ? {
                                name: 'task-list',
                                meta: { ...listAsList.meta },
                                children: [],
                            }
                        : listAsList instanceof OrderList
                            ? {
                                    name: 'order-list',
                                    meta: { ...listAsList.meta },
                                    children: [],
                                }
                            : {
                                    name: 'bullet-list',
                                    meta: { ...listAsList.meta },
                                    children: [],
                                };
                const childList = ScrollPage.createStateBlock(
                    this.muya,
                    state,
                );
                newListItem.append(childList, 'user');
            }

            if (listItem.next) {
                const offset = list.offset(listItem);

                list.forEachAt(offset + 1, undefined, (node) => {
                    if (node.isParent()) {
                        (newListItem.lastChild as Parent).append(
                            node.clone() as Parent,
                            'user',
                        );
                    }
                    node.remove();
                });
            }

            if (list.next) {
                const offset = listParent.offset(list);
                listParent.forEachAt(offset + 1, undefined, (node) => {
                    if (node.isParent()) {
                        (newListItem.lastChild as Parent).append(
                            node.clone() as Parent,
                            'user',
                        );
                    }
                    node.remove();
                });
            }

            if (listItem.isOnlyChild())
                list.remove();
            else
                listItem.remove();

            if (newListItem == null) {
                debug.error('newListItem is null');
                return;
            }

            this._placeCursorIn(
                newListItem.find(cursorParagraphOffset) as Parent,
                start.offset,
                end.offset,
            );
        }
    }

    private _indentListItem() {
        const { parent, muya } = this;
        const listItem = parent?.parent;
        const list = listItem?.parent;
        const prevListItem = listItem?.prev;
        const { start, end } = this.getCursor()!;

        if (parent == null || listItem == null || list == null)
            return;

        // Remember the offset of cursor paragraph in listItem
        const offset = listItem.offset(parent);

        // Search for a list in previous block
        let newList = prevListItem?.lastChild;

        if (!newList || !/ol|ul/.test(newList.tagName)) {
            const listAsList = list as TListBlock;
            const listItemState = releaseListItemLayoutTrivia(
                listItem.getState(),
            );
            let state: IBulletListState | IOrderListState | ITaskListState;
            if (listAsList instanceof TaskList) {
                if (!isTaskListItemState(listItemState)) {
                    throw new TypeError(
                        'A task list must contain task-list-item state.',
                    );
                }
                state = {
                    name: 'task-list',
                    meta: { ...listAsList.meta },
                    children: [listItemState],
                };
            }
            else {
                if (!isListItemState(listItemState)) {
                    throw new TypeError(
                        'A bullet or order list must contain list-item state.',
                    );
                }
                state = listAsList instanceof OrderList
                    ? {
                            name: 'order-list',
                            meta: { ...listAsList.meta },
                            children: [listItemState],
                        }
                    : {
                            name: 'bullet-list',
                            meta: { ...listAsList.meta },
                            children: [listItemState],
                        };
            }
            newList = ScrollPage.createStateBlock(muya, state);
            prevListItem!.append(newList as Parent, 'user');
        }
        else {
            (newList as Parent).append(
                ScrollPage.createStateBlock(
                    muya,
                    releaseListItemLayoutTrivia(listItem.getState()),
                ),
                'user',
            );
        }

        listItem.remove();

        // newList.lastChild is the just-appended list-item (a Parent) at
        // runtime; find/firstContentInDescendant live on Parent. find()
        // returns the matched TreeNode (which is itself a Parent at runtime
        // for nested-list cases).
        const matched = ((newList as Parent).lastChild as Parent).find(offset) as Parent | undefined;
        const cursorBlock = matched?.firstContentInDescendant();
        cursorBlock?.setCursor(start.offset, end.offset, true);
    }

    protected override insertTab() {
        const { muya, text } = this;
        const { tabSize } = muya.options;
        const tabCharacter = String.fromCharCode(32).repeat(tabSize);
        const { start, end } = this.getCursor()!;

        if (this.isCollapsed) {
            this.text
                = text.substring(0, start.offset)
                    + tabCharacter
                    + text.substring(end.offset);
            const offset = start.offset + tabCharacter.length;

            this.setCursor(offset, offset, true);
        }
    }

    private _checkCursorAtEndFormat(): Nullable<{ offset: number }> {
        const { offset } = this.getCursor()!.start;
        // TODO: add labels in tokenizer...
        const { muya, text } = this;
        const tokens = tokenizer(text, {
            hasBeginRules: false,
            options: {
                ...muya.options,
                criticMarkup: false,
                criticMarkupDocumentFragments: [],
            },
        });
        let result = null;

        const walkTokens = (ts: Token[]) => {
            for (const token of ts) {
                const { type, range } = token;
                const { start, end } = range;

                if (
                    BOTH_SIDES_FORMATS.includes(type)
                    && offset > start
                    && offset < end
                ) {
                    const handler = END_FORMAT_HANDLERS[type];
                    const hit = handler ? handler(token, offset) : null;
                    if (hit) {
                        result = hit;

                        return;
                    }
                }

                if ('children' in token && Array.isArray(token.children))
                    walkTokens(token.children);
            }
        };

        walkTokens(tokens);

        return result;
    }

    override tabHandler(event: Event) {
    // disable tab focus
        event.preventDefault();

        if (!isKeyboardEvent(event))
            return;

        const { start, end } = this.getCursor()!;
        if (!start || !end)
            return;

        if (event.shiftKey) {
            const unindentType = this._getUnindentType();

            if (unindentType != null)
                this._unindentListItem(unindentType);

            return;
        }

        // Handle `tab` to jump to the end of format when the cursor is at the end of format content.
        if (this.isCollapsed) {
            const atEnd = this._checkCursorAtEndFormat();

            if (atEnd) {
                const offset = start.offset + atEnd.offset;

                this.setCursor(offset, offset, true);
                return;
            }
        }

        if (this._canIndentListItem()) {
            this._indentListItem();
            return;
        }

        this.insertTab();
    }
}

export default ParagraphContent;
