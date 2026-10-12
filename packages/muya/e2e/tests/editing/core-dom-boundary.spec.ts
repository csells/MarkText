import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const example of [
    { name: 'plain text', source: 'aa\n', afterX: 'xaa\n', afterY: 'xyaa\n', target: 0 },
    { name: 'a leading addition', source: '{++a++}a\n', afterX: 'x{++a++}a\n', afterY: 'xy{++a++}a\n', target: 0 },
]) {
    test(`Core native typing remains before ${example.name} across successive keys and history`, async ({ page }) => {
        await bootCore(page, example.source);
        try {
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read().actions[0])).toMatchObject({
                selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
                range: { start: example.target, end: example.target },
                accepted: true,
            });
            expect.soft(await readCore(page)).toMatchObject({ source: { source: example.afterX }, caret: 1 });
            await page.keyboard.type('y');
            expect.soft(await readCore(page)).toMatchObject({ source: { source: example.afterY }, caret: 2 });
            await coreHistory(page, 'undo');
            expect.soft(await readCore(page)).toMatchObject({ source: { source: example.source } });
            await coreHistory(page, 'redo');
            expect.soft(await readCore(page)).toMatchObject({ source: { source: example.afterY } });
            expect(await reopenCore(page)).toMatchObject({ source: example.afterY });
        } finally {
            await disposeCore(page);
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
        const state = await readCore(page);
        expect(state.actions).toHaveLength(2);
        expect.soft(state.actions[0]).toMatchObject({
            accepted: true,
            result: { source: { source: '(a{++b++}c)\n' }, anchor: 1, caret: 4, text: '(abc)' },
        });
        expect.soft(state).toMatchObject({ source: { source: '(x)\n' }, anchor: 2, caret: 2, text: '(x)' });
        await coreHistory(page, 'undo');
        expect.soft(await readCore(page)).toMatchObject({ source: { source: 'a{++b++}c\n' } });
        await coreHistory(page, 'redo');
        expect.soft(await readCore(page)).toMatchObject({ source: { source: '(x)\n' } });
        expect(await reopenCore(page)).toMatchObject({ source: '(x)\n' });
    } finally {
        await disposeCore(page);
    }
});

test('native select-all and continuous typing preserve the hidden comment without rejecting input', async ({ page }) => {
    const original = 'a{==mark==}{>>note<<}\n\nlast\n';
    await bootCore(page, original);
    try {
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type('hello');
        const state = await readCore(page);
        expect(state.actions).toHaveLength(5);
        expect(state.actions.every(action => action.accepted)).toBe(true);
        expect.soft(state.actions[0]).toMatchObject({ result: { source: { source: 'h{>>note<<}\n' }, anchor: 1, caret: 1, text: 'h' } });
        expect.soft(state).toMatchObject({ source: { source: 'hello{>>note<<}\n' }, anchor: 5, caret: 5, text: 'hello' });
        await coreHistory(page, 'undo');
        expect.soft(await readCore(page)).toMatchObject({ source: { source: original } });
        await coreHistory(page, 'redo');
        expect.soft(await readCore(page)).toMatchObject({ source: { source: 'hello{>>note<<}\n' } });
        expect(await reopenCore(page)).toMatchObject({ source: 'hello{>>note<<}\n' });
    } finally {
        await disposeCore(page);
    }
});
