// utils used in selection/index.js
import type Content from '../block/base/content';
import type { IAnchorFocusInfo } from './types';
import { CLASS_NAMES } from '../config';
import { isElement, lineBounds } from '../utils';
import { getBlock } from '../utils/dom';

export function isContentDOM(element: HTMLElement) {
    return (
        element
        && element.tagName === 'SPAN'
        && element.classList.contains('mu-content')
    );
}

export function findContentDOM(node: Node | null | undefined) {
    if (!node)
        return null;

    do {
        if (node instanceof HTMLElement && isContentDOM(node))
            return node;

        node = node.parentNode;
    } while (node);

    return null;
}

export function resolveEndpoint(node: Node, offset: number): IAnchorFocusInfo | null {
    const contentDOM = findContentDOM(node);
    if (!contentDOM)
        return null;

    const block = getBlock(contentDOM);
    if (!block?.isContent() || !block.outMostBlock)
        return null;

    // The extra line a trailing break paints has no offset of its own — a caret
    // inside the span would read as the end of the line above (#3203).
    const trailingLineEnd = contentDOM.lastElementChild;
    if (
        trailingLineEnd
        && trailingLineEnd.classList.contains(CLASS_NAMES.MU_LINE_END)
        // An IME replaces the newline with its composing string; that path needs
        // the raw offset.
        && trailingLineEnd.textContent === '\n'
        && trailingLineEnd.contains(node)
    ) {
        return { offset: block.text.length, block, path: block.path };
    }

    // A selection anchored to an element carries a child index in `offset`,
    // not a character offset (#5239); the paragraph walk converts both kinds.
    return {
        offset: getOffsetOfParagraph(node, contentDOM, offset),
        block,
        path: block.path,
    };
}

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position)
        return { node: position.offsetNode, offset: position.offset };

    const range = doc.caretRangeFromPoint?.(x, y);

    return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

export function lineAtPoint(
    doc: Document,
    x: number,
    y: number,
): { block: Content; start: number; end: number } | null {
    const caret = caretAt(doc, x, y);
    const clicked = caret && resolveEndpoint(caret.node, caret.offset);
    if (!clicked)
        return null;

    const { block, offset } = clicked;
    const [start, end] = lineBounds(block.text, offset);

    return { block, start, end };
}

/**
 * Nearest offset on `block`'s first (`top`) or last (`bottom`) visual line at
 * viewport x `x`; `null` when no caret can be placed there.
 */
export function offsetInBlockAtPoint(
    doc: Document,
    block: Content,
    x: number,
    edge: 'top' | 'bottom',
): number | null {
    const dom = block.domNode;
    if (!dom?.isConnected)
        return null;

    const rect = dom.getBoundingClientRect();
    if (rect.height === 0)
        return null;

    // One pixel inside the first/last line box keeps the probe on that line
    // without depending on a numeric line-height (`normal` has none).
    const y = edge === 'top' ? rect.top + 1 : rect.bottom - 1;
    const caret = caretAt(doc, x, y);
    if (!caret)
        return null;

    const resolved = resolveEndpoint(caret.node, caret.offset);
    if (!resolved || resolved.block !== block)
        return null;

    return Math.min(Math.max(resolved.offset, 0), block.text.length);
}

export function compareParagraphsOrder(paragraph1: HTMLElement, paragraph2: HTMLElement) {
    return (
        paragraph1.compareDocumentPosition(paragraph2)
        & Node.DOCUMENT_POSITION_FOLLOWING
    );
}

/** Children from which a paragraph's last read offset is kept. */
const LONG_PARAGRAPH_CHILDREN = 64;

/**
 * An observer of each long paragraph's DOM, counting the changes it has
 * seen: one key reads the same caret several times, and a long code block's
 * text before it is long, so the last read is kept until the DOM changes.
 * Records delivered to the observer between reads count as well as those
 * still queued.
 */
const paragraphWatches = new WeakMap<Node, { observer: MutationObserver; changes: number }>();

/** How many times `paragraph`'s DOM has changed since it was first watched. */
function paragraphChanges(paragraph: Node): number {
    let watch = paragraphWatches.get(paragraph);
    if (watch === undefined) {
        const created = {
            observer: new MutationObserver(() => {
                created.changes += 1;
            }),
            changes: 0,
        };
        created.observer.observe(paragraph, {
            childList: true,
            characterData: true,
            subtree: true,
            // Which children read as text depends on their classes.
            attributes: true,
            attributeFilter: ['class'],
        });
        paragraphWatches.set(paragraph, created);
        watch = created;
    }
    if (watch.observer.takeRecords().length > 0)
        watch.changes += 1;
    return watch.changes;
}

/** The last offset read in each long paragraph, and its DOM's change count then. */
const lastParagraphOffsets = new WeakMap<HTMLElement, {
    changes: number;
    node: Node;
    nodeOffset: number;
    offset: number;
}>();

/** The last DOM point read in each long plain paragraph, and its DOM's change count then. */
const lastParagraphPoints = new WeakMap<Node, {
    changes: number;
    offset: number;
    point: { node: Node; offset: number };
}>();

/** The rendered previews an offset skips, which only inline content draws. */
const PREVIEW_CLASSES: ReadonlySet<string> = new Set([CLASS_NAMES.MU_MATH_RENDER, CLASS_NAMES.MU_RUBY_RENDER]);

/** Whether each long paragraph's offsets were its DOM text when last asked, and its DOM's change count then. */
const lastPlainOffsets = new WeakMap<Element, { changes: number; key: string; plain: boolean }>();

/**
 * Whether `element`'s offsets are its DOM text: neither it nor any element
 * in it is a rendered preview an offset skips (`blackList`) or an image,
 * which stands for its source. Live collections keep this cheap to ask
 * again of a short element while it is unchanged.
 */
function plainOffsets(element: Element, blackList: readonly string[]): boolean {
    const exceptions = [...blackList, CLASS_NAMES.MU_INLINE_IMAGE];
    if (element.tagName === 'IMG' || exceptions.some(className => element.classList.contains(className)))
        return false;
    if (element.childNodes.length < LONG_PARAGRAPH_CHILDREN || !(element instanceof HTMLElement && isContentDOM(element))) {
        return element.getElementsByTagName('img').length === 0
            && exceptions.every(className => element.getElementsByClassName(className).length === 0);
    }
    // A code block draws only its highlighted text, never a preview or an
    // image, so a long one is not searched after each key.
    if (element.classList.contains('mu-codeblock-content') && blackList.every(className => PREVIEW_CLASSES.has(className)))
        return true;
    // A long paragraph's collections are all read again after each change to
    // it, so it is searched once for any of them and the answer kept.
    const key = exceptions.join(' ');
    const changes = paragraphChanges(element);
    const last = lastPlainOffsets.get(element);
    if (last !== undefined && last.changes === changes && last.key === key)
        return last.plain;
    const plain = element.querySelector(['img', ...exceptions.map(className => `.${className}`)].join(', ')) === null;
    lastPlainOffsets.set(element, { changes, key, plain });
    return plain;
}

/** Whether `node`'s offsets read as its DOM text, which is far cheaper to read than a walk over a long block. */
function readsAsDomText(node: Node, blackList: readonly string[]): boolean {
    return node.nodeType === Node.TEXT_NODE || blackList.length === 0 || (isElement(node) && plainOffsets(node, blackList));
}

export function getTextContent(node: Node, blackList: string[] = []) {
    if (readsAsDomText(node, blackList))
        return node.textContent!;

    let text = '';
    if (
        isElement(node)
        && blackList.some(
            className => node.classList && node.classList.contains(className),
        )
    ) {
        return text;
    }

    if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
    }
    else if (
        isElement(node)
        && node.tagName === 'IMG'
        && node.parentElement?.classList.contains(CLASS_NAMES.MU_IMAGE_CONTAINER)
    ) {
        // A caret after the rendered image is after its whole editable token.
        text += node.closest(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)?.getAttribute('data-raw') ?? '';
    }
    else if (
        isElement(node)
        && node.classList.contains(`${CLASS_NAMES.MU_INLINE_IMAGE}`)
    ) {
    // handle inline image
        const raw = node.getAttribute('data-raw');
        const imageContainer = node.querySelector(
            `.${CLASS_NAMES.MU_IMAGE_CONTAINER}`,
        );
        const hasImg = imageContainer!.querySelector('img');
        const childNodes = imageContainer!.childNodes;
        if (childNodes.length && hasImg) {
            for (const child of childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE && child.nodeName === 'IMG')
                    text += raw;
                else if (child.nodeType === Node.TEXT_NODE)
                    text += child.textContent;
            }
        }
        else {
            text += raw;
        }
    }
    else {
        const childNodes = node.childNodes;

        for (const n of childNodes)
            text += getTextContent(n, blackList);
    }

    return text;
}

/**
 * One Range per document for every offset read. The DOM keeps each live Range
 * it has not yet garbage collected up to date on every mutation, so a fresh
 * Range per read makes later edits slower until collection catches up.
 */
const offsetRanges = new WeakMap<Document, Range>();

/** The text offset of a DOM point in a paragraph whose offsets are its DOM text. */
function plainOffsetOfParagraph(node: Node, paragraph: HTMLElement, nodeOffset: number): number {
    const long = paragraph.childNodes.length >= LONG_PARAGRAPH_CHILDREN;
    const changes = long ? paragraphChanges(paragraph) : 0;
    const last = long ? lastParagraphOffsets.get(paragraph) : undefined;
    if (last !== undefined && last.changes === changes && last.node === node && last.nodeOffset === nodeOffset)
        return last.offset;
    const doc = paragraph.ownerDocument ?? document;
    let range = offsetRanges.get(doc);
    if (range === undefined) {
        range = doc.createRange();
        offsetRanges.set(doc, range);
    }
    range.setStart(paragraph, 0);
    if (node.nodeType === Node.TEXT_NODE)
        range.setEnd(node, 0);
    else
        range.setEnd(node, Math.min(nodeOffset, node.childNodes.length));
    const offset = range.toString().length + (node.nodeType === Node.TEXT_NODE ? nodeOffset : 0);
    // Release the paragraph, which may later leave the document.
    range.setStart(doc, 0);
    range.collapse(true);
    if (long)
        lastParagraphOffsets.set(paragraph, { changes, node, nodeOffset, offset });
    return offset;
}

export function getOffsetOfParagraph(node: Node, paragraph: HTMLElement, nodeOffset = 0): number {
    // The text before `node` in document order, read natively when every
    // offset of the paragraph is its DOM text, as in a long code block.
    if (paragraph.contains(node) && plainOffsets(paragraph, [CLASS_NAMES.MU_MATH_RENDER, CLASS_NAMES.MU_RUBY_RENDER])) {
        return plainOffsetOfParagraph(node, paragraph, nodeOffset);
    }
    // DOM element offsets count children; text-node offsets count UTF-16 units.
    // Convert at the DOM boundary before adding preceding paragraph content.
    let offset = node.nodeType === Node.TEXT_NODE ? nodeOffset : 0;
    if (node.nodeType !== Node.TEXT_NODE) {
        for (let index = 0; index < Math.min(nodeOffset, node.childNodes.length); index++) {
            offset += getTextContent(node.childNodes[index], [
                CLASS_NAMES.MU_MATH_RENDER,
                CLASS_NAMES.MU_RUBY_RENDER,
            ]).length;
        }
    }
    let preSibling: Node | null = node;

    if (node === paragraph)
        return offset;

    do {
        preSibling = preSibling.previousSibling;
        if (preSibling) {
            offset += getTextContent(preSibling, [
                CLASS_NAMES.MU_MATH_RENDER,
                CLASS_NAMES.MU_RUBY_RENDER,
            ]).length;
        }
    } while (preSibling);

    return node === paragraph || node.parentNode === paragraph
        ? offset
        : offset + getOffsetOfParagraph(node.parentNode!, paragraph);
}

/**
 * The length of `node`'s `textContent`, read without building it for a text
 * node or an element holding one, as a highlighted code block's thousands of
 * children are.
 */
function domTextLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE)
        return (node as Text).length;
    const only = node.firstChild;
    if (only !== null && only === node.lastChild && only.nodeType === Node.TEXT_NODE && isElement(node))
        return (only as Text).length;
    return node.textContent?.length ?? 0;
}

export function getNodeAndOffset(
    node: Node,
    offset: number,
    // Every offset in a plain element is its DOM text, as in a long code
    // block, so its children's text is read natively, not walked.
    plain = isElement(node) && plainOffsets(node, [CLASS_NAMES.MU_MATH_RENDER, CLASS_NAMES.MU_RUBY_RENDER]),
): { node: Node; offset: number } {
    if (node.nodeType === Node.TEXT_NODE) {
        return {
            node,
            offset,
        };
    }

    if (!plain || node.childNodes.length < LONG_PARAGRAPH_CHILDREN || !(node instanceof HTMLElement && isContentDOM(node)))
        return childNodeAndOffset(node, offset, plain);
    const changes = paragraphChanges(node);
    const last = lastParagraphPoints.get(node);
    if (last === undefined || last.changes !== changes || last.offset !== offset) {
        const point = drawnChildPoint(node, offset, changes) ?? childNodeAndOffset(node, offset, plain);
        lastParagraphPoints.set(node, { changes, offset, point });
    }
    return { ...lastParagraphPoints.get(node)!.point };
}

/**
 * Each long paragraph's children's text lengths as their owner last drew
 * them, as running totals, with which of them are a lone line break, and
 * its DOM's change count then.
 */
const drawnChildTexts = new WeakMap<Node, { changes: number; ends: readonly number[]; breaks: readonly boolean[] }>();

/**
 * Note that `paragraph`'s children hold texts of `lengths`, `breaks` those
 * that are a lone line break, as its owner just drew them, so a DOM point
 * in it is found by search until its DOM changes. Returns its DOM's change
 * count, which `paragraphChangedSince` compares with.
 */
export function rememberDrawnChildTexts(paragraph: HTMLElement, lengths: readonly number[], breaks: readonly boolean[]): number {
    const changes = paragraphChanges(paragraph);
    const ends: number[] = [];
    let end = 0;
    for (const length of lengths) {
        end += length;
        ends.push(end);
    }
    drawnChildTexts.set(paragraph, { changes, ends, breaks });
    return changes;
}

/** Whether `paragraph`'s DOM has changed since its change count was `changes`. */
export function paragraphChangedSince(paragraph: HTMLElement, changes: number): boolean {
    return paragraphChanges(paragraph) !== changes;
}

/** `childNodeAndOffset` of a plain paragraph whose children are as drawn, by search. */
function drawnChildPoint(node: Node, offset: number, changes: number): { node: Node; offset: number } | undefined {
    const drawn = drawnChildTexts.get(node);
    const children = node.childNodes;
    if (drawn === undefined || drawn.changes !== changes || drawn.ends.length !== children.length)
        return undefined;
    const { ends, breaks } = drawn;
    // The first child whose text reaches `offset`, as the walk finds it.
    let low = 0;
    let high = ends.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (ends[middle]! >= offset)
            high = middle;
        else
            low = middle + 1;
    }
    if (low < ends.length && breaks[low] && low !== ends.length - 1 && ends[low] === offset)
        low += 1;
    if (low >= ends.length)
        return { node, offset };
    const child = children[low]!;
    if (isElement(child) && child.classList.contains(CLASS_NAMES.MU_INLINE_IMAGE))
        return undefined;
    return getNodeAndOffset(child, offset - (low === 0 ? 0 : ends[low - 1]!), true);
}

/** The DOM point at text `offset` among `node`'s children. */
function childNodeAndOffset(node: Node, offset: number, plain: boolean): { node: Node; offset: number } {
    const childNodes = node.childNodes;
    const len = childNodes.length;
    let i;
    let count = 0;

    for (i = 0; i < len; i++) {
        const child = childNodes[i];
        const textContent = plain
            ? undefined
            : getTextContent(child, [
                    CLASS_NAMES.MU_MATH_RENDER,
                    CLASS_NAMES.MU_RUBY_RENDER,
                ]);
        const textLength = textContent === undefined ? domTextLength(child) : textContent.length;

        // Fix #1460 - put the cursor at the next text node or element if it can be put at the last of /^\n$/ or the next text node/element.
        if (
            textLength === 1 && (textContent ?? child.textContent) === '\n' && i !== len - 1
                ? count + textLength > offset
                : count + textLength >= offset
        ) {
            if (
                isElement(child)
                && child.classList
                && child.classList.contains(`${CLASS_NAMES.MU_INLINE_IMAGE}`)
            ) {
                // An atomic image's outer text offsets are editable DOM
                // boundaries, regardless of loading state. Interior offsets
                // are resolved by active source presentation before editing.
                if (offset === count)
                    return { node, offset: i };
                if (offset === count + textLength)
                    return { node, offset: i + 1 };
                return { node: child, offset: 0 };
            }
            else {
                return getNodeAndOffset(child, offset - count, plain);
            }
        }
        else {
            count += textLength;
        }
    }

    return { node, offset };
}

export function getLegalOffset(node: Node, offset: number): number {
    if (!node || typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0)
        return 0;

    const max = node.nodeType === Node.TEXT_NODE
        ? (node as Text).length
        : node.childNodes.length;

    return Math.min(offset, max);
}
