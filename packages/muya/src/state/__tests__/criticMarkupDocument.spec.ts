import { describe, expect, it } from 'vitest';
import {
    FRONT_MATTER_CORPUS,
    FRONT_MATTER_DISABLED_CORPUS,
    FRONT_MATTER_LOOKALIKE_CORPUS,
    IDENTICAL_SUBSTITUTION_ARM_CORPUS,
} from '../../criticMarkup/__tests__/sharedCorpus';
import { createCriticMarkupDocument } from '../../criticMarkup/document';
import { analyzeCriticMarkupMarkdownState } from '../../criticMarkup/markdownState';
import {
    criticMarkupParserProfile,
    projectCriticMarkupMarkdown,
    snapshotCriticMarkupParserOptions,
} from '../../utils/marked/criticMarkupDocument';
import StateToMarkdown from '../stateToMarkdown';

function parse(
    markdown: string,
    options: { frontMatter?: boolean } = {},
) {
    const frontMatter = options.frontMatter ?? true;
    // The canonical fragment-bearing document is backed by the one state
    // parser artifact: analysis and bindings from the same native parse.
    const lex = snapshotCriticMarkupParserOptions({
        footnote: false,
        math: true,
        isGitlabCompatibilityEnabled: true,
        frontMatter,
    });
    const analyzed = analyzeCriticMarkupMarkdownState(markdown, {
        listIndentation: 1,
        trimUnnecessaryCodeBlockEmptyLines: false,
        lex,
    });
    const sourceMap = new StateToMarkdown().generateMapped(analyzed.states);
    if (!analyzed.analysis) {
        throw new TypeError(
            'Fixture Markdown did not produce a CriticMarkup analysis.',
        );
    }
    return createCriticMarkupDocument(
        analyzed.analysis,
        sourceMap,
        criticMarkupParserProfile(lex),
        'complete',
        analyzed.bindings,
    );
}

describe('parser-native CriticMarkup document model', () => {
    it('maps one semantic item through paragraph and heading states', () => {
        const document = parse('before {++one\n\n# two++} after\n');

        expect(document.items).toHaveLength(1);
        expect(document.items[0].syntax).toMatchObject({
            type: 'addition',
            content: 'one\n\n# two',
        });
        expect(document.items[0].fragments.map(fragment => ({
            path: fragment.path,
            role: fragment.role,
        }))).toEqual([
            { path: [0, 'text'], role: 'start' },
            { path: [1, 'text'], role: 'end' },
        ]);
    });

    it('uses Markdown parser contexts for link destinations and fenced code', () => {
        const document = parse([
            '[visible](https://example.test/{++literal++})',
            '',
            '```md',
            '{--literal--}',
            '```',
            '',
            '{++real++}',
            '',
        ].join('\n'));

        expect(document.items.map(item => item.syntax.raw)).toEqual([
            '{++real++}',
        ]);
    });

    it('models image visible text while keeping destination and title literal', () => {
        const source = '![{++alt++}](img/{--path--}.png "{>>title<<}")\n';
        const document = parse(source);

        expect(document.items.map(item => item.syntax.raw))
            .toEqual(['{++alt++}']);
        expect(document.project('original'))
            .toBe('![](img/{--path--}.png "{>>title<<}")\n');
        expect(document.project('revised'))
            .toBe('![alt](img/{--path--}.png "{>>title<<}")\n');
    });

    it('uses the active math parser context across delimiter-like bytes', () => {
        const document = parse('{++before $x ++} y$ after++}\n');

        expect(document.items).toHaveLength(1);
        expect(document.items[0].syntax.raw)
            .toBe('{++before $x ++} y$ after++}');
    });

    it.each(FRONT_MATTER_CORPUS)(
        'keeps $id literal and byte-identical in both projections',
        (row) => {
            const document = parse(row.source, row.options);

            expect(document.items.map(item => item.syntax.type))
                .toEqual(row.expected.itemTypes);
            expect(document.items.map(item => item.syntax.raw))
                .toEqual(row.expected.itemRaw);
            expect(projectCriticMarkupMarkdown(
                row.source,
                'original',
                row.options,
            )).toBe(row.expected.original);
            expect(projectCriticMarkupMarkdown(
                row.source,
                'revised',
                row.options,
            )).toBe(row.expected.revised);
        },
    );

    it.each(FRONT_MATTER_LOOKALIKE_CORPUS)(
        'does not over-exclude $id',
        (row) => {
            const document = parse(row.source, row.options);

            expect(document.items.map(item => item.syntax.type))
                .toEqual(row.expected.itemTypes);
            expect(document.items.map(item => item.syntax.raw))
                .toEqual(row.expected.itemRaw);
        },
    );

    it.each(FRONT_MATTER_DISABLED_CORPUS)(
        'treats $id as ordinary Markdown',
        (row) => {
            const document = parse(row.source, row.options);

            expect(document.items.map(item => item.syntax.type))
                .toEqual(row.expected.itemTypes);
            expect(document.items.map(item => item.syntax.raw))
                .toEqual(row.expected.itemRaw);
            expect(projectCriticMarkupMarkdown(
                row.source,
                'original',
                row.options,
            )).toBe(row.expected.original);
            expect(projectCriticMarkupMarkdown(
                row.source,
                'revised',
                row.options,
            )).toBe(row.expected.revised);
        },
    );

    it.each(IDENTICAL_SUBSTITUTION_ARM_CORPUS)(
        'maps $id without aliasing repeated source text',
        (row) => {
            const document = parse(row.source, row.options);

            expect(document.items.map(item => item.syntax.type))
                .toEqual(row.expected.itemTypes);
            expect(document.items.map(item => item.syntax.raw))
                .toEqual(row.expected.itemRaw);
            expect(projectCriticMarkupMarkdown(row.source, 'original'))
                .toBe(row.expected.original);
            expect(projectCriticMarkupMarkdown(row.source, 'revised'))
                .toBe(row.expected.revised);
        },
    );
});
