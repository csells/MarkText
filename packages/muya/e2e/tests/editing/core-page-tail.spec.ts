import { expect, test } from '../fixtures/muya';

for (const source of ['same\n', '> s{++am++}e{>>keep<<}\n']) {
    for (const action of ['page-click', 'ArrowRight', 'ArrowDown']) {
        test(`trailing paragraph from ${action} owns the next key: ${source}`, async ({ page }) => {
            await page.evaluate(async (source) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                const muya = window.muya!;
                window.coreBoundary = control.bootCoreBoundary(muya, source);
                const content = muya.editor.scrollPage!.lastContentInDescendant()!;
                content.setCursor(content.text.length, content.text.length, true);
            }, source);
            try {
                if (action === 'page-click') {
                    const container = await page.locator('.mu-container').boundingBox();
                    const last = await page.locator('.mu-content').last().boundingBox();
                    if (!container || !last) throw new Error('Expected rendered editor bounds');
                    await page.mouse.click(container.x + 5, last.y + last.height + 25);
                }
                else {
                    await page.keyboard.press(action);
                }
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: source + '\n\n' }, anchor: 0, caret: 0, legacyCalls: [] });
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: source + '\nx\n' }, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: source + '\nx\n' });
            }
            finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
