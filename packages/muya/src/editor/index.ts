import type { JSONOp } from 'ot-json1';
import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type { CriticMarkupAnalysis } from '../criticMarkup/analysis';
import type { IMutationAuthority } from '../mutation/authority';
import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { TState } from '../state/types';
import type { Nullable } from '../types';
import { fromEvent, merge } from 'rxjs';
import { registerBlocks } from '../block';
import { ScrollPage } from '../block/scrollPage';
import Clipboard from '../clipboard';
import { CLASS_NAMES, isFirefox } from '../config';
import { CriticMarkupDocumentService } from '../criticMarkup/documentService';
import History from '../history';
import InlineRenderer from '../inlineRenderer';
import { createMutationAuthority } from '../mutation/authority';
import { PostCommitNotificationError } from '../mutation/errors';
import { MutationGateway } from '../mutation/gateway';
import { Search } from '../search';
import Selection from '../selection';
import JSONState from '../state';
import { statesEqual } from '../state/stateEquality';
import { deepClone, isHTMLElement, isKeyboardEvent } from '../utils';
import { CollectedError } from '../utils/collectedError';
import { getBlock } from '../utils/dom';
import logger from '../utils/logger';
import { applyBlockTreeOperations } from './blockTreeOperations';
import { attachDragDropImageHandlers } from './dragDropImage';
import { attachLinkMouseHandlers } from './linkMouseEvents';

const debug = logger('editor:');

export class Editor {
    jsonState: JSONState;
    inlineRenderer: InlineRenderer;
    selection: Selection;
    searchModule: Search;
    clipboard: Clipboard;
    history: History;
    criticMarkupDocument: CriticMarkupDocumentService;
    mutationGateway: MutationGateway;
    scrollPage: Nullable<ScrollPage> = null;

    private _activeContentBlock: Nullable<Content> = null;
    private _compositionContentBlock: Nullable<Content> = null;
    private readonly _mutationAuthority: IMutationAuthority;
    private _treeRebuildDepth = 0;
    private readonly _projectionStateCache = new Map<'original' | 'revised', TState[]>();
    private _projectionCacheVersion = -1;
    private _projectionCacheAnalysis: CriticMarkupAnalysis | null = null;
    private _projectionWarmupTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private _muya: Muya) {
        const state = _muya.options.json || _muya.options.markdown || '';
        const mutationAuthority = createMutationAuthority();
        this._mutationAuthority = mutationAuthority;

        this.jsonState = new JSONState(_muya, state, mutationAuthority);
        this.criticMarkupDocument = new CriticMarkupDocumentService(_muya);
        this.inlineRenderer = new InlineRenderer(_muya);
        this.selection = new Selection(_muya);
        this.searchModule = new Search(_muya);
        this.clipboard = Clipboard.create(_muya);
        this.history = new History(_muya);
        this.mutationGateway = new MutationGateway(_muya, mutationAuthority);
    }

    get activeContentBlock() {
        return this._activeContentBlock;
    }

    set activeContentBlock(block) {
        const { activeContentBlock: oldActiveContentBlock } = this;
        if (block !== oldActiveContentBlock) {
            this._activeContentBlock = block;
            if (oldActiveContentBlock?.domNode?.isConnected)
                oldActiveContentBlock.blurHandler();

            if (block)
                block.focusHandler();
        }
    }

    /** Attached-tree writers require either a mutation or private rebuild scope. */
    assertTreeMutationAuthorized(operation: string): void {
        if (this._treeRebuildDepth === 0)
            this.mutationGateway.assertActive(operation);
    }

    private _isCanonicalProjection() {
        return this._muya.options.criticMarkupProjection === 'marked';
    }

    private _stateForCurrentProjection(): TState[] {
        const projection = this._muya.options.criticMarkupProjection;
        if (projection === 'marked')
            return this.jsonState.getState();
        return this._projectedState(projection);
    }

    /**
     * Derive the read-only projected state, parsing each projection of a
     * document revision at most once. An item-free document projects to its
     * own bytes, so the canonical state is exact without a reparse.
     */
    private _projectedState(projection: 'original' | 'revised'): TState[] {
        const document = this.criticMarkupDocument.get();
        if (!document.items.length)
            return this.jsonState.getState();
        const version = this.jsonState.documentVersion;
        if (
            this._projectionCacheVersion !== version
            || this._projectionCacheAnalysis !== document.analysis
        ) {
            this._projectionCacheVersion = version;
            this._projectionCacheAnalysis = document.analysis;
            this._projectionStateCache.clear();
        }
        let state = this._projectionStateCache.get(projection);
        if (!state) {
            state = this.jsonState.markdownToState(document.project(projection));
            this._projectionStateCache.set(projection, state);
        }
        return deepClone(state);
    }

    /**
     * Parse the read-only projections ahead of the first view switch so
     * toggling stays interactive on large documents. The warmup is deferred
     * off the reset path — projection parsing of pathological input can cost
     * seconds and must never gate document open — and self-cancels when the
     * editor is destroyed or the document changed before it ran.
     */
    scheduleProjectionWarmup(): void {
        if (this._projectionWarmupTimer !== null)
            clearTimeout(this._projectionWarmupTimer);
        // `data-critic-warm` marks the steady interactive state: automation
        // measuring view-switch latency waits for it instead of racing the
        // warmup parse.
        this._muya.domNode.removeAttribute('data-critic-warm');
        this._projectionWarmupTimer = setTimeout(() => {
            this._projectionWarmupTimer = null;
            if (!this.scrollPage)
                return;
            if (this._mutationAuthority.active) {
                // A mutation owns the document right now; defer rather than
                // drop, or the steady-state marker never appears.
                this.scheduleProjectionWarmup();
                return;
            }
            if (this.criticMarkupDocument.get().items.length) {
                this._projectedState('original');
                this._projectedState('revised');
            }
            this._muya.domNode.setAttribute('data-critic-warm', 'true');
        }, 0);
    }

    cancelProjectionWarmup(): void {
        if (this._projectionWarmupTimer !== null) {
            clearTimeout(this._projectionWarmupTimer);
            this._projectionWarmupTimer = null;
        }
    }

    private _syncProjectionAttributes() {
        const projection = this._muya.options.criticMarkupProjection;
        const readOnly = projection !== 'marked';
        this._muya.domNode.setAttribute('data-critic-projection', projection);

        this.scrollPage?.breadthFirstTraverse((node) => {
            if (node.isContent()) {
                node.domNode?.setAttribute(
                    'contenteditable',
                    readOnly ? 'false' : 'true',
                );
            }
        });
    }

    init() {
        registerBlocks();

        const muya = this._muya;
        const state = this._stateForCurrentProjection();

        this.scrollPage = ScrollPage.create(muya, state);
        this.inlineRenderer.refreshCriticMarkupDocumentFragments();
        this._syncProjectionAttributes();
        this.scheduleProjectionWarmup();

        this._dispatchEvents();
        // Hovering a rendered link wrapper dispatches `muya-link-tools` so the
        // staged popover lights up. Cleanup is handled by `muya.destroy()` →
        // `detachAllDomEvents`.
        attachLinkMouseHandlers(muya);
        // Dropping an image file or web-link image into the editor inserts it
        // as a new `![](src)` block. Cleanup is likewise handled by
        // `detachAllDomEvents`.
        attachDragDropImageHandlers(muya);
        if (this._isCanonicalProjection())
            this.focus();
    }

    private _handleKeydown(anchorBlock: Content, event: Event): void {
        if (isKeyboardEvent(event))
            this.selection.prepareHiddenCriticCommentCaretNavigation(event);
        const mutation = () => anchorBlock.keydownHandler(event);
        if (
            isKeyboardEvent(event)
            && ['Backspace', 'Delete', 'Enter', 'Tab'].includes(event.key)
        ) {
            this.mutationGateway.run(
                { kind: 'user-command' },
                mutation,
            );
        }
        else {
            mutation();
        }
    }

    private _handleKeyup(event: Event): void {
        if (isKeyboardEvent(event))
            this.selection.finishHiddenCriticCommentCaretNavigation(event);
        // Native navigation may have placed the caret in a hidden CriticMarkup
        // comment. Route keyup to the post-normalization owner; a Format handler
        // legitimately expects its own live cursor and cannot use the old block.
        const normalizedSelection = this.selection.getSelection();
        if (normalizedSelection?.isSelectionInSameBlock) {
            const normalizedBlock = normalizedSelection.anchor.block;
            this.activeContentBlock = normalizedBlock;
            normalizedBlock.keyupHandler(event);
        }
    }

    private _handleCompositionEnd(anchorBlock: Content, event: Event): void {
        const compositionBlock = this._compositionContentBlock ?? anchorBlock;
        try {
            this.mutationGateway.run(
                { kind: 'user-edit' },
                () => compositionBlock.composeHandler(event),
            );
        }
        finally {
            this._compositionContentBlock = null;
        }
    }

    private _dispatchEvents() {
        const { domNode } = this._muya;

        const eventHandler = (event: Event) => {
            // beforeinput can reject a hidden comment-only caret and remove the
            // native selection entirely. compositionend still belongs to the
            // block that received compositionstart, so close that lifecycle
            // before the ordinary selection-routing guard can return early.
            if (event.type === 'compositionend' && this._compositionContentBlock) {
                this._handleCompositionEnd(this._compositionContentBlock, event);
                return;
            }
            const selectionResult = this.selection.getSelection();
            const anchorBlock = selectionResult?.anchor.block;
            const isSelectionInSameBlock = selectionResult?.isSelectionInSameBlock;
            // Fix issue that language input can not get focus when it's empty(Firefox only)
            if (
                event.type === 'click'
                && isFirefox
                && isHTMLElement(event.target)
                && event.target.textContent === ''
                && event.target.classList.contains(CLASS_NAMES.MU_LANGUAGE_INPUT)
            ) {
                (getBlock(event.target) as Content | undefined)?.setCursor(0, 0, true);
                return;
            }

            if (!isSelectionInSameBlock || !anchorBlock) {
                this.activeContentBlock = null;
                return;
            }

            this.activeContentBlock = anchorBlock;

            switch (event.type) {
                case 'click': {
                    anchorBlock.clickHandler(event);
                    break;
                }
                case 'beforeinput': {
                    this.selection.preventHiddenCriticCommentInput(event);
                    break;
                }
                case 'input': {
                    this.mutationGateway.run(
                        { kind: 'user-edit' },
                        () => anchorBlock.inputHandler(event),
                    );
                    break;
                }
                case 'keydown': {
                    this._handleKeydown(anchorBlock, event);
                    break;
                }
                case 'keyup': {
                    this._handleKeyup(event);
                    break;
                }
                case 'compositionstart': {
                    // Keep the lifecycle owner even if beforeinput rejects a
                    // hidden-comment caret and normalization moves the live
                    // selection to a different block before compositionend.
                    this._compositionContentBlock = anchorBlock;
                    anchorBlock.composeHandler(event);
                    break;
                }
                case 'compositionend': {
                    this._handleCompositionEnd(anchorBlock, event);
                    break;
                }
            }
        };

        merge(
            fromEvent(domNode, 'click'),
            fromEvent(domNode, 'beforeinput'),
            fromEvent(domNode, 'input'),
            fromEvent(domNode, 'keydown'),
            fromEvent(domNode, 'keyup'),
            fromEvent(domNode, 'compositionend'),
            fromEvent(domNode, 'compositionstart'),
        ).subscribe(eventHandler);
    }

    focus() {
        if (!this._isCanonicalProjection())
            return;

        const { selection, scrollPage } = this;
        const { anchorBlock, anchorPath, anchor, focus, focusBlock, focusPath } = selection;

        // Restore the user's last caret when it is still in the tree, so a
        // focus() triggered after a blur (e.g. the command palette) keeps
        // block-level commands operating on the block the user was editing
        // rather than the first block of the document.
        if (
            anchorBlock
            && anchor
            && focus
            && scrollPage?.queryBlock(anchorPath) === anchorBlock
        ) {
            // A cross-block selection lives in two different blocks. Restore the
            // whole range so re-focusing (after the review compose box, a menu,
            // or the command palette took focus) never collapses it into the
            // anchor block. anchorBlock.setCursor(anchor, focus) would place
            // BOTH offsets in the anchor block, shrinking a cross-paragraph
            // selection to a one-character span in the first paragraph.
            if (
                focusBlock
                && focusBlock !== anchorBlock
                && scrollPage?.queryBlock(focusPath) === focusBlock
            ) {
                selection.setSelection(
                    { offset: anchor.offset, block: anchorBlock, path: anchorPath },
                    { offset: focus.offset, block: focusBlock, path: focusPath },
                );
                return;
            }
            anchorBlock.setCursor(anchor.offset, focus.offset, true);
            return;
        }

        // TODO: the cursor maybe passed by muya options.cursor, and no need to find the first leaf block.
        const firstLeafBlock = scrollPage?.firstContentInDescendant();

        if (firstLeafBlock == null)
            return;

        const cursor = {
            path: firstLeafBlock.path,
            block: firstLeafBlock,
            anchor: {
                offset: 0,
            },
            focus: {
                offset: 0,
            },
        };

        const needUpdated
            = firstLeafBlock.blockName === 'paragraph.content'
                && (firstLeafBlock as Format).checkNeedRender(cursor);

        firstLeafBlock.setCursor(0, 0, needUpdated);
    }

    updateContents(
        operations: JSONOp,
        selection: Nullable<IHistorySelection>,
        source: string,
        beforePublish?: () => void,
    ) {
        const muya = this._muya;
        // ot-json1 no-op (`null`) is forwarded to dispatch — JSONState
        // short-circuits internally so listeners still see a json-change
        // event for the no-op.
        this._commitContents(operations, source, () => {
            // Codes below are copied from `ot-json1.apply` and modified.
            if (operations === null)
                return;

            if (!this._isCanonicalProjection()) {
                this.renderCurrentProjection();
                return;
            }

            try {
                applyBlockTreeOperations(this.scrollPage!, operations, muya);

                this._restoreSelection(selection);
                this.inlineRenderer.refreshCriticMarkupDocumentFragments();
            }
            catch (error) {
                // The incremental walk left the live tree half-applied (pick
                // removed blocks drop never re-inserted). Rebuild from the
                // prepared JSON state before allowing the change to publish.
                debug.error(`updateContents incremental apply failed; rebuilding from state: ${String(error)}`);
                this._rebuildScrollPage(this.jsonState.getState());
                this._restoreSelection(selection, true);
            }
        }, beforePublish);
    }

    private _rebuildScrollPage(state: TState[], reuseUnchangedBlocks = false) {
        // `updateState` keeps state-equal blocks alive, so per-block paint
        // that `reset()`/direct clearing leaves behind must be scrubbed
        // explicitly: content with search highlights, and the active
        // ancestor chain of the focused leaf.
        const paintedSearchBlocks = new Set(
            this.searchModule.matches.map(match => match.block),
        );
        const activeAncestors = this._activeContentBlock?.getAncestors() ?? [];

        // A whole-tree replacement invalidates every cached block reference.
        // Clear native and cached selections while the outgoing tree is still
        // attached, then drop the active leaf without asking it to blur or
        // render after its parent hierarchy has been detached.
        this.searchModule.reset();
        this.selection.clear();
        this._activeContentBlock = null;
        this._treeRebuildDepth++;
        try {
            this.scrollPage!.updateState(state, reuseUnchangedBlocks);
        }
        finally {
            this._treeRebuildDepth--;
        }
        for (const block of paintedSearchBlocks) {
            if (block.domNode?.isConnected)
                block.update();
        }
        for (const ancestor of activeAncestors) {
            if (ancestor.domNode?.isConnected && ancestor.active)
                ancestor.active = false;
        }
        this.inlineRenderer.refreshCriticMarkupDocumentFragments();
        this._syncProjectionAttributes();
    }

    renderCurrentProjection(
        selection: Nullable<IHistorySelection> = null,
        reuseUnchangedBlocks = false,
        autoFocus = true,
    ) {
        this._rebuildScrollPage(
            this._stateForCurrentProjection(),
            reuseUnchangedBlocks,
        );
        if (this._isCanonicalProjection()) {
            if (selection)
                this._restoreSelection(selection, true);
            else if (autoFocus)
                this.focus();
        }
    }

    private _restoreSelection(selection: Nullable<IHistorySelection>, treeRebuilt = false) {
        if (!selection)
            return;

        const { anchor, focus, isSelectionInSameBlock } = selection;
        // `ScrollPage.queryBlock` consumes the path array in place (`path.shift`),
        // so query against a copy and leave the caller's selection untouched.
        const cursorBlock = this.scrollPage?.queryBlock([...anchor.path]);

        const begin = Math.min(anchor.offset, focus.offset);
        const end = Math.max(anchor.offset, focus.offset);

        if (isSelectionInSameBlock && cursorBlock && cursorBlock.isContent()) {
            cursorBlock.setCursor(begin, end, true);
            return;
        }

        // When the tree was rebuilt wholesale (rebuildContents), the saved
        // selection's cached `anchorBlock` / `focusBlock` reference DETACHED
        // nodes from the previous tree — resolving them would set the native DOM
        // range onto a detached node and crash the next `getSelection()` read.
        // Re-resolve the caret from the (cloned) path against the fresh tree;
        // fall back to focusing the first content block when the saved path no
        // longer points at a content leaf (e.g. a paragraph became a table).
        if (treeRebuilt) {
            if (cursorBlock && cursorBlock.isContent())
                cursorBlock.setCursor(begin, end, true);
            else
                this.focus();

            return;
        }

        // Incremental (updateContents) path. Clone the paths so
        // `queryBlock(path)` can't drain the caller's arrays — notably the
        // selection object stored in the undo stack.
        const anchorBlock = this.scrollPage?.queryBlock([...anchor.path]);
        const focusBlock = this.scrollPage?.queryBlock([...focus.path]);
        if (!anchorBlock || !anchorBlock.isContent() || !focusBlock || !focusBlock.isContent()) {
            this.focus();
            return;
        }

        this.selection.setSelection(
            { offset: anchor.offset, block: anchorBlock, path: [...anchor.path] },
            { offset: focus.offset, block: focusBlock, path: [...focus.path] },
        );
    }

    /**
     * Apply a history op by rebuilding the live block tree wholesale instead of
     * walking it incrementally (`updateContents`). The op is dispatched to the
     * authoritative json state, then `ScrollPage.updateState` re-creates the DOM
     * from that state — the same safe path `setContent` uses. Used for undo/redo
     * of whole-document boundaries (e.g. exiting source-code mode) whose op
     * shapes the incremental pick/drop walker cannot apply without desyncing the
     * DOM from the json state.
     */
    rebuildContents(
        operations: JSONOp,
        selection: Nullable<IHistorySelection>,
        source: string,
        beforePublish?: () => void,
    ) {
        this._commitContents(operations, source, () => {
            this._rebuildScrollPage(this._stateForCurrentProjection());

            // The tree was rebuilt wholesale, so the selection's cached block
            // references are stale — resolve the caret from paths instead.
            if (this._isCanonicalProjection())
                this._restoreSelection(selection, true);
        }, beforePublish);
    }

    /** Commit operations whose live block-tree mutation already succeeded. */
    getLiveBlockState(): TState[] {
        return this.scrollPage!.children.map((node) => {
            if (!node.isParent()) {
                throw new TypeError(
                    'A top-level editor block must be a parent node.',
                );
            }
            return node.getState();
        });
    }

    commitPendingContents(operations: JSONOp, source: string): void {
        this._commitContents(operations, source, () => {
            const liveState = this.getLiveBlockState();
            if (!statesEqual(liveState, this.jsonState.getState())) {
                throw new TypeError(
                    'Live block tree does not match its prepared JSON state.',
                );
            }
            this.inlineRenderer.refreshCriticMarkupDocumentFragments();
        });
    }

    /**
     * Sole prepared state/tree commit protocol. JSON remains unobservable until
     * the live tree, selection, search state, and caller-supplied publication
     * preparation have all succeeded. Any preparation failure restores the
     * previous JSON revision and reconstructs the previous live view.
     */
    private _commitContents(
        operations: JSONOp,
        source: string,
        prepareTree: () => void,
        beforePublish?: () => void,
    ): void {
        this._mutationAuthority.assertActive('Prepared editor commit');
        const previousSelection = this.selection.getSelection();
        const previousSearch = this.searchModule.checkpoint();
        const change = this.jsonState.applySilently(operations, source);
        let replayPreparedEvents: (() => void) | null = null;

        try {
            const prepared = this._muya.eventCenter.buffer(() => {
                prepareTree();
                beforePublish?.();
            });
            replayPreparedEvents = prepared.replay;
        }
        catch (error) {
            const rollbackErrors: unknown[] = [];
            try {
                this.jsonState.restoreSilently(change);
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                this._muya.eventCenter.suppress(() => {
                    this._rebuildScrollPage(this._stateForCurrentProjection());
                    this.searchModule.restore(previousSearch);
                    if (this._isCanonicalProjection())
                        this._restoreSelection(previousSelection, true);
                });
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }

            if (rollbackErrors.length) {
                throw new CollectedError(
                    [error, ...rollbackErrors],
                    'Prepared rebuild and its rollback both failed.',
                );
            }
            throw error;
        }

        const notificationErrors: unknown[] = [];
        this._mutationAuthority.suspend(() => {
            try {
                this.jsonState.publish(change);
            }
            catch (error) {
                notificationErrors.push(error);
            }
            try {
                replayPreparedEvents?.();
            }
            catch (error) {
                notificationErrors.push(error);
            }
        });
        if (notificationErrors.length)
            throw new PostCommitNotificationError(notificationErrors);
    }

    setContent(content: TState[] | string, autoFocus = false) {
        this._muya.flush();
        const result = this.mutationGateway.run(
            { kind: 'document-reset' },
            () => this._resetDocument(content, {
                autoFocus,
                clearHistory: true,
                preserveSelection: false,
            }),
        );
        if (result === 'rejected') {
            throw new TypeError('A document reset cannot be rejected by projection policy.');
        }
        this.scheduleProjectionWarmup();
    }

    reparseContent(
        content: TState[] | string,
        preserveSelection = true,
        beforeRollback?: () => void,
    ): void {
        this._resetDocument(content, {
            autoFocus: false,
            clearHistory: false,
            preserveSelection,
        }, beforeRollback);
    }

    private _resetDocument(
        content: TState[] | string,
        options: {
            readonly autoFocus: boolean;
            readonly clearHistory: boolean;
            readonly preserveSelection: boolean;
        },
        beforeRollback?: () => void,
    ): void {
        const checkpoint = this.jsonState.checkpointReset();
        const history = this.history.getHistory();
        const search = this.searchModule.checkpoint();
        const selection = this.selection.getSelection();

        try {
            this.jsonState.setContent(content);
            this._rebuildScrollPage(this._stateForCurrentProjection());
            if (options.clearHistory)
                this.history.clear();
            if (options.preserveSelection && this._isCanonicalProjection())
                this._restoreSelection(selection, true);
            else if (options.autoFocus && this._isCanonicalProjection())
                this.focus();
        }
        catch (error) {
            const rollbackErrors: unknown[] = [];
            // The caller prepared under a prospective snapshot (for example
            // new parser options); rollback must rebuild under the previous
            // snapshot or the restored tree re-renders against the wrong
            // parser profile.
            try {
                beforeRollback?.();
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                this.jsonState.restoreReset(checkpoint);
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                this._muya.eventCenter.suppress(() => {
                    this._rebuildScrollPage(this._stateForCurrentProjection());
                    this.history.setHistory(history);
                    this.searchModule.restore(search);
                    if (this._isCanonicalProjection())
                        this._restoreSelection(selection, true);
                });
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            if (rollbackErrors.length) {
                throw new CollectedError(
                    [error, ...rollbackErrors],
                    'Document reset and its rollback both failed.',
                );
            }
            throw error;
        }
    }
}
