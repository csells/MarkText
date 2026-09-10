import { expect, test } from '../fixtures/muya';

for (const ending of ['\n', '\r\n', '\r']) {
    for (const empty of [false, true]) {
        test(`Forward Delete retains the nested sublist and next key (empty=${empty}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const initial = empty ? '' : 'a{>>keep<<}';
            const source = '* ' + initial + ending + ending + '* C' + ending + '  ' + ending + '  - D' + ending;
            const joined = '* ' + initial + 'C' + ending + '  ' + ending + '  - D' + ending;
            const typed = '* ' + initial + 'xC' + ending + '  ' + ending + '  - D' + ending;
            const offset = empty ? 0 : 1;
            await page.evaluate(async (source) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, false);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(block.text.length, block.text.length, true);
            }, source);
            try {
                await page.keyboard.press('Delete');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: joined }, anchor: offset, caret: offset, legacyCalls: [] });
                expect(await page.evaluate(() => window.muya!.getState())).toMatchObject([{ name: 'bullet-list', children: [{ name: 'list-item', children: [{ name: 'paragraph' }, { name: 'bullet-list', children: [{ children: [{ text: 'D' }] }] }] }] }]);
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: offset + 1, caret: offset + 1, legacyCalls: [] });
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

for (const tracked of [true]) {
    for (const ending of ['\n', '\r\n', '\r']) {
        test(`Forward Delete owns the next trusted input (Track=${tracked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const source = '- a{>>keep<<}' + ending + ending + '  b' + ending;
            const joined = tracked ? '- a{>>keep<<}{--' + ending + ending + '  --}b' + ending : '- a{>>keep<<}b' + ending;
            const typed = tracked ? '- a{>>keep<<}{--' + ending + ending + '  --}{++x++}b' + ending : '- a{>>keep<<}xb' + ending;
            await page.evaluate(async ({ source, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(block.text.length, block.text.length, true);
            }, { source, tracked });
            try {
                await page.keyboard.press('Delete');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: joined }, anchor: tracked ? 0 : 1, caret: tracked ? 0 : 1, legacyCalls: [] });
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: tracked ? 1 : 2, caret: tracked ? 1 : 2, legacyCalls: [] });
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
