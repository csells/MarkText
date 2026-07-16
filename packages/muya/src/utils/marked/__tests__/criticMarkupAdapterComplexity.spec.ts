import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeMarkdownBlockSource } from '../lexBlock';

const OPTIONS = {
    criticMarkup: true,
    criticMarkupProjection: 'marked' as const,
    footnote: false,
    frontMatter: false,
    gfm: true,
    isGitlabCompatibilityEnabled: false,
    math: false,
    superSubScript: false,
};

/**
 * The documented native-adapter complexity law: doubling the input performs
 * at most 2.25x the measured parser/adapter work. Work is counted through
 * the two primitives the Wave 0 audit profiled as the quadratic hot spots —
 * linear `Array#find` scans and `String#lastIndexOf` line walks — so a
 * regression to per-cursor rescans of complete marker/plan sets fails here
 * long before the wall-clock scale suite would hang.
 */
const RATIO = 2.25;
const FIXED_OVERHEAD = 4_096;

const originalLastIndexOf = String.prototype.lastIndexOf;

function measuredWork(source: string): number {
    let work = 0;
    const findSpy = vi.spyOn(Array.prototype, 'find');
    findSpy.mockImplementation(function (this: unknown[], ...args) {
        const [predicate, thisArg] = args as [
            (value: unknown, index: number, array: unknown[]) => boolean,
            unknown,
        ];
        work += 1;
        for (let index = 0; index < this.length; index++) {
            work += 1;
            if (predicate.call(thisArg, this[index], index, this))
                return this[index];
        }
        return undefined;
    });
    const lastIndexOfSpy = vi.spyOn(String.prototype, 'lastIndexOf');
    lastIndexOfSpy.mockImplementation(function (
        this: string,
        ...args: [string, number?]
    ) {
        const result = originalLastIndexOf.apply(this, args);
        const from = Math.min(args[1] ?? this.length, this.length);
        // A backwards scan costs the distance walked from its start position
        // to the match (or the string head when nothing matched).
        work += 1 + from - (result >= 0 ? result : 0);
        return result;
    });

    try {
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        expect(parsed.tokens.length).toBeGreaterThan(0);
    }
    finally {
        findSpy.mockRestore();
        lastIndexOfSpy.mockRestore();
    }
    return work;
}

function expectDoublingLaw(build: (size: number) => string, size: number) {
    const single = measuredWork(build(size));
    const doubled = measuredWork(build(size * 2));

    expect(
        doubled,
        `work(${size * 2}) = ${doubled} exceeds ${RATIO}x work(${size}) = ${single}`,
    ).toBeLessThanOrEqual(single * RATIO + FIXED_OVERHEAD);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('native CriticMarkup adapter complexity law', () => {
    it('bounds ordinary no-opener input', () => {
        expectDoublingLaw(size =>
            'plain { braces } text with [links](x) and *emphasis*\n'
                .repeat(size), 512);
    });

    it('bounds dense inline items', () => {
        expectDoublingLaw(size =>
            '{++added++} kept {--removed--} kept {==marked==}{>>note<<}\n'
                .repeat(size), 256);
    });

    it('bounds wide sibling items on one line', () => {
        expectDoublingLaw(size =>
            `${'{++x++}'.repeat(size)}\n`, 384);
    });

    it('bounds deep balanced nesting', () => {
        expectDoublingLaw(size =>
            `${'{++'.repeat(size)}x${'++}'.repeat(size)}\n`, 256);
    });

    it('bounds malformed opener floods', () => {
        expectDoublingLaw(size =>
            '{++ never closed {-- also open {== and open\n'.repeat(size), 256);
    });

    it('bounds exclusion-heavy literal contexts', () => {
        expectDoublingLaw(size =>
            '`{++code++}` text {--real--} `{--code--}`\n'.repeat(size), 256);
    });

    it('bounds native-container-heavy structural items', () => {
        expectDoublingLaw(size =>
            '- item {++new entry++}\n{--  - removed item\n--}  - kept\n'
                .repeat(size), 128);
    });
});
