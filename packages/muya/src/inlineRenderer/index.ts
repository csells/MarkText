import type Format from '../block/base/format';
import type ParagraphContent from '../block/content/paragraphContent';
import type { Muya } from '../muya';
import type { IRenderCursor } from '../selection/types';
import type { IParagraphState, TContainerState, TState } from '../state/types';
import type { IHighlight, Labels, TInlinePresentation } from './types';
import { isValidAttribute } from '../utils/dompurify';
import logger from '../utils/logger';
import { h } from '../utils/snabbdom';
import { tokenizer } from './lexer';
import { createPresentationImageToken } from './presentationImage';
import Renderer from './renderer';
import { htmlTagPresentation } from './renderer/htmlTag';
import { beginRules } from './rules';

const debug = logger('inlineRenderer:');

/** Whether `target` has `source`'s elements and attribute names, whatever their text and values. */
function sameStructure(target: Node, source: Node): boolean {
    if (target.nodeType !== source.nodeType || target.childNodes.length !== source.childNodes.length)
        return false;
    if (target instanceof Element) {
        const other = source as Element;
        if (target.tagName !== other.tagName || target.attributes.length !== other.attributes.length)
            return false;
        for (const attribute of other.attributes) {
            if (!target.hasAttribute(attribute.name))
                return false;
        }
    }
    for (let index = 0; index < source.childNodes.length; index++) {
        if (!sameStructure(target.childNodes[index], source.childNodes[index]))
            return false;
    }
    return true;
}

function copyContent(target: Node, source: Node) {
    if (target.nodeType === Node.TEXT_NODE || target.nodeType === Node.COMMENT_NODE) {
        if (target.nodeValue !== source.nodeValue)
            target.nodeValue = source.nodeValue;
        return;
    }
    if (target instanceof Element) {
        for (const attribute of (source as Element).attributes) {
            if (target.getAttribute(attribute.name) !== attribute.value)
                target.setAttribute(attribute.name, attribute.value);
        }
    }
    for (let index = 0; index < source.childNodes.length; index++)
        copyContent(target.childNodes[index], source.childNodes[index]);
}

/**
 * Show a host presentation's HTML. When only its text and attribute values
 * differ from what is shown, such as after typing, the shown nodes keep
 * their identity and only those change; replacing elements makes the browser
 * lay out and resynchronize the selection across the whole editable document.
 */
function presentHTML(domNode: HTMLElement, html: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const shown = domNode.childNodes;
    const next = template.content.childNodes;
    if (shown.length === next.length && [...next].every((node, index) => sameStructure(shown[index], node))) {
        next.forEach((node, index) => copyContent(shown[index], node));
        return;
    }
    domNode.innerHTML = html;
}

class InlineRenderer {
    public labels: Labels = new Map();
    public renderer: Renderer;
    public presentation: TInlinePresentation | undefined;
    private _pendingPresentation = new Set<Format>();

    constructor(public muya: Muya) {
        this.renderer = new Renderer(muya, this);
    }

    private _tokenizer(block: Format, highlights: IHighlight[]) {
        const { options } = this.muya;
        const { text } = block;
        const { labels } = this;

        // TODO: different content block should have different rules.
        // eg: atxheading.content has no soft|hard line break
        // setextheading.content has no heading rules.
        const hasBeginRules
            = /thematicbreak\.content|paragraph\.content|atxheading\.content/.test(
                block.blockName,
            );

        return tokenizer(text, { hasBeginRules, labels, options, highlights });
    }

    /**
     * Flush every cached image and force inline images to reload.
     *
     * The renderer memoises loaded images in `loadImageMap` (keyed by src,
     * skipped on the next render once `isSuccess` is true) and resolved URLs
     * in `urlMap`. When an image file changes on disk the cached entry would
     * otherwise keep the stale bitmap, so clearing both maps and re-rendering
     * every content block re-runs `loadImageAsync`, which loads the source
     * afresh.
     */
    invalidateImageCache() {
        this.renderer.loadImageMap.clear();
        this.renderer.urlMap.clear();

        const { scrollPage } = this.muya.editor;
        if (!scrollPage)
            return;

        scrollPage.breadthFirstTraverse((node) => {
            if (node.isContent())
                node.update();
        });
    }

    patch(block: Format, cursor?: IRenderCursor, highlights: IHighlight[] = []) {
        const { domNode } = block;
        // Model boundary anchors are DOM children without editable text. They
        // need the same native caret surface as a structurally empty leaf.
        domNode!.classList.toggle('mu-empty-content', block.text.length === 0);
        // New blocks render before attachment, when their document path is unknown.
        if (this.presentation && !block.outMostBlock) {
            domNode!.textContent = block.text;
            this._pendingPresentation.add(block);
            return;
        }
        this._pendingPresentation.delete(block);
        const presentation = this.presentation?.(block.path, block.text, {
            highlights,
            renderHtmlTag: tag => htmlTagPresentation(this.renderer, h, block, cursor ?? {}, {
                type: 'html_tag',
                raw: tag.raw,
                range: { ...tag.range },
                parent: [],
                tag: tag.tag,
                attrs: { ...tag.attributes },
                openTag: tag.closing ? '' : tag.raw,
                closeTag: tag.closing ? tag.raw : '',
                children: [],
            }, tag.closing, tag.selfClosing),
            renderMath: (math) => {
                const html = this.renderer.output([{
                    type: 'inline_math',
                    raw: math.raw,
                    range: { ...math.range },
                    content: math.content,
                    marker: math.marker ?? '$',
                    backlash: '',
                    parent: [],
                    displayMode: math.displayMode,
                }], block, cursor ?? {});
                const host = document.createElement('div');
                host.innerHTML = html;
                const wrapper = host.querySelector('.mu-math');
                const preview = host.querySelector('.mu-math-render');
                if (!wrapper || !preview)
                    throw new Error('Native inline math presentation is unavailable');
                return {
                    open: `<span class="${wrapper.className}"><span class="mu-inline-rule mu-math-text" spellcheck="false">`,
                    close: `</span>${preview.outerHTML}</span>`,
                };
            },
            renderImage: (image) => {
                const anchor = cursor?.start?.offset ?? cursor?.anchor?.offset;
                const focus = cursor?.end?.offset ?? cursor?.focus?.offset;
                if ((cursor?.block === undefined || cursor.block === block)
                    && [anchor, focus].some(offset => offset !== undefined && image.range.start < offset && offset < image.range.end)) {
                    // Active syntax uses the same owned source text as the
                    // widget, with editable DOM for exact interior selections.
                    return { open: '<span class="mu-gray">', close: '</span>' };
                }
                if (!isValidAttribute('img', 'src', image.src)
                    && !/^(?:file:\/\/|[a-z]:[\\/])/i.test(image.src)) {
                    return undefined;
                }
                const html = this.renderer.output([createPresentationImageToken(image)], block, cursor ?? {});
                const host = document.createElement('div');
                host.innerHTML = html;
                const wrapper = host.firstElementChild as HTMLElement | null;
                if (!wrapper)
                    return undefined;
                wrapper.dataset.coreImage = JSON.stringify(image);
                const tail = host.innerHTML.slice(wrapper.outerHTML.length);
                const shell = (wrapper.cloneNode(false) as HTMLElement).outerHTML;
                return {
                    open: `${shell.slice(0, -7)}<span class="mu-hide mu-remove">`,
                    close: `</span>${wrapper.innerHTML}</span>${tail}`,
                };
            },
        });
        if (presentation !== undefined) {
            presentHTML(domNode!, presentation);
            return;
        }
        this.labels = this.collectReferenceDefinitions();
        if (block.isParent())
            debug.error('Patch can only handle content block');

        const tokens = this._tokenizer(block, highlights);
        const html = this.renderer.output(
            tokens,
            block,
            cursor && cursor.block === block ? cursor : {},
        );
        domNode!.innerHTML = html;
    }

    flushPendingPresentation() {
        if (this._pendingPresentation.size === 0)
            return;
        const pending = this._pendingPresentation;
        this._pendingPresentation = new Set();
        for (const block of pending) {
            if (block.outMostBlock)
                this.patch(block);
        }
    }

    // Reference definitions (`[ref]: url`) live in their own paragraphs, so
    // resolving `[text][ref]` needs a document-wide pass. Shared with
    // `getTOC`, which tokenizes headings outside a rendered block.
    collectReferenceDefinitions(): Labels {
        const state = this.muya.editor.jsonState.getState();
        const labels = new Map();

        const travel = (sts: TState[]) => {
            if (Array.isArray(sts) && sts.length) {
                for (const st of sts) {
                    if (st.name === 'paragraph') {
                        const { label, info } = this.getLabelInfo(st);
                        if (label && info)
                            labels.set(label, info);
                    }
                    else if ((st as TContainerState).children) {
                        travel((st as TContainerState).children);
                    }
                }
            }
        };

        travel(state);

        return labels;
    }

    getLabelInfo(blockOrState: ParagraphContent | IParagraphState) {
        const { text } = blockOrState;
        const tokens = beginRules.reference_definition.exec(text);
        let label = null;
        let info = null;
        if (tokens) {
            label = (tokens[2] + tokens[3]).toLowerCase();
            info = {
                href: tokens[6],
                title: tokens[10] || '',
            };
        }

        return { label, info };
    }
}

export default InlineRenderer;
