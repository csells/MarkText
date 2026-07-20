export interface IExcludedRange {
    /** Half-open UTF-16 offsets into one immutable source string. */
    start: number;
    end: number;
}

/** Monotonic O(source + ranges) view for one sequential source scan. */
export class ExcludedRangeCursor {
    private _rangeIndex = 0;
    private _lastOffset = -1;

    constructor(
        private readonly _ranges: readonly Readonly<IExcludedRange>[],
    ) {}

    endAt(offset: number): number | undefined {
        if (!Number.isInteger(offset) || offset < this._lastOffset) {
            throw new RangeError(
                `Excluded-range cursor offset ${offset} is before ${this._lastOffset}.`,
            );
        }
        this._lastOffset = offset;

        while (
            this._rangeIndex < this._ranges.length
            && this._ranges[this._rangeIndex].end <= offset
        ) {
            this._rangeIndex++;
        }
        const range = this._ranges[this._rangeIndex];
        return range && range.start <= offset
            ? range.end
            : undefined;
    }
}

/**
 * Validated, normalized source ranges that a syntax scanner must treat as
 * opaque. The source length is part of the value so ranges cannot be reused
 * accidentally with a different document revision.
 */
export class ExcludedRanges {
    readonly #sourceLength: number;

    readonly ranges: readonly Readonly<IExcludedRange>[];

    private constructor(
        sourceLength: number,
        ranges: readonly Readonly<IExcludedRange>[],
    ) {
        this.#sourceLength = sourceLength;
        this.ranges = Object.freeze(ranges);
        Object.freeze(this);
    }

    static from(
        sourceLength: number,
        ranges: readonly IExcludedRange[],
    ): ExcludedRanges {
        if (!Number.isInteger(sourceLength) || sourceLength < 0) {
            throw new RangeError(
                `Source length ${sourceLength} must be a non-negative integer.`,
            );
        }

        const normalized: IExcludedRange[] = [];
        for (const candidate of ranges) {
            const { start, end } = candidate;
            if (
                !Number.isInteger(start)
                || !Number.isInteger(end)
                || start < 0
                || end < start
                || end > sourceLength
            ) {
                throw new RangeError(
                    `Excluded range [${start}, ${end}) is outside a source of length ${sourceLength}.`,
                );
            }
            if (start !== end)
                normalized.push({ start, end });
        }

        normalized.sort((left, right) =>
            left.start - right.start || left.end - right.end);

        const merged: IExcludedRange[] = [];
        for (const range of normalized) {
            const previous = merged.at(-1);
            if (previous && range.start <= previous.end) {
                previous.end = Math.max(previous.end, range.end);
                continue;
            }
            merged.push({ ...range });
        }

        return new ExcludedRanges(
            sourceLength,
            merged.map(range => Object.freeze(range)),
        );
    }

    static empty(sourceLength: number): ExcludedRanges {
        return ExcludedRanges.from(sourceLength, []);
    }

    get sourceLength(): number {
        return this.#sourceLength;
    }

    assertSourceLength(sourceLength: number): void {
        if (sourceLength !== this.#sourceLength) {
            throw new RangeError(
                `Excluded-range source length is ${this.#sourceLength}, not ${sourceLength}.`,
            );
        }
    }

    /** Index of the first normalized range whose end is strictly after offset. */
    firstIndexEndingAfter(offset: number): number {
        if (
            !Number.isInteger(offset)
            || offset < 0
            || this.#sourceLength < offset
        ) {
            throw new RangeError(
                `Excluded-range offset ${offset} is outside a source of length ${this.#sourceLength}.`,
            );
        }
        let low = 0;
        let high = this.ranges.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (this.ranges[middle].end <= offset)
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    }

    /** Create an independent cursor for a monotonically increasing scan. */
    forwardCursor(): ExcludedRangeCursor {
        return new ExcludedRangeCursor(this.ranges);
    }

    /** Return a strictly forward skip target when offset is excluded. */
    endAt(offset: number): number | undefined {
        let low = 0;
        let high = this.ranges.length - 1;

        while (low <= high) {
            const middle = (low + high) >>> 1;
            const range = this.ranges[middle];
            if (offset < range.start)
                high = middle - 1;
            else if (offset >= range.end)
                low = middle + 1;
            else
                return range.end;
        }

        return undefined;
    }

    overlaps(range: IExcludedRange): boolean {
        return this.ranges.some(excluded =>
            range.start === range.end
                ? excluded.start < range.start && range.start < excluded.end
                : excluded.start < range.end && range.start < excluded.end);
    }

    /** Exact revision-bound value equality for parser-analysis reuse. */
    equals(other: ExcludedRanges): boolean {
        return this.#sourceLength === other.#sourceLength
            && this.ranges.length === other.ranges.length
            && this.ranges.every((range, index) =>
                range.start === other.ranges[index].start
                && range.end === other.ranges[index].end);
    }
}
