import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

const url = 'https://example.test/layout.svg';
const image = `![cat](${url})`;

for (const resize of [false, true]) {
    test(`native image ${resize ? 'resize handle' : 'alignment toolbar'} edits only the selected repeated image through Core`, async ({ page }) => {
        await page.route(url, route => route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>',
        }));
        const original = `${image} ${image}\n`;
        await bootCore(page, original);
        try {
            const images = page.locator('#editor .mu-inline-image img');
            await expect(images).toHaveCount(2);
            await expect.poll(() => images.last().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(160);
            await images.last().click();
            let property: string;
            if (resize) {
                const handle = page.locator('.mu-transformer .bar.right');
                await expect(handle).toBeVisible();
                const box = await handle.boundingBox();
                if (!box) throw new Error('Image resize handle has no bounds');
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
                const width = await images.last().getAttribute('width');
                expect(Number(width)).toBeGreaterThan(160);
                property = `width=${width}`;
                await page.mouse.up();
            }
            else {
                await page.locator('.mu-image-toolbar li.center').click();
                property = 'data-align=center';
            }
            const expected = `${image} ${image}{${property}}\n`;
            expect(await readCore(page)).toMatchObject({ source: { source: expected }, legacyCalls: [] });
            await page.keyboard.type('X');
            const typed = `${expected.slice(0, -1)}X\n`;
            expect(await readCore(page)).toMatchObject({ source: { source: typed }, legacyCalls: [] });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: expected } });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: original } });
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: expected });
        }
        finally {
            await disposeCore(page);
        }
    });
}

test('native resizing preserves independent CM labels and comments through input, history and a mounted reopen', async ({ page }) => {
    await page.route(url, route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>',
    }));
    const original = `![A {++sunny ++}{++sandy ++}beach{>>keep<<}](${url})\n`;
    const expected = `![A {++sunny ++}{++sandy ++}beach{>>keep<<}](${url}){width=200}\n`;
    const caret = `![A sunny sandy beach](${url}){width=200}`.length;
    await bootCore(page, original);
    try {
        const image = page.locator('#editor .mu-inline-image img');
        await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(160);
        await image.click();
        const handle = page.locator('.mu-transformer .bar.right');
        await expect(handle).toBeVisible();
        const box = await handle.boundingBox();
        if (!box) throw new Error('Image resize handle has no bounds');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
        await expect(image).toHaveAttribute('width', '200');
        await page.mouse.up();
        expect(await readCore(page)).toMatchObject({ source: { source: expected }, anchor: caret, caret, legacyCalls: [] });
        await expect(image).toHaveAttribute('width', '200');
        await expect(image).toHaveAttribute('alt', 'A sunny sandy beach');
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: `${expected.slice(0, -1)}X\n` }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: expected } });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: original } });
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: expected });
        await page.evaluate(async (source) => {
            window.coreBoundary.dispose();
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        }, expected);
        await expect(image).toHaveAttribute('width', '200');
        await expect(image).toHaveAttribute('alt', 'A sunny sandy beach');
        expect(await readCore(page)).toMatchObject({ source: { source: expected }, legacyCalls: [] });
    }
    finally {
        await disposeCore(page);
    }
});

for (const annotated of [false, true]) {
    test(`native rich clipboard preserves image layout from ${annotated ? 'CM' : 'plain'} labels`, async ({ page }) => {
        await page.route(url, route => route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>',
        }));
        const label = annotated ? 'A {++sunny ++}{++sandy ++}beach{>>keep<<}' : 'A sunny sandy beach';
        const original = `![${label}](${url}){width=160 height=80 data-align=center}\n\nend\n`;
        const imported = `<img src="${url}" alt="A sunny sandy beach" width="160" height="80" data-align="center">`;
        const standalone = await page.evaluate(async (html) => {
            const muya = window.muya!;
            muya.setContent('end\n');
            muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 3);
            const data = new DataTransfer();
            data.setData('text/plain', 'A sunny sandy beach');
            data.setData('text/html', `<p>${html}</p>`);
            await muya.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            muya.flush();
            return muya.getMarkdown();
        }, imported);
        expect(standalone).toBe(`end${imported}\n`);
        await bootCore(page, original, {
            setup: async () => {
                await window.coreBoundary.prepareClipboardCopy();
            },
        });
        try {
            const images = page.locator('#editor .mu-inline-image img');
            await images.first().click();
            const copied = await page.evaluate(() => window.coreBoundary.guardedClipboard('copy'));
            // Ordinary rich copy publishes Revised text and HTML; the original
            // document retains its independent suggestions and comment.
            expect(copied.text.trim()).toBe(`![A sunny sandy beach](${url}){width=160 height=80 data-align=center}`);
            expect(copied.html).toContain('width="160" height="80" data-align="center"');
            await page.locator('#editor .mu-paragraph-content').last().click();
            await page.keyboard.press('End');
            await page.evaluate(async ({ text, html }) => {
                const data = new DataTransfer();
                data.setData('text/plain', text);
                data.setData('text/html', html);
                await window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
                window.muya!.flush();
                await window.coreBoundary.settle();
            }, copied);
            const expected = `${original.slice(0, -1)}${imported}\n`;
            expect(await readCore(page)).toMatchObject({ source: { source: expected }, legacyCalls: [] });
            await expect(images).toHaveCount(2);
            await expect(images.last()).toHaveAttribute('width', '160');
            await expect(images.last()).toHaveAttribute('height', '80');
            await page.keyboard.type('X');
            expect(await readCore(page)).toMatchObject({ source: { source: `${expected.slice(0, -1)}X\n` }, legacyCalls: [] });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: expected } });
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: original } });
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: expected });
        }
        finally { await disposeCore(page); }
    });
}

test('repeated tracked native resizing presents the latest width while preserving the old width and alt suggestions', async ({ page }) => {
    await page.route(url, route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>',
    }));
    const original = `![a{++b++}c{>>keep<<}](${url}){width=120}\n`;
    const firstResize = `![a{++b++}c{>>keep<<}](${url}){width={~~120~>200~~}}\n`;
    const expected = `![a{++b++}c{>>keep<<}](${url}){width={~~120~>240~~}}\n`;
    await bootCore(page, original, { tracked: true });
    try {
        const image = page.locator('#editor .mu-inline-image img');
        await expect(image).toHaveAttribute('width', '120');
        await image.click();
        const handle = page.locator('.mu-transformer .bar.right');
        await expect(handle).toBeVisible();
        const box = await handle.boundingBox();
        if (!box) throw new Error('Missing tracked image resize handle');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
        await page.mouse.up();
        expect(await readCore(page)).toMatchObject({ source: { source: firstResize }, legacyCalls: [] });
        await expect(image).toHaveAttribute('width', '200');
        await expect(image).toHaveAttribute('alt', 'abc');
        await image.click();
        await expect(handle).toBeVisible();
        const secondBox = await handle.boundingBox();
        if (!secondBox) throw new Error('Missing repeated image resize handle');
        await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(secondBox.x + secondBox.width / 2 + 40, secondBox.y + secondBox.height / 2, { steps: 4 });
        await page.mouse.up();
        expect(await readCore(page)).toMatchObject({ source: { source: expected }, legacyCalls: [] });
        await expect(image).toHaveAttribute('width', '240');
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: `${expected.slice(0, -1)}{++X++}\n` }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: expected } });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: firstResize } });
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source: original } });
        await expect(image).toHaveAttribute('width', '120');
        await coreHistory(page, 'redo');
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: expected });
        await page.evaluate(async (source) => {
            window.coreBoundary.dispose();
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, true);
        }, expected);
        await expect(image).toHaveAttribute('width', '240');
        await expect(image).toHaveAttribute('alt', 'abc');
    }
    finally { await disposeCore(page); }
});
