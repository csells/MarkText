import { expect, test } from '../fixtures/muya';
import { coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';
import { separateUndoSteps } from '../helpers/undoWindow';

test.beforeEach(async ({ page }) => separateUndoSteps(page));

for (const example of [
    { name: 'math', source: '$$\na\n$$\n\nb{++c++}d\n', joined: '$$\nab{++c++}d\n$$\n', typed: '$$\naxb{++c++}d\n$$\n', caret: 1 },
    { name: 'diagram', source: '```mermaid\ngraph TD\nA-->B\n%% a\n```\n\nb{++c++}d\n', joined: '```mermaid\ngraph TD\nA-->B\n%% ab{++c++}d\n```\n', typed: '```mermaid\ngraph TD\nA-->B\n%% axb{++c++}d\n```\n', caret: 19 },
    { name: 'front matter', source: '---\na\n---\n\nb{++c++}d\n', joined: '---\nab{++c++}d\n---\n', typed: '---\naxb{++c++}d\n---\n', caret: 1 },
    { name: 'HTML', source: '<div>a</div>\n\nb{++c++}d\n', joined: '<div>a</div>b{++c++}d\n', typed: '<div>a</div>xb{++c++}d\n', caret: 12 },
    // A join into a table cell writes only the joined bytes (ADR 0007).
    { name: 'table', source: '| h |\n|---|\n| a |\n\nb{++c++}d\n', joined: '| h |\n|---|\n| ab{++c++}d |\n', typed: '| h |\n|---|\n| axb{++c++}d |\n', caret: 1 },
    { name: 'table with multiple lines', source: '| h |\n|---|\n| a |\n\nb{++c++}d\nnext\n', donor: 'bcd\nnext', joined: '| h |\n|---|\n| ab{++c++}d<br/>next |\n', typed: '| h |\n|---|\n| axb{++c++}d<br/>next |\n', caret: 1 },
    { name: 'quote boundary', source: '> b{++c++}d\n>\n> tail\n', joined: 'b{++c++}d\n\n> tail\n', typed: 'xb{++c++}d\n\n> tail\n', caret: 0 },
    { name: 'thematic break', source: '***\n\nb{++c++}d\n', joined: '***b{++c++}d\n', typed: '***xb{++c++}d\n', caret: 3 },
]) {
    test(`native paragraph Backspace into ${example.name} uses the shared model before the next key`, async ({ page }) => {
        const suffix = '\noutside{>>keep<<}\n';
        const source = example.source + suffix;
        const joined = example.joined + suffix;
        const typed = example.typed + suffix;
        await page.evaluate(async ({ source, donor }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            let paragraph = window.muya!.editor.scrollPage!.firstContentInDescendant();
            while (paragraph && paragraph.text !== donor) paragraph = paragraph.nextContentInContext() ?? null;
            if (!paragraph) throw new Error('Missing donor paragraph');
            paragraph.setCursor(0, 0, true);
        }, { source, donor: example.donor ?? 'bcd' });
        try {
            if (example.name === 'diagram') await expect(page.locator('.mu-diagram-preview svg')).toBeVisible({ timeout: 15000 });
            await page.keyboard.press('Backspace');
            expect(await readCore(page)).toMatchObject({ source: { source: joined }, caret: example.caret, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await readCore(page)).toMatchObject({ source: { source: typed }, caret: example.caret + 1, legacyCalls: [] });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: joined } });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source } });
            if (example.name === 'diagram') await expect(page.locator('.mu-diagram-preview svg')).toBeVisible({ timeout: 15000 });
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: typed });
            if (example.name === 'diagram') {
                await page.evaluate(async (source) => {
                    window.coreBoundary.dispose();
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                }, typed);
                await expect(page.locator('.mu-diagram-preview svg')).toBeVisible({ timeout: 15000 });
            }
        }
        finally { await disposeCore(page); }
    });
}
