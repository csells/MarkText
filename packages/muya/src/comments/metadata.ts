import type { ICommentMetadata, ICommentReply, TCommentStatus } from './types';
import {
    COMMENT_METADATA_DATA_URI_PREFIX,
    serializeCommentMetadataDefinition,
    serializeCommentReplyDefinition,
} from './syntax';

const KNOWN_METADATA_KEYS = new Set([
    'status',
    'authors',
    'createdAt',
    'updatedAt',
    'display',
    'replies',
]);

// Anchor/offset/path/range/repair data is never persisted in comment metadata
// (it is recomputed from the document). Any key mentioning those concepts is
// rejected — the pattern subsumes every concrete key name.
const FORBIDDEN_METADATA_KEY_PATTERN = /anchor|offset|path|range|repair/iu;

function compareOrdinal(a: string, b: string): number {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}

function decodeBase64Utf8(value: string): string {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);

    // fatal: malformed UTF-8 must surface as invalid-metadata, not silently
    // become U+FFFD that every edit then re-encodes as canonical bytes.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function isCommentStatus(value: unknown): value is TCommentStatus {
    return value === 'open' || value === 'resolved';
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object'
        && value != null
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
    );
}

function isForbiddenMetadataKey(key: string): boolean {
    return FORBIDDEN_METADATA_KEY_PATTERN.test(key);
}

function normalizeDisplayValue(value: unknown, path: string): unknown {
    if (Array.isArray(value))
        return value.map((item, index) => normalizeDisplayValue(item, `${path}[${index}]`));

    if (!isPlainRecord(value))
        return value;

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareOrdinal)) {
        if (isForbiddenMetadataKey(key))
            throw new Error(`Comment metadata ${path}.${key} must not store anchor or repair data.`);

        // defineProperty, not `normalized[key] = ...`, so a `__proto__` key is
        // stored as ordinary data instead of invoking the prototype setter
        // (which would silently drop the field and mutate the object's prototype).
        Object.defineProperty(normalized, key, {
            value: normalizeDisplayValue(value[key], `${path}.${key}`),
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }

    return normalized;
}

function normalizeDisplay(value: unknown, path = 'display'): Record<string, unknown> | undefined {
    if (value == null)
        return undefined;
    if (!isPlainRecord(value))
        throw new Error(`Comment metadata ${path} must be an object.`);

    return normalizeDisplayValue(value, path) as Record<string, unknown>;
}

function normalizeReplies(value: unknown): ICommentReply[] {
    if (!Array.isArray(value))
        throw new Error('Comment metadata replies must be an array.');

    return value.map((reply) => {
        if (
            typeof reply !== 'object'
            || reply == null
            || typeof (reply as { author?: unknown }).author !== 'string'
            || typeof (reply as { createdAt?: unknown }).createdAt !== 'string'
            || typeof (reply as { body?: unknown }).body !== 'string'
        ) {
            throw new Error('Comment metadata reply is malformed.');
        }

        const { author, createdAt, body } = reply as ICommentReply;
        const replyData = reply as Record<string, unknown>;
        for (const key of Object.keys(replyData).sort(compareOrdinal)) {
            if (key === 'author' || key === 'createdAt' || key === 'body' || key === 'display')
                continue;
            if (isForbiddenMetadataKey(key))
                throw new Error(`Comment metadata reply.${key} must not store anchor or repair data.`);

            throw new Error(`Comment metadata reply.${key} is not part of the portable thread schema.`);
        }

        const display = normalizeDisplay(replyData.display, 'reply.display');
        return { author, createdAt, body, ...(display ? { display } : {}) };
    });
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value == null)
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`Comment metadata ${field} must be a string.`);

    return value;
}

function assertNoUnknownMetadataFields(data: Record<string, unknown>) {
    for (const key of Object.keys(data).sort(compareOrdinal)) {
        if (KNOWN_METADATA_KEYS.has(key))
            continue;
        if (isForbiddenMetadataKey(key))
            throw new Error(`Comment metadata ${key} must not store anchor or repair data.`);

        throw new Error(`Comment metadata ${key} is not part of the portable thread schema.`);
    }
}

export function normalizeCommentMetadata(value: unknown): ICommentMetadata {
    if (typeof value !== 'object' || value == null)
        throw new Error('Comment metadata must be an object.');

    const data = value as Record<string, unknown>;
    if (!isCommentStatus(data.status))
        throw new Error('Comment metadata status must be open or resolved.');

    const authors = data.authors ?? undefined;
    if (authors !== undefined && !isStringArray(authors))
        throw new Error('Comment metadata authors must be strings.');
    const normalizedAuthors = authors as string[] | undefined;
    const createdAt = optionalString(data.createdAt, 'createdAt');
    const updatedAt = optionalString(data.updatedAt, 'updatedAt');
    const display = normalizeDisplay(data.display);
    assertNoUnknownMetadataFields(data);

    return {
        status: data.status,
        ...(normalizedAuthors ? { authors: normalizedAuthors } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        ...(display ? { display } : {}),
        replies: normalizeReplies(data.replies ?? []),
    };
}

// v1 reader (read forever, written never): base64 data URI whose JSON embeds
// the replies array. The wire version tag is validated here and stripped —
// decoded objects are version-less (see ICommentMetadata).
export function decodeCommentMetadata(dataUri: string): ICommentMetadata {
    if (!dataUri.startsWith(COMMENT_METADATA_DATA_URI_PREFIX))
        throw new Error('Comment metadata must be a base64 JSON data URI.');

    const encoded = dataUri.slice(COMMENT_METADATA_DATA_URI_PREFIX.length);
    const data = JSON.parse(decodeBase64Utf8(encoded)) as Record<string, unknown>;
    if (data.version !== 1)
        throw new Error('Comment metadata version must be 1 for data-URI payloads.');

    const { version: _version, ...rest } = data;
    return normalizeCommentMetadata(rest);
}

// Head-payload dispatch: a v2 head line carries compact JSON; a v1 line
// carries the legacy data URI. Anything else is invalid metadata.
export function decodeCommentHeadPayload(payload: string): ICommentMetadata {
    if (payload.startsWith(COMMENT_METADATA_DATA_URI_PREFIX))
        return decodeCommentMetadata(payload);

    if (!payload.startsWith('{'))
        throw new Error('Comment metadata payload must be v2 JSON or a v1 base64 JSON data URI.');

    const data = JSON.parse(payload) as Record<string, unknown>;
    if (data.version !== 2)
        throw new Error('Comment metadata version must be 2 for JSON head lines.');
    if ('replies' in data)
        throw new Error('A v2 head line must not carry replies; replies are their own lines.');

    const { version: _version, ...rest } = data;
    return normalizeCommentMetadata({ ...rest, replies: [] });
}

export function decodeCommentReplyPayload(payload: string): ICommentReply {
    return normalizeReplies([JSON.parse(payload)])[0];
}

// Stable key order (version,status,authors,createdAt,updatedAt,display) so
// identical threads always produce identical bytes; `replies` never appears
// on the head line.
export function encodeCommentHeadPayload(metadata: ICommentMetadata): string {
    const normalized = normalizeCommentMetadata(metadata);
    return JSON.stringify({
        version: 2,
        status: normalized.status,
        ...(normalized.authors ? { authors: normalized.authors } : {}),
        ...(normalized.createdAt ? { createdAt: normalized.createdAt } : {}),
        ...(normalized.updatedAt ? { updatedAt: normalized.updatedAt } : {}),
        ...(normalized.display ? { display: normalized.display } : {}),
    });
}

// Stable key order (author,createdAt,body,display); newlines and quotes in
// bodies are JSON-escaped, keeping every reply line self-contained.
export function encodeCommentReplyPayload(reply: ICommentReply): string {
    const normalized = normalizeReplies([reply])[0];
    return JSON.stringify({
        author: normalized.author,
        createdAt: normalized.createdAt,
        body: normalized.body,
        ...(normalized.display ? { display: normalized.display } : {}),
    });
}

// The canonical v2 byte form of a whole thread: head line first, then one
// line per reply with indexes normalized to document position.
export function serializeCommentThreadLines(id: string, metadata: ICommentMetadata): string[] {
    const normalized = normalizeCommentMetadata(metadata);
    return [
        serializeCommentMetadataDefinition(id, encodeCommentHeadPayload(normalized)),
        ...normalized.replies.map((reply, index) =>
            serializeCommentReplyDefinition(id, index, encodeCommentReplyPayload(reply))),
    ];
}
