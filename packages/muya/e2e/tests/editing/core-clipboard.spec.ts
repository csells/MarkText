import { expect, test } from '../fixtures/muya';

for (const operation of ['cut', 'paste'] as const) {
    test(`native ${operation} replaces the actual repeated-text selection through Core`, async ({ page }) => {
        await page.evaluate(async () => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, 'a{++a++}a\n');
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 2);
        });
        try {
            await page.evaluate(async (kind) => {
                const data = new DataTransfer();
                if (kind === 'paste')
                    data.setData('text/plain', 'a');
                const event = new ClipboardEvent(kind, { clipboardData: data, bubbles: true, cancelable: true });
                const muya = window.muya!;
                if (kind === 'paste')
                    await muya.editor.clipboard.pasteHandler(event);
                else muya.domNode.dispatchEvent(event);
                muya.flush();
                await window.coreBoundary.settle();
            }, operation);
            const expected = operation === 'cut' ? 'a\n' : 'aa\n';
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, legacyCalls: [], anchor: operation === 'cut' ? 0 : 1, caret: operation === 'cut' ? 0 : 1 });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: operation === 'cut' ? 'Xa\n' : 'aXa\n' }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'a{++a++}a\n' } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

for (const sample of [
    { name: 'heading', markdown: '# pasted', expected: 'before pastedafter\n' },
    { name: 'list', markdown: '- pasted', expected: 'before \n\n- pastedafter\n' },
    { name: 'table', markdown: '| a | b |\n| - | - |\n| c | d |', expected: 'before \n\n| a   | b      |\n| --- | ------ |\n| c   | dafter |\n' },
]) {
    test(`preserves existing ${sample.name} paste behavior in a paragraph`, async ({ page }) => {
        const control = await page.evaluate(async (markdown) => {
            const muya = window.muya!;
            muya.setContent('before after\n');
            muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(7, 7);
            const data = new DataTransfer();
            data.setData('text/plain', markdown);
            await muya.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            muya.flush();
            return { source: muya.getMarkdown(), state: muya.getState(), caret: muya.getSelection()?.focus.offset };
        }, sample.markdown);
        expect(control.source).toBe(sample.expected);
        await page.evaluate(async () => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, 'before after\n');
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(7, 7);
        });
        try {
            await page.evaluate(async (markdown) => {
                const data = new DataTransfer();
                data.setData('text/plain', markdown);
                await window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
                window.muya!.flush();
                await window.coreBoundary.settle();
            }, sample.markdown);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: control.source }, legacyCalls: [], caret: control.caret });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('an image upload retains its captured selection while later typing remains accepted', async ({ page }) => {
    await page.evaluate(async () => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, 'ab\n');
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 1);
        window.muya!.options.imageAction = () => new Promise<string>((resolve) => {
            window.finishClipboardImage = resolve;
        });
        window.pendingClipboardImage = window.muya!.editor.clipboard.pasteImage('/original.png');
    });
    try {
        await page.evaluate(() => {
            const content = window.muya!.editor.scrollPage!.lastContentInDescendant()!;
            content.setCursor(content.text.length, content.text.length);
        });
        await page.keyboard.type('X');
        await page.evaluate(async () => {
            window.finishClipboardImage('/final.png');
            await window.pendingClipboardImage;
            window.muya!.flush();
            await window.coreBoundary.settle();
        });
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '![](/final.png)bX\n' }, legacyCalls: [] });
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '![](/final.png)bX\n' });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

declare global {
    // eslint-disable-next-line ts/naming-convention -- Browser global augmentation uses its platform name.
    interface Window {
        finishClipboardImage: (source: string) => void;
        pendingClipboardImage: Promise<void>;
    }
}

for (const sample of [
    { source: 'AB\n', caret: 1, html: '<b>bold</b>', text: 'bold', expected: 'A**bold**B\n' },
    { source: 'AB\n', caret: 1, html: '<a href="http://example.test/page">http://example.test/page</a>', text: 'http://example.test/page', expected: 'A[http://example.test/page](http://example.test/page)B\n' },
    { source: 'A  B\n', caret: 2, html: '<a href="http://example.test/page">http://example.test/page</a>', text: 'http://example.test/page', expected: 'A http://example.test/page B\n' },
]) {
    test(`imports HTML ${sample.html} into ${sample.source.trim()} through captured Core preparation`, async ({ page }) => {
        await page.evaluate(async ({ source, caret }) => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(caret, caret);
        }, sample);
        try {
            await page.evaluate(async ({ html, text }) => {
                const data = new DataTransfer();
                data.setData('text/plain', text);
                data.setData('text/html', html);
                await window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
                window.muya!.flush();
                await window.coreBoundary.settle();
            }, sample);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.expected }, legacyCalls: [] });
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.expected });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

test('Paste as Plain Text captures its target before the asynchronous clipboard read', async ({ page }) => {
    await page.evaluate(async () => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, 'ab\n');
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 1);
        window.muya!.options.clipboardText = () => new Promise<string>((resolve) => {
            window.finishClipboardImage = resolve;
        });
        window.pendingClipboardImage = window.muya!.editor.clipboard.pasteAsPlainText();
    });
    try {
        await page.evaluate(() => window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(2, 2));
        await page.keyboard.type('X');
        await page.evaluate(async () => {
            window.finishClipboardImage('P');
            await window.pendingClipboardImage;
            window.muya!.flush();
            await window.coreBoundary.settle();
        });
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'PbX\n' }, legacyCalls: [] });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

test('retains raw clipboard bitmap bytes in recoverable pending upload intent', async ({ page }) => {
    const bitmap = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=';
    await page.evaluate(async (base64) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, 'ab\n');
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 1);
        window.muya!.options.imageAction = () => new Promise<string>((resolve) => {
            window.finishClipboardImage = resolve;
        });
        const data = new DataTransfer();
        data.items.add(new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], 'pixel.png', { type: 'image/png' }));
        window.pendingClipboardImage = window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, bitmap);
    try {
        await page.waitForFunction(() => typeof window.finishClipboardImage === 'function');
        expect(await page.evaluate(() => JSON.stringify(window.coreBoundary.recovery()))).toContain(`data:image/png;base64,${bitmap}`);
    }
    finally {
        await page.evaluate(async () => {
            window.finishClipboardImage('/final.png');
            await window.pendingClipboardImage;
            window.coreBoundary.dispose();
        });
    }
});

for (const operation of ['cut', 'Backspace', 'Delete', 'Enter', 'close', 'toolbar', 'paste', 'plain paste'] as const) {
    test(`${operation} of an actually selected image uses its current DOM target and the Core action`, async ({ page }) => {
        const bitmap = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=';
        const imageSource = operation === 'close' ? '' : bitmap;
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        }, `a{++![](${imageSource})++}a\n`);
        try {
            if (operation === 'close')
                await page.locator('.mu-inline-image').hover();
            else await page.locator('.mu-inline-image img').click();
            if (operation === 'plain paste') {
                await page.evaluate(async () => {
                    window.muya!.options.clipboardText = async () => 'P';
                    await window.muya!.pasteAsPlainText();
                });
            }
            else if (operation === 'cut' || operation === 'paste') {
                await page.evaluate(async (kind) => {
                    const data = new DataTransfer();
                    if (kind === 'paste')
                        data.setData('text/plain', 'P');
                    const event = new ClipboardEvent(kind, { clipboardData: data, bubbles: true, cancelable: true });
                    if (kind === 'paste')
                        await window.muya!.editor.clipboard.pasteHandler(event);
                    else window.muya!.domNode.dispatchEvent(event);
                }, operation);
            }
            else if (operation === 'close') {
                await page.locator('.mu-image-icon-close').click();
            }
            else if (operation === 'toolbar') {
                await page.locator('.mu-image-toolbar-container .item.delete').click();
            }
            else {
                await page.keyboard.press(operation);
            }
            await page.evaluate(async () => {
                window.muya!.flush();
                await window.coreBoundary.settle();
            });
            const isPaste = operation === 'paste' || operation === 'plain paste';
            const expected = isPaste ? 'aPa\n' : 'aa\n';
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: isPaste ? 'aPXa\n' : 'aXa\n' }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: `a{++![](${imageSource})++}a\n` } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const operation of ['copy', 'cut'] as const) {
    test(`desktop ${operation} guard replaces stale text payload with the actual selected-image projection`, async ({ page }) => {
        const bitmap = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=';
        const source = `a{++![](${bitmap})++}a\n`;
        await page.evaluate(async (source) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(0, 1);
            await window.coreBoundary.prepareClipboardCopy();
        }, source);
        try {
            await page.locator('.mu-inline-image img').click();
            const copied = await page.evaluate(operation => window.coreBoundary.guardedClipboard(operation), operation);
            expect(copied.text.trim()).toBe(`![](${bitmap})`);
            expect(copied.html).toContain('<img');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: operation === 'cut' ? 'aa\n' : source }, legacyCalls: [] });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

test('pending image paste stays before subsequent same-caret typing and preserves the later caret', async ({ page }) => {
    await page.evaluate(async () => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, 'ab\n');
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 1);
        window.muya!.options.imageAction = () => new Promise<string>((resolve) => {
            window.finishClipboardImage = resolve;
        });
        window.pendingClipboardImage = window.muya!.editor.clipboard.pasteImage('/original.png');
    });
    try {
        await page.waitForFunction(() => typeof window.finishClipboardImage === 'function');
        await expect.soft(page.locator('.mu-image-uploading')).toBeVisible({ timeout: 1000 });
        await expect.poll(async () => page.locator('.mu-pending-image').evaluate((element) => {
            const wrapper = element.closest('.mu-float-wrapper') as HTMLElement;
            const image = element.querySelector('.mu-inline-image')!.getBoundingClientRect();
            const bounds = wrapper.getBoundingClientRect();
            return Number(wrapper.style.opacity) === 1 && bounds.left >= 0 && bounds.top >= 0
                && bounds.right <= innerWidth && bounds.bottom <= innerHeight
                && image.right <= bounds.right && image.bottom <= bounds.bottom;
        })).toBe(true);
        await page.keyboard.type('X');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'aXb\n' }, caret: 2 });
        await page.evaluate(async () => {
            window.finishClipboardImage('/final.png');
            await window.pendingClipboardImage;
        });
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'a![](/final.png)Xb\n' }, caret: 'a![](/final.png)X'.length, legacyCalls: [] });
        await expect(page.locator('.mu-image-uploading')).toHaveCount(0);
        await page.keyboard.type('Y');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'a![](/final.png)XYb\n' }, caret: 'a![](/final.png)XY'.length, legacyCalls: [] });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

for (const sample of [
    { name: 'heading soft lines', source: '# before after\n', offset: 9, paste: 'first\nsecond', expected: '# before first\n\nsecondafter\n', caret: 6 },
    { name: 'quote paragraphs', source: '> before after\n', offset: 7, paste: 'first\n\nsecond', expected: '> before first\n>\n> secondafter\n', caret: 6 },
    { name: 'list paragraphs', source: '- before after\n', offset: 7, paste: 'first\n\nsecond', expected: '- before first\n\n  secondafter\n', caret: 6 },
    { name: 'table multiline', source: '| before after |\n| --- |\n| b |\n', offset: 7, paste: 'first\nsecond', expected: '| before first<br/>secondafter |\n| --- |\n| b |\n', normalized: '| before first<br/>secondafter |\n| ---------------------------- |\n| b                            |\n', caret: 23 },
]) {
    test(`preserves existing ${sample.name} paste behavior through the native caller`, async ({ page }) => {
        const native = await page.evaluate(async (sample) => {
            const muya = window.muya!;
            muya.setContent(sample.source);
            muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(sample.offset, sample.offset);
            const data = new DataTransfer();
            data.setData('text/plain', sample.paste);
            await muya.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            muya.flush();
            return { source: muya.getMarkdown(), caret: muya.getSelection()?.focus.offset };
        }, sample);
        expect(native).toEqual({ source: sample.normalized ?? sample.expected, caret: sample.caret });
        await page.evaluate(async (sample) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, sample.source);
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(sample.offset, sample.offset);
        }, sample);
        try {
            await page.evaluate(async (text) => {
                const data = new DataTransfer();
                data.setData('text/plain', text);
                await window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            }, sample.paste);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.expected }, caret: sample.caret, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.expected.replace('after', 'Xafter') }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.source } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.expected });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

test('quoted paste preserves leading annotations when continuing paragraphs', async ({ page }) => {
    await page.evaluate(async () => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, '> {++before++} after\n');
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(7, 7);
    });
    try {
        await page.evaluate(async () => {
            const data = new DataTransfer();
            data.setData('text/plain', 'first\n\nsecond');
            await window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        });
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '> {++before++} first\n>\n> secondafter\n' }, caret: 6, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '> {++before++} first\n>\n> secondXafter\n' }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '> {++before++} after\n' } });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '> {++before++} first\n>\n> secondafter\n' });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

for (const sample of [
    {
        name: 'normal raw block HTML',
        plain: false,
        text: '<ul><li>a</li></ul>',
        expected: 'foo\n\n<ul><li>a</li></ul>\n',
        annotated: 'f{++o++}o\n\n<ul><li>a</li></ul>\n',
        next: 'f{++o++}o\n\n<ul><li>a</li></ul>X\n',
    },
    {
        name: 'plain single-line block HTML',
        plain: true,
        text: '<ul><li>a</li></ul>',
        expected: 'foo<ul><li>a</li></ul>\n',
        annotated: 'f{++o++}o<ul><li>a</li></ul>\n',
        next: 'f{++o++}o<ul><li>a</li></ul>X\n',
    },
    {
        name: 'plain multiline block HTML',
        plain: true,
        text: '<ul>\n<li>a</li>\n</ul>',
        expected: 'foo<ul>\n\n<li>a</li>\n</ul>\n',
        annotated: 'f{++o++}o<ul>\n\n<li>a</li>\n</ul>\n',
        next: 'f{++o++}o<ul>X\n\n<li>a</li>\n</ul>\n',
    },
]) {
    test(`preserves existing ${sample.name} paste behavior and annotation ownership`, async ({ page }) => {
        const native = await page.evaluate(async ({ text, plain }) => {
            const muya = window.muya!;
            muya.setContent('foo\n');
            muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 3);
            muya.options.clipboardText = async () => text;
            if (plain) {
                await muya.pasteAsPlainText();
            }
            else {
                const data = new DataTransfer();
                data.setData('text/plain', text);
                await muya.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            }
            muya.flush();
            return { source: muya.getMarkdown(), caret: muya.getSelection()?.focus.offset };
        }, sample);
        expect(native.source).toBe(sample.expected);
        await page.evaluate(async () => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, 'f{++o++}o\n');
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 3);
        });
        try {
            await page.evaluate(async ({ text, plain }) => {
                const muya = window.muya!;
                if (plain) {
                    await muya.pasteAsPlainText();
                }
                else {
                    const data = new DataTransfer();
                    data.setData('text/plain', text);
                    await muya.editor.clipboard.pasteHandler(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
                }
                muya.flush();
                await window.coreBoundary.settle();
            }, sample);
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.annotated }, caret: native.caret, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.next } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.annotated } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'f{++o++}o\n' } });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.annotated });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}

for (const { mode, suffix } of [
    { mode: 'upstream', suffix: '' },
    { mode: 'Core', suffix: '' },
    { mode: 'Core Track', suffix: '' },
    { mode: 'Core Track', suffix: '# UNRELATED{++kept++}\n' },
] as const) {
    test(`${mode} plain multiline HTML paste keeps the unselected tail${suffix ? ' and following heading' : ''} and permits the next key`, async ({ page }) => {
        const bound = mode !== 'upstream';
        const tracked = mode === 'Core Track';
        const source = (bound ? 'fooTAIL{>>note<<}\n' : 'fooTAIL\n') + suffix;
        const markdown = '<ul>\n<li>a</li>\n</ul>';
        const expected = tracked
            ? `foo{++<ul>++}TAIL{>>note<<}{~~\n~>\n\n<li>a</li>\n</ul>\n\n~~}${suffix}`
            : bound ? 'foo<ul>TAIL{>>note<<}\n\n<li>a</li>\n</ul>\n' : 'foo<ul>TAIL\n\n<li>a</li>\n</ul>\n';
        const next = tracked
            ? `foo{++<ul>x++}TAIL{>>note<<}{~~\n~>\n\n<li>a</li>\n</ul>\n\n~~}${suffix}`
            : bound ? 'foo<ul>xTAIL{>>note<<}\n\n<li>a</li>\n</ul>\n' : 'foo<ul>xTAIL\n\n<li>a</li>\n</ul>\n';
        await page.evaluate(async ({ source, markdown, bound, tracked }) => {
            if (bound) {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked);
            }
            else { window.muya!.setContent(source); }
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 3);
            window.muya!.options.clipboardText = async () => markdown;
        }, { source, markdown, bound, tracked });
        try {
            await page.evaluate(async (bound) => {
                await window.muya!.pasteAsPlainText();
                // The native branch publishes its queued edits at the flush boundary.
                if (!bound)
                    window.muya!.flush();
            }, bound);
            if (bound) {
                await page.evaluate(() => window.coreBoundary.settle());
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: expected }, anchor: 7, caret: 7, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: expected });
            }
            else {
                expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(expected);
                expect(await page.evaluate(() => window.muya!.getSelection()?.focus.offset)).toBe(7);
            }
            await page.keyboard.type('x');
            if (bound) {
                expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: next }, anchor: 8, caret: 8, legacyCalls: [] });
                expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: next });
                for (const value of [expected, source]) {
                    await page.evaluate(() => window.coreBoundary.history('undo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: value });
                }
                for (const value of [expected, next]) {
                    await page.evaluate(() => window.coreBoundary.history('redo'));
                    expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: value });
                }
            }
            else {
                expect(await page.evaluate(() => {
                    window.muya!.flush();
                    return window.muya!.getMarkdown();
                })).toBe(next);
            }
        }
        finally {
            if (bound)
                await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}
