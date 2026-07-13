import type { Muya } from '../../../muya';
import type { ITableState } from '../../../state/types';
import type TableRow from './row';
import { mixins } from '../../../utils';
import { appendCreatedChildren } from '../../appendCreatedChildren';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(IContainerQueryBlock)
class TableInner extends Parent<TableRow> {
    static override blockName = 'table.inner';

    static create(muya: Muya, state: ITableState) {
        const table = new TableInner(muya, state);

        appendCreatedChildren(
            state.children,
            child => ScrollPage.createStateBlock(muya, child) as TableRow,
            child => table.append(child),
        );

        return table;
    }

    override get path() {
        return [...this.parent!.path, 'children'];
    }

    constructor(muya: Muya, _state: ITableState) {
        super(muya);
        this.tagName = 'table';

        this.classList = ['mu-table-inner'];
        this.createDomNode();
    }

    override getState(): ITableState {
        const state: ITableState = {
            name: 'table',
            children: this.map(node => (node as TableRow).getState()),
        };

        return this.withStateSourceTrivia(state);
    }
}

export default TableInner;
