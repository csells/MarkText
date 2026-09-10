import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor, floats } from '../helpers/selectors';

async function chooseFirstParagraphHeading(page: Page, paragraph = false) {
    const box = await page.locator(`${editor.paragraph}, ${editor.atxHeading}`).first().boundingBox();
    if (!box) {
        throw new Error('Missing target paragraph geometry');
    }
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.waitForTimeout(50);
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    await expect.poll(() => page.locator(floats.paragraphFrontButton).evaluate(el => Number.parseFloat((el as HTMLElement).style.opacity || '0'))).toBeGreaterThan(0);
    await page.locator(floats.paragraphFrontButtonInner).click();
    if (paragraph) {
        await page.locator(`${floats.paragraphFrontMenu} .turn-into-item.paragraph`).click();
    }
    else { await page.locator(`${floats.paragraphFrontMenu} .turn-into-item.atx-heading`).nth(1).click(); }
}

for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
    test(`front-menu heading targets its hovered paragraph when the caret is elsewhere (Core=${bound}, Track=${tracked})`, async ({ page }) => {
        const source = bound ? 'a{++a++}a\n\nelsewhere\n' : 'aaa\n\nelsewhere\n';
        await page.evaluate(async ({ source, bound, tracked }) => {
            const muya = window.muya!;
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
            }
            else {
                muya.setContent(source);
            }
            const first = muya.editor.scrollPage!.firstContentInDescendant()!;
            const other = first.nextContentInContext()!;
            other.setCursor(3, 3, true);
            muya.focus();
            muya.flush();
        }, { source, bound, tracked });
        try {
            await chooseFirstParagraphHeading(page);
            const heading = tracked ? `{++## ++}${source}` : `## ${source}`;
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading }, anchor: 6, caret: 6, legacyCalls: [] });
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe(heading);
            }
            await page.keyboard.type('X');
            const typed = tracked ? '{++## ++}a{++a++}a{++X++}\n\nelsewhere\n' : bound ? '## a{++a++}aX\n\nelsewhere\n' : '## aaaX\n\nelsewhere\n';
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: heading });
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe(typed);
                await page.evaluate(() => window.muya!.undo());
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(heading);
                await page.evaluate(() => window.muya!.undo());
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(source);
                await page.evaluate(() => window.muya!.redo());
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(heading);
            }
        }
        finally {
            if (bound) {
                await page.evaluate(() => window.coreBoundary.dispose());
            }
        }
    });
}

for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
    test(`front-menu current heading level leaves the other caret untouched (Core=${bound}, Track=${tracked})`, async ({ page }) => {
        const source = bound ? '## a{++a++}a\n\nelsewhere\n' : '## aaa\n\nelsewhere\n';
        await page.evaluate(async ({ source, bound, tracked }) => {
            const muya = window.muya!;
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
            }
            else {
                muya.setContent(source);
            }
            const other = muya.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!;
            other.setCursor(3, 3, true);
            muya.focus();
            muya.flush();
        }, { source, bound, tracked });
        try {
            await chooseFirstParagraphHeading(page);
            expect(await page.evaluate(() => {
                const selected = window.muya!.editor.selection.getSelection();
                return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, text: selected?.focus.block.text };
            })).toEqual({ anchor: 3, focus: 3, text: 'elsewhere' });
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            }
            else {
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(source);
            }
            await page.keyboard.type('X');
            const typed = source.replace('elsewhere', tracked ? 'els{++X++}ewhere' : 'elsXewhere');
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe(typed);
                await page.evaluate(() => window.muya!.undo());
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(source);
            }
        }
        finally {
            if (bound) {
                await page.evaluate(() => window.coreBoundary.dispose());
            }
        }
    });
}

for (const { bound, tracked } of [{ bound: false, tracked: false }, { bound: true, tracked: false }, { bound: true, tracked: true }]) {
    test(`front-menu paragraph targets its hovered heading when the caret is elsewhere (Core=${bound}, Track=${tracked})`, async ({ page }) => {
        const source = bound ? '## a{++a++}a\n\nelsewhere\n' : '## aaa\n\nelsewhere\n';
        await page.evaluate(async ({ source, bound, tracked }) => {
            const muya = window.muya!;
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
            }
            else { muya.setContent(source); }
            const other = muya.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!;
            other.setCursor(3, 3, true);
            muya.focus();
            muya.flush();
        }, { source, bound, tracked });
        try {
            await chooseFirstParagraphHeading(page, true);
            const paragraph = tracked ? '{--## --}a{++a++}a\n\nelsewhere\n' : bound ? 'a{++a++}a\n\nelsewhere\n' : 'aaa\n\nelsewhere\n';
            expect(await page.evaluate(() => {
                const selected = window.muya!.editor.selection.getSelection();
                return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, text: selected?.focus.block.text };
            })).toEqual({ anchor: tracked ? 6 : 3, focus: tracked ? 6 : 3, text: tracked ? '## aaa' : 'aaa' });
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: paragraph }, legacyCalls: [] });
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe(paragraph);
            }
            await page.keyboard.type('X');
            const typed = tracked ? '{--## --}a{++a++}a{++X++}\n\nelsewhere\n' : bound ? 'a{++a++}aX\n\nelsewhere\n' : 'aaaX\n\nelsewhere\n';
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: paragraph } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
                await page.evaluate(() => window.coreBoundary.history('redo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: paragraph });
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe(typed);
                await page.evaluate(() => window.muya!.undo());
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(paragraph);
                await page.evaluate(() => window.muya!.undo());
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(source);
                await page.evaluate(() => window.muya!.redo());
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(paragraph);
            }
        }
        finally {
            if (bound) {
                await page.evaluate(() => window.coreBoundary.dispose());
            }
        }
    });
}
