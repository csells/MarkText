import { expect, test } from '../fixtures/muya';
import { pauseUndoWindow } from '../helpers/undoWindow';

for (const annotated of [false, true]) {
    test(`actual emoji picker uses owned incomplete context (${annotated ? 'annotated' : 'ordinary'})`, async ({ page }) => {
        const source = annotated ? 'before {++:sm++}{>>keep<<} tail\n' : 'before :sm tail\n';
        const completed = annotated ? 'before {++:smiley:++}{>>keep<<} tail\n' : 'before :smiley: tail\n';
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(10, 10, true);
        }, source);
        try {
            await page.keyboard.type('i');
            // A pick within a second of typing joins its undo step, as upstream's does; pause so each has its own.
            await pauseUndoWindow(page);
            await page.locator('.mu-emoji-picker [data-label="smiley"]').click();
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: completed }, anchor: 15, caret: 15, legacyCalls: [] });
            await pauseUndoWindow(page);
            await page.keyboard.type('x');
            const typed = completed.replace(':smiley:', ':smiley:x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, caret: 16, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: source.replace(':sm', ':smi') }, caret: 11 });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

test('one emoji glyph surrounds the editable addition within its parser-owned alias', async ({ page }) => {
    const source = 'before :s{++mi++}le: tail\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, source);
    try {
        const emoji = page.locator('.mu-emoji-marked-text[data-emoji]');
        await expect(emoji).toHaveCount(1);
        await expect(emoji.locator('[data-critic-kind="addition"]')).toHaveText('mi');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
