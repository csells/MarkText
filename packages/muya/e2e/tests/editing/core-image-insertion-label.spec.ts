import { expect, test } from '../fixtures/muya';

for (const example of [
    { source: 'a]b\n', changed: '![a\\]b](cat.png)\n', typed: '![a\\]b](cat.png)X\n' },
    { source: 'a{++]++}b{>>keep<<}\n', changed: '![a{++\\]++}b](cat.png){>>keep<<}\n', typed: '![a{++\\]++}b](cat.png)X{>>keep<<}\n' },
]) {
    test(`Insert Image retains selected bracket text and annotations: ${example.source}`, async ({ page }) => {
        await page.evaluate(async source => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const leaf = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            leaf.setCursor(0, 3, true);
            window.muya!.insertImage({ src: 'cat.png' });
        }, example.source);
        try {
            const widget = page.locator('[data-core-image]');
            await expect(widget).toHaveCount(1);
            expect(JSON.parse((await widget.getAttribute('data-core-image'))!).alt).toBe('a]b');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.changed }, anchor: 16, caret: 16, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.typed }, anchor: 17, caret: 17, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source }, anchor: 0, caret: 3 });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.typed });
            await page.evaluate(async () => {
                const saved = window.coreBoundary.reopen();
                window.coreBoundary.dispose();
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, saved.source);
            });
            await expect(widget).toHaveCount(1);
            expect(JSON.parse((await widget.getAttribute('data-core-image'))!).alt).toBe('a]b');
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
