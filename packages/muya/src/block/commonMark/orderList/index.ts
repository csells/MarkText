import type { Muya } from '../../../muya';
import type { IOrderListState } from '../../../state/types';
import type ListItem from '../listItem';
import { CLASS_NAMES } from '../../../config';
import { mixins } from '../../../utils';
import { appendCreatedChildren } from '../../appendCreatedChildren';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(IContainerQueryBlock)
class OrderList extends Parent<Parent> {
    get meta(): Readonly<IOrderListState['meta']> {
        return this.readBlockMeta<IOrderListState['meta']>();
    }

    static override blockName = 'order-list';

    static create(muya: Muya, state: IOrderListState) {
        const orderList = new OrderList(muya, state);

        appendCreatedChildren(
            state.children,
            child => ScrollPage.createStateBlock(muya, child),
            child => orderList.append(child),
        );

        return orderList;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    constructor(muya: Muya, { meta }: IOrderListState) {
        super(muya);
        this.tagName = 'ol';
        this.initializeBlockMeta(meta);
        this.attributes = { start: String(meta.start) };
        this.datasets = { delimiter: meta.delimiter };
        this.classList = [CLASS_NAMES.MU_ORDER_LIST];
        if (!meta.loose)
            this.classList.push('mu-tight-list');

        this.createDomNode();
    }

    override getState(): IOrderListState {
        const state: IOrderListState = {
            name: 'order-list',
            meta: { ...this.meta },
            children: this.children.map(child => (child as ListItem).getState()),
        };

        return this.withStateSourceTrivia(state);
    }
}

export default OrderList;
