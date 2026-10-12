import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';
import { floats, quickInsertItem } from '../helpers/selectors';

for (const trigger of ['/math', '/m{++a++}th', '/m{>>inside<<}ath']) {
    for (const tracked of [false, true]) {
        test(`Quick Insert Math owns its trigger and next key (${trigger}, Track=${tracked})`, async ({ page }) => {
            const tail = '\n\noutside{>>keep<<}\n';
            const source = trigger + tail;
            const converted = (tracked ? `{~~${trigger}~>$$\n\n$$~~}` : '$$\n\n$$') + tail;
            const typed = (tracked ? `{~~${trigger}~>$$\nx\n$$~~}` : '$$\nx\n$$') + tail;
            await bootCore(page, source, {
                tracked,
                setup: () => {
                    const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                    block.setCursor(block.text.length, block.text.length, true);
                    window.muya!.eventCenter.emit('content-change', { block });
                },
            });
            try {
                await expect(page.locator(floats.quickInsert)).toBeVisible();
                await page.locator(quickInsertItem('math-block')).click();
                expect(await readCore(page)).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0, legacyCalls: [] });
                await page.keyboard.type('x');
                expect(await readCore(page)).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
                // Upstream History groups the conversion with the key typed
                // within its one-second window.
                await coreHistory(page, 'undo');
                expect(await reopenCore(page)).toMatchObject({ source });
                await coreHistory(page, 'redo');
                expect(await reopenCore(page)).toMatchObject({ source: typed });
            } finally { await disposeCore(page); }
        });
    }
}

for (const text of ['seed', 'se{++e++}d{>>keep<<}']) {
    for (const tracked of [false, true]) {
        test(`Format Math undo restores its actual middle caret (${text}, Track=${tracked})`, async ({ page }) => {
            const source = text + '\n\nother\n';
            const converted = text + (tracked ? '{++\n\n$$\n\n$$++}' : '\n\n$$\n\n$$') + '\n\nother\n';
            await bootCore(page, source, {
                tracked,
                cursor: [2, 2, true],
                setup: () => {
                    window.muya!.editor.activeContentBlock = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                    window.muya!.updateParagraph('mathblock');
                },
            });
            try {
                expect(await readCore(page)).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0, legacyCalls: [] });
                await coreHistory(page, 'undo');
                expect(await readCore(page)).toMatchObject({ source: { source }, anchor: 2, caret: 2 });
                await coreHistory(page, 'redo');
                expect(await readCore(page)).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0 });
            } finally { await disposeCore(page); }
        });
    }
}
