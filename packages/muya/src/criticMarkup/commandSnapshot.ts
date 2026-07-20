import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentFragment,
    ICriticMarkupDocumentItem,
    TCriticMarkupDocumentToken,
} from './document';
import type {
    ICriticMarkupTarget,
    TCriticMarkupFocusTarget,
} from './reviewContract';
import { mappedPathsEqual } from '../mapped-range';
import { markParserOwnedCommandItemContent } from './commandItemMetadata';

export interface ICriticMarkupItem extends ICriticMarkupTarget {
    id: string;
    sourceStart: number;
    sourceEnd: number;
    type: TCriticMarkupDocumentToken['type'];
    fragments: readonly ICriticMarkupDocumentFragment[];
    content?: string;
    oldContent?: string;
    newContent?: string;
}

export interface ICriticMarkupEntry {
    documentItem: ICriticMarkupDocumentItem;
    item: ICriticMarkupItem;
}

export interface ICriticMarkupDocumentSnapshot {
    model: CriticMarkupDocument;
    entries: ICriticMarkupEntry[];
    entryById: ReadonlyMap<string, ICriticMarkupEntry>;
}

const COMMAND_ITEM_TOKENS = new WeakMap<
    ICriticMarkupItem,
    TCriticMarkupDocumentToken
>();

function commandItemToken(item: ICriticMarkupItem): TCriticMarkupDocumentToken {
    const token = COMMAND_ITEM_TOKENS.get(item);
    if (!token) {
        throw new TypeError(
            'CriticMarkup command item has no parser-owned semantic token.',
        );
    }
    return token;
}

function commandItemContentGetter(this: ICriticMarkupItem): string | undefined {
    const token = commandItemToken(this);
    return token.type === 'substitution' ? undefined : token.semanticContent;
}

function commandItemOldContentGetter(this: ICriticMarkupItem): string | undefined {
    const token = commandItemToken(this);
    return token.type === 'substitution' ? token.semanticOldContent : undefined;
}

function commandItemNewContentGetter(this: ICriticMarkupItem): string | undefined {
    const token = commandItemToken(this);
    return token.type === 'substitution' ? token.semanticNewContent : undefined;
}

function itemFromDocumentItem(
    documentItem: ICriticMarkupDocumentItem,
): ICriticMarkupItem {
    const { syntax: critic } = documentItem;
    const firstFragment = documentItem.fragments[0];
    const common = {
        id: documentItem.id,
        type: critic.type,
        path: firstFragment ? [...firstFragment.path] : [],
        start: firstFragment?.localRange.start ?? critic.range.start,
        end: firstFragment?.localRange.end ?? critic.range.end,
        sourceStart: critic.range.start,
        sourceEnd: critic.range.end,
        raw: critic.raw,
        fragments: documentItem.fragments,
    };

    const item = { ...common } as ICriticMarkupItem;
    COMMAND_ITEM_TOKENS.set(item, critic);
    markParserOwnedCommandItemContent(
        item,
        critic.type !== 'substitution'
        && critic.contentRange.start === critic.contentRange.end,
    );
    if (critic.type === 'substitution') {
        Object.defineProperties(item, {
            oldContent: {
                configurable: false,
                enumerable: true,
                get: commandItemOldContentGetter,
            },
            newContent: {
                configurable: false,
                enumerable: true,
                get: commandItemNewContentGetter,
            },
        });
    }
    else {
        Object.defineProperty(item, 'content', {
            configurable: false,
            enumerable: true,
            get: commandItemContentGetter,
        });
    }
    return item;
}

export function createCriticMarkupDocumentSnapshot(
    model: CriticMarkupDocument,
): ICriticMarkupDocumentSnapshot {
    const entries = model.items.map(documentItem => ({
        documentItem,
        item: itemFromDocumentItem(documentItem),
    }));
    const entryById = new Map(entries.map(entry => [
        entry.documentItem.id,
        entry,
    ]));

    return { model, entries, entryById };
}

export function criticMarkupEntryForTarget(
    snapshot: ICriticMarkupDocumentSnapshot,
    target: TCriticMarkupFocusTarget,
): ICriticMarkupEntry | null {
    if (typeof target === 'string')
        return snapshot.entryById.get(target) ?? null;

    if (
        target.sourceStart !== undefined
        && target.sourceEnd !== undefined
    ) {
        return snapshot.entries.find(({ item }) =>
            item.sourceStart === target.sourceStart
            && item.sourceEnd === target.sourceEnd
            && item.raw === target.raw) ?? null;
    }

    return snapshot.entries.find(({ item }) =>
        mappedPathsEqual(item.path, target.path)
        && item.start === target.start
        && item.end === target.end
        && item.raw === target.raw) ?? null;
}

/**
 * The parser-indexed gapless `{==sel==}{>>note<<}` pair for one entry. Null
 * for a plain highlight, a point comment, or an unrelated nested item.
 */
export function criticMarkupCommentedSpanFor(
    snapshot: ICriticMarkupDocumentSnapshot,
    entry: ICriticMarkupEntry,
): { highlight: ICriticMarkupEntry; comment: ICriticMarkupEntry } | null {
    let highlightId: string | null = null;
    let commentId: string | null = null;
    if (entry.item.type === 'comment') {
        const highlight = snapshot.model.commentAnchorFor(
            entry.documentItem.id,
        );
        highlightId = highlight?.id ?? null;
        commentId = entry.documentItem.id;
    }
    else if (entry.item.type === 'highlight') {
        const comment = snapshot.model.commentForAnchor(
            entry.documentItem.id,
        );
        highlightId = entry.documentItem.id;
        commentId = comment?.id ?? null;
    }
    const highlight = highlightId
        ? snapshot.entryById.get(highlightId)
        : null;
    const comment = commentId
        ? snapshot.entryById.get(commentId)
        : null;
    return highlight && comment ? { highlight, comment } : null;
}
