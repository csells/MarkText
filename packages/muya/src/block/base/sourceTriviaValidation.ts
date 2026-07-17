import type {
    ICriticMarkupStateMarker,
    IStateSourceTrivia,
    ITableSourceSyntax,
} from '../../state/types';
import { criticMarkupMarkerRaw } from '../../criticMarkup/parser';

const CRITIC_MARKUP_TYPES = new Set([
    'addition',
    'deletion',
    'substitution',
    'highlight',
    'comment',
]);
const CRITIC_MARKUP_MARKERS = new Set([
    'open',
    'separator',
    'close',
]);

function assertPlainDataObject(
    value: unknown,
    label: string,
): asserts value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError(`${label} must be a plain data object.`);

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError(`${label} must be a plain data object.`);
}

function dataProperties(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    label: string,
): Map<string, unknown> {
    const result = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !allowed.has(key))
            throw new TypeError(`${label} contains an unsupported property.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw new TypeError(
                `${label} property "${key}" must be an enumerable data property.`,
            );
        }
        result.set(key, descriptor.value);
    }
    return result;
}

function freezeCriticMarkupMarker(
    value: unknown,
    label: string,
): Readonly<ICriticMarkupStateMarker> {
    assertPlainDataObject(value, label);
    const properties = dataProperties(
        value,
        new Set(['type', 'marker', 'raw', 'sourceOffset']),
        label,
    );
    const type = properties.get('type');
    const marker = properties.get('marker');
    const raw = properties.get('raw');
    const sourceOffset = properties.get('sourceOffset');
    if (
        typeof type !== 'string'
        || !CRITIC_MARKUP_TYPES.has(type)
        || typeof marker !== 'string'
        || !CRITIC_MARKUP_MARKERS.has(marker)
        || typeof raw !== 'string'
        || raw.length === 0
        || (
            sourceOffset !== undefined
            && (
                typeof sourceOffset !== 'number'
                || !Number.isSafeInteger(sourceOffset)
                || sourceOffset < 0
            )
        )
    ) {
        throw new TypeError(`${label} is not a valid CriticMarkup marker.`);
    }
    const canonicalRaw = criticMarkupMarkerRaw(
        type as ICriticMarkupStateMarker['type'],
        marker as ICriticMarkupStateMarker['marker'],
    );
    if (raw !== canonicalRaw) {
        throw new TypeError(
            `${label} does not use the grammar-owned marker spelling.`,
        );
    }

    return Object.freeze({
        type: type as ICriticMarkupStateMarker['type'],
        marker: marker as ICriticMarkupStateMarker['marker'],
        raw,
        ...(typeof sourceOffset === 'number' ? { sourceOffset } : {}),
    });
}

function freezeCriticMarkupMarkers(
    value: unknown,
    label: string,
): readonly Readonly<ICriticMarkupStateMarker>[] {
    if (!Array.isArray(value))
        throw new TypeError(`${label} must be an array.`);

    const markers: Readonly<ICriticMarkupStateMarker>[] = [];
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !('value' in descriptor)) {
            throw new TypeError(`${label} must be a dense data array.`);
        }
        markers.push(freezeCriticMarkupMarker(
            descriptor.value,
            `${label}[${index}]`,
        ));
    }
    return Object.freeze(markers);
}

function freezeListItemContinuationPrefixes(
    value: unknown,
): readonly string[] {
    if (!Array.isArray(value)) {
        throw new TypeError(
            'State source trivia listItemContinuationPrefixes must be an array.',
        );
    }
    const prefixes: string[] = [];
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (
            !descriptor
            || !('value' in descriptor)
            || typeof descriptor.value !== 'string'
            || !/^[ \t]*$/.test(descriptor.value)
        ) {
            throw new TypeError(
                'State source trivia listItemContinuationPrefixes must contain dense whitespace strings.',
            );
        }
        prefixes.push(descriptor.value);
    }
    return Object.freeze(prefixes);
}

function freezeDenseStrings(value: unknown, label: string): readonly string[] {
    if (!Array.isArray(value))
        throw new TypeError(`${label} must be an array.`);
    const strings: string[] = [];
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (
            !descriptor
            || !('value' in descriptor)
            || typeof descriptor.value !== 'string'
        ) {
            throw new TypeError(`${label} must contain dense strings.`);
        }
        strings.push(descriptor.value);
    }
    return Object.freeze(strings);
}

function freezeTableRowSourceSyntax(
    value: unknown,
    label: string,
): ITableSourceSyntax['header'] {
    assertPlainDataObject(value, label);
    const properties = dataProperties(
        value,
        new Set(['cells', 'segments']),
        label,
    );
    const cells = freezeDenseStrings(
        properties.get('cells'),
        `${label} cells`,
    );
    const segments = freezeDenseStrings(
        properties.get('segments'),
        `${label} segments`,
    );
    if (segments.length !== cells.length + 1) {
        throw new TypeError(
            `${label} must have exactly one more segment than cells.`,
        );
    }
    return Object.freeze({ cells, segments });
}

function freezeTableSourceSyntax(value: unknown): ITableSourceSyntax {
    const label = 'State source trivia tableSourceSyntax';
    assertPlainDataObject(value, label);
    const properties = dataProperties(
        value,
        new Set(['header', 'delimiter', 'rows', 'alignments']),
        label,
    );
    const header = freezeTableRowSourceSyntax(
        properties.get('header'),
        `${label} header`,
    );
    const delimiter = freezeTableRowSourceSyntax(
        properties.get('delimiter'),
        `${label} delimiter`,
    );
    const rowValues = properties.get('rows');
    if (!Array.isArray(rowValues))
        throw new TypeError(`${label} rows must be an array.`);
    const rows: ITableSourceSyntax['rows'][number][] = [];
    for (let index = 0; index < rowValues.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(rowValues, index);
        if (!descriptor || !('value' in descriptor)) {
            throw new TypeError(`${label} rows must be a dense array.`);
        }
        rows.push(freezeTableRowSourceSyntax(
            descriptor.value,
            `${label} rows[${index}]`,
        ));
    }
    const alignments = freezeDenseStrings(
        properties.get('alignments'),
        `${label} alignments`,
    );
    if (alignments.some(align =>
        !['none', 'left', 'center', 'right'].includes(align))) {
        throw new TypeError(`${label} contains an invalid alignment.`);
    }
    if (
        header.cells.length !== delimiter.cells.length
        || header.cells.length !== alignments.length
        || rows.some(row => row.cells.length !== header.cells.length)
    ) {
        throw new TypeError(`${label} row column counts must agree.`);
    }
    return Object.freeze({
        header,
        delimiter,
        rows: Object.freeze(rows),
        alignments: alignments as ITableSourceSyntax['alignments'],
    });
}

export function freezeSourceTrivia(
    value: unknown,
): Readonly<IStateSourceTrivia> {
    assertPlainDataObject(value, 'State source trivia');
    const properties = dataProperties(
        value,
        new Set([
            'criticBefore',
            'criticBeforeSuffix',
            'criticAfter',
            'criticAfterPrefix',
            'criticAfterFlush',
            'blockPrefix',
            'blockSeparatorAfter',
            'terminalLineEnding',
            'tableSourceSyntax',
            'listItemLeadingPrefix',
            'listItemMarker',
            'listItemMarkerPadding',
            'listItemTrailingBlankLines',
            'listItemContinuationPrefixes',
        ]),
        'State source trivia',
    );
    const criticBefore = properties.has('criticBefore')
        ? freezeCriticMarkupMarkers(
                properties.get('criticBefore'),
                'State source trivia criticBefore',
            )
        : undefined;
    const criticAfter = properties.has('criticAfter')
        ? freezeCriticMarkupMarkers(
                properties.get('criticAfter'),
                'State source trivia criticAfter',
            )
        : undefined;
    const criticBeforeSuffix = properties.get('criticBeforeSuffix');
    if (
        criticBeforeSuffix !== undefined
        && (
            typeof criticBeforeSuffix !== 'string'
            || !/^[ \t\r\n]*$/.test(criticBeforeSuffix)
        )
    ) {
        throw new TypeError(
            'State source trivia criticBeforeSuffix must be whitespace.',
        );
    }
    const criticAfterPrefix = properties.get('criticAfterPrefix');
    if (
        criticAfterPrefix !== undefined
        && (
            typeof criticAfterPrefix !== 'string'
            || !/^[ \t\r\n]*$/.test(criticAfterPrefix)
        )
    ) {
        throw new TypeError(
            'State source trivia criticAfterPrefix must be whitespace.',
        );
    }
    const criticAfterFlush = properties.get('criticAfterFlush');
    if (criticAfterFlush !== undefined && criticAfterFlush !== true) {
        throw new TypeError(
            'State source trivia criticAfterFlush must be true when present.',
        );
    }
    const blockPrefix = properties.get('blockPrefix');
    if (
        blockPrefix !== undefined
        && (
            typeof blockPrefix !== 'string'
            || !/^[ \t\r\n]*$/.test(blockPrefix)
        )
    ) {
        throw new TypeError(
            'State source trivia blockPrefix must be whitespace.',
        );
    }
    const blockSeparatorAfter = properties.get('blockSeparatorAfter');
    if (
        blockSeparatorAfter !== undefined
        && (
            typeof blockSeparatorAfter !== 'string'
            || !/^[ \t\r\n]*$/.test(blockSeparatorAfter)
        )
    ) {
        throw new TypeError(
            'State source trivia blockSeparatorAfter must be whitespace.',
        );
    }
    const terminalLineEnding = properties.get('terminalLineEnding');
    if (
        terminalLineEnding !== undefined
        && terminalLineEnding !== ''
        && terminalLineEnding !== '\n'
        && terminalLineEnding !== '\r\n'
    ) {
        throw new TypeError(
            'State source trivia terminalLineEnding must be empty, LF, or CRLF.',
        );
    }
    const tableSourceSyntax = properties.has('tableSourceSyntax')
        ? freezeTableSourceSyntax(properties.get('tableSourceSyntax'))
        : undefined;
    const listItemLeadingPrefix = properties.get('listItemLeadingPrefix');
    if (
        listItemLeadingPrefix !== undefined
        && (
            typeof listItemLeadingPrefix !== 'string'
            || !/^[ \t]*$/.test(listItemLeadingPrefix)
        )
    ) {
        throw new TypeError(
            'State source trivia listItemLeadingPrefix must be whitespace.',
        );
    }
    const listItemMarker = properties.get('listItemMarker');
    if (
        listItemMarker !== undefined
        && (
            typeof listItemMarker !== 'string'
            || !/^(?:[*+-]|\d{1,9}[.)])$/.test(listItemMarker)
        )
    ) {
        throw new TypeError(
            'State source trivia listItemMarker is not a CommonMark list marker.',
        );
    }
    const listItemMarkerPadding = properties.get('listItemMarkerPadding');
    if (
        listItemMarkerPadding !== undefined
        && (
            typeof listItemMarkerPadding !== 'string'
            || !/^[ \t]*$/.test(listItemMarkerPadding)
        )
    ) {
        throw new TypeError(
            'State source trivia listItemMarkerPadding must be whitespace.',
        );
    }
    const listItemTrailingBlankLines = properties.get(
        'listItemTrailingBlankLines',
    );
    if (
        listItemTrailingBlankLines !== undefined
        && (
            typeof listItemTrailingBlankLines !== 'number'
            || !Number.isSafeInteger(listItemTrailingBlankLines)
            || listItemTrailingBlankLines < 0
        )
    ) {
        throw new TypeError(
            'State source trivia listItemTrailingBlankLines must be a nonnegative safe integer.',
        );
    }
    const listItemContinuationPrefixes = properties.has(
        'listItemContinuationPrefixes',
    )
        ? freezeListItemContinuationPrefixes(
                properties.get('listItemContinuationPrefixes'),
            )
        : undefined;

    return Object.freeze({
        ...(criticBefore ? { criticBefore } : {}),
        ...(criticAfter ? { criticAfter } : {}),
        ...(typeof criticAfterPrefix === 'string'
            ? { criticAfterPrefix }
            : {}),
        ...(criticAfterFlush === true ? { criticAfterFlush } : {}),
        ...(typeof blockPrefix === 'string' ? { blockPrefix } : {}),
        ...(typeof blockSeparatorAfter === 'string'
            ? { blockSeparatorAfter }
            : {}),
        ...(typeof terminalLineEnding === 'string'
            ? { terminalLineEnding: terminalLineEnding as '' | '\n' | '\r\n' }
            : {}),
        ...(tableSourceSyntax ? { tableSourceSyntax } : {}),
        ...(typeof listItemLeadingPrefix === 'string'
            ? { listItemLeadingPrefix }
            : {}),
        ...(typeof listItemMarker === 'string' ? { listItemMarker } : {}),
        ...(typeof listItemMarkerPadding === 'string'
            ? { listItemMarkerPadding }
            : {}),
        ...(typeof listItemTrailingBlankLines === 'number'
            ? { listItemTrailingBlankLines }
            : {}),
        ...(listItemContinuationPrefixes
            ? { listItemContinuationPrefixes }
            : {}),
    });
}
