import type { Muya } from '../../muya';
import type { TState } from '../../state/types';
import type { Nullable } from '../../types';
import type Content from '../base/content';
import type TreeNode from '../base/treeNode';
import type { IConstructor, TBlockPath } from '../types';
import { isEqual } from 'underscore';
import { BLOCK_DOM_PROPERTY } from '../../config';
import { dispatchDocumentBlock } from '../../editor/documentEditing';
import { isHTMLElement, isMouseEvent } from '../../utils';
import logger from '../../utils/logger';
import Parent from '../base/parent';

const debug = logger('scrollpage:');

interface IBlurFocus {
    blur: Nullable<Content>;
    focus: Nullable<Content>;
}

export class ScrollPage extends Parent {
    private _blurFocus: IBlurFocus = { blur: null, focus: null };

    static override blockName = 'scrollpage';

    // Registry of block constructors keyed by their static blockName.
    // Stored as Parent constructors — the overwhelming majority of
    // call sites do `loadBlock(...).create(...).append(child)`, which only
    // makes sense for Parent. Content leaves register themselves through
    // their containing Parent's create flow and don't go through
    // `loadBlock(...).create()` externally.
    private static _registeredBlocks = new Map<string, IConstructor<Parent>>();

    static register(Block: IConstructor<TreeNode>) {
        const { blockName } = Block;
        this._registeredBlocks.set(blockName, Block as IConstructor<Parent>);
    }

    // Returns the registered constructor. Asserts non-undefined for
    // callers (the registry is populated by `registerBlocks()` once at
    // `editor.init()` time, and `loadBlock` runs strictly after init.).
    // Mismatched names hit the warn branch and the caller crashes at
    // `.create()` — matches the original loose contract.
    static loadBlock(blockName: string): IConstructor<Parent> {
        const block = this._registeredBlocks.get(blockName);

        if (!block)
            debug.warn(`block:${blockName} is not existed.`);

        return block as IConstructor<Parent>;
    }

    static create(muya: Muya, state: TState[]) {
        const scrollPage = new ScrollPage(muya);

        scrollPage.append(
            ...state.map((block) => {
                return this.loadBlock(block.name).create(muya, block);
            }),
        );

        scrollPage.parent!.domNode!.appendChild(scrollPage.domNode!);
        muya.editor.inlineRenderer.flushPendingPresentation();

        return scrollPage;
    }

    override get path() {
        return [];
    }

    constructor(muya: Muya) {
        super(muya);
        // muya is not extends Parent, but it is the parent of scrollPage.
        // ScrollPage is the tree root; widening the base `TreeNode.parent`
        // declaration would ripple to every node, so spell out the boundary.
        // eslint-disable-next-line no-restricted-syntax
        this.parent = muya as unknown as Parent;
        this.tagName = 'div';
        this.classList = ['mu-container'];

        this.createDomNode();
        this._listenDomEvent();
    }

    override getState() {
        debug.warn('You can never call `getState` in scrollPage');

        return {} as TState;
    }

    private _listenDomEvent() {
        const { eventCenter } = this.muya;
        const { domNode } = this;

        eventCenter.attachDOMEvent(domNode!, 'click', this._clickHandler.bind(this));
    }

    updateState(state: TState[]) {
        const { muya } = this;
        // A resize owns references into the old tree and cannot survive a rebuild (#5394).
        muya.eventCenter.emit('muya-transformer', { reference: null });
        // Empty scrollPage dom
        this.empty();
        this.append(
            ...state.map((block) => {
                return ScrollPage.loadBlock(block.name).create(muya, block);
            }),
        );
        muya.editor.inlineRenderer.flushPendingPresentation();
    }

    /** Apply a supplied view state without rebuilding its unchanged root blocks. */
    reconcileState(state: readonly TState[]): boolean {
        const roots = [...this.children.iterator()].map((root) => {
            if (!root.isParent())
                throw new Error('Document view root must be a parent block');
            return root;
        });
        const before = roots.map(block => block.getState());
        let changed = false;
        if (roots.length === state.length) {
            for (let index = 0; index < state.length; index++)
                changed = this._reconcileRoot(roots[index], state[index], before[index]) || changed;
        }
        else {
            let start = 0;
            while (start < roots.length && start < state.length && isEqual(before[start], state[start]))
                start++;
            let retainedTail = 0;
            while (
                retainedTail < roots.length - start
                && retainedTail < state.length - start
                && isEqual(before[roots.length - retainedTail - 1], state[state.length - retainedTail - 1])
            ) {
                retainedTail++;
            }
            const boundary = roots[roots.length - retainedTail] ?? null;
            for (let index = start; index < roots.length - retainedTail; index++)
                roots[index].remove('api');
            for (let index = start; index < state.length - retainedTail; index++) {
                this.insertBefore(
                    ScrollPage.loadBlock(state[index].name).create(this.muya, state[index]),
                    boundary,
                    'api',
                );
            }
            changed = true;
        }
        this.muya.editor.inlineRenderer.flushPendingPresentation();
        return changed;
    }

    /**
     * Present `state` in place of `root`. A root whose only difference is its
     * single leaf's text keeps its blocks and DOM, so the shown nodes survive
     * and only their text changes.
     */
    private _reconcileRoot(root: Parent, state: TState, before: TState = root.getState()): boolean {
        if (isEqual(before, state))
            return false;
        const leaf = root.children.length === 1 ? root.children.head : null;
        const text = (state as { text?: unknown }).text;
        if (leaf?.isContent() && typeof text === 'string'
            && isEqual({ ...before, text: undefined }, { ...state, text: undefined })) {
            leaf.presentStateText(text);
            return true;
        }
        if (this._reconcileChildren(root, state, before))
            return true;
        root.replaceWith(ScrollPage.loadBlock(state.name).create(this.muya, state), 'api');
        return true;
    }

    /**
     * Present root `index` as `state` where only its children `items` changed,
     * reading no other child: a long list keeps every other item as it is.
     */
    private _reconcileItems(
        next: readonly TState[],
        index: number,
        previousEnd: number,
        items?: Readonly<{ start: number; previousEnd: number; nextEnd: number }>,
    ): boolean {
        const state = next[0];
        if (items === undefined || previousEnd !== index + 1 || next.length !== 1 || state === undefined)
            return false;
        const root = this.find(index) as Nullable<Parent>;
        const nextChildren = (state as { children?: unknown }).children;
        if (root == null || !root.isParent() || root.blockName !== state.name || !ScrollPage._itemContainers.has(state.name)
            || !Array.isArray(nextChildren)) {
            return false;
        }
        const blocks = [...root.children.iterator()];
        if (
            items.previousEnd > blocks.length || items.nextEnd > nextChildren.length
            || nextChildren.length - items.nextEnd !== blocks.length - items.previousEnd
        ) {
            return false;
        }
        const changed = blocks.slice(items.start, items.previousEnd) as Parent[];
        const replacing = nextChildren.slice(items.start, items.nextEnd) as TState[];
        if (changed.some(block => !block.isParent()))
            return false;
        if (changed.length === replacing.length) {
            changed.forEach((block, offset) => this._reconcileRoot(block, replacing[offset]));
        }
        else {
            const insertion = (blocks[items.previousEnd] ?? null) as Nullable<Parent>;
            for (const block of changed)
                block.remove('api');
            for (const child of replacing)
                root.insertBefore(ScrollPage.loadBlock(child.name).create(this.muya, child), insertion, 'api');
        }
        this.muya.editor.inlineRenderer.flushPendingPresentation();
        return true;
    }

    /**
     * Present `state` in place of `parent` by its children alone, when the
     * parent's own state is unchanged: a long list whose items changed keeps
     * every other item's blocks and DOM, as the editor keeps them while typing.
     */
    /** Containers whose children a view replaces one by one: lists and their items. */
    private static _itemContainers = new Set(['bullet-list', 'order-list', 'task-list', 'list-item', 'task-list-item']);

    private _reconcileChildren(parent: Parent, state: TState, before: TState): boolean {
        const nextChildren = (state as { children?: unknown }).children;
        const beforeChildren = (before as { children?: unknown }).children;
        if (!ScrollPage._itemContainers.has(state.name) || !Array.isArray(nextChildren) || !Array.isArray(beforeChildren)
            || !isEqual({ ...before, children: undefined }, { ...state, children: undefined })) {
            return false;
        }
        const blocks = [...parent.children.iterator()];
        if (blocks.length !== beforeChildren.length || blocks.some(block => !block.isParent()))
            return false;
        let head = 0;
        while (head < blocks.length && head < nextChildren.length && isEqual(beforeChildren[head], nextChildren[head]))
            head++;
        let tail = 0;
        while (
            tail < blocks.length - head
            && tail < nextChildren.length - head
            && isEqual(beforeChildren[blocks.length - tail - 1], nextChildren[nextChildren.length - tail - 1])
        ) {
            tail++;
        }
        const changed = blocks.slice(head, blocks.length - tail) as Parent[];
        const next = nextChildren.slice(head, nextChildren.length - tail) as TState[];
        if (changed.length === next.length) {
            changed.forEach((block, index) =>
                this._reconcileRoot(block, next[index], beforeChildren[head + index] as TState));
            return true;
        }
        const insertion = (blocks[blocks.length - tail] ?? null) as Nullable<Parent>;
        for (const block of changed)
            block.remove('api');
        for (const child of next)
            parent.insertBefore(ScrollPage.loadBlock(child.name).create(this.muya, child), insertion, 'api');
        return true;
    }

    /**
     * Present `next` in place of the roots `[start, previousEnd)`. The caller
     * vouches that every other root already presents its state, so only this
     * range is read.
     */
    reconcileStateRegion(
        next: readonly TState[],
        start: number,
        previousEnd: number,
        items?: Readonly<{ start: number; previousEnd: number; nextEnd: number }>,
    ): boolean {
        if (this._reconcileItems(next, start, previousEnd, items))
            return true;
        const roots: Parent[] = [];
        let root = this.find(start) as Nullable<Parent>;
        for (let index = start; index < previousEnd; index++) {
            if (root == null || !root.isParent())
                throw new Error('Document view root must be a parent block');
            roots.push(root);
            root = root.next as Nullable<Parent>;
        }
        const boundary = root ?? null;
        let changed = false;
        if (roots.length === next.length) {
            for (let index = 0; index < next.length; index++)
                changed = this._reconcileRoot(roots[index], next[index]) || changed;
        }
        else {
            const before = roots.map(block => block.getState());
            let head = 0;
            while (head < roots.length && head < next.length && isEqual(before[head], next[head]))
                head++;
            let tail = 0;
            while (
                tail < roots.length - head
                && tail < next.length - head
                && isEqual(before[roots.length - tail - 1], next[next.length - tail - 1])
            ) {
                tail++;
            }
            const insertion = roots[roots.length - tail] ?? boundary;
            for (let index = head; index < roots.length - tail; index++)
                roots[index].remove('api');
            for (let index = head; index < next.length - tail; index++) {
                this.insertBefore(
                    ScrollPage.loadBlock(next[index].name).create(this.muya, next[index]),
                    insertion,
                    'api',
                );
            }
            changed = true;
        }
        this.muya.editor.inlineRenderer.flushPendingPresentation();
        return changed;
    }

    /**
     * Find the content block by the path
     * @param {Array} path
     */
    queryBlock(path: TBlockPath) {
        if (path.length === 0)
            return this;

        const [p, ...remaining] = path;
        const block = this.find(p as number) as Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined };
        return block && remaining.length ? block.queryBlock(remaining) : block;
    }

    updateRefLinkAndImage(label: string) {
        // Labels match case-insensitively with whitespace runs collapsed
        // (CommonMark), and may contain regex metacharacters such as `c++`.
        const pattern = label
            .trim()
            .split(/\s+/)
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+');
        const REG = new RegExp(`\\[\\s*${pattern}\\s*\\](?!:)`, 'i');

        this.breadthFirstTraverse((node) => {
            if (node.isContent() && REG.test(node.text))
                node.update();
        });
    }

    handleBlurFromContent(block: Content) {
        this._blurFocus.blur = block;
        requestAnimationFrame(this._updateActiveStatus);
    }

    handleFocusFromContent(block: Content) {
        this._blurFocus.focus = block;
        requestAnimationFrame(this._updateActiveStatus);
    }

    private _updateActiveStatus = () => {
        const { blur, focus } = this._blurFocus;

        if (blur == null && focus == null)
            return;

        let needBlurBlocks: Parent[] = [];
        let needFocusBlocks: Parent[] = [];
        let block;

        if (blur && focus) {
            needFocusBlocks = focus.getAncestors();
            block = blur.parent;
            while (block && block.isParent && block.isParent() && !needFocusBlocks.includes(block)) {
                needBlurBlocks.push(block);
                block = block.parent;
            }
        }
        else if (blur) {
            needBlurBlocks = blur.getAncestors();
        }
        else if (focus) {
            needFocusBlocks = focus.getAncestors();
        }

        if (needBlurBlocks.length) {
            needBlurBlocks.forEach((b) => {
                b.active = false;
            });
        }

        if (needFocusBlocks.length) {
            needFocusBlocks.forEach((b) => {
                b.active = true;
            });
        }

        this._blurFocus = {
            blur: null,
            focus: null,
        };
    };

    // Create a new paragraph if click the blank area in editor.
    private _clickHandler(event: Event) {
        if (!isMouseEvent(event) || !isHTMLElement(event.target))
            return;

        const target = event.target;

        if (target[BLOCK_DOM_PROPERTY] === this) {
            const lastChild = this.lastChild as Parent;
            const lastContentBlock = lastChild.lastContentInDescendant()!;
            const { clientY } = event;
            const lastChildDom = lastChild.domNode;
            const { bottom } = lastChildDom!.getBoundingClientRect();

            if (clientY > bottom) {
                if (
                    lastChild.blockName === 'paragraph'
                    && lastContentBlock.text === ''
                ) {
                    lastContentBlock.setCursor(0, 0);
                }
                else {
                    if (this.muya.editor.documentEditing) {
                        const at = this.muya.editor.selection.getDOMPoint({ path: lastContentBlock.path, offset: lastContentBlock.text.length });
                        if (!at)
                            throw new Error('Page tail has no model position');
                        const selection = this.muya.editor.selection.getDOMSelection() ?? { anchor: at, focus: at };
                        dispatchDocumentBlock(this.muya, { type: 'new', at, scope: 'outer', placement: 'after', selectionMode: 'start' }, selection);
                        return;
                    }
                    const state = {
                        name: 'paragraph',
                        text: '',
                    };
                    const newNode = ScrollPage.loadBlock(state.name).create(
                        this.muya,
                        state,
                    );
                    this.append(newNode, 'user');
                    const cursorBlock = newNode.lastContentInDescendant();
                    cursorBlock.setCursor(0, 0, true);
                }
            }
        }
    }
}
