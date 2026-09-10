import { expect, test } from '../fixtures/muya';

for (const text of ['plain', 'plain\nsecond']) {
    for (const tracked of [false, true]) {
        test(`quote and unquote a complete addition with its lazy continuation (Track=${tracked}, text=${JSON.stringify(text)})`, async ({ page }) => {
            const source = `{++${text}++}\n`;
            const quoted = tracked ? `{++> ${text}++}\n` : `> {++${text}++}\n`;
            const typed = tracked ? `{++> ${text}!++}\n` : `> {++${text}!++}\n`;
            await page.evaluate(async ({ source, tracked }) => {
                const muya = window.muya!;
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
                const content = muya.editor.scrollPage!.firstContentInDescendant()!;
                content.setCursor(content.text.length, content.text.length, true);
                muya.editor.activeContentBlock = content;
                muya.updateParagraph('blockquote');
            }, { source, tracked });
            try {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: quoted }, caret: text.length, legacyCalls: [] });
                await expect(page.locator('.mu-block-quote')).toHaveCount(1);
                await page.keyboard.type('!');
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, caret: text.length + 1, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: quoted } });
                await page.evaluate(() => {
                    const content = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
                    content.setCursor(0, 0, true);
                    window.muya!.editor.activeContentBlock = content;
                    window.muya!.updateParagraph('blockquote');
                });
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, legacyCalls: [] });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: quoted } });
                await page.evaluate(() => window.coreBoundary.history('undo'));
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
            } finally {
                await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}

for (const example of [
    { source: '{==plain==}', typed: '{==plainX==}', text: 'plain' },
    { source: '{~~old~>new~~}', typed: '{~~old~>newX~~}', text: 'oldnew' },
    { source: '{>>note<<}{++plain++}', typed: '{>>note<<}{++plainX++}', text: 'plain' },
]) {
    test(`quoting a complete annotation retains its caret and following trusted input: ${example.source}`, async ({ page }) => {
        const source = example.source + '\n';
        const quoted = '> ' + source;
        const typed = '> ' + example.typed + '\n';
        await page.evaluate(async ({ source }) => {
            const muya = window.muya!;
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(muya, source);
            const content = muya.editor.scrollPage!.firstContentInDescendant()!;
            content.setCursor(content.text.length, content.text.length, true);
            muya.editor.activeContentBlock = content;
            muya.updateParagraph('blockquote');
        }, { source });
        try {
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: quoted }, anchor: example.text.length, caret: example.text.length, legacyCalls: [] });
            expect(await page.evaluate(() => window.muya!.getState())).toMatchObject([{ name: 'block-quote', children: [{ name: 'paragraph', text: example.text }] }]);
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, caret: example.text.length + 1, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: quoted }, caret: example.text.length });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, caret: example.text.length });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
        } finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const example of [
    { name: 'nested quote', prefix: '> > ', remaining: '> ', caret: 1, quotes: 1 },
    { name: 'heading inside the outer quote', prefix: '> # ', remaining: '# ', caret: 3, quotes: 0 },
]) {
    for (const lane of ['native', 'Core', 'Track'] as const) {
        test(`resetting ${example.name} preserves inner syntax and its editing selection policy (${lane})`, async ({ page }) => {
            const bound = lane !== 'native';
            const tracked = lane === 'Track';
            const suffix = bound ? '{>>inside<<}' : '';
            const tail = bound ? '\n\noutside{>>keep<<}\n' : '\n\noutside\n';
            const source = `${example.prefix}bravo${suffix}${tail}`;
            const prefix = tracked ? `{--> --}${example.remaining}` : example.remaining;
            const expected = `${prefix}bravo${suffix}${tail}`;
            // Standalone Muya explicitly resets to offset zero; the bound
            // document command retains the original model-owned caret.
            const afterCaret = bound ? example.caret : 0;
            const typed = bound
                ? `${prefix}b${tracked ? '{++X++}' : 'X'}ravo${suffix}${tail}`
                : example.quotes === 1 ? `> Xbravo${tail}` : `X# bravo${tail}`;
            await page.evaluate(async ({ source, bound, tracked, caret }) => {
                const muya = window.muya!;
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(muya, source, tracked);
                } else muya.setContent(source);
                const content = muya.editor.scrollPage!.firstContentInDescendant()!;
                content.setCursor(caret, caret, true);
                muya.editor.activeContentBlock = content;
                muya.flush();
            }, { source, bound, tracked, caret: example.caret });
            const read = () => page.evaluate((bound) => {
                const muya = window.muya!;
                muya.flush();
                const selection = muya.getSelection();
                let quotes = 0;
                let node = selection?.anchor.block.domNode?.parentElement;
                while (node && node !== muya.domNode) {
                    if (node.tagName === 'BLOCKQUOTE') quotes++;
                    node = node.parentElement;
                }
                let source: string;
                if (bound) {
                    const reply = window.coreBoundary.read().source;
                    if (reply.type !== 'source') throw new Error('Expected accepted model source');
                    source = reply.source;
                } else source = muya.getMarkdown();
                return {
                    source,
                    anchor: selection?.anchor.offset,
                    caret: selection?.focus.offset,
                    quotes,
                    legacy: bound ? window.coreBoundary.read().legacyCalls : [],
                };
            }, bound);
            const history = (direction: 'undo' | 'redo') => page.evaluate(async ({ bound, direction }) => {
                if (bound) await window.coreBoundary.history(direction);
                else if (direction === 'undo') window.muya!.undo();
                else window.muya!.redo();
            }, { bound, direction });
            try {
                await page.evaluate(() => window.muya!.updateParagraph('reset-to-paragraph'));
                expect(await read()).toEqual({ source: expected, anchor: afterCaret, caret: afterCaret, quotes: example.quotes + (tracked ? 1 : 0), legacy: [] });
                await page.keyboard.type('X');
                expect(await read()).toMatchObject({ source: typed, anchor: afterCaret + 1, caret: afterCaret + 1, legacy: [] });
                await history('undo');
                expect(await read()).toMatchObject({ source: expected, caret: afterCaret });
                await history('undo');
                expect(await read()).toMatchObject({ source, anchor: example.caret, caret: example.caret, quotes: example.quotes + 1 });
                await history('redo');
                await history('redo');
                expect(await read()).toMatchObject({ source: typed });
                if (bound) expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
            } finally {
                if (bound) await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}

for (const bound of [false, true]) {
    for (const operation of ['unwrap', 'wrap'] as const) {
        test(`blockquote ${operation} uses the actual selected content (Core=${bound})`, async ({ page }) => {
            const paragraph = bound ? 'a{++a++}a' : 'aaa';
            const tail = bound ? '\n\noutside{>>keep<<}\n' : '\n\noutside\n';
            const plain = `${paragraph}\n\n${paragraph}${tail}`;
            const quoted = `> ${paragraph}\n>\n> ${paragraph}${tail}`;
            const source = operation === 'unwrap' ? quoted : plain;
            const expected = operation === 'unwrap' ? plain : quoted;
            const typed = operation === 'unwrap' ? `${paragraph}\n\naX${bound ? '{++a++}' : 'a'}a${tail}` : `> X${tail}`;
            await page.evaluate(async ({ source, bound, operation }) => {
                const muya = window.muya!;
                if (bound) {
                    const modulePath = '/coreBoundaryControl.ts';
                    const control = await import(/* @vite-ignore */ modulePath);
                    window.coreBoundary = control.bootCoreBoundary(muya, source);
                }
                else {
                    muya.setContent(source);
                }
                muya.focus();
                const first = muya.editor.scrollPage!.firstContentInDescendant()!;
                const second = first.nextContentInContext()!;
                if (operation === 'unwrap') {
                    second.setCursor(1, 1, true);
                }
                else {
                    first.setCursor(1, 1, true);
                    muya.editor.selection.setSelection({ block: first, path: first.path, offset: 1 }, { block: second, path: second.path, offset: 2 });
                }
                muya.flush();
            }, { source, bound, operation });
            let failed = false;
            try {
                await page.evaluate(() => window.muya!.updateParagraph('blockquote'));
                const current = await page.evaluate((bound) => {
                    const muya = window.muya!;
                    muya.flush();
                    const selection = muya.getSelection();
                    return {
                        source: bound ? window.coreBoundary.read().source : muya.getMarkdown(),
                        anchor: selection?.anchor.offset,
                        caret: selection?.focus.offset,
                        path: selection?.focus.path,
                        legacy: bound ? window.coreBoundary.read().legacyCalls : [],
                    };
                }, bound);
                expect(current.source).toEqual(bound ? expect.objectContaining({ source: expected }) : expected);
                expect(current).toMatchObject({ anchor: operation === 'unwrap' ? 1 : 0, caret: operation === 'unwrap' ? 1 : 3, path: operation === 'unwrap' ? [1, 'text'] : [0, 'children', 1, 'text'], legacy: [] });
                await page.keyboard.type('X');
                const read = () => page.evaluate((bound) => {
                    const muya = window.muya!;
                    muya.flush();
                    return bound ? window.coreBoundary.read().source : muya.getMarkdown();
                }, bound);
                expect(await read()).toEqual(bound ? expect.objectContaining({ source: typed }) : typed);
                await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('undo'); else window.muya!.undo(); }, bound);
                expect(await read()).toEqual(bound ? expect.objectContaining({ source: expected }) : expected);
                await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('undo'); else window.muya!.undo(); }, bound);
                expect(await read()).toEqual(bound ? expect.objectContaining({ source }) : source);
                const before = await page.evaluate(() => {
                    const selection = window.muya!.getSelection();
                    return { anchor: selection?.anchor.offset, focus: selection?.focus.offset, anchorPath: selection?.anchor.path, focusPath: selection?.focus.path };
                });
                expect(before).toEqual(operation === 'unwrap'
                    ? { anchor: 1, focus: 1, anchorPath: [0, 'children', 1, 'text'], focusPath: [0, 'children', 1, 'text'] }
                    : { anchor: 1, focus: 2, anchorPath: [0, 'text'], focusPath: [1, 'text'] });
                await page.evaluate(async (bound) => { if (bound) await window.coreBoundary.history('redo'); else window.muya!.redo(); }, bound);
                expect(await read()).toEqual(bound ? expect.objectContaining({ source: expected }) : expected);
                if (bound)
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
            }
            catch (error) {
                failed = true;
                throw error;
            }
            finally {
                if (bound && !failed)
                    await page.evaluate(() => window.coreBoundary.dispose());
            }
        });
    }
}
