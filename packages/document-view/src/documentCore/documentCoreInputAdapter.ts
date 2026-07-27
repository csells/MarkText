import type { ModelPosition } from '@marktext/document-core';

export interface IDocumentCoreInputRange {
    readonly start: number;
    readonly end: number;
}

interface IDomPoint {
    readonly node: Node;
    readonly offset: number;
}

const MODEL_RANGE_SELECTOR = '[data-model-start][data-model-end]';
const RUN_RANGE_SELECTOR = '.document-view-run[data-model-start][data-model-end]';
interface IDocumentCoreModelBoundaryMap {
    readonly kind: 'identity' | 'collapsed';
    readonly start: number;
    readonly end: number;
    readonly textLength: number;
}
const MODEL_BOUNDARIES = new WeakMap<
    Element,
    IDocumentCoreModelBoundaryMap
>();

/**
 * Attach the parser-issued rendered-boundary map without serializing a large
 * offset vector into DOM attributes.
 */
export function setDocumentCoreModelBoundaries(
    element: Element,
    boundaries: IDocumentCoreModelBoundaryMap,
): void {
    MODEL_BOUNDARIES.set(element, Object.freeze({ ...boundaries }));
}

function modelBoundaryAtTextOffset(
    boundaries: IDocumentCoreModelBoundaryMap,
    rawOffset: number,
): number {
    const offset = Math.max(
        0,
        Math.min(boundaries.textLength, rawOffset),
    );
    if (offset === boundaries.textLength)
        return boundaries.end;
    if (boundaries.kind === 'collapsed')
        return boundaries.start;
    return Math.min(boundaries.end, boundaries.start + offset);
}

function textOffsetAtModelBoundary(
    boundaries: IDocumentCoreModelBoundaryMap,
    position: ModelPosition,
): number {
    const { start, end, textLength } = boundaries;
    if (position.offset < start)
        return 0;
    if (position.offset > end)
        return textLength;
    if (position.offset === end)
        return textLength;
    if (boundaries.kind === 'collapsed') {
        if (position.offset === start)
            return position.affinity === 'previous'
                ? Math.max(0, textLength - 1)
                : 0;
        return position.affinity === 'previous'
            ? Math.max(0, textLength - 1)
            : textLength;
    }
    const linearEnd = start + textLength;
    if (position.offset < linearEnd)
        return position.offset - start;
    return position.affinity === 'previous'
        ? Math.max(0, textLength - 1)
        : textLength;
}

function integerAttribute(element: Element, name: string): number {
    const value = Number(element.getAttribute(name));
    if (!Number.isInteger(value))
        throw new TypeError(`Invalid ${name} on document-core render node`);

    return value;
}

function containsPoint(host: HTMLElement, node: Node): boolean {
    return node === host || host.contains(node);
}

function containsModelPoint(host: HTMLElement, node: Node): boolean {
    if (!containsPoint(host, node))
        return false;
    if (node === host)
        return true;

    const origin = node instanceof Element ? node : node.parentElement;
    const element = origin?.closest(MODEL_RANGE_SELECTOR);
    return element !== null
        && element !== undefined
        && host.contains(element);
}

function rangeElementForPoint(host: HTMLElement, node: Node): Element {
    const origin = node instanceof Element ? node : node.parentElement;
    const element = origin?.closest(RUN_RANGE_SELECTOR)
        ?? origin?.closest(MODEL_RANGE_SELECTOR);
    if (!element || !host.contains(element))
        throw new RangeError('Browser selection is outside the document-core view');

    return element;
}

function directTextOffsetWithin(
    element: Element,
    node: Node,
    offset: number,
): number | undefined {
    if (!(node instanceof Text))
        return undefined;

    let current: Node = node;
    while (current.parentNode !== element) {
        const parent = current.parentNode;
        if (parent === null || parent.childNodes.length !== 1)
            return undefined;
        current = parent;
    }
    if (element.childNodes.length !== 1)
        return undefined;

    return Math.max(0, Math.min(node.data.length, offset));
}

function textOffsetWithin(
    element: Element,
    node: Node,
    offset: number,
): number {
    const direct = directTextOffsetWithin(element, node, offset);
    if (direct !== undefined)
        return direct;

    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    try {
        range.setEnd(node, offset);
    }
    catch {
        throw new RangeError('Browser selection is not a valid rendered-text position');
    }
    return range.toString().length;
}

function modelOffsetAtDomPoint(
    host: HTMLElement,
    node: Node,
    offset: number,
): number {
    if (!containsPoint(host, node))
        throw new RangeError('Browser selection is outside the document-core view');

    if (node === host) {
        const runs = [...host.querySelectorAll(RUN_RANGE_SELECTOR)];
        if (runs.length === 0)
            return 0;

        if (offset <= 0)
            return integerAttribute(runs[0], 'data-model-start');

        if (offset >= host.childNodes.length)
            return integerAttribute(runs[runs.length - 1], 'data-model-end');

        const nextChild = host.childNodes[offset];
        const nextRun = nextChild instanceof Element
            ? nextChild.matches(RUN_RANGE_SELECTOR)
                ? nextChild
                : nextChild.querySelector(RUN_RANGE_SELECTOR)
            : null;
        if (nextRun)
            return integerAttribute(nextRun, 'data-model-start');
    }

    const element = rangeElementForPoint(host, node);
    const start = integerAttribute(element, 'data-model-start');
    const end = integerAttribute(element, 'data-model-end');
    const localOffset = textOffsetWithin(element, node, offset);
    const boundaries = MODEL_BOUNDARIES.get(element);
    if (boundaries !== undefined)
        return modelBoundaryAtTextOffset(boundaries, localOffset);
    return Math.min(end, start + localOffset);
}

function targetRange(event: InputEvent): StaticRange | Range | null {
    const getTargetRanges = event.getTargetRanges;
    if (typeof getTargetRanges === 'function') {
        const first = getTargetRanges.call(event)[0];
        if (first)
            return first;
    }

    const selection = (event.currentTarget as HTMLElement | null)
        ?.ownerDocument
        .getSelection();
    return selection?.rangeCount ? selection.getRangeAt(0) : null;
}

/**
 * Resolve the browser's immutable beforeinput target to the model coordinate
 * space carried by the committed render plan.
 */
export function documentCoreInputRange(
    host: HTMLElement,
    event: InputEvent,
): IDocumentCoreInputRange {
    const range = targetRange(event);
    if (!range)
        throw new RangeError('Browser input has no target range');

    const start = modelOffsetAtDomPoint(
        host,
        range.startContainer,
        range.startOffset,
    );
    const end =
        range.startContainer === range.endContainer
        && range.startOffset === range.endOffset
            ? start
            : modelOffsetAtDomPoint(
                host,
                range.endContainer,
                range.endOffset,
            );
    return Object.freeze({
        start: Math.min(start, end),
        end: Math.max(start, end),
    });
}

/** Resolve the current browser selection through parser-owned run addresses. */
export function documentCoreSelectionRange(
    host: HTMLElement,
): IDocumentCoreInputRange {
    const selection = host.ownerDocument.getSelection();
    if (
        !selection
        || !selection.anchorNode
        || !selection.focusNode
        || !containsPoint(host, selection.anchorNode)
        || !containsPoint(host, selection.focusNode)
    ) {
        throw new RangeError('Browser selection is outside the document-core view');
    }
    const anchor = modelOffsetAtDomPoint(
        host,
        selection.anchorNode,
        selection.anchorOffset,
    );
    const focus = modelOffsetAtDomPoint(
        host,
        selection.focusNode,
        selection.focusOffset,
    );
    return Object.freeze({
        start: Math.min(anchor, focus),
        end: Math.max(anchor, focus),
    });
}

function textPointAtOffset(element: Element, offset: number): IDomPoint {
    const showText = element.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
    const walker = element.ownerDocument.createTreeWalker(element, showText);
    let remaining = offset;
    let last: Text | null = null;
    let node = walker.nextNode();
    while (node) {
        if (node instanceof Text) {
            last = node;
            if (remaining <= node.data.length)
                return { node, offset: remaining };

            remaining -= node.data.length;
        }
        node = walker.nextNode();
    }

    if (last)
        return { node: last, offset: last.data.length };

    return { node: element, offset: 0 };
}

function domPointAtModelPosition(
    host: HTMLElement,
    position: ModelPosition,
): IDomPoint {
    const runs = [...host.querySelectorAll(RUN_RANGE_SELECTOR)];
    if (runs.length === 0)
        return { node: host, offset: 0 };

    const candidates = runs.filter((run) => {
        const start = integerAttribute(run, 'data-model-start');
        const end = integerAttribute(run, 'data-model-end');
        return position.offset >= start && position.offset <= end;
    });
    let run = candidates.find((candidate) => {
        const start = integerAttribute(candidate, 'data-model-start');
        const end = integerAttribute(candidate, 'data-model-end');
        return position.affinity === 'previous'
            ? end === position.offset
            : start === position.offset;
    });
    run ??= candidates[position.affinity === 'previous'
        ? candidates.length - 1
        : 0];
    run ??= position.offset <= integerAttribute(runs[0], 'data-model-start')
        ? runs[0]
        : runs[runs.length - 1];

    const start = integerAttribute(run, 'data-model-start');
    const end = integerAttribute(run, 'data-model-end');
    const boundaries = MODEL_BOUNDARIES.get(run);
    let localOffset = Math.max(
        0,
        Math.min(end - start, position.offset - start),
    );
    if (boundaries !== undefined)
        localOffset = textOffsetAtModelBoundary(boundaries, position);
    return textPointAtOffset(run, localOffset);
}

/**
 * Restore the browser selection from the session-owned model selection after a
 * committed render replaced the old DOM.
 */
export function restoreDocumentCoreSelection(
    host: HTMLElement,
    anchor: ModelPosition,
    focus: ModelPosition,
): void {
    const selection = host.ownerDocument.getSelection();
    if (!selection)
        return;

    const anchorPoint = domPointAtModelPosition(host, anchor);
    const focusPoint = domPointAtModelPosition(host, focus);
    if (typeof selection.setBaseAndExtent === 'function') {
        selection.setBaseAndExtent(
            anchorPoint.node,
            anchorPoint.offset,
            focusPoint.node,
            focusPoint.offset,
        );
        return;
    }

    const range = host.ownerDocument.createRange();
    range.setStart(anchorPoint.node, anchorPoint.offset);
    range.setEnd(focusPoint.node, focusPoint.offset);
    selection.removeAllRanges();
    selection.addRange(range);
}

export function documentCoreSelectionIsMounted(host: HTMLElement): boolean {
    const selection = host.ownerDocument.getSelection();
    if (
        !selection
        || selection.rangeCount === 0
        || !selection.anchorNode
        || !selection.focusNode
    ) {
        return false;
    }

    return (
        containsModelPoint(host, selection.anchorNode)
        && containsModelPoint(host, selection.focusNode)
    );
}
