import { expect, test } from '../fixtures/muya';

const examples = [
    { name: 'plain', body: 'a', donor: 'b' },
    { name: 'CM spelling', body: 'a{++old++}', donor: 'b{>>note<<}' },
].flatMap(example => ['\n', '\r\n', '\r'].flatMap(ending => [false, true].map(tracked => ({ ...example, ending, tracked }))));

for (const { name, body, donor, ending, tracked } of examples) {
    test(`paragraph-start Backspace owns the next trusted key (${name}, Track=${tracked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
        const before = `\`\`\`\n${body}\n\`\`\`\n${donor}\n`;
        const after = `\`\`\`\n${body}${donor}\n\`\`\`\n`;
        const afterTyping = `\`\`\`\n${body}x${donor}\n\`\`\`\n`;
        const outside = '\noutside{>>keep<<}\n';
        const source = (before + outside).replaceAll('\n', ending);
        const joined = ((tracked ? `{~~${before}~>${after}~~}` : after) + outside).replaceAll('\n', ending);
        const typed = ((tracked ? `{~~${before}~>${afterTyping}~~}` : afterTyping) + outside).replaceAll('\n', ending);
        const initial = await page.evaluate(async ({ source, tracked }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            const muya = window.muya!;
            window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
            const paragraph = muya.editor.scrollPage!.queryBlock([1, 'text']);
            if (!paragraph?.isContent())
                throw new Error('Expected paragraph following code');
            paragraph.setCursor(0, 0, true);
            return { ...window.coreBoundary.read(), body: paragraph.text, blockName: paragraph.blockName };
        }, { source, tracked });
        try {
            expect(initial).toMatchObject({ source: { source }, body: 'b', anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => {
                const body = window.muya!.getSelection()?.anchor.block;
                return { ...window.coreBoundary.read(), body: body?.text, blockName: body?.blockName };
            })).toMatchObject({ source: { source: joined }, body: body + donor, blockName: 'codeblock.content', anchor: body.length, caret: body.length, legacyCalls: [] });
            // No selection repair or acknowledgement wait before native typing.
            await page.keyboard.type('x');
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: `${body}x${donor}`, anchor: body.length + 1, caret: body.length + 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: joined }, body: body + donor, anchor: body.length, caret: body.length, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source }, body: 'b', anchor: 0, caret: 0, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: `${body}x${donor}`, anchor: body.length + 1, caret: body.length + 1, legacyCalls: [] });
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
                code: tracked
                    ? [{ name: 'code-block', text: body }, { name: 'code-block', text: `${body}x${donor}` }]
                    : [{ name: 'code-block', text: `${body}x${donor}` }],
                outside: { name: 'paragraph', text: 'outside' },
                legacyCalls: [],
            });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

test('typing after a code boundary uses the selected paragraph syntax and resulting selection', async ({ page }) => {
    const source = '```\na\n```\nb\n';
    const wrapped = '```\na\n```\n*b*\n';
    const typed = '```\na\n```\n*x*\n';
    const initial = await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const paragraph = window.muya!.editor.scrollPage!.queryBlock([1, 'text']);
        if (!paragraph?.isContent())
            throw new Error('Expected paragraph after code');
        paragraph.setCursor(0, 1, true);
        return { ...window.coreBoundary.read(), body: paragraph.text };
    }, source);
    try {
        expect(initial).toMatchObject({ source: { source }, body: 'b', anchor: 0, caret: 1, legacyCalls: [] });
        await page.keyboard.type('*');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: wrapped }, body: '*b*', anchor: 1, caret: 2, legacyCalls: [] });
        await page.keyboard.type('x');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: '*x*', anchor: 2, caret: 2, legacyCalls: [] });
        // Consecutive inserted keys share the native typing group.
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source }, body: 'b', anchor: 0, caret: 1, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: '*x*', anchor: 2, caret: 2, legacyCalls: [] });
        const reopened = await page.evaluate(async () => {
            const saved = window.coreBoundary.reopen();
            window.coreBoundary.dispose();
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, saved.source);
            return { ...window.coreBoundary.read(), state: window.muya!.getState() };
        });
        expect(reopened).toMatchObject({ source: { source: typed }, state: [{ name: 'code-block', text: 'a' }, { name: 'paragraph', text: '*x*' }], legacyCalls: [] });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
