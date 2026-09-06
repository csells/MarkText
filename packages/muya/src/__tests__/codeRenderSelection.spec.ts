// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { Muya } from '../muya';

it.each([false, true])('preserves the current selection when code highlighting refreshes (cross-block: %s)', (crossBlock) => {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: '~~~js\nword\n~~~\n\nafter' });
    muya.init();
    try {
        const owner = muya.editor.scrollPage!.queryBlock([0]);
        if (!owner || owner.isContent())
            throw new Error('Expected code block');
        const code = owner.lastContentInDescendant();
        const after = muya.editor.scrollPage!.lastContentInDescendant();
        if (!code || !after)
            throw new Error('Expected editable content');
        const anchor = { block: code, path: code.path, offset: 2 };
        const focus = crossBlock ? { block: after, path: after.path, offset: 3 } : anchor;
        muya.editor.selection.setSelection(anchor, focus);
        code.update();
        const selection = muya.getSelection();
        expect(selection?.anchor).toMatchObject({ path: code.path, offset: 2 });
        expect(selection?.focus).toMatchObject({ path: focus.path, offset: focus.offset });
        expect(muya.getMarkdown()).toContain('word');
    }
    finally {
        muya.destroy();
        muya.domNode.remove();
    }
});
