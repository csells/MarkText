import { describe, expect, it, vi } from 'vitest';
import { MarkdownToState } from '../../state/markdownToState';
import { parseMarkdownComments } from '../parse';

// parseMarkdownComments runs on every file open. Re-parsing the whole document
// via MarkdownToState is expensive on large files, and the overwhelmingly common
// case is a document with no MC comments at all — which can be detected with a
// cheap substring scan before paying for a full parse.
describe('parseMarkdownComments load performance', () => {
    it('skips the full markdown parse when the document contains no MC syntax', () => {
        const doc = Array.from(
            { length: 2000 },
            (_, i) => `## Heading ${i}\n\ntext [a](http://x) and \`code\`.\n`,
        ).join('\n');
        const generate = vi.spyOn(MarkdownToState.prototype, 'generate');

        const result = parseMarkdownComments(doc);

        expect(generate).not.toHaveBeenCalled();
        expect(result).toEqual({ threads: [], ranges: [], diagnostics: [] });
        generate.mockRestore();
    });

    it('still parses documents that contain MC syntax', () => {
        const generate = vi.spyOn(MarkdownToState.prototype, 'generate');

        parseMarkdownComments('Text <!--MC:a-->x<!--MC:~a--> more.');

        expect(generate).toHaveBeenCalled();
        generate.mockRestore();
    });
});
