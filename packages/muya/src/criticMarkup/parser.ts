import type { IExcludedRange } from './excludedRanges';
import type {
    TCriticMarkupMarkerName,
    TCriticMarkupType,
} from './reviewContract';
import { ExcludedRanges } from './excludedRanges';

export type ICriticMarkupRange = IExcludedRange;

export interface ICriticMarkupMarker {
    readonly raw: string;
    readonly range: Readonly<ICriticMarkupRange>;
}

/** Minimal grammar identity needed to decode one serialized payload slice. */
export interface ICriticMarkupPayloadEscapeOwner {
    readonly type: TCriticMarkupType;
    readonly markers: Readonly<{
        close: Readonly<{ raw: string }>;
    }>;
}

export type TCriticMarkupContentType
    = | 'addition'
        | 'deletion'
        | 'highlight'
        | 'comment';

export interface ICriticMarkupContentToken {
    readonly type: TCriticMarkupContentType;
    readonly raw: string;
    readonly content: string;
    readonly range: Readonly<ICriticMarkupRange>;
    readonly contentRange: Readonly<ICriticMarkupRange>;
    readonly markers: {
        readonly open: ICriticMarkupMarker;
        readonly close: ICriticMarkupMarker;
    };
    readonly nested?: readonly TCriticMarkupToken[];
}

export interface ICriticMarkupSubstitutionToken {
    readonly type: 'substitution';
    readonly raw: string;
    readonly oldContent: string;
    readonly newContent: string;
    readonly range: Readonly<ICriticMarkupRange>;
    readonly oldRange: Readonly<ICriticMarkupRange>;
    readonly newRange: Readonly<ICriticMarkupRange>;
    readonly markers: {
        readonly open: ICriticMarkupMarker;
        readonly separator: ICriticMarkupMarker;
        readonly close: ICriticMarkupMarker;
    };
    readonly nested?: readonly TCriticMarkupToken[];
}

export type TCriticMarkupToken
    = | ICriticMarkupContentToken
        | ICriticMarkupSubstitutionToken;

export type TCriticMarkupDraft
    = | {
        type: TCriticMarkupContentType;
        content: string;
    }
    | {
        type: 'substitution';
        oldContent: string;
        newContent: string;
    };

export interface ICriticMarkupDraftOpaqueContext {
    /** Opaque ranges are relative to the corresponding draft payload. */
    content?: ExcludedRanges;
    oldContent?: ExcludedRanges;
    newContent?: ExcludedRanges;
}

interface ICriticMarkupSyntax {
    type: TCriticMarkupToken['type'];
    open: string;
    close: string;
}

interface ICriticMarkupFrame {
    syntax: ICriticMarkupSyntax;
    start: number;
    separators: number[];
    nested: ICriticMarkupTokenSequence;
}

interface ICriticMarkupTokenLink {
    readonly token: TCriticMarkupToken;
    next: ICriticMarkupTokenLink | null;
}

interface ICriticMarkupTokenSequence {
    head: ICriticMarkupTokenLink | null;
    tail: ICriticMarkupTokenLink | null;
    length: number;
}

function createTokenSequence(): ICriticMarkupTokenSequence {
    return { head: null, tail: null, length: 0 };
}

function assertTokenOrder(
    previous: TCriticMarkupToken | undefined,
    next: TCriticMarkupToken,
): void {
    if (previous && previous.range.end > next.range.start) {
        throw new RangeError(
            'CriticMarkup parser produced overlapping or out-of-order sibling tokens.',
        );
    }
}

function appendToken(
    target: ICriticMarkupTokenSequence,
    token: TCriticMarkupToken,
): void {
    assertTokenOrder(target.tail?.token, token);
    const link: ICriticMarkupTokenLink = { token, next: null };
    if (target.tail)
        target.tail.next = link;
    else
        target.head = link;
    target.tail = link;
    target.length++;
}

/** Transfer a malformed frame's completed children without copying them. */
function spliceTokenSequence(
    target: ICriticMarkupTokenSequence,
    source: ICriticMarkupTokenSequence,
): void {
    if (!source.head)
        return;
    assertTokenOrder(target.tail?.token, source.head.token);
    if (target.tail)
        target.tail.next = source.head;
    else
        target.head = source.head;
    target.tail = source.tail;
    target.length += source.length;
    source.head = null;
    source.tail = null;
    source.length = 0;
}

function materializeTokenSequence(
    source: ICriticMarkupTokenSequence,
): TCriticMarkupToken[] {
    const tokens: TCriticMarkupToken[] = [];
    let link = source.head;
    for (let index = 0; index < source.length; index++) {
        if (!link) {
            throw new TypeError(
                'CriticMarkup token sequence ended before its declared length.',
            );
        }
        tokens[index] = link.token;
        link = link.next;
    }
    if (link) {
        throw new TypeError(
            'CriticMarkup token sequence exceeds its declared length.',
        );
    }
    return tokens;
}

const CONTENT_SYNTAXES: readonly ICriticMarkupSyntax[] = [
    { type: 'addition', open: '{++', close: '++}' },
    { type: 'deletion', open: '{--', close: '--}' },
    { type: 'highlight', open: '{==', close: '==}' },
    { type: 'comment', open: '{>>', close: '<<}' },
];

const SUBSTITUTION_OPEN = '{~~';
const SUBSTITUTION_SEPARATOR = '~>';
const SUBSTITUTION_CLOSE = '~~}';
const SYNTAXES: readonly ICriticMarkupSyntax[] = [
    ...CONTENT_SYNTAXES,
    {
        type: 'substitution',
        open: SUBSTITUTION_OPEN,
        close: SUBSTITUTION_CLOSE,
    },
];

/** Canonical marker spelling owned by the grammar, including substitutions. */
export function criticMarkupMarkerRaw(
    type: TCriticMarkupType,
    marker: TCriticMarkupMarkerName,
): string {
    const syntax = SYNTAXES.find(candidate => candidate.type === type);
    if (!syntax) {
        throw new TypeError(
            `Unknown CriticMarkup marker type: ${String(type)}.`,
        );
    }
    if (marker === 'open')
        return syntax.open;
    if (marker === 'close')
        return syntax.close;
    if (type === 'substitution' && marker === 'separator')
        return SUBSTITUTION_SEPARATOR;
    throw new TypeError(
        `CriticMarkup ${type} does not own a ${marker} marker.`,
    );
}

/**
 * Opaque proof that the grammar-owned opener prefilter ran for one exact
 * source value. Keeping the source binding private lets parser adapters pass
 * the result through several layers without either rescanning or trusting a
 * caller-supplied boolean.
 */
export interface ICriticMarkupCandidateIdentity {
    readonly hasCandidateOpener: boolean;
}

/**
 * Opaque, runtime-authenticated output of one CriticMarkup grammar decision.
 * The roots are exposed for projection analysis, but only the scanner can bind
 * them to their source, exclusions, and candidate proof for semantic reuse.
 */
export interface ICriticMarkupScanResult {
    readonly roots: readonly TCriticMarkupToken[];
}

export interface ICriticMarkupAuthenticatedScan {
    readonly source: string;
    readonly excludedRanges: ExcludedRanges;
    readonly candidateIdentity: ICriticMarkupCandidateIdentity;
    readonly roots: readonly TCriticMarkupToken[];
}

interface ICriticMarkupScanAuthority extends ICriticMarkupAuthenticatedScan {
    readonly excludedSourceLength: number;
    readonly excludedRangeSnapshot: readonly Readonly<IExcludedRange>[];
}

const CANDIDATE_SOURCE = new WeakMap<object, string>();
const SCAN_RESULT_AUTHORITY = new WeakMap<
    object,
    ICriticMarkupScanAuthority
>();

/**
 * Sound, allocation-free prefilter for parser adapters. False positives are
 * harmless; a false negative would skip real CriticMarkup, so escaped and
 * incomplete openers deliberately still count as candidates.
 */
export function hasCriticMarkupOpener(source: string): boolean {
    return SYNTAXES.some(({ open }) => source.includes(open));
}

export function prepareCriticMarkupCandidateIdentity(
    source: string,
): ICriticMarkupCandidateIdentity {
    const identity: ICriticMarkupCandidateIdentity = Object.freeze({
        hasCandidateOpener: hasCriticMarkupOpener(source),
    });
    CANDIDATE_SOURCE.set(identity, source);
    return identity;
}

export function assertCriticMarkupCandidateIdentity(
    identity: ICriticMarkupCandidateIdentity,
    source: string,
): void {
    if (CANDIDATE_SOURCE.get(identity) !== source) {
        throw new TypeError(
            'CriticMarkup candidate identity belongs to a different source revision.',
        );
    }
}

function deepFreezeTokenForest(
    roots: TCriticMarkupToken[],
): readonly TCriticMarkupToken[] {
    const pending: object[] = [roots];
    const seen = new WeakSet<object>();

    while (pending.length) {
        const current = pending.pop()!;
        if (seen.has(current))
            continue;
        seen.add(current);
        for (const value of Object.values(current)) {
            if (value !== null && typeof value === 'object')
                pending.push(value);
        }
        Object.freeze(current);
    }

    return roots;
}

function createCriticMarkupScanResult(
    source: string,
    excludedRanges: ExcludedRanges,
    candidateIdentity: ICriticMarkupCandidateIdentity,
    roots: TCriticMarkupToken[],
): ICriticMarkupScanResult {
    excludedRanges.assertSourceLength(source.length);
    assertCriticMarkupCandidateIdentity(candidateIdentity, source);
    const frozenRoots = deepFreezeTokenForest(roots);
    const result: ICriticMarkupScanResult = Object.freeze({
        roots: frozenRoots,
    });
    SCAN_RESULT_AUTHORITY.set(result, Object.freeze({
        source,
        excludedRanges,
        candidateIdentity,
        roots: frozenRoots,
        excludedSourceLength: excludedRanges.sourceLength,
        excludedRangeSnapshot: Object.freeze(excludedRanges.ranges.map(
            range => Object.freeze({ start: range.start, end: range.end }),
        )),
    }));
    return result;
}

function exclusionsMatchAuthority(
    authority: ICriticMarkupScanAuthority,
): boolean {
    const { excludedRanges, excludedRangeSnapshot } = authority;
    return excludedRanges.sourceLength === authority.excludedSourceLength
        && excludedRanges.ranges.length === excludedRangeSnapshot.length
        && excludedRanges.ranges.every((range, index) =>
            range.start === excludedRangeSnapshot[index].start
            && range.end === excludedRangeSnapshot[index].end);
}

/**
 * Authenticate a scanner-owned result and recover its exact parser inputs.
 * Structurally similar objects and results with altered visible roots fail.
 */
export function authenticateCriticMarkupScanResult(
    result: ICriticMarkupScanResult,
): ICriticMarkupAuthenticatedScan {
    const authority = result !== null && typeof result === 'object'
        ? SCAN_RESULT_AUTHORITY.get(result)
        : undefined;
    if (
        !authority
        || result.roots !== authority.roots
        || !exclusionsMatchAuthority(authority)
    ) {
        throw new TypeError(
            'CriticMarkup analysis requires an authenticated scanner result.',
        );
    }
    assertCriticMarkupCandidateIdentity(
        authority.candidateIdentity,
        authority.source,
    );
    return authority;
}

/**
 * Materialize authenticated empty scanner output after the source-bound
 * prefilter proved that no grammar scan can produce a token.
 */
export function prepareCriticMarkupNoCandidateScanResult(
    source: string,
    excludedRanges: ExcludedRanges,
    candidateIdentity: ICriticMarkupCandidateIdentity,
): ICriticMarkupScanResult {
    assertCriticMarkupCandidateIdentity(candidateIdentity, source);
    if (candidateIdentity.hasCandidateOpener) {
        throw new TypeError(
            'Empty CriticMarkup scanner result requires no possible opener.',
        );
    }
    return createCriticMarkupScanResult(
        source,
        excludedRanges,
        candidateIdentity,
        [],
    );
}

function assertOffset(source: string, offset: number) {
    if (!Number.isInteger(offset) || offset < 0 || offset > source.length)
        throw new RangeError(`CriticMarkup offset ${offset} is outside the source.`);
}

function isEscaped(source: string, offset: number): boolean {
    let backlashCount = 0;

    for (let index = offset - 1; index >= 0 && source[index] === '\\'; index--)
        backlashCount++;

    return backlashCount % 2 === 1;
}

function createMarker(
    raw: string,
    start: number,
): ICriticMarkupMarker {
    return {
        raw,
        range: { start, end: start + raw.length },
    };
}

function createContentToken(
    source: string,
    frame: ICriticMarkupFrame,
    closeStart: number,
): ICriticMarkupContentToken {
    const { syntax, start, nested } = frame;
    const nestedTokens = materializeTokenSequence(nested);
    const contentStart = start + syntax.open.length;
    const end = closeStart + syntax.close.length;

    return {
        type: syntax.type as TCriticMarkupContentType,
        raw: source.slice(start, end),
        content: source.slice(contentStart, closeStart),
        range: { start, end },
        contentRange: { start: contentStart, end: closeStart },
        markers: {
            open: createMarker(syntax.open, start),
            close: createMarker(syntax.close, closeStart),
        },
        ...(nestedTokens.length ? { nested: nestedTokens } : {}),
    };
}

function createSubstitutionToken(
    source: string,
    frame: ICriticMarkupFrame,
    closeStart: number,
): ICriticMarkupSubstitutionToken | null {
    if (frame.separators.length !== 1)
        return null;

    const { start, nested } = frame;
    const nestedTokens = materializeTokenSequence(nested);
    const oldContentStart = start + SUBSTITUTION_OPEN.length;
    const separatorStart = frame.separators[0];
    const newContentStart = separatorStart + SUBSTITUTION_SEPARATOR.length;
    const end = closeStart + SUBSTITUTION_CLOSE.length;

    return {
        type: 'substitution',
        raw: source.slice(start, end),
        oldContent: source.slice(oldContentStart, separatorStart),
        newContent: source.slice(newContentStart, closeStart),
        range: { start, end },
        oldRange: { start: oldContentStart, end: separatorStart },
        newRange: { start: newContentStart, end: closeStart },
        markers: {
            open: createMarker(SUBSTITUTION_OPEN, start),
            separator: createMarker(SUBSTITUTION_SEPARATOR, separatorStart),
            close: createMarker(SUBSTITUTION_CLOSE, closeStart),
        },
        ...(nestedTokens.length ? { nested: nestedTokens } : {}),
    };
}

function createToken(
    source: string,
    frame: ICriticMarkupFrame,
    closeStart: number,
): TCriticMarkupToken | null {
    return frame.syntax.type === 'substitution'
        ? createSubstitutionToken(source, frame, closeStart)
        : createContentToken(source, frame, closeStart);
}

function syntaxAt(source: string, offset: number) {
    return SYNTAXES.find(({ open }) => source.startsWith(open, offset));
}

function consumeCriticMarker(
    source: string,
    index: number,
    stack: ICriticMarkupFrame[],
    roots: ICriticMarkupTokenSequence,
): number | null {
    const character = source[index];
    const frame = stack.at(-1);
    const couldBeMarker
        = character === '{'
            || character === '~'
            || character === frame?.syntax.close[0];
    if (!couldBeMarker || isEscaped(source, index))
        return null;

    const syntax = character === '{'
        ? syntaxAt(source, index)
        : undefined;
    if (syntax) {
        stack.push({
            syntax,
            start: index,
            separators: [],
            nested: createTokenSequence(),
        });
        return index + syntax.open.length;
    }

    if (frame?.syntax.type === 'substitution'
        && source.startsWith(SUBSTITUTION_SEPARATOR, index)) {
        frame.separators.push(index);
        return index + SUBSTITUTION_SEPARATOR.length;
    }

    if (!frame || !source.startsWith(frame.syntax.close, index))
        return null;

    stack.pop();
    const token = createToken(source, frame, index);
    const parent = stack.at(-1);
    if (token) {
        appendToken(parent?.nested ?? roots, token);
    }
    else {
        spliceTokenSequence(parent?.nested ?? roots, frame.nested);
    }

    return index + frame.syntax.close.length;
}

/**
 * Scan CriticMarkup once and balance nested constructs. Markdown parsing is
 * deliberately outside this grammar: its adapter supplies validated opaque
 * ranges for code, links, HTML, math, or any other higher-priority syntax.
 */
export function scanCriticMarkup(
    source: string,
    excludedRanges: ExcludedRanges = ExcludedRanges.empty(source.length),
): readonly TCriticMarkupToken[] {
    const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);
    if (!candidateIdentity.hasCandidateOpener)
        return [];

    return scanCriticMarkupCandidate(
        source,
        excludedRanges,
        candidateIdentity,
    ).roots;
}

/**
 * Scan a source already proven to contain a possible Critic opener. Parser
 * adapters use this entry after their one revision-level prefilter so a
 * conditional final scan does not repeat the O(source) candidate search.
 */
export function scanCriticMarkupCandidate(
    source: string,
    excludedRanges: ExcludedRanges,
    candidateIdentity: ICriticMarkupCandidateIdentity,
): ICriticMarkupScanResult {
    assertCriticMarkupCandidateIdentity(candidateIdentity, source);
    if (!candidateIdentity.hasCandidateOpener) {
        throw new TypeError(
            'CriticMarkup candidate scan requires a possible opener.',
        );
    }
    excludedRanges.assertSourceLength(source.length);

    const roots = createTokenSequence();
    const stack: ICriticMarkupFrame[] = [];
    const excludedCursor = excludedRanges.forwardCursor();

    for (let index = 0; index < source.length;) {
        const excludedEnd = excludedCursor.endAt(index);
        if (excludedEnd !== undefined) {
            index = excludedEnd;
            continue;
        }

        const markerEnd = consumeCriticMarker(source, index, stack, roots);
        if (markerEnd !== null) {
            index = markerEnd;
            continue;
        }

        index++;
    }

    while (stack.length) {
        const frame = stack.pop()!;
        const parent = stack.at(-1);
        spliceTokenSequence(parent?.nested ?? roots, frame.nested);
    }

    const rootTokens = materializeTokenSequence(roots);
    return createCriticMarkupScanResult(
        source,
        excludedRanges,
        candidateIdentity,
        rootTokens,
    );
}

function findTokenAt(
    tokens: readonly TCriticMarkupToken[],
    offset: number,
): TCriticMarkupToken | null {
    const pending = [...tokens].reverse();

    while (pending.length) {
        const token = pending.pop()!;
        if (token.range.start === offset)
            return token;

        if (token.nested) {
            for (let index = token.nested.length - 1; index >= 0; index--)
                pending.push(token.nested[index]);
        }
    }

    return null;
}

/** Parse one CriticMarkup construct beginning exactly at `offset`. */
export function parseCriticMarkupAt(
    source: string,
    offset: number,
    excludedRanges: ExcludedRanges = ExcludedRanges.empty(source.length),
): TCriticMarkupToken | null {
    assertOffset(source, offset);

    return findTokenAt(scanCriticMarkup(source, excludedRanges), offset);
}

/** Find the next complete CriticMarkup construct at or after `from`. */
export function findNextCriticMarkupOffset(
    source: string,
    from = 0,
    excludedRanges: ExcludedRanges = ExcludedRanges.empty(source.length),
): number {
    assertOffset(source, from);

    excludedRanges.assertSourceLength(source.length);
    const relativeRanges = ExcludedRanges.from(
        source.length - from,
        excludedRanges.ranges
            .filter(range => range.end > from)
            .map(range => ({
                start: Math.max(range.start, from) - from,
                end: range.end - from,
            })),
    );
    const token = scanCriticMarkup(source.slice(from), relativeRanges)[0];

    return token ? token.range.start + from : -1;
}

function escapeCriticMarkupPayload(
    payload: string,
    close: string,
    escapeSubstitutionSeparator = false,
    opaqueRanges = ExcludedRanges.empty(payload.length),
): string {
    opaqueRanges.assertSourceLength(payload.length);
    const result: string[] = [];
    const ranges = opaqueRanges.ranges;
    const closePrefix = close.slice(0, -1);
    let opaqueIndex = 0;
    let literalStart = 0;

    const replace = (start: number, end: number, replacement: string) => {
        if (literalStart < start)
            result.push(payload.slice(literalStart, start));
        result.push(replacement);
        literalStart = end;
    };

    for (let index = 0; index < payload.length;) {
        while (ranges[opaqueIndex]?.end <= index)
            opaqueIndex++;
        const opaque = ranges[opaqueIndex];
        if (opaque && opaque.start <= index) {
            index = opaque.end;
            continue;
        }
        const lookaheadEnd = opaque?.start ?? payload.length;

        let targetStart = index;
        while (
            targetStart < lookaheadEnd
            && payload[targetStart] === '\\'
        ) {
            targetStart++;
        }
        const slashCount = targetStart - index;
        const opening = syntaxAt(payload, targetStart);
        const target = opening?.open
            ?? (escapeSubstitutionSeparator
                && payload.startsWith(SUBSTITUTION_SEPARATOR, targetStart)
                ? SUBSTITUTION_SEPARATOR
                : null);
        if (
            target
            && targetStart + target.length <= lookaheadEnd
        ) {
            // Odd stored runs keep the target opaque to the scanner. Doubling
            // every user slash before adding the protective one makes the
            // encoding reversible for zero, odd, and even literal runs.
            const end = targetStart + target.length;
            replace(index, end, '\\'.repeat(slashCount * 2 + 1) + target);
            index = end;
            continue;
        }
        if (slashCount) {
            // No owned target follows this run before the next opaque range.
            // Keep it literal and consume it once instead of rescanning every
            // suffix of the same run.
            index = targetStart;
            continue;
        }

        if (
            index + closePrefix.length <= lookaheadEnd
            && payload.startsWith(closePrefix, index)
        ) {
            let brace = index + closePrefix.length;
            while (brace < lookaheadEnd && payload[brace] === '\\')
                brace++;
            if (brace < lookaheadEnd && payload[brace] === '}') {
                const literalSlashes = brace - index - closePrefix.length;
                // Escaping the final brace works for every close delimiter
                // and is compatible with the original MultiMarkdown scanner.
                const end = brace + 1;
                replace(
                    index,
                    end,
                    `${closePrefix
                    + '\\'.repeat(literalSlashes * 2 + 1)
                    }}`,
                );
                index = end;
                continue;
            }
        }

        // Advance one code unit so overlapping close prefixes such as `+++}`
        // are still recognized at the following position.
        index++;
    }

    if (literalStart < payload.length)
        result.push(payload.slice(literalStart));
    return result.join('');
}

/**
 * Decode the reversible protective escapes for one semantic token payload.
 * Delimiter and arm context stay in the grammar owner; a slash protecting a
 * substitution separator or a foreign close is never removed accidentally.
 */
export function decodeCriticMarkupPayloadEscapes(
    token: ICriticMarkupPayloadEscapeOwner,
    value: string,
): string {
    const result: string[] = [];
    const decodeSeparator = token.type === 'substitution';
    const closePrefix = token.markers.close.raw.slice(0, -1);
    let literalStart = 0;

    const replace = (start: number, end: number, replacement: string) => {
        if (literalStart < start)
            result.push(value.slice(literalStart, start));
        result.push(replacement);
        literalStart = end;
    };

    for (let index = 0; index < value.length;) {
        let targetStart = index;
        while (value[targetStart] === '\\')
            targetStart++;
        const slashCount = targetStart - index;
        const opening = syntaxAt(value, targetStart);
        const target = opening?.open
            ?? (decodeSeparator
                && value.startsWith(SUBSTITUTION_SEPARATOR, targetStart)
                ? SUBSTITUTION_SEPARATOR
                : null);
        if (target && slashCount > 0) {
            const end = targetStart + target.length;
            // Preserve the established reversible encoding: both 2k and
            // 2k+1 stored slashes before an owned target decode to k.
            replace(
                index,
                end,
                '\\'.repeat(Math.floor(slashCount / 2)) + target,
            );
            index = end;
            continue;
        }
        if (slashCount) {
            index = targetStart;
            continue;
        }
        if (target) {
            index = targetStart + target.length;
            continue;
        }

        if (value.startsWith(closePrefix, index)) {
            let brace = index + closePrefix.length;
            while (value[brace] === '\\')
                brace++;
            const encodedSlashes = brace - index - closePrefix.length;
            if (value[brace] === '}' && encodedSlashes % 2 === 1) {
                const end = brace + 1;
                replace(
                    index,
                    end,
                    `${closePrefix
                    + '\\'.repeat((encodedSlashes - 1) / 2)
                    }}`,
                );
                index = end;
                continue;
            }
            if (value[brace] === '}') {
                // An even run is literal. Consume the whole recognized form
                // once; it cannot contain another close prefix.
                index = brace + 1;
                continue;
            }
        }

        // Failed close prefixes advance one code unit to retain overlap.
        index++;
    }

    if (literalStart < value.length)
        result.push(value.slice(literalStart));
    return result.join('');
}

/** Serialize a semantic draft with the canonical grammar delimiters. */
export function serializeCriticMarkupDraft(
    draft: TCriticMarkupDraft,
    opaque: ICriticMarkupDraftOpaqueContext = {},
): string {
    if (draft.type === 'substitution') {
        const oldContent = escapeCriticMarkupPayload(
            draft.oldContent,
            SUBSTITUTION_CLOSE,
            true,
            opaque.oldContent,
        );
        const newContent = escapeCriticMarkupPayload(
            draft.newContent,
            SUBSTITUTION_CLOSE,
            true,
            opaque.newContent,
        );

        return SUBSTITUTION_OPEN
            + oldContent
            + SUBSTITUTION_SEPARATOR
            + newContent
            + SUBSTITUTION_CLOSE;
    }

    const syntax = CONTENT_SYNTAXES.find(({ type }) => type === draft.type);
    if (!syntax)
        throw new TypeError(`Unsupported CriticMarkup type: ${draft.type}`);
    return syntax.open
        + escapeCriticMarkupPayload(
            draft.content,
            syntax.close,
            false,
            opaque.content,
        )
        + syntax.close;
}
