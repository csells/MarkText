import type { ScrollPage } from '../block/scrollPage';
import type { TBlockPath } from '../block/types';
import type { Muya } from '../muya';
import type { IIndexCursor } from './offsetCursor';
import type { IPublicCursorInput } from './types';
import {
    injectSentinels,
    injectStateSentinels,
    locateSentinelOffsets,
    resolveSentinelCursor,
} from './offsetCursor';

/** Programmatic path/index cursor translation, kept out of the Muya facade. */
export class CursorController {
    constructor(private readonly _muya: Muya) {}

    set(cursor: IPublicCursorInput): void {
        const { editor } = this._muya;
        const { scrollPage } = editor;
        if (!scrollPage)
            return;

        const { anchor, focus, anchorPath, focusPath }
            = this._normalizeEndpoints(cursor);
        if (!anchor || !focus)
            return;

        const { anchorBlock, focusBlock } = this._resolveBlocks(
            cursor,
            scrollPage,
            anchorPath,
            focusPath,
        );
        if (anchorBlock == null || !anchorBlock.isContent())
            return;

        if (anchorBlock === focusBlock || focusBlock == null) {
            anchorBlock.setCursor(
                Math.min(anchor.offset, focus.offset),
                Math.max(anchor.offset, focus.offset),
                true,
            );
            return;
        }
        if (!focusBlock.isContent())
            return;

        editor.selection.setSelection(
            { offset: anchor.offset, block: anchorBlock, path: anchorBlock.path },
            { offset: focus.offset, block: focusBlock, path: focusBlock.path },
        );
    }

    setByOffset(indexCursor: IIndexCursor): boolean {
        const { editor } = this._muya;
        if (!editor.scrollPage)
            return false;

        const cleanMarkdown = this._muya.getMarkdown();
        const sentinelMarkdown = injectSentinels(cleanMarkdown, indexCursor);
        if (sentinelMarkdown == null)
            return false;

        const savedHistory = this._muya.getHistory();
        editor.setContent(sentinelMarkdown);
        const cursor = resolveSentinelCursor(editor.scrollPage!);
        editor.setContent(cleanMarkdown);
        this._muya.setHistory(savedHistory);
        if (!cursor)
            return false;

        this.set(cursor);
        return true;
    }

    getOffset(): IIndexCursor | null {
        const { editor } = this._muya;
        const selection = editor.selection.getSelection();
        if (!selection)
            return null;

        const sentinelState = injectStateSentinels(
            editor.jsonState.getState(),
            selection,
        );
        if (!sentinelState)
            return null;

        return locateSentinelOffsets(
            editor.jsonState.getMarkdownFromState(sentinelState),
        );
    }

    private _normalizeEndpoints(cursor: IPublicCursorInput) {
        const anchor = cursor.anchor ?? cursor.start ?? null;
        const focus = cursor.focus ?? cursor.end ?? anchor;
        const anchorPath = cursor.anchorPath ?? cursor.path;
        const focusPath = cursor.focusPath ?? cursor.path ?? anchorPath;

        return { anchor, focus, anchorPath, focusPath };
    }

    private _resolveBlocks(
        cursor: IPublicCursorInput,
        scrollPage: ScrollPage,
        anchorPath: TBlockPath | undefined,
        focusPath: TBlockPath | undefined,
    ) {
        const anchorBlock = cursor.anchorBlock
            ?? cursor.block
            ?? (anchorPath ? scrollPage.queryBlock([...anchorPath]) : null);
        const focusBlock = cursor.focusBlock
            ?? cursor.block
            ?? (focusPath ? scrollPage.queryBlock([...focusPath]) : null);

        return { anchorBlock, focusBlock };
    }
}
