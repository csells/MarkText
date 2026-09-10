// @vitest-environment happy-dom

import type { DocumentInput } from '../../../../editor/documentEditingTypes';
import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

// DATA-LOSS GUARD — backspace-at-offset-0 block surgery.
//
// Pressing Backspace at the very start of a paragraph either MERGES it onto the
// previous block or UNWRAPS it out of its container (block-quote / list). The
// migration audit flagged these cross-block paths as untested even though a
// miscount here drops or duplicates user content. `ParagraphContent`'s four
// branches are driven directly here (the handler reads the caret offset and the
// active block, the way a real Backspace keystroke routes through it), with the
// resulting document state asserted after the json1 op flushes on the next
// frame.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

// Find the leaf `.content` block whose rendered text matches `text`, the way a
// click resolves the active content block.
function contentByText(muya: Muya, text: string): Content {
    let target: Content | null = null;
    const visit = (block: {
        text?: string;
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName?.endsWith('.content') && block.text === text)
            target = block as unknown as Content;
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    if (!target)
        throw new Error(`content block with text "${text}" not found`);
    return target;
}

// Land the caret at offset 0 of the given content block (active block + cursor),
// then route a Backspace through its handler the way the keydown listener does.
function backspaceAtStart(muya: Muya, content: Content): void {
    muya.editor.activeContentBlock = content;
    content.setCursor(0, 0, true);
    const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        key: 'Backspace',
    } as unknown as KeyboardEvent;
    content.backspaceHandler(event);
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

// `getState()` returns a discriminated `TState` union; only some variants carry
// `text`. The blocks asserted here are paragraphs, so narrow to read it.
function blockText(state: ReturnType<Muya['getState']>, index: number): string {
    return (state[index] as { text: string }).text;
}

describe('backspace at start-of-paragraph — merge with previous block', () => {
    it.each(['a', 'a{++literal++}'])('preserves standalone code content %j and the join caret', (body) => {
        const muya = bootMuya(`\`\`\`\n${body}\n\`\`\`\nb\n`);
        try {
            backspaceAtStart(muya, contentByText(muya, 'b'));
            muya.flush();
            expect(muya.getState()).toMatchObject([{ name: 'code-block', text: `${body}b` }]);
            expect(muya.getState()).toHaveLength(1);
            expect(muya.getSelection()).toMatchObject({ anchor: { offset: body.length }, focus: { offset: body.length } });
        }
        finally { muya.destroy(); }
    });

    it('preserves standalone math joining through the shared code content widget', () => {
        const muya = bootMuya('$$\na\n$$\nb\n');
        try {
            const literal = contentByText(muya, 'a');
            expect(literal.blockName).toBe('codeblock.content');
            expect(literal.getAnchor()?.blockName).toBe('math-block');
            backspaceAtStart(muya, contentByText(muya, 'b'));
            muya.flush();
            expect(muya.getState()).toMatchObject([{ name: 'math-block', text: 'ab' }]);
            expect(muya.getState()).toHaveLength(1);
            expect(muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } });
        }
        finally { muya.destroy(); }
    });

    it('keeps a rejected code-boundary join under the bound document owner', () => {
        const muya = bootMuya('```\na\n```\nb\n');
        const paragraph = contentByText(muya, 'b');
        const before = structuredClone(muya.getState());
        const changes: unknown[] = [];
        muya.eventCenter.on('json-change', (change: unknown) => {
            if (change && typeof change === 'object' && (change as { source?: unknown }).source === 'user')
                changes.push(change);
        });
        const unexpected = (): never => {
            throw new Error('Unexpected bound operation');
        };
        const input = vi.fn((_operation: DocumentInput, present: () => void) => {
            present();
            return false;
        });
        muya.editor.bindDocumentEditing({
            activeFormats: () => [],
            clipboard: unexpected,
            prepareImage: unexpected,
            prepareClipboard: unexpected,
            compositionStart: unexpected,
            compositionUpdate: unexpected,
            compositionEnd: unexpected,
            format: unexpected,
            input,
        });
        try {
            backspaceAtStart(muya, paragraph);
            muya.flush();
            expect(input).toHaveBeenCalledOnce();
            expect(input.mock.calls[0][0]).toMatchObject({ kind: 'command', command: 'joinParagraphBackward' });
            expect(muya.getState()).toEqual(before);
            expect(muya.getSelection()).toMatchObject({ anchor: { block: paragraph, offset: 0 }, focus: { offset: 0 } });
            expect(changes).toEqual([]);
        }
        finally { muya.destroy(); }
    });

    it('merges `beta` onto the end of `alpha` into a single paragraph', async () => {
        const muya = bootMuya('alpha\n\nbeta\n');
        const beta = contentByText(muya, 'beta');

        backspaceAtStart(muya, beta);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(1);
        expect(state[0].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('alphabeta');
    });

    it('lands the caret at the join point (end of the former first paragraph)', async () => {
        const muya = bootMuya('alpha\n\nbeta\n');
        const beta = contentByText(muya, 'beta');

        backspaceAtStart(muya, beta);

        // The merge flushes on the next animation frame; await it before reading
        // the merged tree, otherwise contentByText/getCursor observe the
        // pre-merge state.
        await flush();
        // After the merge the active block is `alpha`'s content; the caret sits
        // at offset 5 (the original `alpha` length), where the two joined.
        const merged = contentByText(muya, 'alphabeta');
        const cursor = merged.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(5);
    });

    it('is a no-op for the first paragraph in the document (no previous block)', async () => {
        const muya = bootMuya('only\n');
        const only = contentByText(muya, 'only');

        backspaceAtStart(muya, only);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(1);
        expect(blockText(state, 0)).toBe('only');
    });
});

describe('backspace at start-of-paragraph — unwrap block-quote / list', () => {
    it('unwraps an only-child quote paragraph out of the block-quote', async () => {
        const muya = bootMuya('> quoted\n');
        const quoted = contentByText(muya, 'quoted');

        backspaceAtStart(muya, quoted);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(1);
        expect(state[0].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('quoted');
    });

    it('unwraps an only/first list item out of the list to a paragraph', async () => {
        const muya = bootMuya('- item one\n');
        const item = contentByText(muya, 'item one');

        backspaceAtStart(muya, item);

        await flush();
        const state = muya.getState();
        expect(state.length).toBe(1);
        expect(state[0].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('item one');
    });

    it('keeps the remaining items when the FIRST of several list items is unwrapped', async () => {
        const muya = bootMuya('- one\n- two\n- three\n');
        const first = contentByText(muya, 'one');

        backspaceAtStart(muya, first);

        await flush();
        const md = muya.getMarkdown();
        // `one` lifts out to a leading paragraph; `two` and `three` stay in the
        // list — nothing is dropped.
        expect(md).toContain('one');
        expect(md).toContain('two');
        expect(md).toContain('three');
        const state = muya.getState();
        expect(state[0].name).toBe('paragraph');
        expect(blockText(state, 0)).toBe('one');
        expect(state[1].name).toBe('bullet-list');
    });

    it('merges a MIDDLE list item into the previous item, preserving all text', async () => {
        const muya = bootMuya('- one\n- two\n- three\n');
        const two = contentByText(muya, 'two');

        backspaceAtStart(muya, two);

        await flush();
        const md = muya.getMarkdown();
        // The whole document stays a single bullet list; `two` is absorbed into
        // the previous item rather than dropped.
        expect(md).toContain('one');
        expect(md).toContain('two');
        expect(md).toContain('three');
        const state = muya.getState();
        expect(state.length).toBe(1);
        expect(state[0].name).toBe('bullet-list');
    });
});

it.each([
    { name: 'first bullet item', source: '- one\n- target\n- three\n', target: 'one', expected: 'one\n\n- target\n- three\n' },
    { name: 'middle bullet item', source: '- one\n- target\n- three\n', target: 'target', expected: '- one\n\n  target\n- three\n' },
    { name: 'first ordered item', source: '8) one\n9) target\n10) three\n', target: 'one', expected: 'one\n\n8) target\n9) three\n' },
    { name: 'middle ordered item', source: '8) one\n9) target\n10) three\n', target: 'target', expected: '8) one\n\n   target\n9) three\n' },
    { name: 'first task item', source: '- [x] one\n- [ ] target\n- [x] three\n', target: 'one', expected: 'one\n\n- [ ] target\n- [x] three\n' },
    { name: 'middle task item', source: '- [x] one\n- [ ] target\n- [x] three\n', target: 'target', expected: '- [x] one\n\n  target\n- [x] three\n' },
    { name: 'nested first item', source: '- outer\n  - target\n  - same\n- final\n', target: 'target', expected: '- outer\n\n  target\n  - same\n- final\n' },
    { name: 'multiline middle item', source: '- first\n- target\n  continuation\n\n  second\n- final\n', target: 'target\ncontinuation', expected: '- first\n\n  target\n  continuation\n\n  second\n\n- final\n' },
])('preserves native $name source and moved paragraph caret', ({ source, target, expected }) => {
    const muya = bootMuya(source);
    try {
        backspaceAtStart(muya, contentByText(muya, target));
        muya.flush();
        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.getSelection()).toMatchObject({ anchor: { block: { text: target }, offset: 0 }, focus: { offset: 0 } });
    }
    finally { muya.destroy(); }
});

it.each(['\n', '\r\n', '\r'])('native task leading empty line with %j', (eol) => {
    const muya = bootMuya(`- [ ] ${eol}  same${eol}`);
    try {
        expect(muya.editor.scrollPage!.firstContentInDescendant()!.text).toBe(eol === '\r' ? '\r  same' : 'same');
    }
    finally { muya.destroy(); }
});
