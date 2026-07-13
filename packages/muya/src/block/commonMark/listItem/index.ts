import type { Muya } from '../../../muya';
import type { IListItemState } from '../../../state/types';
import { CLASS_NAMES } from '../../../config';
import { mixins } from '../../../utils';
import { appendCreatedChildren } from '../../appendCreatedChildren';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(IContainerQueryBlock)
class ListItem extends Parent<Parent> {
    static override blockName = 'list-item';

    static create(muya: Muya, state: IListItemState) {
        const listItem = new ListItem(muya);

        appendCreatedChildren(
            state.children,
            child => ScrollPage.createStateBlock(muya, child),
            child => listItem.append(child),
        );

        return listItem;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'li';
        this.classList = [CLASS_NAMES.MU_LIST_ITEM];
        this.createDomNode();
    }

    override getState(): IListItemState {
        const state: IListItemState = {
            name: 'list-item',
            children: this.children.map(child => child.getState()),
        };

        return this.withStateSourceTrivia(state);
    }
}

export default ListItem;
