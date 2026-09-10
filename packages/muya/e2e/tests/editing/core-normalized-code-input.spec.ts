import { expect, test } from '../fixtures/muya';

for (const marked of [false, true]) {
    for (const ending of ['\n', '\r\n', '\r']) {
        test(`typing inside a normalized tab preserves source and history (Addition=${marked}, EOL=${JSON.stringify(ending)})`, async ({ page }) => {
            const source = (marked ? '{++  ```\n\tbody\n  ```++}\n' : '  ```\n\tbody\n  ```\n').replaceAll('\n', ending);
            const typed = (marked ? '{++  ```\n   x body\n  ```++}\n' : '  ```\n   x body\n  ```\n').replaceAll('\n', ending);
            const initial = await page.evaluate(async (source) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                let body = window.muya!.editor.scrollPage!.firstContentInDescendant();
                while (body && body.blockName !== 'codeblock.content') body = body.nextContentInContext() ?? null;
                if (!body) throw new Error('Expected normalized code body');
                body.setCursor(1, 1, true);
                return { ...window.coreBoundary.read(), body: body.text };
            }, source);
            try {
                expect(initial).toMatchObject({ source: { source }, body: '  body', anchor: 1, caret: 1, legacyCalls: [] });
                // Offset one is inside the tab's two visible columns. The model
                // must own that text position without rounding it to a raw-source boundary.
                await page.keyboard.type('x');
                expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: ' x body', anchor: 2, caret: 2, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source }, body: '  body', anchor: 1, caret: 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: ' x body', anchor: 2, caret: 2, legacyCalls: [] });
                const reopened = await page.evaluate(async () => {
                    const saved = window.coreBoundary.reopen();
                    window.coreBoundary.dispose();
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(window.muya!, saved.source);
                    let body = window.muya!.editor.scrollPage!.firstContentInDescendant();
                    while (body && body.blockName !== 'codeblock.content') body = body.nextContentInContext() ?? null;
                    if (!body) throw new Error('Expected reopened code body');
                    return { ...window.coreBoundary.read(), body: body.text };
                });
                expect(reopened).toMatchObject({ source: { source: typed }, body: ' x body', legacyCalls: [] });
            } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
        });
    }
}

test('Backspace at a normalized tab boundary removes only the selected visible column', async ({ page }) => {
    const source = '  ```\n\tbody\n  ```\n';
    const deleted = '  ```\n   body\n  ```\n';
    const typed = '  ```\n   xbody\n  ```\n';
    const initial = await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        let body = window.muya!.editor.scrollPage!.firstContentInDescendant();
        while (body && body.blockName !== 'codeblock.content') body = body.nextContentInContext() ?? null;
        if (!body) throw new Error('Expected normalized code body');
        body.setCursor(2, 2, true);
        return { ...window.coreBoundary.read(), body: body.text };
    }, source);
    try {
        expect(initial).toMatchObject({ source: { source }, body: '  body', anchor: 2, caret: 2, legacyCalls: [] });
        await page.keyboard.press('Backspace');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: deleted }, body: ' body', anchor: 1, caret: 1, legacyCalls: [] });
        await page.keyboard.type('x');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: ' xbody', anchor: 2, caret: 2, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: deleted }, anchor: 1, caret: 1 });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source }, body: '  body', anchor: 2, caret: 2, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, anchor: 2, caret: 2, legacyCalls: [] });
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
    } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

test('a backward normalized tab selection stays selected after wrapping for the next key', async ({ page }) => {
    const source = '  ```\n\tbody\n  ```\n';
    const wrapped = '  ```\n   ( )body\n  ```\n';
    const typed = '  ```\n   (x)body\n  ```\n';
    const initial = await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        let body = window.muya!.editor.scrollPage!.firstContentInDescendant();
        while (body && body.blockName !== 'codeblock.content') body = body.nextContentInContext() ?? null;
        if (!body) throw new Error('Expected normalized code body');
        body.setCursor(2, 1, true);
        return { ...window.coreBoundary.read(), body: body.text };
    }, source);
    try {
        expect(initial).toMatchObject({ source: { source }, body: '  body', anchor: 2, caret: 1, legacyCalls: [] });
        await page.keyboard.type('(');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: wrapped }, body: ' ( )body', anchor: 3, caret: 2, legacyCalls: [] });
        await page.keyboard.type('x');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: ' (x)body', anchor: 3, caret: 3, legacyCalls: [] });
        // Consecutive insertText keys share Muya's native typing group. Unlike
        // Backspace followed by typing, this sequence has no input-kind boundary.
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source }, body: '  body', anchor: 2, caret: 1, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: ' (x)body', anchor: 3, caret: 3, legacyCalls: [] });
        const reopened = await page.evaluate(async () => {
            const saved = window.coreBoundary.reopen();
            window.coreBoundary.dispose();
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, saved.source);
            let body = window.muya!.editor.scrollPage!.firstContentInDescendant();
            while (body && body.blockName !== 'codeblock.content') body = body.nextContentInContext() ?? null;
            if (!body) throw new Error('Expected reopened code body');
            return { ...window.coreBoundary.read(), body: body.text };
        });
        expect(reopened).toMatchObject({ source: { source: typed }, body: ' (x)body', legacyCalls: [] });
    } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

test('tracked wrapping retains normalized indentation and backward selection for the next key', async ({ page }) => {
    const source = '  ```\n\tbody\n  ```\n';
    const wrapped = '  {~~```\n\tbody\n  ```\n~>```\n   ( )body\n  ```\n~~}';
    const typed = '  {~~```\n\tbody\n  ```\n~>```\n   (x)body\n  ```\n~~}';
    const initial = await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source, true);
        let body = window.muya!.editor.scrollPage!.firstContentInDescendant();
        while (body && body.blockName !== 'codeblock.content') body = body.nextContentInContext() ?? null;
        if (!body) throw new Error('Expected normalized code body');
        body.setCursor(2, 1, true);
        return { ...window.coreBoundary.read(), body: body.text };
    }, source);
    try {
        expect(initial).toMatchObject({ source: { source }, body: '  body', anchor: 2, caret: 1, legacyCalls: [] });
        await page.keyboard.type('(');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: wrapped }, body: ' ( )body', anchor: 3, caret: 2, legacyCalls: [] });
        await page.keyboard.type('x');
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: ' (x)body', anchor: 3, caret: 3, legacyCalls: [] });
        // Consecutive insertText keys share Muya's native typing group. Unlike
        // Backspace followed by typing, this sequence has no input-kind boundary.
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source }, body: '  body', anchor: 2, caret: 1, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: ' (x)body', anchor: 3, caret: 3, legacyCalls: [] });
        const reopened = await page.evaluate(async () => {
            const saved = window.coreBoundary.reopen();
            window.coreBoundary.dispose();
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, saved.source);
            const bodies: string[] = [];
            let body = window.muya!.editor.scrollPage!.firstContentInDescendant();
            while (body) {
                if (body.blockName === 'codeblock.content') bodies.push(body.text);
                body = body.nextContentInContext() ?? null;
            }
            return { ...window.coreBoundary.read(), bodies };
        });
        expect(reopened).toMatchObject({ source: { source: typed }, bodies: ['  body', ' (x)body'], legacyCalls: [] });
    } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
