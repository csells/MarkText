import type { Doc, JSONOp, JSONOpList, Path } from 'ot-json1';
import type { TDiff } from '../utils';
import type { TState } from './types';
import * as json1 from 'ot-json1';
import { deepClone } from '../utils';

export interface ISourceEdit {
    oldRange: { start: number; end: number };
    inserted: string;
}

interface IBaseIntent {
    path: Path;
    operation: JSONOpList;
}

export type TStateOperationIntent
    = | (IBaseIntent & {
        kind: 'text-edit';
        before: string;
        after: string;
        edits: ISourceEdit[];
    })
    | (IBaseIntent & {
        kind: 'insert';
        value: Doc;
    })
    | (IBaseIntent & {
        kind: 'remove';
        value: Doc;
    })
    | (IBaseIntent & {
        kind: 'replace';
        before: Doc;
        after: Doc;
    });

export interface ICapturedStateMutation<T> {
    value: T;
    baseRevision: number;
    beforeState: TState[];
    afterState: TState[];
    intents: readonly TStateOperationIntent[];
    operation: JSONOp;
}

function asDoc(value: unknown): Doc {
    return value as Doc;
}

function asState(value: unknown): TState[] {
    return value as TState[];
}

export function valueAtPath(document: unknown, path: Path): unknown {
    let value = document;
    for (const component of path) {
        if (
            value === null
            || typeof value !== 'object'
            || !(component in value)
        ) {
            throw new RangeError(
                `Mutation path ${JSON.stringify(path)} is outside its draft.`,
            );
        }
        value = (value as Record<string | number, unknown>)[component];
    }
    return value;
}

function advanceCodePoints(
    source: string,
    utf16Offset: number,
    count: number,
): number {
    if (!Number.isInteger(count) || count < 0)
        throw new RangeError(`Text retain ${count} is not a code-point count.`);

    let offset = utf16Offset;
    for (let index = 0; index < count; index++) {
        if (offset >= source.length) {
            throw new RangeError(
                'Text operation retains beyond its source string.',
            );
        }
        const point = source.codePointAt(offset)!;
        offset += point > 0xFFFF ? 2 : 1;
    }
    return offset;
}

/** Decode ot-text-unicode code-point components into UTF-16 source edits. */
export function textOperationSourceEdits(
    before: string,
    operation: readonly TDiff[],
): ISourceEdit[] {
    const edits: ISourceEdit[] = [];
    let cursor = 0;
    let groupStart: number | null = null;
    let inserted = '';

    const flush = () => {
        if (groupStart === null)
            return;
        edits.push({
            oldRange: { start: groupStart, end: cursor },
            inserted,
        });
        groupStart = null;
        inserted = '';
    };

    for (const component of operation) {
        if (typeof component === 'number') {
            flush();
            cursor = advanceCodePoints(before, cursor, component);
        }
        else if (typeof component === 'string') {
            groupStart ??= cursor;
            inserted += component;
        }
        else {
            groupStart ??= cursor;
            if (before.slice(cursor, cursor + component.d.length) !== component.d) {
                throw new TypeError(
                    'Text operation deletion does not match its source string.',
                );
            }
            cursor += component.d.length;
        }
    }
    flush();

    return edits;
}

export class StateMutationCapture {
    readonly beforeState: TState[];
    readonly intents: TStateOperationIntent[] = [];

    private _draft: TState[];
    private _operation: JSONOp = null;

    constructor(readonly baseRevision: number, beforeState: TState[]) {
        this.beforeState = deepClone(beforeState);
        this._draft = deepClone(beforeState);
    }

    get draft(): TState[] {
        return deepClone(this._draft);
    }

    private _record(
        operation: JSONOpList,
        intent: TStateOperationIntent,
    ): void {
        this._draft = asState(json1.type.apply(asDoc(this._draft), operation));
        this._operation = json1.type.compose(this._operation, operation);
        this.intents.push(intent);
    }

    recordText(path: Path, diff: TDiff[], operation: JSONOpList): void {
        const before = valueAtPath(this._draft, path);
        if (typeof before !== 'string') {
            throw new TypeError(
                `Text operation path ${JSON.stringify(path)} is not a string.`,
            );
        }
        const edits = textOperationSourceEdits(before, diff);
        this._record(operation, {
            kind: 'text-edit',
            path: [...path],
            operation,
            before,
            after: '',
            edits,
        });
        const intent = this.intents.at(-1)!;
        if (intent.kind === 'text-edit') {
            const after = valueAtPath(this._draft, path);
            if (typeof after !== 'string')
                throw new TypeError('Text operation did not produce a string.');
            intent.after = after;
        }
    }

    recordInsert(path: Path, value: Doc, operation: JSONOpList): void {
        this._record(operation, {
            kind: 'insert',
            path: [...path],
            operation,
            value: deepClone(value),
        });
    }

    /** Current draft value at `path` — what a replace must use as `before`. */
    draftValueAt(path: Path): unknown {
        return deepClone(valueAtPath(this._draft, path));
    }

    recordRemove(path: Path, operation: JSONOpList): void {
        const value = deepClone(valueAtPath(this._draft, path)) as Doc;
        this._record(operation, {
            kind: 'remove',
            path: [...path],
            operation,
            value,
        });
    }

    recordReplace(
        path: Path,
        before: Doc,
        after: Doc,
        operation: JSONOpList,
    ): void {
        const actualBefore = deepClone(valueAtPath(this._draft, path)) as Doc;
        if (JSON.stringify(actualBefore) !== JSON.stringify(before)) {
            throw new TypeError(
                `Replacement path ${JSON.stringify(path)} does not match its old value.`,
            );
        }
        this._record(operation, {
            kind: 'replace',
            path: [...path],
            operation,
            before: actualBefore,
            after: deepClone(after),
        });
    }

    /**
     * Read the in-progress capture without cloning or final verification.
     * The snapshot is ephemeral and must be consumed synchronously/read-only;
     * `finish` remains the sole commit-time integrity boundary.
     */
    activeSnapshot<T>(value: T): ICapturedStateMutation<T> {
        return {
            value,
            baseRevision: this.baseRevision,
            beforeState: this.beforeState,
            afterState: this._draft,
            intents: this.intents,
            operation: this._operation,
        };
    }

    finish<T>(value: T): ICapturedStateMutation<T> {
        const operation = Array.isArray(this._operation)
            && this._operation.length === 0
            ? null
            : this._operation;
        const verified = operation === null
            ? deepClone(this.beforeState)
            : asState(json1.type.apply(asDoc(this.beforeState), operation));
        if (JSON.stringify(verified) !== JSON.stringify(this._draft)) {
            throw new TypeError(
                'Captured operation does not reproduce its isolated draft.',
            );
        }

        return {
            value,
            baseRevision: this.baseRevision,
            beforeState: deepClone(this.beforeState),
            afterState: deepClone(this._draft),
            intents: deepClone(this.intents),
            operation,
        };
    }
}
