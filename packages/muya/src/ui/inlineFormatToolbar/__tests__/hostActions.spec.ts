// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';
import { InlineFormatToolbar } from '../index';

const cleanup: Array<() => void> = [];
afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
});

function createToolbar(actions: () => Array<{ id: string; label: string; enabled: boolean; run: () => void }>) {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: 'review these words', inlineToolbarActions: actions });
    muya.init();
    const toolbar = new InlineFormatToolbar(muya);
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;
    muya.editor.selection.setSelection({ block, path: block.path, offset: 7 }, { block, path: block.path, offset: 12 });
    toolbar.status = true;
    muya.eventCenter.emit('selection-change', { formats: [], isCollapsed: false, isSelectionInSameBlock: true });
    cleanup.push(() => {
        toolbar.destroy();
        muya.destroy();
        muya.domNode.remove();
    });
    return { muya, toolbar };
}

it('the existing selection toolbar invokes host review actions with the selected text intact', () => {
    const run = vi.fn();
    const { muya, toolbar } = createToolbar(() => [{ id: 'add-comment', label: 'Add Comment', enabled: true, run }]);
    const button = toolbar.container!.querySelector<HTMLButtonElement>('button[data-action="add-comment"]');
    expect(button, 'review action is reachable from the existing selection toolbar').not.toBeNull();
    expect(button!.textContent).toBe('Add Comment');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    button!.click();
    expect(run).toHaveBeenCalledOnce();
    expect(muya.editor.selection.anchor?.offset).toBe(7);
    expect(muya.editor.selection.focus?.offset).toBe(12);
    expect(muya.getMarkdown()).toBe('review these words\n');
    expect(toolbar.status).toBe(false);
    expect(toolbar.container!.querySelector('li.item.strong')).not.toBeNull();
    expect(toolbar.container!.querySelector('li.item.mark')).not.toBeNull();
});

it('does not run an action whose host availability changed after the selection toolbar opened', () => {
    let enabled = true;
    const run = vi.fn();
    const { toolbar } = createToolbar(() => [{ id: 'mark-highlight', label: 'Mark Highlight', enabled, run }]);
    const button = toolbar.container!.querySelector<HTMLButtonElement>('button[data-action="mark-highlight"]')!;
    expect(button.disabled).toBe(false);
    enabled = false;
    button.click();
    expect(run).not.toHaveBeenCalled();
    expect(toolbar.container!.querySelector<HTMLButtonElement>('button[data-action="mark-highlight"]')!.disabled).toBe(true);
});
