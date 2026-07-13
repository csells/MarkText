import type { Token } from 'marked';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CriticMarkupAnalysis } from '../../../criticMarkup/analysis';
import { ExcludedRanges } from '../../../criticMarkup/excludedRanges';
import {
    prepareCriticMarkupCandidateIdentity,
    prepareCriticMarkupNoCandidateScanResult,
    scanCriticMarkupCandidate,
} from '../../../criticMarkup/parser';
import {
    criticMarkupParserProfile,
    parseCriticMarkupDocumentFromContext,
    prepareCriticMarkupDocumentContext,
    prepareCriticMarkupSourceContext,
} from '../criticMarkupDocument';
import { lexBlock } from '../lexBlock';
import { analyzeCriticMarkupContext } from '../locatedMarkdown';
import {
    withTestCriticMarkupParseSession,
} from './helpers/criticMarkupParseSession';

const LOCATED_MARKDOWN_SOURCE = readFileSync(
    fileURLToPath(new URL('../locatedMarkdown.ts', import.meta.url)),
    'utf8',
);

function locatedContext(
    source: string,
    options = {},
    analysis?: CriticMarkupAnalysis,
) {
    return withTestCriticMarkupParseSession(
        source,
        options,
        true,
        session => analyzeCriticMarkupContext(session),
        analysis,
    );
}

describe('prepared CriticMarkup parser context', () => {
    it('locates many CRLF-native tokens and a Critic opener without leaf-piece rescans', () => {
        const nativeLine = '[label](https://example.test)\r\n\r\n';
        const prefix = nativeLine.repeat(512);
        const source = `${prefix}{++tail++}`;
        const located = locatedContext(source);
        const prepared = prepareCriticMarkupDocumentContext(located);
        const document = parseCriticMarkupDocumentFromContext(prepared);

        expect(document.items).toHaveLength(1);
        expect(document.items[0].syntax.range).toEqual({
            start: prefix.length,
            end: source.length,
        });
        expect(document.project('revised')).toBe(`${prefix}tail`);
        expect(LOCATED_MARKDOWN_SOURCE).toContain('upperBound(');
        expect(LOCATED_MARKDOWN_SOURCE).not.toMatch(/leaf\.pieces\.find\s*\(/);
        expect(LOCATED_MARKDOWN_SOURCE).not.toMatch(
            /\[\.\.\.leaf\.pieces\]\.reverse\s*\(/,
        );
    }, 60_000);

    it('derives candidate identity inside one frozen mapping-bound context', () => {
        const source = '{++new++}';
        const located = locatedContext(source);
        const forgedCandidate = () => prepareCriticMarkupNoCandidateScanResult(
            source,
            ExcludedRanges.empty(source.length),
            { hasCandidateOpener: false },
        );
        const prepared = prepareCriticMarkupDocumentContext(located);
        const document = parseCriticMarkupDocumentFromContext(prepared);
        const candidateCannotBeOverridden = () => {
            // @ts-expect-error — candidate identity is owned by the context.
            parseCriticMarkupDocumentFromContext(prepared, false);
        };

        expect(Object.isFrozen(prepared)).toBe(true);
        expect(prepared.hasCandidateOpener).toBe(true);
        expect(prepared.mappedText).toBe(located.mappedText);
        expect(document.mappedText).toBe(located.mappedText);
        expect(document.items).toHaveLength(1);
        expect(candidateCannotBeOverridden).toBeTypeOf('function');
        expect(forgedCandidate).toThrow(/candidate identity/);
    });

    it('cannot relabel math-derived context with another parser profile', () => {
        const source = '$x {++literal++}$';
        const options = { math: true };
        const located = locatedContext(source, options);
        const wrongProfile = criticMarkupParserProfile({ math: false });
        const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);
        const relabeledAnalysis = CriticMarkupAnalysis.fromMarkdownScan(
            scanCriticMarkupCandidate(
                source,
                ExcludedRanges.empty(source.length),
                candidateIdentity,
            ),
            wrongProfile.key,
            'complete',
        );
        const prepared = prepareCriticMarkupDocumentContext(located);
        const document = parseCriticMarkupDocumentFromContext(prepared);
        const profileCannotBeRelabeled = () => {
            // @ts-expect-error — parser options are frozen into the context.
            parseCriticMarkupDocumentFromContext(prepared, { math: false });
        };

        expect(prepared.parserProfile).toEqual(
            criticMarkupParserProfile(options),
        );
        expect(document.analysis.parserProfile).toEqual(prepared.parserProfile);
        expect(document.items).toEqual([]);
        expect(profileCannotBeRelabeled).toBeTypeOf('function');
        expect(() => prepareCriticMarkupSourceContext(
            source,
            options,
            relabeledAnalysis,
        )).toThrow(/different parser profile/);
    });

    it('rejects math-false located tokens rebound to a math-true source context', () => {
        const source = '$x {++literal++}$';
        const located = locatedContext(source, { math: false });
        const mathSourceContext = prepareCriticMarkupSourceContext(
            source,
            { math: true },
        );

        const prepared = prepareCriticMarkupDocumentContext(located);
        const attemptedRelabel = () => {
            // @ts-expect-error — located context already owns its source context.
            return prepareCriticMarkupDocumentContext(located, mathSourceContext);
        };

        expect(prepared.parserProfile).toEqual(
            criticMarkupParserProfile({ math: false }),
        );
        expect(attemptedRelabel().parserProfile).toEqual(
            criticMarkupParserProfile({ math: false }),
        );
    });

    it('rejects prepared analysis that omits located math exclusions', () => {
        const source = '$x {++literal++}$';
        const options = { math: true };
        const excludedRanges = ExcludedRanges.empty(source.length);
        const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);
        const analysis = CriticMarkupAnalysis.fromMarkdownScan(
            scanCriticMarkupCandidate(
                source,
                excludedRanges,
                candidateIdentity,
            ),
            criticMarkupParserProfile(options).key,
            'complete',
        );
        const located = locatedContext(source, options, analysis);

        expect(() => prepareCriticMarkupDocumentContext(located))
            .toThrow(/located literal ranges/);
    });

    it('rejects arbitrary raw tokens without lexer provenance', () => {
        expect(() => {
            const located = analyzeCriticMarkupContext({
                hasCandidateOpener: false,
                level: 'block',
            });
            return parseCriticMarkupDocumentFromContext(
                prepareCriticMarkupDocumentContext(located),
            );
        }).toThrow(/authenticated.*session/);
    });

    it('does not elevate ordinary Marked provenance into Critic candidate proof', () => {
        const source = '{++candidate++}';
        const ordinaryTokens = lexBlock(source, {
            criticMarkup: false,
        }) as Token[];

        expect(() => analyzeCriticMarkupContext(ordinaryTokens as never))
            .toThrow(/authenticated.*session/);
    });

    it('does not accept a detached mapped document after context preparation', () => {
        const source = '{++bound++}';
        const located = locatedContext(source);
        const prepared = prepareCriticMarkupDocumentContext(located);
        const parsePrepared = () => parseCriticMarkupDocumentFromContext(
            prepared,
        );
        const detached = locatedContext('{++other++}').mappedText;
        const mapCannotBeReplaced = () => {
            // @ts-expect-error — the prepared context owns its exact mapping.
            parseCriticMarkupDocumentFromContext(prepared, detached);
        };

        expect(parsePrepared().mappedText).toBe(located.mappedText);
        expect(parsePrepared().analysis.contextCoverage).toBe('complete');
        expect(mapCannotBeReplaced).toBeTypeOf('function');
    });
});
