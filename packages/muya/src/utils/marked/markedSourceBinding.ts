import type { ICriticMarkupRange } from '../../criticMarkup/parser';

/**
 * Validation for one declared parser/canonical source partition: exact,
 * ordered, non-overlapping mappings from a tokenized parser source into the
 * canonical Markdown revision it was cut from.
 */

export interface ICriticMarkupContextSourceBinding {
    /** Full canonical Markdown whose coordinates the analysis must expose. */
    source: string;
    /** Offset at which one contiguous tokenized parser source begins. */
    parserOffset?: number;
    /**
     * Exact parser-source slices that correspond to canonical source. Bytes
     * outside these slices are generated clipboard/container structure.
     */
    parserMappings?: readonly ICriticMarkupParserSourceMapping[];
    /** Canonical parser-owned literal ranges from the prepared document. */
    literalRanges: readonly ICriticMarkupRange[];
}

export interface ICriticMarkupParserSourceMapping {
    readonly parserStart: number;
    readonly parserEnd: number;
    readonly sourceStart: number;
    readonly sourceEnd: number;
}

function assertParserSourceMapping(
    mapping: ICriticMarkupParserSourceMapping,
    previous: ICriticMarkupParserSourceMapping | undefined,
    parserSource: string,
    canonicalSource: string,
    allowEmpty: boolean,
): void {
    const values = [
        mapping.parserStart,
        mapping.parserEnd,
        mapping.sourceStart,
        mapping.sourceEnd,
    ];
    if (
        values.some(value => !Number.isInteger(value))
        || mapping.parserStart < (previous?.parserEnd ?? 0)
        || mapping.sourceStart < (previous?.sourceEnd ?? 0)
        || mapping.parserStart < 0
        || mapping.parserEnd < mapping.parserStart
        || (mapping.parserEnd === mapping.parserStart && !allowEmpty)
        || parserSource.length < mapping.parserEnd
        || mapping.sourceStart < 0
        || mapping.sourceEnd < mapping.sourceStart
        || canonicalSource.length < mapping.sourceEnd
        || mapping.parserEnd - mapping.parserStart
        !== mapping.sourceEnd - mapping.sourceStart
        || parserSource.slice(mapping.parserStart, mapping.parserEnd)
        !== canonicalSource.slice(mapping.sourceStart, mapping.sourceEnd)
    ) {
        throw new RangeError(
            'Located Markdown parser mapping is invalid for its canonical source.',
        );
    }
}

export function parserSourceMappings(
    parserSource: string,
    sourceBinding?: ICriticMarkupContextSourceBinding,
): readonly ICriticMarkupParserSourceMapping[] {
    if (!sourceBinding) {
        return [{
            parserStart: 0,
            parserEnd: parserSource.length,
            sourceStart: 0,
            sourceEnd: parserSource.length,
        }];
    }

    const hasOffset = sourceBinding.parserOffset !== undefined;
    const hasMappings = sourceBinding.parserMappings !== undefined;
    if (hasOffset === hasMappings) {
        throw new TypeError(
            'Located Markdown source binding requires exactly one mapping form.',
        );
    }

    const mappings: ICriticMarkupParserSourceMapping[] = [];
    if (sourceBinding.parserMappings) {
        for (const mapping of sourceBinding.parserMappings)
            mappings.push(mapping);
    }
    else {
        const parserOffset = sourceBinding.parserOffset;
        if (parserOffset === undefined) {
            throw new TypeError(
                'Located Markdown source offset is missing.',
            );
        }
        if (parserOffset + parserSource.length !== sourceBinding.source.length) {
            throw new RangeError(
                'Located Markdown parser source is not at its declared canonical offset.',
            );
        }
        mappings.push({
            parserStart: 0,
            parserEnd: parserSource.length,
            sourceStart: parserOffset,
            sourceEnd: parserOffset + parserSource.length,
        });
    }
    if (!mappings.length)
        throw new RangeError('Located Markdown source binding is empty.');

    const allowEmptyMapping
        = sourceBinding.parserMappings === undefined
            && parserSource.length === 0;
    for (let index = 0; index < mappings.length; index++) {
        assertParserSourceMapping(
            mappings[index],
            mappings[index - 1],
            parserSource,
            sourceBinding.source,
            allowEmptyMapping,
        );
    }

    return mappings;
}
