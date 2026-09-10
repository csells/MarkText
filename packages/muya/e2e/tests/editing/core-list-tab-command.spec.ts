import { expect, test } from '../fixtures/muya';

for (const tracked of [false, true]) {
    test(`native list Tab owns the next key, outdent and history (Track=${tracked})`, async ({ page }) => {
        const source = '- {++first++}{>>keep<<}\n- second\n';
        const indented = '- {++first++}{>>keep<<}\n' + (tracked ? '{++  ++}' : '  ') + '- second\n';
        const typed = indented.replace('second', tracked ? 'se{++x++}cond' : 'sexcond');
        await page.evaluate(async ({ source, tracked }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
            const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!;
            block.setCursor(2, 2, true);
        }, { source, tracked });
        try {
            await page.keyboard.press('Tab');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: indented }, anchor: 2, caret: 2, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 3, caret: 3, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            await page.keyboard.press('Shift+Tab');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 2, caret: 2, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: indented });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: indented });
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const example of [
    { source: '- first\n- **<u>word</u>**\n', target: '**<u>word</u>**', before: 9, after: 13, shift: false, expected: '- first\n- **<u>word</u>**\n', typed: '- first\n- **<u>word</u>x**\n' },
    { source: '- first\n- [ ] second\n', target: 'second', before: 2, after: 6, shift: false, expected: '- first\n- [ ] se    cond\n', typed: '- first\n- [ ] se    xcond\n' },
    { source: '- [ ] first\n- second\n', target: 'second', before: 2, after: 6, shift: false, expected: '- [ ] first\n- se    cond\n', typed: '- [ ] first\n- se    xcond\n' },
    { source: '- - A\n  - B\n', target: 'A', before: 1, after: 1, shift: true, expected: '- A\n  - B\n', typed: '- Ax\n  - B\n' },
    { source: '- - A\n  - B\n', target: 'B', before: 1, after: 1, shift: true, expected: '- B\n  - A\n', typed: '- Bx\n  - A\n' },
    { source: '- first\n  1. second\n- third\n', target: 'third', before: 1, after: 1, shift: false, expected: '- first\n  1. second\n  2. third\n', typed: '- first\n  1. second\n  2. txhird\n' },
]) {
    test(`paragraph Tab retains native context and next input at ${JSON.stringify(example.target)}: ${JSON.stringify(example.source)}`, async ({ page }) => {
        await page.evaluate(async ({ source, target, before }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, false);
            let block = window.muya!.editor.scrollPage!.firstContentInDescendant();
            while (block && block.text !== target) block = block.nextContentInContext() ?? null;
            if (!block) throw new Error('Expected Tab target');
            block.setCursor(before, before, true);
        }, example);
        try {
            await page.keyboard.press(example.shift ? 'Shift+Tab' : 'Tab');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: example.after, caret: example.after, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.typed }, anchor: example.after + 1, caret: example.after + 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
            if (example.source !== example.expected) {
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
            }
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
