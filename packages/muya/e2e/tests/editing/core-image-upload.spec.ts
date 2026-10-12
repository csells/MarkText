import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, coreSource, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

test('image picker upload retains its owned annotation and later typing without loading source', async ({ page }) => {
    const source = '![a{++a++}a]()\n\nafter\n';
    await bootCore(page, source, {
        setup: () => {
            window.__e2e!.imageAction = () => new Promise<string>((resolve) => {
                window.finishImagePickerUpload = resolve;
            });
        },
    });
    try {
        await page.locator('#editor .mu-empty-image').click();
        const picker = page.locator('.mu-image-selector');
        await picker.locator('input.src').fill('/chosen.png');
        await picker.locator('button.role-button.link').click();
        await page.waitForFunction(() => typeof window.finishImagePickerUpload === 'function');
        expect.soft(await coreSource(page)).toBe(source);
        await expect(page.locator('.mu-image-uploading')).toBeVisible();
        await page.evaluate(() => window.muya!.editor.scrollPage!.lastContentInDescendant()!.setCursor(5, 5));
        await page.keyboard.type('X');
        expect.soft(await coreSource(page)).toBe('![a{++a++}a]()\n\nafterX\n');
        await page.evaluate(() => window.finishImagePickerUpload('/uploaded.png'));
        await expect.poll(async () => (await coreSource(page))).toBe('![a{++a++}a](/uploaded.png)\n\nafterX\n');
        expect(await readCore(page)).toMatchObject({ caret: 6, legacyCalls: [] });
        await expect(page.locator('.mu-image-uploading')).toHaveCount(0);
        await page.keyboard.type('Y');
        expect(await reopenCore(page)).toMatchObject({ source: '![a{++a++}a](/uploaded.png)\n\nafterXY\n' });
        await coreHistory(page, 'undo');
        await coreHistory(page, 'undo');
        expect(await coreSource(page)).toBe('![a{++a++}a]()\n\nafterX\n');
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: '![a{++a++}a](/uploaded.png)\n\nafterX\n' });
    }
    finally { await disposeCore(page); }
});

for (const chosen of ['', 'https://example.test/chosen.png']) {
    test(`native image file chooser ${chosen ? 'retains its original target' : 'cancels without editing or holding save'}`, async ({ page }) => {
        const source = '![a]()\n\n![a]()\n\nafter\n';
        await bootCore(page, source, {
            setup: () => {
                window.__e2e!.imagePathPicker = () => new Promise<string>((resolve) => {
                    window.finishImageFileChooser = resolve;
                });
            },
        });
        try {
            const picker = page.locator('.mu-image-selector');
            await page.locator('#editor .mu-empty-image').first().click();
            await picker.locator('.header').getByText('Select', { exact: true }).click();
            await test.step('start the native chooser callback', async () => {
                await picker.locator('button.role-button.select').click({ timeout: 5000 });
                await page.waitForFunction(() => typeof window.finishImageFileChooser === 'function', undefined, { timeout: 5000 });
            });
            await test.step('move to another image while the chooser is pending', async () => {
                // The old picker remains open while the native chooser waits.
                // Dismiss it through the existing document-click behavior before
                // selecting the image behind it; never force a covered click.
                const paragraph = page.locator('#editor p').last();
                const bounds = await paragraph.boundingBox();
                expect(bounds).not.toBeNull();
                await paragraph.click({ position: { x: bounds!.width - 4, y: bounds!.height / 2 }, timeout: 5000 });
                await page.locator('#editor .mu-empty-image').nth(1).click({ timeout: 5000 });
            });
            await page.evaluate(() => window.muya!.editor.scrollPage!.lastContentInDescendant()!.setCursor(5, 5));
            await page.keyboard.type('X');
            await page.evaluate(chosen => window.finishImageFileChooser(chosen), chosen);
            await page.evaluate(() => window.coreBoundary.settle());
            const expected = chosen ? `![a](${chosen})\n\n![a]()\n\nafterX\n` : '![a]()\n\n![a]()\n\nafterX\n';
            await expect.poll(() => coreSource(page)).toBe(expected);
            expect(await readCore(page)).toMatchObject({ caret: 6, legacyCalls: [] });
            expect(await reopenCore(page)).toMatchObject({ source: expected });
            await expect(page.locator('.mu-image-uploading')).toHaveCount(0);
            await page.keyboard.type('Y');
            expect(await coreSource(page)).toBe(chosen ? `![a](${chosen})\n\n![a]()\n\nafterXY\n` : '![a]()\n\n![a]()\n\nafterXY\n');
            await coreHistory(page, 'undo');
            // Cancelling contributes no edit/history boundary: adjacent X/Y
            // typing remains one native undo group. A completed image change
            // separates the two typing groups.
            expect(await coreSource(page)).toBe(chosen ? expected : source);
            if (chosen) {
                await coreHistory(page, 'undo');
                expect(await coreSource(page)).toBe('![a]()\n\n![a]()\n\nafterX\n');
                await coreHistory(page, 'redo');
                expect(await reopenCore(page)).toMatchObject({ source: expected });
            }
            else {
                await coreHistory(page, 'redo');
                expect(await coreSource(page)).toBe('![a]()\n\n![a]()\n\nafterXY\n');
            }
        }
        finally { await disposeCore(page); }
    });
}

declare global {
    // eslint-disable-next-line ts/naming-convention -- browser fixture extension
    interface Window {
        finishImagePickerUpload: (src: string) => void;
        finishImageFileChooser: (src: string) => void;
    }
}

test('editing the first of two identical empty images keeps its exact widget target', async ({ page }) => {
    const source = '![a]() ![a]()\n';
    await bootCore(page, source);
    try {
        await page.locator('#editor .mu-empty-image').first().click();
        const picker = page.locator('.mu-image-selector');
        await picker.locator('input.src').fill('https://example.test/first.png');
        await picker.locator('button.role-button.link').click();
        await expect.poll(() => coreSource(page)).toBe('![a](https://example.test/first.png) ![a]()\n');
        expect(await readCore(page)).toMatchObject({ legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await coreSource(page)).toBe('![a](https://example.test/first.png)X ![a]()\n');
        await coreHistory(page, 'undo');
        await coreHistory(page, 'undo');
        expect(await coreSource(page)).toBe(source);
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: '![a](https://example.test/first.png) ![a]()\n' });
    }
    finally { await disposeCore(page); }
});
