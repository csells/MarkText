import { expect, test } from '../fixtures/muya';

for (const tracked of [false, true]) {
    for (const ending of ['\n', '\r\n', '\r']) {
        test(`Paragraph Backspace owns the next trusted input (Track=${tracked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const source = '- a{>>keep<<}' + ending + ending + '  b' + ending;
            const joined = tracked ? '- a{>>keep<<}{--' + ending + ending + '  --}b' + ending : '- a{>>keep<<}b' + ending;
            const typed = tracked ? '- a{>>keep<<}{--' + ending + ending + '  --}{++x++}b' + ending : '- a{>>keep<<}xb' + ending;
            await page.evaluate(async ({ source, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!;
                if (block.text !== 'b') throw new Error('Expected second paragraph');
                block.setCursor(0, 0, true);
            }, { source, tracked });
            try {
                await page.keyboard.press('Backspace');
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

for (const example of [
    { style: 'ATX heading', source: '# a{>>keep<<}\n\nb\n', joined: '# a{>>keep<<}b\n', typed: '# a{>>keep<<}xb\n', offset: 3, target: 1 },
    { style: 'Setext heading', source: 'a{>>keep<<}\n===\n\nb\n', joined: 'a{>>keep<<}b\n===\n', typed: 'a{>>keep<<}xb\n===\n', offset: 1, target: 1 },
    { style: 'reference definition', source: 'a\n\n[id]: /url\n\nb\n', joined: 'a\n\n[id]: /urlb\n', typed: 'a\n\n[id]: /urlxb\n', offset: 10, target: 2 },
]) {
    test(`Paragraph Backspace joins into the existing ${example.style}`, async ({ page }) => {
        await page.evaluate(async ({ source, target }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, false);
            let block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            for (let index = 0; index < target; index++) block = block.nextContentInContext()!;
            if (block.text !== 'b') throw new Error('Expected selected paragraph');
            block.setCursor(0, 0, true);
        }, { source: example.source, target: example.target });
        try {
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.joined }, anchor: example.offset, caret: example.offset, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.typed }, anchor: example.offset + 1, caret: example.offset + 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.joined } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.typed });
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
