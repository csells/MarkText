import { expect, test } from '../fixtures/muya';

for (const text of ['same', 's{++am++}e{>>keep<<}']) {
    test(`reference definition editing refreshes both model-owned links: ${text}`, async ({ page }) => {
        const source = `[${text}][a+b] [same][a+b]\n\n[a+b]: /old\n`;
        const changed = `[${text}][a+b] [same][a+b]\n\n[a+b]: /newx\n`;
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            const muya = window.muya!;
            window.coreBoundary = control.bootCoreBoundary(muya, source);
            const definition = muya.editor.scrollPage!.lastContentInDescendant()!;
            definition.setCursor(8, 11, true);
        }, source);
        try {
            await page.keyboard.type('new');
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: changed }, legacyCalls: [] });
            expect(await page.locator('a.mu-link').evaluateAll(links => ({
                text: links.map(link => link.textContent).join(''),
                hrefs: [...new Set(links.map(link => link.getAttribute('href')))],
            }))).toEqual({ text: 'samesame', hrefs: ['/newx'] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: changed });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
