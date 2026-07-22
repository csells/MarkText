import type {
    DocumentSession,
    EditorIntent,
    EditorSnapshot,
    MarkupLiveRenderPlan,
    ModelPosition,
    ModelSelection,
} from '@marktext/document-core';

type BrowserSessionClient = Pick<DocumentSession, 'dispatch' | 'snapshot' | 'subscribe'>;

interface MountedGeneration {
    readonly revision: string;
    readonly text: string;
}

export interface BoundDocumentSession {
    readonly generations: () => readonly MountedGeneration[];
}

function createRunElement(run: MarkupLiveRenderPlan['runs'][number]): HTMLElement {
    const primaryMark = run.marks[run.marks.length - 1];
    const tagName = primaryMark?.kind === 'addition'
        || (primaryMark?.kind === 'substitution' && primaryMark.arm === 'new')
        ? 'ins'
        : primaryMark?.kind === 'deletion'
            || (primaryMark?.kind === 'substitution' && primaryMark.arm === 'old')
            ? 'del'
            : primaryMark?.kind === 'highlight'
                ? 'mark'
                : 'span';
    const element = document.createElement(tagName);
    element.dataset.modelStart = String(run.modelRange.start);
    element.dataset.modelEnd = String(run.modelRange.end);
    element.dataset.runKey = run.key;
    element.dataset.marks = run.marks
        .map(mark => mark.kind === 'substitution' ? `${mark.kind}-${mark.arm}` : mark.kind)
        .join(' ');
    element.textContent = run.text;
    return element;
}

function mountCaret(editor: HTMLElement, snapshot: EditorSnapshot): void {
    const selection = snapshot.revision.selection;
    if (selection === null || selection.anchor.offset !== selection.focus.offset)
        throw new Error('The Phase 0 browser tracer requires one collapsed selection');

    const modelPosition = selection.anchor;
    const runElements = [...editor.children];
    for (const [index, run] of snapshot.livePlan.runs.entries()) {
        const element = runElements[index];
        if (!(element instanceof HTMLElement))
            throw new Error('Committed render plan is missing a run element');
        const isInterior = modelPosition.offset > run.modelRange.start
            && modelPosition.offset < run.modelRange.end;
        const isPreferredStart = modelPosition.offset === run.modelRange.start
            && modelPosition.affinity === 'next';
        const isPreferredEnd = modelPosition.offset === run.modelRange.end
            && modelPosition.affinity === 'previous';
        const isDocumentStart = modelPosition.offset === 0 && index === 0;
        const isDocumentEnd = modelPosition.offset === snapshot.livePlan.modelLength
            && index === snapshot.livePlan.runs.length - 1;
        if (!isInterior && !isPreferredStart && !isPreferredEnd && !isDocumentStart && !isDocumentEnd)
            continue;
        const text = element.firstChild;
        if (text === null)
            continue;
        const range = document.createRange();
        range.setStart(text, modelPosition.offset - run.modelRange.start);
        range.collapse(true);
        const browserSelection = window.getSelection();
        if (browserSelection === null)
            throw new Error('Browser selection is unavailable');
        browserSelection.removeAllRanges();
        browserSelection.addRange(range);
        return;
    }

    if (snapshot.livePlan.modelLength === 0 && modelPosition.offset === 0) {
        const range = document.createRange();
        range.setStart(editor, 0);
        range.collapse(true);
        const browserSelection = window.getSelection();
        if (browserSelection === null)
            throw new Error('Browser selection is unavailable');
        browserSelection.removeAllRanges();
        browserSelection.addRange(range);
        return;
    }
    throw new RangeError('Committed model caret is outside the mounted plan');
}

function modelPositionAtDomPoint(
    editor: HTMLElement,
    snapshot: EditorSnapshot,
    node: Node,
    offset: number,
): ModelPosition {
    if (node === editor) {
        if (!Number.isInteger(offset) || offset < 0 || offset > editor.childNodes.length)
            throw new RangeError('Browser container selection has an invalid child offset');
        const nextRun = snapshot.livePlan.runs[offset];
        return Object.freeze({
            offset: nextRun?.modelRange.start ?? snapshot.livePlan.modelLength,
            affinity: 'next' as const,
        });
    }

    const element = node instanceof HTMLElement ? node : node.parentElement;
    const runElement = element?.parentElement === editor ? element : element?.parentElement;
    if (!(runElement instanceof HTMLElement) || runElement.parentElement !== editor)
        throw new Error('Browser selection is outside the committed render plan');

    const runIndex = [...editor.children].indexOf(runElement);
    const run = snapshot.livePlan.runs[runIndex];
    if (run === undefined || runElement.textContent !== run.text)
        throw new Error('Browser run no longer matches the committed render plan');
    const prefix = document.createRange();
    prefix.selectNodeContents(runElement);
    prefix.setEnd(node, offset);
    const modelOffset = run.modelRange.start + prefix.toString().length;
    if (
        !Number.isInteger(modelOffset)
        || modelOffset < run.modelRange.start
        || modelOffset > run.modelRange.end
    ) {
        throw new RangeError('Browser selection is outside its committed render run');
    }

    const nextRun = snapshot.livePlan.runs[runIndex + 1];
    const affinity = modelOffset === run.modelRange.end
        && nextRun?.modelRange.start === modelOffset
        ? 'previous'
        : 'next';

    return Object.freeze({ offset: modelOffset, affinity });
}

function selectionFromDom(editor: HTMLElement, snapshot: EditorSnapshot) {
    const selection = window.getSelection();
    if (
        selection === null
        || selection.anchorNode === null
        || selection.focusNode === null
    ) {
        throw new Error('Browser selection is unavailable');
    }

    return snapshot.livePlan.selectionAt({
        anchor: modelPositionAtDomPoint(
            editor,
            snapshot,
            selection.anchorNode,
            selection.anchorOffset,
        ),
        focus: modelPositionAtDomPoint(
            editor,
            snapshot,
            selection.focusNode,
            selection.focusOffset,
        ),
    });
}

export function mountCommittedSnapshot(editor: HTMLElement, snapshot: EditorSnapshot): void {
    if (snapshot.livePlan.revision !== snapshot.revision.id)
        throw new Error('Live render plan does not belong to the committed revision');
    const selection = snapshot.revision.selection;
    if (selection === null || selection.anchor.offset !== selection.focus.offset)
        throw new Error('The Phase 0 browser tracer requires one collapsed selection');
    snapshot.livePlan.selectionAt({
        anchor: selection.anchor,
        focus: selection.focus,
    });
    if (window.getSelection() === null)
        throw new Error('Browser selection is unavailable');

    const fragment = document.createDocumentFragment();
    for (const run of snapshot.livePlan.runs)
        fragment.appendChild(createRunElement(run));

    editor.replaceChildren(fragment);
    editor.contentEditable = 'true';
    editor.spellcheck = false;
    editor.dataset.plan = snapshot.livePlan.id;
    editor.dataset.revision = snapshot.revision.id;

    editor.dataset.modelCaret = String(selection.anchor.offset);
    mountCaret(editor, snapshot);
}

export function bindDocumentSession(
    editor: HTMLElement,
    session: BrowserSessionClient,
): BoundDocumentSession {
    if ('preparePersistence' in session || 'flush' in session)
        throw new Error('Browser adapter received host-only source capabilities');

    const generations: MountedGeneration[] = [];
    const mount = (snapshot: EditorSnapshot): void => {
        mountCommittedSnapshot(editor, snapshot);
        generations.push(Object.freeze({
            revision: snapshot.revision.id,
            text: editor.textContent ?? '',
        }));
    };

    editor.dataset.inputEvents = '0';
    editor.addEventListener('input', () => {
        editor.dataset.inputEvents = String(Number(editor.dataset.inputEvents ?? '0') + 1);
    });

    session.subscribe((transition) => {
        if (transition.kind === 'revision-changed')
            mount(transition.after);
    });

    editor.addEventListener('beforeinput', (event) => {
        if (!(event instanceof InputEvent) || event.inputType !== 'insertText' || event.data === null)
            return;

        const snapshot = session.snapshot();
        let target: ModelSelection;
        try {
            target = selectionFromDom(editor, snapshot);
        }
        catch (error: unknown) {
            event.preventDefault();
            editor.dataset.undispatchedInput = event.data;
            editor.dataset.commitError = error instanceof Error ? error.message : String(error);
            return;
        }

        event.preventDefault();
        editor.dataset.beforeinputTrusted = String(event.isTrusted);
        editor.dataset.beforeinputPrevented = String(event.defaultPrevented);
        editor.dataset.beforeinputDom = editor.textContent ?? '';
        editor.dataset.beforeinputRevision = editor.dataset.revision ?? '';

        const intent: EditorIntent = {
            kind: 'insert-text',
            target,
            text: event.data,
        };
        void session.dispatch(intent).completion.then((result) => {
            if (result.kind !== 'committed')
                throw new Error(`Browser insertion did not commit: ${result.kind}`);
        }).catch((error: unknown) => {
            editor.dataset.commitError = error instanceof Error ? error.message : String(error);
        });
    });

    mount(session.snapshot());
    return Object.freeze({
        generations: () => Object.freeze([...generations]),
    });
}
