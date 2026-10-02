// @vitest-environment happy-dom
import type Prism from 'prismjs';
import { describe, expect, it } from 'vitest';
import prism from '../index';
import { PREFILTERED_PATTERNS, prefilteredGrammar } from '../prefilteredGrammar';
import { tokenizeReusing } from '../tokenizeReusing';

// A prefiltered grammar skips a pattern's search of text that lacks what
// its every match needs, and tokenizes every text as Prism does.

type Stream = Prism.TokenStream;

function plain(stream: Stream): unknown {
    if (typeof stream === 'string')
        return stream;
    if (Array.isArray(stream))
        return stream.map(plain);
    return { type: stream.type, alias: stream.alias, length: stream.length, content: plain(stream.content) };
}

function patternsOf(grammar: Prism.Grammar): string[] {
    return Object.values(grammar as Record<string, Prism.GrammarValue>).flatMap(value =>
        (Array.isArray(value) ? value : [value]).map((entry) => {
            const pattern = entry instanceof RegExp ? entry : entry.pattern;
            return `${pattern.flags}/${pattern.source}`;
        }));
}

describe('prefilteredGrammar', () => {
    // A Prism upgrade that changes one of these patterns fails here rather
    // than leaving its prefilter guarding a different pattern.
    it('knows only patterns the installed JavaScript grammar holds', () => {
        const installed = patternsOf(prism.languages.javascript!);
        for (const pattern of PREFILTERED_PATTERNS)
            expect(installed, pattern).toContain(pattern);
        const regExps = (grammar: Prism.Grammar) => Object.values(grammar as Record<string, Prism.GrammarValue>).flatMap(value =>
            (Array.isArray(value) ? value : [value]).map(entry => entry instanceof RegExp ? entry : entry.pattern));
        const original = regExps(prism.languages.javascript!);
        const filtered = regExps(prefilteredGrammar(prism.languages.javascript!));
        expect(filtered.filter((pattern, index) => pattern !== original[index])).toHaveLength(PREFILTERED_PATTERNS.length);
    });

    const pieces = ['x', ' ', '\n', '(', ')', '{', '}', '=>', 'function ', ':', '.prototype', 'new ', 'class ', ',', '"', '//', '=', 'async ', '[', ']'];
    const bases = {
        bare: Array.from({ length: 60 }, (_, index) => `const value${index} = ${index}`).join('\n'),
        calls: Array.from({ length: 30 }, (_, index) => `const f${index} = (a, b) => g(a)\nclass A${index} extends B { m(x) { return { k: x } } }`).join('\n'),
    };

    it.each(Object.keys(bases))('tokenizes %s JavaScript as Prism does after each of many keys', (kind) => {
        const grammar = prism.languages.javascript!;
        const filtered = prefilteredGrammar(grammar);
        let seed = kind.length * 104729;
        const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        let text = bases[kind as keyof typeof bases];
        let fragments;
        for (let key = 0; key < 300; key += 1) {
            const at = Math.floor(random() * (text.length + 1));
            text = random() < 0.7
                ? text.slice(0, at) + pieces[Math.floor(random() * pieces.length)] + text.slice(at)
                : text.slice(0, at) + text.slice(at + 1 + Math.floor(random() * 3));
            const read = tokenizeReusing(text, filtered, fragments);
            expect(plain(read.tokens), JSON.stringify(text)).toEqual(plain(prism.tokenize(text, grammar)));
            expect(plain(prism.tokenize(text, filtered))).toEqual(plain(read.tokens));
            fragments = read.fragments;
        }
    });
});
