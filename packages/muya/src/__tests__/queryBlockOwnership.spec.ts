// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { Muya } from '../muya';

it('resolves retained heading and nested content paths repeatedly without consuming them', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: '# Heading\n\n> nested\n' });
    muya.init();
    try {
        for (const path of [[0], [1, 'children', 0, 'text']]) {
            const retained = [...path];
            const first = muya.editor.scrollPage!.queryBlock(path);
            expect(first).toBeDefined();
            expect(path).toEqual(retained);
            expect(muya.editor.scrollPage!.queryBlock(path)).toBe(first);
        }
    }
    finally {
        muya.destroy();
        muya.domNode.remove();
    }
});
