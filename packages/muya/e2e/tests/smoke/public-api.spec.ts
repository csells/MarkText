import { expect, test } from '../fixtures/muya';
import { getComments, getMarkdown, getTOC } from '../helpers/api';

test.describe('public api', () => {
    test('setContent then getMarkdown round-trips', async ({ page }) => {
        await page.evaluate(() => {
            window.muya!.setContent('# Title\n\nHello world\n');
        });
        const md = await getMarkdown(page);
        expect(md).toContain('# Title');
        expect(md).toContain('Hello world');
    });

    test('getTOC reflects headings in the document', async ({ page }) => {
        await page.evaluate(() => {
            window.muya!.setContent('# H1\n\n## H2\n\n### H3\n\ntext\n');
        });
        const toc = await getTOC(page);
        expect(toc.length).toBe(3);
        expect(toc.map(item => ({ lvl: item.lvl, content: item.content }))).toEqual([
            { lvl: 1, content: 'H1' },
            { lvl: 2, content: 'H2' },
            { lvl: 3, content: 'H3' },
        ]);
        expect(toc[0].slug).toBeTruthy();
        expect(toc[0].githubSlug).toBe('h1');
    });

    test('getComments reflects portable markdown comments', async ({ page }) => {
        await page.evaluate(() => {
            window.muya!.setContent([
                'A <!--MC:a-->reviewed<!--MC:~a--> span.',
                '',
                '[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
                '',
            ].join('\n'));
        });
        const comments = await getComments(page);
        expect(comments.diagnostics).toEqual([]);
        expect(comments.ranges).toEqual([
            expect.objectContaining({
                id: 'a',
                // Clean-text offsets: markers live out-of-band at runtime.
                startOffset: 2,
                endOffset: 10,
            }),
        ]);
        expect(comments.threads).toEqual([
            expect.objectContaining({
                id: 'a',
                status: 'open',
            }),
        ]);
    });

    test('locale switch flips muya.i18n.lang', async ({ page }) => {
        const before = await page.evaluate(() => window.muya!.i18n.lang);
        expect(before).toBe('en');
        await page.locator('#language-select').selectOption('zh-CN');
        const after = await page.evaluate(() => window.muya!.i18n.lang);
        expect(after).toBe('zh-CN');
    });
});
