import { expect, test } from '../fixtures/muya';
import { coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const example of [
    { source: '```js\nbody\n```\n', typed: '```jxys\nbody\n```\n', offset: 1, language: 'jxys' },
    { source: '{++```js\nbody\n```++}\n', typed: '{++```jxys\nbody\n```++}\n', offset: 1, language: 'jxys' },
    { source: '```  j&#115; title=\\*  \nbody\n```\n', typed: '```  jxy&#115; title=\\*  \nbody\n```\n', offset: 3, language: '  jxys title=*  ' },
    { source: '```&fjlig; title=\\*\nbody\n```\n', typed: '```fxyj title=\\*\nbody\n```\n', offset: 1, language: 'fxyj title=*' },
    { source: '```\nbody\n```\n', typed: '```xy\nbody\n```\n', offset: 0, language: 'xy' },
]) {
    test(`direct code info uses its owned field: ${JSON.stringify(example.source)}`, async ({ page }) => {
        await page.evaluate(async ({ source, offset }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const code = window.muya!.editor.scrollPage!.queryBlock([0]);
            if (!code?.isParent()) throw new Error('Missing code widget');
            code.firstContentInDescendant()!.setCursor(offset, offset, true);
        }, example);
        try {
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.path)).toEqual([0, 'meta', 'lang']);
            await page.keyboard.type('y');
            expect(await readCore(page)).toMatchObject({ source: { source: example.typed }, anchor: example.offset + 2, caret: example.offset + 2, legacyCalls: [] });
            await coreHistory(page, 'undo');
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: example.source }, caret: example.offset });
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.path)).toEqual([0, 'meta', 'lang']);
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            const saved = await reopenCore(page);
            expect(saved).toMatchObject({ source: example.typed });
            await page.evaluate(async (source) => {
                window.coreBoundary.dispose();
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            }, saved.source);
            expect(await page.locator('.mu-language-input').textContent()).toBe(example.language);
        }
        finally { await disposeCore(page); }
    });
}
