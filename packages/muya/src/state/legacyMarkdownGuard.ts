// Muya's own Markdown parser and serializer (`MarkdownToState`,
// `StateToMarkdown`) predate the bound document model. While a model is bound
// it owns every parse and serialization, so reaching either module from that
// Muya is a defect. Each construction site of the two modules reports here.
// Production keeps the unbound behavior; a test harness turns on `strict` to
// make each reach a thrown error and reads every reach back.

export type LegacyMarkdownModule = 'MarkdownToState' | 'StateToMarkdown';

export interface ILegacyMarkdownReach {
    module: LegacyMarkdownModule;
    stack: string;
}

interface ILegacyMarkdownOwner {
    editor?: { documentEditing?: unknown };
}

// Bounded so a defect repeated per keystroke cannot grow without limit.
const MAX_RECORDED_REACHES = 64;

const reaches: ILegacyMarkdownReach[] = [];
let strict = false;
const listeners = new Set<(reach: ILegacyMarkdownReach) => void>();

export function reachLegacyMarkdown(owner: ILegacyMarkdownOwner, module: LegacyMarkdownModule): void {
    if (owner.editor?.documentEditing === undefined)
        return;

    const error = new Error(`${module} was reached while a document model is bound`);
    const reach = { module, stack: error.stack ?? error.message };
    if (reaches.length < MAX_RECORDED_REACHES)
        reaches.push(reach);
    for (const listener of listeners)
        listener(reach);
    if (strict)
        throw error;
}

export function setLegacyMarkdownStrict(value: boolean): void {
    strict = value;
}

export function legacyMarkdownReaches(): readonly ILegacyMarkdownReach[] {
    return reaches.slice();
}

/** Calls `listener` on every later reach; returns its removal. */
export function onLegacyMarkdownReach(listener: (reach: ILegacyMarkdownReach) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
