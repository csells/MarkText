import type { VNode } from 'snabbdom';
import type Content from '../../block/base/content';
import type TableBodyCell from '../../block/gfm/table/cell';
import type TableInner from '../../block/gfm/table/table';

import type { Muya } from '../../index';
import type { MenuItem } from './config';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import { toolList } from './config';
import './index.css';

const defaultOptions = {
    placement: 'bottom' as const,
    offsetOptions: {
        mainAxis: 0,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

interface ITableInfo {
    barType: 'bottom' | 'right';
}

export class TableRowColumMenu extends BaseFloat {
    static pluginName = 'tableBarTools';
    public override capturesContentKeydown = true;
    private _oldVNode: VNode | null = null;
    private _tableInfo: ITableInfo | null = null;
    private _block: TableBodyCell | null = null;
    private _tableBarContainer: HTMLDivElement = document.createElement('div');

    constructor(muya: Muya, options = {}) {
        const name = 'mu-table-bar-tools';
        const opts = Object.assign({}, defaultOptions, options);
        super(muya, name, opts);

        this.floatBox!.classList.add('mu-table-bar-tools');
        this.container!.appendChild(this._tableBarContainer);
        this.listen();
    }

    override listen() {
        super.listen();
        const { eventCenter } = this.muya;
        eventCenter.subscribe(
            'muya-table-bar',
            ({ reference, tableInfo, block }) => {
                if (reference) {
                    this._tableInfo = tableInfo;
                    this._block = block;
                    this.show(reference);
                    this.render();
                }
                else {
                    this.hide();
                }
            },
        );
    }

    render() {
        const { _tableInfo: tableInfo, _oldVNode: oldVNode, _tableBarContainer: tableBarContainer } = this;
        const { i18n } = this.muya;
        const renderArray: MenuItem[] = toolList[tableInfo!.barType];
        const children = renderArray.map((item) => {
            const { label } = item;

            const selector = 'li.item';

            return h(
                selector,
                {
                    dataset: {
                        label: item.action,
                    },
                    on: {
                        click: (event) => {
                            this.selectItem(event, item);
                        },
                    },
                },
                i18n.t(label),
            );
        });

        const vnode = h('ul', children);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(tableBarContainer, vnode);

        this._oldVNode = vnode;
    }

    selectItem(event: Event, item: MenuItem) {
        event.preventDefault();
        event.stopPropagation();

        const { table, row } = this._block!;
        const rowCount = (table.firstChild as TableInner).offset(row);
        const columnCount = row.offset(this._block!);
        const { location, action, target } = item;
        const outcome: { cursorBlock: Content | null } = {
            cursorBlock: null,
        };

        const result = this.muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                if (action === 'insert') {
                    if (target === 'row') {
                        const offset = location === 'previous'
                            ? rowCount
                            : rowCount + 1;
                        outcome.cursorBlock = table.insertRow(offset) ?? null;
                    }
                    else {
                        const offset = location === 'left'
                            ? columnCount
                            : columnCount + 1;
                        outcome.cursorBlock
                            = table.insertColumn(offset) ?? null;
                    }
                }
                else {
                    // The table mutators return a surviving neighbour (or an
                    // outside block when the whole table disappears).
                    outcome.cursorBlock = (target === 'row'
                        ? table.removeRow(rowCount)
                        : table.removeColumn(columnCount)) ?? null;
                }
            },
        );

        // Tracked/rejected mutations restore or replace the speculative tree.
        // Only direct edits leave this returned cursor block attached.
        if (
            result === 'untracked'
            && outcome.cursorBlock?.domNode?.isConnected
        ) {
            outcome.cursorBlock.setCursor(0, 0);
        }

        this.hide();
    }
}
