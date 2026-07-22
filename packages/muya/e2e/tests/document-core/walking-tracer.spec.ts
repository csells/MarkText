import { expect, test } from '@playwright/test';
import { TemporaryUtf8FileSnapshot } from '../helpers/temporaryFileSnapshot';

test.describe('document-core Phase 0 walking tracer', () => {
    test('mounts an empty committed plan with a browser caret', async ({ page }) => {
        await page.goto('/document-core-tracer/?fixture=empty');

        const editor = page.locator('#document-core-editor');
        await expect(editor).toHaveText('');
        await expect(editor).toHaveAttribute('data-model-caret', '0');
        await expect(editor).toHaveAttribute('data-revision', /.+/);
        expect(await editor.evaluate((element) => {
            const selection = window.getSelection();
            return selection?.anchorNode === element && selection.anchorOffset === 0;
        })).toBe(true);
    });

    test('walks one Addition through browser input, history, and exact-byte save', async ({ page }, testInfo) => {
        const fileSnapshot = new TemporaryUtf8FileSnapshot(testInfo.outputPath('canonical.md'));
        await page.exposeBinding(
            'persistDocumentCoreSnapshot',
            async (_source, chunks: readonly string[]) => fileSnapshot.replace(chunks),
        );
        await page.goto('/document-core-tracer/');

        const editor = page.locator('#document-core-editor');
        await expect(editor).toHaveText('anewb');
        await expect(editor.locator('ins')).toHaveText('new');
        await expect(editor).not.toContainText('{++');
        await expect(editor).not.toContainText('++}');
        await expect(editor).toHaveAttribute('data-model-caret', '5');
        await expect(editor).toHaveAttribute('data-revision', /.+/);

        const openingRevision = await editor.getAttribute('data-revision');
        if (openingRevision === null)
            throw new Error('The tracer did not expose its opening revision');
        await editor.evaluate((element) => {
            const auditWindow = window as Window & {
                __documentCoreObservedGenerations?: Array<{ revision: string; text: string }>;
            };
            const record = (): void => {
                auditWindow.__documentCoreObservedGenerations?.push({
                    revision: element.dataset.revision ?? '',
                    text: element.textContent ?? '',
                });
            };
            auditWindow.__documentCoreObservedGenerations = [];
            record();
            new MutationObserver(record).observe(element, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true,
            });
        });
        await editor.focus();
        await editor.evaluate((element) => {
            const range = document.createRange();
            range.setStart(element, element.childNodes.length);
            range.collapse(true);
            const selection = window.getSelection();
            if (selection === null)
                throw new Error('Browser selection is unavailable');
            selection.removeAllRanges();
            selection.addRange(range);
        });
        await page.keyboard.type('!');

        await expect(editor).toHaveAttribute('data-beforeinput-trusted', 'true');
        await expect(editor).toHaveAttribute('data-beforeinput-prevented', 'true');
        await expect(editor).toHaveAttribute('data-beforeinput-dom', 'anewb');
        await expect(editor).toHaveAttribute('data-beforeinput-revision', openingRevision);
        await expect(editor).toHaveAttribute('data-input-events', '0');
        await expect(editor).toHaveText('anewb!');
        await expect(editor).toHaveAttribute('data-model-caret', '6');
        await expect(editor).not.toHaveAttribute('data-revision', openingRevision);

        const insertedRevision = await editor.getAttribute('data-revision');
        if (insertedRevision === null)
            throw new Error('The tracer did not expose its inserted revision');

        await page.evaluate(async () => {
            if (window.documentCoreTracer === undefined)
                throw new Error('The document-core tracer controller is unavailable');
            await window.documentCoreTracer.undo();
        });
        await expect(editor).toHaveText('anewb');
        await expect(editor).toHaveAttribute('data-model-caret', '5');
        await expect(editor).not.toHaveAttribute('data-revision', insertedRevision);
        const undoSaveRelease = await page.evaluate(async () => {
            if (window.documentCoreTracer === undefined)
                throw new Error('The document-core tracer controller is unavailable');
            return window.documentCoreTracer.save();
        });
        expect(undoSaveRelease).toBe('released');
        expect(await fileSnapshot.readBytes()).toEqual(Buffer.from('a{++new++}b', 'utf8'));

        const undoneRevision = await editor.getAttribute('data-revision');
        if (undoneRevision === null)
            throw new Error('The tracer did not expose its undone revision');
        expect(undoneRevision).not.toBe(openingRevision);

        await page.evaluate(async () => {
            if (window.documentCoreTracer === undefined)
                throw new Error('The document-core tracer controller is unavailable');
            await window.documentCoreTracer.redo();
        });
        await expect(editor).toHaveText('anewb!');
        await expect(editor).toHaveAttribute('data-model-caret', '6');
        await expect(editor).not.toHaveAttribute('data-revision', undoneRevision);

        const redoneRevision = await editor.getAttribute('data-revision');
        if (redoneRevision === null)
            throw new Error('The tracer did not expose its redone revision');
        expect(redoneRevision).not.toBe(openingRevision);
        expect(redoneRevision).not.toBe(insertedRevision);
        const redoSaveRelease = await page.evaluate(async () => {
            if (window.documentCoreTracer === undefined)
                throw new Error('The document-core tracer controller is unavailable');
            return window.documentCoreTracer.save();
        });
        expect(redoSaveRelease).toBe('released');
        expect(await fileSnapshot.readBytes()).toEqual(Buffer.from('a{++new++}b!', 'utf8'));

        const generations = await page.evaluate(() => {
            if (window.documentCoreTracer === undefined)
                throw new Error('The document-core tracer controller is unavailable');
            return window.documentCoreTracer.generations();
        });
        expect(generations).toEqual([
            { revision: openingRevision, text: 'anewb' },
            { revision: insertedRevision, text: 'anewb!' },
            { revision: undoneRevision, text: 'anewb' },
            { revision: redoneRevision, text: 'anewb!' },
        ]);
        const observedGenerations = await page.evaluate(() => {
            const auditWindow = window as Window & {
                __documentCoreObservedGenerations?: Array<{ revision: string; text: string }>;
            };
            return auditWindow.__documentCoreObservedGenerations ?? [];
        });
        const allowedTextByRevision = new Map([
            [openingRevision, 'anewb'],
            [insertedRevision, 'anewb!'],
            [undoneRevision, 'anewb'],
            [redoneRevision, 'anewb!'],
        ]);
        for (const generation of observedGenerations)
            expect(generation.text).toBe(allowedTextByRevision.get(generation.revision));
        for (const generation of generations)
            expect(observedGenerations).toContainEqual(generation);
        await expect(editor).toHaveAttribute('data-input-events', '0');
        await expect(editor).not.toHaveAttribute('data-commit-error');
        await expect(editor).not.toHaveAttribute('data-undispatched-input');
    });
});
