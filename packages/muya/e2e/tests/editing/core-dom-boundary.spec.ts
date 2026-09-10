import { expect, test } from '../fixtures/muya';

for (const example of [
    { name: 'plain text', source: 'aa\n', afterX: 'xaa\n', afterY: 'xyaa\n', target: 0 },
    { name: 'a leading addition', source: '{++a++}a\n', afterX: 'x{++a++}a\n', afterY: 'xy{++a++}a\n', target: 3 },
]) {
    test(`Core native typing remains before ${example.name} across successive keys and history`, async ({ page }) => {
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        }, example.source);
        try {
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read().actions[0])).toMatchObject({
                selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
                range: { start: example.target, end: example.target },
                accepted: true,
            });
            expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.afterX }, caret: 1 });
            await page.keyboard.type('y');
            expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.afterY }, caret: 2 });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.afterY } });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.afterY });
        } finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('selected suggestion wraps before the next native key replaces the selected payload', async ({ page }) => {
    await page.evaluate(async () => {
        window.__e2e!.rebuildMuya({ autoPairBracket: true });
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, 'a{++b++}c\n');
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 3);
    });
    try {
        // No wait or artificial event: the first action must install its selection
        // synchronously before Chromium delivers the following character.
        await page.keyboard.type('(x');
        const state = await page.evaluate(() => window.coreBoundary.read());
        expect(state.actions).toHaveLength(2);
        expect.soft(state.actions[0]).toMatchObject({
            accepted: true,
            result: { source: { source: '(a{++b++}c)\n' }, anchor: 1, caret: 4, text: '(abc)' },
        });
        expect.soft(state).toMatchObject({ source: { source: '(x)\n' }, anchor: 2, caret: 2, text: '(x)' });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'a{++b++}c\n' } });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '(x)\n' } });
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '(x)\n' });
    } finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

test('native select-all and continuous typing preserve the hidden comment without rejecting input', async ({ page }) => {
    const original = 'a{==mark==}{>>note<<}\n\nlast\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, original);
    try {
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type('hello');
        const state = await page.evaluate(() => window.coreBoundary.read());
        expect(state.actions).toHaveLength(5);
        expect(state.actions.every(action => action.accepted)).toBe(true);
        expect.soft(state.actions[0]).toMatchObject({ result: { source: { source: 'h{>>note<<}\n' }, anchor: 1, caret: 1, text: 'h' } });
        expect.soft(state).toMatchObject({ source: { source: 'hello{>>note<<}\n' }, anchor: 5, caret: 5, text: 'hello' });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: original } });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'hello{>>note<<}\n' } });
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'hello{>>note<<}\n' });
    } finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});
