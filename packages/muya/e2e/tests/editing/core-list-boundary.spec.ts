import { expect, test } from '../fixtures/muya';

for (const example of [
    { name: 'ordinary first sibling', source: '- alpha\n- second\n', expected: 'alpha\n\n- second\n', typed: 'Xalpha\n\n- second\n', leaf: 0 },
    { name: 'ordinary middle sibling', source: '- first\n- alpha\n- final\n', expected: '- first\n\n  alpha\n- final\n', typed: '- first\n\n  Xalpha\n- final\n', leaf: 1 },
    { name: 'ordinary only item', source: '- alpha\n', expected: 'alpha\n', leaf: 0 },
    { name: 'first bullet sibling', source: '- a{++l++}pha{>>keep<<}\n- second\n', expected: 'a{++l++}pha{>>keep<<}\n\n- second\n', leaf: 0 },
    { name: 'middle bullet sibling', source: '- first\n- a{++l++}pha{>>keep<<}\n- final\n', expected: '- first\n\n  a{++l++}pha{>>keep<<}\n- final\n', leaf: 1 },
    { name: 'middle ordered sibling', source: '8) first\n9) a{++l++}pha{>>keep<<}\n10) final\n', expected: '8) first\n\n   a{++l++}pha{>>keep<<}\n9) final\n', leaf: 1 },
    { name: 'middle task sibling', source: '- [x] first\n- [ ] a{++l++}pha{>>keep<<}\n- [x] final\n', expected: '- [x] first\n\n  a{++l++}pha{>>keep<<}\n- [x] final\n', leaf: 1 },
    { name: 'nested first sibling', source: '- outer\n  - a{++l++}pha{>>keep<<}\n  - second\n- final\n', expected: '- outer\n\n  a{++l++}pha{>>keep<<}\n  - second\n- final\n', leaf: 1 },
    { name: 'multiline middle sibling', source: '- first\n- a{++l++}pha{>>keep<<}\n  continuation\n\n  second\n- final\n', expected: '- first\n\n  a{++l++}pha{>>keep<<}\n  continuation\n\n  second\n- final\n', leaf: 1 },
    { name: 'tracked middle sibling', source: '- first\n- a{++l++}pha{>>keep<<}\n- final\n', expected: '- first\n{~~- ~>\n  ~~}a{++l++}pha{>>keep<<}\n- final\n', typed: '- first\n{~~- ~>\n  ~~}{++X++}a{++l++}pha{>>keep<<}\n- final\n', leaf: 1, tracked: true },
    { name: 'tracked only item', source: '- alpha{>>keep<<}\n', expected: '{--- --}alpha{>>keep<<}\n', typed: '{--- --}{++X++}alpha{>>keep<<}\n', leaf: 0, tracked: true },
    { name: 'only task item', source: '- [x] a{++l++}pha{>>keep<<}\n', expected: 'a{++l++}pha{>>keep<<}\n', leaf: 0 },
    { name: 'only ordered item', source: '42) a{++l++}pha{>>keep<<}\n', expected: 'a{++l++}pha{>>keep<<}\n', leaf: 0 },
    { name: 'annotated only item', source: '- a{++l++}pha{>>keep<<}\n', expected: 'a{++l++}pha{>>keep<<}\n', leaf: 0 },
    { name: 'multiline item before another paragraph', source: '- a{++l++}pha{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n\nafter\n', expected: 'a{++l++}pha{>>keep<<}\n\n```js\nlet x = 1\n```\n\nafter\n', leaf: 0 },
    { name: 'nested only item', source: '- outer\n\n  - a{++l++}pha{>>keep<<}\n', expected: '- outer\n\n  a{++l++}pha{>>keep<<}\n', leaf: 1 },
    { name: 'compact nested only item', source: '- outer\n  - a{++l++}pha{>>keep<<}\n', expected: '- outer\n\n  a{++l++}pha{>>keep<<}\n', leaf: 1 },
    { name: 'list following a paragraph', source: 'before\n- a{++l++}pha{>>keep<<}\n', expected: 'before\n\na{++l++}pha{>>keep<<}\n', leaf: 1 },
    { name: 'quoted only item', source: '> - a{++l++}pha{>>keep<<}\n', expected: '> a{++l++}pha{>>keep<<}\n', leaf: 0 },
]) {
    test(`Core boundary Backspace unwraps the ${example.name} before the next key`, async ({ page }) => {
        await page.evaluate(async (example) => {
            const { source, leaf } = example;
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, 'tracked' in example && example.tracked === true);
            let block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            for (let index = 0; index < leaf; index++) block = block.nextContentInContext()!;
            block.setCursor(0, 0, true);
        }, example);
        try {
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('X');
            const typed = 'typed' in example ? example.typed! : example.expected.replace('a{++', 'Xa{++').replace(/^alpha/u, 'Xalpha');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 1, caret: 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: 0, caret: 0 });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}


test('upstream only-item Backspace unwraps before the next key', async ({ page }) => {
    await page.evaluate(() => {
        window.muya!.setContent('- alpha\n');
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 0, true);
    });
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => {
        window.muya!.flush();
        return { name: window.muya!.getState()[0]?.name, caret: window.muya!.getSelection()?.anchor.offset };
    })).toEqual({ name: 'paragraph', caret: 0 });
    await page.keyboard.type('X');
    expect(await page.evaluate(() => {
        window.muya!.flush();
        return { source: window.muya!.getMarkdown(), caret: window.muya!.getSelection()?.anchor.offset };
    })).toEqual({ source: 'Xalpha\n', caret: 1 });
});
