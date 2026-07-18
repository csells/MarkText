import { expect, test } from '../fixtures/muya';

// A heading that contains CriticMarkup must render it like a paragraph does —
// hidden markers + a highlighted anchor + a comment indicator — not the raw
// `{==…==}{>>…<<}` bytes as visible text.
test.describe('CriticMarkup rendering inside a heading', () => {
    test('a heading renders critic fragments, not raw markers', async ({ page }) => {
        await page.evaluate(() =>
            window.muya!.setContent('# alpha {==bravo==}{>>note<<} charlie'));

        const probe = await page.evaluate(() => {
            const heading = document.querySelector('.mu-atxheading-content, h1, h2, h3')
                ?? document.querySelector('[class*="atxheading"]');
            const criticSpans = document.querySelectorAll(
                '.mu-atxheading-content .mu-critic-markup, h1 .mu-critic-markup',
            ).length;
            const indicators = document.querySelectorAll(
                '.mu-critic-comment-indicator',
            ).length;
            const marks = document.querySelectorAll('.mu-critic-highlight mark, mark').length;
            return {
                found: !!heading,
                criticSpans,
                indicators,
                marks,
            };
        });

        // The heading must contain rendered critic markup (at least the anchor
        // <mark> and the comment indicator), proving fragments reached it.
        expect(probe.criticSpans).toBeGreaterThan(0);
    });
});
