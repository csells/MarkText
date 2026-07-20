// @vitest-environment happy-dom

import type Format from '../block/base/format';
import type { ICriticMarkupReviewSnapshot } from '../index';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FRONT_MATTER_CORPUS,
    FRONT_MATTER_DISABLED_CORPUS,
    FRONT_MATTER_LOOKALIKE_CORPUS,
    IDENTICAL_SUBSTITUTION_ARM_CORPUS,
} from '../criticMarkup/__tests__/sharedCorpus';
import { Muya } from '../muya';
import * as criticMarkupGrammar from '../criticMarkup/parser';

interface IReviewSnapshotMuya extends Muya {
    getCriticMarkupReviewSnapshot: () => ICriticMarkupReviewSnapshot;
}

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(
    markdown: string,
    options: { frontMatter?: boolean } = {},
): { muya: IReviewSnapshotMuya; block: Format } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);

    const muya = new Muya(host, { markdown, ...options }) as IReviewSnapshotMuya;
    muya.init();
    editors.push(muya);
    const block = muya.editor.scrollPage!.firstContentInDescendant() as Format;
    return { muya, block };
}

describe('atomic CriticMarkup Review snapshot', () => {
    it('keeps nested semantic payloads lazy across ordinary Review refreshes', () => {
        const depth = 96;
        const source
            = `${'{++visible '.repeat(depth)}leaf${'++}'.repeat(depth)}\n`;
        const decode = vi.spyOn(
            criticMarkupGrammar,
            'decodeCriticMarkupPayloadEscapes',
        );

        try {
            const { muya } = boot(source);
            const commandItems = muya.getCriticMarkupItems();
            const first = muya.getCriticMarkupReviewSnapshot();
            const second = muya.getCriticMarkupReviewSnapshot();

            expect(commandItems).toHaveLength(depth);
            expect(first.items).toHaveLength(depth);
            expect(decode).not.toHaveBeenCalled();
            expect(Object.getOwnPropertyDescriptor(
                commandItems[0],
                'content',
            )).toMatchObject({ enumerable: true, get: expect.any(Function) });
            expect(Object.getOwnPropertyDescriptor(
                first.items[0],
                'content',
            )).toMatchObject({ enumerable: true, get: expect.any(Function) });

            const innermost = first.items.at(-1)!;
            expect(innermost.content).toBe('visible leaf');
            const materializedCalls = decode.mock.calls.length;
            expect(materializedCalls).toBeGreaterThan(0);
            expect(commandItems.at(-1)!.content).toBe('visible leaf');
            expect(second.items.at(-1)!.content).toBe('visible leaf');
            expect(decode).toHaveBeenCalledTimes(materializedCalls);
        }
        finally {
            decode.mockRestore();
        }
    });

    it('returns one serializable engine-owned snapshot without live fragment objects', () => {
        const { muya } = boot('before {++new++} {--old--}\n');

        const snapshot = muya.getCriticMarkupReviewSnapshot();

        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
        expect(snapshot).toMatchObject({
            currentItemId: null,
            canResolveAll: true,
            trackChanges: false,
            projection: 'marked',
            items: [
                {
                    type: 'addition',
                    sourceStart: 7,
                    raw: '{++new++}',
                    content: 'new',
                },
                {
                    type: 'deletion',
                    raw: '{--old--}',
                    content: 'old',
                },
            ],
        });
        expect(snapshot.items.every(item => !('fragments' in item))).toBe(true);
    });

    it('surfaces image-alternative suggestions but not destination metadata', () => {
        const { muya } = boot(
            '![{++alt++}](img/{--path--}.png "{>>title<<}")\n',
        );

        expect(muya.getCriticMarkupReviewSnapshot().items.map(item => ({
            type: item.type,
            raw: item.raw,
        }))).toEqual([{
            type: 'addition',
            raw: '{++alt++}',
        }]);
    });

    it('emits the complete snapshot after selection, document, and option changes', () => {
        const { muya, block } = boot('{++one++} two\n');
        const listener = vi.fn<(snapshot: ICriticMarkupReviewSnapshot) => void>();
        muya.on('critic-markup-review-change', listener);

        block.setCursor(4, 4, true);
        const selected = listener.mock.lastCall?.[0];
        expect(selected).toEqual(muya.getCriticMarkupReviewSnapshot());
        expect(selected).toMatchObject({
            currentItemId: muya.getCriticMarkupItems()[0].id,
            canResolveCurrent: true,
            canResolveAll: true,
            projection: 'marked',
        });

        listener.mockClear();
        muya.setOptions({ criticMarkupTrackChanges: true }, false);
        expect(listener.mock.lastCall?.[0]).toEqual(
            expect.objectContaining({ trackChanges: true }),
        );

        listener.mockClear();
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        expect(listener.mock.lastCall?.[0]).toEqual(
            expect.objectContaining({
                projection: 'revised',
                currentItemId: null,
            }),
        );

        listener.mockClear();
        muya.setOptions({ criticMarkupProjection: 'marked' }, true);
        const markedBlock = muya.editor.scrollPage!.firstContentInDescendant() as Format;
        markedBlock.setCursor(markedBlock.text.length, markedBlock.text.length, true);
        expect(muya.createCriticMarkup({ type: 'addition' })).toBe(true);
        expect(listener.mock.lastCall?.[0]).toEqual(
            expect.objectContaining({
                projection: 'marked',
                items: expect.arrayContaining([
                    expect.objectContaining({ type: 'addition' }),
                ]),
            }),
        );
    });

    it('does not let a subscriber mutate the engine snapshot cache', () => {
        const { muya } = boot('{++one++}\n');
        const received: ICriticMarkupReviewSnapshot[] = [];
        muya.on('critic-markup-review-change', (
            snapshot: ICriticMarkupReviewSnapshot,
        ) => {
            received.push(snapshot);
        });

        muya.setOptions({ criticMarkupTrackChanges: true }, false);
        expect(received).toHaveLength(1);
        const externallyMutable = received[0] as unknown as {
            items: unknown[];
            trackChanges: boolean;
        };
        externallyMutable.items.length = 0;
        externallyMutable.trackChanges = false;

        expect(muya.getCriticMarkupReviewSnapshot()).toMatchObject({
            trackChanges: true,
            items: [expect.objectContaining({ raw: '{++one++}' })],
        });
    });

    it.each(FRONT_MATTER_CORPUS)(
        'does not surface Review items from $id',
        (row) => {
            const { muya } = boot(row.source, row.options);

            expect(muya.getCriticMarkupReviewSnapshot().items).toEqual([]);
            expect(muya.getMarkdown()).toBe(row.source);
        },
    );

    it.each(FRONT_MATTER_LOOKALIKE_CORPUS)(
        'surfaces ordinary Markdown changes from $id',
        (row) => {
            const { muya } = boot(row.source, row.options);

            expect(muya.getCriticMarkupReviewSnapshot().items.map(item => ({
                type: item.type,
                raw: item.raw,
            }))).toEqual(row.expected.itemTypes.map((type, index) => ({
                type,
                raw: row.expected.itemRaw[index],
            })));
        },
    );

    it.each(FRONT_MATTER_DISABLED_CORPUS)(
        'surfaces Review items when $id is disabled',
        (row) => {
            const { muya } = boot(row.source, row.options);

            expect(muya.getCriticMarkupReviewSnapshot().items.map(item => ({
                type: item.type,
                raw: item.raw,
            }))).toEqual(row.expected.itemTypes.map((type, index) => ({
                type,
                raw: row.expected.itemRaw[index],
            })));
        },
    );

    it.each(IDENTICAL_SUBSTITUTION_ARM_CORPUS)(
        'exposes one Review item for $id',
        (row) => {
            const { muya } = boot(row.source, row.options);

            expect(muya.getCriticMarkupReviewSnapshot().items.map(item => ({
                type: item.type,
                raw: item.raw,
            }))).toEqual(row.expected.itemTypes.map((type, index) => ({
                type,
                raw: row.expected.itemRaw[index],
            })));
        },
    );
});
