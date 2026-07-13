import { describe, expect, it } from 'vitest';
import { CriticMarkupAnalysis } from '../analysis';
import { ExcludedRanges } from '../excludedRanges';
import {
    prepareCriticMarkupCandidateIdentity,
    scanCriticMarkup,
    scanCriticMarkupCandidate,
} from '../parser';

const MARKDOWN_PROFILE = 'scanner-result-authority';

describe('criticMarkup scanner-result authority', () => {
    it('consumes only the exact scanner-bound source, exclusions, and candidate', () => {
        const source = 'prefix {++visible++}';
        const excludedRanges = ExcludedRanges.from(source.length, [{
            start: 0,
            end: 6,
        }]);
        const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);
        const scanResult = scanCriticMarkupCandidate(
            source,
            excludedRanges,
            candidateIdentity,
        );
        const analysis = CriticMarkupAnalysis.fromMarkdownScan(
            scanResult,
            MARKDOWN_PROFILE,
            'complete',
        );

        expect(analysis.source).toBe(source);
        expect(analysis.excludedRanges).toBe(excludedRanges);
        expect(analysis.candidateIdentity).toBe(candidateIdentity);
        expect(analysis.roots).toMatchObject([{
            type: 'addition',
            raw: '{++visible++}',
        }]);
        expect(() => CriticMarkupAnalysis.fromMarkdownScan(
            { roots: scanResult.roots },
            MARKDOWN_PROFILE,
            'complete',
        )).toThrow(/authenticated scanner result/i);
    });

    it('rejects naked roots relabeled as another source revision', () => {
        const scannedSource = '{++forged++}';
        const claimedSource = '{++victim++}';
        const nakedRoots = scanCriticMarkup(scannedSource);
        const fromMarkdownScan = CriticMarkupAnalysis.fromMarkdownScan as (
            ...args: unknown[]
        ) => CriticMarkupAnalysis;

        expect(() => fromMarkdownScan(
            claimedSource,
            ExcludedRanges.empty(claimedSource.length),
            nakedRoots,
            MARKDOWN_PROFILE,
            'complete',
            prepareCriticMarkupCandidateIdentity(claimedSource),
        )).toThrow(/authenticated scanner result/i);
    });

    it('rejects naked roots relabeled with different exclusions', () => {
        const source = '{++visible++} {++hidden++}';
        const nakedRoots = scanCriticMarkup(source);
        const hiddenStart = source.indexOf('{++hidden++}');
        const claimedExclusions = ExcludedRanges.from(source.length, [{
            start: hiddenStart,
            end: source.length,
        }]);
        const fromMarkdownScan = CriticMarkupAnalysis.fromMarkdownScan as (
            ...args: unknown[]
        ) => CriticMarkupAnalysis;

        expect(() => fromMarkdownScan(
            source,
            claimedExclusions,
            nakedRoots,
            MARKDOWN_PROFILE,
            'complete',
            prepareCriticMarkupCandidateIdentity(source),
        )).toThrow(/authenticated scanner result/i);
    });

    it('does not expose a runtime constructor bypass around scan authority', () => {
        const source = '{++forged++}';

        expect(() => Reflect.construct(CriticMarkupAnalysis, [
            source,
            ExcludedRanges.empty(source.length),
            scanCriticMarkup(source),
            Object.freeze({ kind: 'markdown', key: MARKDOWN_PROFILE }),
            'complete',
            prepareCriticMarkupCandidateIdentity(source),
        ])).toThrow(/authenticated scanner result/i);
    });
});
