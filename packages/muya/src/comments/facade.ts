import type Content from '../block/base/content';
import type { Muya } from '../muya';
import type { Nullable } from '../types';
import type { IAddCommentInput, TUpdateCommentThreadPatch } from './edit';
import type {
    ICommentMetadata,
    ICommentReplyInput,
    IParsedMarkdownComments,
} from './types';
import {
    appendCommentReplyMetadata,
    canWrapCommentRange,
    createCommentMetadata,
    mergeCommentMetadataPatch,
    nextCommentId,
} from './edit';
import { normalizeCommentMetadata } from './metadata';
import { cloneCommentModel, commentModelView } from './model';
import {
    buildTextPathIndexes,
    orderTextRange,
    selectionIntersectsCommentRange,
} from './range';

// The comment subsystem behind the Muya facade: analysis views, mutations,
// events, and navigation. Muya keeps one-line delegators so the public API
// (and the desktop's typing) is unchanged; everything comment-shaped lives
// here instead of growing the god class.
export class MuyaComments {
    constructor(private _muya: Muya) {}

    private _lastActiveCommentIds: string[] = [];

    bindEvents() {
        this._muya.eventCenter.on('json-change', () => {
            this.emitCommentsChange();
        });
        this._muya.eventCenter.on('selection-change', () => {
            this._emitActiveCommentsChange();
        });
        // Comment-model swaps (mutations, undo/redo of model entries) move no
        // document bytes; repaint content blocks here (the sidebar views
        // re-emit via the json-change setCommentModel also raises).
        this._muya.eventCenter.on('comment-model-change', () => {
            this._repaintCommentBlocks();
        });
    }

    private _repaintCommentBlocks() {
        const { scrollPage, selection } = this._muya.editor;
        if (!scrollPage)
            return;

        // Re-rendering a block destroys any DOM selection inside it; restore
        // the CACHED selection afterwards (the live one may already be gone —
        // e.g. the user is typing in the sidebar), so replying or resolving
        // never yanks the caret back to the commented word.
        const preserved
            = selection.anchor && selection.focus
                ? {
                        anchor: { offset: selection.anchor.offset },
                        focus: { offset: selection.focus.offset },
                        anchorPath: selection.anchorPath,
                        focusPath: selection.focusPath,
                    }
                : null;

        scrollPage.breadthFirstTraverse((node) => {
            if (node.isContent())
                (node as Content).update();
        });

        if (preserved)
            this._muya.setCursor(preserved);
    }

    emitCommentsChange() {
        this._muya.eventCenter.emit('comments-change', this.getComments());
        this._emitActiveCommentsChange();
    }

    private _emitActiveCommentsChange() {
        const ids = this.getActiveComments();
        if (this._sameCommentIds(ids, this._lastActiveCommentIds))
            return;

        this._lastActiveCommentIds = [...ids];
        this._muya.eventCenter.emit('active-comments-change', ids);
    }

    private _sameCommentIds(a: string[], b: string[]) {
        return a.length === b.length && a.every((id, index) => id === b[index]);
    }

    // One comment analysis per document version, shared by getComments,
    // getActiveComments, canAddComment, and both change emitters — every
    // keystroke used to pay multiple whole-document clones and re-parses.
    private _commentViewCache: Nullable<{
        version: number;
        comments: IParsedMarkdownComments;
        textPathIndexes: Nullable<ReturnType<typeof buildTextPathIndexes>>;
    }> = null;

    private _commentView() {
        const { jsonState } = this._muya.editor;
        const states = jsonState.peekState();
        const version = jsonState.version;
        if (this._commentViewCache?.version !== version) {
            this._commentViewCache = {
                version,
                comments: commentModelView(jsonState.commentModel, states),
                textPathIndexes: null,
            };
        }
        return this._commentViewCache;
    }

    private _commentViewTextPathIndexes() {
        const view = this._commentView();
        view.textPathIndexes ??= buildTextPathIndexes(this._muya.editor.jsonState.peekState());
        return view.textPathIndexes;
    }

    // Internal: the inline renderer's per-version render model — same cached
    // analysis the public comment API serves, so highlights and sidebar can
    // never disagree (and the document is cloned zero times on this path).
    commentRenderView(): { comments: IParsedMarkdownComments; textPathIndexes: ReturnType<typeof buildTextPathIndexes> } {
        return {
            comments: this._commentView().comments,
            textPathIndexes: this._commentViewTextPathIndexes(),
        };
    }

    getComments(): IParsedMarkdownComments {
        // Comment derivation runs on every json-change; it must never throw out
        // of the edit pipeline. Surface the failure as a diagnostic so callers
        // do not confuse a parser failure with a comment-free document.
        try {
            return this._commentView().comments;
        }
        catch (error) {
            console.error('muya.getComments failed:', error);
            const message = error instanceof Error ? error.message : String(error);
            return {
                threads: [],
                ranges: [],
                diagnostics: [
                    {
                        code: 'parse-error',
                        id: '__parser__',
                        message: `muya.getComments failed: ${message}`,
                    },
                ],
            };
        }
    }

    getActiveComments(): string[] {
        const selection = this._muya.editor.selection.getSelection();
        if (!selection)
            return [];

        // Use getComments() (not a second parseMarkdownComments call) so a
        // corrupt-metadata parse failure is surfaced once, as getComments'
        // parse-error diagnostic, and yields no ranges here — rather than a
        // silent [] that disagrees with the sidebar. The remaining calls
        // (buildTextPathIndexes, selectionIntersectsCommentRange) are throw-free.
        const comments = this.getComments();
        if (comments.ranges.length === 0)
            return [];

        const textPathIndexes = this._commentViewTextPathIndexes();
        const activeIds: string[] = [];

        for (const range of comments.ranges) {
            if (selectionIntersectsCommentRange(
                range,
                selection.anchor.path,
                selection.anchor.offset,
                selection.focus.path,
                selection.focus.offset,
                textPathIndexes,
            )) {
                activeIds.push(range.id);
            }
        }

        return activeIds;
    }

    // Reserve a collision-free comment id against every id already in the
    // document (threads, ranges, and diagnostics). Returns null when a
    // caller-supplied id is already taken.
    private _reserveCommentId(input: Pick<IAddCommentInput, 'id'>): string | null {
        const comments = this.getComments();
        const existingIds = [
            ...comments.threads.map(thread => thread.id),
            ...comments.ranges.map(range => range.id),
            ...comments.diagnostics.map(diagnostic => diagnostic.id),
        ];
        const id = input.id ?? nextCommentId(existingIds);
        return existingIds.includes(id) ? null : id;
    }

    canAddComment(input: Pick<IAddCommentInput, 'id'> = {}): boolean {
        const selection = this._muya.editor.selection.getSelection();
        if (!selection || selection.isCollapsed)
            return false;

        // No try/catch: the only throwing call in the comment area is metadata
        // decode, which is quarantined inside getComments() (it returns a
        // parse-error diagnostic, never throws). getComments/nextCommentId/
        // canWrapCommentRange are all throw-free, so a residual throw here is a
        // genuine bug that must surface, not be silently turned into "disabled".
        const id = this._reserveCommentId(input);
        if (id == null)
            return false;

        return canWrapCommentRange({
            states: this._muya.editor.jsonState.peekState(),
            path: selection.anchor.path,
            endPath: selection.focus.path,
            startOffset: selection.anchor.offset,
            endOffset: selection.focus.offset,
            id,
        });
    }

    // Install a mutated comment model as one undo boundary; setCommentModel
    // notifies the render/sidebar paths.
    private _commitCommentModel(
        before: ReturnType<typeof cloneCommentModel>,
        after: ReturnType<typeof cloneCommentModel>,
    ): void {
        const { jsonState, history } = this._muya.editor;
        history.recordCommentModel(before);
        jsonState.setCommentModel(after);
    }

    // Returns the created thread's id, or null when the selection is not
    // commentable — the caller needs the id to open the compose flow. A pure
    // model mutation: no text splicing, no document rebuild
    // (comment-anchors.md §Mutations and undo).
    addComment(input: IAddCommentInput = {}): string | null {
        // Commit any rAF-batched keystroke ops before reading state below —
        // anchors must be created against the flushed document.
        this._muya.flush();
        const selection = this._muya.editor.selection.getSelection();
        if (!selection || selection.isCollapsed)
            return null;

        const id = this._reserveCommentId(input);
        if (id == null)
            return null;

        const states = this._muya.editor.jsonState.peekState();
        if (!canWrapCommentRange({
            states,
            path: selection.anchor.path,
            endPath: selection.focus.path,
            startOffset: selection.anchor.offset,
            endOffset: selection.focus.offset,
            id,
        })) {
            return null;
        }

        const indexes = buildTextPathIndexes(states);
        const ordered = orderTextRange(
            indexes,
            selection.anchor.path,
            selection.anchor.offset,
            selection.focus.path,
            selection.focus.offset,
        );
        if (!ordered)
            return null;

        const before = cloneCommentModel(this._muya.editor.jsonState.commentModel);
        const after = cloneCommentModel(before);
        after.threads.set(id, { id, ...createCommentMetadata(input) });
        after.anchors.push(
            { id, kind: 'open', position: [...ordered.startPath, ordered.startOffset] },
            { id, kind: 'close', position: [...ordered.endPath, ordered.endOffset] },
        );
        this._commitCommentModel(before, after);

        this._muya.setCursor({
            anchor: { offset: ordered.startOffset },
            focus: { offset: ordered.endOffset },
            anchorPath: ordered.startPath,
            focusPath: ordered.endPath,
        });

        return id;
    }

    removeComment(id: string): boolean {
        this._muya.flush();
        const before = this._muya.editor.jsonState.commentModel;
        const hasThread = before.threads.has(id);
        const hasAnchors = before.anchors.some(anchor => anchor.id === id);
        if (!hasThread && !hasAnchors)
            return false;

        const after = cloneCommentModel(before);
        after.threads.delete(id);
        after.anchors = after.anchors.filter(anchor => anchor.id !== id);
        this._commitCommentModel(cloneCommentModel(before), after);

        return true;
    }

    updateCommentThread(id: string, patch: TUpdateCommentThreadPatch): boolean {
        return this._replaceCommentMetadata(id, metadata => mergeCommentMetadataPatch(metadata, patch));
    }

    replyToComment(id: string, reply: ICommentReplyInput): boolean {
        return this._replaceCommentMetadata(id, metadata => appendCommentReplyMetadata(metadata, reply));
    }

    resolveComment(id: string, updatedAt = new Date().toISOString()): boolean {
        return this.updateCommentThread(id, { status: 'resolved', updatedAt });
    }

    reopenComment(id: string, updatedAt = new Date().toISOString()): boolean {
        return this.updateCommentThread(id, { status: 'open', updatedAt });
    }

    focusComment(id: string): boolean {
        const range = this.getComments().ranges.find(range => range.id === id);
        // An unpaired anchor (orphan-close diagnostics) has no derived range;
        // collapse the caret onto the surviving anchor so the click still
        // navigates. Fully detached threads have nothing in the document to
        // focus — the sidebar presents those distinctly.
        const anchor = range
            ? null
            : this._muya.editor.jsonState.commentModel.anchors.find(entry => entry.id === id);
        const location = range
            ? {
                    startPath: range.startPath,
                    startOffset: range.startOffset,
                    endPath: range.endPath,
                    endOffset: range.endOffset,
                }
            : anchor
                ? {
                        startPath: anchor.position.slice(0, -1),
                        startOffset: anchor.position[anchor.position.length - 1] as number,
                        endPath: anchor.position.slice(0, -1),
                        endOffset: anchor.position[anchor.position.length - 1] as number,
                    }
                : null;
        if (!location)
            return false;

        const cursor = {
            anchor: { offset: location.startOffset },
            focus: { offset: location.endOffset },
            anchorPath: location.startPath,
            focusPath: location.endPath,
        };
        this._muya.setCursor(cursor);

        const block = this._muya.editor.scrollPage?.queryBlock([...location.startPath]);
        const element = block?.domNode;
        if (element && typeof element.scrollIntoView === 'function')
            element.scrollIntoView({ block: 'center', inline: 'nearest' });

        return true;
    }

    private _replaceCommentMetadata(
        id: string,
        updater: (metadata: ICommentMetadata) => ICommentMetadata,
    ): boolean {
        this._muya.flush();
        const before = this._muya.editor.jsonState.commentModel;
        const thread = before.threads.get(id);
        if (!thread)
            return false;

        const { id: _id, ...metadata } = thread;
        const after = cloneCommentModel(before);
        after.threads.set(id, { id, ...normalizeCommentMetadata(updater(metadata)) });
        this._commitCommentModel(cloneCommentModel(before), after);

        return true;
    }
}
