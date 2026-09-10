import { writeFile } from 'node:fs/promises';
import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n';
const pastedSource = '| a | b | c |\n| --- | --- | --- |\n| x |     |     y|\n';
const subsequentSource = '| a | b | c |\n| --- | --- | --- |\n| x |     |     yX|\n';

for (const bound of [false, true]) {
    test(`${bound ? 'Core' : 'upstream'} paste into the later implicit cell preserves its target through subsequent typing`, async ({ page }, testInfo) => {
        await page.evaluate(async ({ source, bound }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            }
            else { window.muya!.setContent(source); }
        }, { source, bound });
        try {
            await page.locator(editor.table).first().locator('tr').nth(1).locator('td').nth(2).click();
            const observation = await page.evaluate(async ({ bound, source }) => {
                const muya = window.muya!;
                const data = new DataTransfer();
                data.setData('text/plain', 'y');
                let error: string | undefined;
                try {
                    await muya.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
                    muya.flush();
                    if (bound)
                        await window.coreBoundary.settle();
                }
                catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
                const selection = muya.getSelection();
                return {
                    attempted: { source, row: 1, column: 2, text: 'y' },
                    error,
                    source: bound ? undefined : muya.getMarkdown(),
                    state: bound ? window.coreBoundary.read() : undefined,
                    recovery: bound ? window.coreBoundary.recovery() : undefined,
                    cells: [...muya.domNode.querySelectorAll('td.mu-table-cell')].map(cell => cell.textContent?.trim()),
                    focus: selection?.focus.offset,
                    column: selection?.focus.block.domNode?.closest('td')?.cellIndex,
                };
            }, { bound, source });
            const observationPath = testInfo.outputPath('implicit-cell-paste-observation.json');
            await writeFile(observationPath, JSON.stringify(observation, null, 2), { flag: 'wx' });
            await testInfo.attach('implicit-cell-paste-observation.json', { path: observationPath, contentType: 'application/json' });
            expect(observation).toMatchObject({ error: undefined, cells: ['a', 'b', 'c', 'x', '', 'y'], focus: 1, column: 2 });
            if (bound) {
                expect(observation.state).toMatchObject({ source: { source: pastedSource }, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: pastedSource });
            }
            else {
                expect(observation.source).toBe('| a   | b   | c   |\n| --- | --- | --- |\n| x   |     | y   |\n');
            }
            await page.keyboard.type('X');
            expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'c', 'x', '', 'yX']);
            expect(await page.evaluate(() => {
                const selection = window.muya!.getSelection();
                return { focus: selection?.focus.offset, column: selection?.focus.block.domNode?.closest('td')?.cellIndex };
            })).toEqual({ focus: 2, column: 2 });
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: subsequentSource });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: pastedSource });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                expect(await page.evaluate(() => window.muya!.getSelection()?.focus.block.domNode?.closest('td')?.cellIndex)).toBe(2);
                await page.evaluate(async () => {
                    await window.coreBoundary.history('redo');
                    await window.coreBoundary.history('redo');
                });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: subsequentSource });
            }
            else {
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe('| a   | b   | c   |\n| --- | --- | --- |\n| x   |     | yX  |\n');
            }
        }
        finally {
            if (bound)
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('Core delayed plain paste retains the later implicit target and the intervening cell caret', async ({ page }) => {
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, source);
    try {
        await page.locator(editor.table).first().locator('tr').nth(1).locator('td').nth(2).click();
        await page.evaluate(() => {
            window.muya!.options.clipboardText = () => new Promise<string>((resolve) => {
                window.finishClipboardImage = resolve;
            });
            window.pendingClipboardImage = window.muya!.editor.clipboard.pasteAsPlainText();
        });
        await page.waitForFunction(() => typeof window.finishClipboardImage === 'function');
        await page.locator(editor.table).first().locator('tr').nth(1).locator('td').nth(0).click();
        await page.keyboard.press('End');
        await page.keyboard.type('X');
        const beforeCompletion = '| a | b | c |\n| --- | --- | --- |\n| xX |\n';
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: beforeCompletion }, legacyCalls: [] });
        await page.evaluate(async () => {
            window.finishClipboardImage('y');
            await window.pendingClipboardImage;
            window.muya!.flush();
            await window.coreBoundary.settle();
        });
        const completed = '| a | b | c |\n| --- | --- | --- |\n| xX |     |     y|\n';
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: completed });
        expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'c', 'xX', '', 'y']);
        expect(await page.evaluate(() => {
            const selection = window.muya!.getSelection();
            return { anchor: selection?.anchor.offset, focus: selection?.focus.offset, column: selection?.focus.block.domNode?.closest('td')?.cellIndex };
        })).toEqual({ anchor: 2, focus: 2, column: 0 });
        await page.keyboard.type('Z');
        const subsequent = '| a | b | c |\n| --- | --- | --- |\n| xXZ |     |     y|\n';
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: subsequent });
        for (const expected of [completed, beforeCompletion, source]) {
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        for (const expected of [beforeCompletion, completed, subsequent]) {
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        expect(await page.evaluate(() => window.muya!.getSelection()?.focus.block.domNode?.closest('td')?.cellIndex)).toBe(0);
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

// Chromium CDP exercises composition ordering, not a native macOS IME panel.
test('Core delayed paste waits for Chromium composition and captures its committed cell caret', async ({ page }) => {
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, source);
    const cdp = await page.context().newCDPSession(page);
    try {
        await page.locator(editor.table).first().locator('tr').nth(1).locator('td').nth(2).click();
        await page.evaluate(() => {
            window.muya!.options.clipboardText = () => new Promise<string>((resolve) => {
                window.finishClipboardImage = resolve;
            });
            window.implicitPasteFinished = false;
            window.pendingClipboardImage = window.muya!.editor.clipboard.pasteAsPlainText().then(() => {
                window.implicitPasteFinished = true;
            });
            window.pendingClipboardImage.catch(() => {});
        });
        await page.waitForFunction(() => typeof window.finishClipboardImage === 'function');
        await page.locator(editor.table).first().locator('tr').nth(1).locator('td').nth(0).click();
        await page.keyboard.press('End');
        await cdp.send('Input.imeSetComposition', { text: '日', selectionStart: 1, selectionEnd: 1 });
        await page.evaluate(async () => {
            window.finishClipboardImage('y');
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(await page.evaluate(() => window.implicitPasteFinished)).toBe(false);
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
        expect((await page.locator(`${editor.table} td`).allTextContents()).map(text => text.trim())).toEqual(['a', 'b', 'c', 'x日', '', '']);
        await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
        await cdp.send('Input.insertText', { text: '日本' });
        await page.evaluate(async () => {
            await window.pendingClipboardImage;
            window.muya!.flush();
            await window.coreBoundary.settle();
        });
        const composed = '| a | b | c |\n| --- | --- | --- |\n| x日本 |\n';
        const completed = '| a | b | c |\n| --- | --- | --- |\n| x日本 |     |     y|\n';
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: completed });
        expect(await page.evaluate(() => {
            const selection = window.muya!.getSelection();
            return { anchor: selection?.anchor.offset, focus: selection?.focus.offset, column: selection?.focus.block.domNode?.closest('td')?.cellIndex };
        })).toEqual({ anchor: 3, focus: 3, column: 0 });
        const committed = await page.evaluate(() => window.coreBoundary.read());
        expect(committed.compositions).toEqual([{
            selection: { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 }, anchor: 1, focus: 1 },
            range: { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 }, anchor: 1, focus: 1 },
        }]);
        expect(committed.browserEvents.some(event => event.type === 'input' && event.trusted && event.composing)).toBe(true);
        await page.keyboard.type('Z');
        const subsequent = '| a | b | c |\n| --- | --- | --- |\n| x日本Z |     |     y|\n';
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: subsequent });
        for (const expected of [completed, composed, source]) {
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        for (const expected of [composed, completed, subsequent]) {
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
    }
    finally {
        await cdp.detach();
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

declare global {
    // eslint-disable-next-line ts/naming-convention -- Browser global augmentation uses its platform name.
    interface Window {
        implicitPasteFinished: boolean;
    }
}
