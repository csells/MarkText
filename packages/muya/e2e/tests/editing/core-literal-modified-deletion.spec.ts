import process from 'node:process';
import { expect, test } from '../fixtures/muya';

for (const annotated of [false, true]) {
    const block = annotated ? '{++```js\nsame same\n```++}' : '```js\nsame same\n```';
    const paragraph = annotated ? '{++same same++}' : 'same same';
    const prefix = 'before\n\n';
    const suffix = '\n\nafter\n';
    const source = prefix + block + suffix;
    for (const example of [
        { shortcut: 'Alt+Backspace', offset: 0, changed: prefix + paragraph + suffix, typed: prefix + (annotated ? '{++Xsame same++}' : 'Xsame same') + suffix },
        { shortcut: 'Meta+Backspace', offset: 0, changed: prefix + paragraph + suffix, typed: prefix + (annotated ? '{++Xsame same++}' : 'Xsame same') + suffix },
        { shortcut: 'Alt+Delete', offset: 9, changed: source, typed: prefix + (annotated ? '{++```js\nsame sameX\n```++}' : '```js\nsame sameX\n```') + suffix },
        { shortcut: 'Control+k', offset: 9, changed: source, typed: prefix + (annotated ? '{++```js\nsame sameX\n```++}' : '```js\nsame sameX\n```') + suffix },
    ]) {
        test(`trusted ${example.shortcut} keeps the ${annotated ? 'annotated' : 'plain'} literal boundary`, async ({ page }) => {
            test.skip(process.platform !== 'darwin', 'Uses macOS word and line deletion shortcuts');
            await page.evaluate(async ({ source, offset }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                const leaf = window.muya!.editor.scrollPage!.queryBlock([1, 'text']);
                if (!leaf?.isContent()) throw new Error('Expected literal body');
                leaf.setCursor(offset, offset, true);
                document.addEventListener('keydown', event => { window.muya!.domNode.dataset.boundaryTrusted = String(event.isTrusted); }, { capture: true, once: true });
            }, { source, offset: example.offset });
            try {
                await page.keyboard.press(example.shortcut);
                expect(await page.evaluate(() => window.muya!.domNode.dataset.boundaryTrusted)).toBe('true');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.changed }, anchor: example.offset, caret: example.offset, legacyCalls: [] });
                await page.keyboard.type('X');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.typed }, anchor: example.offset + 1, caret: example.offset + 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                if (example.changed !== source) await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: example.offset, caret: example.offset });
                if (example.changed !== source) await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.typed });
            }
            finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
    test(`trusted hard-line deletion retains ${annotated ? 'annotated' : 'plain'} normalized literal indentation`, async ({ page }) => {
        test.skip(process.platform !== 'darwin', 'Uses macOS line deletion shortcut');
        const wrap = (value: string) => annotated ? `{++${value}++}` : value;
        const source = prefix + wrap('  ```\n\tbody\n  ```') + suffix;
        const changed = prefix + wrap('  ```\n   \n  ```') + suffix;
        const typed = prefix + wrap('  ```\n   X\n  ```') + suffix;
        await page.evaluate(async source => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const leaf = window.muya!.editor.scrollPage!.queryBlock([1, 'text']);
            if (!leaf?.isContent()) throw new Error('Expected literal body');
            leaf.setCursor(1, 1, true);
        }, source);
        try {
            await page.keyboard.press('Control+k');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: changed }, anchor: 1, caret: 1, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 2, caret: 2, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 1, caret: 1 });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
