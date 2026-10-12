import { expect, test } from '../fixtures/muya';
import { coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const plain of [true, false]) {
    test(`Source ${plain ? 'ordinary text' : 'image label'} history restores usable native selection before the next key`, async ({ page }) => {
        const original = plain ? 'x aaay\n' : '![aaa](url)\n';
        const changed = plain ? 'x bbby\n' : '![bbb](url)\n';
        const typed = plain ? 'x Xy\n' : '![X](url)\n';
        await page.evaluate(async (plain) => {
            const modulePath = '/sourceHistoryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = await control.bootSourceImageHistory(window.muya!, plain);
        }, plain);
        try {
            expect(await readCore(page)).toMatchObject({ source: { source: changed } });
            await page.evaluate(async () => {
                await window.coreBoundary.history('undo');
                window.muya!.focus();
            });
            expect(await readCore(page)).toMatchObject({ source: { source: original }, anchor: 2, caret: 5 });
            const before = await page.evaluate(() => {
                const selection = window.muya!.editor.selection.getDOMSelection();
                const element = selection?.focus.node instanceof Element ? selection.focus.node : selection?.focus.node.parentElement;
                return { hidden: !!element?.closest('[contenteditable="false"], .mu-hide'), active: document.activeElement?.outerHTML.slice(0, 250) };
            });
            expect.soft(before.hidden, JSON.stringify(before)).toBe(false);
            await page.keyboard.type('X');
            const after = await readCore(page);
            expect(after).toMatchObject({ source: { source: typed } });
            expect(after.legacyCalls).toEqual([]);
            await coreHistory(page, 'undo');
            expect(await reopenCore(page)).toMatchObject({ source: original });
            if (!plain) {
                await page.evaluate(() => {
                    const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                    block.setCursor(block.text.length, block.text.length, true);
                    window.muya!.focus();
                });
                expect(await page.locator('#editor .mu-inline-image').count()).toBe(1);
                await page.keyboard.type('Y');
                expect(await readCore(page)).toMatchObject({ source: { source: '![aaa](url)Y\n' } });
                await coreHistory(page, 'undo');
                expect(await reopenCore(page)).toMatchObject({ source: original });
            }
        }
        finally {
            await disposeCore(page);
        }
    });

}
