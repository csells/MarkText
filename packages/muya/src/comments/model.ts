import type { JSONOp } from 'ot-json1';
import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentDiagnostic, ICommentRange, ICommentThread, IParsedMarkdownComments } from './types';
import * as json1 from 'ot-json1';
import { malformedCommentMarkersInText, realCommentMarkersInText } from './markerScan';
import {
    decodeCommentHeadPayload,
    decodeCommentReplyPayload,
    deriveThreadAuthors,
    deriveThreadUpdatedAt,
    serializeCommentThreadLines,
} from './metadata';
import { commentPathKey } from './range';
import {
    LITERAL_COMMENT_TEXT_STATES,
    parseCommentHeadDefinition,
    parseCommentMetadataDefinition,
    parseCommentReplyDefinition,
    serializeCommentMarker,
} from './syntax';

// The runtime comment representation (specs/architecture/comment-anchors.md):
// marker and metadata bytes exist only in serialized markdown. At runtime the
// document state is CLEAN and comments live here — anchors as OT positions
// into clean text, threads as decoded metadata, plus the verbatim definition
// lines that did not decode (duplicates, malformed payloads, orphan replies)
// so a damaged file round-trips without silent data loss.

export interface ICommentAnchor {
    id: string;
    kind: 'open' | 'close';
    // json1 position into the clean state tree: [...statePath, 'text', offset].
    position: TBlockPath;
}

export type TCommentDefinitionItem
    = | { kind: 'thread'; id: string; diagnostics?: ICommentDiagnostic[] }
        | { kind: 'residue'; line: string; diagnostics?: ICommentDiagnostic[] };

// One contiguous run of definition lines as the file laid them out. A thread
// item re-serializes its (possibly mutated) thread head-first; a residue item
// re-emits its line verbatim. Positions ride the OT transform like anchors,
// so a definition block lives where the file put it — not wherever
// serialization finds convenient (byte round-trip fidelity, invariant 2).
export interface ICommentDefinitionRun {
    // Insertion point in clean-state coordinates: a block position for a run
    // that was its own block, [...statePath, 'text', offset] for lines
    // embedded in a surviving leaf. null → the trailing appendix (detached
    // by an edit that removed the surrounding structure).
    position: TBlockPath | null;
    // Text-position runs only: 'before' preceded the content at the offset
    // (splices as `lines\n`), 'after' trailed the leaf (splices as `\nlines`).
    edge: 'before' | 'after';
    items: TCommentDefinitionItem[];
}

export interface ICommentModel {
    // Insertion order is head-line document order.
    threads: Map<string, ICommentThread>;
    // Walk order — document order at extraction time; transforms may reorder
    // offsets within a leaf, so derive ordering on read where it matters.
    anchors: ICommentAnchor[];
    // Definition-line layout in document order. Threads created at runtime
    // have no run; they append to the trailing appendix at serialization.
    runs: ICommentDefinitionRun[];
}

// The verbatim lines that did not decode, in document order — the read side
// derives diagnostics from these.
export function commentModelResidue(model: ICommentModel): string[] {
    return model.runs.flatMap(run =>
        run.items.flatMap(item => (item.kind === 'residue' ? [item.line] : [])),
    );
}

export interface IExtractedCommentModel {
    states: TState[];
    model: ICommentModel;
}

type TTextState = Extract<TState, { text: string }>;

function isCommentableLeaf(state: TState): state is TTextState {
    return 'text' in state && typeof state.text === 'string' && !LITERAL_COMMENT_TEXT_STATES.has(state.name);
}

interface IDefinitionLineRecord {
    line: string;
}

// A definition run as the leaf walk finds it; `position`/`edge` follow the
// run shape, records resolve into items once every line is classified.
interface IPendingRun {
    position: TBlockPath | null;
    edge: 'before' | 'after';
    records: IDefinitionLineRecord[];
}

// Strip real markers from `text`, recording each as an anchor at its
// clean-text offset. Offsets are UTF-16 code units — the same coordinate
// space as state text, DOM selection, and highlights (invariant 6).
// `mapOffset` translates a pre-strip offset into clean-text coordinates for
// the definition runs recorded against this leaf.
function extractAnchorsFromText(
    text: string,
    statePath: TBlockPath,
    anchors: ICommentAnchor[],
): { clean: string; mapOffset: (offset: number) => number } {
    const markers = realCommentMarkersInText(text);
    if (markers.length === 0)
        return { clean: text, mapOffset: offset => offset };

    let clean = '';
    let consumed = 0;
    for (const marker of markers) {
        clean += text.slice(consumed, marker.start);
        anchors.push({
            id: marker.id,
            kind: marker.kind,
            position: [...statePath, 'text', clean.length],
        });
        consumed = marker.end;
    }
    clean += text.slice(consumed);

    const mapOffset = (offset: number): number => {
        let removed = 0;
        for (const marker of markers) {
            if (marker.end <= offset)
                removed += marker.end - marker.start;
        }
        return offset - removed;
    };
    return { clean, mapOffset };
}

export function extractCommentModel(states: TState[]): IExtractedCommentModel {
    const anchors: ICommentAnchor[] = [];
    const pendingRuns: IPendingRun[] = [];

    const visit = (nodes: TState[], path: TBlockPath): TState[] => {
        const out: TState[] = [];
        for (const state of nodes) {
            const statePath = [...path, out.length];
            const next: TState = { ...state };
            const runsBeforeState = pendingRuns.length;

            if (isCommentableLeaf(state)) {
                // Definition-shaped lines leave the document entirely; the
                // model owns them (and their placement) from here on.
                const kept: string[] = [];
                const leafRuns: Array<IPendingRun & { keptCountBefore: number }> = [];
                let current: (IPendingRun & { keptCountBefore: number }) | null = null;
                for (const line of state.text.split('\n')) {
                    if (parseCommentMetadataDefinition(line)) {
                        if (!current) {
                            current = { position: null, edge: 'before', records: [], keptCountBefore: kept.length };
                            leafRuns.push(current);
                        }
                        current.records.push({ line });
                    }
                    else {
                        current = null;
                        kept.push(line);
                    }
                }

                if (kept.length === 0) {
                    // The whole leaf was definition lines: one run at the
                    // block position this leaf would have occupied.
                    for (const run of leafRuns) {
                        run.position = statePath;
                        pendingRuns.push(run);
                    }
                    continue;
                }

                const { clean, mapOffset } = extractAnchorsFromText(
                    kept.join('\n'),
                    statePath,
                    anchors,
                );
                (next as TTextState).text = clean;

                for (const run of leafRuns) {
                    if (run.keptCountBefore === kept.length) {
                        // Trailing run: anchor to the end of the clean text.
                        run.edge = 'after';
                        run.position = [...statePath, 'text', clean.length];
                    }
                    else {
                        const keptOffset = run.keptCountBefore === 0
                            ? 0
                            : kept.slice(0, run.keptCountBefore).join('\n').length + 1;
                        run.position = [...statePath, 'text', mapOffset(keptOffset)];
                    }
                    pendingRuns.push(run);
                }
            }

            if ('children' in state && Array.isArray(state.children)) {
                const children = visit(state.children, [...statePath, 'children']);
                // A container that held only definition lines (e.g. a
                // blockquote wrapping the appendix) empties out; drop it
                // rather than serialize a bare container shell. Runs recorded
                // inside it re-anchor to the container's own block position
                // (the wrapper normalizes away; the location survives).
                if (children.length === 0 && !('text' in next)) {
                    for (let i = runsBeforeState; i < pendingRuns.length; i += 1) {
                        pendingRuns[i].position = statePath;
                        pendingRuns[i].edge = 'before';
                    }
                    continue;
                }
                (next as { children: TState[] }).children = children;
            }

            out.push(next);
        }
        return out;
    };

    const cleanStates = visit(states, []);

    const { threads, runs } = resolveDefinitionRuns(pendingRuns);

    return { states: cleanStates, model: { threads, anchors, runs } };
}

// Resolve definition lines exactly like the file-level analyzer: first
// decodable head per id wins, replies attach by id in document order,
// everything else survives verbatim as residue carrying its exact
// diagnostic. Each record resolves to its run item — a decoded reply
// contributes no item of its own (its bytes re-emit inside the thread
// block at the head's run).
function resolveDefinitionRuns(pendingRuns: IPendingRun[]): {
    threads: ICommentModel['threads'];
    runs: ICommentDefinitionRun[];
} {
    const threads = new Map<string, ICommentThread>();
    const itemByRecord = new Map<IDefinitionLineRecord, TCommentDefinitionItem | null>();
    const replyRecords: Array<{ record: IDefinitionLineRecord; id: string; payload: string }> = [];
    // Head lines already seen per id (decodable or not) — the analyzer
    // diagnoses every repeat as duplicate-metadata, even the repeat that
    // ends up winning first-decodable-head-wins.
    const seenHeadIds = new Set<string>();

    for (const run of pendingRuns) {
        for (const record of run.records) {
            const reply = parseCommentReplyDefinition(record.line);
            if (reply) {
                replyRecords.push({ record, id: reply.id, payload: reply.payload });
                continue;
            }

            const head = parseCommentHeadDefinition(record.line);
            const lineDiagnostics: ICommentDiagnostic[] = [];
            if (head) {
                if (seenHeadIds.has(head.id)) {
                    lineDiagnostics.push({
                        code: 'duplicate-metadata',
                        id: head.id,
                        message: `Found duplicate metadata definition for comment "${head.id}".`,
                    });
                }
                seenHeadIds.add(head.id);
            }
            if (head) {
                try {
                    const decoded = decodeCommentHeadPayload(head.payload);
                    if (!threads.has(head.id)) {
                        threads.set(head.id, { id: head.id, ...decoded });
                        itemByRecord.set(record, {
                            kind: 'thread',
                            id: head.id,
                            ...(lineDiagnostics.length ? { diagnostics: lineDiagnostics } : {}),
                        });
                        continue;
                    }
                }
                catch (error) {
                    lineDiagnostics.push({
                        code: 'invalid-metadata',
                        id: head.id,
                        message: error instanceof Error
                            ? error.message
                            : `Metadata for comment "${head.id}" is invalid.`,
                    });
                }
            }
            else {
                const definition = parseCommentMetadataDefinition(record.line);
                const id = definition?.id ?? '__unknown__';
                lineDiagnostics.push({
                    code: 'invalid-metadata',
                    id,
                    message: `Metadata for comment "${id}" is invalid.`,
                });
            }

            itemByRecord.set(record, {
                kind: 'residue',
                line: record.line,
                diagnostics: lineDiagnostics,
            });
        }
    }

    for (const { record, id, payload } of replyRecords) {
        const thread = threads.get(id);
        if (!thread) {
            itemByRecord.set(record, {
                kind: 'residue',
                line: record.line,
                diagnostics: [{
                    code: 'orphan-reply',
                    id,
                    message: `Found reply line for comment "${id}" without a head metadata line.`,
                }],
            });
            continue;
        }
        try {
            thread.replies.push(decodeCommentReplyPayload(payload));
            itemByRecord.set(record, null);
        }
        catch (error) {
            itemByRecord.set(record, {
                kind: 'residue',
                line: record.line,
                diagnostics: [{
                    code: 'invalid-reply',
                    id,
                    message: error instanceof Error
                        ? error.message
                        : `A reply line for comment "${id}" is invalid.`,
                }],
            });
        }
    }

    const runs: ICommentDefinitionRun[] = pendingRuns.map(run => ({
        position: run.position,
        edge: run.edge,
        items: run.records.flatMap((record) => {
            const item = itemByRecord.get(record);
            return item ? [item] : [];
        }),
    }));

    return { threads, runs };
}

function commentPathKeyOf(position: TBlockPath): string {
    return commentPathKey(position.slice(0, -1));
}

function readLeaf(states: TState[], position: TBlockPath): TTextState | null {
    let current: unknown = states;
    for (const segment of position.slice(0, -2)) {
        if (typeof segment === 'number') {
            if (!Array.isArray(current))
                return null;
            current = current[segment];
        }
        else {
            if (typeof current !== 'object' || current == null)
                return null;
            current = (current as Record<string, unknown>)[segment];
        }
    }

    const leaf = current as TState | undefined;
    return leaf && isCommentableLeaf(leaf) ? leaf : null;
}

function serializeThreadBlock(model: ICommentModel, id: string): string[] {
    const thread = model.threads.get(id);
    if (!thread)
        return [];
    const { id: _id, ...metadata } = thread;
    return serializeCommentThreadLines(id, metadata);
}

function runLines(model: ICommentModel, run: ICommentDefinitionRun): string[] {
    return run.items.flatMap(item =>
        item.kind === 'residue' ? [item.line] : serializeThreadBlock(model, item.id),
    );
}

// Compare two clean-state positions in document order.
function comparePositions(a: TBlockPath, b: TBlockPath): number {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
        if (a[i] === b[i])
            continue;
        if (typeof a[i] === 'number' && typeof b[i] === 'number')
            return (a[i] as number) - (b[i] as number);
        return String(a[i]) < String(b[i]) ? -1 : 1;
    }
    return a.length - b.length;
}

function isTextPosition(position: TBlockPath): boolean {
    return position.length >= 2 && position[position.length - 2] === 'text';
}

function resolveParentArray(states: TState[], position: TBlockPath): TState[] {
    let current: unknown = states;
    for (const segment of position.slice(0, -1)) {
        if (typeof segment === 'number') {
            if (!Array.isArray(current))
                break;
            current = current[segment];
        }
        else {
            if (typeof current !== 'object' || current == null)
                break;
            current = (current as Record<string, unknown>)[segment];
        }
    }
    if (!Array.isArray(current)) {
        // A run position pointing at a non-array parent is a stale-position
        // bug at the transform layer; fail loudly rather than lose the
        // definition lines' placement silently.
        throw new TypeError(`Comment definition run points at a missing parent: ${position.join('/')}`);
    }
    return current as TState[];
}

export function materializeCommentModel(states: TState[], model: ICommentModel): TState[] {
    const next = structuredClone(states);

    const placedThreadIds = new Set<string>();
    for (const run of model.runs) {
        for (const item of run.items) {
            if (item.kind === 'thread')
                placedThreadIds.add(item.id);
        }
    }

    const blockRuns: Array<{ run: ICommentDefinitionRun; lines: string[]; order: number }> = [];
    const appendixLines: string[] = [];
    // Marker bytes and text-embedded definition runs can share ONE leaf (a
    // definition line lazy-continues into the preceding paragraph), and both
    // carry CLEAN-text offsets — so they must splice together in one
    // descending pass per leaf. Splicing them in separate passes corrupts
    // whichever bytes the second pass lands inside.
    interface ILeafInsertion {
        offset: number;
        bytes: string;
        // Final left-to-right order at equal offsets: before-run (0) <
        // markers (1) < after-run (2). Descending splice puts the FIRST
        // spliced entry rightmost, so sort priority descending.
        priority: 0 | 1 | 2;
        seq: number;
    }
    const insertionsByLeaf = new Map<string, { position: TBlockPath; entries: ILeafInsertion[] }>();
    const leafEntries = (position: TBlockPath): ILeafInsertion[] => {
        const key = commentPathKeyOf(position);
        let bucket = insertionsByLeaf.get(key);
        if (!bucket) {
            bucket = { position, entries: [] };
            insertionsByLeaf.set(key, bucket);
        }
        return bucket.entries;
    };

    model.anchors.forEach((anchor, seq) => {
        leafEntries(anchor.position).push({
            offset: anchor.position[anchor.position.length - 1] as number,
            bytes: serializeCommentMarker(anchor.id, anchor.kind),
            priority: 1,
            seq,
        });
    });

    model.runs.forEach((run, order) => {
        const lines = runLines(model, run);
        if (lines.length === 0)
            return;
        if (run.position === null) {
            appendixLines.push(...lines);
        }
        else if (isTextPosition(run.position)) {
            const block = lines.join('\n');
            leafEntries(run.position).push({
                offset: run.position[run.position.length - 1] as number,
                bytes: run.edge === 'after' ? `\n${block}` : `${block}\n`,
                priority: run.edge === 'after' ? 2 : 0,
                seq: order,
            });
        }
        else {
            blockRuns.push({ run, lines, order });
        }
    });

    for (const { position, entries } of insertionsByLeaf.values()) {
        const leaf = readLeaf(next, position);
        if (!leaf) {
            // A position pointing at a non-leaf is a stale-position bug at
            // the transform layer; fail loudly rather than serialize a
            // document missing comment bytes.
            throw new Error(`Comment position points at a missing leaf: ${position.join('/')}`);
        }
        // Descending offset; at equal offsets higher priority splices first
        // (ends up rightmost); within a priority the later-recorded entry
        // splices first so the earlier one ends up leftmost.
        entries.sort((a, b) =>
            (b.offset - a.offset) || (b.priority - a.priority) || (b.seq - a.seq));
        let text = leaf.text;
        for (const entry of entries) {
            const offset = Math.max(0, Math.min(entry.offset, text.length));
            text = `${text.slice(0, offset)}${entry.bytes}${text.slice(offset)}`;
        }
        leaf.text = text;
    }

    // A run anchored at (or past) the root end is the trailing appendix
    // block: runtime-created threads (no run of their own) join it so the
    // appendix stays one contiguous block.
    const terminal = [...blockRuns].reverse().find(({ run }) => {
        const position = run.position!;
        return position.length === 1 && (position[0] as number) >= next.length;
    });
    const unplacedThreadLines: string[] = [];
    for (const id of model.threads.keys()) {
        if (!placedThreadIds.has(id))
            unplacedThreadLines.push(...serializeThreadBlock(model, id));
    }
    if (terminal)
        terminal.lines.push(...unplacedThreadLines);
    else
        appendixLines.push(...unplacedThreadLines);

    // Descending document order so earlier insertions cannot shift later
    // positions; ties keep run order (the later run inserts first and ends
    // up after the earlier one).
    blockRuns.sort((a, b) =>
        comparePositions(b.run.position!, a.run.position!) || (b.order - a.order));
    for (const { run, lines } of blockRuns) {
        const position = run.position!;
        const parent = resolveParentArray(next, position);
        const index = Math.max(0, Math.min(position[position.length - 1] as number, parent.length));
        parent.splice(index, 0, { name: 'paragraph', text: lines.join('\n') });
    }

    if (appendixLines.length > 0)
        next.push({ name: 'paragraph', text: appendixLines.join('\n') });

    return next;
}

// ---------------------------------------------------------------------------
// The read side: derive the same IParsedMarkdownComments shape the byte-level
// analyzer produces, from the model plus clean states. getComments, the
// sidebar, and the highlight renderer all consume this — offsets are clean-
// text offsets, so no marker arithmetic exists anywhere downstream.

interface ITextEntry {
    key: string;
    text: string;
    index: number;
    name: string;
}

function collectTextEntries(states: TState[]): Map<string, ITextEntry> {
    const entries = new Map<string, ITextEntry>();
    let index = 0;
    const walk = (nodes: TState[], path: TBlockPath) => {
        nodes.forEach((state, i) => {
            const statePath = [...path, i];
            if ('text' in state && typeof state.text === 'string') {
                const key = commentPathKey([...statePath, 'text']);
                entries.set(key, { key, text: state.text, index: index++, name: state.name });
            }
            if ('children' in state && Array.isArray(state.children))
                walk(state.children, [...statePath, 'children']);
        });
    };
    walk(states, []);
    return entries;
}

function anchorLeafKey(anchor: ICommentAnchor): string {
    return commentPathKey(anchor.position.slice(0, -1));
}

function anchorOffset(anchor: ICommentAnchor): number {
    return anchor.position[anchor.position.length - 1] as number;
}

function rangePreview(
    entries: Map<string, ITextEntry>,
    open: ICommentAnchor,
    close: ICommentAnchor,
): string {
    const startEntry = entries.get(anchorLeafKey(open));
    const endEntry = entries.get(anchorLeafKey(close));
    if (!startEntry || !endEntry || startEntry.index > endEntry.index)
        return '';

    const ordered = [...entries.values()].sort((a, b) => a.index - b.index);
    const parts: string[] = [];
    for (const entry of ordered) {
        if (entry.index < startEntry.index || entry.index > endEntry.index)
            continue;
        const from = entry.index === startEntry.index ? anchorOffset(open) : 0;
        const to = entry.index === endEntry.index ? anchorOffset(close) : entry.text.length;
        parts.push(entry.text.slice(from, to));
    }

    return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

function diagnostic(code: ICommentDiagnostic['code'], id: string, message: string): ICommentDiagnostic {
    return { code, id, message };
}

// Definition-line diagnostics are recorded once, at extraction, where the
// exact failure (decode error message, duplicate, orphan) is known — the
// view repeats them verbatim instead of re-deriving lossy approximations.
function carriedItemDiagnostics(model: ICommentModel): ICommentDiagnostic[] {
    const out: ICommentDiagnostic[] = [];
    for (const run of model.runs) {
        for (const item of run.items) {
            if (item.kind === 'residue' && !item.diagnostics) {
                // No producer emits diagnostic-less residue; accepting one
                // would silently hide what is wrong with a damaged file.
                throw new Error('A residue definition item is missing its extraction diagnostics.');
            }
            if (item.diagnostics)
                out.push(...item.diagnostics);
        }
    }
    return out;
}

export function commentModelView(model: ICommentModel, states: TState[]): IParsedMarkdownComments {
    const entries = collectTextEntries(states);
    const diagnostics: ICommentDiagnostic[] = [];
    const ranges: ICommentRange[] = [];

    // Document order for anchors is derived, not stored: transforms move
    // offsets, so sort by (leaf document index, offset, insertion order).
    const ordered = model.anchors
        .map((anchor, index) => ({ anchor, index, entry: entries.get(anchorLeafKey(anchor)) }))
        .sort((a, b) => {
            const ai = a.entry?.index ?? Number.MAX_SAFE_INTEGER;
            const bi = b.entry?.index ?? Number.MAX_SAFE_INTEGER;
            return (ai - bi) || (anchorOffset(a.anchor) - anchorOffset(b.anchor)) || (a.index - b.index);
        })
        .map(({ anchor }) => anchor);

    // Pairing is a document-order walk with the analyzer's exact semantics:
    // a duplicate open is diagnosed once and its own matching close is
    // consumed silently; a close after a completed range is duplicate-close;
    // a close with no open anywhere is orphan-close.
    const openByIds = new Map<string, ICommentAnchor>();
    const ignoredDuplicateOpens = new Map<string, number>();
    const rangeIds = new Set<string>();
    for (const anchor of ordered) {
        if (anchor.kind === 'open') {
            if (openByIds.has(anchor.id) || rangeIds.has(anchor.id)) {
                diagnostics.push(diagnostic('duplicate-open-marker', anchor.id, `Found duplicate opening marker for comment "${anchor.id}".`));
                ignoredDuplicateOpens.set(anchor.id, (ignoredDuplicateOpens.get(anchor.id) ?? 0) + 1);
                continue;
            }
            openByIds.set(anchor.id, anchor);
            continue;
        }

        const open = openByIds.get(anchor.id);
        if (!open) {
            const ignoredCount = ignoredDuplicateOpens.get(anchor.id) ?? 0;
            if (ignoredCount > 0) {
                if (ignoredCount === 1)
                    ignoredDuplicateOpens.delete(anchor.id);
                else
                    ignoredDuplicateOpens.set(anchor.id, ignoredCount - 1);
                continue;
            }
            diagnostics.push(rangeIds.has(anchor.id)
                ? diagnostic('duplicate-close-marker', anchor.id, `Found duplicate closing marker for comment "${anchor.id}".`)
                : diagnostic('orphan-close-marker', anchor.id, `Found closing comment marker for "${anchor.id}" without a matching open marker.`));
            continue;
        }

        ranges.push({
            id: anchor.id,
            startPath: open.position.slice(0, -1),
            endPath: anchor.position.slice(0, -1),
            startOffset: anchorOffset(open),
            endOffset: anchorOffset(anchor),
            preview: rangePreview(entries, open, anchor),
        });
        rangeIds.add(anchor.id);
        openByIds.delete(anchor.id);
    }
    for (const id of openByIds.keys())
        diagnostics.push(diagnostic('unclosed-open-marker', id, `Found opening comment marker for "${id}" without a matching close marker.`));

    // Malformed marker SHAPES survive in leaf text as literal residue
    // (invariant 1); diagnose them here so every reader sees them. Literal
    // contexts (code blocks etc.) keep their bytes as documentation.
    for (const entry of entries.values()) {
        if (LITERAL_COMMENT_TEXT_STATES.has(entry.name))
            continue;
        for (const malformed of malformedCommentMarkersInText(entry.text)) {
            diagnostics.push(diagnostic(
                'malformed-marker',
                malformed.id,
                `Found malformed comment ${malformed.kind} marker "${malformed.raw}".`,
            ));
        }
    }

    // Diagnostic order mirrors the analyzer's walk: marker diagnostics,
    // then the definition-line diagnostics recorded at extraction, then the
    // cross-referencing passes (missing before orphan).
    diagnostics.push(...carriedItemDiagnostics(model));

    for (const id of rangeIds) {
        if (!model.threads.has(id))
            diagnostics.push(diagnostic('missing-metadata', id, `Comment "${id}" has markers but no metadata definition.`));
    }

    const threads: ICommentThread[] = [];
    for (const [id, thread] of model.threads) {
        if (rangeIds.has(id)) {
            threads.push({
                ...thread,
                ...deriveThreadUpdatedAt(thread),
                ...deriveThreadAuthors(thread),
            });
        }
        else {
            diagnostics.push(diagnostic('orphan-metadata', id, `Comment "${id}" has metadata but no marker range.`));
        }
    }

    return { threads, ranges, diagnostics };
}

export function emptyCommentModel(): ICommentModel {
    return { threads: new Map(), anchors: [], runs: [] };
}

// A run is TERMINAL when it serializes at end-of-document: position null
// (detached/runtime appendix) or a block position at/past the clean tree's
// end. A thread with no run item at all is also appendix-bound.
function isTerminalRun(run: ICommentDefinitionRun, cleanLength: number): boolean {
    if (run.position === null)
        return true;
    return run.position.length === 1
        && typeof run.position[0] === 'number'
        && run.position[0] >= cleanLength;
}

// The trailing metadata appendix is plumbing, not content: content appended
// to the FILE below it (an agent writing to EOF) must land above it on the
// next serialization. A whole-document replace re-extracts the model from
// the new bytes, which would demote the appendix to a positioned
// mid-document run — so re-stick it: any next-model run whose items ALL
// lived in the previous model's terminal appendix (threads by id, residue
// lines verbatim; threads with no run are appendix-bound too) is retargeted
// to the new document's end. Runs with any genuinely mid-document item keep
// their extracted position — deliberate mid-document placement is content
// and stays byte-faithful.
export function restickTerminalAppendix(
    prevModel: ICommentModel,
    prevStates: TState[],
    nextModel: ICommentModel,
    nextStates: TState[],
): ICommentModel {
    const terminalThreadIds = new Set<string>();
    const terminalResidues = new Set<string>();
    const placedThreadIds = new Set<string>();
    for (const run of prevModel.runs) {
        const terminal = isTerminalRun(run, prevStates.length);
        for (const item of run.items) {
            if (item.kind === 'thread') {
                placedThreadIds.add(item.id);
                if (terminal)
                    terminalThreadIds.add(item.id);
            }
            else if (terminal) {
                terminalResidues.add(item.line);
            }
        }
    }
    for (const id of prevModel.threads.keys()) {
        if (!placedThreadIds.has(id))
            terminalThreadIds.add(id);
    }
    if (terminalThreadIds.size === 0 && terminalResidues.size === 0)
        return nextModel;

    const runs = nextModel.runs.map((run) => {
        if (isTerminalRun(run, nextStates.length))
            return run;
        const allTerminalBefore = run.items.every(item => item.kind === 'thread'
            ? terminalThreadIds.has(item.id)
            : terminalResidues.has(item.line));
        return allTerminalBefore
            ? { ...run, position: [nextStates.length] as TBlockPath, edge: 'before' as const }
            : run;
    });
    return { ...nextModel, runs };
}

export function cloneCommentThreads(threads: ICommentModel['threads']): ICommentModel['threads'] {
    return new Map([...threads].map(([id, thread]) => [id, structuredClone(thread)]));
}

export function cloneCommentModel(model: ICommentModel): ICommentModel {
    return {
        threads: new Map([...model.threads].map(([id, thread]) => [id, structuredClone(thread)])),
        anchors: model.anchors.map(anchor => ({ ...anchor, position: [...anchor.position] })),
        runs: cloneCommentRuns(model.runs),
    };
}

export function cloneCommentRuns(runs: ICommentDefinitionRun[]): ICommentDefinitionRun[] {
    return runs.map(run => ({
        position: run.position ? [...run.position] : null,
        edge: run.edge,
        items: run.items.map(item => ({ ...item })),
    }));
}

// ---------------------------------------------------------------------------
// The transform hook: every op applied to JSONState moves every anchor
// through it exactly once (invariant 3). Anchor offsets are UTF-16 units;
// ot-json1 text edits count unicode code points, so offsets convert through
// the leaf text on each side of the apply.

function utf16ToCodePoints(text: string, utf16Offset: number): number {
    return [...text.slice(0, Math.min(utf16Offset, text.length))].length;
}

function codePointsToUtf16(text: string, codePointOffset: number): number {
    let utf16 = 0;
    let count = 0;
    for (const char of text) {
        if (count >= codePointOffset)
            break;
        count += 1;
        utf16 += char.length;
    }
    return utf16;
}

// The deepest TRUE-replace component ('r' AND 'i' at one path — remove plus
// insert) in `op` whose path prefixes `path` — the rescue hook for subtree
// replacements (paragraph→heading conversion): the anchor's container was
// replaced, not deleted, so it re-anchors into the replacement's text leaf
// instead of detaching. A bare remove ('r' alone) must NOT rescue: after a
// deletion the sibling that shifts into the removed index is unrelated
// content, and re-anchoring into it would silently move the comment
// (deletion detaches — editing-invariants.md §Deletion semantics).
function findReplacePrefix(op: JSONOp, path: Array<string | number>): Array<string | number> | null {
    let result: Array<string | number> | null = null;

    const walk = (node: unknown, prefix: Array<string | number>) => {
        if (!Array.isArray(node))
            return;
        const pre = [...prefix];
        for (const item of node) {
            if (typeof item === 'string' || typeof item === 'number') {
                pre.push(item);
                // Once the descent diverges from the anchor's path, nothing
                // deeper can prefix it.
                if (pre.length > path.length || path[pre.length - 1] !== item)
                    return;
                continue;
            }
            if (Array.isArray(item)) {
                walk(item, pre);
                continue;
            }
            if (
                item && typeof item === 'object'
                && 'r' in (item as Record<string, unknown>)
                && 'i' in (item as Record<string, unknown>)
            ) {
                if (!result || pre.length > result.length)
                    result = [...pre];
            }
        }
    };
    walk(op, []);
    return result;
}

// Length (in code points) of a text insertion landing at exactly `cpOffset`
// of the leaf at `leafPath`, or 0. Used for the close-anchor tie-break: a
// character typed at the END of a commented range belongs inside it, but
// transformPosition keeps positions left of an equal-offset insertion.
function textInsertionLengthAt(op: JSONOp, leafPath: Array<string | number>, cpOffset: number): number {
    let result = 0;

    const scanTextOp = (parts: unknown[]) => {
        let docPos = 0;
        for (const part of parts) {
            if (typeof part === 'number') {
                docPos += part;
                if (docPos > cpOffset)
                    return;
            }
            else if (typeof part === 'string') {
                if (docPos === cpOffset) {
                    result = [...part].length;
                    return;
                }
            }
            else if (part && typeof part === 'object' && 'd' in (part as Record<string, unknown>)) {
                const d = (part as { d: string | number }).d;
                docPos += typeof d === 'string' ? [...d].length : d;
                if (docPos > cpOffset)
                    return;
            }
        }
    };

    const walk = (node: unknown, prefix: Array<string | number>) => {
        if (!Array.isArray(node))
            return;
        const pre = [...prefix];
        for (const item of node) {
            if (typeof item === 'string' || typeof item === 'number') {
                pre.push(item);
                if (pre.length > leafPath.length || leafPath[pre.length - 1] !== item)
                    return;
                continue;
            }
            if (Array.isArray(item)) {
                walk(item, pre);
                continue;
            }
            if (item && typeof item === 'object' && pre.length === leafPath.length) {
                const record = item as Record<string, unknown>;
                if (Array.isArray(record.es))
                    scanTextOp(record.es as unknown[]);
                else if (record.et === 'text-unicode' && Array.isArray(record.e))
                    scanTextOp(record.e as unknown[]);
            }
        }
    };
    walk(op, []);
    return result;
}

function transformAnchorPosition(
    anchor: ICommentAnchor,
    op: JSONOp,
    beforeStates: TState[],
    afterStates: TState[],
): TBlockPath | null {
    const beforeLeaf = readLeaf(beforeStates, anchor.position);
    if (!beforeLeaf)
        return null;

    const utf16 = anchor.position[anchor.position.length - 1] as number;
    const codePointPosition = [
        ...anchor.position.slice(0, -1),
        utf16ToCodePoints(beforeLeaf.text, utf16),
    ];

    const transformed = json1.type.transformPosition(
        codePointPosition as Parameters<typeof json1.type.transformPosition>[0],
        op,
    ) as Array<string | number> | null;

    if (transformed == null) {
        const replacedAt = findReplacePrefix(op, codePointPosition);
        if (!replacedAt)
            return null;
        const rescued = readLeaf(afterStates, [...replacedAt, 'text', 0]);
        if (!rescued)
            return null;
        return [...replacedAt, 'text', Math.min(utf16, rescued.text.length)];
    }

    const afterLeaf = readLeaf(afterStates, transformed as TBlockPath);
    if (!afterLeaf)
        return null;

    let cpTransformed = transformed[transformed.length - 1] as number;
    if (anchor.kind === 'close') {
        const samePath = transformed.length === codePointPosition.length
            && transformed.slice(0, -1).every((seg, i) => codePointPosition[i] === seg);
        const cpBefore = codePointPosition[codePointPosition.length - 1] as number;
        if (samePath && cpTransformed === cpBefore)
            cpTransformed += textInsertionLengthAt(op, transformed.slice(0, -1), cpBefore);
    }

    return [
        ...transformed.slice(0, -1),
        codePointsToUtf16(afterLeaf.text, cpTransformed),
    ];
}

// Move a definition run's position through `op`. Text-embedded runs reuse
// the anchor transform (a 'before' run behaves like an open anchor, an
// 'after' run like a close — trailing runs absorb insertions at the leaf
// end); block runs go through transformPosition directly. null → the run
// detaches to the trailing appendix.
function transformRunPosition(
    run: ICommentDefinitionRun,
    op: JSONOp,
    beforeStates: TState[],
    afterStates: TState[],
): TBlockPath | null {
    const position = run.position;
    if (position === null)
        return null;

    if (isTextPosition(position)) {
        return transformAnchorPosition(
            { id: '', kind: run.edge === 'after' ? 'close' : 'open', position },
            op,
            beforeStates,
            afterStates,
        );
    }

    return json1.type.transformPosition(
        position as Parameters<typeof json1.type.transformPosition>[0],
        op,
    ) as TBlockPath | null;
}

// Range destruction is thread-level: a deletion that collapses the pair or
// removes either endpoint's container deletes BOTH anchors AND the thread
// (undo restores them from the history snapshot), so serialization never
// writes a half-paired marker (invariant 5) and never leaves orphaned
// metadata behind for text that no longer exists.
export function transformCommentAnchors(
    model: ICommentModel,
    op: JSONOp,
    beforeStates: TState[],
    afterStates: TState[],
): ICommentModel {
    if (op == null)
        return model;
    if (model.anchors.length === 0 && !model.runs.some(run => run.position !== null))
        return model;

    const runs = model.runs.map(run => run.position === null
        ? run
        : { ...run, position: transformRunPosition(run, op, beforeStates, afterStates) });

    const transformed: ICommentAnchor[] = [];
    const deletedIds = new Set<string>();
    for (const anchor of model.anchors) {
        const position = transformAnchorPosition(anchor, op, beforeStates, afterStates);
        if (position)
            transformed.push({ ...anchor, position });
        else
            deletedIds.add(anchor.id);
    }

    // A deletion that swallowed the whole range collapses both anchors onto
    // one point; an invisible empty marker pair helps no one, so the pair
    // detaches (undo restores it from the history snapshot). Detachment is
    // scoped to the COLLAPSING op: a pair that was already zero-width before
    // the transform (loaded from a file) is untouched content, not a
    // deletion casualty — detaching it would degrade the document on the
    // first unrelated edit.
    const collapsedBefore = new Set<string>();
    const beforeById = new Map<string, ICommentAnchor[]>();
    for (const anchor of model.anchors) {
        const list = beforeById.get(anchor.id) ?? [];
        list.push(anchor);
        beforeById.set(anchor.id, list);
    }
    for (const [id, pair] of beforeById) {
        const open = pair.find(anchor => anchor.kind === 'open');
        const close = pair.find(anchor => anchor.kind === 'close');
        if (open && close && commentPathKey(open.position) === commentPathKey(close.position))
            collapsedBefore.add(id);
    }

    const byId = new Map<string, ICommentAnchor[]>();
    for (const anchor of transformed) {
        const list = byId.get(anchor.id) ?? [];
        list.push(anchor);
        byId.set(anchor.id, list);
    }
    // A deletion that DESTROYS the range deletes the THREAD, not just the
    // anchors: whether the pair collapsed (its text fully swallowed) or an
    // endpoint's container was deleted (the range can no longer bracket
    // text), leaving orphaned metadata behind would litter the document
    // with a comment on nothing — undo restores thread and range together
    // from the history snapshot. Shrinks (both endpoints survive) keep the
    // comment; rescue handles true replaces before it comes to this.
    for (const [id, pair] of byId) {
        if (collapsedBefore.has(id))
            continue;
        const open = pair.find(anchor => anchor.kind === 'open');
        const close = pair.find(anchor => anchor.kind === 'close');
        if (open && close && commentPathKey(open.position) === commentPathKey(close.position))
            deletedIds.add(id);
    }

    return pruneDeletedThreads(model, transformed, runs, deletedIds);
}

// Drop every trace of the deleted threads: anchors, the threads entries, and
// their definition-run items (a run left empty disappears with them).
function pruneDeletedThreads(
    model: ICommentModel,
    anchors: ICommentAnchor[],
    runs: ICommentDefinitionRun[],
    deletedIds: Set<string>,
): ICommentModel {
    if (deletedIds.size === 0)
        return { ...model, runs, anchors };

    return {
        ...model,
        threads: new Map([...model.threads].filter(([id]) => !deletedIds.has(id))),
        runs: runs
            .map(run => ({
                ...run,
                items: run.items.filter(
                    item => !(item.kind === 'thread' && deletedIds.has(item.id)),
                ),
            }))
            .filter(run => run.items.length > 0),
        anchors: anchors.filter(anchor => !deletedIds.has(anchor.id)),
    };
}

// Structural equality over the whole model — cheap enough for boundary
// decisions (models are small relative to documents).
export function commentModelEquals(a: ICommentModel, b: ICommentModel): boolean {
    const key = (model: ICommentModel) => JSON.stringify({
        threads: [...model.threads.entries()],
        anchors: model.anchors,
        runs: model.runs,
    });
    return key(a) === key(b);
}

// Shift anchors for a raw text insertion into one leaf (UTF-16 units) —
// the same tie-breaks the transform hook applies: an insertion at an
// anchor's own offset lands inside the range (close shifts, open stays).
// Text-embedded definition runs in the same leaf shift with the same rules
// ('after' behaves like close, 'before' like open).
export function adjustAnchorsForInsertion(
    model: ICommentModel,
    leafPath: TBlockPath,
    offset: number,
    length: number,
): ICommentModel {
    const leafKey = commentPathKey(leafPath);
    const shiftPosition = (position: TBlockPath, closeLike: boolean): TBlockPath => {
        const positionOffset = position[position.length - 1] as number;
        const shifted = positionOffset > offset || (positionOffset === offset && closeLike);
        return shifted
            ? [...position.slice(0, -1), positionOffset + length]
            : position;
    };
    return {
        ...model,
        anchors: model.anchors.map((anchor) => {
            if (commentPathKey(anchor.position.slice(0, -1)) !== leafKey)
                return anchor;
            const position = shiftPosition(anchor.position, anchor.kind === 'close');
            return position === anchor.position ? anchor : { ...anchor, position };
        }),
        runs: model.runs.map((run) => {
            if (
                run.position === null
                || !isTextPosition(run.position)
                || commentPathKey(run.position.slice(0, -1)) !== leafKey
            ) {
                return run;
            }
            const position = shiftPosition(run.position, run.edge === 'after');
            return position === run.position ? run : { ...run, position };
        }),
    };
}
