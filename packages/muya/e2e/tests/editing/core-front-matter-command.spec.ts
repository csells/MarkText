import { expect, test } from '../fixtures/muya';
import { editor, floats, quickInsertItem } from '../helpers/selectors';

const styles = [
    { style: '-', lang: 'yaml', open: '---', close: '---' },
    { style: '+', lang: 'toml', open: '+++', close: '+++' },
    { style: ';', lang: 'json', open: ';;;', close: ';;;' },
    { style: '{', lang: 'json', open: '{', close: '}' },
] as const;

for (const example of styles) {
    for (const ending of ['\n', '\r\n', '\r']) {
        for (const tracked of [false, true]) {
            test(`Format Front Matter preserves selected prose and owns rapid input (${example.style}, Track=${tracked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
                const source = 'body{>>keep<<}' + ending;
                const emptyFrontMatter = example.open + ending + ending + example.close + ending + ending;
                const typedFrontMatter = example.open + ending + 'xy' + ending + example.close + ending + ending;
                const inserted = (tracked ? '{++' + emptyFrontMatter + '++}' : emptyFrontMatter) + source;
                const typed = (tracked ? '{++' + typedFrontMatter + '++}' : typedFrontMatter) + source;
                const immediate = await page.evaluate(async ({ source, tracked, style }) => {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.muya!.setOptions({ frontmatterType: style });
                    window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                    window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 3, true);
                    window.muya!.updateParagraph('front-matter');
                    return { ...window.coreBoundary.read(), state: window.muya!.getState() };
                }, { source, tracked, style: example.style });
                try {
                    expect(immediate).toMatchObject({ source: { source: inserted }, anchor: 0, caret: 0, legacyCalls: [], state: [{ name: 'frontmatter', meta: { lang: example.lang, style: example.style } }, { name: 'paragraph', text: 'body' }] });
                    // No timer, acknowledgement barrier or selection repair between the command and trusted input.
                    await page.keyboard.type('xy');
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 2, caret: 2, legacyCalls: [] });
                    await expect(page.locator(editor.frontmatter)).toHaveCount(1);
                    await expect(page.locator(editor.frontmatter)).toContainText('xy');
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: inserted }, anchor: 0, caret: 0 });
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 1, caret: 3 });
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                    await page.evaluate(() => window.coreBoundary.history('redo'));
                    await page.evaluate(() => window.coreBoundary.history('redo'));
                    expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 2, caret: 2, legacyCalls: [] });
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
                } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
            });
        }
    }
}

for (const example of [
    ...styles.map(style => ({ ...style, trigger: '/front' })),
    { ...styles[0], trigger: '{>>inside<<}/front' },
]) {
    for (const tracked of [false, true]) {
        test(`Quick Insert Front Matter consumes its trigger before rapid input (${example.style}, trigger=${example.trigger}, Track=${tracked})`, async ({ page }) => {
            const source = example.trigger + '\n\noutside{>>keep<<}\n';
            const emptyFrontMatter = example.open + '\n\n' + example.close + '\n\n';
            const typedFrontMatter = example.open + '\nxy\n' + example.close + '\n\n';
            const tail = '\n\noutside{>>keep<<}\n';
            const inserted = (tracked ? '{~~' + example.trigger + '~>' + emptyFrontMatter + '~~}' : emptyFrontMatter) + tail;
            const typed = (tracked ? '{~~' + example.trigger + '~>' + typedFrontMatter + '~~}' : typedFrontMatter) + tail;
            await page.evaluate(async ({ source, style, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.muya!.setOptions({ frontmatterType: style });
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(block.text.length, block.text.length, true);
                window.muya!.eventCenter.emit('content-change', { block });
            }, { source, style: example.style, tracked });
            try {
                await expect(page.locator(floats.quickInsert)).toBeVisible();
                await page.locator(quickInsertItem('frontmatter')).click();
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: inserted }, anchor: 0, caret: 0, legacyCalls: [] });
                await page.keyboard.type('xy');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 2, caret: 2, legacyCalls: [] });
                await expect(page.locator(editor.frontmatter)).toHaveCount(1);
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: inserted }, anchor: 0, caret: 0 });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 6, caret: 6 });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}

for (const example of styles) {
    test(`Format Front Matter preserves the existing style and selection after a preference change (${example.style})`, async ({ page }) => {
        const source = [example.open, 'key: value', example.close, '', 'body{>>keep<<}', ''].join('\n');
        const typed = [example.open, 'key: value', example.close, '', 'bxyy{>>keep<<}', ''].join('\n');
        const immediate = await page.evaluate(async ({ source, style }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            window.muya!.editor.scrollPage!.lastContentInDescendant()!.setCursor(1, 3, true);
            window.muya!.setOptions({ frontmatterType: style === '-' ? '+' : '-' });
            window.muya!.updateParagraph('front-matter');
            return { ...window.coreBoundary.read(), state: window.muya!.getState() };
        }, { source, style: example.style });
        try {
            expect(immediate).toMatchObject({ source: { source }, anchor: 1, caret: 3, legacyCalls: [], state: [{ name: 'frontmatter', meta: { lang: example.lang, style: example.style } }, { name: 'paragraph', text: 'body' }] });
            await page.keyboard.type('xy');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 3, caret: 3, legacyCalls: [] });
            await expect(page.locator(editor.frontmatter)).toHaveCount(1);
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 1, caret: 3 });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
