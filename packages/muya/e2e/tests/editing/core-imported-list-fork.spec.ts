import { expect, test } from '../fixtures/muya';

for (const tracked of [false, true]) {
    test(`Core imported list arms retain their containers through native typing (tracked=${tracked})`, async ({ page }) => {
        const source = '8) same\n{~~9) {++sa++}me{>>keep<<}\n10) ~>\n   {++sa++}me{>>keep<<}\n9) ~~}final\n';
        const typed = '8) same\n{~~9) {++sa++}me{>>keep<<}\n10) ~>\n   {++XYsa++}me{>>keep<<}\n9) ~~}final\n';
        await page.evaluate(async ({ source, tracked }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
            let block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            for (let index = 0; index < 3; index++) block = block.nextContentInContext()!;
            if (block.text !== 'same') throw new Error(`Expected clean replacement text; received ${block.text}`);
            block.setCursor(0, 0, true);
        }, { source, tracked });
        try {
            await page.keyboard.type('XY');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 2, caret: 2, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
