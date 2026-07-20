import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainMarkdown } from '../../../state/markdownSourceMap';
import { parseCriticMarkupDocument } from '../criticMarkupDocument';
import { fragmentPlans } from '../extensions/criticMarkupFragmentPlans';
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
 * linear `Array#find` scans and `String#lastIndexOf` line walks. Separate
 * slice-work laws cover fragment-tail materialization and the complete parse,
 * so per-item copies of a wide source line fail before wall-clock scale tests
 * become noisy or hang.
 */
const RATIO = 2.25;
const FIXED_OVERHEAD = 4_096;

const originalLastIndexOf = String.prototype.lastIndexOf;
const originalSlice = String.prototype.slice;

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

function measuredFragmentPlanSliceWork(source: string): number {
    // Build the canonical document before measuring. Marked's ordinary
    // `blockSkip` mask rewrites comment-shaped source during context
    // discovery; that independent lexer cost must not hide whether the
    // native fragment planner rematerializes the rest of a wide line once
    // per item.
    const document = parseCriticMarkupDocument(
        plainMarkdown(source),
        OPTIONS,
    );
    let work = 0;
    const sliceSpy = vi.spyOn(String.prototype, 'slice');
    sliceSpy.mockImplementation(function (
        this: string,
        ...args: [number?, number?]
    ) {
        const result = originalSlice.apply(this, args);
        work += 1 + result.length;
        return result;
    });

    try {
        const plans = fragmentPlans(
            document,
            () => false,
            () => false,
        );
        expect(plans).toHaveLength(document.items.length);
    }
    finally {
        sliceSpy.mockRestore();
    }
    return work;
}

function expectFragmentPlanSliceDoublingLaw(
    build: (size: number) => string,
    size: number,
) {
    const single = measuredFragmentPlanSliceWork(build(size));
    const doubled = measuredFragmentPlanSliceWork(build(size * 2));

    expect(
        doubled,
        `sliceWork(${size * 2}) = ${doubled} exceeds ${RATIO}x sliceWork(${size}) = ${single}`,
    ).toBeLessThanOrEqual(single * RATIO + FIXED_OVERHEAD);
}

function measuredEndToEndSliceWork(source: string): number {
    const expectedItemCount = source.match(/\{(?:==|>>)/g)?.length ?? 0;
    let work = 0;
    const sliceSpy = vi.spyOn(String.prototype, 'slice');
    sliceSpy.mockImplementation(function (
        this: string,
        ...args: [number?, number?]
    ) {
        const result = originalSlice.apply(this, args);
        work += 1 + result.length;
        return result;
    });

    try {
        const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
        expect(parsed.tokens.length).toBeGreaterThan(0);
        expect(parsed.criticMarkupDocument?.items)
            .toHaveLength(expectedItemCount);
    }
    finally {
        sliceSpy.mockRestore();
    }
    return work;
}

function expectEndToEndSliceDoublingLaw(
    build: (size: number) => string,
    size: number,
) {
    const single = measuredEndToEndSliceWork(build(size));
    const doubled = measuredEndToEndSliceWork(build(size * 2));

    expect(
        doubled,
        `endToEndSliceWork(${size * 2}) = ${doubled} exceeds ${RATIO}x endToEndSliceWork(${size}) = ${single}`,
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

    it('bounds fragment-plan tail slicing for wide anchored comments', () => {
        expectFragmentPlanSliceDoublingLaw(size =>
            `${'{==x==}{>>c<<}'.repeat(size)}\n`, 32);
    });

    it('bounds fragment-plan tail slicing for wide empty comments', () => {
        expectFragmentPlanSliceDoublingLaw(size =>
            `${'{>><<} '.repeat(size)}\n`, 32);
    });

    it('bounds shared projected tails after adjacent empty comments', () => {
        expectFragmentPlanSliceDoublingLaw(size =>
            `${'{>><<}'.repeat(size)}${'x'.repeat(size)}\n`, 32);
    });

    it('bounds end-to-end slicing for wide anchored comments', () => {
        expectEndToEndSliceDoublingLaw(size =>
            `${'{==x==}{>>c<<}'.repeat(size)}\n`, 32);
    });

    it('bounds end-to-end slicing for wide empty comments', () => {
        expectEndToEndSliceDoublingLaw(size =>
            `${'{>><<} '.repeat(size)}\n`, 32);
    });

    it('bounds end-to-end shared tails after adjacent empty comments', () => {
        expectEndToEndSliceDoublingLaw(size =>
            `${'{>><<}'.repeat(size)}${'x'.repeat(size)}\n`, 32);
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
