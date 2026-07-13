import type { Muya } from '../../muya';
import type { TState } from '../../state/types';
import type { Nullable } from '../../types';
import type { TBlockPath } from '../types';
import { LinkedList } from '../../block/base/linkedList/linkedList';
import TreeNode from '../../block/base/treeNode';
import { CLASS_NAMES } from '../../config';
import { operateClassName } from '../../utils/dom';
import logger from '../../utils/logger';

const debug = logger('parent:');

class Parent<Child extends TreeNode = TreeNode> extends TreeNode {
    // Used to store icon, checkbox(span) etc. these blocks are not in children properties in json state.
    readonly #attachments = new LinkedList<TreeNode>();
    readonly #children = new LinkedList<Child>();
    readonly #attachmentView = this.#attachments.readonlyView();
    readonly #childView = this.#children.readonlyView();

    get attachments() {
        return this.#attachmentView;
    }

    get children() {
        return this.#childView;
    }

    override get prev(): Nullable<Parent> {
        return super.prev as Nullable<Parent>;
    }

    override set prev(value: Nullable<Parent>) {
        super.prev = value;
    }

    override get next(): Nullable<Parent> {
        return super.next as Nullable<Parent>;
    }

    override set next(value: Nullable<Parent>) {
        super.next = value;
    }

    private _active: boolean = false;

    constructor(muya: Muya) {
        super(muya);
    }

    get active() {
        return this._active;
    }

    set active(value) {
        this._active = value;

        if (this.domNode == null) {
            debug.error('domNode is null.');

            return;
        }

        if (value)
            operateClassName(this.domNode, 'add', CLASS_NAMES.MU_ACTIVE);
        else
            operateClassName(this.domNode, 'remove', CLASS_NAMES.MU_ACTIVE);
    }

    get firstChild() {
        return this.children.head;
    }

    get lastChild() {
        return this.children.tail;
    }

    protected get isContainerBlock() {
        // `task-list-item` is intentionally omitted: it shares the
        // `task-list` prefix and would be matched by the alternative above.
        return /block-quote|order-list|bullet-list|task-list|list-item/.test(
            this.blockName,
        );
    }

    get path(): TBlockPath {
    // You should never call get path on Parent.
        debug.error('You should never call get path on Parent.');
        return [];
    }

    private _getJsonPath() {
        const { path } = this;
        if (this.isContainerBlock)
            path.pop();

        return path;
    }

    getState(): TState {
    // You should never call get state on Parent.
        debug.error('You should never call get state on Parent.');
        return {} as TState;
    }

    /**
     * Clone itself.
     */
    clone() {
        const state = this.getState();
        const { muya } = this;
        const clone = this.static.create(muya, state);
        clone.initializeStateSourceTrivia(state.sourceTrivia);
        return clone;
    }

    /**
     * Return the length of children.
     */
    length() {
        return this.reduce((acc: number) => acc + 1, 0);
    }

    offset(node: Child) {
        return this.#children.offset(node);
    }

    find(offset: number) {
        return this.children.find(offset);
    }

    private _assertChildMutationAuthorized(
        source: string,
        operation: string,
        children: readonly Child[],
    ): void {
        if (source === 'user') {
            this.assertMutationAuthorized(operation);
            return;
        }
        if (
            this.isAttachedToLiveTree
            || children.some(child => child.isAttachedToLiveTree)
        ) {
            this.assertTreeMutationAuthorized(operation);
        }
    }

    /**
     * Append node in linkedList, mounted it into the DOM tree, dispatch operation if necessary.
     * @param  {...any} args
     */
    append(...childrenAndSource: [...Child[], string]): void;
    append(...children: Child[]): void;
    append(...args: unknown[]) {
        const sourceValue = args[args.length - 1];
        let source = 'api';
        if (typeof sourceValue === 'string') {
            args.pop();
            source = sourceValue;
        }
        const children = args as Child[];
        this._assertChildMutationAuthorized(
            source,
            'Block append',
            children,
        );

        children.forEach((node) => {
            node.parent = this;
            const { domNode } = node;
            this.domNode!.appendChild(domNode!);
        });

        for (const child of children)
            this.#children.append(child);

        // push operations
        if (source === 'user') {
            children.forEach((node) => {
                if (!node.isParent()) {
                    throw new TypeError(
                        'A user block append requires a serializable parent node.',
                    );
                }
                const path = node._getJsonPath();
                const state = node.getState();
                this.jsonState.insertOperation(path, state);
            });
        }
    }

    /**
     * This method will only be used when initialization.
     * @param  {...any} nodes attachment blocks
     */
    protected appendAttachment(...nodes: TreeNode[]) {
        nodes.forEach((node) => {
            node.parent = this;
            const { domNode } = node;
            this.domNode!.appendChild(domNode!);
        });

        for (const node of nodes)
            this.#attachments.append(node);
    }

    forEachAt(
        index: number,
        length: number = this.length(),
        callback: (cur: Child, i: number) => void,
    ) {
        return this.children.forEachAt(index, length, callback);
    }

    forEach(callback: (cur: Child, i: number) => void) {
        return this.children.forEach(callback);
    }

    map<M>(callback: (cur: Child, i: number) => M): M[] {
        return this.children.map(callback);
    }

    reduce<M>(
        callback: (memo: M, cur: Child, i: number) => M,
        initialValue: M,
    ): M {
        return this.children.reduce<M>(callback, initialValue);
    }

    /**
     * Use the `block` to replace the current block(this)
     * @param {TreeNode} block
     */
    replaceWith(block: Parent, source = 'user') {
        if (!this.parent) {
            debug.warn('Call replaceWith need has a parent block');

            return;
        }

        this.parent.insertBefore(block, this, source);
        block.parent = this.parent;
        this.remove(source);

        return block;
    }

    insertBefore(
        newNode: Child,
        refNode: Nullable<Child> = null,
        source = 'user',
    ) {
        this._assertChildMutationAuthorized(
            source,
            'Block insertion',
            [newNode],
        );
        newNode.parent = this;
        this.#children.insertBefore(newNode, refNode);
        this.domNode!.insertBefore(
            newNode.domNode!,
            refNode ? refNode.domNode! : null,
        );

        if (source === 'user') {
            if (!newNode.isParent()) {
                throw new TypeError(
                    'A user block insertion requires a serializable parent node.',
                );
            }
            // dispatch json1 operation
            const path = newNode._getJsonPath();
            const state = newNode.getState();
            this.jsonState.insertOperation(path, state);
        }

        return newNode;
    }

    insertAfter(newNode: Child, refNode: Nullable<Child> = null, source = 'user') {
        // Children in one linked list share this parent's Child domain.
        const next = refNode?.next as Nullable<Child>;
        this.insertBefore(newNode, next, source);

        return newNode;
    }

    override remove(source = 'user') {
        if (source === 'user')
            this.assertMutationAuthorized('Block removal');
        else if (this.isAttachedToLiveTree)
            this.assertTreeMutationAuthorized('Block removal');
        if (source === 'user') {
            // dispatch json1 operation
            const path = this._getJsonPath();
            this.jsonState.removeOperation(path);
        }

        super.remove(source);

        return this;
    }

    protected empty() {
        this.forEach((child) => {
            this.removeChild(child, 'api');
        });
    }

    removeChild(node: Child, source = 'user') {
        if (!this.#children.contains(node)) {
            debug.warn(
                'Can not removeChild(node), because node is not child of this block',
            );
        }

        if (node.isParent())
            node.remove(source);
        else if (node.isContent())
            node.remove();

        return node;
    }

    /** Internal unlink step used after TreeNode has asserted mutation authority. */
    detachLinkedChild(node: TreeNode): void {
        if (this.isAttachedToLiveTree)
            this.assertTreeMutationAuthorized('Linked child detachment');
        // The identity membership check proves the generic relationship that
        // TypeScript cannot recover from a base TreeNode reference.
        const child = node as Child;
        if (!this.#children.contains(child)) {
            throw new TypeError(
                'Cannot detach a node that is not a child of this parent.',
            );
        }
        this.#children.remove(child);
    }

    /**
     * find the first content block, paragraph.content etc.
     */
    firstContentInDescendant() {
        let likeContentBlock: Nullable<TreeNode> = this.children.head;

        while (likeContentBlock && likeContentBlock.isParent())
            likeContentBlock = likeContentBlock.children.head;

        return likeContentBlock?.isContent() ? likeContentBlock : null;
    }

    /**
     * find the last content block in container block.
     */
    lastContentInDescendant() {
        let likeContentBlock: Nullable<TreeNode> = this.children.tail;

        while (likeContentBlock && likeContentBlock.isParent())
            likeContentBlock = likeContentBlock.children.tail;

        return likeContentBlock?.isContent() ? likeContentBlock : null;
    }

    breadthFirstTraverse(this: Parent, callback: (node: TreeNode) => void) {
        const queue: TreeNode[] = [this];

        while (queue.length) {
            const node = queue.shift()!;

            callback(node);

            if (node.isParent())
                node.children.forEach(child => queue.push(child));
        }
    }

    depthFirstTraverse(this: Parent, callback: (node: TreeNode) => void) {
        const stack: TreeNode[] = [this];

        while (stack.length) {
            const node = stack.shift()!;

            callback(node);

            if (node.isParent()) {
                // Use splice ot make sure the first block in document is process first.
                node.children.forEach((child, i) => stack.splice(i, 0, child));
            }
        }
    }
}

export default Parent;
