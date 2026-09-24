// @vitest-environment happy-dom
import type CellBlock from '../../../block/gfm/table/cell';
import type { DocumentEditing, DocumentInput } from '../../../editor/documentEditingTypes';
import { afterEach, expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';
import { TableColumnToolbar } from '../index';

const cleanup: (() => void)[] = [];
afterEach(() => {
    while (cleanup.length)
        cleanup.pop()!();
});

function boot() {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host);
    muya.init();
    muya.setContent('| a | b |\n| --- | --- |\n| c | d |\n');
    const inputs: DocumentInput[] = [];
    muya.editor.documentEditing = { input: vi.fn((input: DocumentInput) => inputs.push(input)), activeFormats: () => [] } as unknown as DocumentEditing;
    const toolbar = new TableColumnToolbar(muya);
    cleanup.push(() => {
        toolbar.destroy();
        muya.destroy();
        muya.domNode.remove();
    });
    const cell = muya.editor.scrollPage!.firstContentInDescendant()!.parent as unknown as CellBlock;
    expect(cell.blockName).toBe('table.cell');
    (toolbar as unknown as { _block: CellBlock })._block = cell;
    return { muya, toolbar, inputs, cell };
}

function select(toolbar: TableColumnToolbar, type: 'left' | 'center' | 'right') {
    const event = new MouseEvent('click', { cancelable: true });
    toolbar.selectItem(event, { type } as Parameters<TableColumnToolbar['selectItem']>[1]);
}

it('aligns the toolbar column at its own cell when the editor has no live selection', () => {
    const { toolbar, inputs, cell } = boot();
    document.getSelection()?.removeAllRanges();
    select(toolbar, 'center');
    expect(inputs).toHaveLength(1);
    const input = inputs[0] as Extract<DocumentInput, { kind: 'command' }> & { command: 'alignTableColumn' };
    expect(input).toMatchObject({ kind: 'command', command: 'alignTableColumn', alignment: 'center' });
    expect(cell.firstContentInDescendant()!.domNode!.contains(input.target.node)).toBe(true);
    expect(input.selection).toEqual({ anchor: input.target, focus: input.target });
});

it('keeps the live editor selection when one exists', () => {
    const { muya, toolbar, inputs } = boot();
    const last = muya.editor.scrollPage!.lastContentInDescendant()!;
    muya.editor.selection.setSelection({ offset: 1, block: last, path: last.path }, { offset: 1, block: last, path: last.path });
    const live = muya.editor.selection.getDOMSelection();
    expect(live).not.toBeNull();
    select(toolbar, 'right');
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as { selection: unknown }).selection).toEqual(live);
});
