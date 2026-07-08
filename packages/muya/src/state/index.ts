import type { Doc, JSONOp, JSONOpList, Path } from 'ot-json1';
import type { ICommentModel } from '../comments/model';
import type { Muya } from '../muya';
import type { TDiff } from '../utils';
import type { TState } from './types';
import * as json1 from 'ot-json1';
import {
    emptyCommentModel,
    extractCommentModel,
    materializeCommentModel,
    transformCommentAnchors,
} from '../comments/model';
import { deepClone } from '../utils';
import logger from '../utils/logger';
import { getTOC } from './getTOC';

import { MarkdownToState } from './markdownToState';
import StateToMarkdown from './stateToMarkdown';

const debug = logger('jsonState:');

// ot-json1 declares its document type as the opaque `Doc`. Muya treats the
// document as `TState[]`; bridging the two requires `unknown` casts that
// happen at every callsite. Concentrate them here so production code never
// writes `as unknown as Doc` itself.
export function asDoc(state: TState[] | TState): Doc {
    // eslint-disable-next-line no-restricted-syntax
    return state as unknown as Doc;
}

export function asState(doc: unknown): TState[] {
    return doc as TState[];
}

// A single move-free, fully-invertible op turning `prevState` into
// `nextState` (per-index replaces, tail inserts, surplus removes — see
// buildReplaceOp). Exported for boundaries that need an op between two
// arbitrary snapshots, e.g. the paste comment-absorption boundary.
export function buildStateReplaceOp(prevState: TState[], nextState: TState[]): JSONOpList {
    const components: JSONOpList[] = [];
    const max = Math.max(prevState.length, nextState.length);

    for (let i = 0; i < max; i++) {
        if (i < prevState.length && i < nextState.length) {
            if (JSON.stringify(prevState[i]) !== JSON.stringify(nextState[i])) {
                components.push(
                    json1.replaceOp([i], asDoc(prevState[i]), asDoc(nextState[i]))!,
                );
            }
        }
        else if (i < nextState.length) {
            components.push(json1.insertOp([i], asDoc(nextState[i]))!);
        }
    }

    for (let i = prevState.length - 1; i >= nextState.length; i--)
        components.push(json1.removeOp([i])!);

    let composed: JSONOp = null;
    for (const component of components)
        composed = json1.type.compose(composed, component);

    return composed ?? [];
}

class JSONState {
    static invert(op: JSONOpList) {
        return json1.type.invert(op);
    }

    static compose(op1: JSONOpList, op2: JSONOpList) {
        return json1.type.compose(op1, op2);
    }

    static transform(
        op: JSONOpList,
        otherOp: JSONOpList,
        type: 'left' | 'right',
    ) {
        return json1.type.transform(op, otherOp, type);
    }

    private _operationCache: JSONOpList[] = [];

    private _version = 0;

    // Handle of the scheduled deferred-op flush. Doubles as the "a flush is
    // already scheduled" guard (non-null ⇒ batching in progress), and lets
    // `setContent` cancel a pending batch that belongs to the outgoing
    // document (#2938).
    private _rafId: number | null = null;

    private _state: TState[] = [];

    // The runtime comment representation (comments/model.ts). MC bytes never
    // live in `_state`; they extract into the model on every content set and
    // materialize back on every serialization. Owned here because it IS
    // document state: every op applied below transforms its anchors at this
    // single choke point (comment-anchors.md invariant 3).
    private _commentModel: ICommentModel = emptyCommentModel();

    constructor(private _muya: Muya, stateOrMarkdown: TState[] | string) {
        this.setContent(stateOrMarkdown);
    }

    get commentModel(): ICommentModel {
        return this._commentModel;
    }

    // Install a new model (comment mutations, undo/redo of model entries,
    // rebuild boundaries). Bumps the version so every per-version comment
    // view re-derives, and notifies the render/sidebar paths — a model swap
    // moves no document bytes, so no json-change fires for it.
    setCommentModel(model: ICommentModel) {
        this._commentModel = model;
        this._version += 1;
        this._muya.eventCenter.emit('comment-model-change');
        // A model swap changes the SERIALIZED document without moving state
        // bytes. Hosts track content through json-change (markdown, dirty
        // state, word count), so emit one with the empty op — History's
        // recorder no-ops on op.length 0, and the model entry itself was
        // already recorded by the mutation path.
        this._muya.eventCenter.emit('json-change', {
            op: [],
            source: 'comment-model',
            prevDoc: this._state,
            doc: this._state,
        });
    }

    // Anchors and definition-run positions as they were when the most recent
    // op applied — the history records them per entry, because
    // transformPosition is lossy for positions a deletion swallowed
    // (invariant 4 needs snapshots, not re-transforms).
    private _prevAnchorsBeforeLastApply: ICommentModel['anchors'] = [];
    private _prevRunsBeforeLastApply: ICommentModel['runs'] = [];

    get prevAnchorsBeforeLastApply(): ICommentModel['anchors'] {
        return this._prevAnchorsBeforeLastApply;
    }

    get prevRunsBeforeLastApply(): ICommentModel['runs'] {
        return this._prevRunsBeforeLastApply;
    }

    private _apply(op: JSONOp) {
        // ot-json1's noop is the literal `null`. `json1.type.apply` accepts it
        // and returns the doc unchanged — short-circuit instead so the rest of
        // the call site can treat `op` as definitely applied.
        if (op === null)
            return;
        const beforeState = this._state;
        this._prevAnchorsBeforeLastApply = this._commentModel.anchors;
        this._prevRunsBeforeLastApply = this._commentModel.runs;
        this._state = asState(json1.type.apply(asDoc(this._state), op));
        this._commentModel = transformCommentAnchors(this._commentModel, op, beforeState, this._state);
        this._version += 1;
    }

    setContent(content: TState[] | string) {
        // A pending deferred-op batch belongs to the OUTGOING document. Applying
        // it to the new content would corrupt it (or throw and leave the flush
        // guard stuck, freezing all future edits). Drop the batch and cancel its
        // scheduled flush before swapping the state (#2938).
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._operationCache = [];

        if (typeof content === 'object')
            this._setState(content);
        else
            this._setMarkdown(content);
    }

    private _setState(state: TState[]) {
        const { states, model } = extractCommentModel(state);
        this._state = states;
        this._commentModel = model;
        this._version += 1;
    }

    private _setMarkdown(markdown: string) {
        this._setState(this.markdownToState(markdown));
    }

    get version() {
        return this._version;
    }

    // Parse markdown into a block-state array with the editor's current
    // render-affecting options, WITHOUT mutating `this._state`. Used by
    // `buildReplaceOp` to compute the target state for a bulk replacement.
    markdownToState(markdown: string): TState[] {
        const {
            footnote,
            isGitlabCompatibilityEnabled,
            trimUnnecessaryCodeBlockEmptyLines,
            frontMatter,
            math,
        } = this._muya.options;

        return new MarkdownToState({
            footnote,
            isGitlabCompatibilityEnabled,
            trimUnnecessaryCodeBlockEmptyLines,
            frontMatter,
            math,
        }).generate(markdown);
    }

    /**
     * Build a single, fully-invertible ot-json1 op that turns the CURRENT
     * document state into `content` (markdown or a state array), and return it
     * together with the before/after states.
     *
     * The op is deliberately MOVE-FREE: it replaces each overlapping top-level
     * block, inserts the tail, and removes the surplus (highest index first).
     * It never emits a pick/drop `move`, so `json1.type.apply` reproduces the
     * target state exactly and `invertWithDoc` yields a lossless inverse. The op
     * is applied to the live tree via `ScrollPage.updateState` (a full rebuild),
     * never the incremental DOM walker, so arbitrary block-type changes are safe.
     */
    buildReplaceOp(content: TState[] | string): {
        op: JSONOpList;
        prevState: TState[];
        nextState: TState[];
        prevModel: ICommentModel;
        nextModel: ICommentModel;
    } {
        const prevState = this.getState();
        const prevModel = this._commentModel;
        // The replacement extracts like any other content set: the op targets
        // CLEAN states, and the caller installs `nextModel` after applying it
        // (a rebuild boundary swaps the model wholesale rather than
        // transforming anchors through a whole-document replace).
        const { states: nextState, model: nextModel } = extractCommentModel(
            typeof content === 'string' ? this.markdownToState(content) : deepClone(content),
        );

        const op = buildStateReplaceOp(prevState, nextState);

        return { op, prevState, nextState, prevModel, nextModel };
    }

    insertOperation(path: Path, state: TState) {
        const operation = json1.insertOp(path, asDoc(state))!;

        this._operationCache.push(operation);

        this._emitStateChange();
    }

    removeOperation(path: Path) {
        const operation = json1.removeOp(path)!;

        this._operationCache.push(operation);

        this._emitStateChange();
    }

    editOperation(path: Path, diff: TDiff[]) {
        const operation = json1.editOp(path, 'text-unicode', diff)!;

        this._operationCache.push(operation);

        this._emitStateChange();
    }

    replaceOperation(path: Path, oldValue: Doc, newValue: Doc) {
        const operation = json1.replaceOp(path, oldValue, newValue)!;

        this._operationCache.push(operation);

        this._emitStateChange();
    }

    dispatch(op: JSONOp, source = 'user' /* user, api */) {
        const prevDoc = this.getState();
        this._apply(op);
        // TODO: remove doc in future
        const doc = this.getState();
        debug.log(JSON.stringify(op));
        this._muya.eventCenter.emit('json-change', {
            op,
            source,
            prevDoc,
            doc,
        });
    }

    getState(): TState[] {
        return deepClone(this._state);
    }

    // Flushed, NON-cloned state for read-only walks (comment analysis, render
    // models). Callers must not mutate the returned tree — use getState() for
    // anything that leaves the engine or might be written to.
    peekState(): TState[] {
        this.flush();
        return this._state;
    }

    // Serialization cache: sidebar reads, saves, word counts, and bridge
    // reads may all serialize in one tick — only the first per version pays
    // for materialization + generation. The version covers the comment model
    // too (setCommentModel bumps it).
    private _markdownCache: {
        version: number;
        // The one serialization-affecting option (setOptions can change it
        // without a document op).
        listIndentation: unknown;
        markdown: string;
    } | null = null;

    getMarkdown() {
        // Marker bytes and the metadata appendix exist only in serialized
        // output; materialize them from the model first. State and model
        // advance together in _apply, so a pending rAF batch leaves BOTH
        // pre-op — serializing the unflushed pair stays consistent (#2938
        // callers flush explicitly when they need durability).
        const { listIndentation } = this._muya.options;
        if (
            this._markdownCache?.version !== this._version
            || this._markdownCache.listIndentation !== listIndentation
        ) {
            this._markdownCache = {
                version: this._version,
                listIndentation,
                markdown: this.getMarkdownFromState(
                    materializeCommentModel(this._state, this._commentModel),
                ),
            };
        }
        return this._markdownCache.markdown;
    }

    private _cleanMarkdownCache: {
        version: number;
        listIndentation: unknown;
        markdown: string;
    } | null = null;

    // The CLEAN document — no marker bytes, no metadata appendix. Word count
    // (and any consumer measuring what the user sees) reads this; the wire
    // serialization above is for disk, exports, and the bridge.
    getCleanMarkdown() {
        const { listIndentation } = this._muya.options;
        if (
            this._cleanMarkdownCache?.version !== this._version
            || this._cleanMarkdownCache.listIndentation !== listIndentation
        ) {
            this._cleanMarkdownCache = {
                version: this._version,
                listIndentation,
                markdown: this.getMarkdownFromState(this._state),
            };
        }
        return this._cleanMarkdownCache.markdown;
    }

    getTOC() {
        return getTOC(this._muya);
    }

    // Serialize an ARBITRARY state array to markdown with the same generator
    // `getMarkdown` uses. Used by `Muya.getCursorOffset` to serialize a
    // sentinel-bearing state clone WITHOUT mutating the live `_state`.
    getMarkdownFromState(state: TState[]): string {
        const mdGenerator = new StateToMarkdown({
            listIndentation: this._muya.options.listIndentation,
        });

        return mdGenerator.generate(state);
    }

    private _emitStateChange() {
        if (this._rafId !== null)
            return;

        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._flushOperationCache();
        });
    }

    // Apply queued edits to the current document now instead of on the next
    // frame. Lets a tab switch persist the outgoing tab's last keystroke before
    // `setContent` replaces the document, otherwise that edit is lost (#2938).
    flush() {
        if (this._rafId === null)
            return;

        cancelAnimationFrame(this._rafId);
        this._rafId = null;
        this._flushOperationCache();
    }

    private _flushOperationCache() {
        if (!this._operationCache.length)
            return;

        // Wrap compose in a lambda — `Array.prototype.reduce` passes
        // (acc, current, index, array) to the callback, but
        // `json1.type.compose` only accepts (op1, op2). Without the
        // wrapper TS rejects the signature mismatch.
        // `compose` returns JSONOp (= null | JSONOpList); a non-empty cache
        // (guarded above) always composes to a non-null op.
        const op = this._operationCache.reduce(
            (acc, curr) => json1.type.compose(acc, curr) as JSONOpList,
        );
        const prevDoc = this.getState();
        this._apply(op);
        // TODO: remove doc in future
        const doc = this.getState();
        // Clear before emitting: a listener that edits synchronously then starts
        // a fresh batch instead of mutating the one being flushed.
        this._operationCache = [];
        this._muya.eventCenter.emit('json-change', {
            op,
            source: 'user',
            prevDoc,
            doc,
        });
    }
}

export default JSONState;
