import { expect, test } from '../fixtures/muya';

const examples = [
    ...['\n', '\r\n', '\r'].flatMap(ending => [false, true].map(tracked => ({
        label: `heading and paragraph, Track=${tracked}, EOL=${JSON.stringify(ending)}`,
        payload: '# T\n\na{++b++}c{>>note<<}',
        ending,
        tracked,
    }))),
    { label: 'selection from inside a list through the next paragraph', payload: '- one\n- two{++x++}\n\nmiddle', ending: '\n', tracked: false },
];

for (const { label, payload, ending, tracked } of examples) {
    test(`Code Block owns selected raw Markdown before the next trusted key (${label})`, async ({ page }) => {
        const source = `${payload}\n\noutside{>>keep<<}\n`.replaceAll('\n', ending);
        const wrapped = (tracked
            ? `{~~${payload}~>\`\`\`\n${payload}\n\`\`\`~~}\n\noutside{>>keep<<}\n`
            : `\`\`\`\n${payload}\n\`\`\`\n\noutside{>>keep<<}\n`).replaceAll('\n', ending);
        const typed = (tracked
            ? `{~~${payload}~>\`\`\`\nx${payload}\n\`\`\`~~}\n\noutside{>>keep<<}\n`
            : `\`\`\`\nx${payload}\n\`\`\`\n\noutside{>>keep<<}\n`).replaceAll('\n', ending);
        const immediate = await page.evaluate(async ({ source, tracked }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            const muya = window.muya!;
            window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
            const first = muya.editor.scrollPage!.firstContentInDescendant();
            const second = muya.editor.scrollPage!.queryBlock([1, 'text']);
            if (!first?.isContent() || !second?.isContent()) throw new Error('Expected two selected outer blocks');
            muya.editor.activeContentBlock = second;
            muya.editor.selection.setSelection(
                { block: first, path: first.path, offset: 0 },
                { block: second, path: second.path, offset: second.text.length },
            );
            muya.updateParagraph('pre');
            const body = muya.getSelection()?.anchor.block;
            return { ...window.coreBoundary.read(), body: body?.text, blockName: body?.blockName };
        }, { source, tracked });
        try {
            expect(immediate).toMatchObject({ source: { source: wrapped }, body: payload, blockName: 'codeblock.content', anchor: 0, caret: 0, legacyCalls: [] });
            // The actual command's selection must govern this trusted key, without
            // an acknowledgement wait or a presentation-side selection repair.
            await page.keyboard.type('x');
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: `x${payload}`, anchor: 1, caret: 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: wrapped }, body: payload, anchor: 0, caret: 0, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: `x${payload}`, anchor: 1, caret: 1, legacyCalls: [] });
            const reopened = await page.evaluate(async () => {
                const saved = window.coreBoundary.reopen();
                window.coreBoundary.dispose();
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, saved.source);
                const state = window.muya!.getState();
                return { ...window.coreBoundary.read(), code: state.filter(block => block.name === 'code-block'), outside: state.at(-1) };
            });
            expect(reopened).toMatchObject({
                source: { source: typed },
                code: [{ name: 'code-block', text: `x${payload}` }],
                outside: { name: 'paragraph', text: 'outside' },
                legacyCalls: [],
            });
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
