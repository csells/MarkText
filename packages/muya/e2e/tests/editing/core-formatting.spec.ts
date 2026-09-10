import { expect, test } from '../fixtures/muya';

for (const source of ['**aaa**\n', '**a{++a++}a**\n']) {
    for (const tracked of [false, true]) {
        test(`Core Clear Formatting preserves ${source.includes('{++') ? 'suggestions' : 'ordinary text'} (Track: ${tracked})`, async ({ page }) => {
            const cleared = source.includes('{++') ? 'a{++a++}a' : 'aaa';
            const expected = tracked ? `{~~${source.slice(0, -1)}~>${cleared}~~}\n` : `${cleared}\n`;
            const typed = tracked ? `{~~${source.slice(0, -1)}~>X~~}\n` : 'X\n';
            await page.evaluate(async ({ source, tracked }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
                const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                block.setCursor(0, block.text.length);
                window.muya!.format('clear');
            }, { source, tracked });
            try {
                const offset = tracked ? 7 : 0;
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, anchor: offset, caret: offset + 3 });
                await page.keyboard.type('X');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
                expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
            }
            finally {
                await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}

for (const example of [
    { format: 'u', expected: '<u>a{++a++}a</u>\n', typed: '<u>X</u>\n', start: 3, end: 6 },
    { format: 'mark', expected: '<mark>a{++a++}a</mark>\n', typed: '<mark>X</mark>\n', start: 6, end: 9 },
    { format: 'sub', expected: '<sub>a{++a++}a</sub>\n', typed: '<sub>X</sub>\n', start: 5, end: 8 },
    { format: 'sup', expected: '<sup>a{++a++}a</sup>\n', typed: '<sup>X</sup>\n', start: 5, end: 8 },
    { format: 'inline_math', expected: `$a\${++$a$++}$a$\n`, typed: '$X$\n', start: 1, end: 8 },
]) {
    test(`Core ${example.format} preserves suggestions and the next browser replacement`, async ({ page }) => {
        const source = 'a{++a++}a\n';
        await page.evaluate(async ({ source, format }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 3);
            window.muya!.format(format);
        }, { source, format: example.format });
        try {
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected }, anchor: example.start, caret: example.end });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.typed } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: example.expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: example.expected });
            expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('Core link creation places the next browser text in the destination', async ({ page }) => {
    const source = 'a{++a++}a\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 3);
        window.muya!.format('link');
    }, source);
    try {
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '[a{++a++}a]()\n' }, anchor: 6, caret: 6 });
        await page.keyboard.type('url');
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '[a{++a++}a](url)\n' });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '[a{++a++}a]()\n' } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
        expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

test('Core unlink uses the existing floating link tool on the hovered suggestion fragment', async ({ page }) => {
    const source = '[a{++a++}a](url)\n\noutside\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        window.muya!.editor.scrollPage!.lastContentInDescendant()!.setCursor(0, 0);
    }, source);
    try {
        await page.locator('#editor a').first().hover();
        await page.locator('.mu-link-tools li.item.unlink').click();
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'a{++a++}a\n\noutside\n' }, anchor: 3, caret: 3 });
        await page.keyboard.type('X');
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'a{++a++}aX\n\noutside\n' });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
        expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

for (const source of ['aaa\n', 'a{++a++}a\n']) {
    test(`Core image creation retains ${source.includes('{++') ? 'suggestions' : 'ordinary text'} and opens the native picker`, async ({ page }) => {
        const expected = `![${source.slice(0, -1)}]()\n`;
        const url = 'https://example.com/image.png';
        const savedImage = `![${source.slice(0, -1)}](${url})\n`;
        const result = await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const events: string[] = [];
            window.muya!.on('muya-image-selector', (event: { imageInfo: { token: { raw: string } } }) => events.push(event.imageInfo.token.raw));
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 3);
            window.muya!.format('image');
            return events;
        }, source);
        try {
            expect(result).toEqual(['![aaa]()']);
            await expect(page.locator('#editor .mu-inline-image')).toHaveCount(1);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
            const destination = page.getByPlaceholder('Image link or local path');
            await expect(destination).toBeFocused();
            await destination.fill(url);
            await destination.press('Enter');
            // Existing BaseFloat hides by opacity and moving outside the viewport.
            // Playwright's visibility predicate ignores both of those conditions.
            await expect(page.locator('.mu-image-selector-wrapper')).toHaveCSS('opacity', '0');
            await expect(page.locator('.mu-image-selector-wrapper')).not.toBeInViewport();
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: savedImage }, anchor: 8 + url.length, caret: 8 + url.length });
            expect(await page.evaluate(() => window.muya!.domNode.contains(document.activeElement))).toBe(true);
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: `${savedImage.slice(0, -1)}X\n` } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: savedImage } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
            expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const alt of ['aaa', 'a{++a++}a']) {
    test(`Core HTML image picker preserves literal alt ${alt} and the next browser input`, async ({ page }) => {
        const source = `<img src="old.png" alt="${alt}" width="120" data-align="center">\n`;
        const expected = `<img src="https://example.com/new.png" alt="${alt}" width="120" data-align="center" />\n`;
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            block.setCursor(block.text.length, block.text.length);
            if (!window.muya!.showImageSelectorAtSelection())
                throw new Error('Missing native HTML image picker');
        }, source);
        try {
            const destination = page.getByPlaceholder('Image link or local path');
            await expect(destination).toBeFocused();
            await destination.fill('https://example.com/new.png');
            await destination.press('Enter');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
            await page.evaluate(() => window.coreBoundary.settle());
            expect(await page.evaluate(() => window.muya!.domNode.contains(document.activeElement))).toBe(true);
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: `${expected.slice(0, -1)}X\n` }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
