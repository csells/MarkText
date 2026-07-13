// @vitest-environment happy-dom

import type Parent from '../../../block/base/parent';
import type Table from '../../../block/gfm/table';
import { afterEach, describe, expect, it } from 'vitest';
import { TableDragBar } from '..';
import { Muya } from '../../../muya';

const editors: Muya[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    document.body.replaceChildren();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('table drag mutation gateway', () => {
    it('rejects delayed column reordering while a clean projection is active', () => {
        const source
            = '| {++a++} | b |\n'
                + '| --- | --- |\n'
                + '| c | d |\n';
        const muya = boot(source);
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        const beforeMarkdown = muya.getMarkdown();
        const table = muya.editor.scrollPage!.firstChild as Table;
        const dragBar = new TableDragBar(muya, {});
        Object.assign(dragBar, {
            muya,
            _dragInfo: {
                table,
                barType: 'bottom',
                index: 0,
                curIndex: 1,
                offset: 100,
            },
        });

        (dragBar as unknown as { _switchTableData: () => void })
            ._switchTableData();

        expect((muya.editor.scrollPage!.firstChild as Parent) === table)
            .toBe(true);
        expect(muya.getMarkdown()).toBe(beforeMarkdown);
    });
});
