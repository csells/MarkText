import { expect, test } from '../fixtures/muya';

for (const graphSuffix of ['', '\nA-->B', '\nA--->']) {
    const invalid = graphSuffix === '\nA--->';
    test(`trusted diagram input preserves normalized literal indentation and exact history (${invalid ? 'malformed graph' : graphSuffix ? 'rendered graph' : 'empty graph'})`, async ({ page }) => {
        const source = `  \`\`\`mermaid\n\tgraph TD${graphSuffix}\n  \`\`\`\n`;
        const typed = `  \`\`\`mermaid\n     graph TD${graphSuffix}\n  \`\`\`\n`;
        const initial = await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const body = window.muya!.editor.scrollPage!.queryBlock([0, 'text']);
            if (!body?.isContent())
                throw new Error('Expected diagram text');
            body.setCursor(1, 1, true);
            return { ...window.coreBoundary.read(), body: body.text, kind: body.getAnchor()?.blockName };
        }, source);
        try {
            expect(initial).toMatchObject({ source: { source }, kind: 'diagram', body: `  graph TD${graphSuffix}`, anchor: 1, caret: 1, legacyCalls: [] });
            if (!invalid)
                await expect(page.locator('.mu-diagram-preview svg').first()).toBeVisible({ timeout: 15_000 });
            else await expect(page.locator('.mu-diagram-error').first()).toContainText('Invalid Diagram Code');
            // Insert inside the tab's rendered columns without changing the graph's
            // syntax. The consumed fence indentation remains part of the source.
            await page.keyboard.type(' ');
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: `   graph TD${graphSuffix}`, anchor: 2, caret: 2, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source }, body: `  graph TD${graphSuffix}`, anchor: 1, caret: 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => ({ ...window.coreBoundary.read(), body: window.muya!.getSelection()?.anchor.block.text }))).toMatchObject({ source: { source: typed }, body: `   graph TD${graphSuffix}`, anchor: 2, caret: 2, legacyCalls: [] });
            const reopened = await page.evaluate(async () => {
                const saved = window.coreBoundary.reopen();
                window.coreBoundary.dispose();
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, saved.source);
                return { ...window.coreBoundary.read(), state: window.muya!.getState() };
            });
            expect(reopened).toMatchObject({ source: { source: typed }, state: [{ name: 'diagram', text: `   graph TD${graphSuffix}`, meta: { type: 'mermaid' } }], legacyCalls: [] });
            if (!invalid)
                await expect(page.locator('.mu-diagram-preview svg').first()).toBeVisible({ timeout: 15_000 });
            else await expect(page.locator('.mu-diagram-error').first()).toContainText('Invalid Diagram Code');
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}
