import type { Doc, JSONOp } from 'ot-json1';
import type { ITableState, TState } from './types';
import diff from 'fast-diff';
import * as json1 from 'ot-json1';
import StateToMarkdown from './stateToMarkdown';
import { tableToMarkdown } from './tableToMarkdown';

const metadata: Record<string, Record<string, string>> = {
    'paragraph': {},
    'html-block': {},
    'thematic-break': {},
    'atx-heading': { level: 'number' },
    'setext-heading': { level: 'number', underline: 'string' },
    'code-block': { type: 'string', lang: 'string' },
    'math-block': { mathStyle: 'string' },
    'frontmatter': { lang: 'string', style: 'string' },
    'diagram': { lang: 'string', type: 'string' },
    'table.cell': { align: 'string' },
    'block-quote': {},
    'list-item': {},
    'table': {},
    'table.row': {},
    'task-list-item': { checked: 'boolean' },
    'bullet-list': { marker: 'string', loose: 'boolean' },
    'task-list': { marker: 'string', loose: 'boolean' },
    'order-list': { start: 'number', delimiter: 'string', loose: 'boolean' },
    'footnote': { identifier: 'string' },
};
const containers = new Set(['block-quote', 'list-item', 'task-list-item', 'table', 'table.row', 'bullet-list', 'order-list', 'task-list', 'footnote']);
// eslint-disable-next-line e18e/prefer-object-has-own -- Muya's TypeScript lib predates Object.hasOwn.
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export interface INativeSerializationOptions {
    maximumUnits?: number;
    /** Authoritative source spelling; retained breaks keep their exact bytes. */
    sourceLineEndings?: string;
}

function retainLineEndings(markdown: string, source: string): string {
    if (!source.includes('\r'))
        return markdown;
    const endings = new Map<number, string>();
    let removed = 0;
    const normalizedSource = source.replace(/\r\n|\r|\n/g, (ending, offset: number) => {
        endings.set(offset - removed, ending);
        removed += ending.length - 1;
        return '\n';
    });
    const positions = [...endings.keys()];
    const localEnding = (position: number): string => {
        let low = 0;
        let high = positions.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (positions[middle] < position)
                low = middle + 1;
            else high = middle;
        }
        return endings.get(positions[Math.max(0, low - 1)]) ?? '\n';
    };
    let sourceOffset = 0;
    const result: string[] = [];
    for (const [operation, text] of diff(normalizedSource, markdown.replace(/\r\n|\r|\n/g, '\n'))) {
        if (operation !== diff.DELETE) {
            result.push(text.replace(/\n/g, (_ending, offset: number) => operation === diff.EQUAL
                ? endings.get(sourceOffset + offset) ?? '\n'
                : localEnding(sourceOffset)));
        }
        if (operation !== diff.INSERT)
            sourceOffset += text.length;
    }
    return result.join('');
}

function validNativeStates(states: unknown, maximumUnits: number): states is TState[] {
    if (!Array.isArray(states))
        return false;
    const seen = new Set<object>();
    const pending: unknown[] = [...states];
    let units = 0;
    while (pending.length > 0) {
        const value = pending.pop();
        if (value === null || typeof value !== 'object' || seen.has(value))
            return false;
        seen.add(value);
        const node = value as Record<string, unknown>;
        if (typeof node.name !== 'string' || !hasOwn(metadata, node.name)
            || Object.keys(node).some(key => !['name', 'text', 'meta', 'children'].includes(key))) {
            return false;
        }
        const spec = metadata[node.name];
        const meta = node.meta ?? {};
        if (meta === null || typeof meta !== 'object' || Array.isArray(meta)
            || Object.keys(meta).some(key => !hasOwn(spec, key))
            // eslint-disable-next-line valid-typeof -- The schema contains only primitive JavaScript type names.
            || Object.entries(spec).some(([key, type]) => typeof (meta as Record<string, unknown>)[key] !== type)) {
            return false;
        }
        const attrs = meta as Record<string, unknown>;
        if (('level' in attrs && (!Number.isSafeInteger(attrs.level) || Number(attrs.level) < 1 || Number(attrs.level) > 6))
            || ('marker' in attrs && !['-', '+', '*'].includes(String(attrs.marker)))
            || ('delimiter' in attrs && !['.', ')'].includes(String(attrs.delimiter)))
            || ('start' in attrs && (!Number.isSafeInteger(attrs.start) || Number(attrs.start) < 0))
            || ('align' in attrs && !['none', 'left', 'center', 'right'].includes(String(attrs.align)))) {
            return false;
        }
        units += node.name.length + (typeof node.text === 'string' ? node.text.length : 0)
            + Object.values(attrs).reduce<number>((sum, value) => sum + (typeof value === 'string' ? value.length : 1), 0);
        if (units > maximumUnits)
            return false;
        if (containers.has(node.name)) {
            if (!Array.isArray(node.children) || node.text !== undefined)
                return false;
            pending.push(...node.children);
        }
        else if (typeof node.text !== 'string' || node.children !== undefined) {
            return false;
        }
    }
    return true;
}

/** Bounded native table fragment; its enclosing source owns the final line ending. */
export function serializeNativeTable(value: unknown, maximumSourceUnits: number): string | undefined {
    if (!Number.isSafeInteger(maximumSourceUnits) || maximumSourceUnits < 0)
        return undefined;
    const states = [value];
    if (!validNativeStates(states, Number.MAX_SAFE_INTEGER) || states[0].name !== 'table')
        return undefined;
    const table = states[0] as ITableState;
    if (table.children.length === 0
        || table.children.some(row => row.name !== 'table.row' || row.children.length === 0
            || row.children.some(cell => cell.name !== 'table.cell'))) {
        return undefined;
    }
    const columns = table.children[0].children.length;
    if (table.children.some(row => row.children.length !== columns))
        return undefined;
    return tableToMarkdown(table, '', maximumSourceUnits);
}

/** Native Markdown spelling, with source EOL provenance when supplied by a host. */
export function serializeNativeState(states: unknown, options: INativeSerializationOptions = {}): string | undefined {
    const maximumUnits = options.maximumUnits ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maximumUnits) || maximumUnits < 0)
        return undefined;
    if ((options.sourceLineEndings?.length ?? 0) > maximumUnits)
        return undefined;
    if (!validNativeStates(states, maximumUnits))
        return undefined;
    const markdown = new StateToMarkdown().generate(states as TState[]);
    const result = options.sourceLineEndings === undefined ? markdown : retainLineEndings(markdown, options.sourceLineEndings);
    return result.length > maximumUnits ? undefined : result;
}

/** Validate a native change against the same OT implementation Muya uses. */
export function applyNativeOperation(previous: unknown, operation: unknown): unknown {
    return json1.type.apply(previous as Doc, operation as JSONOp);
}
