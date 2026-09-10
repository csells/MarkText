import { expect, test } from '../fixtures/muya';

for (const bound of [false, true]) {
    test(`cut restores the actual backward selection before subsequent input (Core=${bound})`, async ({ page }) => {
        const source = bound ? 'a{++a++}a\n' : 'aaa\n';
        await page.evaluate(async ({ source, bound }) => {
            const muya = window.muya!;
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(muya, source);
            }
            else { muya.setContent(source); }
            muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(2, 0, true);
            muya.focus();
            muya.flush();
        }, { source, bound });
        try {
            expect(await page.evaluate(() => ({ anchor: window.muya!.getSelection()?.anchor.offset, caret: window.muya!.getSelection()?.focus.offset }))).toEqual({ anchor: 2, caret: 0 });
            await page.evaluate(async (bound) => {
                const muya = window.muya!;
                muya.domNode.dispatchEvent(new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
                muya.flush();
                if (bound)
                    await window.coreBoundary.settle();
            }, bound);
            expect(await page.evaluate((bound) => {
                if (!bound)
                    return window.muya!.getMarkdown();
                const source = window.coreBoundary.read().source;
                if (source.type !== 'source')
                    throw new Error('Missing canonical clipboard source');
                return source.source;
            }, bound)).toBe('a\n');
            await page.evaluate(async (bound) => {
                if (bound) {
                    await window.coreBoundary.history('undo');
                }
                else {
                    window.muya!.undo();
                    window.muya!.flush();
                }
            }, bound);
            expect(await page.evaluate((bound) => {
                if (!bound)
                    return window.muya!.getMarkdown();
                const source = window.coreBoundary.read().source;
                if (source.type !== 'source')
                    throw new Error('Missing canonical clipboard source');
                return source.source;
            }, bound)).toBe(source);
            expect(await page.evaluate(() => ({ anchor: window.muya!.getSelection()?.anchor.offset, caret: window.muya!.getSelection()?.focus.offset }))).toEqual({ anchor: 2, caret: 0 });
            await page.keyboard.press('Shift+ArrowRight');
            expect(await page.evaluate(() => ({ anchor: window.muya!.getSelection()?.anchor.offset, caret: window.muya!.getSelection()?.focus.offset }))).toEqual({ anchor: 2, caret: 1 });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => {
                const selection = window.muya!.getSelection()!;
                return { text: selection.anchor.block.text, anchor: selection.anchor.offset, caret: selection.focus.offset };
            })).toEqual({ text: 'aXa', anchor: 2, caret: 2 });
            expect(await page.evaluate((bound) => {
                if (!bound) {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                }
                const source = window.coreBoundary.read().source;
                if (source.type !== 'source')
                    throw new Error('Missing canonical clipboard source');
                return source.source;
            }, bound)).toBe(bound ? 'a{++X++}a\n' : 'aXa\n');
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'a{++X++}a\n' });
            }
        }
        finally {
            if (bound)
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const image of [false, true]) {
    test(`pending ${image ? 'image picker' : 'plain paste'} keeps the current backward selection through completion and history`, async ({ page }) => {
        const source = image ? '![a{++a++}a]()\n\none\n' : 'ab\n\none\n';
        const completed = image ? '![a{++a++}a](/uploaded.png)\n\none\n' : 'aPb\n\none\n';
        const typed = image ? '![a{++a++}a](/uploaded.png)\n\noX\n' : 'aPb\n\noX\n';
        await page.evaluate(async ({ source, image }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            if (image) {
                window.__e2e!.imageAction = () => new Promise<string>((resolve) => {
                    window.finishDirectedResource = resolve;
                });
            }
            else {
                window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 1, true);
                window.muya!.options.clipboardText = () => new Promise<string>((resolve) => {
                    window.finishDirectedResource = resolve;
                });
                window.directedResourceCompletion = window.muya!.editor.clipboard.pasteAsPlainText();
            }
        }, { source, image });
        try {
            if (image) {
                await page.locator('#editor .mu-empty-image').click();
                const picker = page.locator('.mu-image-selector');
                await picker.locator('input.src').fill('/chosen.png');
                await picker.locator('button.role-button.link').click();
            }
            await page.waitForFunction(() => typeof window.finishDirectedResource === 'function');
            await page.evaluate(() => window.muya!.editor.scrollPage!.lastContentInDescendant()!.setCursor(3, 0, true));
            await page.evaluate(async (image) => {
                window.finishDirectedResource(image ? '/uploaded.png' : 'P');
                if (!image)
                    await window.directedResourceCompletion;
                await window.coreBoundary.settle();
            }, image);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: completed }, anchor: 3, caret: 0, legacyCalls: [] });
            await page.keyboard.press('Shift+ArrowRight');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ anchor: 3, caret: 1 });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: completed }, anchor: 3, caret: 1 });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 3, caret: 0 });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

declare global {
    // eslint-disable-next-line ts/naming-convention -- browser fixture extension
    interface Window {
        finishDirectedResource: (value: string) => void;
        directedResourceCompletion: Promise<void>;
    }
}
