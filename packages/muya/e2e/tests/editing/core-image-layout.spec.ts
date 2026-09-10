import { expect, test } from '../fixtures/muya';

const url = 'https://example.test/layout.svg';
const image = `![cat](${url})`;

for (const resize of [false, true]) {
    test(`native image ${resize ? 'resize handle' : 'alignment toolbar'} edits only the selected repeated image through Core`, async ({ page }) => {
        await page.route(url, route => route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>',
        }));
        const original = `${image} ${image}\n`;
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        }, original);
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
                property = `width="${width}"`;
                await page.mouse.up();
            }
            else {
                await page.locator('.mu-image-toolbar li.center').click();
                property = 'data-align="center"';
            }
            const expected = `${image} <img src="${url}" alt="cat" ${property} />\n`;
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, legacyCalls: [] });
            await page.keyboard.type('X');
            const typed = `${expected.slice(0, -1)}X\n`;
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: original } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('a rejected CM-label resize preserves source and restores the canonical rendered width', async ({ page }) => {
    await page.route(url, route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>',
    }));
    const original = `![a{++b++}c](${url})\n`;
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
    }, original);
    try {
        const image = page.locator('#editor .mu-inline-image img');
        await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(160);
        const width = await image.getAttribute('width');
        await image.click();
        const handle = page.locator('.mu-transformer .bar.right');
        await expect(handle).toBeVisible();
        const box = await handle.boundingBox();
        if (!box) throw new Error('Image resize handle has no bounds');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
        expect(Number(await image.getAttribute('width'))).toBeGreaterThan(160);
        await page.mouse.up();
        const result = await page.evaluate(async () => {
            let rejected = false;
            try { await window.coreBoundary.settle(); }
            catch { rejected = true; }
            return { rejected, state: window.coreBoundary.read(), recovery: window.coreBoundary.recovery() };
        });
        console.log('Rejected CM image resize', JSON.stringify({ result, width: await image.getAttribute('width') }));
        expect(result.state).toMatchObject({ source: { source: original, revision: 1, recoveryHistory: { undo: [], redo: [] } }, legacyCalls: [] });
        expect(result.recovery?.commands).toEqual([{ kind: 'format', action: { format: 'image-properties', selection: { start: 0, end: original.length - 1 }, tracked: false, properties: { width: '200' } } }]);
        expect(result.rejected).toBe(false);
        expect(await image.getAttribute('width')).toBe(width);
    }
    finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});
