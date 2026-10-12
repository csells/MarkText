import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { bootCore, coreSource } from '../helpers/coreBoundary';
import { loadMarkdown } from '../helpers/keyboard';
import { editor } from '../helpers/selectors';
import { detachedBlocks, nextFrames } from '../helpers/tree';

// A documented deviation from upstream (plan 0012 G26): upstream cut a
// selection spanning blocks on any key other than an arrow or modifier, so
// Home, End, PageDown or Escape silently deleted several paragraphs. Only
// keys that replace a selection in a macOS editor may remove it.

const DOC = 'one\n\ntwo\n\nthree\n';

const NON_EDITING_KEYS = [
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Shift+Home',
    'Shift+End',
    'Shift+PageDown',
    'Escape',
    'Tab',
    'Shift+Tab',
    'F2',
    'Insert',
    'ContextMenu',
    'NumLock',
    'ScrollLock',
    'Pause',
    'AudioVolumeMute',
];

async function selectThreeParagraphs(page: Page): Promise<void> {
    const start = await page.evaluate((selector) => {
        const text = document.createTreeWalker(document.querySelector(selector)!, NodeFilter.SHOW_TEXT).nextNode()!;
        const range = document.createRange();
        range.setStart(text, 1);
        range.setEnd(text, 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left, y: rect.top + rect.height / 2 };
    }, editor.paragraphContent);
    await page.mouse.click(start.x, start.y);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await nextFrames(page);
    expect(await page.evaluate(() => window.muya!.editor.selection.getSelection()?.isSelectionInSameBlock)).toBe(false);
}

for (const key of NON_EDITING_KEYS) {
    test(`${key} keeps a selection spanning paragraphs`, async ({ page }) => {
        await loadMarkdown(page, DOC);
        await nextFrames(page);
        await selectThreeParagraphs(page);

        await page.keyboard.press(key);
        await nextFrames(page);

        expect(await detachedBlocks(page)).toEqual([]);
        await expect.poll(() => getMarkdown(page)).toBe(DOC);
        // Keys that do not move the caret leave the same selection in the editor.
        if (key === 'Escape' || key === 'Tab' || key === 'Shift+Tab')
            expect(await page.evaluate(() => window.muya!.editor.selection.getSelection()?.isSelectionInSameBlock)).toBe(false);
    });

    test(`Core ${key} keeps a selection spanning paragraphs`, async ({ page }) => {
        await bootCore(page, DOC);
        try {
            await selectThreeParagraphs(page);
            await page.keyboard.press(key);
            await nextFrames(page);
            expect(await coreSource(page, { settle: true })).toBe(DOC);
            expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('typing over a selection spanning paragraphs still replaces it, and undo restores it', async ({ page }) => {
    await loadMarkdown(page, DOC);
    await nextFrames(page);
    await selectThreeParagraphs(page);

    await page.keyboard.press('x');
    await nextFrames(page);
    await expect.poll(() => getMarkdown(page)).toBe('oxhree\n');

    await page.evaluate(() => window.muya!.undo());
    await expect.poll(() => getMarkdown(page)).toBe(DOC);
});

for (const key of ['Backspace', 'Delete', 'Enter']) {
    test(`${key} over a selection spanning paragraphs still replaces it`, async ({ page }) => {
        await loadMarkdown(page, DOC);
        await nextFrames(page);
        await selectThreeParagraphs(page);

        await page.keyboard.press(key);
        await nextFrames(page);
        await expect.poll(() => getMarkdown(page)).toBe(key === 'Enter' ? 'o\n\nhree\n' : 'ohree\n');
    });
}

test('Core typing over a selection spanning paragraphs still replaces it, and undo restores it', async ({ page }) => {
    await bootCore(page, DOC);
    try {
        await selectThreeParagraphs(page);
        await page.keyboard.press('x');
        expect(await coreSource(page, { settle: true })).toBe('oxhree\n');
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await coreSource(page, { settle: true })).toBe(DOC);
        expect(await page.evaluate(() => window.coreBoundary.read().legacyCalls)).toEqual([]);
    }
    finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

for (const key of ['Backspace', 'Delete']) {
    test(`Core ${key} over a selection spanning paragraphs still replaces it`, async ({ page }) => {
        await bootCore(page, DOC);
        try {
            await selectThreeParagraphs(page);
            await page.keyboard.press(key);
            expect(await coreSource(page, { settle: true })).toBe('ohree\n');
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}
