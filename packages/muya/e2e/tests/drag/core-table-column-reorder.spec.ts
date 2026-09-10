import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor, floats } from '../helpers/selectors';

async function moveDimension(page: Page, table: Locator, from: number, to: number, axis: 'row' | 'column' = 'column') {
    const cell = (index: number) => axis === 'column' ? table.locator('tr').last().locator('td').nth(index) : table.locator('tr').nth(index).locator('td').last();
    const first = await cell(from).boundingBox();
    const second = await cell(to).boundingBox();
    if (!first || !second)
        throw new Error('Missing reorder cell geometry');
    const probeX = first.x + (axis === 'column' ? first.width / 2 : first.width + 10);
    const probeY = first.y + (axis === 'column' ? first.height + 10 : first.height / 2);
    await page.mouse.move(probeX, probeY);
    await page.waitForTimeout(80);
    await page.mouse.move(probeX, probeY + 1);
    const bar = page.locator(floats.tableDragBar);
    await expect.poll(() => bar.evaluate((element) => {
        const wrapper = element.closest('.mu-float-wrapper') as HTMLElement | null;
        return Number.parseFloat(wrapper?.style.opacity || '0');
    })).toBeGreaterThan(0);
    const box = await bar.boundingBox();
    if (!box)
        throw new Error('Missing reorder bar geometry');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // The native widget deliberately arms a drag after a 300 ms hold.
    await page.waitForTimeout(400);
    const targetX = axis === 'column' ? (from < to ? second.x + second.width + 10 : second.x - 10) : x;
    const targetY = axis === 'row' ? (from < to ? second.y + second.height + 10 : second.y - 10) : y;
    await page.mouse.move((x + targetX) / 2, (y + targetY) / 2, { steps: 5 });
    await page.mouse.move(targetX, targetY, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.locator(`${editor.table} .mu-cell-transform`).count()).toBe(0);
}

for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
    test(`${bound ? `Core ${tracked ? 'tracked ' : ''}annotated` : 'upstream'} column drag moves owned cells and keeps their caret through the next key`, async ({ page }, testInfo) => {
        const source = bound
            ? '| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |\n'
            : '| same | same |\n| :--- | ---: |\n| onekept | onekept |\n';
        const reordered = tracked
            ? '{~~| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~>| same | same |\n| ---: | :--- |\n| onekept | one{++kept++}{>>note<<} |~~}\n'
            : bound
                ? '| same | same |\n| ---: | :--- |\n| onekept | one{++kept++}{>>note<<} |\n'
                : '| same    | same    |\n| -------:|:------- |\n| onekept | onekept |\n';
        const typed = tracked
            ? '{~~| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~>| same | same |\n| ---: | :--- |\n| onekept | oXne{++kept++}{>>note<<} |~~}\n'
            : bound
                ? '| same | same |\n| ---: | :--- |\n| onekept | oXne{++kept++}{>>note<<} |\n'
                : '| same    | same     |\n| -------:|:-------- |\n| onekept | oXnekept |\n';
        await page.evaluate(async ({ source, bound, tracked }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
            }
            else { window.muya!.setContent(source); }
        }, { source, bound, tracked });
        try {
            const table = page.locator(editor.table).first();
            const cells = table.locator('tr').last().locator('td');
            await cells.first().click();
            await page.keyboard.press('Home');
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.offset)).toBe(1);
            await moveDimension(page, table, 0, 1);
            const observation = await page.evaluate((bound) => {
                window.muya!.flush();
                const selection = window.muya!.getSelection();
                return {
                    source: bound ? window.coreBoundary.read().source : window.muya!.getMarkdown(),
                    selection: { anchor: selection?.anchor.offset, focus: selection?.focus.offset, column: selection?.anchor.block.domNode?.closest('td')?.cellIndex, text: selection?.anchor.block.text },
                    legacyCalls: bound ? window.coreBoundary.read().legacyCalls : undefined,
                    recovery: bound ? window.coreBoundary.recovery() : undefined,
                };
            }, bound);
            const observationPath = testInfo.outputPath('column-reorder-observation.json');
            await writeFile(observationPath, JSON.stringify(observation, null, 2), { flag: 'wx' });
            await testInfo.attach('column-reorder-observation.json', { path: observationPath, contentType: 'application/json' });
            expect(observation.source).toEqual(bound ? expect.objectContaining({ source: reordered }) : reordered);
            expect(observation.selection).toEqual({ anchor: 1, focus: 1, column: 1, text: 'onekept' });
            if (bound)
                expect(observation.legacyCalls).toEqual([]);
            await page.keyboard.type('X');
            expect(await page.evaluate(() => {
                const selection = window.muya!.getSelection();
                return { anchor: selection?.anchor.offset, focus: selection?.focus.offset, column: selection?.anchor.block.domNode?.closest('td')?.cellIndex, text: selection?.anchor.block.text };
            })).toEqual({ anchor: 2, focus: 2, column: 1, text: 'oXnekept' });
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
                for (const expected of [reordered, source]) {
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
                }
                expect(await page.evaluate(() => window.muya!.getSelection()?.anchor.block.domNode?.closest('td')?.cellIndex)).toBe(0);
                for (const expected of [reordered, typed]) {
                    await page.evaluate(() => window.coreBoundary.history('redo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
                }
                expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
                if (tracked) {
                    await moveDimension(page, page.locator(editor.table).last(), 1, 0);
                    expect(await page.evaluate(() => {
                        const selection = window.muya!.getSelection();
                        return { offset: selection?.anchor.offset, column: selection?.anchor.block.domNode?.closest('td')?.cellIndex };
                    })).toEqual({ offset: 2, column: 0 });
                    await page.keyboard.type('Y');
                    const movedAgain = '{~~| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~>| same | same |\n| :--- | ---: |\n| oXne{++kept++}{>>note<<} | onekept |~~}\n';
                    const typedAgain = '{~~| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~>| same | same |\n| :--- | ---: |\n| oXYne{++kept++}{>>note<<} | onekept |~~}\n';
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typedAgain });
                    for (const expected of [movedAgain, typed]) {
                        await page.evaluate(() => window.coreBoundary.history('undo'));
                        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
                    }
                    for (const expected of [movedAgain, typedAgain]) {
                        await page.evaluate(() => window.coreBoundary.history('redo'));
                        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
                    }
                    expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
                }
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe(typed);
            }
        }
        finally {
            if (bound)
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const tracked of [false, true]) {
    test(`row promotion materializes the selected empty header cell (Track=${tracked})`, async ({ page }) => {
        const source = '| a | b |\n| --- | --- |\n| x |\n';
        const header = '| x |     |\n| --- | --- |\n| a | b |';
        const expected = tracked ? `{~~| a | b |\n| --- | --- |\n| x |~>${header}~~}\n` : header + '\n';
        const typed = tracked ? '{~~| a | b |\n| --- | --- |\n| x |~>| x |     X|\n| --- | --- |\n| a | b |~~}\n' : '| x |     X|\n| --- | --- |\n| a | b |\n';
        await page.evaluate(async ({ source, tracked }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
        }, { source, tracked });
        try {
            const table = page.locator(editor.table).first();
            await table.locator('tr').nth(1).locator('td').nth(1).click();
            await moveDimension(page, table, 1, 0, 'row');
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
            expect(await page.evaluate(() => {
                const point = window.muya!.getSelection()?.anchor;
                return { offset: point?.offset, row: point?.block.domNode?.closest('tr')?.rowIndex, column: point?.block.domNode?.closest('td')?.cellIndex };
            })).toEqual({ offset: 0, row: 0, column: 1 });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
            for (const text of [expected, source]) {
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: text });
            }
            for (const text of [expected, typed]) {
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: text });
            }
            expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
    test(`row drag retains identical annotated cells (Core=${bound}, Track=${tracked})`, async ({ page }) => {
        const source = bound
            ? '| same | same |\n| ---- | ---- |\n| sa{++me++}{>>note<<} | same |\n| same | same |\n'
            : '| same | same |\n| ---- | ---- |\n| same | same |\n| same | same |\n';
        const moved = '| same | same |\n| ---- | ---- |\n| same | same |\n| sa{++me++}{>>note<<} | same |';
        const reordered = tracked ? `{~~${source.slice(0, -1)}~>${moved}~~}\n` : bound ? moved + '\n' : source;
        const typed = tracked
            ? `{~~${source.slice(0, -1)}~>| same | same |\n| ---- | ---- |\n| same | same |\n| sXa{++me++}{>>note<<} | same |~~}\n`
            : bound ? '| same | same |\n| ---- | ---- |\n| same | same |\n| sXa{++me++}{>>note<<} | same |\n'
                : '| same  | same |\n| ----- | ---- |\n| same  | same |\n| sXame | same |\n';
        await page.evaluate(async ({ source, bound, tracked }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
            }
            else { window.muya!.setContent(source); }
        }, { source, bound, tracked });
        try {
            const table = page.locator(editor.table).first();
            await table.locator('tr').nth(1).locator('td').first().click();
            await page.keyboard.press('Home');
            await page.keyboard.press('ArrowRight');
            await moveDimension(page, table, 1, 2, 'row');
            const read = () => page.evaluate((bound) => {
                window.muya!.flush();
                return bound ? window.coreBoundary.reopen().source : window.muya!.getMarkdown();
            }, bound);
            expect(await read()).toBe(reordered);
            const selection = () => page.evaluate(() => {
                const point = window.muya!.getSelection()?.anchor;
                return { offset: point?.offset, row: point?.block.domNode?.closest('tr')?.rowIndex, column: point?.block.domNode?.closest('td')?.cellIndex };
            });
            expect(await selection()).toEqual({ offset: 1, row: 2, column: 0 });
            await page.keyboard.type('X');
            expect(await read()).toBe(typed);
            expect(await selection()).toEqual({ offset: 2, row: 2, column: 0 });
            if (bound) {
                for (const expected of [reordered, source]) {
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await read()).toBe(expected);
                }
                expect(await selection()).toEqual({ offset: 1, row: 1, column: 0 });
                for (const expected of [reordered, typed]) {
                    await page.evaluate(() => window.coreBoundary.history('redo'));
                    expect(await read()).toBe(expected);
                }
                expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
            }
        }
        finally {
            if (bound) await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}
