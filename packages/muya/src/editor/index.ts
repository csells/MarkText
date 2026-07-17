import type { JSONOp, JSONOpComponent, JSONOpList } from 'ot-json1';
import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type { IMutationAuthority } from '../mutation/authority';
import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { TState } from '../state/types';
import type { Nullable } from '../types';
import * as otText from 'ot-text-unicode';
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
import { deepClone, hasPick, isHTMLElement, isKeyboardEvent } from '../utils';
import { CollectedError } from '../utils/collectedError';
import { getBlock } from '../utils/dom';
import logger from '../utils/logger';
import { attachDragDropImageHandlers } from './dragDropImage';
import { attachLinkMouseHandlers } from './linkMouseEvents';

const debug = logger('editor:');

// The pick/drop walkers operate on live block-tree nodes (ScrollPage,
// Parent, Content). The tree's instance methods (queryBlock, find,
// insertBefore, etc.) are not all exposed on a single TS type, and
// ot-json1 op descents are dynamically shaped — so we type these as
// BlockNode (loose structural alias) inside the inner walkers and let
// the runtime branches do the actual narrowing.
type BlockNode = {
    queryBlock?: (path: (string | number)[]) => BlockNode | undefined;
    find?: (key: number | string) => BlockNode;
    remove?: (source: string) => void;
    replaceWith?: (newBlock: BlockNode, source: string) => void;
    insertBefore?: (newBlock: BlockNode, ref: BlockNode, source: string) => void;
    append?: (newBlock: BlockNode, source: string) => void;
    update?: (value?: unknown, source?: string) => void;
    applyCheckedFromState?: (checked: boolean) => void;
    applyAlignmentFromState?: (value: string) => void;
    applyLanguageFromState?: (value: string) => void;
    applyTypeFromState?: (value: string) => void;
    blockName?: string;
    align?: string;
    _text?: string;
    text?: string;
    meta?: { lang?: string; type?: string };
    parent?: BlockNode;
} | undefined;

function descend(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
): { subDoc: BlockNode; i: number } {
    let i = 0;

    for (; i < descent.length; i++) {
        const d = descent[i];
        if (Array.isArray(d))
            break;
        if (typeof d === 'object')
            continue;
        stack.push(subDoc);
        // Its valid to descend into a null space - just we can't pick there.
        subDoc = subDoc == null ? undefined : subDoc.queryBlock?.([d]);
    }

    return { subDoc, i };
}

function restore(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
    i: number,
): BlockNode {
    // Then back again.
    for (--i; i >= 0; i--) {
        const d = descent[i];
        if (typeof d !== 'object') {
            const container = stack.pop();
            if (
                subDoc
                === (container == null ? undefined : container.queryBlock?.([d as string | number]))
            ) {
                subDoc = container;
            }
            else {
                if (subDoc === undefined) {
                    // TODO: handler typeof d === 'string'
                    if (typeof d === 'number')
                        container?.find?.(d)?.remove?.('api');
                    subDoc = container;
                }
                else {
                    if (typeof d === 'number')
                        container?.find?.(d)?.replaceWith?.(subDoc, 'api');
                    subDoc = container;
                }
            }
        }
        else if (!Array.isArray(d) && hasPick(d)) {
            subDoc = undefined;
        }
    }

    return subDoc;
}

// Phase 1: Pick. Returns updated subDocument.
function pick(subDoc: BlockNode, descent: JSONOpList): BlockNode {
    const stack: BlockNode[] = [];

    const descended = descend(subDoc, descent, stack);
    subDoc = descended.subDoc;
    const i = descended.i;

    // Children. These need to be traversed in reverse order here.
    for (let j = descent.length - 1; j >= i; j--)
        subDoc = pick(subDoc, descent[j] as JSONOpList);

    return restore(subDoc, descent, stack, i);
}

function drop(root: BlockNode, descent: JSONOpList, muya: Muya): BlockNode {
    let subDoc = root;
    let i = 0; // For reading
    let m = 0;
    const rootContainer: { root: BlockNode } = { root }; // This is an avoidable allocation.
    let container: BlockNode | { root: BlockNode } = rootContainer;
    let key: string | number = 'root'; // For writing

    function mut() {
        for (; m < i; m++) {
            const d = descent[m];
            if (typeof d === 'object')
                continue;
            if (key === 'root') {
                const wrap = container as { root: BlockNode };
                container = wrap.root;
            }
            else {
                container = (container as BlockNode)?.queryBlock?.([key]);
            }
            key = d as string | number;
        }
    }

    function applyInsert(comp: JSONOpComponent) {
        // Insert
        mut();
        const cur = container as BlockNode;
        const ref = cur?.find?.(key);
        if (typeof key === 'number') {
            const insertedState = comp.i as TState;
            const newBlock = ScrollPage.createStateBlock(
                muya,
                insertedState,
            );
            // createStateBlock always returns a live Parent. The OT walker uses
            // a deliberately loose structural view whose callback parameter
            // variance prevents direct assignment even though Parent provides
            // the required runtime methods.
            // eslint-disable-next-line no-restricted-syntax
            const newBlockNode = newBlock as unknown as BlockNode;
            if (cur && newBlockNode) {
                if (ref)
                    cur.insertBefore?.(newBlockNode, ref, 'api');
                else
                    cur.append?.(newBlockNode, 'api');
            }

            subDoc = newBlockNode;
        }
        else {
            switch (key) {
                case 'checked': {
                    if (typeof comp.i !== 'boolean') {
                        throw new TypeError(
                            'Prepared task-list checked value must be boolean.',
                        );
                    }
                    if (!ref?.applyCheckedFromState) {
                        throw new TypeError(
                            'Prepared task-list operation has no checkbox applier.',
                        );
                    }
                    ref.applyCheckedFromState(comp.i);
                    break;
                }

                case 'meta':
                    // Do nothing.
                    break;

                default:
                    debug.warn(`Unknown operation path ${key}`);
                    break;
            }
        }
    }

    function applyTextEdit(es: NonNullable<JSONOpComponent['es']>) {
        // Edit. Ok because its illegal to drop inside mixed region
        mut();
        const sd = subDoc!;
        if (sd.blockName === 'table.cell') {
            if (!sd.applyAlignmentFromState) {
                throw new TypeError(
                    'Prepared table operation has no alignment applier.',
                );
            }
            sd.applyAlignmentFromState(
                otText.type.apply(sd.align ?? '', es) as string,
            );
        }
        else if (sd.blockName === 'language-input') {
            const nextText = otText.type.apply(sd.text ?? '', es) as string;
            sd._text = nextText;
            if (!sd.parent?.applyLanguageFromState) {
                throw new TypeError(
                    'Prepared language input has no code-block applier.',
                );
            }
            sd.parent.applyLanguageFromState(nextText);
            sd.update?.();
        }
        else if (sd.blockName === 'code-block') {
            // Handle modify code block type.
            if (!sd.applyTypeFromState) {
                throw new TypeError(
                    'Prepared code block has no type applier.',
                );
            }
            sd.applyTypeFromState(
                otText.type.apply(sd.meta?.type ?? '', es) as string,
            );
        }
        else {
            sd._text = otText.type.apply(sd.text ?? '', es) as string;
            sd.update?.();
        }
    }

    for (; i < descent.length; i++) {
        const d = descent[i];

        if (Array.isArray(d)) {
            const child = drop(subDoc, d, muya);
            if (child !== subDoc && child !== undefined) {
                mut();
                // It maybe never go into this if statement.
                if (key === 'root')
                    (container as { root: BlockNode }).root = child;
                else
                    (container as Record<string, BlockNode>)[key] = child;
                subDoc = child;
            }
        }
        else if (typeof d === 'object') {
            const comp = d as JSONOpComponent;
            if (comp.i !== undefined)
                applyInsert(comp);

            if (comp.es)
                applyTextEdit(comp.es);
        }
        else {
            subDoc = subDoc != null ? subDoc.queryBlock?.([d]) : undefined;
        }
    }

    return rootContainer.root;
}

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
    private readonly _mutationAuthority: IMutationAuthority;
    private _treeRebuildDepth = 0;
    private readonly _projectionStateCache = new Map<'original' | 'revised', TState[]>();
    private _projectionCacheVersion = -1;
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
        if (this._projectionCacheVersion !== version) {
            this._projectionCacheVersion = version;
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

    private _dispatchEvents() {
        const { domNode } = this._muya;

        const eventHandler = (event: Event) => {
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
                case 'input': {
                    this.mutationGateway.run(
                        { kind: 'user-edit' },
                        () => anchorBlock.inputHandler(event),
                    );
                    break;
                }
                case 'keydown': {
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
                    break;
                }
                case 'keyup': {
                    anchorBlock.keyupHandler(event);
                    break;
                }
                case 'compositionstart': {
                    anchorBlock.composeHandler(event);
                    break;
                }
                case 'compositionend': {
                    this.mutationGateway.run(
                        { kind: 'user-edit' },
                        () => anchorBlock.composeHandler(event),
                    );
                    break;
                }
            }
        };

        merge(
            fromEvent(domNode, 'click'),
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
        const { anchorBlock, anchorPath, anchor, focus } = selection;

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
                const snapshot = pick(this.scrollPage as BlockNode, operations);

                drop(snapshot, operations, muya);

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
