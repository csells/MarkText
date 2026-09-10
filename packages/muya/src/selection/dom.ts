// utils used in selection/index.js
import { CLASS_NAMES } from '../config';
import { isElement } from '../utils';

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

export function compareParagraphsOrder(paragraph1: HTMLElement, paragraph2: HTMLElement) {
    return (
        paragraph1.compareDocumentPosition(paragraph2)
        & Node.DOCUMENT_POSITION_FOLLOWING
    );
}

export function getTextContent(node: Node, blackList: string[] = []) {
    if (node.nodeType === Node.TEXT_NODE || blackList.length === 0)
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

export function getOffsetOfParagraph(node: Node, paragraph: HTMLElement, nodeOffset = 0): number {
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

export function getNodeAndOffset(
    node: Node,
    offset: number,
): { node: Node; offset: number } {
    if (node.nodeType === Node.TEXT_NODE) {
        return {
            node,
            offset,
        };
    }

    const childNodes = node.childNodes;
    const len = childNodes.length;
    let i;
    let count = 0;

    for (i = 0; i < len; i++) {
        const child = childNodes[i];
        const textContent = getTextContent(child, [
            CLASS_NAMES.MU_MATH_RENDER,
            CLASS_NAMES.MU_RUBY_RENDER,
        ]);
        const textLength = textContent.length;

        // Fix #1460 - put the cursor at the next text node or element if it can be put at the last of /^\n$/ or the next text node/element.
        if (
            /^\n$/.test(textContent) && i !== len - 1
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
                return getNodeAndOffset(child, offset - count);
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
