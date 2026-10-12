import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const source of ['text[^fresh]\n', 't{++ext++}[^fresh]{>>keep<<}\n', 'text[^fr{++esh++}]{>>keep<<}\n']) {
    test(`footnote Create enters the common stack (${source.includes('{++') ? source.includes('[^fr{') ? 'CM label' : 'CM' : 'plain'})`, async ({ page }) => {
        await bootCore(page, source, { options: { footnotes: true } });
        try {
            await expect(page.locator('#noteref-fresh')).toHaveCount(1);
            await page.locator('#noteref-fresh').click();
            await page.locator('.mu-footnote-tool a.btn').click();
            expect(await readCore(page)).toMatchObject({ source: { source: `${source}\n[^fresh]: ` }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('x');
            const typed = `${source}\n[^fresh]: x`;
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

for (const math of ['$$\nx+y\n$$', '{++$$\nx+y\n$$++}']) {
    test(`preview Delete owns its paragraph and next key (${math.includes('{++') ? 'CM' : 'plain'})`, async ({ page }) => {
        const source = `first{>>keep<<}\n\n${math}\n\nlast\n`;
        await bootCore(page, source, { cursor: [2, 2, true] });
        try {
            await page.locator('.mu-math-preview').hover();
            await page.locator('.mu-preview-tools li.delete').click();
            expect(await readCore(page)).toMatchObject({ source: { source: 'first{>>keep<<}\n\n\n\nlast\n' }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('x');
            const typed = 'first{>>keep<<}\n\nx\n\nlast\n';
            expect(await readCore(page)).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
            await coreHistory(page, 'undo');
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source }, anchor: 2, caret: 2 });
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: typed });
        }
        finally { await disposeCore(page); }
    });
}

for (const example of [
    { label: 'duplicate', source: 'same\n\nsame\n\nlast\n', changed: 'same\n\nsame\n\nsame\n\nlast\n', typed: 'same\n\nsame\n\nxsame\n\nlast\n' },
    { label: 'duplicate', source: 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n', changed: 'same\n\ns{++a++}me{>>keep<<}\n\ns{++a++}me{>>keep<<}\n\nlast\n', typed: 'same\n\ns{++a++}me{>>keep<<}\n\nxs{++a++}me{>>keep<<}\n\nlast\n' },
    { label: 'new', source: 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n', changed: 'same\n\ns{++a++}me{>>keep<<}\n\n\n\nlast\n', typed: 'same\n\ns{++a++}me{>>keep<<}\n\nx\n\nlast\n' },
    { label: 'delete', source: 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n', changed: 'same\n\nlast\n', typed: 'xsame\n\nlast\n' },
]) {
    test(`front menu ${example.label} owns its next key (${example.source.includes('{++') ? 'CM' : 'plain'})`, async ({ page }) => {
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            const muya = window.muya!;
            window.coreBoundary = control.bootCoreBoundary(muya, source);
            const content = muya.editor.scrollPage!.queryBlock([1, 'text']);
            if (!content?.isContent()) throw new Error('Expected second paragraph');
            content.setCursor(2, 2, true);
            muya.eventCenter.emit('muya-front-menu', { reference: content.domNode, block: content.outMostBlock });
        }, example.source);
        try {
            await page.locator(`.mu-front-menu .item.${example.label}`).click();
            expect(await readCore(page)).toMatchObject({ source: { source: example.changed }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await readCore(page)).toMatchObject({ source: { source: example.typed }, anchor: 1, caret: 1, legacyCalls: [] });
            await coreHistory(page, 'undo');
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: example.source } });
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: example.typed });
        }
        finally { await disposeCore(page); }
    });
}

for (const tracked of [false, true]) {
    test(`math reset owns selection before trusted typing (Track=${tracked})`, async ({ page }) => {
        const source = '$$\nx+y\n$$\n';
        const changed = tracked ? '{~~$$\nx+y\n$$~>x+y~~}\n' : 'x+y\n';
        const typed = tracked ? '{~~$$\nx+y\n$$~>x+yx~~}\n' : 'x+yx\n';
        await page.evaluate(async ({ source, tracked }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 1, true);
            window.muya!.updateParagraph('reset-to-paragraph');
        }, { source, tracked });
        try {
            expect(await readCore(page)).toMatchObject({ source: { source: changed }, anchor: 3, caret: 3, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await readCore(page)).toMatchObject({ source: { source: typed }, anchor: 4, caret: 4, legacyCalls: [] });
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

test('heading Backspace preserves suggestions before trusted typing', async ({ page }) => {
    const source = '# s{++a++}me{>>keep<<}\n';
    await bootCore(page, source, { cursor: [0, 0, true] });
    try {
        await page.keyboard.press('Backspace');
        expect(await readCore(page)).toMatchObject({ source: { source: 's{++a++}me{>>keep<<}\n' }, anchor: 0, caret: 0, legacyCalls: [] });
        await page.keyboard.type('x');
        expect(await readCore(page)).toMatchObject({ source: { source: 'xs{++a++}me{>>keep<<}\n' }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        await coreHistory(page, 'undo');
        expect(await reopenCore(page)).toMatchObject({ source });
    }
    finally { await disposeCore(page); }
});
