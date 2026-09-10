import { expect, test } from '../fixtures/muya';

for (const tracked of [false, true]) {
    for (const ending of ['\n', '\r\n', '\r']) {
        test(`Forward Delete moves paragraphs into a quote before rapid typing (Track=${tracked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const source = '> a\n\n100. C\n\n     D\n'.replaceAll('\n', ending);
            const joined = (tracked ? '> a{~~\n\n100. C\n\n     ~>C\n>\n> ~~}D\n' : '> aC\n>\n> D\n').replaceAll('\n', ending);
            const typed = (tracked ? '> a{~~\n\n100. C\n\n     ~>xyC\n>\n> ~~}D\n' : '> axyC\n>\n> D\n').replaceAll('\n', ending);
            await page.evaluate(async ({ source, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 1, true);
            }, { source, tracked });
            try {
                await page.keyboard.press('Delete');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: joined }, anchor: 1, caret: 1, legacyCalls: [] });
                await page.keyboard.type('xy');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: tracked ? 2 : 3, caret: tracked ? 2 : 3, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: joined } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
