import type { ICommentMetadata, ICommentReply, TCommentStatus } from './types';
import { COMMENT_METADATA_DATA_URI_PREFIX } from './syntax';

const KNOWN_METADATA_KEYS = new Set([
    'version',
    'status',
    'authors',
    'createdAt',
    'updatedAt',
    'replies',
]);

const FORBIDDEN_METADATA_KEYS = new Set([
    'anchor',
    'anchors',
    'anchorOffset',
    'anchorOffsets',
    'alternateAnchor',
    'alternateAnchors',
    'endOffset',
    'endPath',
    'range',
    'repairCoordinate',
    'repairCoordinates',
    'startOffset',
    'startPath',
]);

function encodeBase64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);

    return btoa(binary);
}

function decodeBase64Utf8(value: string): string {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);

    return new TextDecoder().decode(bytes);
}

function isCommentStatus(value: unknown): value is TCommentStatus {
    return value === 'open' || value === 'resolved';
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
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
        return { author, createdAt, body };
    });
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value == null)
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`Comment metadata ${field} must be a string.`);

    return value;
}

function normalizeExtensionFields(data: Record<string, unknown>): Record<string, unknown> {
    const extensions: Record<string, unknown> = {};
    for (const key of Object.keys(data).sort()) {
        if (KNOWN_METADATA_KEYS.has(key))
            continue;
        if (FORBIDDEN_METADATA_KEYS.has(key))
            throw new Error(`Comment metadata ${key} must not store anchor or repair data.`);

        extensions[key] = data[key];
    }

    return extensions;
}

export function normalizeCommentMetadata(value: unknown): ICommentMetadata {
    if (typeof value !== 'object' || value == null)
        throw new Error('Comment metadata must be an object.');

    const data = value as Record<string, unknown>;
    if (data.version !== 1)
        throw new Error('Comment metadata version must be 1.');
    if (!isCommentStatus(data.status))
        throw new Error('Comment metadata status must be open or resolved.');

    const authors = data.authors ?? undefined;
    if (authors !== undefined && !isStringArray(authors))
        throw new Error('Comment metadata authors must be strings.');
    const normalizedAuthors = authors as string[] | undefined;
    const createdAt = optionalString(data.createdAt, 'createdAt');
    const updatedAt = optionalString(data.updatedAt, 'updatedAt');

    return {
        version: 1,
        status: data.status,
        ...(normalizedAuthors ? { authors: normalizedAuthors } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        ...normalizeExtensionFields(data),
        replies: normalizeReplies(data.replies ?? []),
    };
}

export function decodeCommentMetadata(dataUri: string): ICommentMetadata {
    if (!dataUri.startsWith(COMMENT_METADATA_DATA_URI_PREFIX))
        throw new Error('Comment metadata must be a base64 JSON data URI.');

    const encoded = dataUri.slice(COMMENT_METADATA_DATA_URI_PREFIX.length);
    return normalizeCommentMetadata(JSON.parse(decodeBase64Utf8(encoded)));
}

export function encodeCommentMetadata(metadata: ICommentMetadata): string {
    const normalized = normalizeCommentMetadata(metadata);
    const extensionFields = Object.fromEntries(
        Object.entries(normalized)
            .filter(([key]) => !KNOWN_METADATA_KEYS.has(key))
            .sort(([a], [b]) => a.localeCompare(b)),
    );
    const json = JSON.stringify({
        version: normalized.version,
        status: normalized.status,
        ...(normalized.authors ? { authors: normalized.authors } : {}),
        ...(normalized.createdAt ? { createdAt: normalized.createdAt } : {}),
        ...(normalized.updatedAt ? { updatedAt: normalized.updatedAt } : {}),
        ...extensionFields,
        replies: normalized.replies,
    });

    return `${COMMENT_METADATA_DATA_URI_PREFIX}${encodeBase64Utf8(json)}`;
}
