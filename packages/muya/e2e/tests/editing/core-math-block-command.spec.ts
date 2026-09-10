import { expect, test } from '../fixtures/muya';
import { floats, quickInsertItem } from '../helpers/selectors';

for (const trigger of ['/math', '/m{++a++}th', '/m{>>inside<<}ath']) {
    for (const tracked of [false, true]) {
        test(`Quick Insert Math owns its trigger and next key (${trigger}, Track=${tracked})`, async ({ page }) => {
            const tail = '\n\noutside{>>keep<<}\n';
            const source = trigger + tail;
            const converted = (tracked ? `{~~${trigger}~>$$\n\n$$~~}` : '$$\n\n$$') + tail;
            const typed = (tracked ? `{~~${trigger}~>$$\nx\n$$~~}` : '$$\nx\n$$') + tail;
            await page.evaluate(async ({ source, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(block.text.length, block.text.length, true);
                window.muya!.eventCenter.emit('content-change', { block });
            }, { source, tracked });
            try {
                await expect(page.locator(floats.quickInsert)).toBeVisible();
                await page.locator(quickInsertItem('math-block')).click();
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0, legacyCalls: [] });
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: converted } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}

for (const text of ['seed', 'se{++e++}d{>>keep<<}']) {
    for (const tracked of [false, true]) {
        test(`Format Math undo restores its actual middle caret (${text}, Track=${tracked})`, async ({ page }) => {
            const source = text + '\n\nother\n';
            const converted = text + (tracked ? '{++\n\n$$\n\n$$++}' : '\n\n$$\n\n$$') + '\n\nother\n';
            await page.evaluate(async ({ source, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(2, 2, true);
                window.muya!.editor.activeContentBlock = block;
                window.muya!.updateParagraph('mathblock');
            }, { source, tracked });
            try {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 2, caret: 2 });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0 });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
