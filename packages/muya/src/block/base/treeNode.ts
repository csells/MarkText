import type { ICriticMarkupStructuralFragmentInput } from '../../criticMarkup/document';
import type { Muya } from '../../muya';
import type {
    IStateSourceTrivia,
    IStateSourceTriviaCarrier,
} from '../../state/types';
import type { Nullable } from '../../types';
import type { IAttributes, IDatasets } from '../../utils/types';
import type { IConstructor } from '../types';
import type Content from './content';
import type { ILinkedNode } from './linkedList/linkedNode';
import type Parent from './parent';
import { BLOCK_DOM_PROPERTY, CLASS_NAMES } from '../../config';
import { createDomNode } from '../../utils/dom';
import { freezeSourceTrivia } from './sourceTriviaValidation';

type TBlockMetaValue = boolean | number | string | null | undefined;

function isBlockMetaValue(value: unknown): value is TBlockMetaValue {
    return value == null
        || ['boolean', 'number', 'string', 'undefined'].includes(typeof value);
}

const STRUCTURAL_TYPE_CLASSES = {
    addition: CLASS_NAMES.MU_CRITIC_ADDITION,
    deletion: CLASS_NAMES.MU_CRITIC_DELETION,
    substitution: CLASS_NAMES.MU_CRITIC_SUBSTITUTION,
    highlight: CLASS_NAMES.MU_CRITIC_HIGHLIGHT,
    comment: CLASS_NAMES.MU_CRITIC_COMMENT,
} as const;
const EMPTY_STRUCTURAL_FRAGMENTS = Object.freeze(
    [] as ICriticMarkupStructuralFragmentInput[],
);

class TreeNode implements ILinkedNode {
    #prev: Nullable<TreeNode> = null;
    #next: Nullable<TreeNode> = null;
    #parent: Nullable<Parent> = null;
    #blockMeta: Readonly<object> | null = null;
    #sourceTrivia: Readonly<IStateSourceTrivia> | null = null;
    #sourceTriviaInitialized = false;
    #criticMarkupStructuralFragments:
    readonly ICriticMarkupStructuralFragmentInput[]
        = EMPTY_STRUCTURAL_FRAGMENTS;

    get prev(): Nullable<TreeNode> {
        return this.#prev;
    }

    set prev(value: Nullable<TreeNode>) {
        this.#assertTopologyAssignment(value, 'Previous sibling assignment');
        this.#prev = value;
    }

    get next(): Nullable<TreeNode> {
        return this.#next;
    }

    set next(value: Nullable<TreeNode>) {
        this.#assertTopologyAssignment(value, 'Next sibling assignment');
        this.#next = value;
    }

    get parent(): Nullable<Parent> {
        return this.#parent;
    }

    set parent(value: Nullable<Parent>) {
        this.#assertTopologyAssignment(value, 'Parent assignment');
        this.#parent = value;
    }

    domNode: Nullable<HTMLElement> = null;

    tagName: string = '';

    classList: string[] = [];

    attributes: IAttributes = {};

    datasets: IDatasets = {};

    static blockName = 'tree.node';

    protected get static(): IConstructor<TreeNode> {
        // `this.constructor` is `Function` in lib.d.ts; subclasses' generated
        // constructors carry the static `blockName` etc., but TS can't see
        // through `Function` to the subclass shape.
        // eslint-disable-next-line no-restricted-syntax
        return this.constructor as unknown as IConstructor<TreeNode>;
    }

    get blockName() {
        return this.static.blockName;
    }

    get jsonState() {
        return this.muya.editor.jsonState;
    }

    get scrollPage() {
        return this.muya.editor.scrollPage;
    }

    protected assertMutationAuthorized(operation: string): void {
        this.muya.editor.mutationGateway.assertActive(operation);
    }

    protected assertTreeMutationAuthorized(operation: string): void {
        this.muya.editor.assertTreeMutationAuthorized(operation);
    }

    /** Bind parser-owned source trivia during centralized state construction. */
    initializeStateSourceTrivia(
        sourceTrivia: unknown,
    ): void {
        if (this.#sourceTriviaInitialized) {
            throw new TypeError(
                'Block source trivia is already initialized.',
            );
        }
        this.#sourceTriviaInitialized = true;
        this.#sourceTrivia = sourceTrivia
            ? freezeSourceTrivia(sourceTrivia)
            : null;
    }

    /** Read the block's frozen source trivia for subclass-owned rewrites. */
    protected get sourceTriviaForRewrite(): Readonly<Record<string, unknown>> | null {
        return this.#sourceTrivia as Readonly<Record<string, unknown>> | null;
    }

    /** Install rewritten trivia; only trivia-owning subclasses may call this. */
    protected setRewrittenSourceTrivia(
        value: Readonly<Record<string, unknown>> | null,
    ): void {
        this.#sourceTrivia = value;
    }

    /** Reattach the block's immutable source trivia to its native state. */
    protected withStateSourceTrivia<State extends object>(
        state: State,
    ): State & IStateSourceTriviaCarrier {
        return {
            ...state,
            ...(this.#sourceTrivia
                ? { sourceTrivia: this.#sourceTrivia }
                : {}),
        };
    }

    /** Initialize a block's serialized metadata as an isolated frozen value. */
    protected initializeBlockMeta<
        Meta extends Partial<Record<keyof Meta, TBlockMetaValue>>,
    >(
        meta: Meta,
    ): void {
        if (this.#blockMeta !== null)
            throw new TypeError('Block metadata is already initialized.');
        this.#setBlockMeta(meta);
    }

    /** Read the runtime-private immutable metadata owned by this block. */
    protected readBlockMeta<
        Meta extends Partial<Record<keyof Meta, TBlockMetaValue>>,
    >(): Readonly<Meta> {
        if (this.#blockMeta === null)
            throw new TypeError('Block metadata is not initialized.');
        // initializeBlockMeta and both replacement paths clone a value of the
        // subclass-selected metadata type before it enters private storage.
        return this.#blockMeta as Readonly<Meta>;
    }

    /** Replace live metadata as part of a mutation-gateway document edit. */
    protected replaceBlockMetaForDocumentEdit<
        Meta extends Partial<Record<keyof Meta, TBlockMetaValue>>,
    >(
        meta: Meta,
        operation: string,
    ): void {
        if (this.isAttachedToLiveTree)
            this.assertMutationAuthorized(operation);
        this.#replaceBlockMeta(meta);
    }

    /** Mirror metadata after JSONState committed it in a private rebuild. */
    protected replaceBlockMetaFromPreparedState<
        Meta extends Partial<Record<keyof Meta, TBlockMetaValue>>,
    >(
        meta: Meta,
        operation: string,
    ): void {
        if (this.isAttachedToLiveTree)
            this.assertTreeMutationAuthorized(operation);
        this.#replaceBlockMeta(meta);
    }

    #replaceBlockMeta<
        Meta extends Partial<Record<keyof Meta, TBlockMetaValue>>,
    >(
        meta: Meta,
    ): void {
        if (this.#blockMeta === null)
            throw new TypeError('Block metadata is not initialized.');
        this.#setBlockMeta(meta);
    }

    #setBlockMeta<
        Meta extends Partial<Record<keyof Meta, TBlockMetaValue>>,
    >(
        meta: Meta,
    ): void {
        const entries: Array<[string, TBlockMetaValue]> = [];
        for (const key of Reflect.ownKeys(meta)) {
            const descriptor = Object.getOwnPropertyDescriptor(meta, key);
            if (!descriptor?.enumerable)
                continue;
            if (typeof key !== 'string') {
                throw new TypeError(
                    'Block metadata keys must be strings.',
                );
            }
            if (!('value' in descriptor)) {
                throw new TypeError(
                    `Block metadata property "${key}" must be a data property.`,
                );
            }
            const { value } = descriptor;
            if (!isBlockMetaValue(value)) {
                throw new TypeError(
                    `Block metadata property "${key}" must be scalar.`,
                );
            }
            if (typeof value === 'number' && !Number.isFinite(value)) {
                throw new TypeError(
                    `Block metadata property "${key}" must be finite.`,
                );
            }
            entries.push([key, value]);
        }
        this.#blockMeta = Object.freeze(Object.fromEntries(entries));
    }

    /** Whether this node currently belongs to the editor's published tree. */
    get isAttachedToLiveTree(): boolean {
        const liveRoot = this.muya.editor.scrollPage;
        if (!liveRoot)
            return false;
        if (this === (liveRoot as TreeNode))
            return true;

        return this.outMostBlock?.parent === liveRoot;
    }

    #assertTopologyAssignment(
        related: Nullable<TreeNode>,
        operation: string,
    ): void {
        if (
            this.isAttachedToLiveTree
            || related?.isAttachedToLiveTree
        ) {
            this.assertTreeMutationAuthorized(operation);
        }
    }

    get isScrollPage() {
        return this.blockName === 'scrollpage';
    }

    get isOutMostBlock(): boolean {
        return this.parent ? this.parent.isScrollPage : false;
    }

    get outMostBlock(): Nullable<Parent> {
        // `this.isContent()` returns false only when `this` is a Parent
        // subclass — but the base-class type signature is `TreeNode`. The
        // `this as Parent` widening can't be expressed without a cast.
        // eslint-disable-next-line no-restricted-syntax
        let node = this.isContent() ? this.parent : this as unknown as Parent;

        while (node) {
            if (node.isOutMostBlock)
                return node;

            node = node.parent;
        }

        return null;
    }

    constructor(public muya: Muya) {}

    get criticMarkupStructuralFragments():
    readonly ICriticMarkupStructuralFragmentInput[] {
        return this.#criticMarkupStructuralFragments;
    }

    /** Bind one canonical document revision to this native semantic block. */
    replaceCriticMarkupStructuralFragments(
        fragments: readonly ICriticMarkupStructuralFragmentInput[],
    ): void {
        this.#criticMarkupStructuralFragments = fragments.length
            ? Object.freeze([...fragments])
            : EMPTY_STRUCTURAL_FRAGMENTS;
        this.#syncCriticMarkupStructuralDom();
    }

    #syncCriticMarkupStructuralDom(): void {
        const { domNode } = this;
        if (!domNode)
            return;
        domNode.classList.remove(
            'mu-critic-structural',
            'mu-critic-structural-multiple',
        );
        for (const typeClass of Object.values(STRUCTURAL_TYPE_CLASSES))
            domNode.classList.remove(typeClass);
        for (const attribute of [
            'data-critic-id',
            'data-critic-structural-id',
            'data-critic-structural-count',
            'data-critic-type',
            'data-critic-role',
            'data-critic-boundary',
            'data-start',
            'data-end',
            'hidden',
        ]) {
            domNode.removeAttribute(attribute);
        }

        const fragments = this.#criticMarkupStructuralFragments;
        if (!fragments.length)
            return;
        const items = [...new Map(fragments.map(entry => [
            entry.item.id,
            entry.item,
        ])).values()];
        const roles = [...new Set(fragments.map(({ item, fragment }) =>
            fragment.kind === 'boundary'
                ? 'boundary'
                : item.syntax.type === 'substitution'
                    ? fragment.arm
                    : fragment.role))];
        const types = [...new Set(items.map(item => item.syntax.type))];

        domNode.classList.add('mu-critic-structural');
        domNode.setAttribute(
            'data-critic-id',
            items.map(item => item.id).join(' '),
        );
        domNode.setAttribute(
            'data-critic-structural-count',
            String(items.length),
        );
        domNode.setAttribute('data-critic-type', types.join(' '));
        domNode.setAttribute('data-critic-role', roles.join(' '));

        // Inline comment fragments collapse their markers and body while
        // retaining a visible indicator. A parser-owned structural comment
        // content fragment has no inline wrapper to perform that collapse, so
        // hide its native carrier semantically. Boundary-only fragments do not
        // own the carrier's content (an empty comment can be anchored immediately
        // before an otherwise visible list item), and must never hide it. The
        // fragment arm is the parser-owned authority here: nested items propagated
        // through a comment can have a non-comment item type while still occupying
        // the hidden comment arm.
        if (fragments.some(({ fragment }) =>
            fragment.kind === 'content'
            && fragment.arm === 'comment')) {
            domNode.setAttribute('hidden', '');
        }

        if (items.length > 1) {
            domNode.classList.add('mu-critic-structural-multiple');
            return;
        }

        const [item] = items;
        domNode.classList.add(STRUCTURAL_TYPE_CLASSES[item.syntax.type]);
        domNode.setAttribute('data-critic-structural-id', item.id);
        domNode.setAttribute('data-start', String(item.syntax.range.start));
        domNode.setAttribute('data-end', String(item.syntax.range.end));
        const boundaryEdges = [...new Set(fragments.flatMap(({ fragment }) =>
            fragment.kind === 'boundary' ? [fragment.edge] : []))];
        if (boundaryEdges.length === 1) {
            domNode.setAttribute('data-critic-boundary', boundaryEdges[0]);
        }
    }

    /**
     * check this is a Content block?
     * @param this
     * @returns boolean
     */
    isContent(this: TreeNode): this is Content {
        return 'text' in this;
    }

    /**
     * check this is a Parent block?
     * @param this
     * @returns boolean
     */
    isParent(this: TreeNode): this is Parent {
        return 'children' in this;
    }

    /**
     * create domNode
     */
    createDomNode() {
        const { tagName, classList, attributes, datasets } = this;

        const domNode = createDomNode(tagName, {
            classList,
            attributes,
            datasets,
        });

        // Concrete subclasses are always Parent | Content, but the static
        // signature here is TreeNode (Format extends Content via a separate
        // file). Mark the DOM property with the runtime subtype.
        // eslint-disable-next-line no-restricted-syntax
        domNode[BLOCK_DOM_PROPERTY] = this as unknown as Parent | Content;

        this.domNode = domNode;
        this.#syncCriticMarkupStructuralDom();
    }

    // Get previous content block in block tree.
    previousContentInContext(): Nullable<Content> {
        if (this.isScrollPage || !this.parent)
            return null;

        const { parent } = this;

        // Walk previous siblings, skipping empty containers (e.g. a list item
        // whose only paragraph was removed) that hold no content descendant.
        // Otherwise such a sibling yields null and the caret gets stuck when
        // navigating up/left across it (#4644).
        let sibling = parent.prev;
        while (sibling) {
            if (sibling.isParent()) {
                const content = sibling.lastContentInDescendant();
                if (content)
                    return content;
            }
            else {
                return sibling; // language input
            }
            sibling = sibling.prev;
        }

        return parent.previousContentInContext();
    }

    // Get next content block in block tree.
    nextContentInContext(): Nullable<Content> {
        if (this.isScrollPage || !this.parent)
            return null;

        const { parent } = this;

        if (this.blockName === 'language-input')
            return parent.lastContentInDescendant();

        // Walk next siblings, skipping empty containers with no content
        // descendant so the caret can cross them instead of getting stuck (#4644).
        let sibling = parent.next;
        while (sibling) {
            if (sibling.isParent()) {
                const content = sibling.firstContentInDescendant();
                if (content)
                    return content;
            }
            else {
                return sibling; // language input
            }
            sibling = sibling.next;
        }

        return parent.nextContentInContext();
    }

    /**
     * Weather `this` is the only child of its parent.
     */
    isOnlyChild() {
        return this.isFirstChild() && this.isLastChild();
    }

    /**
     * Weather `this` is the first child of its parent.
     */
    isFirstChild() {
        return this.prev === null;
    }

    /**
     * Weather `this` is the last child of its parent.
     */
    isLastChild() {
        return this.next === null;
    }

    /**
     * Weather `this` is descendant of `block`
     * @param {*} block
     */
    isInBlock(block: Parent) {
        let parent = this.parent;
        while (parent) {
            if (parent === block)
                return true;

            parent = parent.parent;
        }

        return false;
    }

    /**
     * Find the closest block which blockName is `blockName`. return `null` if not found.
     * @param {string} blockName
     */
    closestBlock(blockName: string): Nullable<TreeNode> {
        if (this.blockName === blockName)
            return this;

        let parent = this.parent;

        while (parent) {
            if (parent.blockName === blockName)
                return parent;

            parent = parent.parent;
        }

        return null;
    }

    farthestBlock(blockName: string): Nullable<TreeNode> {
        const results: TreeNode[] = [];
        if (this.blockName === blockName)
            results.push(this);

        let parent = this.parent;

        while (parent) {
            if (parent.blockName === blockName)
                results.push(parent);

            parent = parent.parent;
        }
        const popItem = results.pop();

        return popItem || null;
    }

    insertInto(parent: Parent, refBlock: Nullable<Parent> = null) {
        if (this.parent === parent && this.next === refBlock)
            return;

        if (this.parent)
            this.parent.removeChild(this);

        // `parent.insertBefore` takes a Parent (the tree's internal linked
        // list operates on Parent), but TreeNode.insertInto is also called
        // from Content subclasses which extend TreeNode, not Parent.
        // eslint-disable-next-line no-restricted-syntax
        parent.insertBefore(this as unknown as Parent, refBlock);
    }

    /**
     * Remove the current block in the block tree.
     */
    remove(_source = 'user') {
        if (!this.parent)
            return;

        if (this.isAttachedToLiveTree)
            this.assertTreeMutationAuthorized('Block removal');

        this.parent.detachLinkedChild(this);
        this.parent = null;
        this.domNode?.remove();

        return this;
    }
}

export default TreeNode;
