// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { MarkdownToState } from '../markdownToState';
import StateToMarkdown from '../stateToMarkdown';

/**
 * Generative coverage for the CriticMarkup surface. The example corpus
 * verifies inputs someone thought of; this suite generates inputs nobody
 * did — the opener-on-own-line boot crash (2026-07-17) survived every
 * example suite precisely because no fixture combined markers and line
 * breaks that way. Deterministic seeds keep runs reproducible; a failing
 * case prints its source so it can graduate into the shared corpus.
 */

const OPTIONS = {
    footnote: false,
    math: true,
    frontMatter: true,
    isGitlabCompatibilityEnabled: true,
    trimUnnecessaryCodeBlockEmptyLines: false,
};

/** Deterministic PRNG (mulberry32) — no Date.now/Math.random in tests. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(random: () => number, values: readonly T[]): T {
    return values[Math.floor(random() * values.length)];
}

const MARKERS = [
    { open: '{++', close: '++}' },
    { open: '{--', close: '--}' },
    { open: '{==', close: '==}' },
    { open: '{>>', close: '<<}' },
] as const;

const SUBSTITUTION = { open: '{~~', separator: '~>', close: '~~}' } as const;

const WORDS = [
    'alpha',
    'bravo',
    'charlie',
    'delta',
    'echo',
    'foxtrot',
    'one',
    'two',
    'draft',
    'note',
    'text',
    'word',
] as const;

const GLUE = [' ', '\n', '\n\n', '', '\n\n\n'] as const;

function words(random: () => number, count: number): string {
    return Array.from(
        { length: count },
        () => pick(random, WORDS),
    ).join(' ');
}

/** One CriticMarkup item with randomized payload/newline structure. */
function criticItem(random: () => number): string {
    if (random() < 0.2) {
        const payload = [
            pick(random, GLUE),
            words(random, 1 + Math.floor(random() * 3)),
            pick(random, GLUE),
        ].join('');
        const other = [
            pick(random, GLUE),
            words(random, 1 + Math.floor(random() * 2)),
            pick(random, GLUE),
        ].join('');
        return `${SUBSTITUTION.open}${payload}${SUBSTITUTION.separator}${other}${SUBSTITUTION.close}`;
    }
    const marker = pick(random, MARKERS);
    const segments = 1 + Math.floor(random() * 3);
    const payload = Array.from({ length: segments }, () => [
        pick(random, GLUE),
        random() < 0.3 ? `- ${words(random, 2)}` : words(random, 1 + Math.floor(random() * 3)),
    ].join('')).join('') + pick(random, GLUE);
    return `${marker.open}${payload}${marker.close}`;
}

/** A whole document mixing plain blocks and critic items at random seams. */
function generateDocument(random: () => number): string {
    const parts: string[] = [];
    const blocks = 1 + Math.floor(random() * 4);
    for (let index = 0; index < blocks; index++) {
        const kind = random();
        if (kind < 0.15) {
            parts.push(`# ${words(random, 2)}`);
        }
        else if (kind < 0.3) {
            parts.push(`- ${words(random, 2)}\n- ${words(random, 2)}`);
        }
        else if (kind < 0.45) {
            parts.push(`> ${words(random, 3)}`);
        }
        else {
            const before = random() < 0.7 ? `${words(random, 2)} ` : '';
            const after = random() < 0.7 ? ` ${words(random, 2)}` : '';
            parts.push(`${before}${criticItem(random)}${after}`);
        }
        if (random() < 0.35)
            parts.push(criticItem(random));
    }
    const glue = pick(random, ['\n\n', '\n\n', '\n\n\n'] as const);
    const terminal = random() < 0.85 ? '\n' : '';
    return parts.join(glue) + terminal;
}

function roundTrip(source: string): string {
    return new StateToMarkdown({ listIndentation: 1 }).generate(
        new MarkdownToState(OPTIONS).generate(source),
    );
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
const CASES_PER_SEED = 40;
const BOOT_CASES_PER_SEED = 8;

describe('criticMarkup generative properties', () => {
    it.each(SEEDS)(
        'seed %i: serialization reaches a byte-stable fixed point',
        (seed) => {
            const random = prng(seed);
            for (let index = 0; index < CASES_PER_SEED; index++) {
                const source = generateDocument(random);
                let once: string;
                try {
                    once = roundTrip(source);
                }
                catch (error) {
                    throw new Error(
                        `parse/serialize threw for ${JSON.stringify(source)}: ${String(error)}`,
                    );
                }
                // The first pass may apply documented normalizations; the
                // second must be a fixed point — repeated open/save must
                // never keep changing the document.
                const twice = roundTrip(once);
                if (twice !== once) {
                    throw new Error(
                        `round-trip is not a fixed point for ${JSON.stringify(source)}\n`
                        + `  once : ${JSON.stringify(once)}\n`
                        + `  twice: ${JSON.stringify(twice)}`,
                    );
                }
            }
        },
    );

    it.each(SEEDS)(
        'seed %i: the editor boots and projects every generated document',
        (seed) => {
            const random = prng(seed * 7919);
            for (let index = 0; index < BOOT_CASES_PER_SEED; index++) {
                const source = generateDocument(random);
                const host = document.createElement('div');
                document.body.appendChild(host);
                let muya: Muya | null = null;
                try {
                    muya = new Muya(host, { markdown: source });
                    muya.init();
                    const canonical = muya.getMarkdown();
                    expect(roundTrip(canonical)).toBe(canonical);
                    muya.setOptions(
                        { criticMarkupProjection: 'original' },
                        false,
                    );
                    muya.setOptions(
                        { criticMarkupProjection: 'revised' },
                        false,
                    );
                    muya.setOptions(
                        { criticMarkupProjection: 'marked' },
                        false,
                    );
                }
                catch (error) {
                    throw new Error(
                        `editor boot/projection failed for ${JSON.stringify(source)}: ${String(error)}`,
                    );
                }
                finally {
                    muya?.destroy();
                    host.remove();
                }
            }
        },
    );
});
