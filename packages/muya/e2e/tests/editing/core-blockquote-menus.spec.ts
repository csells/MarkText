import { expect, test } from '../fixtures/muya';
import { editor, floats, quickInsertItem } from '../helpers/selectors';

for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
    for (const menu of ['front', 'quick'] as const) {
        test(`blockquote ${menu} menu owns its actual paragraph (Core=${bound}, Track=${tracked})`, async ({ page }) => {
            const tail = bound ? '\n\noutside{>>keep<<}\n' : '\n\noutside\n';
            const source = (menu === 'front' ? bound ? 'a{++a++}a' : 'aaa' : bound ? '/qu{++o++}t' : '/quot') + tail;
            const query = (tracked ? '/qu{++o++}t{++e++}' : bound ? '/qu{++o++}te' : '/quote') + tail;
            const quote = (tracked ? menu === 'front' ? '{++> ++}a{++a++}a' : '{~~/qu{++o++}t{++e++}~>> ~~}' : menu === 'front' ? bound ? '> a{++a++}a' : '> aaa' : '> ') + tail;
            const typed = (tracked ? menu === 'front' ? '{++> ++}a{++a++}a{++X++}' : '{~~/qu{++o++}t{++e++}~>> X~~}' : menu === 'front' ? bound ? '> a{++a++}aX' : '> aaaX' : '> X') + tail;
            await page.evaluate(async ({ source, bound, tracked, menu }) => {
                const muya = window.muya!;
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
                }
                else {
                    muya.setContent(source);
                }
                const first = muya.editor.scrollPage!.firstContentInDescendant()!;
                const content = menu === 'front' ? first.nextContentInContext()! : first;
                content.setCursor(menu === 'front' ? 3 : 5, menu === 'front' ? 3 : 5, true);
                muya.focus();
                muya.flush();
            }, { source, bound, tracked, menu });
            let failed = false;
            try {
                if (menu === 'front') {
                    const box = await page.locator(editor.paragraph).first().boundingBox();
                    if (!box)
                        throw new Error('Missing target paragraph geometry');
                    await page.mouse.move(box.x + 10, box.y + box.height / 2);
                    await page.waitForTimeout(50);
                    await page.mouse.move(box.x + 12, box.y + box.height / 2);
                    await expect.poll(() => page.locator(floats.paragraphFrontButton).evaluate(el => Number.parseFloat((el as HTMLElement).style.opacity || '0'))).toBeGreaterThan(0);
                    await page.locator(floats.paragraphFrontButtonInner).click();
                    await page.locator(`${floats.paragraphFrontMenu} .turn-into-item.block-quote`).click({ timeout: 5000 });
                }
                else {
                    await page.keyboard.type('e');
                    if (bound) {
                        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: query }, legacyCalls: [] });
                    }
                    else {
                        expect(await page.evaluate(() => {
                            window.muya!.flush();
                            return window.muya!.getMarkdown();
                        })).toBe(query);
                    }
                    await expect(page.locator(`${quickInsertItem('block-quote')}.active`)).toBeVisible();
                    await page.keyboard.press('Enter');
                }
                if (bound) {
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: quote }, anchor: menu === 'front' ? 3 : 0, caret: menu === 'front' ? 3 : 0, legacyCalls: [] });
                }
                else {
                    expect(await page.evaluate(() => {
                        window.muya!.flush();
                        return window.muya!.getMarkdown();
                    })).toBe(quote);
                }
                await expect(page.locator(editor.blockQuote)).toHaveCount(1);
                await page.keyboard.type('X');
                if (bound) {
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: quote } });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: menu === 'front' ? source : query } });
                    await page.evaluate(() => window.coreBoundary.history('redo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: quote });
                }
                else {
                    expect(await page.evaluate(() => {
                        window.muya!.flush();
                        return window.muya!.getMarkdown();
                    })).toBe(typed);
                    await page.evaluate(() => window.muya!.undo());
                    expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(quote);
                    await page.evaluate(() => window.muya!.undo());
                    expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(menu === 'front' ? source : query);
                    await page.evaluate(() => window.muya!.redo());
                    expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(quote);
                }
            }
            catch (error) {
                failed = true;
                throw error;
            }
            finally {
                if (bound && !failed)
                    await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}
