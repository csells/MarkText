// @vitest-environment happy-dom

import type { ICriticMarkupCorpusRow } from '../../criticMarkup/__tests__/sharedCorpus';
import type { ICriticMarkupItem } from '../../criticMarkup/commands';
import type { ICriticMarkupDocumentItem } from '../../criticMarkup/document';
import { afterEach, describe, expect, it } from 'vitest';
import { CRITIC_MARKUP_CORPUS } from '../../criticMarkup/__tests__/sharedCorpus';
import { createCriticMarkupDocument } from '../../criticMarkup/document';
import { analyzeCriticMarkupMarkdownState } from '../../criticMarkup/markdownState';
import { localOffset } from '../../mappedText';
import { Muya } from '../../muya';
import {
    criticMarkupParserProfile,
    projectCriticMarkupMarkdown,
    snapshotCriticMarkupParserOptions,
} from '../../utils/marked/criticMarkupDocument';
import { getClipBoardHtml } from '../../utils/marked/getClipboardHtml';
import { renderToStaticHTML } from '../renderToStaticHTML';
import StateToMarkdown from '../stateToMarkdown';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function parserOptions(
    options: ICriticMarkupCorpusRow['options'] = {},
) {
    return {
        footnote: options.footnote ?? false,
        math: options.math ?? true,
        isGitlabCompatibilityEnabled:
            options.isGitlabCompatibilityEnabled ?? true,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: options.frontMatter ?? false,
        superSubScript: options.superSubScript ?? true,
    };
}

function canonicalSource(row: (typeof CRITIC_MARKUP_CORPUS)[number]) {
    return row.normalization.kind === 'exact'
        ? row.source
        : row.normalization.output;
}

function parse(source: string, rowOptions: ICriticMarkupCorpusRow['options']) {
    const options = parserOptions(rowOptions);
    // The canonical fragment-bearing document is backed by the one state
    // parser artifact: analysis and bindings from the same native parse.
    const analyzed = analyzeCriticMarkupMarkdownState(source, {
        listIndentation: 1,
        trimUnnecessaryCodeBlockEmptyLines:
            options.trimUnnecessaryCodeBlockEmptyLines,
        lex: snapshotCriticMarkupParserOptions(options),
    });
    const sourceMap = new StateToMarkdown().generateMapped(analyzed.states);

    expect(sourceMap.text).toBe(source);
    if (!analyzed.analysis) {
        throw new TypeError(
            'Corpus source did not produce a CriticMarkup analysis.',
        );
    }
    return createCriticMarkupDocument(
        analyzed.analysis,
        sourceMap,
        criticMarkupParserProfile(options),
        'complete',
        analyzed.bindings,
    );
}

function boot(source: string, rowOptions: ICriticMarkupCorpusRow['options']) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown: source,
        ...parserOptions(rowOptions),
    });
    muya.init();
    editors.push(muya);
    return muya;
}

function declaredItems(row: ICriticMarkupCorpusRow) {
    return row.expected.itemContracts.map((contract) => {
        const type = row.expected.itemTypes[contract.itemIndex];
        const raw = row.expected.itemRaw[contract.itemIndex];
        if (type === undefined || raw === undefined) {
            throw new RangeError(
                `${row.id} item contract ${contract.itemIndex} has no declared syntax.`,
            );
        }

        return { type, raw, ...contract };
    });
}

function fragmentSummary(
    fragment: ICriticMarkupDocumentItem['fragments'][number],
) {
    return {
        role: fragment.role,
        path: fragment.path,
        localRange: fragment.localRange,
        sourceRange: fragment.sourceRange,
    };
}

function documentItemSummaries(items: readonly ICriticMarkupDocumentItem[]) {
    const itemIndexById = new Map(
        items.map((item, index) => [item.id, index]),
    );

    return items.map((item, documentOrder) => {
        const parentIndex = item.parentId === null
            ? null
            : itemIndexById.get(item.parentId);
        if (parentIndex === undefined) {
            throw new RangeError(
                `CriticMarkup item ${item.id} references unknown parent ${item.parentId}.`,
            );
        }

        return {
            type: item.syntax.type,
            raw: item.syntax.raw,
            itemIndex: documentOrder,
            sourceRange: item.syntax.range,
            parentIndex,
            depth: item.depth,
            documentOrder,
            fragments: item.fragments.map(fragmentSummary),
        };
    });
}

function declaredCommandItem(item: ReturnType<typeof declaredItems>[number]) {
    return {
        type: item.type,
        raw: item.raw,
        sourceRange: item.sourceRange,
        documentOrder: item.documentOrder,
        fragments: item.fragments,
    };
}

function commandItemSummaries(items: readonly ICriticMarkupItem[]) {
    return items.map((item, documentOrder) => ({
        type: item.type,
        raw: item.raw,
        sourceRange: {
            start: item.sourceStart,
            end: item.sourceEnd,
        },
        documentOrder,
        fragments: item.fragments.map(fragmentSummary),
    }));
}

function htmlItemSummary(html: string) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const byId = new Map<string, {
        type: string;
        sourceRange: { start: number; end: number };
        roles: string[];
    }>();

    for (const element of root.querySelectorAll<HTMLElement>(
        '[data-critic-id]',
    )) {
        const id = element.dataset.criticId!;
        const current = byId.get(id) ?? {
            type: element.dataset.criticType!,
            sourceRange: {
                start: Number(element.dataset.start),
                end: Number(element.dataset.end),
            },
            roles: [],
        };
        current.roles.push(element.dataset.criticRole!);
        byId.set(id, current);
    }

    return [...byId.values()].sort((left, right) =>
        left.sourceRange.start - right.sourceRange.start
        || right.sourceRange.end - left.sourceRange.end);
}

function expectedHtmlItems(
    row: ICriticMarkupCorpusRow,
    items: ReturnType<typeof declaredItems>,
) {
    const plainTextIdentity = new Set(row.expected.plainTextItems.map(item =>
        `${item.itemIndex}:${item.sourceRange.start}:${item.sourceRange.end}`));

    return items.flatMap((item) => {
        const identity
            = `${item.itemIndex}:${item.sourceRange.start}:${item.sourceRange.end}`;
        return plainTextIdentity.has(identity)
            ? []
            : [{
                    type: item.type,
                    sourceRange: item.sourceRange,
                    roles: item.fragments.map(fragment => fragment.role),
                }];
    });
}

function deepestFirstItem(items: readonly ICriticMarkupItem[]) {
    return [...items].sort((left, right) =>
        (left.sourceEnd - left.sourceStart)
        - (right.sourceEnd - right.sourceStart)
        || right.sourceStart - left.sourceStart)[0];
}

function resolveIndividually(
    source: string,
    row: ICriticMarkupCorpusRow,
    decision: 'accept' | 'reject',
) {
    const muya = boot(source, row.options);
    let resolved = 0;
    for (;;) {
        const target = deepestFirstItem(muya.getCriticMarkupItems());
        if (!target)
            return { count: resolved, markdown: muya.getMarkdown() };

        expect(muya.resolveCriticMarkup(decision, target)).toBe(true);
        resolved++;
        if (resolved > row.expected.itemContracts.length) {
            throw new RangeError(
                `${row.id} resolution created more items than its declared contract.`,
            );
        }
    }
}

function resolveInBulk(
    source: string,
    row: ICriticMarkupCorpusRow,
    decision: 'accept' | 'reject',
) {
    const muya = boot(source, row.options);
    const count = muya.resolveAllCriticMarkup(decision);
    return { count, markdown: muya.getMarkdown() };
}

describe('criticMarkup cross-consumer parity corpus', () => {
    it.each(CRITIC_MARKUP_CORPUS)(
        'keeps canonical/live/Review/HTML/clipboard parity for $id',
        (row) => {
            const source = canonicalSource(row);
            const options = parserOptions(row.options);
            const canonical = parse(source, row.options);
            const expected = declaredItems(row);

            expect(row.expected.itemTypes).toHaveLength(expected.length);
            expect(row.expected.itemRaw).toHaveLength(expected.length);
            expect(expected.map(item => item.itemIndex)).toEqual(
                expected.map((_, index) => index),
            );
            expect(expected.map(item => item.documentOrder)).toEqual(
                expected.map((_, index) => index),
            );
            for (const item of expected) {
                expect(source.slice(
                    item.sourceRange.start,
                    item.sourceRange.end,
                )).toBe(item.raw);
                if (item.parentIndex !== null) {
                    expect(item.parentIndex).toBeLessThan(item.itemIndex);
                    expect(item.depth).toBe(
                        expected[item.parentIndex].depth + 1,
                    );
                }
            }

            expect(documentItemSummaries(canonical.items)).toEqual(expected);
            expect(canonical.excludedRanges.ranges)
                .toEqual(row.expected.literalRanges);
            expect(projectCriticMarkupMarkdown(
                row.source,
                'original',
                options,
            )).toBe(row.expected.original);
            expect(projectCriticMarkupMarkdown(
                row.source,
                'revised',
                options,
            )).toBe(row.expected.revised);
            for (const plainTextItem of row.expected.plainTextItems) {
                expect(expected[plainTextItem.itemIndex]?.sourceRange)
                    .toEqual(plainTextItem.sourceRange);
            }

            const expectedHtml = expectedHtmlItems(row, expected);
            const muya = boot(source, row.options);
            const live = muya.editor.criticMarkupDocument.get();
            const review = muya.getCriticMarkupReviewSnapshot();
            const commandItems = muya.getCriticMarkupItems();

            expect(documentItemSummaries(live.items)).toEqual(expected);
            expect(live.excludedRanges.ranges)
                .toEqual(row.expected.literalRanges);
            expect(htmlItemSummary(muya.domNode.innerHTML))
                .toEqual(expectedHtml);
            expect(commandItemSummaries(commandItems))
                .toEqual(expected.map(declaredCommandItem));
            expect(review.items.map((item, documentOrder) => ({
                type: item.type,
                raw: item.raw,
                path: item.path,
                localRange: { start: item.start, end: item.end },
                sourceRange: {
                    start: item.sourceStart,
                    end: item.sourceEnd,
                },
                documentOrder,
            }))).toEqual(expected.map(item => ({
                type: item.type,
                raw: item.raw,
                path: item.fragments[0].path,
                localRange: item.fragments[0].localRange,
                sourceRange: item.sourceRange,
                documentOrder: item.documentOrder,
            })));
            expect(review.canResolveAll).toBe(expected.length > 0);

            for (const span of canonical.mappedText.sourceMap.spans) {
                for (
                    let offset = span.localStart;
                    offset <= span.localEnd;
                    offset++
                ) {
                    const affinity = offset === span.localEnd
                        ? 'previous'
                        : 'next';
                    const sourceOffset = canonical.sourceOffsetAt(
                        span.path,
                        localOffset(offset),
                        affinity,
                    );
                    expect(sourceOffset).not.toBeNull();
                    expect(canonical.localPositionAt(
                        sourceOffset!,
                        affinity,
                    )).toEqual({
                        path: [...span.path],
                        offset,
                    });
                }
            }

            const staticHtml = renderToStaticHTML(source, {
                ...options,
                sanitize: false,
            });
            const clipboardHtml = getClipBoardHtml(source, options);
            expect(htmlItemSummary(staticHtml)).toEqual(expectedHtml);
            expect(htmlItemSummary(clipboardHtml)).toEqual(expectedHtml);

            for (const projection of ['original', 'revised'] as const) {
                const projected = canonical.project(projection);
                expect(projectCriticMarkupMarkdown(
                    source,
                    projection,
                    options,
                )).toBe(projected);
                expect(renderToStaticHTML(source, {
                    ...options,
                    criticMarkupProjection: projection,
                    sanitize: false,
                })).toBe(renderToStaticHTML(projected, {
                    ...options,
                    criticMarkup: false,
                    sanitize: false,
                }));
                expect(getClipBoardHtml(source, {
                    ...options,
                    criticMarkupProjection: projection,
                })).toBe(getClipBoardHtml(projected, {
                    ...options,
                    criticMarkup: false,
                }));
            }

            for (const item of expected) {
                const commandItem = commandItems[item.itemIndex];
                const fragment = item.fragments[0];
                const expectedFocus = {
                    type: item.type,
                    raw: item.raw,
                    sourceStart: item.sourceRange.start,
                    sourceEnd: item.sourceRange.end,
                };

                expect(muya.focusCriticMarkup(commandItem.id))
                    .toMatchObject(expectedFocus);
                expect(muya.focusCriticMarkup(commandItem))
                    .toMatchObject(expectedFocus);
                expect(muya.focusCriticMarkup({
                    path: [...fragment.path],
                    start: fragment.localRange.start,
                    end: fragment.localRange.end,
                    raw: item.raw,
                    sourceStart: item.sourceRange.start,
                    sourceEnd: item.sourceRange.end,
                })).toMatchObject(expectedFocus);
                expect(muya.focusCriticMarkup({
                    path: [...fragment.path],
                    start: fragment.localRange.start,
                    end: fragment.localRange.end,
                    raw: item.raw,
                })).toMatchObject(expectedFocus);
                if (!row.expected.plainTextItems.some(plain =>
                    plain.itemIndex === item.itemIndex)) {
                    expect(muya.getCurrentCriticMarkupItem()?.id)
                        .toBe(commandItem.id);
                }
            }

            if (expected.length) {
                expect(muya.navigateCriticMarkup('next')).toMatchObject({
                    sourceStart: expected[0].sourceRange.start,
                    sourceEnd: expected[0].sourceRange.end,
                });
                expect(muya.navigateCriticMarkup('previous')).toMatchObject({
                    sourceStart: expected.at(-1)!.sourceRange.start,
                    sourceEnd: expected.at(-1)!.sourceRange.end,
                });

                for (const decision of ['accept', 'reject'] as const) {
                    const individually = resolveIndividually(
                        source,
                        row,
                        decision,
                    );
                    const bulk = resolveInBulk(source, row, decision);

                    expect(individually.count).toBe(expected.length);
                    expect(bulk.count).toBe(expected.length);
                    expect(individually.markdown).toBe(bulk.markdown);
                    if (row.normalization.kind === 'exact') {
                        expect(bulk.markdown).toBe(
                            row.expected.resolution?.[decision]
                            ?? (decision === 'accept'
                                ? row.expected.revised
                                : row.expected.original),
                        );
                    }
                }
            }
            else {
                expect(muya.focusCriticMarkup('missing-critic-item')).toBeNull();
                expect(muya.resolveAllCriticMarkup('accept')).toBe(0);
                expect(muya.resolveAllCriticMarkup('reject')).toBe(0);
                expect(muya.getMarkdown()).toBe(source);
            }
        },
    );
});
