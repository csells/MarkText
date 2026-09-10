import { expect, test } from '../fixtures/muya';

const examples = [
    { label: 'fenced', source: '```\ncode here\n```\n', reset: 'code here\n', typed: 'coxde here\n' },
    { label: 'language fence', source: '```js\ncode here\n```\n', reset: 'code here\n', typed: 'coxde here\n' },
    { label: 'multiline fence', source: '~~~text\ncode here\nagain\n~~~\n', reset: 'code here\nagain\n', typed: 'coxde here\nagain\n' },
    { label: 'indented', source: '    code here\n', reset: 'code here\n', typed: 'coxde here\n' },
    { label: 'list item', source: '- ```js\n  code here\n  ```\n- outside{>>keep<<}\n', reset: '- code here\n- outside{>>keep<<}\n', typed: '- coxde here\n- outside{>>keep<<}\n' },
    { label: 'quote', source: '> ```\n> code here\n> ```\n\noutside{>>keep<<}\n', reset: '> code here\n\noutside{>>keep<<}\n', typed: '> coxde here\n\noutside{>>keep<<}\n' },
];

for (const example of examples) {
    test(`native Code Block toggle retains its caret (${example.label})`, async ({ page }) => {
        const immediate = await page.evaluate((source) => {
            const muya = window.muya!;
            muya.setContent(source);
            let code = muya.editor.scrollPage!.firstContentInDescendant();
            while (code && code.blockName !== 'codeblock.content') code = code.nextContentInContext() ?? null;
            if (!code || !code.text.startsWith('code here')) throw new Error('Expected native code body');
            code.setCursor(2, 2, true);
            const before = muya.getSelection();
            if (before?.anchor.block !== code || before.anchor.offset !== 2 || before.focus.offset !== 2) throw new Error('Native code body caret was not selected');
            muya.updateParagraph('pre');
            muya.flush();
            const selection = muya.getSelection();
            return { source: muya.getMarkdown(), anchor: selection?.anchor.offset, caret: selection?.focus.offset };
        }, example.source);
        expect(immediate).toEqual({ source: example.reset, anchor: 2, caret: 2 });
        await page.keyboard.type('x');
        expect(await page.evaluate(() => {
            window.muya!.flush();
            const selection = window.muya!.getSelection();
            return { source: window.muya!.getMarkdown(), anchor: selection?.anchor.offset, caret: selection?.focus.offset };
        })).toEqual({ source: example.typed, anchor: 3, caret: 3 });
    });
}

for (const ending of ['\n', '\r\n', '\r']) {
    test(`tracked Code Block reset owns the new arm before trusted input (EOL=${JSON.stringify(ending)})`, async ({ page }) => {
        const source = ['```', 'code here', '```', ''].join(ending);
        const reset = ['{~~```', 'code here', '```', '~>code here', '~~}'].join(ending);
        const typed = ['{~~```', 'code here', '```', '~>coxde here', '~~}'].join(ending);
        const immediate = await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, true);
            let code = window.muya!.editor.scrollPage!.firstContentInDescendant();
            while (code && code.blockName !== 'codeblock.content') code = code.nextContentInContext() ?? null;
            if (!code || !code.text.startsWith('code here')) throw new Error('Expected tracked code body');
            code.setCursor(2, 2, true);
            const before = window.muya!.getSelection();
            if (before?.anchor.block !== code || before.anchor.offset !== 2 || before.focus.offset !== 2) throw new Error('Tracked code body caret was not selected');
            window.muya!.updateParagraph('pre');
            return window.coreBoundary.read();
        }, source);
        try {
            expect(immediate).toMatchObject({ source: { source: reset }, anchor: 2, caret: 2, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 3, caret: 3, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: reset }, anchor: 2, caret: 2 });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 2, caret: 2 });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 3, caret: 3, legacyCalls: [] });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const example of [
    ...examples,
    { label: 'enclosing addition', source: '{++```js\ncode here\n```++}\n', reset: '{++code here++}\n', typed: '{++coxde here++}\n' },
]) {
    for (const ending of ['\n', '\r\n', '\r']) {
        test(`Code Block toggle owns the next trusted key (${example.label}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const source = example.source.replaceAll('\n', ending);
            const reset = example.reset.replaceAll('\n', ending);
            const typed = example.typed.replaceAll('\n', ending);
            const immediate = await page.evaluate(async (source) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                let code = window.muya!.editor.scrollPage!.firstContentInDescendant();
                while (code && code.blockName !== 'codeblock.content') code = code.nextContentInContext() ?? null;
                if (!code || !code.text.startsWith('code here')) throw new Error('Expected model-owned code body');
                code.setCursor(2, 2, true);
                const before = window.muya!.getSelection();
                if (before?.anchor.block !== code || before.anchor.offset !== 2 || before.focus.offset !== 2) throw new Error('Model code body caret was not selected');
                window.muya!.updateParagraph('pre');
                return window.coreBoundary.read();
            }, source);
            try {
                expect(immediate).toMatchObject({ source: { source: reset }, anchor: 2, caret: 2, legacyCalls: [] });
                // No selection repair or acknowledgement wait before native typing.
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 3, caret: 3, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: reset }, anchor: 2, caret: 2 });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 2, caret: 2 });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 3, caret: 3, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}
