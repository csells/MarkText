// @vitest-environment happy-dom

import type { Muya as MuyaType } from '../../muya';
import type JSONState from '../index';
import type { TState } from '../types';
import { afterEach, describe, expect, it } from 'vitest';
import { runDeferredDirectMutation } from '../../__tests__/helpers/mutation';
import { analyzeCriticMarkupMarkdownState } from '../../criticMarkup/markdownState';
import { Muya } from '../../muya';
import { snapshotCriticMarkupParserOptions } from '../../utils/marked/criticMarkupSourceContext';
import { asDoc } from '../index';
import StateToMarkdown from '../stateToMarkdown';

const PARSER_OPTIONS = {
    listIndentation: 1,
    trimUnnecessaryCodeBlockEmptyLines: false,
    lex: snapshotCriticMarkupParserOptions({
        breaks: false,
        footnote: false,
        frontMatter: true,
        gfm: true,
        isGitlabCompatibilityEnabled: true,
        math: true,
        maxBlockNesting: 128,
        pedantic: false,
        superSubScript: true,
    }),
} as const;

const STRUCTURAL_SOURCE = [
    '- parent',
    '{--  - OLD',
    '--}  - KEEP',
    '- tail',
    '',
].join('\n');

const NORMALIZED_SOURCE = `intro\n\n${STRUCTURAL_SOURCE}`;
const UNNORMALIZED_SOURCE = `intro\r\n\r\n${STRUCTURAL_SOURCE}`;

const editors: MuyaType[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string): MuyaType {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('CriticMarkup parser artifact revision ownership', () => {
    it('returns normalized states, analysis, and bindings from one revision', () => {
        const parsed = analyzeCriticMarkupMarkdownState(
            UNNORMALIZED_SOURCE,
            PARSER_OPTIONS,
        );
        const canonical = analyzeCriticMarkupMarkdownState(
            NORMALIZED_SOURCE,
            PARSER_OPTIONS,
        );
        const serialized = new StateToMarkdown({
            listIndentation: PARSER_OPTIONS.listIndentation,
        }).generate(parsed.states);

        expect(UNNORMALIZED_SOURCE).not.toBe(NORMALIZED_SOURCE);
        expect(parsed.source).toBe(NORMALIZED_SOURCE);
        expect(serialized).toBe(NORMALIZED_SOURCE);
        expect(parsed.analysis?.source).toBe(NORMALIZED_SOURCE);
        expect(parsed.bindings.block.length).toBeGreaterThan(0);
        expect(parsed.bindings).toEqual(canonical.bindings);
        expect(parsed.states).toEqual(canonical.states);
        expect(parsed.analysis?.roots).toEqual(canonical.analysis?.roots);
    });

    it('caches the normalized analysis and bindings as one source artifact', () => {
        const muya = boot(UNNORMALIZED_SOURCE);
        const normalized = muya.getMarkdown();
        const artifact = muya.editor.jsonState.parserArtifactForSource(
            normalized,
        );

        expect(normalized).toBe(NORMALIZED_SOURCE);
        expect(artifact).not.toBeNull();
        expect(artifact!.analysis.source).toBe(normalized);
        expect(artifact!.bindings.block.length).toBeGreaterThan(0);
        expect(muya.editor.jsonState.parserArtifactForSource(
            UNNORMALIZED_SOURCE,
        ))
            .toBeNull();
        expect(muya.editor.jsonState.parserArtifactForSource(normalized))
            .toBe(artifact);
    });

    it('does not cache a stale parser view after ordinary normalization', () => {
        const source = 'ordinary\r\ntext\r\n';
        const normalized = 'ordinary\ntext\r\n';
        const muya = boot(source);

        expect(muya.getMarkdown()).toBe(normalized);
        expect(muya.editor.jsonState.parserArtifactForSource(source))
            .toBeNull();
        expect(muya.editor.jsonState.parserArtifactForSource(normalized))
            .toBeNull();
    });

    const mutations: readonly {
        name: string;
        run: (state: JSONState, current: TState[]) => void;
    }[] = [
        {
            name: 'insert',
            run: state => state.insertOperation(
                [1],
                { name: 'paragraph', text: 'inserted' },
            ),
        },
        {
            name: 'remove',
            run: state => state.removeOperation([0]),
        },
        {
            name: 'edit',
            run: state => state.editOperation(
                [0, 'children', 0, 'children', 0, 'text'],
                [1, ' changed'],
            ),
        },
        {
            name: 'replace',
            run: (state, current) => state.replaceOperation(
                [0],
                asDoc(current[0]),
                asDoc({ name: 'paragraph', text: 'replacement' }),
            ),
        },
    ];

    it.each(mutations)(
        'invalidates the complete cached artifact on queued $name mutation',
        ({ run }) => {
            const muya = boot(STRUCTURAL_SOURCE);
            const { jsonState } = muya.editor;
            const source = muya.getMarkdown();
            const artifact = jsonState.parserArtifactForSource(source);

            expect(artifact?.bindings.block.length).toBeGreaterThan(0);
            runDeferredDirectMutation(muya, () =>
                run(jsonState, jsonState.getState()));

            expect(jsonState.parserArtifactForSource(source)).toBeNull();
            // Cancel the intentionally deferred operation before happy-dom's
            // animation-frame queue can publish it against an unchanged DOM.
            runDeferredDirectMutation(muya, () =>
                jsonState.setContent(STRUCTURAL_SOURCE));
        },
    );

    it('invalidates the complete artifact on a state reset', () => {
        const muya = boot(STRUCTURAL_SOURCE);
        const { jsonState } = muya.editor;
        const source = muya.getMarkdown();

        expect(jsonState.parserArtifactForSource(source)?.bindings.block.length)
            .toBeGreaterThan(0);
        muya.setContent([{ name: 'paragraph', text: 'replacement' }]);

        expect(jsonState.parserArtifactForSource(source)).toBeNull();
        expect(jsonState.parserArtifactForSource('replacement\n')).toBeNull();
    });
});
