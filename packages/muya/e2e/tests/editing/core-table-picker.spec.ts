import { expect, test } from '../fixtures/muya';
import { editor, floats, quickInsertItem, tablePickerCell } from '../helpers/selectors';

for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
    test(`grid picker consumes the owned trigger and selects its first cell (Core=${bound}, Track=${tracked})`, async ({ page }) => {
        const source = bound ? '/ta{++b++}l\n\noutside{>>keep<<}\n' : '/tabl\n\noutside\n';
        const query = bound ? `/ta{++b++}l${tracked ? '{++e++}' : 'e'}` : '/table';
        const tail = bound ? '\n\noutside{>>keep<<}\n' : '\n\noutside\n';
        const table = '|     |     |\n| --- | --- |\n|     |     |';
        const created = (tracked ? `{~~${query}~>${table}~~}` : table) + tail;
        const edited = (tracked ? `{~~${query}~>|     X|     |\n| --- | --- |\n|     |     |~~}` : (bound ? '|     X|     |\n| --- | --- |\n|     |     |' : '| X   |     |\n| --- | --- |\n|     |     |')) + tail;
        await page.evaluate(async ({ source, bound, tracked }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
            }
            else { window.muya!.setContent(source); }
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(5, 5, true);
            window.muya!.focus();
        }, { source, bound, tracked });
        try {
            await page.keyboard.type('e');
            await expect(page.locator(floats.quickInsert)).toBeVisible();
            await page.locator(quickInsertItem('table')).click();
            await expect(page.locator(floats.tablePicker)).toBeVisible();
            const choice = page.locator(tablePickerCell(1, 1));
            await choice.hover();
            await choice.click();
            const read = () => page.evaluate((bound) => {
                window.muya!.flush();
                return bound ? window.coreBoundary.reopen().source : window.muya!.getMarkdown();
            }, bound);
            expect(await read()).toBe(created);
            expect(await page.evaluate(() => {
                const selection = window.muya!.getSelection();
                return { offset: selection?.anchor.offset, column: selection?.anchor.block.domNode?.closest('td')?.cellIndex };
            })).toEqual({ offset: 0, column: 0 });
            await expect(page.locator(editor.table).last().locator('tr')).toHaveCount(2);
            await page.keyboard.type('X');
            expect(await read()).toBe(edited);
            for (const expected of [created, query + tail]) {
                await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('undo'); else window.muya!.undo(); }, bound);
                expect(await read()).toBe(expected);
            }
            for (const expected of [created, edited]) {
                await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('redo'); else window.muya!.redo(); }, bound);
                expect(await read()).toBe(expected);
            }
            if (bound)
                expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
        }
        finally {
            if (bound)
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const bound of [false, true]) {
    for (const placement of ['empty', 'paragraph', 'heading', 'list'] as const) {
        test(`table creation retains the native ${placement} boundary (Core=${bound})`, async ({ page }) => {
            const text = bound ? 'a{++a++}a' : 'aaa';
            const source = placement === 'empty' ? '\n' : `${(placement === 'heading' ? '# ' : placement === 'list' ? '- ' : '') + text}\n`;
            const prefix = placement === 'empty' ? '' : `${source.slice(0, -1)}\n\n`;
            const indent = placement === 'list' ? '  ' : '';
            const table = `${indent}|     |     |\n${indent}| --- | --- |\n${indent}|     |     |\n`;
            const created = prefix + table;
            const edited = `${prefix}${indent}${bound ? '|     X|' : '| X   |'}     |\n${indent}| --- | --- |\n${indent}|     |     |\n`;
            await page.evaluate(async ({ source, bound }) => {
                const muya = window.muya!;
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(muya, source);
                }
                else { muya.setContent(source); }
                const content = muya.editor.scrollPage!.firstContentInDescendant()!;
                content.setCursor(Math.min(2, content.text.length), Math.min(2, content.text.length), true);
                muya.focus();
                muya.createTable({ rows: 2, columns: 2 });
            }, { source, bound });
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
                expect(await read()).toBe(edited);
                for (const expected of [created, source]) {
                    await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('undo'); else window.muya!.undo(); }, bound);
                    expect(await read()).toBe(expected);
                }
                for (const expected of [created, edited]) {
                    await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('redo'); else window.muya!.redo(); }, bound);
                    expect(await read()).toBe(expected);
                }
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
