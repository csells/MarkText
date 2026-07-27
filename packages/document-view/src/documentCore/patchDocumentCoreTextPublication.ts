import type {
    MarkupRenderNode,
    MarkupRenderText,
    ModelRange,
} from '@marktext/document-core';
import { setDocumentCoreModelBoundaries } from './documentCoreInputAdapter';
import type {
    IDocumentCoreViewCompleteSnapshot,
    IDocumentCoreViewSourceOnlySnapshot,
    DocumentCoreViewSnapshot,
    DocumentCoreViewSourceEdit,
} from './documentCoreView';

const PATCHABLE_NODE_KINDS = new Set(['paragraph', 'text', 'soft-break']);

interface TextReplacement {
    readonly node: Text;
    readonly offset: number;
    readonly removedLength: number;
    readonly insertedText: string;
}

interface MountedTextPublicationBase {
    readonly kind: 'complete' | 'source-only';
    snapshot: DocumentCoreViewSnapshot;
    readonly trackedNodes: WeakSet<Node>;
    readonly trackedElements: WeakSet<Node>;
    observer: MutationObserver | null;
    invalid: boolean;
}

interface MountedCompleteTextPublication extends MountedTextPublicationBase {
    readonly kind: 'complete';
    snapshot: IDocumentCoreViewCompleteSnapshot;
    topology: Readonly<{
        nodes: readonly NodePair[];
        runs: readonly RunPair[];
    }>;
    readonly elements: readonly HTMLElement[];
    readonly carriers: readonly HTMLElement[];
    readonly texts: readonly Text[];
}

interface MountedSourceOnlyTextPublication extends MountedTextPublicationBase {
    readonly kind: 'source-only';
    snapshot: IDocumentCoreViewSourceOnlySnapshot;
    readonly carrier: HTMLElement;
    readonly text: Text;
}

type MountedTextPublication =
    | MountedCompleteTextPublication
    | MountedSourceOnlyTextPublication;

const mountedTextPublications = new WeakMap<
    HTMLElement,
    MountedTextPublication
>();

interface NodePair {
    readonly before: MarkupRenderNode;
    readonly after: MarkupRenderNode;
}

interface RunPair {
    readonly before: MarkupRenderText;
    readonly after: MarkupRenderText;
}

function sameAttributes(
    before: Readonly<Record<string, string | number | boolean>>,
    after: Readonly<Record<string, string | number | boolean>>,
): boolean {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    if (beforeKeys.length !== afterKeys.length)
        return false;

    return beforeKeys.every(key =>
        Object.prototype.hasOwnProperty.call(after, key)
        && before[key] === after[key]);
}

function isRange(range: ModelRange): boolean {
    return Number.isSafeInteger(range.start)
        && Number.isSafeInteger(range.end)
        && range.start >= 0
        && range.end >= range.start;
}

function hasNoReviewPresentation(
    snapshot: IDocumentCoreViewCompleteSnapshot,
): boolean {
    return snapshot.projection === 'marked'
        && !snapshot.trackChanges
        && snapshot.reviewIndex.items.length === 0
        && snapshot.reviewIndex.commentedSpans.length === 0
        && snapshot.outline.length === 0;
}

function collectCompatibleTopology(
    before: IDocumentCoreViewCompleteSnapshot,
    after: IDocumentCoreViewCompleteSnapshot,
): Readonly<{
    nodes: readonly NodePair[];
    runs: readonly RunPair[];
}> | null {
    if (
        !hasNoReviewPresentation(before)
        || !hasNoReviewPresentation(after)
        || before.blocks.length === 0
        || before.blocks.length !== after.blocks.length
    ) {
        return null;
    }

    const nodes: NodePair[] = [];
    const runs: RunPair[] = [];
    const pending: NodePair[] = [];
    for (let index = before.blocks.length - 1; index >= 0; index -= 1) {
        const beforeBlock = before.blocks[index];
        const afterBlock = after.blocks[index];
        if (
            beforeBlock === undefined
            || afterBlock === undefined
            || beforeBlock.kind !== 'paragraph'
            || afterBlock.kind !== beforeBlock.kind
            || !sameAttributes(beforeBlock.attributes, afterBlock.attributes)
            || !isRange(beforeBlock.modelRange)
            || !isRange(afterBlock.modelRange)
        ) {
            return null;
        }
        pending.push({ before: beforeBlock.tree, after: afterBlock.tree });
    }

    while (pending.length > 0) {
        const pair = pending.pop();
        if (pair === undefined)
            return null;
        const { before: beforeNode, after: afterNode } = pair;
        if (
            beforeNode.key !== afterNode.key
            || beforeNode.kind !== afterNode.kind
            || !PATCHABLE_NODE_KINDS.has(beforeNode.kind)
            || !sameAttributes(beforeNode.attributes, afterNode.attributes)
            || beforeNode.elements.length !== 0
            || afterNode.elements.length !== 0
            || !isRange(beforeNode.modelRange)
            || !isRange(afterNode.modelRange)
            || beforeNode.text.length !== afterNode.text.length
            || beforeNode.children.length !== afterNode.children.length
            || (
                beforeNode.kind === 'paragraph'
                && beforeNode.text.length !== 0
            )
            || (
                beforeNode.kind !== 'paragraph'
                && beforeNode.children.length !== 0
            )
        ) {
            return null;
        }

        nodes.push(pair);
        for (let index = 0; index < beforeNode.text.length; index += 1) {
            const beforeRun = beforeNode.text[index];
            const afterRun = afterNode.text[index];
            if (
                beforeRun === undefined
                || afterRun === undefined
                || beforeRun.elements.length !== 0
                || afterRun.elements.length !== 0
                || beforeRun.boundaryMapping !== afterRun.boundaryMapping
                || !isRange(beforeRun.modelRange)
                || !isRange(afterRun.modelRange)
            ) {
                return null;
            }
            runs.push({ before: beforeRun, after: afterRun });
        }
        for (
            let index = beforeNode.children.length - 1;
            index >= 0;
            index -= 1
        ) {
            const beforeChild = beforeNode.children[index];
            const afterChild = afterNode.children[index];
            if (beforeChild === undefined || afterChild === undefined)
                return null;
            pending.push({ before: beforeChild, after: afterChild });
        }
    }

    return { nodes, runs };
}

function integerAttribute(element: Element, name: string): number | null {
    const raw = element.getAttribute(name);
    if (raw === null || !/^(?:0|[1-9]\d*)$/u.test(raw))
        return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : null;
}

function hasRange(element: Element, range: ModelRange): boolean {
    return integerAttribute(element, 'data-model-start') === range.start
        && integerAttribute(element, 'data-model-end') === range.end;
}

function setRange(element: Element, range: ModelRange): void {
    element.setAttribute('data-model-start', String(range.start));
    element.setAttribute('data-model-end', String(range.end));
}

function mutationInvalidates(
    mutation: MutationRecord,
    mount: MountedTextPublication,
): boolean {
    if (mutation.type === 'characterData')
        return mount.trackedNodes.has(mutation.target);
    if (mutation.type === 'attributes')
        return mount.trackedElements.has(mutation.target);
    // The mounted DOM is an exact publication, not merely a bag of tracked
    // text carriers. Any structural mutation inside the observed host breaks
    // that identity, including insertion of an otherwise untracked sibling.
    return true;
}

function invalidateFrom(
    mutations: readonly MutationRecord[],
    mount: MountedTextPublication,
): void {
    if (mutations.some(mutation => mutationInvalidates(mutation, mount)))
        mount.invalid = true;
}

function observeMount(
    host: HTMLElement,
    mount: MountedTextPublication,
): void {
    const MutationObserverConstructor =
        host.ownerDocument.defaultView?.MutationObserver;
    if (MutationObserverConstructor === undefined)
        return;
    const observer = new MutationObserverConstructor(mutations =>
        invalidateFrom(mutations, mount));
    observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
            'class',
            'data-node-id',
            'data-markdown-kind',
            'data-model-start',
            'data-model-end',
        ],
    });
    mount.observer = observer;
}

export function forgetDocumentCoreTextPublication(host: HTMLElement): void {
    mountedTextPublications.get(host)?.observer?.disconnect();
    mountedTextPublications.delete(host);
}

/**
 * Bind a just-rendered DOM tree to the exact authoritative publication that
 * produced it. Later text patches authenticate against object and node
 * identity; they never rediscover a change by scanning mounted source text.
 */
export function rememberDocumentCoreTextPublication(
    host: HTMLElement,
    snapshot: DocumentCoreViewSnapshot,
): void {
    forgetDocumentCoreTextPublication(host);
    if (snapshot.kind === 'source-only') {
        const carriers = host.querySelectorAll<HTMLElement>(
            '.document-view-run.document-view-source',
        );
        const carrier = carriers.length === 1 ? carriers.item(0) : null;
        if (
            carrier === null
            || !hasRange(carrier, {
                start: 0,
                end: snapshot.source.length,
            })
            || carrier.childNodes.length !== 1
            || !(carrier.firstChild instanceof Text)
            || carrier.firstChild.length !== snapshot.source.length
        ) {
            return;
        }
        const trackedNodes = new WeakSet<Node>();
        const trackedElements = new WeakSet<Node>();
        trackedNodes.add(carrier);
        trackedNodes.add(carrier.firstChild);
        trackedElements.add(carrier);
        const mount: MountedSourceOnlyTextPublication = {
            kind: 'source-only',
            snapshot,
            carrier,
            text: carrier.firstChild,
            trackedNodes,
            trackedElements,
            observer: null,
            invalid: false,
        };
        mountedTextPublications.set(host, mount);
        observeMount(host, mount);
        return;
    }
    const topology = collectCompatibleTopology(snapshot, snapshot);
    if (topology === null)
        return;
    const elements = [
        ...host.querySelectorAll<HTMLElement>(
            '.document-view-node[data-node-id]',
        ),
    ];
    const carriers = [
        ...host.querySelectorAll<HTMLElement>(
            '.document-view-run:not(.document-view-atomic)',
        ),
    ];
    if (
        elements.length !== topology.nodes.length
        || carriers.length !== topology.runs.length
    ) {
        return;
    }

    const texts: Text[] = [];
    for (let index = 0; index < topology.nodes.length; index += 1) {
        const pair = topology.nodes[index];
        const element = elements[index];
        if (
            pair === undefined
            || element === undefined
            || element.dataset.nodeId !== pair.before.key
            || element.dataset.markdownKind !== pair.before.kind
            || !hasRange(element, pair.before.modelRange)
        ) {
            return;
        }
    }
    for (let index = 0; index < topology.runs.length; index += 1) {
        const pair = topology.runs[index];
        const carrier = carriers[index];
        if (
            pair === undefined
            || carrier === undefined
            || !hasRange(carrier, pair.before.modelRange)
            || carrier.childNodes.length !== 1
            || !(carrier.firstChild instanceof Text)
            || carrier.firstChild.length !== pair.before.text.length
        ) {
            return;
        }
        texts.push(carrier.firstChild);
    }

    const trackedNodes = new WeakSet<Node>();
    const trackedElements = new WeakSet<Node>();
    for (const element of [...elements, ...carriers]) {
        trackedNodes.add(element);
        trackedElements.add(element);
    }
    for (const text of texts)
        trackedNodes.add(text);
    const mount: MountedTextPublication = {
        kind: 'complete',
        snapshot,
        topology,
        elements: Object.freeze(elements),
        carriers: Object.freeze(carriers),
        texts: Object.freeze(texts),
        trackedNodes,
        trackedElements,
        observer: null,
        invalid: false,
    };
    mountedTextPublications.set(host, mount);
    observeMount(host, mount);
}

/**
 * Patch the one presentation-compatible text carrier in an authoritative
 * publication. Every topology and mounted-DOM check completes before mutation;
 * any uncertainty returns `false` so the caller performs a complete render.
 */
export function patchDocumentCoreTextPublication(
    host: HTMLElement,
    before: DocumentCoreViewSnapshot,
    after: DocumentCoreViewSnapshot,
    sourceEdits: readonly DocumentCoreViewSourceEdit[],
): boolean {
    const mount = mountedTextPublications.get(host);
    if (mount === undefined || mount.snapshot !== before)
        return false;
    if (mount.observer !== null)
        invalidateFrom(mount.observer.takeRecords(), mount);
    if (mount.invalid)
        return false;

    const edit = sourceEdits.length === 1 ? sourceEdits[0] : undefined;
    if (
        edit === undefined
        || !Number.isSafeInteger(edit.start)
        || !Number.isSafeInteger(edit.end)
        || edit.start < 0
        || edit.end < edit.start
        || edit.end > before.source.length
        || before.source.length - (edit.end - edit.start)
            + edit.insert.length !== after.source.length
    ) {
        return false;
    }
    if (
        before.kind === 'source-only'
        || after.kind === 'source-only'
        || mount.kind === 'source-only'
    ) {
        if (
            before.kind !== 'source-only'
            || after.kind !== 'source-only'
            || mount.kind !== 'source-only'
            || !host.contains(mount.carrier)
            || mount.carrier.childNodes.length !== 1
            || mount.carrier.firstChild !== mount.text
            || mount.text.length !== before.source.length
            || !hasRange(mount.carrier, {
                start: 0,
                end: before.source.length,
            })
        ) {
            return false;
        }
        mount.observer?.disconnect();
        mount.text.replaceData(
            edit.start,
            edit.end - edit.start,
            edit.insert,
        );
        const afterRange = { start: 0, end: after.source.length };
        setRange(mount.carrier, afterRange);
        setDocumentCoreModelBoundaries(mount.carrier, {
            kind: 'identity',
            start: 0,
            end: after.source.length,
            textLength: after.source.length,
        });
        mount.snapshot = after;
        mount.invalid = false;
        return true;
    }

    const topology = collectCompatibleTopology(before, after);
    if (
        topology === null
        || topology.nodes.length !== mount.topology.nodes.length
        || topology.runs.length !== mount.topology.runs.length
    ) {
        return false;
    }
    const lengthDelta = edit.insert.length - (edit.end - edit.start);

    for (let index = 0; index < topology.nodes.length; index += 1) {
        const pair = topology.nodes[index];
        const element = mount.elements[index];
        if (
            pair === undefined
            || element === undefined
            || !host.contains(element)
            || element.dataset.nodeId !== pair.before.key
            || element.dataset.markdownKind !== pair.before.kind
            || !hasRange(element, pair.before.modelRange)
        ) {
            return false;
        }
    }

    let replacement: TextReplacement | null = null;
    for (let index = 0; index < topology.runs.length; index += 1) {
        const pair = topology.runs[index];
        const carrier = mount.carriers[index];
        const text = mount.texts[index];
        if (
            pair === undefined
            || carrier === undefined
            || text === undefined
            || !host.contains(carrier)
            || !hasRange(carrier, pair.before.modelRange)
            || carrier.childNodes.length !== 1
            || carrier.firstChild !== text
            || text.length !== pair.before.text.length
        ) {
            return false;
        }
        if (
            edit.start < pair.before.modelRange.start
            || edit.end > pair.before.modelRange.end
        ) {
            continue;
        }
        if (
            replacement !== null
            || pair.before.boundaryMapping !== 'identity'
            || pair.after.boundaryMapping !== 'identity'
            || pair.before.text.length
                !== pair.before.modelRange.end - pair.before.modelRange.start
            || pair.after.text.length
                !== pair.after.modelRange.end - pair.after.modelRange.start
            || pair.after.modelRange.start !== pair.before.modelRange.start
            || pair.after.modelRange.end
                !== pair.before.modelRange.end + lengthDelta
        ) {
            return false;
        }
        replacement = {
            node: text,
            offset: edit.start - pair.before.modelRange.start,
            removedLength: edit.end - edit.start,
            insertedText: edit.insert,
        };
    }
    if (replacement === null)
        return false;

    mount.observer?.disconnect();
    replacement.node.replaceData(
        replacement.offset,
        replacement.removedLength,
        replacement.insertedText,
    );
    for (let index = 0; index < topology.nodes.length; index += 1) {
        const pair = topology.nodes[index];
        const element = mount.elements[index];
        if (pair !== undefined && element !== undefined)
            setRange(element, pair.after.modelRange);
    }
    for (let index = 0; index < topology.runs.length; index += 1) {
        const pair = topology.runs[index];
        const carrier = mount.carriers[index];
        if (pair === undefined || carrier === undefined)
            continue;
        setRange(carrier, pair.after.modelRange);
        setDocumentCoreModelBoundaries(carrier, {
            kind: pair.after.boundaryMapping,
            start: pair.after.modelRange.start,
            end: pair.after.modelRange.end,
            textLength: pair.after.text.length,
        });
    }
    mount.snapshot = after;
    mount.topology = topology;
    mount.invalid = false;
    return true;
}
