import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../../state/markdownToState';
import { commentModelView, extractCommentModel } from '../model';
import { parseMarkdownComments } from '../parse';

// One comment-semantics owner (quality-review-fix-plan finding 1): the
// byte-level analyzer and the runtime model view must BE the same
// implementation — parseMarkdownComments = commentModelView ∘
// extractCommentModel. These specs pin the two behaviors the view lost
// while the implementations were forked, and pin the equivalence itself
// over the drift-prone corpus.

function parse(markdown: string) {
    return new MarkdownToState({
        footnote: false,
        math: true,
        isGitlabCompatibilityEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: true,
    } as ConstructorParameters<typeof MarkdownToState>[0]).generate(markdown);
}

function view(markdown: string) {
    const { states, model } = extractCommentModel(parse(markdown));
    return commentModelView(model, states);
}

describe('unified semantics — the view carries the analyzer diagnostics', () => {
    it('preserves the decode error detail on invalid-metadata', () => {
        const doc = [
            'A <!--MC:a-->x<!--MC:~a--> line.',
            '',
            '[MC:a]: {"version":2,"status":"open"',
            '',
        ].join('\n');

        const fromParse = parseMarkdownComments(doc);
        const fromView = view(doc);

        const parseDiag = fromParse.diagnostics.find(d => d.code === 'invalid-metadata');
        const viewDiag = fromView.diagnostics.find(d => d.code === 'invalid-metadata');
        expect(parseDiag).toBeDefined();
        expect(viewDiag).toBeDefined();
        // The analyzer carries the underlying decode error; the view must
        // carry the SAME message, not a re-derived generic one.
        expect(viewDiag!.message).toBe(parseDiag!.message);
    });

    it('reports malformed marker shapes from a loaded file', () => {
        const doc = 'A <!--MC:bad.id-->kept<!--MC:~bad.id--> line.\n';

        const fromView = view(doc);

        expect(fromView.diagnostics).toContainEqual(expect.objectContaining({
            code: 'malformed-marker',
            id: 'bad.id',
        }));
    });

    it('does not diagnose marker shapes inside literal contexts', () => {
        const doc = [
            '```',
            '<!--MC:bad.id-->documentation<!--MC:~bad.id-->',
            '```',
            '',
            'And `<!--MC:x.y-->` inline.',
            '',
        ].join('\n');

        expect(view(doc).diagnostics).toEqual([]);
    });

    it('matches the analyzer on the duplicate-marker corpus', () => {
        const corpus = [
            // duplicate open + its own close: the dup pair is consumed with
            // one diagnostic, never an extra duplicate-close.
            'a <!--MC:a-->x<!--MC:a-->y<!--MC:~a-->z<!--MC:~a--> b\n\n[MC:a]: {"version":2,"status":"open"}\n',
            // duplicate close after a completed range.
            'a <!--MC:a-->x<!--MC:~a--> y<!--MC:~a--> b\n\n[MC:a]: {"version":2,"status":"open"}\n',
            // orphan close, no open anywhere.
            'a <!--MC:~zz--> b\n',
            // unclosed open.
            'a <!--MC:open1-->tail\n',
            // duplicate metadata heads, second decodable.
            'a <!--MC:m-->x<!--MC:~m--> b\n\n[MC:m]: {"version":2,"status":"open"}\n[MC:m]: {"version":2,"status":"resolved"}\n',
        ];

        for (const doc of corpus) {
            const fromParse = parseMarkdownComments(doc);
            const fromView = view(doc);
            const key = (d: { code: string; id: string }) => `${d.code}:${d.id}`;
            expect(fromView.diagnostics.map(key).sort(), doc).toEqual(
                fromParse.diagnostics.map(key).sort(),
            );
            expect(fromView.ranges.map(r => r.id).sort(), doc).toEqual(
                fromParse.ranges.map(r => r.id).sort(),
            );
        }
    });
});
