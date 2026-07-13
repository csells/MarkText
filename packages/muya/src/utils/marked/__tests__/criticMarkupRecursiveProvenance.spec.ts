// @vitest-environment happy-dom

// @ts-expect-error commonmark-spec is plain CommonJS without types
import commonMarkSpec from 'commonmark-spec';
import { describe, expect, it } from 'vitest';
import { plainMarkdown } from '../../../state/markdownSourceMap';
import { renderToStaticHTML } from '../../../state/renderToStaticHTML';
import { parseCriticMarkupDocument } from '../criticMarkupDocument';
import { getClipBoardHtml } from '../getClipboardHtml';

interface ICommonMarkExample {
    readonly markdown: string;
    readonly number: number;
    readonly section: string;
}

const CRITIC_ITEM = '{++critic++}';
const COMMONMARK_EXAMPLES = commonMarkSpec.tests as ICommonMarkExample[];
const CRITIC_OPTIONS = {
    criticMarkup: true,
    criticMarkupProjection: 'marked',
    footnote: false,
    frontMatter: false,
    gfm: true,
    isGitlabCompatibilityEnabled: false,
    math: false,
    superSubScript: false,
} as const;

function commonMarkExample(number: number): ICommonMarkExample {
    const example = COMMONMARK_EXAMPLES.find(candidate =>
        candidate.number === number);
    if (!example) {
        throw new RangeError(
            `CommonMark 0.31 does not contain example #${number}.`,
        );
    }
    return example;
}

function withCriticSuffix(markdown: string): string {
    return `${markdown}\n\n${CRITIC_ITEM}\n`;
}

const RECURSIVE_CONTAINER_CASES = [
    commonMarkExample(93),
    commonMarkExample(278),
    commonMarkExample(515),
];

const DUPLICATE_DEFINITION_CASES = [
    {
        number: 204,
        source: [
            '[foo]',
            '',
            '[foo]: first',
            '[foo]: /{++second++}',
            '',
        ].join('\n'),
    },
    {
        number: 544,
        source: [
            '[foo]: /url1',
            '',
            '[foo]: /{++url2++}',
            '',
            '[bar][foo]',
            '',
        ].join('\n'),
    },
];

describe('criticmarkup recursive parser provenance', () => {
    it.each(RECURSIVE_CONTAINER_CASES)(
        'source-locates one suffix after commonmark #$number ($section)',
        ({ markdown }) => {
            const source = withCriticSuffix(markdown);
            const itemStart = source.lastIndexOf(CRITIC_ITEM);
            const document = parseCriticMarkupDocument(
                plainMarkdown(source),
                CRITIC_OPTIONS,
            );

            expect(document.items).toHaveLength(1);
            expect(document.items[0].syntax).toMatchObject({
                raw: CRITIC_ITEM,
                range: {
                    start: itemStart,
                    end: itemStart + CRITIC_ITEM.length,
                },
            });
            expect(document.project('original')).toBe(
                `${source.slice(0, itemStart)}${source.slice(
                    itemStart + CRITIC_ITEM.length,
                )}`,
            );
            expect(document.project('revised')).toBe(
                `${source.slice(0, itemStart)}critic${source.slice(
                    itemStart + CRITIC_ITEM.length,
                )}`,
            );
        },
    );

    it.each(DUPLICATE_DEFINITION_CASES)(
        'keeps discarded duplicate-definition bytes literal for commonmark #$number shape',
        ({ source }) => {
            const document = parseCriticMarkupDocument(
                plainMarkdown(source),
                CRITIC_OPTIONS,
            );

            expect(document.items).toEqual([]);
            expect(document.project('original')).toBe(source);
            expect(document.project('revised')).toBe(source);
        },
    );

    it.each(RECURSIVE_CONTAINER_CASES)(
        'renders commonmark #$number plus a critic suffix to static html',
        ({ markdown }) => {
            const source = withCriticSuffix(markdown);

            expect(() => renderToStaticHTML(source, {
                ...CRITIC_OPTIONS,
                sanitize: false,
            })).not.toThrow();
        },
    );

    it.each(RECURSIVE_CONTAINER_CASES)(
        'renders commonmark #$number plus a critic suffix to clipboard html',
        ({ markdown }) => {
            const source = withCriticSuffix(markdown);

            expect(() => getClipBoardHtml(source, CRITIC_OPTIONS))
                .not
                .toThrow();
        },
    );

    it.each(DUPLICATE_DEFINITION_CASES)(
        'renders discarded duplicate-definition critic bytes for commonmark #$number shape',
        ({ source }) => {
            expect(() => renderToStaticHTML(source, {
                ...CRITIC_OPTIONS,
                sanitize: false,
            })).not.toThrow();
            expect(() => getClipBoardHtml(source, CRITIC_OPTIONS))
                .not
                .toThrow();
        },
    );

    it.each(COMMONMARK_EXAMPLES)(
        'renders critic-suffixed commonmark 0.31 #$number without throwing',
        ({ markdown }) => {
            const source = withCriticSuffix(markdown);

            expect(() => renderToStaticHTML(source, {
                ...CRITIC_OPTIONS,
                sanitize: false,
            })).not.toThrow();
        },
    );
});
