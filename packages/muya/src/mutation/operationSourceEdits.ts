import type { ICriticMarkupSourceEdit } from '../criticMarkup/trackChanges';
import type { TMarkdownStatePath, TTrackedMarkdown } from '../state/markdownSourceMap';
import type {
    ICapturedStateMutation,
    ISourceEdit,
    TStateOperationIntent,
} from '../state/mutationCapture';
import diff from 'fast-diff';
import { MappedPathIndex } from '../mapped-range';
import { localOffset, sourceRange } from '../mappedText';
import { markdownStatePath } from '../state/markdownSourceMap';
import { textOperationSourceEdits } from '../state/mutationCapture';
import { diffToTextOp } from '../utils';

interface ITextAtom {
    text: string;
    originalIndex: number | null;
}

type TTextIntent = Extract<TStateOperationIntent, { kind: 'text-edit' }>;

export interface ITextIntentGroup {
    path: TMarkdownStatePath;
    intents: TTextIntent[];
}

/** Group text intents by canonical structural path identity. */
export function textIntentGroups(
    intents: readonly TTextIntent[],
): ITextIntentGroup[] {
    const groups = new MappedPathIndex<
        TMarkdownStatePath,
        ITextIntentGroup
    >();
    for (const intent of intents) {
        const path = markdownStatePath(intent.path);
        let group = groups.get(path);
        if (!group) {
            group = { path, intents: [] };
            groups.set(path, group);
        }
        group.intents.push(intent);
    }
    return [...groups.values()];
}

function valueAtPath(document: unknown, path: readonly (string | number)[]) {
    let value = document;
    for (const component of path) {
        if (value === null || typeof value !== 'object')
            return undefined;
        value = (value as Record<string | number, unknown>)[component];
    }
    return value;
}

function mappedTextMatchesState(
    mapped: TTrackedMarkdown,
    state: unknown,
): boolean {
    for (const span of mapped.sourceMap.spans) {
        const value = valueAtPath(state, span.path);
        if (
            typeof value !== 'string'
            || span.localEnd > value.length
            || mapped.text.slice(span.sourceStart, span.sourceEnd)
            !== value.slice(span.localStart, span.localEnd)
        ) {
            return false;
        }
    }
    return mapped.sourceMap.boundaries.every((boundary) => {
        const value = valueAtPath(state, boundary.path);
        return typeof value === 'string'
            && boundary.localOffset <= value.length;
    });
}

function atomText(atoms: readonly ITextAtom[]): string {
    return atoms.map(atom => atom.text).join('');
}

function applyIntentEdits(
    atoms: ITextAtom[],
    edits: readonly ISourceEdit[],
): ITextAtom[] {
    let result = atoms;
    for (const edit of [...edits].sort((left, right) =>
        right.oldRange.start - left.oldRange.start)) {
        const next = result.slice(0, edit.oldRange.start);
        for (let index = 0; index < edit.inserted.length; index++) {
            next.push({
                text: edit.inserted[index],
                originalIndex: null,
            });
        }
        for (let index = edit.oldRange.end; index < result.length; index++)
            next.push(result[index]);
        result = next;
    }
    return result;
}

function composedTextEdits(
    intents: readonly TTextIntent[],
): ISourceEdit[] | null {
    const first = intents[0];
    let atoms: ITextAtom[] = Array.from(
        { length: first.before.length },
        (_, originalIndex) => ({
            text: first.before[originalIndex],
            originalIndex,
        }),
    );
    for (const intent of intents) {
        if (atomText(atoms) !== intent.before)
            return null;
        atoms = applyIntentEdits(atoms, intent.edits);
        if (atomText(atoms) !== intent.after)
            return null;
    }

    const edits: ISourceEdit[] = [];
    let originalCursor = 0;
    let inserted = '';
    const flush = (end: number) => {
        if (inserted || end > originalCursor) {
            edits.push({
                oldRange: sourceRange(originalCursor, end),
                inserted,
            });
        }
        inserted = '';
        originalCursor = end;
    };
    for (const atom of atoms) {
        if (atom.originalIndex === null) {
            inserted += atom.text;
            continue;
        }
        if (atom.originalIndex !== originalCursor || inserted)
            flush(atom.originalIndex);
        originalCursor = atom.originalIndex + 1;
    }
    flush(first.before.length);

    return edits;
}

function exactTextSourceEdits(
    capture: ICapturedStateMutation<unknown>,
    before: TTrackedMarkdown,
): ICriticMarkupSourceEdit[] | null {
    if (!capture.intents.every(intent => intent.kind === 'text-edit'))
        return null;
    const groups = textIntentGroups(capture.intents);

    const result: ICriticMarkupSourceEdit[] = [];
    for (const { path, intents } of groups) {
        const localEdits = composedTextEdits(intents);
        if (!localEdits)
            return null;
        for (const edit of localEdits) {
            const start = before.sourceMap.localToSource(
                path,
                localOffset(edit.oldRange.start),
            );
            const end = before.sourceMap.localToSource(
                path,
                localOffset(edit.oldRange.end),
            );
            if (start === null || end === null)
                return null;
            result.push({
                oldRange: sourceRange(start, end),
                inserted: edit.inserted,
            });
        }
    }
    return result.sort((left, right) =>
        left.oldRange.start - right.oldRange.start
        || left.oldRange.end - right.oldRange.end);
}

function applySourceEdits(
    source: string,
    edits: readonly ICriticMarkupSourceEdit[],
): string {
    return [...edits]
        .sort((left, right) => right.oldRange.start - left.oldRange.start)
        .reduce((result, edit) =>
            result.slice(0, edit.oldRange.start)
            + edit.inserted
            + result.slice(edit.oldRange.end), source);
}

interface ISourceFragment {
    path: TMarkdownStatePath;
    range: ReturnType<typeof sourceRange>;
}

interface ISourceAnchor {
    before: ReturnType<typeof sourceRange>;
    after: ReturnType<typeof sourceRange>;
}

function pathStartsWith(
    path: readonly (string | number)[],
    prefix: readonly (string | number)[],
): boolean {
    return prefix.length <= path.length
        && prefix.every((component, index) => path[index] === component);
}

function shiftedArrayPath(
    path: readonly (string | number)[],
    operationPath: readonly (string | number)[],
    kind: 'insert' | 'remove',
): readonly (string | number)[] | null {
    if (!operationPath.length)
        return null;
    const index = operationPath.at(-1);
    if (typeof index !== 'number')
        return path;
    if (!Number.isInteger(index) || index < 0)
        return null;

    const parent = operationPath.slice(0, -1);
    if (!pathStartsWith(path, parent) || path.length <= parent.length)
        return path;
    const childIndex = path[parent.length];
    if (typeof childIndex !== 'number')
        return path;
    if (!Number.isInteger(childIndex) || childIndex < 0)
        return null;

    const shouldShift = kind === 'insert'
        ? childIndex >= index
        : childIndex > index;
    if (!shouldShift)
        return path;

    const shifted = [...path];
    shifted[parent.length] = childIndex + (kind === 'insert' ? 1 : -1);
    return shifted;
}

/**
 * Follow one serializer path through the draft-relative captured operations.
 * A path remains an anchor only when neither it nor an owning ancestor was
 * changed. Array siblings keep their identity while their indexes shift.
 */
function stablePathAfterCapture(
    beforePath: TMarkdownStatePath,
    intents: readonly TStateOperationIntent[],
): { supported: boolean; path: TMarkdownStatePath | null } {
    let current: readonly (string | number)[] = [...beforePath];
    let stable = true;

    for (const intent of intents) {
        const operationPath = intent.path;
        if (intent.kind === 'insert' || intent.kind === 'remove') {
            if (!operationPath.length)
                return { supported: false, path: null };
            const parent = operationPath.slice(0, -1);

            // A container's generated representation changes with its direct
            // or nested membership. Existing siblings at an insertion index
            // are shifted, not dirtied.
            if (pathStartsWith(parent, current))
                stable = false;
            if (
                intent.kind === 'remove'
                && pathStartsWith(current, operationPath)
            ) {
                stable = false;
            }

            const shifted = shiftedArrayPath(
                current,
                operationPath,
                intent.kind,
            );
            if (!shifted)
                return { supported: false, path: null };
            current = shifted;
            continue;
        }

        // Text and replacement operations dirty the target, every serialized
        // ancestor that owns it, and any old descendants they replace.
        if (
            pathStartsWith(operationPath, current)
            || pathStartsWith(current, operationPath)
        ) {
            stable = false;
        }
    }

    return {
        supported: true,
        path: stable ? markdownStatePath(current) : null,
    };
}

function fragmentsByPath(
    fragments: readonly ISourceFragment[],
): MappedPathIndex<TMarkdownStatePath, ISourceFragment[]> {
    const result = new MappedPathIndex<
        TMarkdownStatePath,
        ISourceFragment[]
    >();
    for (const fragment of fragments) {
        const group = result.get(fragment.path) ?? [];
        group.push(fragment);
        result.set(fragment.path, group);
    }
    return result;
}

function nodeFragments(mapped: TTrackedMarkdown): ISourceFragment[] {
    return mapped.sourceMap.nodes.map(node => ({
        path: node.path,
        range: sourceRange(node.sourceStart, node.sourceEnd),
    }));
}

function spanFragments(mapped: TTrackedMarkdown): ISourceFragment[] {
    return mapped.sourceMap.spans.map(span => ({
        path: span.path,
        range: sourceRange(span.sourceStart, span.sourceEnd),
    }));
}

function pairedFragmentAnchors(
    capture: ICapturedStateMutation<unknown>,
    beforeMapped: TTrackedMarkdown,
    afterMapped: TTrackedMarkdown,
    beforeFragments: readonly ISourceFragment[],
    afterFragments: readonly ISourceFragment[],
): ISourceAnchor[] | null {
    const beforeByPath = fragmentsByPath(beforeFragments);
    const afterByPath = fragmentsByPath(afterFragments);
    const anchors: ISourceAnchor[] = [];

    for (const [beforePath, beforeGroup] of beforeByPath.entries()) {
        const transformed = stablePathAfterCapture(
            beforePath,
            capture.intents,
        );
        if (!transformed.supported)
            return null;
        if (!transformed.path)
            continue;

        const afterGroup = afterByPath.get(transformed.path);
        if (!afterGroup || afterGroup.length !== beforeGroup.length)
            continue;

        for (let index = 0; index < beforeGroup.length; index++) {
            const before = beforeGroup[index].range;
            const after = afterGroup[index].range;
            if (
                before.start === before.end
                || after.start === after.end
                || beforeMapped.text.slice(before.start, before.end)
                !== afterMapped.text.slice(after.start, after.end)
            ) {
                continue;
            }
            anchors.push({ before, after });
        }
    }

    return anchors;
}

function recursiveSourceAnchors(
    capture: ICapturedStateMutation<unknown>,
    beforeMapped: TTrackedMarkdown,
    afterMapped: TTrackedMarkdown,
): ISourceAnchor[] | null {
    const nodeAnchors = pairedFragmentAnchors(
        capture,
        beforeMapped,
        afterMapped,
        nodeFragments(beforeMapped),
        nodeFragments(afterMapped),
    );
    const spanAnchors = pairedFragmentAnchors(
        capture,
        beforeMapped,
        afterMapped,
        spanFragments(beforeMapped),
        spanFragments(afterMapped),
    );
    if (!nodeAnchors || !spanAnchors)
        return null;

    const candidates = [...nodeAnchors, ...spanAnchors]
        .sort((left, right) =>
            left.before.start - right.before.start
            || right.before.end - left.before.end
            || left.after.start - right.after.start
            || right.after.end - left.after.end);
    const anchors: ISourceAnchor[] = [];
    let beforeEnd = 0;
    let afterEnd = 0;
    for (const candidate of candidates) {
        // Prefer the outermost unchanged owner at a source position. Nested
        // nodes and leaf spans then cannot split or overlap that hard anchor.
        if (candidate.before.start < beforeEnd)
            continue;
        if (candidate.after.start < afterEnd)
            return null;
        anchors.push(candidate);
        beforeEnd = candidate.before.end;
        afterEnd = candidate.after.end;
    }

    return anchors;
}

function diffSourceIsland(
    beforeMapped: TTrackedMarkdown,
    afterMapped: TTrackedMarkdown,
    beforeRange: ReturnType<typeof sourceRange>,
    afterRange: ReturnType<typeof sourceRange>,
): ICriticMarkupSourceEdit[] {
    const beforeText = beforeMapped.text.slice(
        beforeRange.start,
        beforeRange.end,
    );
    const afterText = afterMapped.text.slice(
        afterRange.start,
        afterRange.end,
    );

    return textOperationSourceEdits(
        beforeText,
        diffToTextOp(diff(beforeText, afterText)),
    ).map(edit => ({
        oldRange: sourceRange(
            edit.oldRange.start + beforeRange.start,
            edit.oldRange.end + beforeRange.start,
        ),
        inserted: edit.inserted,
    }));
}

function scopedStructuralEdits(
    capture: ICapturedStateMutation<unknown>,
    beforeMapped: TTrackedMarkdown,
    afterMapped: TTrackedMarkdown,
): ICriticMarkupSourceEdit[] | null {
    const anchors = recursiveSourceAnchors(
        capture,
        beforeMapped,
        afterMapped,
    );
    if (!anchors)
        return null;

    const edits: ICriticMarkupSourceEdit[] = [];
    let beforeStart = 0;
    let afterStart = 0;
    for (const anchor of [
        ...anchors,
        {
            before: sourceRange(
                beforeMapped.text.length,
                beforeMapped.text.length,
            ),
            after: sourceRange(
                afterMapped.text.length,
                afterMapped.text.length,
            ),
        },
    ]) {
        for (const edit of diffSourceIsland(
            beforeMapped,
            afterMapped,
            sourceRange(beforeStart, anchor.before.start),
            sourceRange(afterStart, anchor.after.start),
        )) {
            edits.push(edit);
        }
        beforeStart = anchor.before.end;
        afterStart = anchor.after.end;
    }
    return edits;
}

/** Derive source edits only from paths and islands proven by captured ops. */
export function deriveOperationSourceEdits(
    capture: ICapturedStateMutation<unknown>,
    beforeMapped: TTrackedMarkdown,
    afterMapped: TTrackedMarkdown,
): ICriticMarkupSourceEdit[] | null {
    if (
        !mappedTextMatchesState(beforeMapped, capture.beforeState)
        || !mappedTextMatchesState(afterMapped, capture.afterState)
    ) {
        return null;
    }

    const exactText = exactTextSourceEdits(capture, beforeMapped);
    if (
        exactText
        && applySourceEdits(beforeMapped.text, exactText) === afterMapped.text
    ) {
        return exactText;
    }

    const scoped = scopedStructuralEdits(
        capture,
        beforeMapped,
        afterMapped,
    );
    if (!scoped || applySourceEdits(beforeMapped.text, scoped) !== afterMapped.text)
        return null;

    return scoped;
}
