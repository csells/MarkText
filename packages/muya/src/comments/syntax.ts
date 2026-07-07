import { escapeRegExp } from '../utils';

export const COMMENT_METADATA_DATA_URI_PREFIX = 'data:application/json;base64,';
export const COMMENT_ID_PATTERN = '\\w[\\w-]*';
export const COMMENT_MARKER_PATTERN = `<!--MC:(~?)(${COMMENT_ID_PATTERN})-->`;
const COMMENT_MARKER_LIKE_REGEXP = /^<!--MC:(~?)(.*?)-->/;
export const COMMENT_MARKER_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`);
export const COMMENT_MARKER_SEARCH_REGEXP = new RegExp(COMMENT_MARKER_PATTERN);
export const COMMENT_METADATA_DEFINITION_REGEXP = /^ {0,3}\[MC:([^\]\s]+)\]:(.*)$/u;

export type TCommentMarkerKind = 'open' | 'close';

export interface IParsedCommentMarker {
    raw: string;
    id: string;
    kind: TCommentMarkerKind;
}

// The broad definition-line shape: `[MC:<label>]: <payload>` with up to three
// leading spaces. `label` may be a plain thread id (head line), an `id.N`
// reply label, or — in damaged files — anything bracket-safe; refinement into
// head/reply happens in parseCommentHeadDefinition/parseCommentReplyDefinition.
export interface IParsedCommentMetadataDefinition {
    id: string;
    payload: string;
}

export interface IParsedCommentHeadDefinition {
    id: string;
    payload: string;
}

export interface IParsedCommentReplyDefinition {
    id: string;
    index: number;
    payload: string;
}

const COMMENT_MARKER_GLOBAL_REGEXP = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
export const LINE_LEADING_COMMENT_MARKER_REGEXP = new RegExp(`^ {0,3}${COMMENT_MARKER_PATTERN}`, 'u');

function looksLikeRawHtmlAfterCommentMarkers(text: string): boolean {
    const trimmed = text.replace(COMMENT_MARKER_GLOBAL_REGEXP, '').trim();
    if (!trimmed.startsWith('<'))
        return false;

    const next = trimmed[1];
    return (
        next === '!'
        || next === '/'
        || (next >= 'A' && next <= 'Z')
        || (next >= 'a' && next <= 'z')
    );
}

// Whether an html-classified chunk is really comment-marker-led prose (or a
// single image) that the state walk lowers to a paragraph. Shared by the
// block tokenizer override, markdownToState, and the comment source index so
// live/literal decisions can never drift.
export function htmlBlockTokenIsParagraph(text: string): boolean {
    const trimmed = text.trim();
    if (/^<img[^<>]+>$/u.test(trimmed))
        return true;
    return COMMENT_MARKER_SEARCH_REGEXP.test(trimmed) && !looksLikeRawHtmlAfterCommentMarkers(trimmed);
}

export function parseCommentMarker(src: string): IParsedCommentMarker | null {
    const match = COMMENT_MARKER_REGEXP.exec(src);
    if (!match)
        return null;

    return {
        raw: match[0],
        id: match[2],
        kind: match[1] === '~' ? 'close' : 'open',
    };
}

// The canonical byte form of a comment marker. This module is the single owner
// of the MC wire format; callers must not hand-build marker strings.
export function serializeCommentMarker(id: string, kind: TCommentMarkerKind = 'open'): string {
    return `<!--MC:${kind === 'close' ? '~' : ''}${id}-->`;
}

// The canonical byte form of a metadata reference-definition line. `dataUri` is
// the already-encoded payload (see encodeCommentMetadata).
export function serializeCommentMetadataDefinition(id: string, dataUri: string): string {
    return `[MC:${id}]: ${dataUri}`;
}

// Matches both the open and close marker for one specific id.
export function commentMarkerRegExpForId(id: string, flags = 'g'): RegExp {
    return new RegExp(`<!--MC:~?${escapeRegExp(id)}-->`, flags);
}

export function isValidCommentId(id: string): boolean {
    return new RegExp(`^${COMMENT_ID_PATTERN}$`).test(id);
}

// Content-leaf block names whose text the comment parser never scans (code
// fences and the code-like containers — frontmatter/math/html/diagram — all
// render through these leaves, plus thematic breaks): marker-shaped text
// there is LITERAL. Document walks that feed the guards below must skip
// these leaves, mirroring parse.ts's NON_INLINE_COMMENT_TEXT_STATES at the
// block level, or a fence containing "<!--MC:~id-->" as documentation would
// count as a real counterpart and falsely block edits.
// State names whose text is LITERAL for the comment grammar — markers and
// definition-shaped lines inside them are documentation, never syntax. The
// single source for every state-space derivation (parse's inline scan,
// edit's commentability check); NON_COMMENT_SCANNABLE_LEAF_BLOCKS below is
// the same fact in block-name space.
export const LITERAL_COMMENT_TEXT_STATES: ReadonlySet<string> = new Set([
    'code-block',
    'diagram',
    'frontmatter',
    'html-block',
    'math-block',
    'thematic-break',
]);

export const NON_COMMENT_SCANNABLE_LEAF_BLOCKS: ReadonlySet<string> = new Set([
    'codeblock.content',
    'language-input',
    'thematicbreak.content',
]);

// Would removing `removedTexts` while `survivingTexts` remain leave a comment
// with only one of its paired markers? A removed open marker whose close still
// survives (or vice versa) orphans the range. When both endpoints are in the
// removed set the comment is fully gone — safe. `removalOrphansCommentMarker`
// and `commentMarkerKindsInTexts` moved to `./markerScan`, which detects
// markers with the real inline tokenizer (correctly ignoring marker-looking
// text inside inline-code/inline-math) — a dependency this low-level module
// cannot take without a cycle (the tokenizer imports from here).

export function parseMalformedCommentMarker(src: string): IParsedCommentMarker | null {
    const match = COMMENT_MARKER_LIKE_REGEXP.exec(src);
    if (!match || isValidCommentId(match[2]))
        return null;

    return {
        raw: match[0],
        id: match[2],
        kind: match[1] === '~' ? 'close' : 'open',
    };
}

export function parseCommentMetadataDefinition(text: string): IParsedCommentMetadataDefinition | null {
    const match = COMMENT_METADATA_DEFINITION_REGEXP.exec(text);
    if (!match)
        return null;

    return {
        id: match[1],
        payload: match[2].trim(),
    };
}

const COMMENT_REPLY_LABEL_REGEXP = new RegExp(`^(${COMMENT_ID_PATTERN})\\.(\\d+)$`);

// A definition line whose label is a plain thread id — the v2 head line or a
// v1 data-URI line; the payload codec disambiguates.
export function parseCommentHeadDefinition(text: string): IParsedCommentHeadDefinition | null {
    const definition = parseCommentMetadataDefinition(text);
    if (!definition || !isValidCommentId(definition.id))
        return null;

    return definition;
}

// A v2 reply line: `[MC:id.N]: {json}`. The numeric suffix is a positional
// hint only — readers order replies by document position.
export function parseCommentReplyDefinition(text: string): IParsedCommentReplyDefinition | null {
    const definition = parseCommentMetadataDefinition(text);
    if (!definition)
        return null;

    const label = COMMENT_REPLY_LABEL_REGEXP.exec(definition.id);
    if (!label)
        return null;

    return {
        id: label[1],
        index: Number.parseInt(label[2], 10),
        payload: definition.payload,
    };
}

export function serializeCommentReplyDefinition(id: string, index: number, payload: string): string {
    return `[MC:${id}.${index}]: ${payload}`;
}

export function isCommentMetadataReference(label: string): boolean {
    return /^MC:[^\]\s]+$/.test(label);
}

// The thread a definition-shaped line belongs to: the id itself for head
// lines, the id before the `.N` suffix for reply lines, the raw label for
// anything else (damaged files keep the v1 semantics: label = id).
export function commentDefinitionLineThreadId(line: string): string | null {
    const reply = parseCommentReplyDefinition(line);
    if (reply)
        return reply.id;

    return parseCommentMetadataDefinition(line)?.id ?? null;
}

// The shape of a metadata block: EVERY line is a definition-shaped line.
// Contiguous head/reply runs tokenize as one block (preserving byte-level
// adjacency through the state round-trip), so whole-text predicates must
// accept multi-line runs, not just a single definition line.
export function isCommentMetadataDefinitionText(text: string): boolean {
    if (text.length === 0)
        return false;

    return text.split('\n').every(line => COMMENT_METADATA_DEFINITION_REGEXP.test(line));
}
