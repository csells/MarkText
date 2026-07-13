declare const MAPPED_PATH_BRAND: unique symbol;

export type TMappedPath = readonly (string | number)[];
export type TMappedTextPath = TMappedPath;

export type TBrandedMappedTextPath<Domain extends string>
    = ReadonlyArray<string | number> & {
        readonly [MAPPED_PATH_BRAND]: Domain;
    };

function immutablePath<Path extends TMappedPath>(path: Path): Path {
    const snapshot: Array<string | number> = [];
    for (const part of path)
        snapshot.push(part);

    // TypeScript cannot preserve a generic branded tuple/array intersection
    // through Object.freeze, so isolate the unavoidable cast at this boundary.
    // eslint-disable-next-line no-restricted-syntax
    return Object.freeze(snapshot) as unknown as Path;
}

export function mappedTextPath<Domain extends string>(
    path: TMappedTextPath,
): TBrandedMappedTextPath<Domain> {
    return immutablePath(path) as TBrandedMappedTextPath<Domain>;
}

export function mappedPathsEqual(left: TMappedPath, right: TMappedPath): boolean {
    return left.length === right.length
        && left.every((part, index) => part === right[index]);
}

export function lowerBound<T>(
    values: readonly T[],
    target: number,
    coordinate: (value: T) => number,
): number {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (coordinate(values[middle]) < target)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}

export function upperBound<T>(
    values: readonly T[],
    target: number,
    coordinate: (value: T) => number,
): number {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (coordinate(values[middle]) <= target)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}

interface IPathNode<Path extends TMappedPath, Value> {
    readonly children: Map<string | number, IPathNode<Path, Value>>;
    path?: Path;
    value?: Value;
    hasValue: boolean;
}

function pathNode<Path extends TMappedPath, Value>(): IPathNode<Path, Value> {
    return { children: new Map(), hasValue: false };
}

/** Structural path map: number and string segments remain distinct. */
export class MappedPathIndex<Path extends TMappedPath, Value> {
    private readonly _root = pathNode<Path, Value>();
    private readonly _paths: Path[] = [];

    get size(): number {
        return this._paths.length;
    }

    private _node(path: Path, create: boolean): IPathNode<Path, Value> | null {
        let node = this._root;
        for (const part of path) {
            let child = node.children.get(part);
            if (!child) {
                if (!create)
                    return null;
                child = pathNode();
                node.children.set(part, child);
            }
            node = child;
        }
        return node;
    }

    set(path: Path, value: Value): this {
        const node = this._node(path, true)!;
        if (!node.hasValue) {
            const snapshot = immutablePath(path);
            node.path = snapshot;
            node.hasValue = true;
            this._paths.push(snapshot);
        }
        node.value = value;
        return this;
    }

    get(path: Path): Value | undefined {
        const node = this._node(path, false);
        return node?.hasValue ? node.value : undefined;
    }

    has(path: Path): boolean {
        return this._node(path, false)?.hasValue ?? false;
    }

    * paths(): IterableIterator<Path> {
        yield* this._paths;
    }

    * values(): IterableIterator<Value> {
        for (const path of this._paths)
            yield this.get(path)!;
    }

    * entries(): IterableIterator<readonly [Path, Value]> {
        for (const path of this._paths)
            yield [path, this.get(path)!] as const;
    }
}

export interface IHalfOpenInterval<Value> {
    readonly start: number;
    readonly end: number;
    readonly value: Value;
}

/** Immutable start-sorted half-open interval index. */
export class HalfOpenIntervalIndex<Value> {
    private readonly _intervals: readonly IHalfOpenInterval<Value>[];
    private readonly _prefixMaxEnd: readonly number[];
    private readonly _values: readonly Value[];

    constructor(intervals: readonly IHalfOpenInterval<Value>[]) {
        const snapshots: IHalfOpenInterval<Value>[] = [];
        for (const interval of intervals) {
            const { start, end, value } = interval;
            if (
                !Number.isInteger(start)
                || start < 0
                || !Number.isInteger(end)
                || end < 0
            ) {
                throw new RangeError(
                    'Half-open interval bounds must be non-negative integers.',
                );
            }
            if (end < start) {
                throw new RangeError(
                    'Intervals must use forward half-open ranges.',
                );
            }
            snapshots.push(Object.freeze({
                start,
                end,
                value,
            }));
        }
        this._intervals = Object.freeze(
            snapshots.sort((left, right) => left.start - right.start),
        );
        let maxEnd = Number.NEGATIVE_INFINITY;
        this._prefixMaxEnd = Object.freeze(this._intervals.map((item) => {
            maxEnd = Math.max(maxEnd, item.end);
            return maxEnd;
        }));
        this._values = Object.freeze(this._intervals.map(item => item.value));
        Object.freeze(this);
    }

    values(): readonly Value[] {
        return this._values;
    }

    containing(offset: number): Value[] {
        const result: Value[] = [];
        const limit = upperBound(this._intervals, offset, item => item.start);
        for (let index = limit - 1; index >= 0; index--) {
            if (this._prefixMaxEnd[index] <= offset)
                break;
            const item = this._intervals[index];
            if (offset < item.end)
                result.push(item.value);
        }
        return result.reverse();
    }

    containingRange(start: number, end: number): Value[] {
        if (end < start)
            [start, end] = [end, start];
        if (start === end)
            return this.containing(start);
        const result: Value[] = [];
        const limit = upperBound(this._intervals, start, item => item.start);
        for (let index = limit - 1; index >= 0; index--) {
            if (this._prefixMaxEnd[index] < end)
                break;
            const item = this._intervals[index];
            if (end <= item.end)
                result.push(item.value);
        }
        return result.reverse();
    }

    containedBy(start: number, end: number): Value[] {
        if (end < start)
            [start, end] = [end, start];
        const first = lowerBound(this._intervals, start, item => item.start);
        const limit = lowerBound(this._intervals, end, item => item.start);
        return this._intervals.slice(first, limit)
            .filter(item => item.end <= end)
            .map(item => item.value);
    }

    overlapping(start: number, end: number): Value[] {
        if (end <= start)
            return [];
        const result: Value[] = [];
        const limit = lowerBound(this._intervals, end, item => item.start);
        for (let index = limit - 1; index >= 0; index--) {
            if (this._prefixMaxEnd[index] <= start)
                break;
            const item = this._intervals[index];
            if (start < item.end)
                result.push(item.value);
        }
        return result.reverse();
    }

    startingAt(offset: number): Value[] {
        const start = lowerBound(this._intervals, offset, item => item.start);
        const end = upperBound(this._intervals, offset, item => item.start);
        return this._intervals.slice(start, end).map(item => item.value);
    }
}
