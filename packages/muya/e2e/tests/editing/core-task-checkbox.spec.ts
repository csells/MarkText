import { expect, test } from '../fixtures/muya';

const cases = [
    {
        name: 'parent cascade', target: 0, autoCheck: true, autoMove: false,
        source: '- [ ] {++parent++}{>>note<<}\n\n  - [ ] same\n  - [ ] same\n',
        expected: '- [x] {++parent++}{>>note<<}\n\n  - [x] same\n  - [x] same\n',
        tracked: '- [{~~ ~>x~~}] {++parent++}{>>note<<}\n\n  - [{~~ ~>x~~}] same\n  - [{~~ ~>x~~}] same\n',
        flags: [true, true, true], trackedFlags: [true, true, true], needle: '{++parent++}', replacement: '{++Xparent++}',
    },
    {
        name: 'checked task moves forward', target: 0, autoCheck: false, autoMove: true,
        source: '- [ ] {++same++}{>>first<<}\n- [ ] same{>>second<<}\n- [x] final\n',
        expected: '- [ ] same{>>second<<}\n- [x] {++same++}{>>first<<}\n- [x] final\n',
        tracked: '{~~- [ ] {++same++}{>>first<<}~>- [ ] same{>>second<<}~~}\n{~~- [ ] same{>>second<<}~>- [x] {++same++}{>>first<<}~~}\n- [x] final\n',
        flags: [false, true, true], trackedFlags: [false, false, false, true, true], needle: '{++same++}', replacement: '{++Xsame++}',
    },
    {
        name: 'nested task moves backward and derives parent', target: 2, autoCheck: true, autoMove: true,
        source: '- [x] parent{>>p<<}\n\n  - [x] {++same++}{>>first<<}\n  - [x] same{>>second<<}\n',
        expected: '- [ ] parent{>>p<<}\n\n  - [ ] same{>>second<<}\n  - [x] {++same++}{>>first<<}\n',
        tracked: '- [{~~x~> ~~}] parent{>>p<<}\n\n  {~~- [x] {++same++}{>>first<<}~>- [ ] same{>>second<<}~~}\n  {~~- [x] same{>>second<<}~>- [x] {++same++}{>>first<<}~~}\n',
        flags: [false, false, true], trackedFlags: [false, true, false, true, true], needle: '- [ ] same', replacement: '- [ ] Xsame',
    },
];

for (const example of cases) {
    for (const tracked of [false, true]) {
        test(`Core checkbox ${example.name} owns the next key (tracked=${tracked})`, async ({ page }) => {
            await page.evaluate(async ({ example, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source, tracked);
                window.muya!.setOptions({ autoCheck: example.autoCheck, autoMoveCheckedToEnd: example.autoMove });
            }, { example, tracked });
            const expected = tracked ? example.tracked : example.expected;
            try {
                await page.locator('.mu-task-list-checkbox').nth(example.target).click();
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, anchor: 0, caret: 0, legacyCalls: [] });
                expect(await page.locator('.mu-task-list-checkbox').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual(tracked ? example.trackedFlags : example.flags);
                await page.keyboard.type('X');
                const at = expected.lastIndexOf(example.needle);
                const next = expected.slice(0, at) + example.replacement + expected.slice(at + example.needle.length);
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: next }, anchor: 1, caret: 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: next });
            }
            finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
