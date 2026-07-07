import type { Muya } from '../../muya';
import type { TState } from '../../state/types';
import type { Nullable } from '../../types';
import type Content from '../base/content';
import type TreeNode from '../base/treeNode';
import type { IConstructor, TBlockPath } from '../types';
import { commentMarkerKindsInTexts } from '../../comments/markerScan';
import {
    NON_COMMENT_SCANNABLE_LEAF_BLOCKS,
    parseCommentMetadataDefinition,
} from '../../comments/syntax';
import { BLOCK_DOM_PROPERTY } from '../../config';
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
        // Empty scrollPage dom
        this.empty();
        this.append(
            ...state.map((block) => {
                return ScrollPage.loadBlock(block.name).create(muya, block);
            }),
        );
        this.updateCommentContent();
    }

    // Remove the hidden [MC:id] definition paragraphs of comments whose
    // markers no longer exist anywhere in the document. The document-level
    // sweep lives here (not in any one editing surface) so cut, paste,
    // typing, and Enter all share it.
    removeUnreferencedCommentMetadata(ids: string[]): void {
        if (ids.length === 0)
            return;

        const blocks: Content[] = [];
        let block: Nullable<Content> = this.firstContentInDescendant();
        while (block) {
            blocks.push(block);
            block = block.nextContentInContext();
        }

        const documentKinds = commentMarkerKindsInTexts(
            blocks
                .filter(candidate => !NON_COMMENT_SCANNABLE_LEAF_BLOCKS.has(candidate.blockName))
                .map(candidate => candidate.text),
        );

        for (const id of ids) {
            if (documentKinds.has(id))
                continue;

            for (const candidate of blocks) {
                // Mirror the comment parser's eligibility: a definition-shaped
                // line inside a code fence / front matter / html block is
                // literal text, not metadata.
                if (candidate.blockName !== 'paragraph.content')
                    continue;
                if (parseCommentMetadataDefinition(candidate.text)?.id !== id)
                    continue;

                // Remove only the definition's own paragraph, then any
                // ancestors the removal emptied — never the whole outermost
                // container, which may hold unrelated content.
                let node: Nullable<Parent> = candidate.parent;
                while (node && !node.isScrollPage) {
                    const parent: Nullable<Parent> = node.parent;
                    node.remove();
                    if (!parent || parent.isScrollPage || parent.length() > 0)
                        break;
                    node = parent;
                }
            }
        }

        if (this.length() === 0) {
            const newParagraphBlock = ScrollPage.loadBlock('paragraph').create(
                this.muya,
                { name: 'paragraph', text: '' },
            );
            this.append(newParagraphBlock, 'user');
            newParagraphBlock.firstContentInDescendant()?.setCursor(0, 0, true);
        }
    }

    updateCommentContent() {
        // Blocks render DETACHED during updateState's append, and the
        // highlight step skips detached blocks — so highlight-bearing blocks
        // need one repaint after attach. Marker/definition HIDING has no
        // cross-block dependency and is correct on the first render, so only
        // blocks the (cached) render model actually highlights re-render.
        const { comments } = this.muya.commentRenderView();
        if (comments.ranges.length === 0)
            return;

        const { inlineRenderer } = this.muya.editor;
        this.breadthFirstTraverse((node) => {
            if (node.isContent() && inlineRenderer.hasCommentHighlights(node as never))
                node.update();
        });
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
