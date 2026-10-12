import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';
import { separateUndoSteps } from '../helpers/undoWindow';

test.beforeEach(async ({ page }) => separateUndoSteps(page));

for (const level of [1, 2, 3, 4, 5, 6]) {
test(`Heading ${level} menu uses the common model selection before the next key`, async ({ page }) => {
    const source = 'a{++a++}a\n';
    await bootCore(page, source, {
        cursor: [0, 3, true],
        arg: level,
        setup: (level) => {
            window.muya!.focus();
            window.muya!.updateParagraph(`heading ${level}`);
        },
    });
    try {
        const heading = `${'#'.repeat(level)} a{++a++}a\n`;
        expect.soft(await readCore(page)).toMatchObject({ source: { source: heading }, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: `${'#'.repeat(level)} X\n` }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: heading } });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source } });
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: heading });
    }
    finally {
        await disposeCore(page);
    }
});

}

test('records existing standalone cross-block Heading menu behavior', async ({ page }) => {
    const result = await page.evaluate(() => {
        const muya = window.muya!;
        muya.setContent('alpha\n\nbravo\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = first.nextContentInContext()!;
        first.setCursor(0, 0, true);
        muya.editor.selection.setSelection({ block: first, path: first.path, offset: 0 }, { block: last, path: last.path, offset: 5 });
        muya.updateParagraph('heading 2');
        const selected = muya.editor.selection.getSelection();
        return { source: muya.getMarkdown(), anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
    });
    expect(result).toEqual({ source: '## alpha\n\nbravo\n', anchor: 3, focus: 8, anchorText: '## alpha', focusText: '## alpha' });
});

test('heading conversion preserves the actual cross-block selection for the next key', async ({ page }) => {
    const source = 'a{++a++}a\n\nbravo\n';
    await bootCore(page, source, {
        cursor: [0, 0, true],
        setup: () => {
            const muya = window.muya!;
            const first = muya.editor.scrollPage!.firstContentInDescendant()!;
            const last = first.nextContentInContext()!;
            muya.editor.selection.setSelection({ block: first, path: first.path, offset: 0 }, { block: last, path: last.path, offset: 5 });
            muya.focus();
            muya.updateParagraph('heading 2');
        },
    });
    try {
        const heading = '## a{++a++}a\n\nbravo\n';
        expect(await readCore(page)).toMatchObject({ source: { source: heading }, legacyCalls: [] });
        expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('bravo');
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: '## X\n' }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: heading } });
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source });
    }
    finally {
        await disposeCore(page);
    }
});

test('tracked heading conversion retains the selected payload for immediate tracked typing', async ({ page }) => {
    const source = 'a{++a++}a\n';
    await bootCore(page, source, {
        tracked: true,
        cursor: [0, 3, true],
        setup: () => {
            window.muya!.focus();
            window.muya!.updateParagraph('heading 1');
        },
    });
    try {
        const heading = '{++# ++}a{++a++}a\n';
        expect(await readCore(page)).toMatchObject({ source: { source: heading }, legacyCalls: [] });
        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('aaa');
        await page.keyboard.type('X');
        const result = await readCore(page);
        expect(result).toMatchObject({ source: { source: '{++# ++}{~~a{++a++}a~>X~~}\n' }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: heading } });
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source });
    }
    finally {
        await disposeCore(page);
    }
});

test('empty document heading menu leaves a usable caret for actual typing', async ({ page }) => {
    await bootCore(page, '\n', {
        setup: () => {
            window.muya!.focus();
            window.muya!.updateParagraph('heading 2');
        },
    });
    try {
        expect(await readCore(page)).toMatchObject({ source: { source: '## \n' }, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: '## X\n' }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: '## \n' } });
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source: '\n' });
    }
    finally {
        await disposeCore(page);
    }
});

for (const sample of [
    { command: 'upgrade heading', source: 'a{++a++}a\n', expected: '###### a{++a++}a\n' },
    { command: 'upgrade heading', source: '### a{++a++}a\n', expected: '## a{++a++}a\n' },
    { command: 'degrade heading', source: '###### a{++a++}a\n', expected: 'a{++a++}a\n' },
    { command: 'paragraph', source: 'a{++a++}a\n---\n', expected: 'a{++a++}a\n' },
]) {
    test(`${sample.command} on ${JSON.stringify(sample.source)} uses the common heading operation`, async ({ page }) => {
        await bootCore(page, sample.source, {
            arg: sample.command,
            setup: (command) => {
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                const start = block.text.indexOf('a');
                block.setCursor(start, start + 3, true);
                window.muya!.focus();
                window.muya!.updateParagraph(command);
            },
        });
        try {
            expect.soft(await readCore(page)).toMatchObject({ source: { source: sample.expected }, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await readCore(page)).toMatchObject({ source: { source: sample.expected.replace('a{++a++}a', 'X') }, legacyCalls: [] });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: sample.expected } });
            await coreHistory(page, 'undo');
            expect(await reopenCore(page)).toMatchObject({ source: sample.source });
        }
        finally {
            await disposeCore(page);
        }
    });
}

test('reversed cross-block heading reset preserves the selected payload for the next key', async ({ page }) => {
    const source = '## a{++a++}a\n\nbravo\n';
    await bootCore(page, source, {
        cursor: [3, 3, true],
        setup: () => {
            const muya = window.muya!;
            const first = muya.editor.scrollPage!.firstContentInDescendant()!;
            const last = first.nextContentInContext()!;
            muya.editor.selection.setSelection({ block: last, path: last.path, offset: 5 }, { block: first, path: first.path, offset: 3 });
            muya.focus();
            muya.updateParagraph('reset-to-paragraph');
        },
    });
    try {
        const paragraph = 'a{++a++}a\n\nbravo\n';
        expect(await readCore(page)).toMatchObject({ source: { source: paragraph }, legacyCalls: [] });
        expect(await page.evaluate(() => {
            const selected = window.muya!.getSelection();
            return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
        })).toEqual({ anchor: 5, focus: 0, anchorText: 'bravo', focusText: 'aaa' });
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: 'X\n' }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source: paragraph });
        expect(await page.evaluate(() => {
            const selected = window.muya!.getSelection();
            return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
        })).toEqual({ anchor: 5, focus: 0, anchorText: 'bravo', focusText: 'aaa' });
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source });
        expect(await page.evaluate(() => {
            const selected = window.muya!.getSelection();
            return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
        })).toEqual({ anchor: 5, focus: 3, anchorText: 'bravo', focusText: '## aaa' });
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: paragraph });
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: 'X\n' });
    }
    finally {
        await disposeCore(page);
    }
});

for (const tail of ['', ' tail']) {
    test(`heading formats shared inline substitution arms with usable selection${tail}`, async ({ page }) => {
        const source = `{~~old~>new~~}${tail}\n`;
        await bootCore(page, source, {
            cursor: [0, 0, true],
            setup: () => {
                window.muya!.focus();
                window.muya!.updateParagraph('heading 1');
            },
        });
        try {
            const heading = `# {~~old~>new~~}${tail}\n`;
            expect(await readCore(page)).toMatchObject({ source: { source: heading }, anchor: 2, caret: 2, legacyCalls: [] });
            await page.keyboard.type('X');
            // Typing at the substitution's start stays before it.
            expect(await readCore(page)).toMatchObject({ source: { source: `# X{~~old~>new~~}${tail}\n` }, anchor: 3, caret: 3, legacyCalls: [] });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: heading }, anchor: 2, caret: 2 });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source }, anchor: 0, caret: 0 });
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: heading });
        }
        finally { await disposeCore(page); }
    });
}
