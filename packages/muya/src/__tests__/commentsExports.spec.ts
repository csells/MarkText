// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { parseMarkdownComments, validateCommentGraph } from '../index';

describe('public comment exports', () => {
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
