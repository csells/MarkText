import { describe, expect, it } from 'vitest';
import { backspaceLength } from '..';

// Code units Chromium's Backspace removes at the end of a text node, recorded
// by pressing Backspace in an Electron 42 contenteditable after `X` + text.
const chromium: readonly (readonly [string, string, number])[] = [
    ['combining acute', 'é', 1],
    ['precomposed é', 'é', 1],
    ['two combining marks', 'ạ́', 1],
    ['Hebrew shin with dot and qamats', 'שָׁ', 1],
    ['Arabic letter with fatha', 'اَ', 1],
    ['decomposed Hangul syllable', '각', 1],
    ['Devanagari conjunct', 'क्षि', 1],
    ['Thai sara am', 'กำ', 1],
    ['ZWJ family', '\u{1F468}‍\u{1F469}‍\u{1F467}', 8],
    ['flag', '\u{1F1EF}\u{1F1F5}', 4],
    ['three regional indicators', '\u{1F1EF}\u{1F1F5}\u{1F1FA}', 2],
    ['keycap', '1️⃣', 3],
    ['bare keycap', '#⃣', 2],
    ['emoji with skin tone', '\u{1F44D}\u{1F3FD}', 4],
    ['surrogate-pair emoji', '\u{1F600}', 2],
    ['astral letter', '\u{1D49C}', 2],
    ['emoji presentation', '❤️', 2],
    ['text presentation after a letter', 'a︎', 2],
    ['tag sequence flag', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', 14],
    ['ZWJ sequence with a presentation selector', '\u{1F3F3}️‍\u{1F308}', 6],
    ['ZWJ sequence with a modifier', '\u{1F468}\u{1F3FD}‍\u{1F469}', 7],
    ['precomposed letter before a selector', 'é︎', 2],
    ['lone high surrogate', 'a\uD83D', 1],
    ['lone low surrogate', 'a\uDE00', 1],
    ['plain letter', 'ab', 1],
];

describe('backspaceLength', () => {
    it.each(chromium)('removes what Chromium removes after %s', (_name, text, length) => {
        expect(backspaceLength(`X${text}`)).toBe(length);
    });

    it('removes nothing from empty text', () => {
        expect(backspaceLength('')).toBe(0);
    });

    it('removes a CRLF line break whole', () => {
        expect(backspaceLength('a\r\n')).toBe(2);
    });

    it('never leaves half of a surrogate pair', () => {
        for (const [, text] of chromium) {
            const kept = `X${text}`.slice(0, -backspaceLength(`X${text}`));
            expect(kept).not.toMatch(/[\uD800-\uDBFF]$/);
        }
    });
});
