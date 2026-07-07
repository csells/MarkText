import type { Muya } from '../muya';
import type { Nullable } from '../types';
import type { IAddCommentInput, TUpdateCommentThreadPatch } from './edit';
import type {
    ICommentMetadata,
    ICommentReplyInput,
    IParsedMarkdownComments,
} from './types';
import { analyzeMarkdownComments } from './analyze';
import {
    appendCommentReplyMetadata,
    canWrapCommentRange,
    createCommentMetadata,

    mergeCommentMetadataPatch,
    nextCommentId,

    updateCommentMetadataDefinition,
    wrapCommentRange,
} from './edit';
import {
    buildTextPathIndexes,
    locateCommentSyntax,
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
                comments: analyzeMarkdownComments(states).comments,
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

    // Guard refusals (an edit that would corrupt comment syntax) are policy,
    // not errors — but they must never be SILENT. Every guard funnels its
    // refusal through here so the host can show feedback.
    notifyCommentEditBlocked(): void {
        this._muya.eventCenter.emit('comment-edit-blocked');
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

    // Returns the created thread's id, or null when the selection is not
    // commentable — the caller needs the id to open the compose flow, and
    // re-deriving it from a before/after diff costs two extra analyses.
    addComment(input: IAddCommentInput = {}): string | null {
        // Commit any rAF-batched keystroke ops before reading state below —
        // building the replacement from a stale snapshot would let the pending
        // op flush onto the replaced document later (the #2938 lost-edit class).
        this._muya.flush();
        const selection = this._muya.editor.selection.getSelection();
        if (!selection || selection.isCollapsed)
            return null;

        const id = this._reserveCommentId(input);
        if (id == null)
            return null;

        const states = this._muya.editor.jsonState.getState();
        const nextStates = wrapCommentRange({
            states,
            path: selection.anchor.path,
            endPath: selection.focus.path,
            startOffset: selection.anchor.offset,
            endOffset: selection.focus.offset,
            id,
            metadata: createCommentMetadata(input),
        });

        if (!nextStates)
            return null;

        const nextRange = analyzeMarkdownComments(nextStates).comments.ranges.find(range => range.id === id);
        const changed = this._muya.replaceContent(nextStates, selection);
        if (changed && nextRange) {
            this._muya.setCursor({
                anchor: { offset: nextRange.startOffset },
                focus: { offset: nextRange.endOffset },
                anchorPath: nextRange.startPath,
                focusPath: nextRange.endPath,
            });
        }

        return changed ? id : null;
    }

    removeComment(id: string): boolean {
        // See addComment: commit pending ops before snapshotting the document.
        this._muya.flush();
        const currentMarkdown = this._muya.getMarkdown();
        const analysis = analyzeMarkdownComments(currentMarkdown);
        const sourceMap = analysis.sourceMaps.ranges.find(range => range.id === id);
        if (!sourceMap)
            return false;

        let nextMarkdown = currentMarkdown;
        for (const range of sourceMap.syntaxRemovalRanges)
            nextMarkdown = `${nextMarkdown.slice(0, range.start)}${nextMarkdown.slice(range.end)}`;
        if (nextMarkdown === currentMarkdown)
            return false;

        // Backstop against index/parser drift: a removal must be COMPLETE.
        // Applying a partial removal (say, the definition without its
        // markers) would silently corrupt the document — refuse instead.
        const residue = analyzeMarkdownComments(nextMarkdown).sourceIndex;
        if (
            residue.markers.some(marker => marker.id === id)
            || residue.metadataDefinitions.some(definition => definition.id === id)
        ) {
            return false;
        }

        return this._muya.replaceContent(nextMarkdown);
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
        // A diagnostic for an orphan/malformed comment has no derived range;
        // fall back to the raw marker or metadata definition so the click still
        // navigates instead of being a silent no-op.
        const location = range
            ? {
                    startPath: range.startPath,
                    startOffset: range.startOffset,
                    endPath: range.endPath,
                    endOffset: range.endOffset,
                }
            : locateCommentSyntax(this._muya.editor.jsonState.getState(), id);
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
        // See addComment: commit pending ops before snapshotting the document.
        this._muya.flush();
        const nextStates = updateCommentMetadataDefinition(
            this._muya.editor.jsonState.getState(),
            id,
            updater,
        );
        if (!nextStates)
            return false;

        // Only the hidden `[MC:id]:` metadata line changes here — the visible
        // blocks and their paths are untouched. Preserve the editor's caret
        // across the rebuild from the CACHED selection (the live DOM selection
        // is empty while the user is typing in the sidebar), so replying or
        // resolving never yanks the caret to the document start.
        const { selection } = this._muya.editor;
        const preserved
            = selection.anchor && selection.focus
                ? {
                        anchor: { offset: selection.anchor.offset },
                        focus: { offset: selection.focus.offset },
                        anchorPath: selection.anchorPath,
                        focusPath: selection.focusPath,
                    }
                : null;

        const changed = this._muya.replaceContent(nextStates);
        if (changed && preserved)
            this._muya.setCursor(preserved);

        return changed;
    }
}
