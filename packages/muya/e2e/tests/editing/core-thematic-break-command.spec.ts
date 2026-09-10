import { expect, test } from '../fixtures/muya';
import { floats, quickInsertItem } from '../helpers/selectors';

for (const tracked of [false, true]) {
    for (const example of [
        {
            label: 'Quick Insert at EOF', quick: true, source: '/hr{>>discard<<}\n', anchor: 3, focus: 3,
            inserted: tracked ? '{~~/hr{>>discard<<}~>---\n\n~~}\n' : '---\n\n\n',
            typed: tracked ? '{~~/hr{>>discard<<}~>---\n\nxy~~}\n' : '---\n\nxy\n',
        },
        {
            label: 'Quick Insert before following content', quick: true, source: '/hr{>>discard<<}\n\noutside{>>keep<<}\n', anchor: 3, focus: 3,
            inserted: tracked ? '{~~/hr{>>discard<<}~>---\n\n~~}\n\noutside{>>keep<<}\n' : '---\n\n\n\noutside{>>keep<<}\n',
            typed: tracked ? '{~~/hr{>>discard<<}~>---\n\nxy~~}\n\noutside{>>keep<<}\n' : '---\n\nxy\n\noutside{>>keep<<}\n',
        },
        {
            label: 'Format in an empty document', quick: false, source: '', anchor: 0, focus: 0,
            inserted: tracked ? '{++---\n\n++}' : '---\n\n',
            typed: tracked ? '{++---\n\nxy++}' : '---\n\nxy',
        },
        {
            label: 'Format preserves selected prose before following content', quick: false, source: 'before{>>keep<<}\n\nfollowing\n', anchor: 1, focus: 3,
            inserted: tracked ? 'before{>>keep<<}{++\n\n---\n\n++}\n\nfollowing\n' : 'before{>>keep<<}\n\n---\n\n\n\nfollowing\n',
            typed: tracked ? 'before{>>keep<<}{++\n\n---\n\nxy++}\n\nfollowing\n' : 'before{>>keep<<}\n\n---\n\nxy\n\nfollowing\n',
        },
        {
            label: 'Quick Insert inside a list', quick: true, source: '- /hr{>>discard<<}\n- other{>>keep<<}\n', anchor: 3, focus: 3, container: 'li',
            inserted: tracked ? '- {~~/hr{>>discard<<}~>___\n\n  ~~}\n- other{>>keep<<}\n' : '- ___\n\n  \n- other{>>keep<<}\n',
            typed: tracked ? '- {~~/hr{>>discard<<}~>___\n\n  xy~~}\n- other{>>keep<<}\n' : '- ___\n\n  xy\n- other{>>keep<<}\n',
        },
        {
            label: 'Quick Insert inside a quote', quick: true, source: '> /hr{>>discard<<}\n\noutside{>>keep<<}\n', anchor: 3, focus: 3, container: 'blockquote',
            inserted: tracked ? '> {~~/hr{>>discard<<}~>---\n>\n> ~~}\n\noutside{>>keep<<}\n' : '> ---\n>\n> \n\noutside{>>keep<<}\n',
            typed: tracked ? '> {~~/hr{>>discard<<}~>---\n>\n> xy~~}\n\noutside{>>keep<<}\n' : '> ---\n>\n> xy\n\noutside{>>keep<<}\n',
        },
    ]) {
        test(`Horizontal Line ${example.label} owns its following input (Track=${tracked})`, async ({ page }) => {
            const immediate = await page.evaluate(async ({ source, quick, anchor, focus, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(anchor, focus, true);
                if (quick) window.muya!.eventCenter.emit('content-change', { block });
                else window.muya!.updateParagraph('hr');
                return window.coreBoundary.read();
            }, { ...example, tracked });
            try {
                if (example.quick) {
                    await expect(page.locator(floats.quickInsert)).toBeVisible();
                    await page.locator(quickInsertItem('thematic-break')).click();
                }
                expect(example.quick ? await page.evaluate(() => window.coreBoundary.read()) : immediate).toMatchObject({ source: { source: example.inserted }, anchor: 0, caret: 0, legacyCalls: [] });
                if (example.container !== undefined) {
                    expect(await page.evaluate((container) => {
                        const selected = window.muya!.getSelection()?.anchor.block.domNode;
                        if (!selected) throw new Error('Expected selected paragraph');
                        return selected.closest(container) !== null;
                    }, example.container)).toBe(true);
                }
                // The command's selected empty paragraph must govern the next trusted keys.
                await page.keyboard.type('xy');
                expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), selectedText: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: example.typed }, anchor: 2, caret: 2, selectedText: 'xy', legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.inserted }, anchor: 0, caret: 0 });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source }, anchor: example.anchor, caret: example.focus });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.typed }, anchor: 2, caret: 2, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.typed });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}

for (const tracked of [false, true]) {
    for (const example of [
        {
            label: 'Backspace at rule start', key: 'Backspace', anchor: 0, focus: 0, caret: tracked ? 3 : 0,
            inserted: tracked ? '\n\n{-------}\n\n' : '\n\n\n\n',
            typed: tracked ? '\n\n{-------}{++xy++}\n\n' : '\n\nxy\n\n',
        },
        {
            label: 'Enter at rule start', key: 'Enter', anchor: 0, focus: 0, caret: 0,
            inserted: tracked ? '\n\n{++\n\n++}---\n\n' : '\n\n\n\n---\n\n',
            typed: tracked ? '\n\n{++\n\nxy++}---\n\n' : '\n\n\n\nxy---\n\n',
        },
        {
            label: 'Enter inside rule', key: 'Enter', anchor: 1, focus: 1, caret: 0,
            inserted: tracked ? '\n\n---{++\n\n++}\n\n' : '\n\n---\n\n\n\n',
            typed: tracked ? '\n\n---{++\n\nxy++}\n\n' : '\n\n---\n\nxy\n\n',
        },
        {
            label: 'Enter with selected rule text', key: 'Enter', anchor: 0, focus: 2, caret: 0,
            inserted: tracked ? '\n\n---{++\n\n++}\n\n' : '\n\n---\n\n\n\n',
            typed: tracked ? '\n\n---{++\n\nxy++}\n\n' : '\n\n---\n\nxy\n\n',
        },
    ]) {
        test(`Horizontal Line ${example.label} governs the next trusted keys (Track=${tracked})`, async ({ page }) => {
            const source = 'a{>>keep<<}\n\n---\n\nb{>>tail<<}\n';
            const inserted = 'a{>>keep<<}' + example.inserted + 'b{>>tail<<}\n';
            const typed = 'a{>>keep<<}' + example.typed + 'b{>>tail<<}\n';
            await page.evaluate(async ({ source, tracked, anchor, focus }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const rule = window.muya!.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext();
                if (!rule || rule.blockName !== 'thematicbreak.content') throw new Error('Expected selected rule');
                rule.setCursor(anchor, focus, true);
            }, { source, tracked, anchor: example.anchor, focus: example.focus });
            try {
                await page.keyboard.press(example.key);
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: inserted }, anchor: example.caret, caret: example.caret, legacyCalls: [] });
                await page.keyboard.type('xy');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: example.caret + 2, caret: example.caret + 2, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: inserted } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: example.anchor, caret: example.focus });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: example.caret + 2, caret: example.caret + 2, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
