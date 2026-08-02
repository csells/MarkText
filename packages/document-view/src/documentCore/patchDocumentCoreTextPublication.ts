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

// Kinds whose text carriers the patcher may surgically update. A paired
// walk already enforces identical keys, kinds, attributes, and child
// shapes; membership here asserts that the kind renders its text runs 1:1
// into DOM text nodes with no derived presentation the patch would miss.
// Links joined after the scale corpus measured their exclusion forcing a
// full re-mount per keystroke on ordinary link-bearing paragraphs.
const PATCHABLE_NODE_KINDS = new Set([
    'paragraph',
    'text',
    'soft-break',
    'link',
]);

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

// A link's destinationStart/destinationEnd are snapshot-side editing
// coordinates that never reach the DOM (the renderer materializes only
// href, title, and resolved) and drift with every upstream shift; the
// patch compares what a re-render would actually mount and the updated
// snapshot carries the moved offsets.
const DOM_RELEVANT_LINK_ATTRIBUTES = Object.freeze([
    'href',
    'title',
    'resolved',
]);

function domRelevantAttributes(
    kind: string,
    attributes: Readonly<Record<string, string | number | boolean>>,
): Readonly<Record<string, string | number | boolean>> {
    if (kind !== 'link')
        return attributes;
    const relevant: Record<string, string | number | boolean> = {};
    for (const key of DOM_RELEVANT_LINK_ATTRIBUTES) {
        if (Object.prototype.hasOwnProperty.call(attributes, key)) {
            const value = attributes[key];
            if (value !== undefined)
                relevant[key] = value;
        }
    }
    return relevant;
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
        // Keys pair positionally rather than by equality: offset-embedding
        // node ids (links, critic nodes) drift under a shift while the
        // node itself is unchanged, and the apply below restamps
        // data-node-id from the after topology. A mispairing cannot slip
        // through silently — the apply verifies every carrier against its
        // expected text before mutating.
        if (
            beforeNode.kind !== afterNode.kind
            || !PATCHABLE_NODE_KINDS.has(beforeNode.kind)
            || !sameAttributes(
                domRelevantAttributes(beforeNode.kind, beforeNode.attributes),
                domRelevantAttributes(afterNode.kind, afterNode.attributes),
            )
            || beforeNode.elements.length !== 0
            || afterNode.elements.length !== 0
            || !isRange(beforeNode.modelRange)
            || !isRange(afterNode.modelRange)
            || beforeNode.text.length !== afterNode.text.length
            || beforeNode.children.length !== afterNode.children.length
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

const MOUNT_OBSERVER_OPTIONS: MutationObserverInit = Object.freeze({
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: Object.freeze([
        'class',
        'data-node-id',
        'data-markdown-kind',
        'data-model-start',
        'data-model-end',
    ]) as string[],
});

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
    observer.observe(host, MOUNT_OBSERVER_OPTIONS);
    mount.observer = observer;
}

/**
 * Whether retained DOM under this host can be trusted as the authoritative
 * publication's own render. A host with no verified mount, or one whose
 * observer saw a mutation the publication did not make, is tainted: block
 * pools must not adopt its subtrees, because reuse would launder foreign
 * DOM back into an authoritative render — the sole-authority invariant.
 */
export function isDocumentCoreTextPublicationTainted(
    host: HTMLElement,
): boolean {
    const mount = mountedTextPublications.get(host);
    if (mount === undefined)
        return true;
    if (mount.observer !== null)
        invalidateFrom(mount.observer.takeRecords(), mount);
    return mount.invalid;
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
        // The observer paused for the patch's own mutations; a mount that
        // stops watching after its first patch is blind to later foreign
        // DOM and would keep patching around a counterfeit instead of
        // refusing — the sole-authority invariant the disconnect must not
        // outlive.
        mount.observer?.observe(host, MOUNT_OBSERVER_OPTIONS);
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
        if (pair === undefined || element === undefined)
            continue;
        setRange(element, pair.after.modelRange);
        if (pair.after.key !== pair.before.key)
            element.setAttribute('data-node-id', pair.after.key);
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
    mount.observer?.observe(host, MOUNT_OBSERVER_OPTIONS);
    return true;
}
