// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { MarkdownToState } from '../markdownToState';
import StateToMarkdown from '../stateToMarkdown';

const OPTIONS = {
    footnote: false,
    math: true,
    frontMatter: true,
    isGitlabCompatibilityEnabled: true,
    trimUnnecessaryCodeBlockEmptyLines: false,
};

function roundTrip(source: string): string {
    return new StateToMarkdown({ listIndentation: 1 }).generate(
        new MarkdownToState(OPTIONS).generate(source),
    );
}

// A block-spanning marker whose opener ends its line puts the payload's
// leading newline INSIDE the item ({++\n…). The serializer must keep that
// byte after the opener; hoisting it before the opener changes the item's
// payload, fails the lowering exactness check, and crashed editor boot on
// such documents (found via the packaged-app walkthrough, 2026-07-17).
describe('block-spanning opener on its own line', () => {
    const SOURCES = [
        '{++\nplain added text\n++}\n',
        '{++\n- first added item\n- second added item\n++}\n',
        'intro:\n\n{++\n- first\n++}\n',
        'intro:\n\n{--\nremoved paragraph\n--}\n',
        '{==\nspanning highlight\n==}\n',
        '{++\n\nblank line after opener\n++}\n',
    ];

    it.each(SOURCES)('round-trips %j byte-exactly', (source) => {
        expect(roundTrip(source)).toBe(source);
    });

    it.each(SOURCES)('boots the editor on %j', (source) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, { markdown: source });
        try {
            muya.init();
            expect(muya.getMarkdown()).toBe(source);
        }
        finally {
            muya.destroy();
            host.remove();
        }
    });
});
