import { expect, test } from '../fixtures/muya';

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
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
            await page.keyboard.type('X');
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: source.replace('sa{++', 'Xsa{++') }, anchor: 1, caret: 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: source.replace('sa{++', 'Xsa{++') });
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
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const example of [
    { name: 'empty table Backspace', source: '| | |\n| --- | --- |\n| | |\n', cell: 0, key: 'Backspace', expected: '\n', next: 'X\n' },
    { name: 'tracked empty table Backspace', source: '| | |\n| --- | --- |\n| | |\n', cell: 0, key: 'Backspace', expected: '{--| | |\n| --- | --- |\n| | |--}\n', next: '{--| | |\n| --- | --- |\n| | |--}{++X++}\n', tracked: true },
    { name: 'last-row ArrowDown', source: '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n', cell: 2, key: 'ArrowDown', expected: '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n\n', next: '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n\nX' },
]) {
    test(`Core ${example.name} uses the model before the next key`, async ({ page }, testInfo) => {
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source, 'tracked' in example && example.tracked === true);
            let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            for (let index = 0; index < example.cell; index++) cell = cell.nextContentInContext()!;
            cell.setCursor(0, 0, true);
        }, example);
        try {
            await page.keyboard.press(example.key);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('X');
            await testInfo.attach('input-observation', { body: JSON.stringify(await page.evaluate(() => ({ ...window.coreBoundary.read(), recovery: window.coreBoundary.recovery(), state: window.muya!.getState() }))), contentType: 'application/json' });
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: 1, caret: 1, legacyCalls: [] });
            if ('tracked' in example) {
                await page.keyboard.type('Y');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '{--| | |\n| --- | --- |\n| | |--}{++XY++}\n' }, anchor: 2, caret: 2, legacyCalls: [] });
            }
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

test('Core Backspace between tables preserves both and selects the previous implicit cell', async ({ page }) => {
    const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n\n| |\n| --- |\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
        for (let index = 0; index < 6; index++) cell = cell.nextContentInContext()!;
        cell.setCursor(0, 0, true);
    }, source);
    try {
        await page.keyboard.press('Backspace');
        await expect(page.locator('table')).toHaveCount(2);
        expect(await page.evaluate(() => {
            const cell = window.muya!.getSelection()?.anchor.block.domNode?.closest('td');
            return { row: cell?.closest('tr')?.rowIndex, column: cell?.cellIndex, table: cell?.closest('table') === document.querySelector('table') };
        })).toEqual({ row: 1, column: 2, table: true });
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
        await page.keyboard.type('X');
        const next = '| a | b | c |\n| --- | --- | --- |\n| x |     |     X|\n\n| |\n| --- |\n';
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: next }, anchor: 1, caret: 1, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: next });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

for (const example of [
    { name: 'hidden comment', source: '| {>>keep<<} | |\n| --- | --- |\n| | |\n', cell: 0, target: 0, next: '| {>>keep<<} X| |\n| --- | --- |\n| | |\n' },
    { name: 'previous implicit cell', source: '| a | b | c |\n| --- | --- | --- |\n| x |\n', cell: 5, target: 4, next: '| a | b | c |\n| --- | --- | --- |\n| x |     X|\n' },
]) {
    test(`Core boundary Backspace preserves the ${example.name}`, async ({ page }) => {
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source);
            let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            for (let index = 0; index < example.cell; index++) cell = cell.nextContentInContext()!;
            cell.setCursor(0, 0, true);
        }, example);
        try {
            await page.keyboard.press('Backspace');
            expect(await page.evaluate((target) => {
                let cell = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                for (let index = 0; index < target; index++) cell = cell.nextContentInContext()!;
                return window.muya!.getSelection()?.anchor.block === cell;
            }, example.target)).toBe(true);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source }, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: 1, caret: 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
