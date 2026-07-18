import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

// A same-block selection must be committed into Muya's persistent selection
// model by Muya's own mouse handlers, so an authoring command (Add Comment) can
// resolve the intended range even after focus leaves the editor. Before the
// fix, handleMousemoveOrClick early-returned for a same-block selection and
// mouseup committed nothing, leaving the model at the stale pre-drag caret.
test.describe('same-block selection commits on mouseup', () => {
    async function driveDrag(
        page: Parameters<Parameters<typeof test>[1]>[0]['page'],
        backward: boolean,
    ) {
        return page.evaluate((rtl) => {
            const muya = window.muya!;
            const root = muya.domNode;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node: Text | null = null;
            while (walker.nextNode()) {
                const candidate = walker.currentNode as Text;
                if ((candidate.textContent ?? '').includes('honey')) {
                    node = candidate;
                    break;
                }
            }
            if (!node)
                return null;
            const i = node.textContent!.indexOf('honey');
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            if (rtl)
                selection.setBaseAndExtent(node, i + 5, node, i);
            else
                selection.setBaseAndExtent(node, i, node, i + 5);

            // Drive Muya's own mouse handlers over the established range: a real
            // drag is mousedown -> mousemove(s) -> mouseup.
            root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            root.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
            root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

            // eslint-disable-next-line ts/no-explicit-any
            const sel = (muya as any).editor.selection;
            return { anchor: sel.anchor?.offset ?? null, focus: sel.focus?.offset ?? null };
        }, backward);
    }

    test('a forward same-block drag commits its range into the model', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('hello my honey hello my baby'));
        await page.locator(editor.paragraph).first().click();

        // 'honey' is offset 9..14 in 'hello my honey hello my baby'.
        expect(await driveDrag(page, false)).toEqual({ anchor: 9, focus: 14 });
    });

    test('a backward same-block drag keeps its direction', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('hello my honey hello my baby'));
        await page.locator(editor.paragraph).first().click();

        expect(await driveDrag(page, true)).toEqual({ anchor: 14, focus: 9 });
    });
});
