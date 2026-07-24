import { expect, test } from '@playwright/test';

/**
 * The production view in a real browser.
 *
 * `createDocumentCoreView` is what the editor will mount, so proving it in
 * Chromium — real layout, real DOM, real input — is what de-risks migrating the
 * app onto the engine (increment 5). The happy-dom unit tests check the wiring;
 * this checks the thing users will actually run.
 *
 * Edits go through typed intents against the engine, never by writing into the
 * DOM, because that is the contract the view exists to enforce: the engine
 * decides what the document says and the DOM is only its rendering.
 */

interface ViewBridge {
    modelText: () => string;
    typeText: (offset: number, text: string) => Promise<void>;
    undo: () => Promise<void>;
}

declare global {
    interface Window {
        __documentCoreView: ViewBridge;
    }
}

async function mount(page: import('@playwright/test').Page, source?: string) {
    const query = source === undefined
        ? ''
        : `?source=${encodeURIComponent(source)}`;
    await page.goto(`/document-core-view/index.html${query}`);
    const host = page.locator('#document-core-view');
    await expect(host).toHaveAttribute('data-ready', 'true');
    return host;
}

test.describe('document-core production view', () => {
    test('renders engine blocks with CriticMarkup in a real browser', async ({ page }) => {
        const host = await mount(page);
        // Real block elements, not a flat run soup.
        await expect(host.locator('h1')).toHaveText('# Title');
        await expect(host.locator('p')).toHaveText('Hello world.');
        // The tracked addition renders as an insertion, and the markers never
        // leak into what the reader sees.
        await expect(host.locator('ins')).toHaveText('world');
        await expect(host).not.toContainText('{++');
        await expect(host).not.toContainText('++}');
    });

    test('honours heading levels the engine parsed', async ({ page }) => {
        const host = await mount(page, '# One\n\n### Three\n');
        await expect(host.locator('h1')).toHaveText('# One');
        await expect(host.locator('h3')).toHaveText('### Three');
    });

    test('commits an edit and re-renders from the new revision', async ({ page }) => {
        const host = await mount(page, 'Hello world.\n');
        await page.evaluate(() => window.__documentCoreView.typeText(5, ' there'));
        await expect(host.locator('p')).toHaveText('Hello there world.');
        expect(await page.evaluate(() => window.__documentCoreView.modelText()))
            .toBe('Hello there world.\n');
    });

    test('leaves a tracked change intact when editing beside it', async ({ page }) => {
        const host = await mount(page, 'Hello {++world++}.\n');
        await page.evaluate(() => window.__documentCoreView.typeText(0, 'Oh, '));
        // Editing next to a tracked change must not accept or disturb it.
        await expect(host.locator('ins')).toHaveText('world');
        await expect(host.locator('p')).toHaveText('Oh, Hello world.');
    });

    test('undoes back to the exact prior document', async ({ page }) => {
        const host = await mount(page, 'Hello world.\n');
        await page.evaluate(() => window.__documentCoreView.typeText(5, '!'));
        await expect(host.locator('p')).toHaveText('Hello! world.');
        await page.evaluate(() => window.__documentCoreView.undo());
        await expect(host.locator('p')).toHaveText('Hello world.');
        expect(await page.evaluate(() => window.__documentCoreView.modelText()))
            .toBe('Hello world.\n');
    });

    test('splits a block-spanning addition into real block elements', async ({ page }) => {
        const host = await mount(page, 'a{++\n\n++}b');
        await expect(host.locator('p')).toHaveCount(2);
        await expect(host.locator('p').first()).toHaveText('a');
        await expect(host.locator('p').last()).toHaveText('b');
    });
});
