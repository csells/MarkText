import type { JSONOp } from 'ot-json1';
import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentDiagnostic, ICommentRange, ICommentThread, IParsedMarkdownComments } from './types';
import * as json1 from 'ot-json1';
import { realCommentMarkersInText } from './markerScan';
import {
    decodeCommentHeadPayload,
    decodeCommentReplyPayload,
    deriveThreadAuthors,
    deriveThreadUpdatedAt,
    serializeCommentThreadLines,
} from './metadata';
import { commentPathKey } from './range';
import {
    isValidCommentId,
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
    = | { kind: 'thread'; id: string }
        | { kind: 'residue'; line: string };

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

    // Resolve definition lines exactly like the file-level analyzer: first
    // decodable head per id wins, replies attach by id in document order,
    // everything else survives verbatim as residue. Each record resolves to
    // its run item — a decoded reply contributes no item of its own (its
    // bytes re-emit inside the thread block at the head's run).
    const threads = new Map<string, ICommentThread>();
    const itemByRecord = new Map<IDefinitionLineRecord, TCommentDefinitionItem | null>();
    const replyRecords: Array<{ record: IDefinitionLineRecord; id: string; payload: string }> = [];

    for (const run of pendingRuns) {
        for (const record of run.records) {
            const reply = parseCommentReplyDefinition(record.line);
            if (reply) {
                replyRecords.push({ record, id: reply.id, payload: reply.payload });
                continue;
            }

            const head = parseCommentHeadDefinition(record.line);
            if (head && !threads.has(head.id)) {
                try {
                    threads.set(head.id, { id: head.id, ...decodeCommentHeadPayload(head.payload) });
                    itemByRecord.set(record, { kind: 'thread', id: head.id });
                    continue;
                }
                catch {
                    // Undecodable head: fall through to residue.
                }
            }

            itemByRecord.set(record, { kind: 'residue', line: record.line });
        }
    }

    for (const { record, id, payload } of replyRecords) {
        const thread = threads.get(id);
        if (!thread) {
            itemByRecord.set(record, { kind: 'residue', line: record.line });
            continue;
        }
        try {
            thread.replies.push(decodeCommentReplyPayload(payload));
            itemByRecord.set(record, null);
        }
        catch {
            itemByRecord.set(record, { kind: 'residue', line: record.line });
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

    return { states: cleanStates, model: { threads, anchors, runs } };
}

function commentPathKeyOf(position: TBlockPath): string {
    return commentPathKey(position.slice(0, -1));
}

// Splice marker bytes back into a leaf's text. Descending offset order, and
// at equal offsets the later-recorded marker splices first so the earlier
// one ends up leftmost — reproducing the original byte order of adjacent
// markers.
function materializeLeafText(text: string, leafAnchors: ICommentAnchor[]): string {
    const insertions = leafAnchors
        .map((anchor, index) => ({
            offset: anchor.position[anchor.position.length - 1] as number,
            bytes: serializeCommentMarker(anchor.id, anchor.kind),
            index,
        }))
        .sort((a, b) => (b.offset - a.offset) || (b.index - a.index));

    let next = text;
    for (const insertion of insertions) {
        const offset = Math.max(0, Math.min(insertion.offset, next.length));
        next = `${next.slice(0, offset)}${insertion.bytes}${next.slice(offset)}`;
    }
    return next;
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

    const anchorsByLeaf = new Map<string, ICommentAnchor[]>();
    for (const anchor of model.anchors) {
        const key = commentPathKeyOf(anchor.position);
        const list = anchorsByLeaf.get(key) ?? [];
        list.push(anchor);
        anchorsByLeaf.set(key, list);
    }

    for (const leafAnchors of anchorsByLeaf.values()) {
        const leaf = readLeaf(next, leafAnchors[0].position);
        if (!leaf) {
            // An anchor pointing at a non-leaf is a stale-anchor bug at the
            // transform layer; fail loudly rather than serialize a document
            // missing marker bytes.
            throw new Error(`Comment anchor points at a missing leaf: ${leafAnchors[0].position.join('/')}`);
        }
        leaf.text = materializeLeafText(leaf.text, leafAnchors);
    }

    const placedThreadIds = new Set<string>();
    for (const run of model.runs) {
        for (const item of run.items) {
            if (item.kind === 'thread')
                placedThreadIds.add(item.id);
        }
    }

    // Text-embedded runs splice into their leaf AFTER markers are back (the
    // marker pass reads leaf offsets; block insertions below would shift
    // every deeper path, so they come last, in descending document order).
    const textRuns: Array<{ run: ICommentDefinitionRun; lines: string[] }> = [];
    const blockRuns: Array<{ run: ICommentDefinitionRun; lines: string[]; order: number }> = [];
    const appendixLines: string[] = [];
    model.runs.forEach((run, order) => {
        const lines = runLines(model, run);
        if (lines.length === 0)
            return;
        if (run.position === null)
            appendixLines.push(...lines);
        else if (isTextPosition(run.position))
            textRuns.push({ run, lines });
        else
            blockRuns.push({ run, lines, order });
    });

    textRuns.sort((a, b) => comparePositions(b.run.position!, a.run.position!));
    for (const { run, lines } of textRuns) {
        const position = run.position!;
        const leaf = readLeaf(next, position);
        if (!leaf)
            throw new Error(`Comment definition run points at a missing leaf: ${position.join('/')}`);
        const offset = Math.max(0, Math.min(position[position.length - 1] as number, leaf.text.length));
        const block = lines.join('\n');
        leaf.text = run.edge === 'after'
            ? `${leaf.text.slice(0, offset)}\n${block}${leaf.text.slice(offset)}`
            : `${leaf.text.slice(0, offset)}${block}\n${leaf.text.slice(offset)}`;
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
}

function collectTextEntries(states: TState[]): Map<string, ITextEntry> {
    const entries = new Map<string, ITextEntry>();
    let index = 0;
    const walk = (nodes: TState[], path: TBlockPath) => {
        nodes.forEach((state, i) => {
            const statePath = [...path, i];
            if ('text' in state && typeof state.text === 'string') {
                const key = commentPathKey([...statePath, 'text']);
                entries.set(key, { key, text: state.text, index: index++ });
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

// Residue lines re-derive the byte-level diagnostic they carried at load, so
// the sidebar keeps showing what is wrong with a damaged file.
function residueDiagnostic(line: string, threads: ICommentModel['threads']): ICommentDiagnostic {
    const reply = parseCommentReplyDefinition(line);
    if (reply) {
        if (!threads.has(reply.id))
            return diagnostic('orphan-reply', reply.id, `Found reply line for comment "${reply.id}" without a head metadata line.`);
        return diagnostic('invalid-reply', reply.id, `A reply line for comment "${reply.id}" is invalid.`);
    }

    const definition = parseCommentMetadataDefinition(line);
    const id = definition?.id ?? '__unknown__';
    if (definition && isValidCommentId(definition.id) && threads.has(definition.id))
        return diagnostic('duplicate-metadata', id, `Found duplicate metadata definition for comment "${id}".`);
    return diagnostic('invalid-metadata', id, `Metadata for comment "${id}" is invalid.`);
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

    const opens = new Map<string, ICommentAnchor>();
    const closes = new Map<string, ICommentAnchor>();
    for (const anchor of ordered) {
        const bucket = anchor.kind === 'open' ? opens : closes;
        if (bucket.has(anchor.id)) {
            diagnostics.push(anchor.kind === 'open'
                ? diagnostic('duplicate-open-marker', anchor.id, `Found duplicate opening marker for comment "${anchor.id}".`)
                : diagnostic('duplicate-close-marker', anchor.id, `Found duplicate closing marker for comment "${anchor.id}".`));
            continue;
        }
        bucket.set(anchor.id, anchor);
    }

    const rangeIds = new Set<string>();
    for (const [id, open] of opens) {
        const close = closes.get(id);
        if (!close) {
            diagnostics.push(diagnostic('unclosed-open-marker', id, `Found opening comment marker for "${id}" without a matching close marker.`));
            continue;
        }
        ranges.push({
            id,
            startPath: open.position.slice(0, -1),
            endPath: close.position.slice(0, -1),
            startOffset: anchorOffset(open),
            endOffset: anchorOffset(close),
            preview: rangePreview(entries, open, close),
        });
        rangeIds.add(id);
    }
    for (const id of closes.keys()) {
        if (!opens.has(id))
            diagnostics.push(diagnostic('orphan-close-marker', id, `Found closing comment marker for "${id}" without a matching open marker.`));
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

    for (const id of rangeIds) {
        if (!model.threads.has(id))
            diagnostics.push(diagnostic('missing-metadata', id, `Comment "${id}" has markers but no metadata definition.`));
    }

    for (const line of commentModelResidue(model))
        diagnostics.push(residueDiagnostic(line, model.threads));

    return { threads, ranges, diagnostics };
}

export function emptyCommentModel(): ICommentModel {
    return { threads: new Map(), anchors: [], runs: [] };
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

// The deepest replace ('r') component in `op` whose path prefixes `path` —
// the rescue hook for subtree replacements (paragraph→heading conversion):
// the anchor's container was replaced, not deleted, so it re-anchors into
// the replacement's text leaf instead of detaching.
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
            if (item && typeof item === 'object' && 'r' in (item as Record<string, unknown>)) {
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

// Detachment is thread-level: a range that lost either endpoint keeps its
// thread (metadata-only, visible as orphan-metadata) but drops BOTH anchors,
// so serialization never writes a half-paired marker (invariant 5).
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
    const detachedIds = new Set<string>();
    for (const anchor of model.anchors) {
        const position = transformAnchorPosition(anchor, op, beforeStates, afterStates);
        if (position)
            transformed.push({ ...anchor, position });
        else
            detachedIds.add(anchor.id);
    }

    // A deletion that swallowed the whole range collapses both anchors onto
    // one point; an invisible empty marker pair helps no one, so the pair
    // detaches (undo restores it from the history snapshot).
    const byId = new Map<string, ICommentAnchor[]>();
    for (const anchor of transformed) {
        const list = byId.get(anchor.id) ?? [];
        list.push(anchor);
        byId.set(anchor.id, list);
    }
    for (const [id, pair] of byId) {
        const open = pair.find(anchor => anchor.kind === 'open');
        const close = pair.find(anchor => anchor.kind === 'close');
        if (open && close && commentPathKey(open.position) === commentPathKey(close.position))
            detachedIds.add(id);
    }

    return {
        ...model,
        runs,
        anchors: detachedIds.size === 0
            ? transformed
            : transformed.filter(anchor => !detachedIds.has(anchor.id)),
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
