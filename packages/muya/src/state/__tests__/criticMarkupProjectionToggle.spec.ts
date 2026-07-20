// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

function createEditor(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    return muya;
}

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

describe('projection toggle cost model', () => {
    it('projects an item-free document without reparsing', () => {
        const muya = createEditor('plain one\n\nplain two\n');
        const parse = vi.spyOn(muya.editor.jsonState, 'markdownToState');

        muya.setOptions({ criticMarkupProjection: 'original' }, false);
        expect(muya.getMarkdown()).toBe('plain one\n\nplain two\n');
        muya.setOptions({ criticMarkupProjection: 'marked' }, false);

        // No Critic items means every projection is byte-identical to the
        // canonical document: deriving it must not re-run the parser.
        expect(parse).not.toHaveBeenCalled();
    });

    it('parses each projection of an item-bearing revision at most once', () => {
        const muya = createEditor('keep {++new++} and {--old--}\n');
        const parse = vi.spyOn(muya.editor.jsonState, 'markdownToState');

        for (let round = 0; round < 3; round++) {
            muya.setOptions({ criticMarkupProjection: 'original' }, false);
            muya.setOptions({ criticMarkupProjection: 'marked' }, false);
            muya.setOptions({ criticMarkupProjection: 'revised' }, false);
            muya.setOptions({ criticMarkupProjection: 'marked' }, false);
        }

        // The document never changed, so repeated toggling may parse each
        // read-only projection at most once (or zero times when the reset
        // already precomputed them) — never once per toggle.
        expect(parse.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('keeps projected content correct across cached toggles after an edit', () => {
        const muya = createEditor('keep {++new++} tail\n');

        muya.setOptions({ criticMarkupProjection: 'original' }, false);
        expect(
            muya.editor.scrollPage!.firstContentInDescendant()!.text,
        ).toBe('keep  tail');
        muya.setOptions({ criticMarkupProjection: 'marked' }, false);

        // Change the document; the projection cache must not serve the old
        // revision's states.
        muya.setContent('keep {++brand-new++} tail\n');
        muya.setOptions({ criticMarkupProjection: 'original' }, false);
        expect(
            muya.editor.scrollPage!.firstContentInDescendant()!.text,
        ).toBe('keep  tail');
        muya.setOptions({ criticMarkupProjection: 'revised' }, false);
        expect(
            muya.editor.scrollPage!.firstContentInDescendant()!.text,
        ).toBe('keep brand-new tail');
    });

    it('invalidates cached projections when the parser profile changes without a document edit', () => {
        const muya = createEditor('keep {++new++} tail\n');
        muya.editor.cancelProjectionWarmup();
        const parse = vi.spyOn(muya.editor.jsonState, 'markdownToState');

        muya.setOptions({ criticMarkupProjection: 'original' }, false);
        muya.setOptions({ criticMarkupProjection: 'marked' }, false);
        expect(parse).toHaveBeenCalledOnce();
        parse.mockClear();

        // The source revision is unchanged, but footnote participates in the
        // native Markdown parser profile. Its projected states must not come
        // from the old profile's cache.
        muya.setOptions({ footnote: true }, false);
        muya.setOptions({ criticMarkupProjection: 'original' }, false);

        expect(parse).toHaveBeenCalledOnce();
    });

    it('marks projections cold and rewarms after a parser-profile change', () => {
        vi.useFakeTimers();
        try {
            const muya = createEditor('keep {++new++} tail\n');
            vi.runAllTimers();
            expect(muya.domNode.getAttribute('data-critic-warm')).toBe('true');

            muya.setOptions({ footnote: true }, false);

            expect(muya.domNode.getAttribute('data-critic-warm')).toBeNull();
            vi.runAllTimers();
            expect(muya.domNode.getAttribute('data-critic-warm')).toBe('true');
        }
        finally {
            vi.useRealTimers();
        }
    });

    it('reschedules the projection warmup when a mutation is in flight', () => {
        vi.useFakeTimers();
        try {
            const muya = createEditor('keep {++new++} tail\n');
            muya.domNode.removeAttribute('data-critic-warm');
            muya.editor.scheduleProjectionWarmup();

            // The timer fires while another mutation holds the authority: the
            // warmup must defer, not silently drop — otherwise the steady
            // interactive marker never appears until the next document reset.
            muya.editor.mutationGateway.run({ kind: 'user-command' }, () => {
                vi.advanceTimersByTime(1);
            });
            expect(muya.domNode.getAttribute('data-critic-warm')).toBeNull();

            vi.runAllTimers();
            expect(muya.domNode.getAttribute('data-critic-warm')).toBe('true');
        }
        finally {
            vi.useRealTimers();
        }
    });

    it('does not move the caret when a pure projection toggle re-renders', () => {
        const muya = createEditor('alpha {==spot==} omega\n');
        muya.editor.selection.clear();
        muya.editor.activeContentBlock = null;
        expect(muya.editor.activeContentBlock).toBeNull();

        muya.setOptions({ criticMarkupProjection: 'original' }, false);
        muya.setOptions({ criticMarkupProjection: 'marked' }, false);

        // Nothing was focused before the view switch; switching views is not
        // an edit and must not grab focus or seat a caret at document start.
        expect(muya.editor.activeContentBlock).toBeNull();
    });
});
