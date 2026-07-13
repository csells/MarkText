import type { Muya } from '../../muya';
import type { ICriticMarkupStructuralFragmentInput } from '../../criticMarkup/document';
import type {
    ICriticMarkupStateMarker,
    IStateSourceTrivia,
    IStateSourceTriviaCarrier,
    ITableSourceSyntax,
} from '../../state/types';
import type { Nullable } from '../../types';
import type { IAttributes, IDatasets } from '../../utils/types';
import type { IConstructor } from '../types';
import type Content from './content';
import type { ILinkedNode } from './linkedList/linkedNode';
import type Parent from './parent';
import { BLOCK_DOM_PROPERTY, CLASS_NAMES } from '../../config';
import { criticMarkupMarkerRaw } from '../../criticMarkup/parser';
import { createDomNode } from '../../utils/dom';

type TBlockMetaValue = boolean | number | string | null | undefined;

function isBlockMetaValue(value: unknown): value is TBlockMetaValue {
    return value == null
        || ['boolean', 'number', 'string', 'undefined'].includes(typeof value);
}

const CRITIC_MARKUP_TYPES = new Set([
    'addition',
    'deletion',
    'substitution',
    'highlight',
    'comment',
]);
const CRITIC_MARKUP_MARKERS = new Set([
    'open',
    'separator',
    'close',
]);
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

function assertPlainDataObject(
    value: unknown,
    label: string,
): asserts value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError(`${label} must be a plain data object.`);

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError(`${label} must be a plain data object.`);
}

function dataProperties(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    label: string,
): Map<string, unknown> {
    const result = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !allowed.has(key))
            throw new TypeError(`${label} contains an unsupported property.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw new TypeError(
                `${label} property "${key}" must be an enumerable data property.`,
            );
        }
        result.set(key, descriptor.value);
    }
    return result;
}

function freezeCriticMarkupMarker(
    value: unknown,
    label: string,
): Readonly<ICriticMarkupStateMarker> {
    assertPlainDataObject(value, label);
    const properties = dataProperties(
        value,
        new Set(['type', 'marker', 'raw', 'sourceOffset']),
        label,
    );
    const type = properties.get('type');
    const marker = properties.get('marker');
    const raw = properties.get('raw');
    const sourceOffset = properties.get('sourceOffset');
    if (
        typeof type !== 'string'
        || !CRITIC_MARKUP_TYPES.has(type)
        || typeof marker !== 'string'
        || !CRITIC_MARKUP_MARKERS.has(marker)
        || typeof raw !== 'string'
        || raw.length === 0
        || (
            sourceOffset !== undefined
            && (
                typeof sourceOffset !== 'number'
                || !Number.isSafeInteger(sourceOffset)
                || sourceOffset < 0
            )
        )
    ) {
        throw new TypeError(`${label} is not a valid CriticMarkup marker.`);
    }
    const canonicalRaw = criticMarkupMarkerRaw(
        type as ICriticMarkupStateMarker['type'],
        marker as ICriticMarkupStateMarker['marker'],
    );
    if (raw !== canonicalRaw) {
        throw new TypeError(
            `${label} does not use the grammar-owned marker spelling.`,
        );
    }

    return Object.freeze({
        type: type as ICriticMarkupStateMarker['type'],
        marker: marker as ICriticMarkupStateMarker['marker'],
        raw,
        ...(typeof sourceOffset === 'number' ? { sourceOffset } : {}),
    });
}

function freezeCriticMarkupMarkers(
    value: unknown,
    label: string,
): readonly Readonly<ICriticMarkupStateMarker>[] {
    if (!Array.isArray(value))
        throw new TypeError(`${label} must be an array.`);

    const markers: Readonly<ICriticMarkupStateMarker>[] = [];
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !('value' in descriptor)) {
            throw new TypeError(`${label} must be a dense data array.`);
        }
        markers.push(freezeCriticMarkupMarker(
            descriptor.value,
            `${label}[${index}]`,
        ));
    }
    return Object.freeze(markers);
}

function freezeListItemContinuationPrefixes(
    value: unknown,
): readonly string[] {
    if (!Array.isArray(value)) {
        throw new TypeError(
            'State source trivia listItemContinuationPrefixes must be an array.',
        );
    }
    const prefixes: string[] = [];
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (
            !descriptor
            || !('value' in descriptor)
            || typeof descriptor.value !== 'string'
            || !/^[ \t]*$/.test(descriptor.value)
        ) {
            throw new TypeError(
                'State source trivia listItemContinuationPrefixes must contain dense whitespace strings.',
            );
        }
        prefixes.push(descriptor.value);
    }
    return Object.freeze(prefixes);
}

function freezeDenseStrings(value: unknown, label: string): readonly string[] {
    if (!Array.isArray(value))
        throw new TypeError(`${label} must be an array.`);
    const strings: string[] = [];
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (
            !descriptor
            || !('value' in descriptor)
            || typeof descriptor.value !== 'string'
        ) {
            throw new TypeError(`${label} must contain dense strings.`);
        }
        strings.push(descriptor.value);
    }
    return Object.freeze(strings);
}

function freezeTableRowSourceSyntax(
    value: unknown,
    label: string,
): ITableSourceSyntax['header'] {
    assertPlainDataObject(value, label);
    const properties = dataProperties(
        value,
        new Set(['cells', 'segments']),
        label,
    );
    const cells = freezeDenseStrings(
        properties.get('cells'),
        `${label} cells`,
    );
    const segments = freezeDenseStrings(
        properties.get('segments'),
        `${label} segments`,
    );
    if (segments.length !== cells.length + 1) {
        throw new TypeError(
            `${label} must have exactly one more segment than cells.`,
        );
    }
    return Object.freeze({ cells, segments });
}

function freezeTableSourceSyntax(value: unknown): ITableSourceSyntax {
    const label = 'State source trivia tableSourceSyntax';
    assertPlainDataObject(value, label);
    const properties = dataProperties(
        value,
        new Set(['header', 'delimiter', 'rows', 'alignments']),
        label,
    );
    const header = freezeTableRowSourceSyntax(
        properties.get('header'),
        `${label} header`,
    );
    const delimiter = freezeTableRowSourceSyntax(
        properties.get('delimiter'),
        `${label} delimiter`,
    );
    const rowValues = properties.get('rows');
    if (!Array.isArray(rowValues))
        throw new TypeError(`${label} rows must be an array.`);
    const rows: ITableSourceSyntax['rows'][number][] = [];
    for (let index = 0; index < rowValues.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(rowValues, index);
        if (!descriptor || !('value' in descriptor)) {
            throw new TypeError(`${label} rows must be a dense array.`);
        }
        rows.push(freezeTableRowSourceSyntax(
            descriptor.value,
            `${label} rows[${index}]`,
        ));
    }
    const alignments = freezeDenseStrings(
        properties.get('alignments'),
        `${label} alignments`,
    );
    if (alignments.some(align =>
        !['none', 'left', 'center', 'right'].includes(align))) {
        throw new TypeError(`${label} contains an invalid alignment.`);
    }
    if (
        header.cells.length !== delimiter.cells.length
        || header.cells.length !== alignments.length
        || rows.some(row => row.cells.length !== header.cells.length)
    ) {
        throw new TypeError(`${label} row column counts must agree.`);
    }
    return Object.freeze({
        header,
        delimiter,
        rows: Object.freeze(rows),
        alignments: alignments as ITableSourceSyntax['alignments'],
    });
}

function freezeSourceTrivia(
    value: unknown,
): Readonly<IStateSourceTrivia> {
    assertPlainDataObject(value, 'State source trivia');
    const properties = dataProperties(
        value,
        new Set([
            'criticBefore',
            'criticAfter',
            'criticAfterPrefix',
            'blockPrefix',
            'blockSeparatorAfter',
            'terminalLineEnding',
            'tableSourceSyntax',
            'listItemLeadingPrefix',
            'listItemMarker',
            'listItemMarkerPadding',
            'listItemTrailingBlankLines',
            'listItemContinuationPrefixes',
        ]),
        'State source trivia',
    );
    const criticBefore = properties.has('criticBefore')
        ? freezeCriticMarkupMarkers(
                properties.get('criticBefore'),
                'State source trivia criticBefore',
            )
        : undefined;
    const criticAfter = properties.has('criticAfter')
        ? freezeCriticMarkupMarkers(
                properties.get('criticAfter'),
                'State source trivia criticAfter',
            )
        : undefined;
    const criticAfterPrefix = properties.get('criticAfterPrefix');
    if (
        criticAfterPrefix !== undefined
        && (
            typeof criticAfterPrefix !== 'string'
            || !/^[ \t\r\n]*$/.test(criticAfterPrefix)
        )
    ) {
        throw new TypeError(
            'State source trivia criticAfterPrefix must be whitespace.',
        );
    }
    const blockPrefix = properties.get('blockPrefix');
    if (
        blockPrefix !== undefined
        && (
            typeof blockPrefix !== 'string'
            || !/^[ \t\r\n]*$/.test(blockPrefix)
        )
    ) {
        throw new TypeError(
            'State source trivia blockPrefix must be whitespace.',
        );
    }
    const blockSeparatorAfter = properties.get('blockSeparatorAfter');
    if (
        blockSeparatorAfter !== undefined
        && (
            typeof blockSeparatorAfter !== 'string'
            || !/^[ \t\r\n]*$/.test(blockSeparatorAfter)
        )
    ) {
        throw new TypeError(
            'State source trivia blockSeparatorAfter must be whitespace.',
        );
    }
    const terminalLineEnding = properties.get('terminalLineEnding');
    if (
        terminalLineEnding !== undefined
        && terminalLineEnding !== ''
        && terminalLineEnding !== '\n'
        && terminalLineEnding !== '\r\n'
    ) {
        throw new TypeError(
            'State source trivia terminalLineEnding must be empty, LF, or CRLF.',
        );
    }
    const tableSourceSyntax = properties.has('tableSourceSyntax')
        ? freezeTableSourceSyntax(properties.get('tableSourceSyntax'))
        : undefined;
    const listItemLeadingPrefix = properties.get('listItemLeadingPrefix');
    if (
        listItemLeadingPrefix !== undefined
        && (
            typeof listItemLeadingPrefix !== 'string'
            || !/^[ \t]*$/.test(listItemLeadingPrefix)
        )
    ) {
        throw new TypeError(
            'State source trivia listItemLeadingPrefix must be whitespace.',
        );
    }
    const listItemMarker = properties.get('listItemMarker');
    if (
        listItemMarker !== undefined
        && (
            typeof listItemMarker !== 'string'
            || !/^(?:[*+-]|\d{1,9}[.)])$/.test(listItemMarker)
        )
    ) {
        throw new TypeError(
            'State source trivia listItemMarker is not a CommonMark list marker.',
        );
    }
    const listItemMarkerPadding = properties.get('listItemMarkerPadding');
    if (
        listItemMarkerPadding !== undefined
        && (
            typeof listItemMarkerPadding !== 'string'
            || !/^[ \t]*$/.test(listItemMarkerPadding)
        )
    ) {
        throw new TypeError(
            'State source trivia listItemMarkerPadding must be whitespace.',
        );
    }
    const listItemTrailingBlankLines = properties.get(
        'listItemTrailingBlankLines',
    );
    if (
        listItemTrailingBlankLines !== undefined
        && (
            typeof listItemTrailingBlankLines !== 'number'
            ||
            !Number.isSafeInteger(listItemTrailingBlankLines)
            || listItemTrailingBlankLines < 0
        )
    ) {
        throw new TypeError(
            'State source trivia listItemTrailingBlankLines must be a nonnegative safe integer.',
        );
    }
    const listItemContinuationPrefixes = properties.has(
        'listItemContinuationPrefixes',
    )
        ? freezeListItemContinuationPrefixes(
                properties.get('listItemContinuationPrefixes'),
            )
        : undefined;

    return Object.freeze({
        ...(criticBefore ? { criticBefore } : {}),
        ...(criticAfter ? { criticAfter } : {}),
        ...(typeof criticAfterPrefix === 'string'
            ? { criticAfterPrefix }
            : {}),
        ...(typeof blockPrefix === 'string' ? { blockPrefix } : {}),
        ...(typeof blockSeparatorAfter === 'string'
            ? { blockSeparatorAfter }
            : {}),
        ...(typeof terminalLineEnding === 'string'
            ? { terminalLineEnding: terminalLineEnding as '' | '\n' | '\r\n' }
            : {}),
        ...(tableSourceSyntax ? { tableSourceSyntax } : {}),
        ...(typeof listItemLeadingPrefix === 'string'
            ? { listItemLeadingPrefix }
            : {}),
        ...(typeof listItemMarker === 'string' ? { listItemMarker } : {}),
        ...(typeof listItemMarkerPadding === 'string'
            ? { listItemMarkerPadding }
            : {}),
        ...(typeof listItemTrailingBlankLines === 'number'
            ? { listItemTrailingBlankLines }
            : {}),
        ...(listItemContinuationPrefixes
            ? { listItemContinuationPrefixes }
            : {}),
    });
}

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
            ...Object.values(STRUCTURAL_TYPE_CLASSES),
        );
        for (const attribute of [
            'data-critic-id',
            'data-critic-structural-id',
            'data-critic-structural-count',
            'data-critic-type',
            'data-critic-role',
            'data-critic-boundary',
            'data-start',
            'data-end',
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
