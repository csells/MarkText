import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const example of [
    { name: 'inline annotation', source: 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n', moved: 'same\n\nlast\n\ns{++a++}me{>>keep<<}\n', typed: 'same\n\nlast\n\ns{++a++}X{>>keep<<}\n' },
    { name: 'shared annotation', source: 'same\n\n{++s{==a==}me\n\nkeep++}\n\nlast\n', moved: 'same\n\n{++keep++}\n\nlast\n\n{++s{==a==}me++}\n', typed: 'same\n\n{++keep++}\n\nlast\n\n{++s{==a==}X++}\n' },
]) {
test(`native drag moves ${example.name} before trusted replacement and history`, async ({ page }) => {
    const { source, moved, typed } = example;
    await bootCore(page, source, {
        setup: () => {
            const leaf = window.muya!.editor.scrollPage!.queryBlock([1, 'text']);
            if (!leaf?.isContent()) throw new Error('Expected actual drag block');
            const walker = document.createTreeWalker(leaf.domNode!, NodeFilter.SHOW_TEXT);
            let last = walker.nextNode();
            while (last && last.textContent !== 'me') last = walker.nextNode();
            if (!last) throw new Error('Expected annotation-adjacent source text');
            window.muya!.editor.selection.setDOMSelection({ node: last, offset: 2 }, { node: last, offset: 0 });
        },
    });
    try {
        const paragraphs = page.locator('.mu-paragraph');
        await paragraphs.nth(1).hover();
        const handle = page.locator('.mu-front-button');
        await expect(handle).toBeVisible();
        const button = await handle.boundingBox();
        const destination = await paragraphs.last().boundingBox();
        if (!button || !destination) throw new Error('Expected visible drag geometry');
        await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
        await page.mouse.down();
        await expect(page.locator('.mu-shadow')).toBeVisible();
        await page.mouse.move(destination.x + 15, destination.y + destination.height - 2);
        await expect(page.locator('.mu-line-ghost')).toBeVisible();
        await page.mouse.up();
        expect(await readCore(page)).toMatchObject({ source: { source: moved }, anchor: 4, caret: 2, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: typed }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source }, anchor: 4, caret: 2 });
        await coreHistory(page, 'redo');
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: typed });
    }
    finally { await disposeCore(page); }
});
}
