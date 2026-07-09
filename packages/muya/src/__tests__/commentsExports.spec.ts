// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
    analyzeMarkdownComments,
    serializeCommentMarker,
    serializeCommentMetadataDefinition,
    stripAnalyzedCommentSyntaxFromMarkdown,
    validateCommentGraph,
} from '../index';

describe('public comment exports', () => {
    it('exposes the wire-format serializers from the package entrypoint', () => {
        expect(serializeCommentMarker('cmt_1')).toBe('<!--MC:cmt_1-->');
        expect(serializeCommentMarker('cmt_1', 'close')).toBe('<!--MC:~cmt_1-->');
        expect(serializeCommentMetadataDefinition('cmt_1', 'data:x')).toBe('[MC:cmt_1]: data:x');
    });

    it('exports validateCommentGraph through the authoritative analyzer', () => {
        const markdown = [
            'Text <!--MC:a-->open only.',
            '',
            '[MC:orphan]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
            '',
        ].join('\n');

        expect(validateCommentGraph(markdown)).toEqual(analyzeMarkdownComments(markdown).comments.diagnostics);
    });

    it('exports the authoritative comment analyzer from the package entrypoint', () => {
        expect(analyzeMarkdownComments('plain text').comments).toEqual({
            threads: [],
            ranges: [],
            diagnostics: [],
        });
    });

    it('exports analyzer-backed comment syntax stripping from the package entrypoint', () => {
        expect(stripAnalyzedCommentSyntaxFromMarkdown('A <!--MC:a-->x<!--MC:~a-->.')).toBe('A x.');
    });

    it('does not expose legacy parser or raw source-index bypass helpers from public barrels', async () => {
        const root = await import('../index');
        const comments = await import('../comments');
        const legacyBypassExports = [
            'buildCommentSourceIndex',
            'collectSourceCommentIds',
            'commentSyntaxRangesForId',
            'parseMarkdownComments',
        ];

        for (const name of legacyBypassExports) {
            expect(root).not.toHaveProperty(name);
            expect(comments).not.toHaveProperty(name);
        }
    });
});
