// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
    parseMarkdownComments,
    serializeCommentMarker,
    serializeCommentMetadataDefinition,
    validateCommentGraph,
} from '../index';

describe('public comment exports', () => {
    it('exposes the wire-format serializers from the package entrypoint', () => {
        expect(serializeCommentMarker('cmt_1')).toBe('<!--MC:cmt_1-->');
        expect(serializeCommentMarker('cmt_1', 'close')).toBe('<!--MC:~cmt_1-->');
        expect(serializeCommentMetadataDefinition('cmt_1', 'data:x')).toBe('[MC:cmt_1]: data:x');
    });

    it('exports validateCommentGraph from the package entrypoint', () => {
        const markdown = [
            'Text <!--MC:a-->open only.',
            '',
            '[MC:orphan]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
            '',
        ].join('\n');

        expect(validateCommentGraph(markdown)).toEqual(parseMarkdownComments(markdown).diagnostics);
    });
});
