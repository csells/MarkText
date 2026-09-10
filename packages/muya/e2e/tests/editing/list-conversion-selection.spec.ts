import { expect, test } from '../fixtures/muya';

for (const middle of ['alpha', 'bravo']) {
    test(`native list conversion retains selected child identity (${middle})`, async ({ page }) => {
        const source = `- alpha\n- ${middle}\n- alpha\n`;
        const converted = `1. alpha\n2. ${middle}\n3. alpha\n`;
        await page.evaluate(({ source }) => {
            const muya = window.muya!;
            muya.setContent(source);
            muya.focus();
            const first = muya.editor.scrollPage!.firstContentInDescendant()!;
            const second = first.nextContentInContext()!;
            const third = second.nextContentInContext()!;
            muya.editor.selection.setSelection({ block: second, path: second.path, offset: 1 }, { block: third, path: third.path, offset: 2 });
            muya.updateParagraph('ol-order');
            muya.flush();
        }, { source });
        const read = () => page.evaluate(() => { window.muya!.flush(); return window.muya!.getMarkdown(); });
        expect(await read()).toBe(converted);
        expect(await page.evaluate(() => {
            const selection = window.muya!.getSelection()!;
            return { anchor: selection.anchor.offset, focus: selection.focus.offset, anchorPath: selection.anchor.path, focusPath: selection.focus.path };
        })).toEqual({ anchor: 1, focus: 2, anchorPath: [0, 'children', 1, 'children', 0, 'text'], focusPath: [0, 'children', 2, 'children', 0, 'text'] });
        await page.keyboard.type('X');
        expect(await read()).toBe(`1. alpha\n2. ${middle[0]}Xpha\n`);
        for (const expected of [converted, source]) {
            await page.evaluate(() => window.muya!.undo());
            expect(await read()).toBe(expected);
        }
        await page.evaluate(() => window.muya!.redo());
        expect(await read()).toBe(converted);
    });
}
