import { expect, test } from '../fixtures/muya';
import { floats } from '../helpers/selectors';

for (const example of [
    { name: 'menu conversion', command: 'ol-order', source: '- a{++l++}pha{>>keep<<}\n- alpha\n', expected: '1. a{++l++}pha{>>keep<<}\n2. alpha\n' },
    { name: 'front-menu conversion', command: 'front', source: '- a{++l++}pha{>>keep<<}\n- alpha\n', expected: '1. a{++l++}pha{>>keep<<}\n2. alpha\n' },
    { name: 'loose-list toggle', command: 'loose-list-item', source: '- a{++l++}pha{>>keep<<}\n- alpha\n', expected: '- a{++l++}pha{>>keep<<}\n\n- alpha\n' },
    { name: 'reset to paragraphs', command: 'reset-to-paragraph', source: '- a{++l++}pha{>>keep<<}\n- alpha\n', expected: 'a{++l++}pha{>>keep<<}\n\nalpha\n' },
    { name: 'active list toggle', command: 'ul-bullet', source: '- a{++l++}pha{>>keep<<}\n- alpha\n', expected: 'a{++l++}pha{>>keep<<}\n\nalpha\n' },
]) {
    test(`${example.name} retains the second identical item for the next key`, async ({ page }) => {
        await page.evaluate(async ({ source, command }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            const muya = window.muya!;
            window.coreBoundary = control.bootCoreBoundary(muya, source);
            const first = muya.editor.scrollPage!.firstContentInDescendant()!;
            const second = first.nextContentInContext()!;
            second.setCursor(1, 1, true);
            muya.focus();
            if (command === 'front') {
                muya.eventCenter.emit('muya-front-menu', { reference: first.domNode, block: first.outMostBlock });
            }
            else muya.updateParagraph(command);
        }, example);
        try {
            if (example.command === 'front') await page.locator(`${floats.paragraphFrontMenu} .turn-into-item.order-list`).click();
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, legacyCalls: [] });
            expect(await page.evaluate(() => {
                const selected = window.muya!.getSelection()!;
                return { anchor: selected.anchor.offset, focus: selected.focus.offset, text: selected.anchor.block.text };
            })).toEqual({ anchor: 1, focus: 1, text: 'alpha' });
            await page.keyboard.type('X');
            const typed = example.expected.replace('alpha\n', 'aXlpha\n');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

test('tracked multiline list conversion uses its resulting selection for the next input in the same task', async ({ page }) => {
    const source = '- {++first++}{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n- second\n';
    const converted = '{~~- ~>1. ~~}{++first++}{>>keep<<}\n\n{~~  ~>   ~~}```js\n{~~  ~>   ~~}let x = 1\n{~~  ~>   ~~}```\n{~~- ~>2. ~~}second\n';
    const typed = '{~~- ~>1. ~~}{++Xfirst++}{>>keep<<}\n\n{~~  ~>   ~~}```js\n{~~  ~>   ~~}let x = 1\n{~~  ~>   ~~}```\n{~~- ~>2. ~~}second\n';
    const immediate = await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        const muya = window.muya!;
        window.coreBoundary = control.bootCoreBoundary(muya, source, true);
        muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 0, true);
        muya.focus();
        muya.updateParagraph('ol-order');
        const afterCommand = window.coreBoundary.read();
        // No reselection and no acknowledgement wait: the model's resulting
        // selection must govern this actual beforeinput listener immediately.
        const liveTarget = muya.editor.selection.getSelection()?.anchor.block.domNode;
        if (!liveTarget?.isConnected) throw new Error('The resulting browser selection is not live');
        liveTarget.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'X', bubbles: true, cancelable: true }));
        return { afterCommand, afterInput: window.coreBoundary.read() };
    }, source);
    try {
        expect(immediate.afterCommand).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0, legacyCalls: [] });
        expect(immediate.afterInput).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
        await page.keyboard.type('Y');
        const following = typed.replace('{++Xfirst++}', '{++XYfirst++}');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: following }, anchor: 2, caret: 2, legacyCalls: [], browserEvents: expect.arrayContaining([expect.objectContaining({ type: 'beforeinput', trusted: true, data: 'Y' })]) });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0 });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 0, caret: 0 });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0 });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: following });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

test('unlisting a fenced item installs the model paragraphs before the next key', async ({ page }) => {
    const source = '- {++first++}{>>keep<<}\n\n  ```js\n  const x = 1\n  ```\n- second\n';
    const converted = '{++first++}{>>keep<<}\n\n```js\nconst x = 1\n```\n\nsecond\n';
    const afterCommand = await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        const muya = window.muya!;
        window.coreBoundary = control.bootCoreBoundary(muya, source);
        muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 0, true);
        muya.updateParagraph('ul-bullet');
        return window.coreBoundary.read();
    }, source);
    try {
        expect(afterCommand).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0, legacyCalls: [] });
        expect(await page.evaluate(() => window.muya!.domNode.querySelectorAll('ul li, ol li').length)).toBe(0);
        await page.keyboard.type('X');
        const typed = converted.replace('{++first++}', '{++Xfirst++}');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: converted }, anchor: 0, caret: 0 });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: converted });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
