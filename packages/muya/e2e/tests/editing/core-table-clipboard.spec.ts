import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';
import { dragSelect, selectedCount } from '../helpers/tableSelection';

const plainTable = '| a | b | c |\n| --- | --- | --- |\n| a | b | d |\n| e | f | g |\n';
const annotatedTable = '| a | b | c |\n| --- | --- | --- |\n| {++a++} | b{>>note<<} | d |\n| e | f | g |\n';
const clearedTable = '|  |  | c |\n| --- | --- | --- |\n|  |  | d |\n| e | f | g |\n';

test('rectangle Delete clears the selected cells through Core and retains the native rectangle', async ({ page }) => {
    await page.evaluate(source => window.muya!.setContent(source), plainTable);
    await dragSelect(page, { row: 0, column: 0 }, { row: 1, column: 1 });
    await expect.poll(() => selectedCount(page)).toBe(4);
    await page.keyboard.press('Backspace');
    const nativeCells = await page.locator(`${editor.table} td`).allTextContents();
    expect(nativeCells.map(value => value.trim())).toEqual(['', '', 'c', '', '', 'd', 'e', 'f', 'g']);
    await expect.poll(() => selectedCount(page)).toBe(4);

    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, annotatedTable);
    try {
        await dragSelect(page, { row: 0, column: 0 }, { row: 1, column: 1 });
        await expect.poll(() => selectedCount(page)).toBe(4);
        await page.keyboard.press('Backspace');
        await page.evaluate(() => window.muya!.flush());
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: clearedTable }, legacyCalls: [] });
        expect(await page.evaluate(async () => {
            try {
                await window.coreBoundary.settle();
            }
            catch (error) { return error instanceof Error ? error.message : String(error); }
            return null;
        })).toBeNull();
        await expect.poll(() => selectedCount(page)).toBe(4);
        await page.keyboard.press('Backspace');
        await expect.poll(() => selectedCount(page)).toBe(0);
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: clearedTable }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: annotatedTable } });
        await expect.poll(() => selectedCount(page)).toBe(4);
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: clearedTable });
        await expect.poll(() => selectedCount(page)).toBe(4);
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

for (const example of [
    {
        name: 'two empty columns across every row',
        plain: '| a | a | cc |\n| --- | --- | --- |\n| a | a | d |\n| a | a | g |\n',
        source: '| a | a | c{++c++} |\n| --- | --- | --- |\n| a | a | d |\n| a | a | g |\n',
        cleared: '|  |  | c{++c++} |\n| --- | --- | --- |\n|  |  | d |\n|  |  | g |\n',
        removed: '| c{++c++} |\n| --- |\n| d |\n| g |\n',
        next: '| xc{++c++} |\n| --- |\n| d |\n| g |\n',
        row: 2,
        column: 1,
        cells: ['cc', 'd', 'g'],
    },
    {
        name: 'two empty rows including the header',
        plain: '| a | a |\n| --- | --- |\n| a | a |\n| ee | f |\n',
        source: '| a | a |\n| --- | --- |\n| a | a |\n| e{++e++} | f |\n',
        cleared: '|  |  |\n| --- | --- |\n|  |  |\n| e{++e++} | f |\n',
        removed: '| e{++e++} | f |\n| --- | --- |\n',
        next: '| xe{++e++} | f |\n| --- | --- |\n',
        row: 1,
        column: 1,
        cells: ['ee', 'f'],
    },
]) {
    for (const bound of [false, true]) {
        test(`${bound ? 'Core' : 'upstream'} second rectangle Delete removes ${example.name}`, async ({ page }) => {
            await page.evaluate(async ({ bound, source }) => {
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                }
                else { window.muya!.setContent(source); }
            }, { bound, source: bound ? example.source : example.plain });
            try {
                await dragSelect(page, { row: 0, column: 0 }, { row: example.row, column: example.column });
                await expect.poll(() => selectedCount(page)).toBe((example.row + 1) * (example.column + 1));
                await page.keyboard.press('Backspace');
                await expect.poll(() => selectedCount(page)).toBe((example.row + 1) * (example.column + 1));
                if (bound)
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.cleared });
                await page.keyboard.press('Backspace');
                expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(example.cells);
                await expect.poll(() => selectedCount(page)).toBe(0);
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(example.cells[0]);
                if (bound)
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.removed }, legacyCalls: [] });
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(`x${example.cells[0]}`);
                if (bound) {
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.removed });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.cleared });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
                    await page.evaluate(async () => {
                        await window.coreBoundary.history('redo');
                        await window.coreBoundary.history('redo');
                        await window.coreBoundary.history('redo');
                    });
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, legacyCalls: [] });
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
                }
            }
            finally {
                if (bound)
                    await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}

for (const example of [
    {
        name: 'partial repeated cells',
        plain: plainTable,
        source: annotatedTable,
        expected: clearedTable,
        next: '|  x|  | c |\n| --- | --- | --- |\n|  |  | d |\n| e | f | g |\n',
        row: 1,
        column: 1,
        tableCount: 1,
    },
    {
        name: 'the whole populated table',
        plain: '| a | a |\n| --- | --- |\n| a | a |\n',
        source: '| {++a++} | a |\n| --- | --- |\n| a | a{>>note<<} |\n',
        expected: '\n',
        next: 'x\n',
        row: 1,
        column: 1,
        tableCount: 0,
    },
]) {
    for (const bound of [false, true]) {
        test(`${bound ? 'Core' : 'upstream'} clipboard cut owns ${example.name}`, async ({ page }) => {
            await page.evaluate(async ({ source, bound }) => {
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                }
                else { window.muya!.setContent(source); }
            }, { source: bound ? example.source : example.plain, bound });
            try {
                await dragSelect(page, { row: 0, column: 0 }, { row: example.row, column: example.column });
                const copied = await page.evaluate(() => {
                    const data = new DataTransfer();
                    window.muya!.domNode.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }));
                    window.muya!.flush();
                    return data.getData('text/plain');
                });
                expect(copied).toContain('|');
                await expect(page.locator(editor.table)).toHaveCount(example.tableCount);
                await expect.poll(() => selectedCount(page)).toBe(0);
                if (bound)
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, legacyCalls: [] });
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe('');
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe('x');
                if (bound) {
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
                    await page.evaluate(async () => {
                        await window.coreBoundary.history('redo');
                        await window.coreBoundary.history('redo');
                    });
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, legacyCalls: [] });
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
                }
            }
            finally {
                if (bound)
                    await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}

test('desktop clipboard guard copies and cuts the current model rectangle', async ({ page }) => {
    const source = '| a | other |\n| --- | --- |\n| {++b++} | tail |\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, source);
    try {
        await dragSelect(page, { row: 0, column: 0 }, { row: 1, column: 0 });
        expect(await page.evaluate(() => window.coreBoundary.prepareClipboardCopy())).toEqual({
            text: '| a   |\n| --- |\n| b   |',
            html: '<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>b</td>\n</tr>\n</tbody>\n</table>\n',
        });
        const payload = await page.evaluate(() => window.coreBoundary.guardedClipboard('cut'));
        expect(payload.text).toBe('| a   |\n| --- |\n| b   |');
        expect(payload.html).not.toContain('other');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '|  | other |\n| --- | --- |\n|  | tail |\n' }, legacyCalls: [] });
        await page.keyboard.type('x');
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '|  x| other |\n| --- | --- |\n|  | tail |\n' });
        await page.evaluate(async () => {
            await window.coreBoundary.history('undo');
            await window.coreBoundary.history('undo');
        });
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
        await expect.poll(() => selectedCount(page)).toBe(2);
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

for (const bound of [false, true]) {
    test(`${bound ? 'Core tracked' : 'upstream'} native deletion cancels the selected pending text without touching its neighbours`, async ({ page }) => {
        await page.evaluate(async (bound) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, 'a{++b++}c\n', true);
            }
            else { window.muya!.setContent('abc\n'); }
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 2);
        }, bound);
        try {
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe('ac');
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe('axc');
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'a{++x++}c\n' });
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'ac\n' });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'a{++b++}c\n' });
            }
        }
        finally {
            if (bound)
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('tracked rectangle Delete preserves old text, cancels added text and keeps the next input on the current model', async ({ page }) => {
    const deleted = '| {--a--} | {--b--} | c |\n| --- | --- | --- |\n|  | {--b{>>note<<}--} | d |\n| e | f | g |\n';
    const next = '| {--a--} | {--b--} | c |\n| --- | --- | --- |\n|  | {--b{>>note<<}--} | d |\n| {++x++}e | f | g |\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source, true);
    }, annotatedTable);
    try {
        await dragSelect(page, { row: 0, column: 0 }, { row: 1, column: 1 });
        await page.keyboard.press('Backspace');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: deleted }, legacyCalls: [] });
        await expect.poll(() => selectedCount(page)).toBe(4);
        await page.locator(`${editor.table} tr`).nth(2).locator('td').first().click();
        await page.evaluate(() => window.muya!.getSelection()!.anchor.block.setCursor(0, 0));
        await page.keyboard.type('x');
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: next });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: deleted });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: annotatedTable });
        await expect.poll(() => selectedCount(page)).toBe(4);
        await page.evaluate(async () => {
            await window.coreBoundary.history('redo');
            await window.coreBoundary.history('redo');
        });
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: next }, legacyCalls: [] });
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: next });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

const wholeCutPlainTable = '| a | b |\n| --- | --- |\n| c | d |';
const wholeCutAnnotatedTable = '| a{++b++} | c{>>note<<} |\n| --- | --- |\n| d | e |';
for (const sample of [
    {
        name: 'before the deleted sole table',
        source: `${wholeCutPlainTable}\n`,
        cutSource: `{--${wholeCutPlainTable}--}\n`,
        nextSource: `{++X++}{--${wholeCutPlainTable}--}\n`,
        selectedText: 'a',
        typedText: `X${wholeCutPlainTable}`,
        following: false,
        annotated: false,
    },
    {
        name: 'in the following paragraph',
        source: `${wholeCutPlainTable}\n\nafter\n`,
        cutSource: `{--${wholeCutPlainTable}--}\n\nafter\n`,
        nextSource: `{--${wholeCutPlainTable}--}\n\n{++X++}after\n`,
        selectedText: 'after',
        typedText: 'Xafter',
        following: true,
        annotated: false,
    },
    {
        name: 'after cancelling an added table',
        source: `{++${wholeCutPlainTable}++}\n`,
        cutSource: '\n',
        nextSource: '{++X++}\n',
        selectedText: '',
        typedText: 'X',
        following: false,
        annotated: false,
    },
    {
        name: 'before a deleted table containing an addition and comment',
        source: `${wholeCutAnnotatedTable}\n`,
        cutSource: `{--${wholeCutAnnotatedTable}--}\n`,
        nextSource: `{++X++}{--${wholeCutAnnotatedTable}--}\n`,
        selectedText: 'ab',
        typedText: 'X| ab | c |\n| --- | --- |\n| d | e |',
        following: false,
        annotated: true,
    },
]) {
    test(`desktop guarded whole-table Cut in Track retains the next input ${sample.name}`, async ({ page }) => {
        const { source, cutSource, nextSource, following } = sample;
        const clipboard = sample.annotated
            ? {
                    text: '| ab  | c   |\n| --- | --- |\n| d   | e   |',
                    html: '<table>\n<thead>\n<tr>\n<th>ab</th>\n<th>c</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>d</td>\n<td>e</td>\n</tr>\n</tbody>\n</table>\n',
                }
            : {
                    text: '| a   | b   |\n| --- | --- |\n| c   | d   |',
                    html: '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>c</td>\n<td>d</td>\n</tr>\n</tbody>\n</table>\n',
                };
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, true);
        }, source);
        try {
            await dragSelect(page, { row: 0, column: 0 }, { row: 1, column: 1 });
            await expect.poll(() => selectedCount(page)).toBe(4);
            expect(await page.evaluate(() => window.coreBoundary.prepareClipboardCopy())).toEqual(clipboard);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
            expect(await page.evaluate(() => window.coreBoundary.guardedClipboard('cut'))).toMatchObject(clipboard);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: cutSource }, anchor: 0, caret: 0, legacyCalls: [] });
            await expect.poll(() => selectedCount(page)).toBe(0);
            // Markup retains deleted text; its exterior model position governs input, not an empty presentation leaf.
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.selectedText);
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: nextSource }, anchor: 1, caret: 1, legacyCalls: [] });
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.typedText);
            const point = following ? cutSource.indexOf('after') : 0;
            // The browser target can stay in the retained table; collapsed typing follows the exterior live selection.
            const range = !following && cutSource !== '\n'
                ? { kind: 'table-cell', cell: { table: { start: 0, end: cutSource.length - 1 }, row: 0, column: 0 }, anchor: 0, focus: 0 }
                : { start: point, end: point };
            expect(await page.evaluate(() => window.coreBoundary.read().actions.at(-1))).toMatchObject({
                selection: { ranges: [{ anchor: point, focus: point }], primary: 0 },
                range,
                accepted: true,
            });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: nextSource });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: cutSource });
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.selectedText);
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            await expect.poll(() => selectedCount(page)).toBe(4);
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: cutSource });
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.selectedText);
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: nextSource }, legacyCalls: [] });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: nextSource });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const sample of [
    {
        name: 'whole empty table',
        source: '|  |  |\n| --- | --- |\n|  |  |\n',
        pending: '| {++z++} |  |\n| --- | --- |\n|  |  |\n',
        anchor: { row: 0, column: 0 },
        focus: { row: 1, column: 1 },
        deleted: '{--|  |  |\n| --- | --- |\n|  |  |--}\n',
        typed: '{++X++}{--|  |  |\n| --- | --- |\n|  |  |--}\n',
        target: undefined,
        selectedText: '',
        typedText: 'X|  |  |\n| --- | --- |\n|  |  |',
    },
    {
        name: 'empty body row',
        source: '| a | b |\n| --- | --- |\n|  |  |\n| c | d |\n',
        pending: '| a | b |\n| --- | --- |\n| {++z++} |  |\n| c | d |\n',
        anchor: { row: 1, column: 0 },
        focus: { row: 1, column: 1 },
        deleted: '| a | b |\n| --- | --- |{--\n|  |  |--}\n| c | d |\n',
        typed: '| a | b |\n| --- | --- |{--\n|  |  |--}\n| {++X++}c | d |\n',
        target: { row: 2, column: 0 },
        selectedText: 'c',
        typedText: 'Xc',
    },
    {
        name: 'empty column with an omitted body cell',
        source: '| a |  | c |\n| --- | --- | --- |\n| x |\n',
        pending: '| a | {++z++} | c |\n| --- | --- | --- |\n| x |\n',
        anchor: { row: 0, column: 1 },
        focus: { row: 1, column: 1 },
        deleted: '| a |{--  |--} c |\n| --- |{-- --- |--} --- |\n| x |\n',
        typed: '| a |{--  |--} {++X++}c |\n| --- |{-- --- |--} --- |\n| x |\n',
        target: { row: 0, column: 2 },
        selectedText: 'c',
        typedText: 'Xc',
    },
]) {
    for (const pending of [false, true]) {
        test(`tracked rectangle Delete removes ${sample.name}${pending ? ' after cancelling its pending text' : ''} and preserves the next input target`, async ({ page }) => {
            const source = pending ? sample.pending : sample.source;
            const cells = (sample.focus.row - sample.anchor.row + 1) * (sample.focus.column - sample.anchor.column + 1);
            await page.evaluate(async (source) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, true);
            }, source);
            try {
                await dragSelect(page, sample.anchor, sample.focus);
                await expect.poll(() => selectedCount(page)).toBe(cells);
                if (pending) {
                    await page.keyboard.press('Backspace');
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.source }, legacyCalls: [] });
                    await expect.poll(() => selectedCount(page)).toBe(cells);
                }
                await page.keyboard.press('Backspace');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.deleted }, anchor: 0, caret: 0, legacyCalls: [] });
                await expect.poll(() => selectedCount(page)).toBe(0);
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.selectedText);
                await page.keyboard.type('X');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.typed }, anchor: 1, caret: 1, legacyCalls: [] });
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.typedText);
                const cellTarget = {
                    kind: 'table-cell',
                    cell: { table: { start: 0, end: sample.deleted.length - 1 }, ...(sample.target ?? { row: 0, column: 1 }) },
                    anchor: 0,
                    focus: 0,
                };
                // The empty exterior leaf now retains its native caret surface,
                // so Chromium targets that source position instead of the next table cell.
                expect(await page.evaluate(() => window.coreBoundary.read().actions.at(-1))).toMatchObject({
                    selection: sample.target === undefined ? { ranges: [{ anchor: 0, focus: 0 }], primary: 0 } : cellTarget,
                    range: sample.target === undefined ? { start: 0, end: 0 } : cellTarget,
                    accepted: true,
                });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.typed });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.deleted });
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.selectedText);
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.source });
                await expect.poll(() => selectedCount(page)).toBe(cells);
                if (pending) {
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                    await expect.poll(() => selectedCount(page)).toBe(cells);
                    await page.evaluate(() => window.coreBoundary.history('redo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.source });
                }
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.deleted });
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe(sample.selectedText);
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.typed }, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.typed });
            }
            finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}

for (const { bound, lookup } of [
    { bound: false, lookup: false },
    { bound: true, lookup: false },
    { bound: false, lookup: true },
    { bound: true, lookup: true },
]) {
    test(`${bound ? 'Core' : 'upstream'} paste replaces a frozen single-cell rectangle${lookup ? ' after desktop clipboard-file lookup' : ''} and keeps the next key in that cell`, async ({ page }) => {
        const source = '| a | b |\n| --- | --- |\n| c | d |\n';
        await page.evaluate(async ({ source, bound }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            }
            else { window.muya!.setContent(source); }
        }, { source, bound });
        try {
            const row = page.locator(editor.table).first().locator('tr').nth(1);
            const anchor = await row.locator('td').nth(0).boundingBox();
            const neighbour = await row.locator('td').nth(1).boundingBox();
            if (!anchor || !neighbour)
                throw new Error('Missing clipboard rectangle cells');
            const x = anchor.x + anchor.width / 2;
            const y = anchor.y + anchor.height / 2;
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(neighbour.x + neighbour.width / 2, neighbour.y + neighbour.height / 2, { steps: 4 });
            await page.mouse.move(x, y, { steps: 4 });
            await page.mouse.up();
            await expect.poll(() => selectedCount(page)).toBe(1);
            const lookupCalls = await page.evaluate(async (lookup) => {
                let calls = 0;
                window.muya!.options.clipboardFilePath = lookup
                    ? async () => {
                        calls++;
                        return '';
                    }
                    : undefined;
                const data = new DataTransfer();
                data.setData('text/plain', 'y');
                await window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
                window.muya!.flush();
                return calls;
            }, lookup);
            expect(lookupCalls).toBe(lookup ? 1 : 0);
            expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'y', 'd']);
            await expect.poll(() => selectedCount(page)).toBe(0);
            expect(await page.evaluate(() => {
                const selection = window.muya!.getSelection();
                return { text: selection?.anchor.block.text, anchor: selection?.anchor.offset, focus: selection?.focus.offset };
            })).toEqual({ text: 'y', anchor: 1, focus: 1 });
            if (bound)
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '| a | b |\n| --- | --- |\n| y | d |\n' }, legacyCalls: [] });
            else
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe('| a   | b   |\n| --- | --- |\n| y   | d   |\n');
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe('yX');
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '| a | b |\n| --- | --- |\n| yX | d |\n' });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '| a | b |\n| --- | --- |\n| y | d |\n' });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await expect.poll(() => selectedCount(page)).toBe(1);
                await page.evaluate(async () => {
                    await window.coreBoundary.history('redo');
                    await window.coreBoundary.history('redo');
                });
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '| a | b |\n| --- | --- |\n| yX | d |\n' }, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '| a | b |\n| --- | --- |\n| yX | d |\n' });
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe('| a   | b   |\n| --- | --- |\n| yX  | d   |\n');
            }
        }
        finally {
            if (bound)
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('Core delayed desktop clipboard-file lookup retains its frozen cell and the intervening caret', async ({ page }) => {
    const source = '| a | b |\n| --- | --- |\n| c | d |\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, source);
    try {
        const row = page.locator(editor.table).first().locator('tr').nth(1);
        const anchor = await row.locator('td').nth(0).boundingBox();
        const neighbour = await row.locator('td').nth(1).boundingBox();
        if (!anchor || !neighbour)
            throw new Error('Missing clipboard rectangle cells');
        const x = anchor.x + anchor.width / 2;
        const y = anchor.y + anchor.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(neighbour.x + neighbour.width / 2, neighbour.y + neighbour.height / 2, { steps: 4 });
        await page.mouse.move(x, y, { steps: 4 });
        await page.mouse.up();
        await expect.poll(() => selectedCount(page)).toBe(1);
        await page.evaluate(() => {
            window.muya!.options.clipboardFilePath = () => new Promise<string>((resolve) => {
                window.finishClipboardImage = resolve;
            });
            const data = new DataTransfer();
            data.setData('text/plain', 'y');
            window.pendingClipboardImage = window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        });
        await page.waitForFunction(() => typeof window.finishClipboardImage === 'function');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
        await row.locator('td').nth(1).click();
        await page.keyboard.press('End');
        await page.keyboard.type('X');
        const interim = '| a | b |\n| --- | --- |\n| c | dX |\n';
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: interim }, legacyCalls: [] });
        await page.evaluate(async () => {
            window.finishClipboardImage('');
            await window.pendingClipboardImage;
            window.muya!.flush();
            await window.coreBoundary.settle();
        });
        const completed = '| a | b |\n| --- | --- |\n| y | dX |\n';
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: completed }, legacyCalls: [] });
        expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'y', 'dX']);
        expect(await page.evaluate(() => {
            const selection = window.muya!.getSelection();
            return { text: selection?.anchor.block.text, anchor: selection?.anchor.offset, focus: selection?.focus.offset };
        })).toEqual({ text: 'dX', anchor: 2, focus: 2 });
        await page.keyboard.type('Z');
        const subsequent = '| a | b |\n| --- | --- |\n| y | dXZ |\n';
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: subsequent });
        for (const expected of [completed, interim, source]) {
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        for (const expected of [interim, completed, subsequent]) {
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.text)).toBe('dXZ');
        expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
