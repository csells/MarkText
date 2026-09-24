import { expect, test } from '../fixtures/muya';

for (const bound of [false, true]) {
    for (const fixture of [
        { name: 'code', source: '```md\na{++a++}a\n```\n', replace: false },
        { name: 'math', source: '$$\na{++a++}a\n$$\n', replace: false },
        { name: 'html', source: '<div>a{++a++}a</div>\n', replace: false },
        { name: 'empty heading', source: '# \n', replace: true },
        { name: 'heading with a comment', source: '# {>>keep<<}\n', replace: false },
        { name: 'focused dimension input', source: bound ? 'a{++a++}a\n' : 'aaa\n', replace: false },
    ]) {
        test(`table creation uses the ${fixture.name} command context (Core=${bound})`, async ({ page }) => {
            const table = '|     |     |\n| --- | --- |\n|     |     |\n';
            const prefix = fixture.replace ? '' : `${fixture.source.slice(0, -1)}\n\n`;
            const created = prefix + table;
            await page.evaluate(async ({ source, bound, focusInput }) => {
                const muya = window.muya!;
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(muya, source);
                }
                else { muya.setContent(source); }
                muya.focus();
                const content = muya.editor.scrollPage!.firstContentInDescendant()!;
                content.setCursor(Math.min(1, content.text.length), Math.min(1, content.text.length), true);
                if (focusInput) {
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.value = '2';
                    document.body.appendChild(input);
                    input.focus();
                }
                muya.createTable({ rows: 2, columns: 2 });
            }, { source: fixture.source, bound, focusInput: fixture.name === 'focused dimension input' });
            try {
                const read = () => page.evaluate((bound) => {
                    window.muya!.flush();
                    return bound ? window.coreBoundary.reopen().source : window.muya!.getMarkdown();
                }, bound);
                expect(await read()).toBe(created);
                expect(await page.evaluate(() => {
                    const selection = window.muya!.getSelection();
                    return { offset: selection?.focus.offset, column: selection?.focus.block.domNode?.closest('td')?.cellIndex };
                })).toEqual({ offset: 0, column: 0 });
                await page.keyboard.type('X');
                const edited = `${prefix}| X   |     |\n| --- | --- |\n|     |     |\n`;
                expect(await read()).toBe(edited);
                // Upstream History groups the table with the key typed within
                // its one-second window; a bound document keeps them apart.
                for (const expected of bound ? [created, fixture.source] : [fixture.source]) {
                    await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('undo'); else window.muya!.undo(); }, bound);
                    expect(await read()).toBe(expected);
                }
                await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('redo'); else window.muya!.redo(); }, bound);
                expect(await read()).toBe(bound ? created : edited);
                if (bound)
                    expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
            }
            finally {
                if (bound)
                    await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}
