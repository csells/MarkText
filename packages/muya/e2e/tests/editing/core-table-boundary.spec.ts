import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';
import { holdUndoSteps, separateUndoSteps } from '../helpers/undoWindow';

test.beforeEach(async ({ page }) => separateUndoSteps(page));

for (const bound of [false, true]) {
    test(`${bound ? 'Core annotated' : 'upstream'} first-cell Backspace preserves a nonempty table`, async ({ page }) => {
        const source = bound
            ? '| sa{++me++}{>>note<<} | same |\n| ---- | ---- |\n| same | same |\n'
            : '| same | same |\n| ---- | ---- |\n| same | same |\n';
        await page.evaluate(async ({ source, bound }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            }
            else { window.muya!.setContent(source); }
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 0, true);
        }, { source, bound });
        try {
            await page.keyboard.press('Backspace');
            await expect(page.locator('table')).toHaveCount(1);
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.offset)).toBe(0);
            if (bound)
                expect(await readCore(page)).toMatchObject({ source: { source }, legacyCalls: [] });
            await page.keyboard.type('X');
            if (bound) {
                // Typing writes only its own bytes (ADR 0007).
                const typed = '| Xsa{++me++}{>>note<<} | same |\n| ---- | ---- |\n| same | same |\n';
                expect(await readCore(page)).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
                await coreHistory(page, 'undo');
                expect(await reopenCore(page)).toMatchObject({ source });
                await coreHistory(page, 'redo');
                expect(await reopenCore(page)).toMatchObject({ source: typed });
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toContain('| Xsame | same |');
            }
        }
        finally {
            if (bound)
                await disposeCore(page);
        }
    });
}

for (const example of [
    { name: 'empty table Backspace', source: '| | |\n| --- | --- |\n| | |\n', cell: 0, key: 'Backspace', expected: '\n', next: 'X\n' },
    { name: 'tracked empty table Backspace', source: '| | |\n| --- | --- |\n| | |\n', cell: 0, key: 'Backspace', expected: '{--| | |\n| --- | --- |\n| | |--}\n', next: '{--| | |\n| --- | --- |\n| | |--}{++X++}\n', tracked: true },
    { name: 'last-row ArrowDown', source: '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n', cell: 2, key: 'ArrowDown', expected: '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n\n\n', next: '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n\nX\n' },
]) {
    test(`Core ${example.name} uses the model before the next key`, async ({ page }, testInfo) => {
        await bootCore(page, example.source, {
            tracked: 'tracked' in example && example.tracked === true,
            arg: example.cell,
            setup: (leaf) => {
                let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                for (let index = 0; index < leaf; index++) cell = cell.nextContentInContext()!;
                cell.setCursor(0, 0, true);
            },
        });
        try {
            await page.keyboard.press(example.key);
            expect(await readCore(page)).toMatchObject({ source: { source: example.expected }, anchor: 0, caret: 0, legacyCalls: [] });
            await holdUndoSteps(page);
            await page.keyboard.type('X');
            await testInfo.attach('input-observation', { body: JSON.stringify(await page.evaluate(() => ({ ...window.coreBoundary.read(), recovery: window.coreBoundary.recovery(), state: window.muya!.getState() }))), contentType: 'application/json' });
            expect(await readCore(page)).toMatchObject({ source: { source: example.next }, anchor: 1, caret: 1, legacyCalls: [] });
            if ('tracked' in example) {
                await page.keyboard.type('Y');
                expect(await readCore(page)).toMatchObject({ source: { source: '{--| | |\n| --- | --- |\n| | |--}{++XY++}\n' }, anchor: 2, caret: 2, legacyCalls: [] });
            }
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: example.expected } });
            await coreHistory(page, 'undo');
            expect(await reopenCore(page)).toMatchObject({ source: example.source });
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: example.expected });
        }
        finally { await disposeCore(page); }
    });
}

test('Core Backspace between tables preserves both and selects the previous implicit cell', async ({ page }) => {
    const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n\n| |\n| --- |\n';
    await bootCore(page, source, {
        setup: () => {
            let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            for (let index = 0; index < 6; index++) cell = cell.nextContentInContext()!;
            cell.setCursor(0, 0, true);
        },
    });
    try {
        await page.keyboard.press('Backspace');
        await expect(page.locator('table')).toHaveCount(2);
        expect(await page.evaluate(() => {
            const cell = window.muya!.getSelection()?.anchor.block.domNode?.closest('td');
            return { row: cell?.closest('tr')?.rowIndex, column: cell?.cellIndex, table: cell?.closest('table') === document.querySelector('table') };
        })).toEqual({ row: 1, column: 2, table: true });
        expect(await readCore(page)).toMatchObject({ source: { source }, legacyCalls: [] });
        await page.keyboard.type('X');
        // Typing writes only its own bytes and adds its missing cells minimally (ADR 0007).
        const next = '| a | b | c |\n| --- | --- | --- |\n| x | | X |\n\n| |\n| --- |\n';
        expect(await readCore(page)).toMatchObject({ source: { source: next }, anchor: 1, caret: 1, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source });
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: next });
    }
    finally { await disposeCore(page); }
});

for (const example of [
    // Typing after the Backspace writes only its own bytes (ADR 0007).
    { name: 'hidden comment', source: '| {>>keep<<} | |\n| --- | --- |\n| | |\n', cell: 0, target: 0, next: '| X{>>keep<<} | |\n| --- | --- |\n| | |\n' },
    { name: 'previous implicit cell', source: '| a | b | c |\n| --- | --- | --- |\n| x |\n', cell: 5, target: 4, next: '| a | b | c |\n| --- | --- | --- |\n| x | X |\n' },
]) {
    test(`Core boundary Backspace preserves the ${example.name}`, async ({ page }) => {
        await bootCore(page, example.source, {
            arg: example.cell,
            setup: (leaf) => {
                let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                for (let index = 0; index < leaf; index++) cell = cell.nextContentInContext()!;
                cell.setCursor(0, 0, true);
            },
        });
        try {
            await page.keyboard.press('Backspace');
            expect(await page.evaluate((target) => {
                let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                for (let index = 0; index < target; index++) cell = cell.nextContentInContext()!;
                return window.muya!.getSelection()?.anchor.block === cell;
            }, example.target)).toBe(true);
            expect(await readCore(page)).toMatchObject({ source: { source: example.source }, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await readCore(page)).toMatchObject({ source: { source: example.next }, anchor: 1, caret: 1, legacyCalls: [] });
            await coreHistory(page, 'undo');
            expect(await reopenCore(page)).toMatchObject({ source: example.source });
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: example.next });
        }
        finally { await disposeCore(page); }
    });
}
