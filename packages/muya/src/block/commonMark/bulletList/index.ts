import type { Muya } from '../../../muya';
import type { IBulletListState } from '../../../state/types';
import type ListItem from '../listItem';
import { CLASS_NAMES } from '../../../config';
import { mixins } from '../../../utils';
import { appendCreatedChildren } from '../../appendCreatedChildren';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(IContainerQueryBlock)
class BulletList extends Parent<Parent> {
    static override blockName = 'bullet-list';

    static create(muya: Muya, state: IBulletListState) {
        const bulletList = new BulletList(muya, state);

        appendCreatedChildren(
            state.children,
            child => ScrollPage.createStateBlock(muya, child),
            child => bulletList.append(child),
        );

        return bulletList;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    get meta(): Readonly<IBulletListState['meta']> {
        return this.readBlockMeta<IBulletListState['meta']>();
    }

    constructor(muya: Muya, { meta }: IBulletListState) {
        super(muya);
        this.tagName = 'ul';
        this.initializeBlockMeta(meta);
        this.datasets = {
            marker: meta.marker,
        };
        this.classList = [CLASS_NAMES.MU_BULLET_LIST];
        if (!meta.loose)
            this.classList.push('mu-tight-list');

        this.createDomNode();
    }

    override getState(): IBulletListState {
        const state: IBulletListState = {
            name: 'bullet-list',
            meta: { ...this.meta },
            children: this.children.map(child => (child as ListItem).getState()),
        };

        return this.withStateSourceTrivia(state);
    }
}

export default BulletList;
