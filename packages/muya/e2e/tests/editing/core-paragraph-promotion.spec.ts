import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const tracked of [false, true]) {
    for (const ending of ['\n', '\r\n', '\r']) {
        test(`Forward Delete moves paragraphs into a quote before rapid typing (Track=${tracked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const source = '> a\n\n100. C\n\n     D\n'.replaceAll('\n', ending);
            const joined = (tracked ? '> a{~~\n\n100. C\n\n     ~>C\n>\n> ~~}D\n' : '> aC\n>\n> D\n').replaceAll('\n', ending);
            const typed = (tracked ? '> a{~~\n\n100. C\n\n     ~>xyC\n>\n> ~~}D\n' : '> axyC\n>\n> D\n').replaceAll('\n', ending);
            await bootCore(page, source, { tracked, cursor: [1, 1, true] });
            try {
                await page.keyboard.press('Delete');
                expect(await readCore(page)).toMatchObject({ source: { source: joined }, anchor: 1, caret: 1, legacyCalls: [] });
                await page.keyboard.type('xy');
                expect(await readCore(page)).toMatchObject({ source: { source: typed }, anchor: tracked ? 2 : 3, caret: tracked ? 2 : 3, legacyCalls: [] });
                await coreHistory(page, 'undo');
                expect(await readCore(page)).toMatchObject({ source: { source: joined } });
                await coreHistory(page, 'undo');
                expect(await reopenCore(page)).toMatchObject({ source });
                await coreHistory(page, 'redo');
                await coreHistory(page, 'redo');
                expect(await reopenCore(page)).toMatchObject({ source: typed });
            } finally { await disposeCore(page); }
        });
    }
}
