// @vitest-environment happy-dom

import type { ICapturedStateMutation } from '../../../state/mutationCapture';
import type Format from '../format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pastePlainText } from '../../../clipboard/paste';
import { scanCriticMarkup } from '../../../criticMarkup/parser';
import { projectCriticMarkupTokens } from '../../../criticMarkup/project';
import { Muya } from '../../../muya';

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
        criticMarkupTrackChanges: true,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    const block = muya.editor.scrollPage!.firstContentInDescendant() as Format;
    return { muya, block };
}

function input(
    block: Format,
    browserText: string,
    caret: number,
    inputType: string,
    data: string | null,
) {
    block.domNode!.textContent = browserText;
    block.setCursor(caret, caret);
    block.inputHandler(new InputEvent('input', {
        bubbles: true,
        data,
        inputType,
    }));
}

function press(block: Format, key: string, shiftKey = false) {
    const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
    });
    block.domNode!.dispatchEvent(event);
    return event;
}

function contentByText(muya: Muya, text: string): Format {
    let block = muya.editor.scrollPage!.firstContentInDescendant();
    while (block) {
        if (block.text === text)
            return block as Format;
        block = block.nextContentInContext() ?? null;
    }

    throw new Error(`content block with text "${text}" not found`);
}

function canonical(markdown: string): string {
    return boot(markdown).muya.getMarkdown();
}

function expectExactProjections(
    tracked: string,
    original: string,
    revised: string,
): void {
    const tokens = scanCriticMarkup(tracked);
    expect(projectCriticMarkupTokens(tracked, 'original', tokens))
        .toBe(original);
    expect(projectCriticMarkupTokens(tracked, 'revised', tokens))
        .toBe(revised);
}

function observeCapturedMutation(
    muya: Muya,
    mutate: () => void,
): ICapturedStateMutation<unknown> {
    const capture = vi.spyOn(muya.editor.jsonState, 'capture');
    let result: (typeof capture.mock.results)[number] | undefined;
    try {
        mutate();
        result = capture.mock.results.at(-1);
    }
    finally {
        capture.mockRestore();
    }
    if (!result || result.type !== 'return') {
        throw new TypeError(
            'Expected the mutation gateway to return one captured operation batch.',
        );
    }
    return result.value;
}

function onlyTextIntent(captured: ICapturedStateMutation<unknown>) {
    const [intent] = captured.intents;
    if (captured.intents.length !== 1 || intent?.kind !== 'text-edit') {
        throw new TypeError(
            'Expected one text-edit intent from the browser input operation.',
        );
    }
    return intent;
}

function intentShape(captured: ICapturedStateMutation<unknown>) {
    return captured.intents.map(intent => ({
        kind: intent.kind,
        path: intent.path,
    }));
}

function expectSingleUndoRedo(
    muya: Muya,
    before: string,
    after: string,
): void {
    expect(muya.getHistory().stack.undo).toHaveLength(1);
    muya.undo();
    expect(muya.getMarkdown()).toBe(before);
    expect(muya.getHistory().stack.redo).toHaveLength(1);
    muya.redo();
    expect(muya.getMarkdown()).toBe(after);
}

describe('format Track Changes input path', () => {
    it.each([
        {
            edge: 'before the opening delimiter',
            browserText: 'aL{++x++}b',
            caret: 2,
            oldRange: { start: 1, end: 1 },
            inserted: 'L',
            revised: 'aLxb\n',
            tracked: 'a{++L++}{++x++}b\n',
        },
        {
            edge: 'after the closing delimiter',
            browserText: 'a{++x++}Rb',
            caret: 9,
            oldRange: { start: 8, end: 8 },
            inserted: 'R',
            revised: 'axRb\n',
            tracked: 'a{++x++}{++R++}b\n',
        },
    ])('keeps typing $edge as its own exact operation', ({
        browserText,
        caret,
        oldRange,
        inserted,
        revised,
        tracked,
    }) => {
        const source = 'a{++x++}b\n';
        const { muya, block } = boot(source);

        const captured = observeCapturedMutation(muya, () =>
            input(block, browserText, caret, 'insertText', inserted));
        const intent = onlyTextIntent(captured);

        expect(intent.path).toEqual([0, 'text']);
        expect(intent.edits).toEqual([{
            oldRange,
            inserted,
        }]);
        expect(muya.getMarkdown()).toBe(tracked);
        expectExactProjections(tracked, 'ab\n', revised);
        expectSingleUndoRedo(muya, source, tracked);
    });

    it('turns ordinary typing into an addition and coalesces the next key', () => {
        const { muya, block } = boot('ab\n');

        input(block, 'acb', 2, 'insertText', 'c');
        expect(muya.getMarkdown()).toBe('a{++c++}b\n');

        input(
            muya.editor.scrollPage!.firstContentInDescendant() as Format,
            'a{++cd++}b',
            6,
            'insertText',
            'd',
        );
        expect(muya.getMarkdown()).toBe('a{++cd++}b\n');
    });

    it('turns a backward deletion into a pending deletion', () => {
        const { muya, block } = boot('abc\n');

        input(block, 'ac', 1, 'deleteContentBackward', null);

        expect(muya.getMarkdown()).toBe('a{--b--}c\n');
    });

    it('captures forward Delete as the exact deleted range and one undo boundary', () => {
        const source = 'abc\n';
        const { muya, block } = boot(source);

        const captured = observeCapturedMutation(muya, () =>
            input(block, 'ac', 1, 'deleteContentForward', null));
        const intent = onlyTextIntent(captured);
        const tracked = muya.getMarkdown();

        expect(intent.path).toEqual([0, 'text']);
        expect(intent.edits).toEqual([{
            oldRange: { start: 1, end: 2 },
            inserted: '',
        }]);
        expect(tracked).toBe('a{--b--}c\n');
        expectExactProjections(tracked, source, 'ac\n');
        expectSingleUndoRedo(muya, source, tracked);
    });

    it('turns browser replacement into one atomic substitution', () => {
        const { muya, block } = boot('abc\n');

        input(block, 'axc', 2, 'insertReplacementText', 'x');

        expect(muya.getMarkdown()).toBe('a{~~b~>x~~}c\n');
    });

    it('captures a selected range replacement without widening either side', () => {
        const source = 'abcd\n';
        const { muya, block } = boot(source);
        block.setCursor(1, 3, true);

        const captured = observeCapturedMutation(muya, () =>
            input(block, 'aXd', 2, 'insertReplacementText', 'X'));
        const intent = onlyTextIntent(captured);
        const tracked = muya.getMarkdown();

        expect(intent.path).toEqual([0, 'text']);
        expect(intent.edits).toEqual([{
            oldRange: { start: 1, end: 3 },
            inserted: 'X',
        }]);
        expect(tracked).toBe('a{~~bc~>X~~}d\n');
        expectExactProjections(tracked, source, 'aXd\n');
        expectSingleUndoRedo(muya, source, tracked);
    });

    it('rejects a Critic delimiter edit without publishing state or history', () => {
        const source = 'a{++x++}b\n';
        const { muya, block } = boot(source);
        const changes = vi.fn();
        const rejected = vi.fn();
        muya.on('json-change', changes);
        muya.on('critic-markup-track-change-rejected', rejected);

        const captured = observeCapturedMutation(muya, () =>
            input(block, 'a++x++}b', 1, 'deleteContentForward', null));
        const intent = onlyTextIntent(captured);

        expect(intent.edits).toEqual([{
            oldRange: { start: 1, end: 2 },
            inserted: '',
        }]);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getState()).toEqual(captured.beforeState);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        expect(changes).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('rejects atomically when either tracked selection endpoint is unmappable', () => {
        const source = 'ab\n';
        const { muya, block } = boot(source);
        const beforeState = muya.getState();
        const changes = vi.fn();
        const rejected = vi.fn();
        muya.on('json-change', changes);
        muya.on('critic-markup-track-change-rejected', rejected);
        const beginSession = muya.editor.criticMarkupDocument
            .beginSession
            .bind(muya.editor.criticMarkupDocument);
        vi.spyOn(muya.editor.criticMarkupDocument, 'beginSession')
            .mockImplementation(() => {
                const session = beginSession();
                const bindAnalysisForState = session.bindAnalysisForState;
                return {
                    ...session,
                    bindAnalysisForState(analysis, state) {
                        const document = bindAnalysisForState(analysis, state);
                        return new Proxy(document, {
                            get(target, property) {
                                if (property === 'localPositionAt')
                                    return () => null;
                                const value = Reflect.get(
                                    target,
                                    property,
                                    target,
                                );
                                return typeof value === 'function'
                                    ? value.bind(target)
                                    : value;
                            },
                        });
                    },
                };
            });

        input(block, 'axb', 2, 'insertText', 'x');

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getState()).toEqual(beforeState);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        expect(changes).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'unmappable-tracked-selection',
        }));
    });

    it('rejects atomically when a tracked selection block is missing after rebuild', () => {
        const source = 'ab\n';
        const { muya, block } = boot(source);
        const beforeState = muya.getState();
        const changes = vi.fn();
        const selections = vi.fn();
        const rejected = vi.fn();
        muya.on('json-change', changes);
        muya.on('selection-change', selections);
        muya.on('critic-markup-track-change-rejected', rejected);
        const scrollPage = muya.editor.scrollPage!;
        const queryBlock = scrollPage.queryBlock.bind(scrollPage);
        let injected = false;
        vi.spyOn(scrollPage, 'queryBlock').mockImplementation((path) => {
            if (!injected && muya.getMarkdown() !== source) {
                injected = true;
                return undefined;
            }
            return queryBlock(path);
        });

        block.domNode!.textContent = 'axb';
        block.setCursor(2, 2);
        selections.mockClear();
        block.inputHandler(new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText',
        }));

        expect(injected).toBe(true);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getState()).toEqual(beforeState);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        expect(changes).not.toHaveBeenCalled();
        expect(selections).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'missing-tracked-selection-block',
        }));
    });

    it('tracks typing into an empty leaf through its source insertion boundary', () => {
        const { muya, block } = boot('\n');
        const before = muya.getMarkdown();

        input(block, 'x', 1, 'insertText', 'x');

        const tracked = muya.getMarkdown();
        expect(tracked).toBe('{++x++}\n');
        expectExactProjections(tracked, before, 'x\n');
    });

    it('tracks insertion before an escaped table pipe without moving past its escape', () => {
        const source = [
            '| head |',
            '| --- |',
            '| a\\|b |',
            '',
        ].join('\n');
        const expected = canonical([
            '| head |',
            '| --- |',
            '| ax\\|b |',
            '',
        ].join('\n'));
        const { muya } = boot(source);
        const before = muya.getMarkdown();
        const block = contentByText(muya, 'a|b');

        input(block, 'ax|b', 2, 'insertText', 'x');

        const tracked = muya.getMarkdown();
        expectExactProjections(tracked, before, expected);
        expect(tracked).toContain('{++x++}\\|b');
        expect(tracked).not.toContain('\\{++x++}|b');
    });

    it('tracks table-cell growth without putting review syntax in the delimiter', () => {
        const source = [
            '| head | second |',
            '| --- | --- |',
            '| x | edited-row-peer |',
            '| stable-tail | untouched |',
            '',
        ].join('\n');
        const { muya } = boot(source);
        const before = muya.getMarkdown();
        const block = contentByText(muya, 'x');
        const replacement = 'a-very-wide-cell-value';
        const proposedState = muya.getState();
        const proposedTable = proposedState[0];
        if (proposedTable?.name !== 'table')
            throw new Error('expected a table state');
        proposedTable.children[1].children[0].text = replacement;
        const expected = muya.editor.jsonState
            .getMarkdownFromState(proposedState);

        input(
            block,
            replacement,
            replacement.length,
            'insertReplacementText',
            replacement,
        );

        const tracked = muya.getMarkdown();
        expectExactProjections(tracked, before, expected);
        expect(tracked.split('\n')[1]).not.toContain('{');
        expect(muya.editor.jsonState.markdownToState(tracked)[0]?.name)
            .toBe('table');
    });

    it('commits one IME composition as one tracked addition', () => {
        const { muya, block } = boot('ab\n');
        block.composeHandler(new CompositionEvent('compositionstart'));
        block.domNode!.textContent = 'acb';
        block.setCursor(2, 2);

        block.composeHandler(new CompositionEvent('compositionend', {
            data: 'c',
        }));
        muya.flush();

        expect(muya.getMarkdown()).toBe('a{++c++}b\n');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
        muya.undo();
        expect(muya.getMarkdown()).toBe('ab\n');
    });

    it('tracks a same-block cut through the shared mutation service', () => {
        const { muya, block } = boot('abc\n');
        block.setCursor(1, 2, true);

        muya.editor.clipboard.cutHandler();

        expect(muya.getMarkdown()).toBe('a{--b--}c\n');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
    });

    it('tracks a cross-block cut as one document deletion', () => {
        const { muya } = boot('ab\n\ncd\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        muya.editor.selection.setSelection(
            { offset: 1, block: first, path: first.path },
            { offset: 1, block: last, path: last.path },
        );

        muya.editor.clipboard.cutHandler();

        expect(muya.getMarkdown()).toBe('a{--b\n\nc--}d\n');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
    });

    it('tracks pasted text as an addition', async () => {
        const { muya, block } = boot('ab\n');
        block.setCursor(1, 1, true);

        await pastePlainText(muya.editor.clipboard, 'x');

        expect(muya.getMarkdown()).toBe('a{++x++}b\n');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
    });

    it('tracks a multi-paragraph paste as one linked addition', async () => {
        const { muya, block } = boot('ab\n');
        block.setCursor(1, 1, true);

        await pastePlainText(muya.editor.clipboard, 'x\n\ny');

        expect(muya.getMarkdown()).toBe('a{++x\n\ny++}b\n');
        expect(muya.getCriticMarkupItems()).toHaveLength(1);
        expect(muya.getCriticMarkupItems()[0].fragments.length)
            .toBeGreaterThan(1);
    });

    it('tracks a cross-block paste replacement as one substitution', async () => {
        const { muya } = boot('ab\n\ncd\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        muya.editor.selection.setSelection(
            { offset: 1, block: first, path: first.path },
            { offset: 1, block: last, path: last.path },
        );

        await pastePlainText(muya.editor.clipboard, 'X');

        expect(muya.getMarkdown()).toBe('a{~~b\n\nc~>X~~}d\n');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
    });

    it('tracks a paragraph split as one block-spanning addition', () => {
        const { muya, block } = boot('ab\n');
        const onChange = vi.fn();
        muya.on('json-change', onChange);
        block.setCursor(1, 1, true);

        press(block, 'Enter');
        muya.flush();

        expect(muya.getMarkdown()).toBe('a{++\n\n++}b\n');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
        expect(onChange).toHaveBeenCalledTimes(1);

        muya.undo();
        expect(muya.getMarkdown()).toBe('ab\n');
        muya.redo();
        expect(muya.getMarkdown()).toBe('a{++\n\n++}b\n');
    });

    it('tracks a paragraph join as one block-spanning deletion', () => {
        const { muya } = boot('a\n\nb\n');
        const block = muya.editor.scrollPage!.lastContentInDescendant() as Format;
        block.setCursor(0, 0, true);

        press(block, 'Backspace');
        muya.flush();

        expect(muya.getMarkdown()).toBe('a{--\n\n--}b\n');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
    });

    it('tracks a paragraph-to-heading block conversion from its insert/remove intents', () => {
        const source = 'hello\n';
        const { muya, block } = boot(source);
        block.setCursor(2, 2, true);

        const captured = observeCapturedMutation(muya, () =>
            muya.updateParagraph('heading 1'));
        const tracked = muya.getMarkdown();

        expect(intentShape(captured)).toEqual([
            { kind: 'insert', path: [0] },
            { kind: 'remove', path: [1] },
        ]);
        expect(tracked).toBe('{++# ++}hello\n');
        expectExactProjections(tracked, source, '# hello\n');
        expectSingleUndoRedo(muya, source, tracked);
    });

    it('tracks wrapping a paragraph in a list from its structural operation island', () => {
        const source = 'item\n';
        const { muya, block } = boot(source);
        block.setCursor(2, 2, true);

        const captured = observeCapturedMutation(muya, () =>
            muya.updateParagraph('ul-bullet'));
        const tracked = muya.getMarkdown();

        expect(intentShape(captured)).toEqual([
            { kind: 'insert', path: [0] },
            { kind: 'remove', path: [1] },
        ]);
        expect(tracked).toBe('{++- ++}item\n');
        expectExactProjections(tracked, source, '- item\n');
        expectSingleUndoRedo(muya, source, tracked);
    });

    it('tracks a structural list-type conversion without sweeping item text', () => {
        const source = '- one\n- two\n';
        const { muya, block } = boot(source);
        block.setCursor(1, 1, true);

        const captured = observeCapturedMutation(muya, () =>
            muya.updateParagraph('ol-order'));
        const tracked = muya.getMarkdown();

        expect(intentShape(captured)).toEqual([
            { kind: 'insert', path: [0] },
            { kind: 'remove', path: [1] },
        ]);
        expect(tracked).toBe([
            '{~~-~>1.~~} one',
            '{~~-~>2.~~} two',
            '',
        ].join('\n'));
        expect(tracked).not.toContain('{~~one');
        expect(tracked).not.toContain('{~~two');
        expectExactProjections(tracked, source, '1. one\n2. two\n');
        expectSingleUndoRedo(muya, source, tracked);
    });

    it('keeps whole-document replacement direct and one-step undoable in tracked mode', () => {
        const source = 'before\n\n- list\n';
        const replacement = '# after\n\n1. list\n';
        const { muya } = boot(source);
        const changes = vi.fn();
        const capture = vi.spyOn(muya.editor.jsonState, 'capture');
        muya.on('json-change', changes);

        expect(muya.replaceContent(replacement)).toBe(true);

        expect(capture).not.toHaveBeenCalled();
        expect(muya.getMarkdown()).toBe(replacement);
        expect(muya.getCriticMarkupItems()).toHaveLength(0);
        expect(muya.getHistory().stack.undo).toHaveLength(1);
        expect(muya.getHistory().stack.undo[0]).toMatchObject({
            rebuild: true,
        });
        expect(changes).toHaveBeenCalledTimes(1);
        muya.undo();
        expect(muya.getMarkdown()).toBe(source);
        muya.redo();
        expect(muya.getMarkdown()).toBe(replacement);
    });
});
