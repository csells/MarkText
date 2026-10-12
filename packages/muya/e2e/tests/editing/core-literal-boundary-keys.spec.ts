import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const example of [
    { name: 'code', source: '```js\nbody\n```\n', changed: 'body\n', typed: 'xbody\n' },
    { name: 'CM code', source: '{++```js\nbody\n```++}\n', changed: '{++body++}\n', typed: '{++xbody++}\n' },
    { name: 'CM math', source: '{++$$\nbody\n$$++}\n', changed: '{++body++}\n', typed: '{++xbody++}\n' },
    { name: 'CM Setext heading', source: 's{++a++}me{>>keep<<}\n====\n', changed: 's{++a++}me{>>keep<<}\n', typed: 'xs{++a++}me{>>keep<<}\n' },
    { name: 'empty code', source: '```\n\n```\n', changed: '\n', typed: 'x\n' },
    { name: 'HTML', source: '<div>body</div>\n', changed: '\\<div\\>body\\<\\/div\\>\n', typed: 'x\\<div\\>body\\<\\/div\\>\n', displayed: '\\<div>body<\\/div>' },
    { name: 'HTML with dormant CM', prefix: 'before{++x++}{>>keep<<}\n\n', source: '<div>{++literal++}</div>\n', changed: '\\<div\\>\\{\\+\\+literal\\+\\+\\}\\<\\/div\\>\n', typed: 'x\\<div\\>\\{\\+\\+literal\\+\\+\\}\\<\\/div\\>\n', displayed: '\\<div>{++literal++}<\\/div>' },
]) {
    test(`actual ${example.name} boundary Backspace resets once before next key`, async ({ page }) => {
        const prefix = example.prefix ?? 'before\n\n';
        await bootCore(page, prefix + example.source, {
            setup: () => {
                window.muya!.editor.scrollPage!.lastContentInDescendant()!.setCursor(0, 0, true);
            },
        });
        try {
            await page.keyboard.press('Backspace');
            expect(await readCore(page)).toMatchObject({ source: { source: prefix + example.changed }, anchor: 0, caret: 0, legacyCalls: [] });
            if (example.displayed !== undefined) {
                const displayed = await page.evaluate(() => {
                    // What shows: hidden syntax markers take no space, and a
                    // marker the caret is in shows in gray, as upstream.
                    const text = (node: Node): string => node instanceof Element && node.hasAttribute('data-character')
                        ? node.getAttribute('data-character')!
                        : node instanceof Element && node.classList.contains('mu-hide')
                            ? ''
                            : node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : [...node.childNodes].map(text).join('');
                    const block = window.muya!.editor.selection.getSelection()!.anchor.block;
                    return { kind: block.blockName, text: text(block.domNode!) };
                });
                // The caret at the start is on the first escape's backslash; the
                // backslash before `/`, which upstream's escape rule does not
                // list, shows as text.
                expect(displayed).toEqual({ kind: 'paragraph.content', text: example.displayed });
            }
            await page.keyboard.type('x');
            expect(await readCore(page)).toMatchObject({ source: { source: prefix + example.typed }, anchor: 1, caret: 1, legacyCalls: [] });
            await coreHistory(page, 'undo');
            await coreHistory(page, 'undo');
            expect(await readCore(page)).toMatchObject({ source: { source: prefix + example.source }, anchor: 0, caret: 0 });
            await coreHistory(page, 'redo');
            await coreHistory(page, 'redo');
            expect(await reopenCore(page)).toMatchObject({ source: prefix + example.typed });
        }
        finally { await disposeCore(page); }
    });
}
