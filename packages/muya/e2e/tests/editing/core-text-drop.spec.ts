import process from 'node:process';
import { expect, test } from '../fixtures/muya';
import { separateUndoSteps } from '../helpers/undoWindow';

test.beforeEach(async ({ page }) => separateUndoSteps(page));

for (const payload of ['external same', 'https://example.test/same%20same#view']) {
test(`trusted external drop ${payload} submits its browser target before native mutation`, async ({ page }) => {
    const source = 'same {++same++}{>>keep<<}\n\ntarget\n';
    await page.evaluate(async ({ source, payload }) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const drag = document.createElement('div');
        drag.id = 'external-text-drag';
        drag.textContent = 'external same';
        drag.draggable = true;
        drag.style.cssText = 'position:fixed;left:50px;top:200px;padding:10px;background:white;color:black;z-index:10000';
        drag.addEventListener('dragstart', event => {
            event.dataTransfer!.setData('text/plain', payload);
            event.dataTransfer!.effectAllowed = 'copy';
        });
        document.body.appendChild(drag);
        window.muya!.domNode.addEventListener('beforeinput', event => {
            if (!(event instanceof InputEvent)) return;
            window.muya!.domNode.dataset.dropType = event.inputType;
            window.muya!.domNode.dataset.dropTrusted = String(event.isTrusted);
            window.muya!.domNode.dataset.dropRangeCount = String(event.getTargetRanges().length);
        }, { capture: true, once: true });
    }, { source, payload });
    try {
        const target = page.locator('.mu-paragraph').last();
        const point = await page.evaluate(() => {
            const leaf = window.muya!.editor.scrollPage!.lastContentInDescendant()!;
            const dom = window.muya!.editor.selection.getDOMPoint({ path: leaf.path, offset: 6 })!;
            const range = document.createRange();
            range.setStart(dom.node, dom.offset);
            range.collapse(true);
            const caret = range.getBoundingClientRect();
            const box = leaf.outMostBlock!.domNode!.getBoundingClientRect();
            return { x: caret.left - box.left + 1, y: caret.top - box.top + caret.height / 2 };
        });
        await page.locator('#external-text-drag').dragTo(target, { targetPosition: point });
        expect(await page.evaluate(() => ({ ...window.muya!.domNode.dataset }))).toMatchObject({ dropType: 'insertFromDrop', dropTrusted: 'true', dropRangeCount: '1' });
        await page.evaluate(() => window.muya!.flush());
        const changed = source.replace('target', `target${payload}`);
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: changed }, legacyCalls: [] });
        await page.keyboard.type('X');
        const typed = source.replace('target', `target${payload}X`);
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: changed } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
}

for (const copy of [false, true]) {
test(`trusted internal ${copy ? 'copy' : 'move'} retains annotated formatted source as one history action`, async ({ page }) => {
    const source = 'lead {++same++} **word** tail\n\ntarget here\n';
    const changed = `${copy ? 'lead {++same++} **word** tail' : 'lead  tail'}\n\ntarget here{++same++} **word**\n`;
    const points = await page.evaluate(async source => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const first = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
        const last = window.muya!.editor.scrollPage!.lastContentInDescendant()!;
        const target = window.muya!.editor.selection.getDOMPoint({ path: last.path, offset: 11 })!;
        const range = document.createRange();
        range.setStart(target.node, target.offset);
        range.collapse(true);
        const targetRect = range.getBoundingClientRect();
        first.setCursor(18, 5, true);
        const rect = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
        return { from: { x: rect.left + 12, y: rect.top + rect.height / 2 }, to: { x: targetRect.left + 1, y: targetRect.top + targetRect.height / 2 } };
    }, source);
    try {
        if (copy) await page.keyboard.down(process.platform === 'darwin' ? 'Alt' : 'Control');
        await page.mouse.move(points.from.x, points.from.y);
        await page.mouse.down();
        await page.waitForTimeout(150);
        await page.mouse.move(points.from.x + 5, points.from.y, { steps: 5 });
        await page.mouse.move(points.to.x, points.to.y, { steps: 15 });
        await page.mouse.move(points.to.x, points.to.y + 1, { steps: 2 });
        await page.mouse.up();
        if (copy) await page.keyboard.up(process.platform === 'darwin' ? 'Alt' : 'Control');
        await page.evaluate(() => window.muya!.flush());
        const result = await page.evaluate(() => window.coreBoundary.read());
        expect(result).toMatchObject({ source: { source: changed }, legacyCalls: [] });
        expect(result.actions).toHaveLength(1);
        await page.keyboard.type('X');
        const typed = changed.replace('**word**\n', '**word**X\n');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: changed } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 18, caret: 5 });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
}

test('trusted move out of the editing host commits the source cut once', async ({ page }) => {
    const source = 'lead {++same++} **word** tail\n';
    const points = await page.evaluate(async source => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const destination = document.createElement('div');
        destination.id = 'external-text-target';
        destination.contentEditable = 'true';
        destination.textContent = 'target';
        destination.style.cssText = 'position:fixed;left:50px;top:200px;width:150px;height:40px;padding:10px;background:white;color:black;z-index:10000';
        document.body.appendChild(destination);
        const last = document.createRange();
        last.setStart(destination.firstChild!, 6);
        last.collapse(true);
        const target = last.getBoundingClientRect();
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(18, 5, true);
        const selected = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
        window.muya!.domNode.addEventListener('dragend', event => {
            window.muya!.domNode.dataset.outboundEffect = event.dataTransfer?.dropEffect;
        }, { capture: true, once: true });
        return { from: { x: selected.left + 12, y: selected.top + selected.height / 2 }, to: { x: target.left + 1, y: target.top + target.height / 2 } };
    }, source);
    try {
        await page.mouse.move(points.from.x, points.from.y);
        await page.mouse.down();
        await page.waitForTimeout(150);
        await page.mouse.move(points.from.x + 5, points.from.y, { steps: 5 });
        await page.mouse.move(points.to.x, points.to.y, { steps: 15 });
        await page.mouse.move(points.to.x, points.to.y + 1, { steps: 2 });
        await page.mouse.up();
        expect(await page.evaluate(() => window.muya!.domNode.dataset.outboundEffect)).toBe('move');
        expect(await page.locator('#external-text-target').textContent()).toContain('same');
        await page.evaluate(() => window.muya!.flush());
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'lead  tail\n' }, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await page.locator('#external-text-target').textContent()).toMatch(/X$/);
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'lead  tail\n' }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 18, caret: 5 });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'lead  tail\n' });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});

for (const annotated of [false, true]) {
for (const copy of [false, true]) {
test(`trusted intrinsic ${copy ? 'copy' : 'move'} retains ${annotated ? 'annotated' : 'plain'} model text positions`, async ({ page }) => {
    const wrap = (value: string) => annotated ? `{++${value}++}\n` : `${value}\n`;
    const source = wrap('  ```\n\tbody\n  ```');
    const changed = wrap(copy ? '  ```\n\tbody \n  ```' : '  ```\n   body \n  ```');
    const caret = copy ? 7 : 6;
    const points = await page.evaluate(async source => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const first = window.muya!.editor.scrollPage!.queryBlock([0, 'text'])!;
        if (!first.isContent()) throw new Error('Expected normalized literal body');
        const target = window.muya!.editor.selection.getDOMPoint({ path: first.path, offset: 6 })!;
        const range = document.createRange();
        range.setStart(target.node, target.offset);
        range.collapse(true);
        const targetRect = range.getBoundingClientRect();
        first.setCursor(1, 0, true);
        const selected = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
        return { from: { x: selected.left + 2, y: selected.top + selected.height / 2 }, to: { x: targetRect.left + 1, y: targetRect.top + targetRect.height / 2 } };
    }, source);
    try {
        if (copy) await page.keyboard.down(process.platform === 'darwin' ? 'Alt' : 'Control');
        await page.mouse.move(points.from.x, points.from.y);
        await page.mouse.down();
        await page.waitForTimeout(150);
        await page.mouse.move(points.from.x + 5, points.from.y, { steps: 5 });
        await page.mouse.move(points.to.x, points.to.y, { steps: 15 });
        await page.mouse.move(points.to.x, points.to.y + 1, { steps: 2 });
        await page.mouse.up();
        if (copy) await page.keyboard.up(process.platform === 'darwin' ? 'Alt' : 'Control');
        await page.evaluate(() => window.muya!.flush());
        const result = await page.evaluate(() => window.coreBoundary.read());
        expect(result).toMatchObject({ source: { source: changed }, anchor: caret, caret, legacyCalls: [] });
        expect(result.actions).toHaveLength(1);
        expect(result.actions[0]?.selection).toMatchObject({ kind: 'model-text' });
        await page.keyboard.type('X');
        const typed = changed.replace('body \n', 'body X\n');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 1, caret: 0 });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
}
}

for (const copy of [false, true]) {
test(`trusted table-target ${copy ? 'copy' : 'move'} escapes the selected payload and keeps one cell`, async ({ page }) => {
    const source = 'a|b\n\n| target |\n| --- |\n';
    // Upstream writes the table afresh as part of the drop, padded to its widest cell.
    const changed = `${copy ? 'a|b' : ''}\n\n| a\\|btarget |\n| ---------- |\n`;
    const points = await page.evaluate(async source => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const cell = document.querySelector('.mu-table-cell-content')!;
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let target = walker.nextNode();
        while (target && !target.textContent?.includes('target')) target = walker.nextNode();
        if (!target) throw new Error('Expected target cell text');
        const range = document.createRange();
        range.setStart(target, target.textContent!.indexOf('target'));
        range.collapse(true);
        const targetRect = range.getBoundingClientRect();
        window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 0, true);
        const selected = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
        return { from: { x: selected.left + 8, y: selected.top + selected.height / 2 }, to: { x: targetRect.left + 1, y: targetRect.top + targetRect.height / 2 } };
    }, source);
    try {
        if (copy) await page.keyboard.down(process.platform === 'darwin' ? 'Alt' : 'Control');
        await page.mouse.move(points.from.x, points.from.y);
        await page.mouse.down();
        await page.waitForTimeout(150);
        await page.mouse.move(points.from.x + 5, points.from.y, { steps: 5 });
        await page.mouse.move(points.to.x, points.to.y, { steps: 15 });
        await page.mouse.move(points.to.x, points.to.y + 1, { steps: 2 });
        await page.mouse.up();
        if (copy) await page.keyboard.up(process.platform === 'darwin' ? 'Alt' : 'Control');
        await page.evaluate(() => window.muya!.flush());
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: changed }, legacyCalls: [] });
        await expect(page.locator('.mu-table-cell-content')).toHaveCount(1);
        expect(await page.evaluate(() => window.muya!.getSelection()?.focus.block.blockName)).toBe('table.cell.content');
        await page.keyboard.type('X');
        const typed = changed.replace('btarget', 'bXtarget').replace('| ---------- |', '| ----------- |');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: changed } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 3, caret: 0 });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: typed });
    }
    finally { await page.evaluate(() => window.coreBoundary.dispose()); }
});
}
