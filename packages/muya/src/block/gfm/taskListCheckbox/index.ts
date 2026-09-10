import type { Muya } from '../../../muya';
import type { ITaskListItemMeta } from '../../../state/types';
import type { Nullable } from '../../../types';
import type Parent from '../../base/parent';
import type TaskList from '../taskList';
import type TaskListItem from '../taskListItem';
import { taskCheckedChanges } from '@marktext/input-policy';
import { CLASS_NAMES, isFirefox } from '../../../config';
import { dispatchDocumentTask } from '../../../editor/documentEditing';
import { isHTMLInputElement, isMouseEvent } from '../../../utils';
import { operateClassName } from '../../../utils/dom';
import logger from '../../../utils/logger';
import TreeNode from '../../base/treeNode';

const debug = logger('tasklistCheckbox:');

// Block-name discriminators used by the autoCheck cascade to narrow the
// generic `TreeNode`/`Parent` tree shapes without a double-cast.
function isTaskListItem(node: Nullable<TreeNode>): node is TaskListItem {
    return !!node && node.blockName === 'task-list-item';
}

function isTaskList(node: Nullable<TreeNode>): node is TaskList {
    return !!node && node.blockName === 'task-list';
}

function isCheckbox(node: TreeNode): node is TaskListCheckbox {
    return node.blockName === TaskListCheckbox.blockName;
}

// Find the `task-list-checkbox` attachment of a `task-list-item`.
function checkboxOf(item: TaskListItem): TaskListCheckbox | null {
    let found: TaskListCheckbox | null = null;
    item.attachments.forEach((attachment: Parent) => {
        if (isCheckbox(attachment))
            found = attachment;
    });

    return found;
}

// Set a task item's checked state, dispatching the OT op (`TaskListItem.checked`
// setter) and syncing its checkbox DOM. No-op when already in the target state.
function setItemChecked(item: TaskListItem, checked: boolean): void {
    if (item.checked === checked)
        return;

    item.checked = checked;
    const checkbox = checkboxOf(item);
    if (checkbox)
        checkbox.syncDom(checked);
}

// The nested `task-list` directly under a `task-list-item`, if any. A task item
// holds a leading paragraph plus an optional nested list of sub-tasks.
function nestedTaskListOf(item: TaskListItem): TaskList | null {
    let nested: TaskList | null = null;
    item.children.forEach((child: TreeNode) => {
        if (isTaskList(child))
            nested = child;
    });

    return nested;
}

// The Task List Item component is Firefox compatible, because in Firefox,
// the input element is not clickable in the contenteditable element(li),
// and in Firefox, the span element is used instead of the input element.
// In the Chrome browser, the input element is still preserved because in Chrome,
// span has a cursor staggered problem.
class TaskListCheckbox extends TreeNode {
    private _checked: boolean;

    private _eventIds: string[] = [];

    static override blockName = 'task-list-checkbox';

    static create(muya: Muya, meta: ITaskListItemMeta) {
        const checkbox = new TaskListCheckbox(muya, meta);

        return checkbox;
    }

    get path() {
        const { path: pPath } = this.parent!;
        pPath.pop(); // pop `children`

        return [...pPath, 'meta', 'checked'];
    }

    get isContainerBlock() {
        return false;
    }

    constructor(muya: Muya, { checked }: ITaskListItemMeta) {
        super(muya);
        this.tagName = isFirefox ? 'span' : 'input';
        this._checked = checked;
        this.attributes = isFirefox
            ? { contenteditable: 'false' }
            : { type: 'checkbox', contenteditable: 'false' };
        this.classList = ['mu-task-list-checkbox'];

        if (checked) {
            if (!isFirefox)
                this.attributes.checked = true;

            this.classList.push(CLASS_NAMES.MU_CHECKBOX_CHECKED);
        }

        this.createDomNode();
        this.listen();
    }

    listen() {
        const { domNode, muya } = this;
        const { eventCenter } = muya;
        const clickHandler = (event: Event) => {
            if (!isMouseEvent(event))
                return;

            event.stopPropagation();

            if (muya.editor.documentEditing) {
                const checked = isHTMLInputElement(event.target) ? event.target.checked : !this._checked;
                this.syncDom(this._checked);
                this.update(checked, 'user');
                return;
            }

            if (isFirefox) {
                this._checked = !this._checked;

                this.update(this._checked, 'user');
            }
            else if (isHTMLInputElement(event.target)) {
                const { checked } = event.target;
                this._checked = checked;
                this.update(checked, 'user');
            }

            // The control is not editable, so clicking it does not move the
            // text selection. Seat the caret in this item before the desktop's
            // selection-follow scroll can reveal a stale off-screen cursor.
            (this.parent as TaskListItem).firstContentInDescendant()?.setCursor(0, 0, true);
        };

        const eventIds = [
            eventCenter.attachDOMEvent(domNode!, 'click', clickHandler),
        ];

        this._eventIds.push(...eventIds);
    }

    update = (checked: boolean, source = 'api') => {
        const taskListItem = this.parent as TaskListItem;
        const taskList = taskListItem!.parent as TaskList;

        if (source !== 'api' && this.muya.editor.documentEditing) {
            const content = taskListItem.firstContentInDescendant();
            const point = content && this.muya.editor.selection.getDOMPoint({ path: content.path, offset: 0 });
            if (!point)
                throw new Error('Task checkbox has no current content position');
            dispatchDocumentTask(this.muya, checked, { anchor: point, focus: point });
            return;
        }

        this._applyChecked(checked, source);

        // marktext `clickCtrl.js#listItemCheckBoxClick` cascaded a user toggle
        // through `muya.options.autoCheck`: checking/unchecking an item set the
        // same state on every descendant task item, then re-derived each
        // ancestor (checked iff all its siblings are checked). `source === 'api'`
        // is the silent, OT-free path used by the cascade itself, so it never
        // recurses.
        if (source !== 'api' && this.muya.options.autoCheck) {
            const changes = taskCheckedChanges(taskListItem, checked, true, {
                checked: item => item.checked,
                children: item => nestedTaskListOf(item)?.children.map(child => child).filter(isTaskListItem) ?? [],
                siblings: item => isTaskList(item.parent) ? item.parent.children.map(child => child).filter(isTaskListItem) : [],
                parent: item => isTaskList(item.parent) && isTaskListItem(item.parent.parent) ? item.parent.parent : undefined,
            });
            for (const [item, value] of changes)
                setItemChecked(item, value);
        }

        taskList.orderIfNecessary();
    };

    // Reflect `checked` onto this checkbox's DOM and onto its task-list-item
    // state. A `user` source dispatches the OT `replace` op (via the
    // `TaskListItem.checked` setter); an `api` source mutates the state
    // silently so the cascade can update many items without op spam.
    private _applyChecked(checked: boolean, source: string) {
        this.syncDom(checked);

        const taskListItem = this.parent as TaskListItem;
        if (source === 'api')
            taskListItem.meta.checked = checked;
        else
            taskListItem.checked = checked;
    }

    // Sync only this checkbox's DOM + internal flag to `checked`. Used by the
    // autoCheck cascade, which has already mutated the owning item's state (and
    // dispatched the OT op) via the `TaskListItem.checked` setter, so this must
    // not touch state again.
    syncDom(checked: boolean) {
        this._checked = checked;
        operateClassName(
            this.domNode!,
            checked ? 'add' : 'remove',
            CLASS_NAMES.MU_CHECKBOX_CHECKED,
        );

        if (isHTMLInputElement(this.domNode) && this.domNode.checked !== checked && !isFirefox)
            this.domNode.checked = checked;
    }

    private _detachDOMEvents() {
        for (const id of this._eventIds)
            this.muya.eventCenter.detachDOMEvent(id);
    }

    override remove(_source: string) {
        super.remove();
        this._detachDOMEvents();

        return this;
    }

    getState() {
        debug.warn('You should never call this method.');
    }
}

export default TaskListCheckbox;
