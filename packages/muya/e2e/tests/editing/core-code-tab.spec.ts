import { expect, test } from '../fixtures/muya';

for (const example of [
    { language: 'js', body: 'ab', before: 1, after: 5, focus: 5, tabbed: 'a    b', typed: 'a    xb' },
    { language: 'html title="x"', body: 'div tail', before: 3, after: 5, focus: 5, tabbed: '<div></div> tail', typed: '<div>x</div> tail' },
    { language: 'html', body: 'input tail', before: 5, after: 13, focus: 17, tabbed: '<input type="text"> tail', typed: '<input type="x"> tail' },
]) {
    for (const { tracked, wrapped, ending } of [{ tracked: false, wrapped: false, ending: '\n' }, { tracked: true, wrapped: true, ending: '\n' }, { tracked: true, wrapped: false, ending: '\r' }]) {
        test(`Code Tab determines the next trusted input (${example.language}, Track=${tracked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const wrap = (body: string) => {
                const literal = '```' + example.language + ending + body + ending + '```';
                const original = '```' + example.language + ending + example.body + ending + '```';
                const replacing = tracked && !wrapped && body !== example.body;
                const marked = wrapped ? '{++' + literal + '++}' : replacing ? '{~~' + original + ending + '~>' + literal + ending + '~~}' : literal;
                return marked + (replacing ? '' : ending) + ending + 'outside{>>keep<<}' + ending;
            };
            const source = wrap(example.body);
            await page.evaluate(async ({ source, tracked, before }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                let block = window.muya!.editor.scrollPage!.firstContentInDescendant();
                while (block && block.blockName !== 'codeblock.content') block = block.nextContentInContext() ?? null;
                if (!block) throw new Error('Expected code body');
                block.setCursor(before, before, true);
            }, { source, tracked, before: example.before });
            try {
                await page.keyboard.press('Tab');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: wrap(example.tabbed) }, anchor: example.after, caret: example.focus, legacyCalls: [] });
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: wrap(example.typed) }, anchor: example.after + 1, caret: example.after + 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: wrap(example.tabbed) } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: wrap(example.typed) });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
