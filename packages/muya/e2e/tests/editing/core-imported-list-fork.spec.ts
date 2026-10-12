import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const tracked of [false, true]) {
    test(`Core imported list arms retain their containers through native typing (tracked=${tracked})`, async ({ page }) => {
        const source = '8) same\n{~~9) {++sa++}me{>>keep<<}\n10) ~>\n   {++sa++}me{>>keep<<}\n9) ~~}final\n';
        // Untracked typing at an addition's start stays before it; Track
        // Changes extends the pending addition.
        const typed = `8) same\n{~~9) {++sa++}me{>>keep<<}\n10) ~>\n   ${tracked ? '{++XYsa++}' : 'XY{++sa++}'}me{>>keep<<}\n9) ~~}final\n`;
        await bootCore(page, source, {
            tracked,
            setup: () => {
                let block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                for (let index = 0; index < 3; index++) block = block.nextContentInContext()!;
                if (block.text !== 'same') throw new Error(`Expected clean replacement text; received ${block.text}`);
                block.setCursor(0, 0, true);
            },
        });
        try {
            await page.keyboard.type('XY');
            expect(await readCore(page)).toMatchObject({ source: { source: typed }, anchor: 2, caret: 2, legacyCalls: [] });
            await coreHistory(page, 'undo');
            await coreHistory(page, 'undo');
            expect(await reopenCore(page)).toMatchObject({ source });
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: typed });
        } finally { await disposeCore(page); }
    });
}
