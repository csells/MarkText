import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { TState } from '../state/types';
import type { Nullable } from '../types';
import { mappedPathsEqual } from '../mapped-range';
import { PostCommitNotificationError, PreparedSelectionError } from './errors';

function assertPreparedSelection(
    muya: Muya,
    selection: IHistorySelection,
): void {
    const { scrollPage } = muya.editor;
    const anchor = scrollPage?.queryBlock([...selection.anchor.path]);
    const focus = scrollPage?.queryBlock([...selection.focus.path]);
    const preparedAnchor = muya.editor.selection.anchor;
    const preparedFocus = muya.editor.selection.focus;
    const actual = muya.editor.selection.getSelection();
    if (
        !anchor?.isContent()
        || !focus?.isContent()
        || !preparedAnchor
        || !preparedFocus
        || !actual
        || preparedAnchor.offset !== selection.anchor.offset
        || preparedFocus.offset !== selection.focus.offset
        || !mappedPathsEqual(
            muya.editor.selection.anchorPath,
            selection.anchor.path,
        )
        || !mappedPathsEqual(
            muya.editor.selection.focusPath,
            selection.focus.path,
        )
        || !mappedPathsEqual(actual.anchor.path, selection.anchor.path)
        || !mappedPathsEqual(actual.focus.path, selection.focus.path)
    ) {
        throw new PreparedSelectionError();
    }
}

/** Execute one buffered, rollback-safe whole-document replacement. */
export function replaceDocumentContent(
    muya: Muya,
    content: TState[] | string,
    recordSelection?: Nullable<IHistorySelection>,
    nextSelection?: IHistorySelection,
): boolean {
    muya.flush();
    const { jsonState, history } = muya.editor;
    const { op, prevState } = jsonState.buildReplaceOp(content);
    if (op.length === 0)
        return false;

    const selection = muya.editor.selection.getSelection();
    const boundarySelection = recordSelection !== undefined
        ? recordSelection
        : selection;
    const historyCheckpoint = history.getHistory();
    try {
        history.suppressRecording(() => {
            muya.editor.rebuildContents(
                op,
                nextSelection ?? selection,
                'api',
                () => {
                    if (nextSelection)
                        assertPreparedSelection(muya, nextSelection);
                    history.recordRebuild(op, prevState, boundarySelection);
                },
            );
        });
    }
    catch (error) {
        if (!(error instanceof PostCommitNotificationError))
            history.setHistory(historyCheckpoint);
        throw error;
    }
    return true;
}
