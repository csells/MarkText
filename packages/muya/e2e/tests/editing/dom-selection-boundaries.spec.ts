import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';

interface IPoint { node: string; offset: number }
interface IInputCapture {
    selection: { anchor: IPoint; focus: IPoint };
    range: { anchor: IPoint; focus: IPoint };
}

declare global {
    // eslint-disable-next-line ts/naming-convention -- Browser global augmentation uses its platform name.
    interface Window {
        recordDOMInput: (capture: IInputCapture) => Promise<void>;
    }
}

async function prepare(page: Page): Promise<IInputCapture[]> {
    const inputs: IInputCapture[] = [];
    await page.exposeFunction('recordDOMInput', (capture: IInputCapture) => inputs.push(capture));
    await page.evaluate(() => {
        const muya = window.muya!;
        muya.setInlinePresentation(() => '<span data-boundary-control>ab</span>');
        muya.setContent([{ name: 'paragraph', text: 'ab' }]);
        const paragraph = muya.editor.scrollPage!.firstContentInDescendant()!.domNode!;
        const text = paragraph.querySelector('[data-boundary-control]')!.firstChild!;
        const point = (value: { node: Node; offset: number }) => ({
            node: value.node === paragraph ? 'paragraph' : value.node === text ? 'text' : value.node.nodeName,
            offset: value.offset,
        });
        muya.editor.bindDocumentEditing({
            activeFormats: () => [],
            clipboard() { throw new Error('Unexpected clipboard in DOM geometry control'); },
            prepareImage() { throw new Error('Unexpected image preparation'); },
            prepareClipboard() { throw new Error('Unexpected clipboard preparation in DOM geometry control'); },
            format() { throw new Error('Unexpected formatting in this input test'); },
            compositionStart() { throw new Error('Unexpected composition in this input test'); },
            compositionUpdate() { throw new Error('Unexpected composition in this input test'); },
            compositionEnd() { throw new Error('Unexpected composition in this input test'); },
            input: (operation) => {
                if (!('range' in operation))
                    throw new Error('Unexpected structural command in DOM geometry control');
                void window.recordDOMInput({
                    selection: { anchor: point(operation.selection.anchor), focus: point(operation.selection.focus) },
                    range: { anchor: point(operation.range.anchor), focus: point(operation.range.focus) },
                });
                return false;
            },
        });
        const outside = { node: paragraph, offset: 0 };
        muya.editor.selection.setDOMSelection(outside, outside);
    });
    return inputs;
}

test('native beforeinput retains a restored element boundary separately from its target range', async ({ page }) => {
    const inputs = await prepare(page);
    const exact = await page.evaluate(() => {
        const selection = window.muya!.editor.selection;
        const paragraph = window.muya!.editor.scrollPage!.firstContentInDescendant()!.domNode!;
        const current = selection.getDOMSelection()!;
        return { isParagraph: current.anchor.node === paragraph, offset: current.anchor.offset };
    });
    expect(exact).toEqual({ isParagraph: true, offset: 0 });
    await page.keyboard.type('x');
    await expect.poll(() => inputs.length).toBe(1);
    expect(inputs[0]!.selection).toEqual({ anchor: { node: 'paragraph', offset: 0 }, focus: { node: 'paragraph', offset: 0 } });
    expect(inputs[0]!.range).toEqual({ anchor: { node: 'text', offset: 0 }, focus: { node: 'text', offset: 0 } });
    await page.evaluate(() => {
        const muya = window.muya!;
        const text = muya.domNode.querySelector('[data-boundary-control]')!.firstChild!;
        muya.editor.selection.setDOMSelection({ node: text, offset: 0 }, { node: text, offset: 0 });
    });
    await page.keyboard.type('x');
    await expect.poll(() => inputs.length).toBe(2);
    expect(inputs[1]!.selection).toEqual({ anchor: { node: 'text', offset: 0 }, focus: { node: 'text', offset: 0 } });
});

test('keyboard movement replaces the restored boundary with the actual native text caret', async ({ page }) => {
    const inputs = await prepare(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('x');
    await expect.poll(() => inputs.length).toBe(1);
    expect(inputs[0]!.selection).toEqual({ anchor: { node: 'text', offset: 1 }, focus: { node: 'text', offset: 1 } });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('x');
    await expect.poll(() => inputs.length).toBe(2);
    expect(inputs[1]!.selection).toEqual({ anchor: { node: 'text', offset: 0 }, focus: { node: 'text', offset: 0 } });
});

test('pointer movement replaces the restored boundary before native input', async ({ page }) => {
    const inputs = await prepare(page);
    const target = await page.evaluate(() => {
        const text = window.muya!.domNode.querySelector('[data-boundary-control]')!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 1);
        range.setEnd(text, 2);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.15, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(target.x, target.y);
    await page.keyboard.type('x');
    await expect.poll(() => inputs.length).toBe(1);
    expect(inputs[0]!.selection).toEqual({ anchor: { node: 'text', offset: 1 }, focus: { node: 'text', offset: 1 } });
});
