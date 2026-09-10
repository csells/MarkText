import { devices } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { floats } from '../helpers/selectors';

for (const key of ['Meta+Enter', 'Control+Enter', 'Alt+Enter']) {
    test(`Core ${key} defers to the visible Quick Insert menu`, async ({ page }) => {
        await page.evaluate(async () => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, '/math\n');
            const content = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            content.setCursor(content.text.length, content.text.length, true);
            window.muya!.eventCenter.emit('content-change', { block: content });
        });
        try {
            await expect(page.locator(floats.quickInsert)).toBeVisible();
            await page.keyboard.press(key);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '$$\n\n$$\n' }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '$$\nx\n$$\n' }, anchor: 1, caret: 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '$$\n\n$$\n' } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '/math\n' } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '$$\nx\n$$\n' });
        } finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const example of [
    { name: 'plain repeated text', source: 'aaaa\n', start: 2, end: 2, expected: 'aa\n\naa\n', next: 'aa\n\nxaa\n' },
    { name: 'a suggestion payload', source: 'a{++aa++}a\n', start: 2, end: 2, expected: 'a{++a\n\na++}a\n', next: 'a{++a\n\nxa++}a\n' },
    { name: 'a list item', source: '- aaa\n', start: 1, end: 1, expected: '- a\n- aa\n', next: '- a\n- xaa\n' },
    { name: 'a blockquote', source: '> aaa\n', start: 1, end: 1, expected: '> a\n> \n> aa\n', next: '> a\n> \n> xaa\n' },
    { name: 'tracked repeated text', source: 'aaaa\n', start: 2, end: 2, expected: 'aa{++\n\n++}aa\n', next: 'aa{++\n\nx++}aa\n', tracked: true },
    { name: 'tracked heading end', source: '# Heading\n', start: 9, end: 9, expected: '# Heading{++\n\n++}\n', next: '# Heading{++\n\nnext++}\n', tracked: true, typed: 'next' },
    { name: 'tracked list end', source: '- item\n', start: 4, end: 4, expected: '- item{++\n- ++}\n', next: '- item{++\n- next++}\n', tracked: true, typed: 'next' },
    { name: 'a heading', source: '# aaa\n', start: 3, end: 3, expected: '# a\n\naa\n', next: '# a\n\nxaa\n' },
    { name: 'a repeated selection including a suggestion', source: 'a{++a++}a\n', start: 0, end: 2, expected: '\n\na\n', next: '\n\nxa\n' },
]) {
    test(`Core Enter splits ${example.name} before the next browser key`, async ({ page }) => {
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source, 'tracked' in example && example.tracked === true);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(example.start, example.end);
        }, example);
        try {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: 0, caret: 0 });
            const typed = example.typed ?? 'x';
            await page.keyboard.type(typed);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: typed.length, caret: typed.length });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
            if (example.typed !== undefined) {
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
            }
            expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const example of [
    { name: 'math opener', source: '$$\n', at: 2, expected: '$$\n\n$$\n', next: '$$\nx\n$$\n', caret: 0 },
    ...['Meta+Enter', 'Control+Enter', 'Alt+Enter'].map(key => ({ name: `math opener with ${key}`, source: '$$\n', at: 2, expected: '$$\n\n$$\n', next: '$$\nx\n$$\n', caret: 0, key })),
    { name: 'typed fence opener', source: '```js\n', at: 5, expected: '```js\n\n```\n', next: '```js\nx\n```\n', caret: 0 },
    { name: 'empty list exit', source: '- \n', at: 0, expected: '\n', next: 'x\n', caret: 0 },
    { name: 'empty quote exit', source: '> \n', at: 0, expected: '\n', next: 'x\n', caret: 0 },
    { name: 'heading start', source: '# aaa\n', at: 2, expected: '\n\n# aaa\n', next: '\n\n# xaaa\n', caret: 2 },
    { name: 'setext split', source: 'aaa\n===\n', at: 1, expected: 'a\n===\n\naa\n', next: 'a\n===\n\nxaa\n', caret: 0 },
    { name: 'soft line break', source: 'aaaa\n', at: 2, expected: 'aa\naa\n', next: 'aa\nxaa\n', caret: 3, key: 'Shift+Enter' },
]) {
    test(`Core native Enter preserves ${example.name}`, async ({ page }) => {
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source, 'tracked' in example && example.tracked === true);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(example.at, example.at);
        }, example);
        try {
            await page.keyboard.press('key' in example ? example.key : 'Enter');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: example.caret, caret: example.caret });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: example.caret + 1, caret: example.caret + 1 });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
            if (example.source === '$$\n' || ['empty list exit', 'empty quote exit'].includes(example.name)) {
                expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source } });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
            }
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const source of ['| a | b |\n', '| {++a++} | b |\n']) {
    for (const key of ['Enter', 'Meta+Enter', 'Control+Enter', 'Alt+Enter']) {
        test(`Core ${key} converts a table header while preserving ${source.includes('{++') ? 'its suggestion' : 'ordinary cells'}`, async ({ page }) => {
            await page.evaluate(async (source) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(block.text.length, block.text.length);
            }, source);
            try {
                await page.keyboard.press(key);
                const expected = `${source.slice(0, -1)}\n| --- | --- |\n| | |\n`;
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, anchor: 0, caret: 0, legacyCalls: [] });
                await expect(page.locator('table')).toHaveCount(1);
                await page.keyboard.type('x');
                const next = `${source.slice(0, -1)}\n| --- | --- |\n| x| |\n`;
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: next }, anchor: 1, caret: 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: next });
            }
            finally {
                await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}

for (const example of [
    { name: 'code indentation', source: '```js\n  aaa\n```\n', at: 5, expected: '```js\n  aaa\n  \n```\n', next: '```js\n  aaa\n  x\n```\n', caret: 8 },
    { name: 'code brace indentation', source: '```js\n{}\n```\n', at: 1, expected: '```js\n{\n    \n}\n```\n', next: '```js\n{\n    x\n}\n```\n', caret: 6 },
    { name: 'two-space code preference', source: '```js\n{}\n```\n', at: 1, expected: '```js\n{\n  \n}\n```\n', next: '```js\n{\n  x\n}\n```\n', caret: 4, tabSize: 2 },
]) {
    test(`Core literal Enter preserves ${example.name} without a legacy edit`, async ({ page }) => {
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source);
            if ('tabSize' in example && typeof example.tabSize === 'number')
                window.muya!.options.tabSize = example.tabSize;
            let content = window.muya!.editor.scrollPage!.firstContentInDescendant() ?? undefined;
            while (content && content.blockName !== 'codeblock.content')
                content = content.nextContentInContext() ?? undefined;
            if (!content)
                throw new Error('Missing native code body');
            content.setCursor(example.at, example.at);
        }, example);
        try {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: example.caret, caret: example.caret, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: example.caret + 1, caret: example.caret + 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const example of [
    { name: 'new trailing paragraph', source: '```js\naaa\n```\n', expected: '```js\naaa\n```\n\n', next: '```js\naaa\n```\n\nx' },
    { name: 'existing next paragraph', source: '```js\naaa\n```\n\nafter\n', expected: '```js\naaa\n```\n\nafter\n', next: '```js\naaa\n```\n\nxafter\n' },
]) {
    test(`Core literal Shift Enter selects the ${example.name}`, async ({ page }) => {
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source);
            let content = window.muya!.editor.scrollPage!.firstContentInDescendant() ?? undefined;
            while (content && content.blockName !== 'codeblock.content')
                content = content.nextContentInContext() ?? undefined;
            if (!content)
                throw new Error('Missing native code body');
            content.setCursor(1, 1);
        }, example);
        try {
            await page.keyboard.press('Shift+Enter');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: 0, caret: 0, legacyCalls: [] });
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: 1, caret: 1, legacyCalls: [] });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.next });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const example of [
    { name: 'next table row', key: 'Enter', expected: '| aa | bb |\n| --- | --- |\n| cc | dd |\n', next: '| aa | bb |\n| --- | --- |\n| xcc | dd |\n', caret: 0 },
    { name: 'table cell line break', key: 'Shift+Enter', expected: '| a<br/>a | bb |\n| --- | --- |\n| cc | dd |\n', next: '| a<br/>xa | bb |\n| --- | --- |\n| cc | dd |\n', caret: 6 },
    { name: 'annotated cell line break', source: '| a{++aa++}a | bb |\n| --- | --- |\n| cc | dd |\n', at: 2, key: 'Shift+Enter', expected: '| a{++a<br/>a++}a | bb |\n| --- | --- |\n| cc | dd |\n', next: '| a{++a<br/>xa++}a | bb |\n| --- | --- |\n| cc | dd |\n', caret: 7 },
    { name: 'last row exit', key: 'Enter', body: true, expected: '| aa | bb |\n| --- | --- |\n| cc | dd |\n\n', next: '| aa | bb |\n| --- | --- |\n| cc | dd |\n\nx', caret: 0 },
]) {
    test(`Core table Enter owns the ${example.name}`, async ({ page }) => {
        await page.evaluate(async (example) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, 'source' in example && typeof example.source === 'string' ? example.source : '| aa | bb |\n| --- | --- |\n| cc | dd |\n');
            let content = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            if ('body' in example)
                content = content.nextContentInContext()!.nextContentInContext()!;
            const at = 'at' in example && typeof example.at === 'number' ? example.at : 1;
            content.setCursor(at, at);
        }, example);
        try {
            await page.keyboard.press(example.key);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: example.caret, caret: example.caret, legacyCalls: [] });
            expect(await page.evaluate(() => window.coreBoundary.read().actions)).toHaveLength(1);
            await page.keyboard.type('x');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.next }, anchor: example.caret + 1, caret: example.caret + 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test.describe('macOS table command', () => {
    test.use({ userAgent: devices['Desktop Chrome'].userAgent!.replace(/\([^)]*\)/, '(Macintosh; Intel Mac OS X 10_15_7)') });
    for (const example of [
        { name: 'ordinary cells', source: '| aa | bb |\n| --- | --- |\n| cc | dd |\n', expected: '| aa | bb |\n| --- | --- |\n|     |     |\n| cc | dd |\n', next: '| aa | bb |\n| --- | --- |\n|     x|     |\n| cc | dd |\n', tracked: false },
        { name: 'primary shortcut precedence with Alt', source: '| aa | bb |\n| --- | --- |\n| cc | dd |\n', expected: '| aa | bb |\n| --- | --- |\n|     |     |\n| cc | dd |\n', next: '| aa | bb |\n| --- | --- |\n|     x|     |\n| cc | dd |\n', tracked: false, key: 'Meta+Alt+Enter' },
        { name: 'an existing suggestion', source: '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n', expected: '| a{++a++} | bb |\n| --- | --- |\n|     |     |\n| cc | dd |\n', next: '| a{++a++} | bb |\n| --- | --- |\n|     x|     |\n| cc | dd |\n', tracked: false },
        { name: 'tracked row insertion', source: '| aa | bb |\n| --- | --- |\n| cc | dd |\n', expected: '| aa | bb |\n| --- | --- |{++\n|     |     |++}\n| cc | dd |\n', next: '| aa | bb |\n| --- | --- |{++\n|     x|     |++}\n| cc | dd |\n', tracked: true },
        { name: 'insertion after a body row', source: '| aa | bb |\n| --- | --- |\n| cc | dd |\n', expected: '| aa | bb |\n| --- | --- |\n| cc | dd |\n|     |     |\n', next: '| aa | bb |\n| --- | --- |\n| cc | dd |\n|     x|     |\n', tracked: false, body: true },
    ]) {
        test(`Core table row command preserves ${example.name} before native mutation`, async ({ page }) => {
            const { source, expected, next } = example;
            await page.evaluate(async (example) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, example.source, example.tracked);
                let content = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                if ('body' in example)
                    content = content.nextContentInContext()!.nextContentInContext()!;
                content.setCursor(1, 1);
            }, example);
            try {
                await page.keyboard.press(example.key ?? 'Meta+Enter');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, anchor: 0, caret: 0, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.read().actions)).toHaveLength(1);
                expect(await page.evaluate((body) => {
                    const first = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                    let inserted = first.nextContentInContext()!.nextContentInContext()!;
                    if (body)
                        inserted = inserted.nextContentInContext()!.nextContentInContext()!;
                    return window.muya!.getSelection()?.anchor.block === inserted;
                }, 'body' in example)).toBe(true);
                await page.keyboard.type('x');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: next }, anchor: 1, caret: 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            }
            finally {
                await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
});
