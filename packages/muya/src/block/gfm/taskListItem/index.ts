import type { Muya } from '../../../muya';
import type { ITaskListItemMeta, ITaskListItemState } from '../../../state/types';
import type { TBlockPath } from '../../types';
import { CLASS_NAMES } from '../../../config';
import { mixins } from '../../../utils';
import { appendCreatedChildren } from '../../appendCreatedChildren';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(IContainerQueryBlock)
class TaskListItem extends Parent<Parent> {
    get meta(): Readonly<ITaskListItemMeta> {
        return this.readBlockMeta<ITaskListItemMeta>();
    }

    static override blockName = 'task-list-item';

    static create(muya: Muya, state: ITaskListItemState) {
        const listItem = new TaskListItem(muya, state);

        listItem.appendAttachment(
            ScrollPage.loadBlock('task-list-checkbox').create(muya, state.meta),
        );

        appendCreatedChildren(
            state.children,
            child => ScrollPage.createStateBlock(muya, child),
            child => listItem.append(child),
        );

        return listItem;
    }

    override get path(): TBlockPath {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    get checked() {
        return this.meta.checked;
    }

    set checked(checked) {
        const oldCheckStatus = this.meta.checked;

        if (checked !== oldCheckStatus) {
            this.replaceBlockMetaForDocumentEdit(
                { ...this.meta, checked },
                'Task-list checked mutation',
            );
            const { path } = this;
            path.pop();
            path.push('meta', 'checked');

            this.jsonState.replaceOperation(path, oldCheckStatus, checked);
        }
    }

    /** Update the live mirror after JSONState already applied the operation. */
    applyCheckedFromState(checked: boolean): void {
        this.replaceBlockMetaFromPreparedState(
            { ...this.meta, checked },
            'Prepared task-list item checked application',
        );
    }

    constructor(muya: Muya, { meta }: ITaskListItemState) {
        super(muya);
        this.tagName = 'li';
        this.initializeBlockMeta(meta);
        this.classList = [CLASS_NAMES.MU_TASK_LIST_ITEM];
        this.createDomNode();
    }

    override getState(): ITaskListItemState {
        const state: ITaskListItemState = {
            name: 'task-list-item',
            meta: { ...this.meta },
            children: this.children.map(child => child.getState()),
        };

        return this.withStateSourceTrivia(state);
    }
}

export default TaskListItem;
