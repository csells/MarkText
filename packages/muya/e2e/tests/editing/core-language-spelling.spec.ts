import { expect, test } from '../fixtures/muya';
import { coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const source of ['```js\ncode\n```\n', '{++```js\ncode\n```++}\n', '~~~js\n']) {
    test(`language picker commits before the next trusted input: ${JSON.stringify(source)}`, async ({ page }) => {
        const changed = source === '~~~js\n' ? '~~~javascript\n\n~~~\n' : source.replace('js\n', 'javascript\n');
        const typed = changed.replace('javascript\n', 'javascript\nx');
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            const muya = window.muya!;
            window.coreBoundary = control.bootCoreBoundary(muya, source);
            const content = muya.editor.scrollPage!.firstContentInDescendant()!;
            content.setCursor(content.text.length, content.text.length, true);
            muya.eventCenter.emit('content-change', { block: content });
        }, source);
        try {
            await page.locator('.mu-list-picker [data-label="javascript"]').click();
            expect(await readCore(page)).toMatchObject({ source: { source: changed }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await readCore(page)).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
            await coreHistory(page, 'undo');
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source } });
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: typed });
        }
        finally { await disposeCore(page); }
    });
}

for (const tracked of [false, true]) {
    test(`native spelling command precedes trusted input (Track=${tracked})`, async ({ page }) => {
        const source = 'teh {++teh++} teh{>>keep<<}\n';
        const corrected = tracked ? 'teh {++teh++} {~~teh~>the~~}{>>keep<<}\n' : 'teh {++teh++} the{>>keep<<}\n';
        const typed = tracked ? 'teh {++teh++} {~~teh~>thex~~}{>>keep<<}\n' : 'teh {++teh++} thex{>>keep<<}\n';
        await page.evaluate(async ({ source, tracked }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            const muya = window.muya!;
            window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
            const content = muya.editor.scrollPage!.firstContentInDescendant()!;
            const from = content.text.lastIndexOf('teh');
            content.setCursor(from, from + 3, true);
            muya.replaceCurrentWordInlineUnsafe('teh', 'the');
        }, { source, tracked });
        try {
            expect(await readCore(page)).toMatchObject({ source: { source: corrected }, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await readCore(page)).toMatchObject({ source: { source: typed }, legacyCalls: [] });
            await coreHistory(page, 'undo');
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source } });
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: typed });
        }
        finally { await disposeCore(page); }
    });
}

test('native image insertion retains selected CM and the next trusted key follows the image', async ({ page }) => {
    const source = 'same s{++am++}e{>>keep<<}\n';
    const changed = 'same ![s{++am++}e](images/cat.png){>>keep<<}\n';
    const typed = 'same ![s{++am++}e](images/cat.png)x{>>keep<<}\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        const muya = window.muya!;
        window.coreBoundary = control.bootCoreBoundary(muya, source);
        muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(5, 9, true);
        muya.insertImage({ src: 'images/cat.png' });
    }, source);
    try {
        expect(await readCore(page)).toMatchObject({ source: { source: changed }, legacyCalls: [] });
        await page.keyboard.type('x');
        expect(await readCore(page)).toMatchObject({ source: { source: typed }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source } });
        await coreHistory(page, 'redo');
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: typed });
    }
    finally { await disposeCore(page); }
});
