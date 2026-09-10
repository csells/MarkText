import { expect, test } from '../fixtures/muya';
import { floats } from '../helpers/selectors';

for (const { format, marker } of [{ format: 'strong', marker: '**' }, { format: 'em', marker: '*' }]) {
    for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
        test(`backward ${format} toolbar selection retains direction and history (Core=${bound}, Track=${tracked})`, async ({ page }) => {
            const source = bound ? 'a{++a++}a\n' : 'aaa\n';
            await page.evaluate(async ({ source, bound, tracked }) => {
                const muya = window.muya!;
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
                }
                else { muya.setContent(source); }
                muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 0, true);
                muya.focus();
                muya.flush();
            }, { source, bound, tracked });
            const bounds = await page.evaluate(() => {
                const selection = window.getSelection();
                if (!selection?.rangeCount)
                    throw new Error('Initial selection is missing');
                const rect = selection.getRangeAt(0).getBoundingClientRect();
                return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
            });
            await page.mouse.move(bounds.right - 0.5, bounds.y);
            await page.mouse.down();
            await page.mouse.move(bounds.left + 0.5, bounds.y, { steps: 8 });
            await page.mouse.up();
            const readSelection = () => page.evaluate(() => {
                const selection = window.muya!.getSelection();
                return { anchor: selection?.anchor.offset, focus: selection?.focus.offset };
            });
            const readSource = () => bound
                ? page.evaluate(() => {
                        const reply = window.coreBoundary.read().source;
                        if (reply.type !== 'source')
                            throw new Error('Source read was rejected');
                        return reply.source;
                    })
                : page.evaluate(() => {
                        window.muya!.flush();
                        return window.muya!.getMarkdown();
                    });
            const history = (direction: 'undo' | 'redo') => page.evaluate(({ bound, direction }) => {
                if (bound) {
                    window.coreBoundary.history(direction);
                }
                else if (direction === 'undo') {
                    window.muya!.undo();
                }
                else {
                    window.muya!.redo();
                }
            }, { bound, direction });
            try {
                expect(await readSelection()).toEqual({ anchor: 3, focus: 0 });
                await expect(page.locator(floats.inlineFormatToolbar)).toBeVisible();
                await page.locator(`${floats.inlineFormatToolbar} li.item.${format}`).click();
                const payload = `${marker}${source.slice(0, -1)}${marker}`;
                const formatted = tracked ? `{~~${source.slice(0, -1)}~>${payload}~~}\n` : `${payload}\n`;
                expect(await readSource()).toBe(formatted);
                const offset = (tracked ? 3 : 0) + marker.length;
                const selected = { anchor: offset + 3, focus: offset };
                expect.soft(await readSelection()).toEqual(selected);
                if (!bound) {
                    // Native history groups immediate formatting and typing by time.
                    // Exercise its actual undo/redo boundary before replacement.
                    await history('undo');
                    expect(await readSource()).toBe(source);
                    expect.soft(await readSelection()).toEqual({ anchor: 3, focus: 0 });
                    await history('redo');
                    expect(await readSource()).toBe(formatted);
                    expect.soft(await readSelection()).toEqual(selected);
                }
                await page.keyboard.press('Shift+ArrowRight');
                expect.soft(await readSelection()).toEqual({ anchor: selected.anchor, focus: selected.focus + 1 });
                await page.keyboard.press('Shift+ArrowLeft');
                expect.soft(await readSelection()).toEqual(selected);
                await page.keyboard.type('X');
                const typed = tracked ? `{~~${source.slice(0, -1)}~>${marker}X${marker}~~}\n` : `${marker}X${marker}\n`;
                expect(await readSource()).toBe(typed);
                await history('undo');
                expect(await readSource()).toBe(formatted);
                expect.soft(await readSelection()).toEqual(selected);
                await history('undo');
                expect(await readSource()).toBe(source);
                expect.soft(await readSelection()).toEqual({ anchor: 3, focus: 0 });
                await history('redo');
                expect(await readSource()).toBe(formatted);
                expect.soft(await readSelection()).toEqual(selected);
                if (bound) {
                    expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: formatted });
                }
            }
            finally {
                if (bound) {
                    await page.evaluate(() => window.coreBoundary.dispose());
                }
            }
        });
    }
}
