import { expect, test } from '../fixtures/muya';

for (const example of [
    { style: 'empty list predecessor', key: 'Backspace', source: 'a\n\n- \n\nb\n', joined: 'a\n\n- b\n', typed: 'a\n\n- xb\n', offset: 0, target: 2 },
    { style: 'empty quote predecessor', key: 'Backspace', source: 'a\n\n>\n\nb\n', joined: 'a\n\n>b\n', typed: 'a\n\n>xb\n', offset: 0, target: 2 },
    { style: 'empty current quote', key: 'Delete', source: '>\n\nb\n', joined: '>b\n', typed: '>xb\n', offset: 0, target: 0 },
    { style: 'empty next quote', key: 'Delete', source: 'a\n\n>\n\nb\n', joined: 'a\n\nb\n', typed: 'ax\n\nb\n', offset: 1, target: 0 },
    { style: 'empty next list', key: 'Delete', source: 'a\n\n- \n\nb\n', joined: 'a\n\nb\n', typed: 'ax\n\nb\n', offset: 1, target: 0 },
    { style: 'image predecessor', key: 'Backspace', source: '<img src="x">\n\nb\n', joined: '<img src="x">b\n', typed: '<img src="x">xb\n', offset: 13, target: 1 },
    { style: 'image current paragraph', key: 'Delete', source: '<img src="x">\n\nb\n', joined: '<img src="x">b\n', typed: '<img src="x">xb\n', offset: 13, target: 0 },
    { style: 'image next paragraph', key: 'Delete', source: 'a\n\n<img src="x">\n', joined: 'a<img src="x">\n', typed: 'ax<img src="x">\n', offset: 1, target: 0 },
]) {
    test(`${example.key} joins the ${example.style}`, async ({ page }) => {
        await page.evaluate(async ({ source, target, key }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, false);
            let block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            for (let index = 0; index < target; index++) block = block.nextContentInContext()!;
            const offset = key === 'Backspace' ? 0 : block.text.length;
            block.setCursor(offset, offset, true);
        }, { source: example.source, target: example.target, key: example.key });
        try {
            await page.keyboard.press(example.key);
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
