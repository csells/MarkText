import process from 'node:process';
import { expect, test } from '../fixtures/muya';
import { bootCore, coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const example of [
    { key: 'Backspace', offset: 9, type: 'deleteWordBackward', changed: 'same {++same ++}{>>keep<<}\n', typed: 'same {++same X++}{>>keep<<}\n', caret: 10 },
    { key: 'Delete', offset: 0, type: 'deleteWordForward', changed: 'same {++ same++}{>>keep<<}\n', typed: 'same {++X same++}{>>keep<<}\n', caret: 5 },
]) {
test(`trusted word ${example.key} owns the browser range inside an annotation`, async ({ page }) => {
    const source = 'same {++same same++}{>>keep<<}\n';
    await bootCore(page, source, {
        arg: example.offset,
        setup: (offset) => {
            const leaf = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            const walker = document.createTreeWalker(leaf.domNode!, NodeFilter.SHOW_TEXT);
            let text = walker.nextNode();
            while (text && text.textContent !== 'same same') text = walker.nextNode();
            if (!text) throw new Error('Expected annotated repeated words');
            window.muya!.editor.selection.setDOMSelection({ node: text, offset }, { node: text, offset });
            window.muya!.domNode.addEventListener('beforeinput', event => {
                if (!(event instanceof InputEvent)) return;
                window.muya!.domNode.dataset.deletionType = event.inputType;
                window.muya!.domNode.dataset.deletionTrusted = String(event.isTrusted);
                window.muya!.domNode.dataset.deletionRangeCount = String(event.getTargetRanges().length);
            }, { capture: true, once: true });
        },
    });
    try {
        await page.keyboard.press(`${process.platform === 'darwin' ? 'Alt' : 'Control'}+${example.key}`);
        expect(await page.evaluate(() => ({ ...window.muya!.domNode.dataset }))).toMatchObject({ deletionType: example.type, deletionTrusted: 'true', deletionRangeCount: '1' });
        expect(await readCore(page)).toMatchObject({
            source: { source: example.changed },
            anchor: example.caret, caret: example.caret, legacyCalls: [],
        });
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: example.typed }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source }, anchor: 5 + example.offset, caret: 5 + example.offset });
        await coreHistory(page, 'redo');
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: example.typed });
    }
    finally { await disposeCore(page); }
});
}

for (const example of [
    { key: 'Backspace', shortcut: 'Meta+Backspace', offset: 16, type: 'deleteSoftLineBackward' },
    { key: 'forward deletion', shortcut: 'Control+k', offset: 7, type: 'deleteHardLineForward' },
]) {
test(`trusted macOS line ${example.key} retains annotated literal text and history`, async ({ page }) => {
    test.skip(process.platform !== 'darwin', 'Uses macOS native line deletion shortcuts');
    const source = '{++```js\nbefore\nsame same\nafter\n```++}{>>keep<<}\n';
    const afterLine = example.type === 'deleteHardLineForward' ? '' : '\n';
    const changed = `{++\`\`\`js\nbefore\n${afterLine}after\n\`\`\`++}{>>keep<<}\n`;
    const typed = `{++\`\`\`js\nbefore\nX${afterLine}after\n\`\`\`++}{>>keep<<}\n`;
    await bootCore(page, source, {
        arg: example.offset,
        setup: (offset) => {
            const leaf = window.muya!.editor.scrollPage!.queryBlock([0, 'text']);
            if (!leaf?.isContent() || leaf.blockName !== 'codeblock.content') throw new Error('Expected annotated code body');
            leaf.setCursor(offset, offset, true);
            window.muya!.domNode.addEventListener('beforeinput', event => {
                if (!(event instanceof InputEvent)) return;
                window.muya!.domNode.dataset.deletionType = event.inputType;
                window.muya!.domNode.dataset.deletionTrusted = String(event.isTrusted);
                window.muya!.domNode.dataset.deletionRangeCount = String(event.getTargetRanges().length);
            }, { capture: true, once: true });
        },
    });
    try {
        await page.keyboard.press(example.shortcut);
        expect(await page.evaluate(() => ({ ...window.muya!.domNode.dataset }))).toMatchObject({ deletionType: example.type, deletionTrusted: 'true', deletionRangeCount: '1' });
        expect(await readCore(page)).toMatchObject({ source: { source: changed }, anchor: 7, caret: 7, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await readCore(page)).toMatchObject({ source: { source: typed }, legacyCalls: [] });
        await coreHistory(page, 'undo');
        await coreHistory(page, 'undo');
        expect(await readCore(page)).toMatchObject({ source: { source }, anchor: example.offset, caret: example.offset });
        await coreHistory(page, 'redo');
        await coreHistory(page, 'redo');
        expect(await reopenCore(page)).toMatchObject({ source: typed });
    }
    finally { await disposeCore(page); }
});
}
