// The block-path parser (`parseMarkdownComments`, used for the thread list and
// in-document highlights) and the character-offset index (`buildCommentSourceIndex`,
// used to map the source-mode CodeMirror cursor to comment ranges) emit different
// coordinate systems, but they MUST agree on which comment ids exist in a
// document. If they drift, the sidebar thread list and the source-mode
// highlight/active-comment detection silently disagree. This locks the invariant
// at build time (mirrors the "streaming agrees with batch" test for ignored ranges).
import { describe, expect, it } from 'vitest';
import { parseMarkdownComments } from '../parse';
import { buildCommentSourceIndex } from '../source';

const META = '[MC:%ID%]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';

function meta(...commentIds: string[]): string {
    return commentIds.map(id => META.replace('%ID%', id)).join('\n');
}

function idSet(list: ReadonlyArray<{ id: string }>): string[] {
    return [...new Set(list.map(entry => entry.id))].sort();
}

const CASES: Array<{ name: string; markdown: string }> = [
    {
        name: 'single inline comment',
        markdown: `Text <!--MC:a-->reviewed<!--MC:~a--> end\n\n${meta('a')}\n`,
    },
    {
        name: 'overlapping comments',
        markdown: `<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->\n\n${meta('a', 'b')}\n`,
    },
    {
        name: 'cross-block comment (open and close in different paragraphs)',
        markdown: `<!--MC:a-->first para\n\nsecond para<!--MC:~a-->\n\n${meta('a')}\n`,
    },
    {
        name: 'markers inside inline code are ignored by both',
        markdown: `Live <!--MC:a-->x<!--MC:~a--> then \`<!--MC:code-->y<!--MC:~code-->\`\n\n${meta('a')}\n`,
    },
    {
        name: 'markers inside inline math are ignored by both',
        markdown: `Live <!--MC:a-->x<!--MC:~a--> then $<!--MC:math-->y<!--MC:~math-->$\n\n${meta('a')}\n`,
    },
    {
        name: 'markers inside a fenced code block are ignored by both',
        markdown: `<!--MC:a-->real<!--MC:~a-->\n\n\`\`\`\n<!--MC:fenced-->nope<!--MC:~fenced-->\n\`\`\`\n\n${meta('a')}\n`,
    },
    {
        name: 'front matter with marker-looking text is ignored by both',
        markdown: `---\ntitle: <!--MC:fm-->x<!--MC:~fm-->\n---\n\nBody <!--MC:a-->text<!--MC:~a-->\n\n${meta('a')}\n`,
    },
    {
        name: 'line-start and standalone markers',
        markdown: `<!--MC:a-->heading text<!--MC:~a--> tail\n\nplain\n\n${meta('a')}\n`,
    },
    {
        name: 'multiple independent comments',
        markdown: `<!--MC:a-->one<!--MC:~a--> and <!--MC:b-->two<!--MC:~b-->\n\nmore <!--MC:c-->three<!--MC:~c-->\n\n${meta('a', 'b', 'c')}\n`,
    },
    {
        name: 'no comments at all',
        markdown: 'Just some plain text with no markers.\n',
    },
    // Container-context cases: the hand-rolled line classifier used to
    // diverge from the parser on exactly these (loose-list continuations
    // classified as indented code, blockquote-nested definitions invisible
    // to a line-start regexp, fences behind '>' prefixes never opening).
    {
        name: 'marker on a 4-space loose-list continuation line is live to both',
        markdown: `- item\n\n    text <!--MC:a-->hello<!--MC:~a--> tail\n\n${meta('a')}\n`,
    },
    {
        name: 'markers inside a blockquoted fence are literal to both',
        markdown: `> \`\`\`\n> <!--MC:lit-->x<!--MC:~lit-->\n> \`\`\`\n\nlive <!--MC:a-->y<!--MC:~a-->\n\n${meta('a')}\n`,
    },
    {
        name: 'markers on an indented line inside a blockquote paragraph are live to both',
        markdown: `> lead\n>     cont <!--MC:a-->x<!--MC:~a-->\n\n${meta('a')}\n`,
    },
];

// A definition is live wherever the parser's state walk sees one — including
// nested in a blockquote — and literal inside code/front matter. Def ids on
// the parse side are threads (def + markers + valid payload) plus the
// metadata-shaped diagnostics.
const DEFINITION_CASES: Array<{ name: string; markdown: string }> = [
    {
        name: 'blockquote-nested definition',
        markdown: `<!--MC:a-->x<!--MC:~a-->\n\n> ${META.replace('%ID%', 'a')}\n`,
    },
    {
        name: 'list-nested definition',
        markdown: `<!--MC:a-->x<!--MC:~a-->\n\n- ${META.replace('%ID%', 'a')}\n`,
    },
    {
        name: 'definition inside a fenced block is literal to both',
        markdown: `<!--MC:a-->x<!--MC:~a-->\n\n\`\`\`\n${META.replace('%ID%', 'ghost')}\n\`\`\`\n\n${meta('a')}\n`,
    },
];

describe('comment parser consistency: block-path parser vs source-char index', () => {
    for (const { name, markdown } of CASES) {
        it(`agrees on comment ids: ${name}`, () => {
            const parsed = idSet(parseMarkdownComments(markdown, { frontMatter: true, math: true }).ranges);
            const indexed = idSet(buildCommentSourceIndex(markdown).commentRanges);
            expect(indexed).toEqual(parsed);
        });
    }

    for (const { name, markdown } of [...CASES, ...DEFINITION_CASES]) {
        it(`agrees on metadata definition ids: ${name}`, () => {
            const comments = parseMarkdownComments(markdown, { frontMatter: true, math: true });
            const parsedDefIds = [...new Set([
                ...comments.threads.map(thread => thread.id),
                ...comments.diagnostics
                    .filter(d => d.code === 'orphan-metadata' || d.code === 'duplicate-metadata' || d.code === 'invalid-metadata')
                    .map(d => d.id),
            ])].sort();
            const indexedDefIds = idSet(buildCommentSourceIndex(markdown).metadataDefinitions);
            expect(indexedDefIds).toEqual(parsedDefIds);
        });
    }
});
