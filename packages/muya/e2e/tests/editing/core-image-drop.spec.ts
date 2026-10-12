import { expect, test } from '../fixtures/muya';
import { coreHistory, disposeCore, readCore, reopenCore } from '../helpers/coreBoundary';

for (const annotated of [false, true]) {
    for (const placement of ['before', 'after'] as const) {
        test(`native web image drop ${placement} an ${annotated ? 'annotated' : 'ordinary'} quote uses the shared owner`, async ({ page }) => {
            const source = `> ${annotated ? 's{++a++}me{>>keep<<}' : 'same'}\n\ntail\n`;
            const image = '![](http://localhost:5174/assets/drop.png)';
            const joined = placement === 'before' ? `${image}\n\n${source}` : source.replace('\n\ntail', `\n\n${image}\n\ntail`);
            await page.route('**/assets/drop.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }));
            await page.evaluate(async ({ source, placement }) => {
                const modulePath = '/coreBoundaryControl.ts';
                const control = await import(/* @vite-ignore */ modulePath);
                window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
                const paragraph = window.muya!.editor.scrollPage!.firstContentInDescendant();
                if (!paragraph?.domNode || !paragraph.outMostBlock?.domNode) throw new Error('Missing image drop target');
                const tail = paragraph.nextContentInContext();
                if (!tail) throw new Error('Missing original selection');
                tail.setCursor(4, 1, true);
                const rect = paragraph.outMostBlock.domNode.getBoundingClientRect();
                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/uri-list', 'http://localhost:5174/assets/drop.png');
                dataTransfer.setData('text/html', '<img src="http://localhost:5174/assets/drop.png">');
                paragraph.domNode.dispatchEvent(new DragEvent('drop', { dataTransfer, clientY: placement === 'before' ? rect.top : rect.bottom, bubbles: true, cancelable: true }));
                await window.coreBoundary.settle();
            }, { source, placement });
            try {
                expect(await readCore(page)).toMatchObject({ source: { source: joined }, caret: 0, legacyCalls: [] });
                await page.keyboard.type('x');
                const typed = joined.replace(image, `x${image}`);
                expect(await readCore(page)).toMatchObject({ source: { source: typed }, caret: 1, legacyCalls: [] });
                await coreHistory(page, 'undo');
                await coreHistory(page, 'undo');
                expect(await readCore(page)).toMatchObject({ source: { source }, anchor: 4, caret: 1 });
                await coreHistory(page, 'redo');
                await coreHistory(page, 'redo');
                expect(await reopenCore(page)).toMatchObject({ source: typed });
            }
            finally { await disposeCore(page); }
        });
    }
}
