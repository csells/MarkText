import type Content from './block/base/content';
import type Parent from './block/base/parent';
import type {
    ICriticMarkupCommandState,
    ICriticMarkupItem,
    ICriticMarkupTarget,
    TCriticMarkupAuthorInput,
    TCriticMarkupAuthorType,
    TCriticMarkupFocusTarget,
    TCriticMarkupNavigationDirection,
} from './criticMarkup/commands';
import type { TCriticMarkupDecision } from './criticMarkup/project';
import type { ICriticMarkupReviewEditor } from './criticMarkup/reviewContract';
import type { ICriticMarkupReviewSnapshot } from './criticMarkup/reviewSnapshot';
import type { Listener } from './event/types';
import type { ILocale } from './i18n/types';
import type { IReplaceOption, ISearchOption } from './search/types';
import type { IIndexCursor } from './selection/offsetCursor';
import type { IHistorySelection, IPublicCursorInput } from './selection/types';
import type { ITocItem } from './state/getTOC';
import type {
    IBlockQuoteState,
    IBulletListState,
    ICodeBlockState,
    IListItemState,
    IOrderListState,
    ITableState,
    ITaskListItemState,
    ITaskListState,
    TState,
} from './state/types';
import type { IMuyaOptions, Nullable } from './types';
import Format from './block/base/format';
import { canTurnInto, insertBlockBelowByLabel, insertFrontMatterAtStart, replaceBlockByLabel } from './block/blockTransforms';
import { ScrollPage } from './block/scrollPage';
import emptyStates from './config/emptyStates';
import {
    CLASS_NAMES,
    DATA_URL_REG,
    MUYA_DEFAULT_OPTIONS,
    URL_REG,
} from './config/index';
import { MuyaCriticMarkup } from './criticMarkup/commands';
import { Editor } from './editor/index';

import EventCenter from './event/index';
import I18n from './i18n/index';
import { MutationCommandDispatcher } from './mutation/commandDispatcher';
import { replaceDocumentContent } from './mutation/documentReplacement';
import {
    applyAppearance,
    CROSS_BLOCK_LIST_LABELS,
    getContainer,
    PARAGRAPH_LABEL_MAP,
    PARSE_AFFECTING_OPTIONS,
    stripListSpacingTrivia,
    TOGGLEABLE_BLOCK_LABELS,
} from './muyaFacadeSupport';
import { CursorController } from './selection/cursorController';
import { isAnyListState, isAtxHeadingState, isCodeBlockState } from './state/types';
import { Ui } from './ui/ui';
import { deepClone } from './utils';
import { encodeImageSrc } from './utils/image';
import './assets/styles/blockSyntax.css';
import './assets/styles/index.css';
import './assets/styles/inlineSyntax.css';
import './assets/styles/prismjs/light.theme.css';

// UI plugins (e.g. InlineFormatToolbar, EmojiSelector) follow a common
// shape: a class with a static `pluginName` and a constructor that takes
// `(muya: Muya, options: object)`. `Muya.use` records the constructor + an
// arbitrary options object; `init()` instantiates each plugin.
export interface IMuyaPluginConstructor<TOptions = undefined> {
    pluginName: string;
    new(muya: Muya, options?: TOptions): unknown;
}

interface IPlugin {
    pluginName: string;
    create: (muya: Muya) => unknown;
}

// A selection reduced to document paths + offsets, with block references
// dropped so it survives a wholesale tree rebuild (paths are re-resolved
// against the fresh tree). Used to keep the caret/selection put across a
// loose/tight list toggle.
interface ISelectionSnapshot {
    anchor: number;
    focus: number;
    anchorPath: (string | number)[];
    focusPath: (string | number)[];
}

// Maps the paragraph-menu labels the desktop sends through `updateParagraph`
// to muya's `replaceBlockByLabel` vocabulary.
function endpointPair(
    anchor: Nullable<Parent>,
    focus: Nullable<Parent>,
): { anchor: Parent; focus: Parent } | null {
    return anchor && focus ? { anchor, focus } : null;
}

export class Muya implements ICriticMarkupReviewEditor {
    static plugins: IPlugin[] = [];

    static use<TOptions>(
        plugin: IMuyaPluginConstructor<TOptions>,
        options?: TOptions,
    ) {
        const Plugin = plugin;
        this.plugins.push({
            pluginName: plugin.pluginName,
            create: muya => new Plugin(muya, options),
        });
    }

    public readonly version = typeof window.MUYA_VERSION === 'undefined' ? 'dev' : window.MUYA_VERSION;
    public options: IMuyaOptions = MUYA_DEFAULT_OPTIONS;
    public eventCenter: EventCenter;
    public domNode: HTMLElement;
    public editor: Editor;
    public ui: Ui;
    public i18n: I18n;

    private _uiPlugins: Record<string, unknown> = {};
    private _criticMarkup: MuyaCriticMarkup;
    private _mutationCommands: MutationCommandDispatcher;
    private _cursorController: CursorController;

    constructor(element: HTMLElement, options?: Partial<IMuyaOptions>) {
        this.options = Object.assign({}, MUYA_DEFAULT_OPTIONS, options ?? {});
        this.eventCenter = new EventCenter();
        this.domNode = getContainer(element, this.options);
        // this.domNode[BLOCK_DOM_PROPERTY] = this;
        this.editor = new Editor(this);
        this.ui = new Ui(this);
        this.i18n = new I18n(this, this.options.locale);
        this._criticMarkup = new MuyaCriticMarkup(this);
        this._mutationCommands = new MutationCommandDispatcher(
            this.editor.mutationGateway,
        );
        this._cursorController = new CursorController(this);
        this._bindFocusBlurEvents();
    }

    private _bindFocusBlurEvents() {
        this.eventCenter.attachDOMEvent(this.domNode, 'focus', () => {
            this.eventCenter.emit('focus');
        });
        this.eventCenter.attachDOMEvent(this.domNode, 'blur', () => {
            this.eventCenter.emit('blur');
        });
    }

    init() {
        this.editor.init();

        // UI plugins
        if (Muya.plugins.length) {
            for (const { pluginName, create } of Muya.plugins)
                this._uiPlugins[pluginName] = create(this);
        }
    }

    locale(object: ILocale) {
        this.i18n.locale(object);
        if (this.editor.scrollPage)
            this._forceRender();
    }

    /**
     * [on] on custom event
     */
    on(event: string, listener: Listener) {
        this.eventCenter.on(event, listener);
    }

    /**
     * [off] off custom event
     */
    off(event: string, listener: Listener) {
        this.eventCenter.off(event, listener);
    }

    /**
     * [once] subscribe event and listen once
     */
    once(event: string, listener: Listener) {
        this.eventCenter.once(event, listener);
    }

    getState() {
        return this.editor.jsonState.getState();
    }

    getMarkdown() {
        return this.editor.jsonState.getMarkdown();
    }

    // Flush queued edits synchronously; call before swapping the document out
    // (e.g. a tab switch) so a same-frame keystroke isn't lost (#2938).
    flush() {
        this.editor.jsonState.flush();
    }

    getTOC(): ITocItem[] {
        return this.editor.jsonState.getTOC();
    }

    undo() {
        this._mutationCommands.run(
            { kind: 'history-command' },
            () => this.editor.history.undo(),
        );
    }

    redo() {
        this._mutationCommands.run(
            { kind: 'history-command' },
            () => this.editor.history.redo(),
        );
    }

    getHistory() {
        return this.editor.history.getHistory();
    }

    setHistory(history: ReturnType<Muya['getHistory']>) {
        this.editor.history.setHistory(history);
    }

    /**
     * Clear the undo/redo history (e.g. after loading a fresh document).
     */
    clearHistory() {
        this.editor.history.clear();
    }

    /**
     * Search value in current document.
     * @param {string} value
     * @param {object} opts
     */
    search(value: string, opts: ISearchOption = {}) {
        return this.editor.searchModule.search(value, opts);
    }

    /**
     * Find preview or next value, and highlight it.
     * @param {string} action : previous or next.
     */
    find(action: 'previous' | 'next') {
        return this.editor.searchModule.find(action);
    }

    replace(
        replaceValue: string,
        opt: IReplaceOption = { isSingle: true, isRegexp: false },
    ) {
        return this.editor.searchModule.replace(replaceValue, opt);
    }

    setContent(content: TState[] | string, autoFocus = false) {
        this.editor.setContent(content, autoFocus);
        this._criticMarkup.publishReviewSnapshot();
    }

    replaceContent(content: TState[] | string, recordSelection?: Nullable<IHistorySelection>): boolean {
        return this._mutationCommands.runBoolean(
            { kind: 'document-replace' },
            () => this._replaceContentCommand(content, recordSelection),
        );
    }

    /** Commit a prepared replacement only if its exact target selection exists. */
    replaceContentWithSelection(
        content: TState[] | string,
        recordSelection: Nullable<IHistorySelection>,
        nextSelection: IHistorySelection,
    ): boolean {
        return this._mutationCommands.runBoolean(
            { kind: 'document-replace' },
            () => this._replaceContentCommand(
                content,
                recordSelection,
                nextSelection,
            ),
        );
    }

    private _replaceContentCommand(
        content: TState[] | string,
        recordSelection?: Nullable<IHistorySelection>,
        nextSelection?: IHistorySelection,
    ): boolean {
        return replaceDocumentContent(
            this,
            content,
            recordSelection,
            nextSelection,
        );
    }

    setOptions(options: Partial<IMuyaOptions>, forceRender = false) {
        const previousOptions = { ...this.options };
        const projectionChanged
            = options.criticMarkupProjection !== undefined
                && options.criticMarkupProjection
                !== this.options.criticMarkupProjection;
        const trackChangesChanged
            = options.criticMarkupTrackChanges !== undefined
                && options.criticMarkupTrackChanges
                !== this.options.criticMarkupTrackChanges;
        if (projectionChanged || trackChangesChanged)
            this.flush();
        const render = forceRender || projectionChanged;
        const parserOptionsChanged = Object.keys(options).some(key =>
            PARSE_AFFECTING_OPTIONS.has(key as keyof IMuyaOptions));
        const parseAffecting = render && parserOptionsChanged;
        const markdown = parseAffecting ? this.getMarkdown() : null;

        try {
            Object.assign(this.options, options);

            if (parseAffecting) {
                const { jsonState } = this.editor;
                this._mutationCommands.run(
                    { kind: 'document-reset' },
                    () => this.editor.reparseContent(
                        jsonState.markdownToState(markdown!),
                        !projectionChanged,
                        () => {
                            this.options = previousOptions;
                        },
                    ),
                );
            }
            else if (render) {
                // A pure projection switch re-derives the same block states
                // for every critic-free block, and nothing else about the
                // render context changed, so unchanged blocks can keep their
                // rendered DOM. Any other render-affecting change (locale,
                // diagram themes, an explicit forceRender with no option
                // delta) must repaint every block.
                const projectionOnly
                    = projectionChanged
                        && Object.keys(options).every(
                            key => key === 'criticMarkupProjection',
                        );
                this._forceRender(!projectionChanged, projectionOnly);
            }

            this._applyOptionEffects(options);
            if (projectionChanged || trackChangesChanged)
                this._criticMarkup.publishReviewSnapshot();
            if (parserOptionsChanged)
                this.editor.scheduleProjectionWarmup();
        }
        catch (error) {
            this.options = previousOptions;
            throw error;
        }
    }

    private _applyOptionEffects(options: Partial<IMuyaOptions>): void {
        if ('spellcheckEnabled' in options)
            this.domNode.setAttribute('spellcheck', options.spellcheckEnabled ? 'true' : 'false');

        if ('spellcheckHideMarks' in options) {
            this.domNode.classList.toggle(
                CLASS_NAMES.MU_HIDE_SPELLING_MARKS,
                !!options.spellcheckHideMarks,
            );
        }

        if ('hideQuickInsertHint' in options) {
            this.domNode.classList.toggle(
                CLASS_NAMES.MU_SHOW_QUICK_INSERT_HINT,
                !options.hideQuickInsertHint,
            );
        }

        applyAppearance(this.domNode, options);
    }

    private _forceRender(preserveSelection = true, reuseUnchangedBlocks = false) {
        const selection = preserveSelection
            ? this.editor.selection.getSelection()
            : null;
        // A view switch is not an edit: when the selection was deliberately
        // not preserved (projection changes invalidate its offsets), the
        // re-render must not grab focus or seat a caret at document start.
        this.editor.renderCurrentProjection(
            selection,
            reuseUnchangedBlocks,
            preserveSelection,
        );
    }

    /** Update list indentation and re-render so it takes effect. */
    setListIndentation(listIndentation: IMuyaOptions['listIndentation']) {
        this.setOptions({ listIndentation }, true);
        if (this.options.listIndentation !== listIndentation)
            return;
        // Parser-owned list spacing trivia preserves each item's original
        // spelling byte-for-byte, so the new indentation only reaches the
        // serializer once that spelling is explicitly released.
        const stripped = stripListSpacingTrivia(this.getState());
        this._mutationCommands.run(
            { kind: 'document-reset' },
            () => this.editor.reparseContent(stripped),
        );
    }

    focus() {
        this.editor.focus();
    }

    setFocusMode(focusMode: boolean) {
        if (focusMode)
            this.domNode.classList.add(CLASS_NAMES.MU_FOCUS_MODE);
        else
            this.domNode.classList.remove(CLASS_NAMES.MU_FOCUS_MODE);

        this.options.focusMode = focusMode;
    }

    selectAll() {
        this.editor.selection.selectAll();
    }

    format(type: string) {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._formatCommand(type),
        );
    }

    private _formatCommand(type: string) {
        const { selection } = this.editor;

        // Cross-leaf selection: apply to each formattable leaf in range. The
        // live DOM selection collapses across blocks, so detect via the cached
        // endpoints (the same ones the menu/IPC round-trip relies on). Compare
        // at the LEAF level, not the outmost block: two paragraphs nested in the
        // same blockquote share an outmost block but are distinct leaves (#3462).
        if (!this._selectionInSameLeaf()) {
            this._formatAcrossBlocks(type);
            return;
        }

        const sel = selection.getSelection();
        if (!sel)
            return;

        const { anchor, focus, isSelectionInSameBlock } = sel;
        const anchorBlock = anchor.block;

        if (!isSelectionInSameBlock || !(anchorBlock instanceof Format))
            return;

        // A heading's text includes its leading `# ` marker; never format the
        // marker itself, only the heading content. Clamp the start past it.
        const markerLen = this._headingMarkerLen(anchorBlock);
        let lo = Math.min(anchor.offset, focus.offset);
        const hi = Math.max(anchor.offset, focus.offset);
        if (markerLen > 0) {
            lo = Math.max(lo, markerLen);
            if (hi <= markerLen)
                return; // the selection lies entirely within the marker
        }

        // Restore the selection before applying the format — the menu/IPC
        // round-trip can drop the live DOM selection.
        selection.setSelection(
            { offset: lo, block: anchorBlock, path: anchor.path },
            { offset: hi, block: anchorBlock, path: focus.path },
        );

        anchorBlock.format(type);
    }

    canCreateCriticMarkup(type: TCriticMarkupAuthorType): boolean {
        return this._criticMarkup.canCreate(type);
    }

    createCriticMarkup(input: TCriticMarkupAuthorInput): boolean {
        return this._mutationCommands.runBoolean(
            { kind: 'review-command' },
            () => this._criticMarkup.create(input),
        );
    }

    getCriticMarkupItems(): ICriticMarkupItem[] {
        return this._criticMarkup.getItems();
    }

    getCriticMarkupCommandState(): ICriticMarkupCommandState {
        return this._criticMarkup.getCommandState();
    }

    getCriticMarkupReviewSnapshot(): ICriticMarkupReviewSnapshot {
        return this._criticMarkup.getReviewSnapshot();
    }

    getCriticMarkupCommentAtPoint(
        clientX: number,
        clientY: number,
    ): ICriticMarkupReviewSnapshot['items'][number] | null {
        return this._criticMarkup.commentAtPoint(clientX, clientY);
    }

    getCurrentCriticMarkupItem(): ICriticMarkupItem | null {
        return this._criticMarkup.getCurrentItem();
    }

    focusCriticMarkup(target: TCriticMarkupFocusTarget): ICriticMarkupItem | null {
        return this._criticMarkup.focus(target);
    }

    navigateCriticMarkup(direction: TCriticMarkupNavigationDirection): ICriticMarkupItem | null {
        return this._criticMarkup.navigate(direction);
    }

    resolveCriticMarkup(decision: TCriticMarkupDecision, target?: ICriticMarkupTarget): boolean {
        return this._mutationCommands.runBoolean(
            { kind: 'review-command' },
            () => this._criticMarkup.resolve(decision, target),
        );
    }

    resolveAllCriticMarkup(decision: TCriticMarkupDecision): number {
        return this._mutationCommands.runCount(
            { kind: 'review-command' },
            () => this._criticMarkup.resolveAll(decision),
        );
    }

    editCriticMarkupComment(target: ICriticMarkupTarget, text: string): boolean {
        return this._mutationCommands.runBoolean(
            { kind: 'review-command' },
            () => this._criticMarkup.editComment(target, text),
        );
    }

    // Belt-and-suspenders for host/programmatic ranges (an e2e DOM Range) that
    // never fire Muya's mouse handlers: snapshot the live DOM range into the
    // model so an authoring command survives the editor blur. Real mouse/keyboard
    // ranges already commit at mouseup/keyup. Ranges only — a caret is untouched.
    commitAuthoringSelection(): void {
        const selection = this.editor.selection.getSelection();
        if (selection && !selection.isCollapsed)
            this.editor.selection.commitSelectionToModel(selection.anchor, selection.focus);
    }

    private _formatAcrossBlocks(type: string) {
        if (type === 'link' || type === 'image')
            return;

        const range = this._orderedSelectionRange();
        if (!range)
            return;

        const { first, last, firstOffset, lastOffset } = range;

        // Restore the span across the formatted leaves using each leaf's
        // post-format offsets (adding a marker shifts them), so the SAME text
        // stays selected in both endpoints rather than collapsing onto the
        // pre-format offsets.
        let anchorLeaf: Content | null = null;
        let focusLeaf: Content | null = null;
        let anchorOffset = 0;
        let focusOffset = 0;

        let leaf: Content | null = first;
        while (leaf) {
            const start = leaf === first ? firstOffset : 0;
            const end = leaf === last ? lastOffset : leaf.text.length;
            const adjusted = this._formatLeafInRange(type, leaf, start, end);
            if (adjusted) {
                if (!anchorLeaf) {
                    anchorLeaf = leaf;
                    anchorOffset = adjusted.start;
                }
                focusLeaf = leaf;
                focusOffset = adjusted.end;
            }
            if (leaf === last)
                break;
            leaf = leaf.nextContentInContext() ?? null;
        }

        if (anchorLeaf && focusLeaf) {
            this.editor.selection.setSelection(
                { offset: anchorOffset, block: anchorLeaf, path: anchorLeaf.path },
                { offset: focusOffset, block: focusLeaf, path: focusLeaf.path },
            );
        }
    }

    /** The selection's first/last content leaves and offsets, in document order. */
    private _orderedSelectionRange() {
        const { selection } = this.editor;
        const anchorLeaf = selection.anchorBlock;
        const focusLeaf = selection.focusBlock;
        if (!anchorLeaf || !focusLeaf)
            return null;

        const sp = this.editor.scrollPage!;
        const anchorOut = anchorLeaf.outMostBlock;
        const focusOut = focusLeaf.outMostBlock;
        const forward = anchorOut && focusOut ? sp.offset(anchorOut) <= sp.offset(focusOut) : true;

        return {
            first: forward ? anchorLeaf : focusLeaf,
            last: forward ? focusLeaf : anchorLeaf,
            firstOffset: (forward ? selection.anchor?.offset : selection.focus?.offset) ?? 0,
            lastOffset: (forward ? selection.focus?.offset : selection.anchor?.offset) ?? 0,
        };
    }

    private _formatLeafInRange(type: string, leaf: Content, start: number, end: number): { start: number; end: number } | null {
        if (!(leaf instanceof Format))
            return null;

        // Never format a heading's leading `# ` marker, only its content.
        const from = Math.max(start, this._headingMarkerLen(leaf));
        if (end <= from)
            return null;

        const { selection } = this.editor;
        selection.setSelection(
            { offset: from, block: leaf, path: leaf.path },
            { offset: end, block: leaf, path: leaf.path },
        );
        leaf.format(type);

        // leaf.format ends with setCursor(adjustedStart, adjustedEnd), which
        // updates the cached selection — read the adjusted range back from it.
        return {
            start: selection.anchor?.offset ?? from,
            end: selection.focus?.offset ?? end,
        };
    }

    /** Length of a heading content's leading `#{1,6}` + space marker, else 0. */
    private _headingMarkerLen(leaf: Content): number {
        if (leaf.parent?.blockName !== 'atx-heading')
            return 0;

        return /^ {0,3}#{1,6}(?:\s+|$)/.exec(leaf.text)?.[0].length ?? 0;
    }

    replaceCurrentWordInlineUnsafe(word: string, replacement: string): boolean {
        const block = this.editor.activeContentBlock;
        if (!block)
            return false;
        const range = block.getCurrentWordRangeInlineUnsafe(word);
        if (!range)
            return false;

        return this._mutationCommands.runBoolean(
            { kind: 'user-command' },
            () => block.replaceCurrentWordInlineUnsafe(word, replacement),
            {
                path: [...block.path],
                start: range.start,
                end: range.end,
                inserted: replacement,
            },
        );
    }

    getSelection() {
        return this.editor.selection.getSelection();
    }

    hasFocus() {
        const { activeElement } = document;

        return this.domNode === activeElement || this.domNode.contains(activeElement);
    }

    blur(isRemoveAllRange = false, unSelect = false) {
        if (isRemoveAllRange)
            document.getSelection()?.removeAllRanges();

        if (unSelect)
            this.editor.selection.clearImage();

        this.editor.activeContentBlock = null;
        this.ui.hideAllFloatTools();
        this.domNode.blur();
    }

    /**
     * Hide every floating tool/menu (toolbars, pickers, front button, …).
     */
    hideAllFloatTools() {
        this.ui.hideAllFloatTools();
    }

    invalidateImageCache() {
        this.editor.inlineRenderer.invalidateImageCache();
    }

    copyAsMarkdown() {
        this.editor.clipboard.copyAsMarkdown();
    }

    /**
     * Copy the current selection as rendered HTML to the clipboard.
     */
    copyAsHtml() {
        this.editor.clipboard.copyAsHtml();
    }

    /**
     * Copy the current selection as rich text to the clipboard: the rendered
     * HTML goes in the `text/html` slot so a rich-text target (Word, email, a
     * contenteditable) renders formatting, and the markdown source goes in the
     * `text/plain` slot. Unlike {@link copyAsHtml}, which blanks `text/html`
     * and drops the markup into `text/plain` as literal source.
     */
    copyAsRich() {
        this.editor.clipboard.copyAsRich();
    }

    /**
     * Paste the clipboard content as plain text at the current cursor.
     */
    pasteAsPlainText(): Promise<void> {
        return this.editor.clipboard.pasteAsPlainText();
    }

    /**
     * Insert an image at the current cursor from an explicit `src` (a saved file
     * path or `data:` URL), routing through the configured `imageAction` like a
     * clipboard image paste. Drives the desktop macOS screenshot flow, which can
     * no longer rely on the removed `document.execCommand('paste')`.
     */
    pasteImage(src: string): Promise<void> {
        return this.editor.clipboard.pasteImage(src);
    }

    private _outmostBlockAtCursor(): Parent | null {
        const content = this.editor.activeContentBlock ?? this.editor.selection.anchorBlock;

        return content?.outMostBlock ?? null;
    }

    private _immediateBlockAtCursor(): Parent | null {
        const content = this.editor.activeContentBlock ?? this.editor.selection.anchorBlock;

        return content?.parent ?? null;
    }

    /**
     * Cross-block paragraph-menu handling: a selection that spans several
     * outmost blocks wraps each block into one list item. Returns true when the
     * operation was handled so the single-block path is skipped. Quote/code and
     * other cross-block targets are gated by the menu layer and fall through.
     */
    private _handleCrossBlockParagraph(type: string): boolean {
        if (this._selectionInSameBlock())
            return false;

        const label = PARAGRAPH_LABEL_MAP[type];
        if (CROSS_BLOCK_LIST_LABELS.has(label)) {
            this._wrapSelectedBlocksInList(label as 'bullet-list' | 'order-list' | 'task-list');
            return true;
        }
        if (label === 'block-quote') {
            this._wrapSelectedBlocksInQuote();
            return true;
        }
        if (label === 'code-block') {
            this._wrapSelectedBlocksInCodeBlock();
            return true;
        }

        return false;
    }

    /**
     * The outmost-block endpoints of the current selection. Prefers the pair
     * that spans two different outmost blocks: the live DOM selection is the
     * truth in the browser, but the cached selection endpoints survive the
     * menu/IPC round-trip (and the headless test environment, where
     * `Selection.extend` collapses a cross-node range to one block).
     */
    private _selectionEndpoints(): { anchor: Parent; focus: Parent } | null {
        const sel = this.editor.selection.getSelection();
        const live = endpointPair(sel?.anchor.block?.outMostBlock, sel?.focus.block?.outMostBlock);
        const cached = endpointPair(
            this.editor.selection.anchorBlock?.outMostBlock,
            this.editor.selection.focusBlock?.outMostBlock,
        );

        if (live && live.anchor !== live.focus)
            return live;
        if (cached && cached.anchor !== cached.focus)
            return cached;

        return live ?? cached;
    }

    /** Whether the current selection stays within a single outmost block. */
    private _selectionInSameBlock(): boolean {
        const endpoints = this._selectionEndpoints();
        if (!endpoints)
            return true;

        return endpoints.anchor === endpoints.focus;
    }

    /**
     * Whether the current selection stays within a single content leaf. Unlike
     * `_selectionInSameBlock` (outmost-block granularity, for paragraph-menu
     * dispatch), this compares the actual leaves so a selection spanning two
     * paragraphs nested in one blockquote is correctly treated as cross-leaf
     * for inline formatting (#3462).
     */
    private _selectionInSameLeaf(): boolean {
        const sel = this.editor.selection;
        const liveSel = sel.getSelection();
        const liveAnchor = liveSel?.anchor.block;
        const liveFocus = liveSel?.focus.block;
        if (liveAnchor && liveFocus && liveAnchor !== liveFocus)
            return false;
        const cachedAnchor = sel.anchorBlock;
        const cachedFocus = sel.focusBlock;
        if (cachedAnchor && cachedFocus && cachedAnchor !== cachedFocus)
            return false;

        return true;
    }

    /**
     * The contiguous run of OUTMOST (scrollPage-child) blocks the current
     * selection spans, in document order. Mirrors clipboard's outmost walk.
     */
    private _selectedOutmostBlocks(): Parent[] {
        const endpoints = this._selectionEndpoints();
        if (!endpoints)
            return [];

        const a = endpoints.anchor;
        const f = endpoints.focus;

        if (a === f)
            return [a];

        const sp = this.editor.scrollPage!;
        const start = sp.offset(a) <= sp.offset(f) ? a : f;
        const end = start === a ? f : a;
        const blocks: Parent[] = [];
        let node: Parent | null = start;
        while (node) {
            blocks.push(node);
            if (node === end)
                break;
            node = node.next as Parent | null;
        }

        return blocks;
    }

    /**
     * Select the full span of a freshly-wrapped container (first content leaf to
     * last) so the selection keeps covering the wrapped content. Best-effort.
     */
    private _selectWrappedContent(container: Parent) {
        const head = container.firstContentInDescendant();
        const tail = container.lastContentInDescendant();
        if (!head || !tail)
            return;

        this.editor.activeContentBlock = tail;
        this.editor.selection.setSelection(
            { offset: 0, block: head, path: head.path },
            { offset: tail.text.length, block: tail, path: tail.path },
        );
    }

    /**
     * Replace the selected outmost blocks with a single container built by
     * `buildState`, then position the cursor/selection via `place`. Shared by the
     * cross-block list / block-quote / code-block wraps (ported from muyajs's
     * handleListMenu / handleQuoteMenu / handleCodeBlockMenu multi-block branches).
     */
    private _wrapSelectedBlocks(
        buildState: (blocks: Parent[]) => TState,
        place: (container: Parent) => void,
    ) {
        const blocks = this._selectedOutmostBlocks();
        if (!blocks.length)
            return;

        const state = buildState(blocks);
        const container = ScrollPage.createStateBlock(
            this,
            state,
        );
        const parent = blocks[0].parent!;
        parent.insertBefore(container, blocks[0]);
        for (const b of blocks)
            b.remove();

        place(container);
    }

    /** Wrap the selected outmost blocks as items of a new list of `label`. */
    private _wrapSelectedBlocksInList(label: 'bullet-list' | 'order-list' | 'task-list') {
        const { bulletListMarker, orderListDelimiter, preferLooseListItem } = this.options;

        this._wrapSelectedBlocks(
            (blocks) => {
                if (label === 'task-list') {
                    const children: ITaskListItemState[] = blocks.map(b => ({
                        name: 'task-list-item',
                        meta: { checked: false },
                        children: [b.getState()],
                    }));
                    const state: ITaskListState = {
                        name: 'task-list',
                        meta: {
                            loose: preferLooseListItem,
                            marker: bulletListMarker,
                        },
                        children,
                    };
                    return state;
                }

                const children: IListItemState[] = blocks.map(b => ({
                    name: 'list-item',
                    children: [b.getState()],
                }));
                if (label === 'order-list') {
                    const state: IOrderListState = {
                        name: 'order-list',
                        meta: {
                            loose: preferLooseListItem,
                            delimiter: orderListDelimiter,
                            start: 1,
                        },
                        children,
                    };
                    return state;
                }

                const state: IBulletListState = {
                    name: 'bullet-list',
                    meta: {
                        loose: preferLooseListItem,
                        marker: bulletListMarker,
                    },
                    children,
                };
                return state;
            },
            container => this._selectWrappedContent(container),
        );
    }

    /** Wrap the selected outmost blocks into a single block-quote. */
    private _wrapSelectedBlocksInQuote() {
        this._wrapSelectedBlocks(
            (blocks) => {
                const state: IBlockQuoteState = {
                    name: 'block-quote',
                    children: blocks.map(b => b.getState()),
                };
                return state;
            },
            container => this._selectWrappedContent(container),
        );
    }

    /** Join the selected outmost blocks' text into a single fenced code block. */
    private _wrapSelectedBlocksInCodeBlock() {
        this._wrapSelectedBlocks(
            (blocks) => {
                const state: ICodeBlockState = {
                    name: 'code-block',
                    meta: { type: 'fenced', lang: '' },
                    text: this.editor.jsonState
                        .getMarkdownFromState(blocks.map(b => b.getState()))
                        .replace(/\n+$/, ''),
                };
                return state;
            },
            container => container.firstContentInDescendant()?.setCursor(0, 0, true),
        );
    }

    /**
     * Duplicate the block at the current cursor, placing the cursor in the
     * copy. No-op when there is no current block.
     */
    duplicate() {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._duplicateCommand(),
        );
    }

    private _duplicateCommand() {
        const block = this._outmostBlockAtCursor();
        if (!block)
            return;

        const state = deepClone(block.getState());
        const dupBlock = ScrollPage.createStateBlock(this, state);
        block.parent!.insertAfter(dupBlock, block);
        dupBlock.lastContentInDescendant()?.setCursor(0, 0, true);
    }

    /**
     * Insert an empty paragraph relative to the block at the current cursor.
     * @param location Insert `before` or `after` the current block (default `after`).
     * @param text Initial text of the new paragraph.
     * @param outMost When `true`, anchor the new paragraph to the OUTERMOST
     *   container (the legacy "Create Paragraph Below" behaviour). When `false`
     *   (default), anchor to the IMMEDIATE block at the cursor so the paragraph
     *   stays as an inner sibling inside a list item / blockquote — the legacy
     *   context-menu "Insert Paragraph Before/After" behaviour.
     */
    insertParagraph(location: 'before' | 'after' = 'after', text = '', outMost = false) {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._insertParagraphCommand(location, text, outMost),
        );
    }

    private _insertParagraphCommand(
        location: 'before' | 'after',
        text: string,
        outMost: boolean,
    ) {
        const block = outMost
            ? this._outmostBlockAtCursor()
            : this._immediateBlockAtCursor();
        if (!block)
            return;

        const state = deepClone(emptyStates.paragraph);
        state.text = text;
        const newBlock = ScrollPage.createStateBlock(this, state);
        if (location === 'before')
            block.parent!.insertBefore(newBlock, block);
        else
            block.parent!.insertAfter(newBlock, block);

        newBlock.lastContentInDescendant()?.setCursor(0, 0, true);
    }

    /**
     * Delete the block at the current cursor, moving the cursor to an adjacent
     * block, or to a fresh empty paragraph when it was the only block.
     */
    deleteParagraph() {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._deleteParagraphCommand(),
        );
    }

    private _deleteParagraphCommand() {
        const block = this._outmostBlockAtCursor();
        if (!block)
            return;

        let cursorBlock: Content | null = null;
        if (block.prev) {
            cursorBlock = block.prev.lastContentInDescendant();
        }
        else if (block.next) {
            cursorBlock = block.next.firstContentInDescendant();
        }
        else {
            const newBlock = ScrollPage.createStateBlock(
                this,
                deepClone(emptyStates.paragraph),
            );
            block.parent!.insertAfter(newBlock, block);
            cursorBlock = newBlock.lastContentInDescendant();
        }

        block.remove();
        cursorBlock?.setCursor(0, 0, true);
    }

    createTable({ rows, columns }: { rows: number; columns: number }, { replace = false }: { replace?: boolean } = {}) {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._createTableCommand({ rows, columns }, { replace }),
        );
    }

    private _createTableCommand(
        { rows, columns }: { rows: number; columns: number },
        { replace }: { replace: boolean },
    ) {
        const block = this._immediateBlockAtCursor();
        if (!block)
            return;

        const safeRows = Math.max(2, Number.isFinite(rows) ? Math.floor(rows) : 0);
        const safeColumns = Math.max(1, Number.isFinite(columns) ? Math.floor(columns) : 0);

        const makeRow = (): ITableState['children'][number] => ({
            name: 'table.row',
            children: Array.from({ length: safeColumns }, () => ({
                name: 'table.cell' as const,
                meta: { align: 'none' },
                text: '',
            })),
        });

        const state: ITableState = {
            name: 'table',
            children: Array.from({ length: safeRows }, makeRow),
        };

        const newTable = ScrollPage.createStateBlock(this, state);

        // An empty block is disposable, so replace it in place; a block with
        // real content is kept and the table goes directly below it. The picker
        // passes `replace` to always consume its trigger block.
        if (replace || this._blockLeadingText(block).trim() === '')
            block.replaceWith(newTable);
        else
            block.parent!.insertAfter(newTable, block);

        newTable.firstContentInDescendant()?.setCursor(0, 0, true);
    }

    /**
     * Insert an inline image at the current cursor in the active formattable
     * block. The `![alt](src)` markdown is
     * written through the `Format` block's text setter so it dispatches a JSON
     * op (state stays in sync) rather than mutating the DOM directly. No-op when
     * there is no active formattable (`Format`) block — e.g. inside a code block
     * or with no cursor.
     */
    insertImage({ src = '', alt = '' }: { src?: string; alt?: string }) {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._insertImageCommand({ src, alt }),
        );
    }

    private _insertImageCommand({ src, alt }: { src: string; alt: string }) {
        const block = this.editor.activeContentBlock ?? this.editor.selection.anchorBlock;
        if (!(block instanceof Format))
            return;

        const cursor = block.getCursor();
        if (cursor == null)
            return;

        // Derive a sensible alt from the file name when none is provided.
        if (!alt) {
            const match = /[/\\]?([^./\\]+)\.[a-z]+$/i.exec(src);
            alt = match?.[1] ?? '';
        }

        // Only percent-encode plain paths; leave full URLs / well-formed data
        // URLs as-is. `DATA_URL_REG` requires the full `data:image/<type>...,<payload>`
        // shape (the same regex `utils/image.ts` `getImageSrc` uses), so a bare
        // `data:image/` prefix is not embedded verbatim and instead falls through
        // to the plain-path branch.
        let imgUrl: string;
        if (URL_REG.test(src))
            imgUrl = encodeURI(src);
        else if (DATA_URL_REG.test(src))
            imgUrl = src;
        else
            imgUrl = encodeImageSrc(src);

        const { start, end } = cursor;
        const { text } = block;
        // When there is a selection, use it as the alt text.
        const imageAlt = start.offset !== end.offset ? text.substring(start.offset, end.offset) : alt;
        const imageText = `![${imageAlt}](${imgUrl})`;

        // The `text` setter diffs against the old value and dispatches a JSON op.
        block.text = text.substring(0, start.offset) + imageText + text.substring(end.offset);
        // Re-render and place the caret on the alt text (offset of `![`).
        block.setCursor(start.offset + 2, start.offset + 2 + imageAlt.length, true);
    }

    setCursor(cursor: IPublicCursorInput) {
        this._cursorController.set(cursor);
    }

    setCursorByOffset(indexCursor: IIndexCursor): boolean {
        return this._cursorController.setByOffset(indexCursor);
    }

    getCursorOffset(): IIndexCursor | null {
        return this._cursorController.getOffset();
    }

    updateParagraph(type: string) {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._updateParagraphCommand(type),
        );
    }

    private _updateParagraphCommand(type: string) {
        const block = this._outmostBlockAtCursor();
        if (!block)
            return;

        if (this._handleCrossBlockParagraph(type))
            return;

        if (type === 'upgrade heading' || type === 'degrade heading') {
            this._withPreservedOffset(() => this._changeHeadingLevel(block, type));
            return;
        }

        if (type === 'loose-list-item') {
            this._toggleLooseList(block);
            return;
        }

        // `reset-to-paragraph` returns the current block to plain paragraph
        // form; structured containers (lists/blockquote) unwrap to preserve
        // every child, tables are left untouched.
        if (type === 'reset-to-paragraph') {
            this.resetToParagraph(block);
            return;
        }

        const label = PARAGRAPH_LABEL_MAP[type];
        if (!label)
            return;

        // Front matter is only valid as the very first block of a document, so
        // it is never an in-place replacement of the cursor block: idempotent
        // no-op if the document already starts with front matter, otherwise
        // prepend one at the top.
        if (label === 'frontmatter') {
            insertFrontMatterAtStart(this);
            return;
        }

        // The plain `paragraph` menu item only converts the *leaf* block that
        // directly wraps the cursor (heading, hr, …) back to a paragraph; it
        // never touches the enclosing container. Operating on the leaf (not the
        // outermost container) means a heading inside a list item still converts
        // while the list stays intact, and avoids the data loss where routing
        // `paragraph` to the *whole* list/blockquote collapsed every item/line
        // into a single paragraph built from the first content's text.
        // `reset-to-paragraph` remains the explicit "unwrap the container"
        // command (handled above).
        if (label === 'paragraph')
            return this._convertLeafToParagraph();

        // Clicking an already-active type (its block is an ancestor of the
        // cursor, i.e. the menu item is checked) toggles it off: unwrap every
        // ancestor of that kind, or convert the matching leaf back to a paragraph.
        if (this._toggleIfActive(label))
            return;

        // A list kind clicked while inside a list of a DIFFERENT kind converts
        // the cursor's (innermost) list to that kind.
        if (label.endsWith('-list')) {
            const list = this._closestListAtCursor();
            if (list) {
                this._withPreservedOffset(() => this._convertListType(list, label));
                return;
            }
        }

        this._convertOrInsertBelow(label);
    }

    /**
     * If the cursor is inside a block matching `label` (the menu item is
     * checked), toggle it off and return true: unwrap EVERY ancestor of that
     * kind (so nested same-kind lists collapse in one click and the item ends up
     * un-checked), or convert a matching leaf (heading of that level / hr) back
     * to a paragraph. Returns false when nothing matches.
     */
    private _toggleIfActive(label: string): boolean {
        const cursorContent = () => this.editor.activeContentBlock ?? this.editor.selection.anchorBlock;
        const content = cursorContent();
        if (!content)
            return false;

        // Headings match only when the cursor's heading is exactly that level.
        if (label.startsWith('atx-heading ')) {
            const heading = content.closestBlock('atx-heading') as Parent | null;
            if (!heading)
                return false;

            const state = heading.getState();
            const level = Number(label.slice('atx-heading '.length));
            if (!isAtxHeadingState(state) || state.meta.level !== level)
                return false;

            this._withPreservedOffset(() => this.resetToParagraph(heading));
            return true;
        }

        if (!TOGGLEABLE_BLOCK_LABELS.has(label) || !content.closestBlock(label))
            return false;

        this._withPreservedOffset(() => {
            for (let guard = 0; guard < 20; guard++) {
                const target = cursorContent()?.closestBlock(label) as Parent | null;
                if (!target)
                    break;
                this.resetToParagraph(target);
            }
        });

        return true;
    }

    /** The nearest list ancestor of the cursor, of any kind. */
    private _closestListAtCursor(): Parent | null {
        let node: Nullable<Parent> = (this.editor.activeContentBlock ?? this.editor.selection.anchorBlock)?.parent;
        while (node) {
            if (node.blockName === 'bullet-list' || node.blockName === 'order-list' || node.blockName === 'task-list')
                return node;
            node = node.parent;
        }

        return null;
    }

    /**
     * Run a conversion, then restore the prior selection (anchor AND focus, so a
     * range stays selected) on the active content block — every conversion ends
     * with the caret's content active (unwraps restore it themselves).
     */
    private _withPreservedOffset(fn: () => void) {
        const { selection } = this.editor;
        const anchorBlock = selection.anchorBlock;
        const focusBlock = selection.focusBlock;
        const anchorOffset = selection.anchor?.offset ?? 0;
        const focusOffset = selection.focus?.offset ?? anchorOffset;
        const anchorText = anchorBlock?.text;
        const focusText = focusBlock?.text;
        const multiBlock = !!anchorBlock && !!focusBlock && anchorBlock !== focusBlock;

        fn();

        const clampTo = (n: number, len: number) => Math.max(0, Math.min(n, len));

        // A selection spanning several blocks (e.g. across list items) — re-find
        // both endpoints by their text so the whole span survives an unwrap.
        if (multiBlock && anchorText != null && focusText != null) {
            const a = this._findContentByText(anchorText);
            const f = this._findContentByText(focusText);
            if (a && f) {
                this.editor.selection.setSelection(
                    { offset: clampTo(anchorOffset, a.text.length), block: a, path: a.path },
                    { offset: clampTo(focusOffset, f.text.length), block: f, path: f.path },
                );
                return;
            }
        }

        // Single block: the caret's content is the active block (in-place result
        // or unwrap-restored). The text can change in place (a heading's `# `
        // marker), so shift offsets by that front delta to track the same char.
        const target = this.editor.activeContentBlock;
        if (!target)
            return;

        const delta = anchorText != null && target.text !== anchorText
            ? target.text.length - anchorText.length
            : 0;
        const len = target.text.length;
        target.setCursor(clampTo(anchorOffset + delta, len), clampTo(focusOffset + delta, len), true);
    }

    /**
     * The first FORMATTABLE content leaf whose text equals `text`, in document
     * order. Restricting to Format leaves skips marker-only content (a thematic
     * break's `---`, code/math/html), so toggling one never lands the caret on
     * an unrelated block that happens to share that text.
     */
    private _findContentByText(text: string): Content | null {
        let leaf: Nullable<Content> = this.editor.scrollPage?.firstContentInDescendant();
        while (leaf) {
            if (leaf instanceof Format && leaf.text === text)
                return leaf;
            leaf = leaf.nextContentInContext();
        }

        return null;
    }

    /**
     * General same-block conversion: the front menu's turn-into set is the
     * single source of truth. Operate on the IMMEDIATE block so a heading inside
     * a list item converts while the list stays intact; a target that is not a
     * valid turn-into replaces an empty block in place, or is inserted as a new
     * block directly below a non-empty one (focus moves into it).
     */
    private _convertOrInsertBelow(label: string) {
        const immediate = this._immediateBlockAtCursor();
        if (!immediate)
            return;

        const leadingText = this._blockLeadingText(immediate);
        if (canTurnInto(immediate, label)) {
            this._withPreservedOffset(() => replaceBlockByLabel({ block: immediate, muya: this, label, text: leadingText }));
            return;
        }

        if (leadingText.trim() === '')
            replaceBlockByLabel({ block: immediate, muya: this, label, text: '' });
        else
            insertBlockBelowByLabel({ block: immediate, muya: this, label });
    }

    /**
     * Return a block to plain paragraph form: lists and blockquotes unwrap to
     * preserve every child, tables are left untouched, and everything else is
     * replaced by a paragraph carrying its leading text. Public so the
     * paragraph front menu can reset the block it targets (not just the cursor
     * block).
     */
    resetToParagraph(block: Parent) {
        this._mutationCommands.run(
            { kind: 'user-command' },
            () => this._resetToParagraphCommand(block),
        );
    }

    private _resetToParagraphCommand(block: Parent) {
        if (block.blockName === 'table')
            return;

        if (isAnyListState(block.getState()) || block.blockName === 'block-quote') {
            this._unwrapToParagraphs(block);
            return;
        }

        replaceBlockByLabel({ block, muya: this, label: 'paragraph', text: this._paragraphTextFor(block) });
    }

    /**
     * The text a plain paragraph should carry when `block` is reset/converted to
     * one: a code block keeps its raw code; a thematic break is all marker
     * (`---` / `***` / …) with no content, so it yields an empty paragraph;
     * everything else keeps its leading text (heading hashes stripped).
     */
    private _paragraphTextFor(block: Parent): string {
        const state = block.getState();
        if (isCodeBlockState(state))
            return state.text;
        if (block.blockName === 'thematic-break')
            return '';

        return this._blockLeadingText(block);
    }

    /**
     * Convert the *leaf* block that directly wraps the cursor (the immediate
     * parent of the active content) to a plain paragraph. No-op when that leaf
     * is already a paragraph. Because it targets the leaf rather
     * than the outermost container, a heading inside a list item / blockquote
     * converts to a paragraph while leaving the surrounding list/quote intact.
     */
    private _convertLeafToParagraph() {
        const leaf = this._immediateBlockAtCursor();
        if (!leaf || leaf.blockName === 'paragraph')
            return;

        this._withPreservedOffset(() => replaceBlockByLabel({
            block: leaf,
            muya: this,
            label: 'paragraph',
            text: this._paragraphTextFor(leaf),
        }));
    }

    /**
     * Unwrap a structured container (list or blockquote) into the top-level
     * blocks it contains, preserving every item.
     */
    private _unwrapToParagraphs(block: Parent) {
        // A detached block has no parent to reparent its children into (#4686).
        const parent = block.parent;
        if (!parent)
            return;

        const state = block.getState();
        let inner: TState[] = [];
        if (isAnyListState(state))
            inner = state.children.flatMap(li => deepClone(li.children));
        else if (state.name === 'block-quote')
            inner = deepClone(state.children);

        if (!inner.length)
            return;

        const cursorText = (this.editor.activeContentBlock ?? this.editor.selection.anchorBlock)?.text;
        let ref: Parent = block;
        let firstNew: Parent | null = null;
        for (const childState of inner) {
            const newBlock = ScrollPage.createStateBlock(this, childState);
            parent.insertAfter(newBlock, ref);
            ref = newBlock;
            firstNew ??= newBlock;
        }

        block.remove();

        // Keep the caret in the lifted block that still holds the cursor's text
        // (its content was cloned), falling back to the first lifted block.
        const restored = (cursorText != null ? this._findContentByText(cursorText) : null)
            ?? firstNew?.firstContentInDescendant();
        restored?.setCursor(0, 0, true);
    }

    /** Leading text of a block, with the atx hash run stripped for headings. */
    private _blockLeadingText(block: Parent): string {
        const text = block.firstContentInDescendant()?.text ?? '';

        return block.blockName === 'atx-heading'
            ? text.replace(/^ {0,3}#{1,6}(?:\s+|$)/, '')
            : text;
    }

    /** Cycle the heading level (marktext upgrade/degrade semantics). */
    private _changeHeadingLevel(block: Parent, type: 'upgrade heading' | 'degrade heading') {
        const state = block.getState();
        const level = isAtxHeadingState(state) ? state.meta.level : 0;
        let newLevel = level;

        if (type === 'upgrade heading' && level !== 1)
            newLevel = level === 0 ? 6 : level - 1;
        else if (type === 'degrade heading' && level !== 0)
            newLevel = level === 6 ? 0 : level + 1;

        if (newLevel === level)
            return;

        replaceBlockByLabel({
            block,
            muya: this,
            label: newLevel === 0 ? 'paragraph' : `atx-heading ${newLevel}`,
            text: this._blockLeadingText(block),
        });
    }

    /** Toggle loose/tight on the list at the cursor. */
    private _toggleLooseList(block: Parent) {
        const state = block.getState();
        if (!isAnyListState(state))
            return;

        // Toggling only flips meta.loose, so the rebuilt list keeps the same
        // structure and document position. Snapshot the selection as paths +
        // offsets so a caret OR a multi-item range can be restored afterwards
        // instead of collapsing to the first item.
        const snapshot = this._snapshotSelection();

        const newState = deepClone(state);
        newState.meta.loose = !newState.meta.loose;
        const newBlock = ScrollPage.createStateBlock(this, newState);
        block.replaceWith(newBlock);

        if (!this._restoreSelection(snapshot))
            newBlock.firstContentInDescendant()?.setCursor(0, 0, true);
    }

    /**
     * Capture the current selection as document paths + offsets. The live DOM
     * selection is the source of truth (it carries a click-placed caret), with
     * the cached selection — committed on mouse-up and surviving the menu/IPC
     * round-trip — as the fallback. Block references are intentionally dropped:
     * they go stale when the list is rebuilt, so the paths are re-resolved on
     * restore.
     */
    private _snapshotSelection(): ISelectionSnapshot | null {
        const sel = this.editor.selection;
        const live = sel.getSelection();

        // The live DOM selection carries a click-placed caret, so it is the
        // source of truth for a single block. But it COLLAPSES to one block for
        // a cross-block selection — so when the cached endpoints (committed on
        // mouse-up, the same ones the menu/IPC round-trip relies on) span
        // several blocks while live has collapsed, trust the cached endpoints so
        // the whole span survives the rebuild.
        const cachedCrossBlock = !!sel.anchorBlock && !!sel.focusBlock && sel.anchorBlock !== sel.focusBlock;
        const useLive = !!live && !(cachedCrossBlock && live.isSelectionInSameBlock);

        const anchor = useLive ? live!.anchor : sel.anchor;
        const focus = useLive ? live!.focus : sel.focus;
        const anchorPath = useLive ? live!.anchor.path : sel.anchorPath;
        const focusPath = useLive ? live!.focus.path : sel.focusPath;
        if (!anchor || !focus || !anchorPath?.length || !focusPath?.length)
            return null;

        return {
            anchor: anchor.offset,
            focus: focus.offset,
            anchorPath: [...anchorPath],
            focusPath: [...focusPath],
        };
    }

    /**
     * Re-resolve a snapshot's paths against the live tree and re-apply it via
     * the selection API. Returns false when either path no longer resolves to a
     * content block so the caller can fall back.
     */
    private _restoreSelection(snapshot: ISelectionSnapshot | null): boolean {
        if (!snapshot)
            return false;

        const { scrollPage } = this.editor;
        // `queryBlock` consumes its path array in place, so resolve against copies.
        const anchorBlock = scrollPage?.queryBlock([...snapshot.anchorPath]);
        const focusBlock = scrollPage?.queryBlock([...snapshot.focusPath]);
        if (!anchorBlock || !focusBlock)
            return false;
        if (!anchorBlock.isContent() || !focusBlock.isContent())
            return false;

        this.editor.activeContentBlock = focusBlock;
        this.editor.selection.setSelection(
            { offset: snapshot.anchor, block: anchorBlock, path: [...snapshot.anchorPath] },
            { offset: snapshot.focus, block: focusBlock, path: [...snapshot.focusPath] },
        );

        return true;
    }

    /** Convert an existing list to another list type, preserving items. */
    private _convertListType(block: Parent, label: string) {
        const state = block.getState();
        if (!isAnyListState(state) || block.blockName === label)
            return;

        const { bulletListMarker, orderListDelimiter } = this.options;
        const loose = !!state.meta.loose;
        const childContents: TState[][] = state.children.map(li => deepClone(li.children));

        let newState: IBulletListState | IOrderListState | ITaskListState;
        if (label === 'task-list') {
            newState = {
                name: 'task-list',
                meta: { marker: bulletListMarker, loose },
                children: childContents.map(children => ({
                    name: 'task-list-item',
                    meta: { checked: false },
                    children,
                })),
            };
        }
        else if (label === 'order-list') {
            newState = {
                name: 'order-list',
                meta: { delimiter: orderListDelimiter, loose, start: 1 },
                children: childContents.map(children => ({ name: 'list-item', children })),
            };
        }
        else {
            newState = {
                name: 'bullet-list',
                meta: { marker: bulletListMarker, loose },
                children: childContents.map(children => ({ name: 'list-item', children })),
            };
        }

        const newBlock = ScrollPage.createStateBlock(this, newState);
        block.replaceWith(newBlock);
        newBlock.firstContentInDescendant()?.setCursor(0, 0, true);
    }

    destroy() {
        this.editor.cancelProjectionWarmup();
        this.eventCenter.detachAllDomEvents();
        this.eventCenter.unsubscribeAll();
        // this.domNode[BLOCK_DOM_PROPERTY] = null;
        if (this.domNode.remove)
            this.domNode.remove();

        // Hide all float tools.
        if (this.ui)
            this.ui.hideAllFloatTools();

        // Destroy every registered UI plugin so the nodes they appended to
        // `document.body` (float boxes, the image resize bar, tooltips) are
        // removed rather than leaked (#3315).
        for (const plugin of Object.values(this._uiPlugins)) {
            const destroy = (plugin as { destroy?: unknown })?.destroy;
            if (typeof destroy === 'function')
                (destroy as () => void).call(plugin);
        }
    }
}
