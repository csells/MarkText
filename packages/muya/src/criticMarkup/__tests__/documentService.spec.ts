// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { TState } from '../../state/types';
import type { CriticMarkupDocument } from '../document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    runDeferredDirectMutation,
    runUserEdit,
} from '../../__tests__/helpers/mutation';
import { HalfOpenIntervalIndex } from '../../mapped-range';
import { sourceRange } from '../../mappedText';
import { Muya } from '../../muya';
import { CriticMarkupDocumentService } from '../documentService';

const parserCalls = vi.hoisted(() => ({
    candidateSources: [] as string[],
}));

vi.mock('../parser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../parser')>();
    return {
        ...actual,
        prepareCriticMarkupCandidateIdentity: (
            ...args: Parameters<
                typeof actual.prepareCriticMarkupCandidateIdentity
            >
        ) => {
            parserCalls.candidateSources.push(args[0]);
            return actual.prepareCriticMarkupCandidateIdentity(...args);
        },
    };
});

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

beforeEach(() => {
    parserCalls.candidateSources.length = 0;
});

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function contentByText(muya: Muya, text: string): Content {
    let content = muya.editor.scrollPage!.firstContentInDescendant();
    while (content) {
        if (content.text === text)
            return content as Content;
        content = content.nextContentInContext() ?? null;
    }

    throw new TypeError(`Expected a content block containing "${text}".`);
}

function indexedSnapshot(document: CriticMarkupDocument) {
    const [outer, inner] = document.items;
    return {
        itemById: document.itemById(inner.id)?.id ?? null,
        roots: document.childrenOf(null).map(item => item.id),
        children: document.childrenOf(outer.id).map(item => item.id),
        fragments: document.fragmentsForPath(inner.fragments[0].path)
            .map(({ item }) => item.id),
        sourceItems: document.itemsContainingSourceRange(sourceRange(
            inner.syntax.range.start,
            inner.syntax.range.end,
        )).map(item => item.id),
        paths: document.pathsWithFragments().map(path => [...path]),
    };
}

const CACHED_INDEX_POISONERS = [
    {
        name: '_itemsById',
        poison(value: unknown) {
            (value as Map<unknown, unknown>).clear();
        },
    },
    {
        name: '_itemsByParent',
        poison(value: unknown) {
            (value as Map<unknown, unknown>).clear();
        },
    },
    {
        name: '_itemsByPath',
        poison(value: unknown, document: CriticMarkupDocument) {
            (value as { set: (path: readonly (string | number)[], value: unknown) => unknown })
                .set(document.items[0].fragments[0].path, new HalfOpenIntervalIndex([]));
        },
    },
    {
        name: '_sourceIntervals',
        poison(value: unknown) {
            ((value as { values: () => readonly unknown[] }).values() as unknown[])
                .pop();
        },
    },
    {
        name: '_fragmentPaths',
        poison(value: unknown) {
            (value as unknown[]).pop();
        },
    },
] as const;

describe('criticMarkup document service', () => {
    it('uses the exact parser artifact block graph without another scan', () => {
        const source = [
            '{~~| OLD |',
            '| --- |',
            '~>| NEW |',
            '| --- |',
            '~~}',
            '',
        ].join('\n');
        const muya = boot(source);
        parserCalls.candidateSources.length = 0;
        const artifactSpy = vi.spyOn(
            muya.editor.jsonState,
            'parserArtifactForSource',
        );
        const legacyAnalysisSpy = vi.spyOn(
            muya.editor.jsonState,
            'parserAnalysisForSource',
        );

        try {
            const document = new CriticMarkupDocumentService(muya).get();

            expect(artifactSpy).toHaveBeenCalledOnce();
            expect(legacyAnalysisSpy).not.toHaveBeenCalled();
            expect(parserCalls.candidateSources).toEqual([]);
            expect(document.items[0].structuralFragments).toMatchObject([
                {
                    kind: 'content',
                    path: [0],
                    arm: 'old',
                    role: 'start',
                },
                {
                    kind: 'content',
                    path: [1],
                    arm: 'new',
                    role: 'end',
                },
            ]);
        }
        finally {
            artifactSpy.mockRestore();
            legacyAnalysisSpy.mockRestore();
        }
    });

    it('rejects an exact-source parser artifact from an obsolete parser profile', () => {
        const source = '{++^sup^++}\n';
        const muya = boot(source);
        const service = muya.editor.criticMarkupDocument;
        const before = service.get();

        muya.setOptions({ superSubScript: false });

        const after = service.get();
        expect(after.markdown).toBe(source);
        expect(after.analysis).not.toBe(before.analysis);
        expect(after.analysis.parserProfile)
            .not.toEqual(before.analysis.parserProfile);
    });

    it('rebuilds a native block graph after a live user mutation invalidates the parser artifact', () => {
        const source = [
            '{~~| OLD |',
            '| --- |',
            '~>| NEW |',
            '| --- |',
            '~~}',
            '',
        ].join('\n');
        const muya = boot(source);
        const service = muya.editor.criticMarkupDocument;
        const before = service.get();
        const revisedCell = contentByText(muya, 'NEW');
        const beforeVersion = muya.editor.jsonState.documentVersion;

        expect(muya.editor.jsonState.parserArtifactForSource(source)).not.toBeNull();
        parserCalls.candidateSources.length = 0;

        runUserEdit(muya, () => {
            revisedCell.text = 'NEWER';
        });

        const editedSource = muya.getMarkdown();
        const editedVersion = muya.editor.jsonState.documentVersion;
        expect(editedVersion).toBe(beforeVersion + 1);
        const after = service.get();
        expect(muya.editor.jsonState.documentVersion).toBe(editedVersion);
        expect(after).not.toBe(before);
        expect(after.markdown).toBe(editedSource);
        expect(muya.editor.jsonState.parserArtifactForSource(editedSource))
            .toBeNull();
        expect(parserCalls.candidateSources).toEqual([editedSource]);
        expect(after.items[0].structuralFragments).toMatchObject([
            {
                kind: 'content',
                path: [0],
                arm: 'old',
                role: 'start',
            },
            {
                kind: 'content',
                path: [1],
                arm: 'new',
                role: 'end',
            },
        ]);
    });

    it('rebinds native inline segments after a table edit invalidates the parser artifact', () => {
        const source = [
            '| A {++x \\| y++} | B |',
            '| --- | --- |',
            '',
        ].join('\n');
        const muya = boot(source);
        const service = muya.editor.criticMarkupDocument;
        const otherCell = contentByText(muya, 'B');

        expect(service.get().items).toHaveLength(1);
        runUserEdit(muya, () => {
            otherCell.text = 'C';
        });

        const editedSource = muya.getMarkdown();
        expect(muya.editor.jsonState.parserArtifactForSource(editedSource))
            .toBeNull();
        const [addition] = service.get().items;
        const [fragment] = addition.fragments;

        expect(fragment.path).toEqual([
            0,
            'children',
            0,
            'children',
            0,
            'text',
        ]);
        expect(fragment.segments).toHaveLength(4);
        expect(fragment.sourceRange.end - fragment.sourceRange.start)
            .toBeGreaterThan(fragment.localRange.end - fragment.localRange.start);
    });

    it('rebinds spanless native block carriers after artifact invalidation', () => {
        const source = [
            '{~~```',
            'old',
            '~># new',
            '~~}',
            '',
            'tail',
            '',
        ].join('\n');
        const muya = boot(source);
        const service = muya.editor.criticMarkupDocument;
        const tail = contentByText(muya, 'tail');

        expect(service.get().items).toHaveLength(1);
        runUserEdit(muya, () => {
            tail.text = 'tail changed';
        });

        const editedSource = muya.getMarkdown();
        expect(muya.editor.jsonState.parserArtifactForSource(editedSource))
            .toBeNull();
        const [substitution] = service.get().items;

        expect(substitution.structuralFragments).toMatchObject([
            { kind: 'content', path: [0], arm: 'old' },
            { kind: 'content', path: [1], arm: 'new' },
        ]);
    });

    it('rebinds every state covered by one multi-block native arm', () => {
        const source = '{++# a\n\n# b\n\n# c++}\n\ntail\n';
        const muya = boot(source);
        const service = muya.editor.criticMarkupDocument;
        const tail = contentByText(muya, 'tail');

        const [before] = service.get().items;
        expect(before.structuralFragments).toMatchObject([
            { kind: 'content', path: [0] },
            { kind: 'content', path: [1] },
            { kind: 'content', path: [2] },
        ]);
        runUserEdit(muya, () => {
            tail.text = 'tail changed';
        });

        const editedSource = muya.getMarkdown();
        expect(muya.editor.jsonState.parserArtifactForSource(editedSource))
            .toBeNull();
        const [addition] = service.get().items;

        expect(addition.structuralFragments)
            .toEqual(before.structuralFragments);
    });

    it('rebinds a marker-only EOF boundary through its semantic point', () => {
        const source = '{++++}';
        const muya = boot('before\n');
        const session = muya.editor.criticMarkupDocument.beginSession();
        const analysis = session.createForSource(source).analysis;
        const state = session.parseState(source);

        expect(session.mapState(state).text).toBe(source);
        const [addition] = session.bindAnalysisForState(analysis, state).items;

        expect(addition.structuralFragments).toMatchObject([{
            kind: 'boundary',
            path: [0],
            edge: 'after',
        }]);
    });

    it('binds tracked state analysis with the native parser graph', () => {
        const source = [
            '{~~| OLD |',
            '| --- |',
            '~>| NEW |',
            '| --- |',
            '~~}',
            '',
        ].join('\n');
        const muya = boot('before\n');
        const session = muya.editor.criticMarkupDocument.beginSession();
        const analysis = session.createForSource(source).analysis;
        const state = session.parseState(source);

        const document = session.bindAnalysisForState(analysis, state);

        expect(document.items[0].structuralFragments).toMatchObject([
            { kind: 'content', path: [0], arm: 'old', role: 'start' },
            { kind: 'content', path: [1], arm: 'new', role: 'end' },
        ]);
    });

    it('rebinds a parser-owned empty block boundary to its live carrier', () => {
        const source = 'a\n\n{++++}# heading\n\nc\n';
        const muya = boot('before\n');
        const session = muya.editor.criticMarkupDocument.beginSession();
        const analysis = session.createForSource(source).analysis;
        const state: TState[] = [
            {
                name: 'paragraph',
                text: 'a\n\n{++++}# heading',
                sourceTrivia: { blockSeparatorAfter: '\n' },
            },
            {
                name: 'paragraph',
                text: 'c',
                sourceTrivia: { terminalLineEnding: '\n' },
            },
        ];

        expect(session.mapState(state).text).toBe(source);
        const [addition] = session.bindAnalysisForState(analysis, state).items;

        expect(addition.structuralFragments).toMatchObject([{
            kind: 'boundary',
            path: [0],
            edge: 'before',
        }]);
    });

    it('caches one parser-native model for an unchanged live revision', () => {
        const muya = boot('{++one\n\n# two++}\n');

        const first = muya.editor.criticMarkupDocument.get();
        const second = muya.editor.criticMarkupDocument.get();

        expect(second).toBe(first);
        expect(first.items).toHaveLength(1);
    });

    it('caches one speculative model per exact capture draft', () => {
        const muya = boot('{++one++}\n');
        const service = muya.editor.criticMarkupDocument;
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        let first!: CriticMarkupDocument;
        let second!: CriticMarkupDocument;
        let changed!: CriticMarkupDocument;

        runUserEdit(muya, () => {
            leaf.text = '{++two++}';
            first = service.get();
            second = service.get();
            leaf.text = '{++three++}';
            changed = service.get();
        });

        expect(second).toBe(first);
        expect(changed).not.toBe(first);
        expect(first.markdown).toBe('{++two++}\n');
        expect(changed.markdown).toBe('{++three++}\n');
    });

    it('caches completed parser context for one openerless capture draft', () => {
        const muya = boot('plain text\n');
        const service = muya.editor.criticMarkupDocument;
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        let first!: CriticMarkupDocument;
        let second!: CriticMarkupDocument;

        runUserEdit(muya, () => {
            leaf.text = 'changed text';
            first = service.getContext();
            second = service.getContext();
        });

        expect(second).toBe(first);
        expect(first.markdown).toBe('changed text\n');
        expect(first.analysis.contextCoverage).toBe('complete');
    });

    it('does not reuse durable binding paths for same-source capture topology', () => {
        const source = '{++one++}\n';
        const muya = boot(source);
        const service = muya.editor.criticMarkupDocument;
        const emptyContainer: TState = {
            name: 'block-quote',
            children: [],
            sourceTrivia: { blockSeparatorAfter: '' },
        };
        const draft = [emptyContainer, ...muya.getState()];
        expect(service.beginSession().mapState(draft).text).toBe(source);
        let speculative!: CriticMarkupDocument;

        expect(() => muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                muya.editor.jsonState.insertOperation([0], emptyContainer);
                speculative = service.get();
                throw new Error('stop speculative capture');
            },
        )).toThrowError('stop speculative capture');

        expect(speculative.markdown).toBe(source);
        expect(speculative.items[0].fragments[0].path)
            .toEqual([1, 'text']);
        expect(muya.getMarkdown()).toBe(source);
    });

    it.each(CACHED_INDEX_POISONERS)(
        'does not expose mutable cached index identity $name',
        ({ name, poison }) => {
            const muya = boot('{++outer {--inner--} tail++}\n');
            const cached = muya.editor.criticMarkupDocument.get();
            const before = indexedSnapshot(cached);
            const exposed = Reflect.get(cached, name) as unknown;

            expect(() => poison(exposed, cached)).toThrow(TypeError);
            expect(Reflect.has(cached, name)).toBe(false);
            expect(Reflect.get(cached, name)).toBeUndefined();
            expect(muya.editor.criticMarkupDocument.get()).toBe(cached);
            expect(indexedSnapshot(cached)).toEqual(before);
        },
    );

    it('reuses the same context-bearing model when an opener already required Markdown analysis', () => {
        const muya = boot('before {++new++} after\n');
        const display = muya.editor.criticMarkupDocument.get();

        expect(muya.editor.criticMarkupDocument.getContext()).toBe(display);
    });

    it('lazily caches literal context for authoring in a no-opener document', () => {
        const muya = boot('before `literal` after\n');
        muya.editor.criticMarkupDocument.get();
        const first = muya.editor.criticMarkupDocument.getContext();
        const second = muya.editor.criticMarkupDocument.getContext();

        expect(second).toBe(first);
        expect(muya.editor.criticMarkupDocument.get()).toBe(first);
        expect(first.analysis.contextCoverage).toBe('complete');
        expect(first.excludedRanges.ranges).toEqual([{
            start: 7,
            end: 16,
        }]);
    });

    it('reuses one candidate prefilter while completing no-opener authoring context', () => {
        const source = 'before `literal` after\n';
        const muya = boot(source);

        const display = muya.editor.criticMarkupDocument.get();
        const context = muya.editor.criticMarkupDocument.getContext();

        expect(display.analysis.hasCandidateOpener).toBe(false);
        expect(context.analysis.contextCoverage).toBe('complete');
        expect(parserCalls.candidateSources.filter(value => value === source))
            .toHaveLength(1);
    });

    it('captures parser options once for a context parse and its cache identity', () => {
        const muya = boot('before `literal` after\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        let frontMatterReads = 0;
        Object.defineProperty(muya.options, 'frontMatter', {
            configurable: true,
            get() {
                frontMatterReads++;
                return true;
            },
        });

        let context: ReturnType<typeof muya.editor.criticMarkupDocument.getContext>;
        runDeferredDirectMutation(muya, () => {
            leaf.text = 'changed `literal` text';
            context = muya.editor.criticMarkupDocument.getContext();
        });

        expect(context!.excludedRanges.ranges).toEqual([{
            start: 8,
            end: 17,
        }]);
        expect(frontMatterReads).toBe(1);
    });

    it('holds one parser snapshot across a tracked-document session', () => {
        const muya = boot('before `literal` after\n');
        let frontMatterReads = 0;
        Object.defineProperty(muya.options, 'frontMatter', {
            configurable: true,
            get() {
                frontMatterReads++;
                return frontMatterReads % 2 === 1;
            },
        });

        const session = muya.editor.criticMarkupDocument.beginSession();
        const before = session.getContext();
        const proposed = session.createForState(muya.getState());
        const tracked = session.createForSource(before.markdown);
        session.parseState(before.markdown);

        expect(frontMatterReads).toBe(1);
        expect(proposed.analysis.parserProfile)
            .toEqual(before.analysis.parserProfile);
        expect(tracked.analysis.parserProfile)
            .toEqual(before.analysis.parserProfile);
    });

    it('invalidates immediately for queued leaf edits before JSON flush', () => {
        const muya = boot('{++one++}\n');
        const first = muya.editor.criticMarkupDocument.get();
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        runDeferredDirectMutation(muya, () => {
            leaf.text = 'plain';
        });
        const second = muya.editor.criticMarkupDocument.get();

        expect(second).not.toBe(first);
        expect(second.items).toHaveLength(0);
        expect(muya.getMarkdown()).toBe('{++one++}\n');
    });
});
