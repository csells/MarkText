import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';
import { editor } from '../helpers/selectors';
import { dragSelect, selectedCount } from '../helpers/tableSelection';

const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n';
const copiedRectangle = '|     |     |\n| --- | --- |';

for (const bound of [false, true]) {
    test(`${bound ? 'Core' : 'upstream'} Delete drops a rectangle of implicit empty cells without changing the table`, async ({ page }) => {
        await page.evaluate(async ({ source, bound }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            }
            else { window.muya!.setContent(source); }
        }, { source, bound });
        try {
            await dragSelect(page, { row: 1, column: 1 }, { row: 1, column: 2 });
            await expect.poll(() => selectedCount(page)).toBe(2);
            await page.keyboard.press('Backspace');
            await expect.poll(() => selectedCount(page)).toBe(0);
            expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'c', 'x', '', '']);
            if (bound) {
                await page.evaluate(() => window.coreBoundary.settle());
                expect(await readCore(page)).toMatchObject({ source: { source }, legacyCalls: [] });
                expect(await reopenCore(page)).toMatchObject({ source });
            }
        }
        finally {
            if (bound)
                await disposeCore(page);
        }
    });

    for (const operation of ['copy', 'cut'] as const) {
        test(`${bound ? 'Core guarded' : 'upstream'} ${operation} identifies two implicit empty cells independently`, async ({ page }) => {
            await page.evaluate(async ({ source, bound }) => {
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                }
                else { window.muya!.setContent(source); }
            }, { source, bound });
            try {
                await dragSelect(page, { row: 1, column: 1 }, { row: 1, column: 2 });
                await expect.poll(() => selectedCount(page)).toBe(2);
                if (bound) {
                    expect(await page.evaluate(() => window.coreBoundary.prepareClipboardCopy())).toMatchObject({ text: copiedRectangle });
                }
                const copied = await page.evaluate(({ operation, bound }) => {
                    if (bound)
                        return window.coreBoundary.guardedClipboard(operation);
                    const data = new DataTransfer();
                    window.muya!.domNode.dispatchEvent(new ClipboardEvent(operation, { clipboardData: data, bubbles: true, cancelable: true }));
                    window.muya!.flush();
                    return { text: data.getData('text/plain'), html: data.getData('text/html') };
                }, { operation, bound });
                expect(copied.text).toBe(bound ? copiedRectangle : `${copiedRectangle}\n`);
                await expect.poll(() => selectedCount(page)).toBe(operation === 'copy' ? 2 : 0);
                expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'c', 'x', '', '']);
                if (bound) {
                    expect(await readCore(page)).toMatchObject({ source: { source }, legacyCalls: [] });
                    expect(await reopenCore(page)).toMatchObject({ source });
                }
                if (operation === 'cut') {
                    await page.keyboard.type('y');
                    expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'c', 'x', 'y', '']);
                    if (bound) {
                        const saved = await reopenCore(page);
                        if (saved.type !== 'source')
                            throw new Error('Implicit-cell cut did not produce an acknowledged source');
                        // Typing writes only its own bytes and adds its missing cell minimally (ADR 0007).
                        expect(saved.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x | y |\n');
                        await coreHistory(page, 'undo');
                        expect(await reopenCore(page)).toMatchObject({ source });
                        await coreHistory(page, 'redo');
                        expect(await reopenCore(page)).toMatchObject({ source: saved.source });
                    }
                }
            }
            finally {
                if (bound)
                    await disposeCore(page);
            }
        });
    }
}

test('Core pairing in the later implicit cell governs the next key without an acknowledgement wait', async ({ page }) => {
    await bootCore(page, source);
    // Typing writes only its own bytes and adds its missing cells minimally (ADR 0007).
    const expected = '| a | b | c |\n| --- | --- | --- |\n| x | | (x) |\n';
    const laterCell = page.locator(editor.table).first().locator('tr').nth(1).locator('td').nth(2);
    try {
        await laterCell.click();
        await page.keyboard.type('(x');
        const immediate = await page.evaluate(() => {
            const selection = window.muya!.getSelection();
            const cell = selection?.focus.block.domNode?.closest('td');
            return {
                state: window.coreBoundary.read(),
                anchor: selection?.anchor.offset,
                focus: selection?.focus.offset,
                cellIndex: cell?.cellIndex,
                rowIndex: (cell?.parentElement as HTMLTableRowElement | null)?.rowIndex,
            };
        });
        expect(immediate.state).toMatchObject({ source: { source: expected }, legacyCalls: [] });
        expect(immediate).toMatchObject({ anchor: 2, focus: 2, cellIndex: 2, rowIndex: 1 });
        expect(immediate.state.actions).toHaveLength(2);
        expect(immediate.state.actions[0]).toMatchObject({
            accepted: true,
            result: { source: { source: '| a | b | c |\n| --- | --- | --- |\n| x | | () |\n' }, anchor: 1, caret: 1 },
        });
        expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'c', 'x', '', '(x)']);
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source });
        expect(await page.evaluate(() => {
            const selection = window.muya!.getSelection();
            return { offset: selection?.focus.offset, cellIndex: selection?.focus.block.domNode?.closest('td')?.cellIndex };
        })).toEqual({ offset: 0, cellIndex: 2 });
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: expected });
        expect(await page.evaluate(() => {
            const selection = window.muya!.getSelection();
            return { offset: selection?.focus.offset, cellIndex: selection?.focus.block.domNode?.closest('td')?.cellIndex };
        })).toEqual({ offset: 2, cellIndex: 2 });
    }
    finally { await disposeCore(page); }
});
