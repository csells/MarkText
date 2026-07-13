import type Table from '.';
import type { Muya } from '../../../muya';
import type { ITableCellMeta, ITableCellState } from '../../../state/types';
import type TableCellContent from '../../content/tableCell';
import type Row from './row';
import type TableInner from './table';
import diff from 'fast-diff';
import { diffToTextOp, mixins } from '../../../utils';
import Parent from '../../base/parent';
import LeafQueryBlock from '../../mixins/leafQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(LeafQueryBlock)
class TableBodyCell extends Parent<TableCellContent> {
    get meta(): Readonly<ITableCellMeta> {
        return this.readBlockMeta<ITableCellMeta>();
    }

    static override blockName = 'table.cell';

    static create(muya: Muya, state: ITableCellState) {
        const cell = new TableBodyCell(muya, state);

        cell.append(
            ScrollPage.loadBlock('table.cell.content').create(muya, state.text),
        );

        return cell;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, 'children', offset];
    }

    get table() {
        return this.closestBlock('table') as Table;
    }

    get row() {
        return this.closestBlock('table.row') as Row;
    }

    get rowOffset() {
        return (this.table.firstChild as TableInner).offset(this.row);
    }

    get columnOffset() {
        return this.row!.offset(this);
    }

    get align() {
        return this.meta.align;
    }

    set align(value) {
        const oldValue = this.meta.align;
        if (oldValue === value)
            return;
        this.#applyAlignment(value, 'document-edit');
        const path = this.path;
        path.push('meta', 'align');
        this.jsonState.editOperation(
            path,
            diffToTextOp(diff(oldValue, value)),
        );
    }

    /** Apply an already-committed JSON alignment during incremental rebuild. */
    applyAlignmentFromState(value: string): void {
        this.#applyAlignment(value, 'prepared-state');
    }

    #applyAlignment(
        value: string,
        source: 'document-edit' | 'prepared-state',
    ): void {
        const nextMeta = { ...this.meta, align: value };
        if (source === 'document-edit') {
            this.replaceBlockMetaForDocumentEdit(
                nextMeta,
                'Table cell alignment mutation',
            );
        }
        else {
            this.replaceBlockMetaFromPreparedState(
                nextMeta,
                'Prepared table cell alignment application',
            );
        }
        this.domNode!.dataset.align = value;
    }

    constructor(muya: Muya, { meta }: ITableCellState) {
        super(muya);
        this.tagName = 'td';
        this.initializeBlockMeta(meta);
        this.datasets = {
            align: meta.align,
        };
        this.classList = ['mu-table-cell'];
        this.createDomNode();
    }

    override getState(): ITableCellState {
        const state: ITableCellState = {
            name: 'table.cell',
            meta: { ...this.meta },
            text: (this.firstChild as TableCellContent).text,
        };

        return this.withStateSourceTrivia(state);
    }
}

export default TableBodyCell;
