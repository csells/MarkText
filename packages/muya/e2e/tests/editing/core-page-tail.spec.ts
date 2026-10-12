import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const source of ['same\n', '> s{++am++}e{>>keep<<}\n']) {
    for (const action of ['page-click', 'ArrowRight', 'ArrowDown']) {
        test(`trailing paragraph from ${action} owns the next key: ${source}`, async ({ page }) => {
            await bootCore(page, source, {
                setup: () => {
                    const content = window.muya!.editor.scrollPage!.lastContentInDescendant()!;
                    content.setCursor(content.text.length, content.text.length, true);
                },
            });
            try {
                if (action === 'page-click') {
                    const container = await page.locator('.mu-container').boundingBox();
                    const last = await page.locator('.mu-content').last().boundingBox();
                    if (!container || !last) throw new Error('Expected rendered editor bounds');
                    await page.mouse.click(container.x + 5, last.y + last.height + 25);
                }
                else {
                    await page.keyboard.press(action);
                }
                expect(await readCore(page)).toMatchObject({ source: { source: source + '\n\n' }, anchor: 0, caret: 0, legacyCalls: [] });
                await page.keyboard.type('x');
                expect(await readCore(page)).toMatchObject({ source: { source: source + '\nx\n' }, legacyCalls: [] });
                await coreHistory(page, 'undo');
                await coreHistory(page, 'undo');
                expect(await readCore(page)).toMatchObject({ source: { source } });
                await coreHistory(page, 'redo');
                await coreHistory(page, 'redo');
                expect(await reopenCore(page)).toMatchObject({ source: source + '\nx\n' });
            }
            finally { await disposeCore(page); }
        });
    }
}
