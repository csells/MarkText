import type { CriticMarkupDocument } from '../../criticMarkup/document';
import type { Muya } from '../../muya';
import type { TState } from '../../state/types';
import type { Nullable } from '../../types';
import type Content from '../base/content';
import type TreeNode from '../base/treeNode';
import type { IConstructor, TBlockPath } from '../types';
import { BLOCK_DOM_PROPERTY } from '../../config';
import {
    collectReferenceDefinitions,
} from '../../inlineRenderer/referenceDefinitions';
import {
    bindCriticMarkupStructuralVisibility,
} from '../../criticMarkup/renderedBlockState';
import { isHTMLElement, isMouseEvent } from '../../utils';
import logger from '../../utils/logger';
import {
    appendCreatedChildren,
    createChildren,
} from '../appendCreatedChildren';
import Parent from '../base/parent';

const debug = logger('scrollpage:');

/**
 * Key-order-independent serialization, so a live block's `getState()` and a
 * freshly parsed state compare equal whenever they describe the same block.
 * Mirrors `JSON.stringify` value semantics (undefined object entries are
 * skipped, undefined array elements serialize as null).
 */
function stableStateKey(value: unknown): string {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(item => stableStateKey(item)).join(',')}]`;
    const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .filter(key => (value as Record<string, unknown>)[key] !== undefined)
        .map(key =>
            `${JSON.stringify(key)}:${
                stableStateKey((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
}

function labelsEqual(
    left: ReturnType<typeof collectReferenceDefinitions>,
    right: ReturnType<typeof collectReferenceDefinitions>,
): boolean {
    if (left.size !== right.size)
        return false;
    for (const [label, info] of left) {
        const other = right.get(label);
        if (!other || other.href !== info.href || other.title !== info.title)
            return false;
    }
    return true;
}

interface IBlurFocus {
    blur: Nullable<Content>;
    focus: Nullable<Content>;
}

export class ScrollPage extends Parent<Parent> {
    private _blurFocus: IBlurFocus = { blur: null, focus: null };
    private readonly _criticMarkupStructuralBlocks = new Set<TreeNode>();
    private readonly _criticMarkupStructuralCommentContents = new Set<Content>();

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

    /** Create one serializable block and bind its parser-owned source trivia. */
    static createStateBlock(muya: Muya, state: TState): Parent {
        const block = this.loadBlock(state.name).create(muya, state);
        const descriptor = Object.getOwnPropertyDescriptor(
            state,
            'sourceTrivia',
        );
        if (
            descriptor
            && (!descriptor.enumerable || !('value' in descriptor))
        ) {
            throw new TypeError(
                'State sourceTrivia must be an enumerable data property.',
            );
        }
        if (!descriptor && 'sourceTrivia' in state) {
            throw new TypeError(
                'State sourceTrivia must be an own data property.',
            );
        }
        block.initializeStateSourceTrivia(descriptor?.value);
        return block;
    }

    static create(muya: Muya, state: TState[]) {
        const scrollPage = new ScrollPage(muya);

        appendCreatedChildren(
            state,
            block => this.createStateBlock(muya, block),
            child => scrollPage.append(child),
        );

        scrollPage.parent!.domNode!.appendChild(scrollPage.domNode!);

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

    /** Bind all structural fragments from one canonical document revision. */
    bindCriticMarkupDocument(document: CriticMarkupDocument | null): void {
        for (const content of this._criticMarkupStructuralCommentContents)
            bindCriticMarkupStructuralVisibility(content, false);
        this._criticMarkupStructuralCommentContents.clear();
        for (const block of this._criticMarkupStructuralBlocks)
            block.replaceCriticMarkupStructuralFragments([]);
        this._criticMarkupStructuralBlocks.clear();
        if (!document)
            return;

        for (const path of document.pathsWithStructuralFragments()) {
            const block = this.queryBlock([...path]);
            if (!block) {
                throw new TypeError(
                    'Structural CriticMarkup path has no live native block.',
                );
            }
            const fragments = document.structuralFragmentsForPath(path);
            block.replaceCriticMarkupStructuralFragments(fragments);
            this._criticMarkupStructuralBlocks.add(block);
            if (fragments.some(({ fragment }) =>
                fragment.kind === 'content'
                && fragment.arm === 'comment')) {
                if (block.isContent()) {
                    this._criticMarkupStructuralCommentContents.add(block);
                }
                else if (block.isParent()) {
                    block.breadthFirstTraverse((descendant) => {
                        if (descendant.isContent()) {
                            this._criticMarkupStructuralCommentContents
                                .add(descendant);
                        }
                    });
                }
            }
        }
        for (const content of this._criticMarkupStructuralCommentContents)
            bindCriticMarkupStructuralVisibility(content, true);
    }

    private _listenDomEvent() {
        const { eventCenter } = this.muya;
        const { domNode } = this;

        eventCenter.attachDOMEvent(domNode!, 'click', this._clickHandler.bind(this));
    }

    /**
     * Rebuild the page's top-level blocks from `state`.
     *
     * `reuseUnchangedBlocks` keeps the block instance (and its rendered DOM)
     * for every top-level block whose canonical state is unchanged. A
     * projection toggle re-derives the whole state array even when only the
     * critic-bearing blocks differ; recreating everything made the toggle
     * O(document) in inline tokenization and DOM construction. Callers must
     * only pass it when the render context (locale, render-affecting
     * options, diagram themes) is unchanged — a reused block's DOM is not
     * repainted.
     */
    updateState(state: TState[], reuseUnchangedBlocks = false) {
        const { muya } = this;
        const reusable = reuseUnchangedBlocks
            ? this._reusableChildrenByState(state)
            : null;
        const children = createChildren(state, (block) => {
            const reused = reusable?.get(stableStateKey(block))?.shift();
            return reused ?? ScrollPage.createStateBlock(muya, block);
        });
        // Empty scrollPage dom
        this.empty();
        for (const child of children)
            this.append(child);
    }

    /**
     * Index the current top-level blocks by canonical state for
     * `updateState` reuse. Returns null when reuse is unsound: rendered
     * output also depends on document-wide reference definitions, so if
     * those changed a state-equal `[text][ref]` paragraph could keep a
     * stale link target.
     */
    private _reusableChildrenByState(
        nextState: readonly TState[],
    ): Map<string, Parent[]> | null {
        const currentBlocks: Parent[] = [];
        const currentStates: TState[] = [];
        this.forEach((child) => {
            currentBlocks.push(child);
            currentStates.push(child.getState());
        });
        if (
            !labelsEqual(
                collectReferenceDefinitions(currentStates),
                collectReferenceDefinitions(nextState),
            )
        ) {
            return null;
        }

        const byKey = new Map<string, Parent[]>();
        currentBlocks.forEach((block, index) => {
            const key = stableStateKey(currentStates[index]);
            const queue = byKey.get(key);
            if (queue)
                queue.push(block);
            else
                byKey.set(key, [block]);
        });
        return byKey;
    }

    /**
     * Find the content block by the path
     * @param {Array} path
     */
    queryBlock(path: TBlockPath) {
        if (path.length === 0)
            return this;

        const p = path.shift() as number;
        const block = this.find(p) as Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined };
        return block && path.length ? block.queryBlock(path) : block;
    }

    updateRefLinkAndImage(label: string) {
        const REG = new RegExp(`\\[${label}\\](?!:)`);

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
                    const outcome: { cursorBlock: Content | null } = {
                        cursorBlock: null,
                    };
                    const result = this.muya.editor.mutationGateway.run(
                        { kind: 'user-command' },
                        () => {
                            const state: TState = {
                                name: 'paragraph',
                                text: '',
                            };
                            const newNode = ScrollPage.createStateBlock(
                                this.muya,
                                state,
                            );
                            this.append(newNode, 'user');
                            outcome.cursorBlock
                                = newNode.lastContentInDescendant();
                        },
                    );
                    if (result === 'untracked')
                        outcome.cursorBlock?.setCursor(0, 0, true);
                }
            }
        }
    }
}
