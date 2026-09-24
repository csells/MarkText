import { expect, test } from '../fixtures/muya';

// Typing a quote or list marker and its space opens the container at once, as
// upstream does; Track Changes records the same edit and must present it alike.
for (const tracked of [false, true]) {
    for (const example of [
        { marker: '> ', container: 'block-quote' },
        { marker: '- ', container: 'bullet-list' },
        // Upstream keeps a lone marker as paragraph text and spaces it on the next key.
        { marker: '>', container: undefined, then: '> x' },
    ]) {
        test(`typed ${JSON.stringify(example.marker)} presents ${example.container ?? 'its paragraph'} with Track ${tracked}`, async ({ page }) => {
            await page.evaluate(async (tracked) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, 'before\n\n\n\nafter\n', tracked);
                window.muya!.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!.setCursor(0, 0, true);
            }, tracked);
            try {
                await page.keyboard.type(example.marker);
                const typed = `before\n\n${tracked ? `{++${example.marker}++}` : example.marker}\n\nafter\n`;
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
                expect(await page.evaluate(() => window.muya!.getState()[1]?.name)).toBe(example.container ?? 'paragraph');
                await page.keyboard.type('x');
                const then = example.then ?? `${example.marker}x`;
                const next = `before\n\n${tracked ? `{++${then}++}` : then}\n\nafter\n`;
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: next }, legacyCalls: [] });
            }
            finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
