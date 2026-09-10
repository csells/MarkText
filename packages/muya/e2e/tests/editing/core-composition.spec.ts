import { expect, test } from '../fixtures/muya';

// CDP exercises Chromium composition events; it does not operate an OS IME panel.
for (const example of [
    { name: 'plain repeated text', source: 'aaaa\n', start: 2, end: 3, modelStart: 2, modelEnd: 3, draft: 'aa日a', committed: 'aa日本a\n', next: 'aa日本xa\n', text: 'aa日本a', caret: 4 },
    { name: 'part of a repeated suggestion', source: 'a{++aa++}a\n', start: 2, end: 3, modelStart: 5, modelEnd: 6, draft: 'aa日a', committed: 'a{++a日本++}a\n', next: 'a{++a日本x++}a\n', text: 'aa日本a', caret: 4 },
    { name: 'a whole repeated suggestion', source: 'a{++a++}a\n', start: 1, end: 2, modelStart: 1, modelEnd: 5, draft: 'a日a', committed: 'a日本a\n', next: 'a日本xa\n', text: 'a日本a', caret: 3 },
]) {
    test(`Core composition commits ${example.name} before the next browser key`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(example.start, example.end);
        }, example);
        const cdp = await page.context().newCDPSession(page);
        try {
            await cdp.send('Input.imeSetComposition', { text: '日', selectionStart: 1, selectionEnd: 1 });
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source }, text: example.draft });
            await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
            await cdp.send('Input.insertText', { text: '日本' });
            const committed = await page.evaluate(() => window.coreBoundary.read());
            expect(committed).toMatchObject({ source: { source: example.committed }, text: example.text, anchor: example.caret, caret: example.caret });
            expect(committed.compositions).toEqual([{ selection: { ranges: [{ anchor: example.modelStart, focus: example.modelEnd }], primary: 0 }, range: { start: example.modelStart, end: example.modelEnd } }]);
            expect(committed.browserEvents.filter(event => event.type === 'compositionstart')).toEqual([{ type: 'compositionstart', trusted: true, data: 'a', composing: false }]);
            expect(committed.browserEvents.some(event => event.type === 'input' && event.trusted && event.composing)).toBe(true);
            // Chromium CDP emits an untrusted compositionend, as the installed-app harness also observes.
            expect(committed.browserEvents.filter(event => event.type === 'compositionend')).toEqual([{ type: 'compositionend', trusted: false, data: '日本', composing: false }]);
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: example.caret + 1, caret: example.caret + 1 });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.committed } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.committed });
            expect(errors).toEqual([]);
        }
        finally {
            await cdp.detach();
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const selected of [false, true]) {
    test(`Core Chromium composition cancellation restores ${selected ? 'selected text' : 'the caret'} before the next key`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.evaluate(async (selected) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, 'a{++aa++}a\n');
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(2, selected ? 3 : 2);
        }, selected);
        const cdp = await page.context().newCDPSession(page);
        try {
            await cdp.send('Input.imeSetComposition', { text: '日', selectionStart: 1, selectionEnd: 1 });
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'a{++aa++}a\n' }, text: selected ? 'aa日a' : 'aa日aa' });
            await page.keyboard.press('Escape');
            await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
            const cancelled = await page.evaluate(() => window.coreBoundary.read());
            expect.soft(cancelled).toMatchObject({ source: { source: 'a{++aa++}a\n' }, text: 'aaaa', anchor: 2, caret: selected ? 3 : 2 });
            expect(cancelled.compositions).toEqual([{ selection: { ranges: [{ anchor: 5, focus: selected ? 6 : 5 }], primary: 0 }, range: { start: 5, end: selected ? 6 : 5 } }]);
            expect(cancelled.browserEvents.filter(event => event.type === 'compositionend')).toEqual([{ type: 'compositionend', trusted: false, data: '', composing: false }]);
            await page.keyboard.type('x');
            const expected = selected ? 'a{++ax++}a\n' : 'a{++axa++}a\n';
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, anchor: 3, caret: 3 });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'a{++aa++}a\n' } });
            expect(errors).toEqual([]);
        }
        finally {
            await cdp.detach();
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}
