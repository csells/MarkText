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

it('draws an action with an icon in the format row, named by its label', () => {
    const run = vi.fn();
    const { toolbar } = createToolbar(() => [{ id: 'add-comment', label: 'Add Comment', enabled: true, run, icon: 'data:image/svg+xml,x' }]);
    const item = toolbar.container!.querySelector<HTMLElement>('.mu-format-row li[data-action="add-comment"]');
    expect(item, 'the review icon shares the formatting row').not.toBeNull();
    expect(item!.getAttribute('aria-label')).toBe('Add Comment');
    expect(item!.getAttribute('title')).toBe('Add Comment');
    expect(toolbar.container!.querySelector('.mu-format-host-actions'), 'no second row of text buttons').toBeNull();
    item!.click();
    expect(run).toHaveBeenCalledOnce();
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

function createTwoParagraphs(actions: () => Array<{ id: string; label: string; enabled: boolean; run: () => void }>) {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: 'first words\n\nsecond words\n', inlineToolbarActions: actions });
    muya.init();
    const toolbar = new InlineFormatToolbar(muya);
    cleanup.push(() => {
        toolbar.destroy();
        muya.destroy();
        muya.domNode.remove();
    });
    const first = muya.editor.scrollPage!.firstContentInDescendant()!;
    const last = muya.editor.scrollPage!.lastContentInDescendant()!;
    return { muya, toolbar, first, last };
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

it('a selection spanning paragraphs shows only the host actions and runs them with that selection', async () => {
    const run = vi.fn();
    const { muya, toolbar, first, last } = createTwoParagraphs(() => [{ id: 'add-comment', label: 'Add Comment', enabled: true, run }]);
    muya.editor.selection.setSelection({ block: first, path: first.path, offset: 2 }, { block: last, path: last.path, offset: 6 });
    await nextFrame();
    expect(toolbar.status, 'the toolbar opens for a multi-paragraph selection').toBe(true);
    expect(toolbar.container!.querySelector('li.item'), 'formatting tools stay single-block').toBeNull();
    const button = toolbar.container!.querySelector<HTMLButtonElement>('button[data-action="add-comment"]')!;
    button.click();
    expect(run).toHaveBeenCalledOnce();
    expect(muya.editor.selection.anchorBlock).toBe(first);
    expect(muya.editor.selection.focusBlock).toBe(last);
    expect(muya.getMarkdown()).toBe('first words\n\nsecond words\n');
});

it('collapsing a multi-paragraph selection closes the host-actions toolbar, and no host actions means no toolbar', async () => {
    const { muya, toolbar, first, last } = createTwoParagraphs(() => [{ id: 'add-comment', label: 'Add Comment', enabled: true, run: vi.fn() }]);
    muya.editor.selection.setSelection({ block: first, path: first.path, offset: 2 }, { block: last, path: last.path, offset: 6 });
    await nextFrame();
    expect(toolbar.status).toBe(true);
    muya.editor.selection.setSelection({ block: last, path: last.path, offset: 6 }, { block: last, path: last.path, offset: 6 });
    expect(toolbar.status).toBe(false);

    const bare = createTwoParagraphs(() => []);
    bare.muya.editor.selection.setSelection({ block: bare.first, path: bare.first.path, offset: 2 }, { block: bare.last, path: bare.last.path, offset: 6 });
    await nextFrame();
    expect(bare.toolbar.status).toBe(false);
});
