/**
 * GFM table serialization. Table cells escape unescaped pipes and map each
 * character individually, so the serializer's per-pass source-map emission
 * hooks are injected through IMappedTableSerializationContext instead of
 * this module reaching back into the exporter instance.
 */
import type {
    TMarkdownStatePath,
    TTrackedMarkdown,
} from './markdownSourceMap';
import type { ITableRowSourceSyntax, ITableState } from './types';
import stringWidth from '../utils/stringWidth';
import { escapeTableText } from './markdownBlockSerializers';
import {
    boundaryMarkdown,
    concatMarkdown,
    markdownStatePath,
    plainMarkdown,
} from './markdownSourceMap';

export interface IMappedTableSerializationContext {
    readonly sourceMapEnabled: boolean;
    readonly leafPath: (statePath: TMarkdownStatePath) => TMarkdownStatePath;
    readonly mappedText: (
        text: string,
        path: TMarkdownStatePath,
        localStart: number,
    ) => TTrackedMarkdown;
}

export function mappedTableText(
    text: string,
    path: TMarkdownStatePath,
    localStart: number,
    context: IMappedTableSerializationContext,
): TTrackedMarkdown {
    const parts: TTrackedMarkdown[] = [];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '|' && text[index - 1] !== '\\') {
            if (context.sourceMapEnabled) {
                parts.push(boundaryMarkdown(
                    path,
                    localStart + index,
                ));
            }
            parts.push(plainMarkdown('\\'));
        }
        parts.push(context.mappedText(text[index], path, localStart + index));
    }
    return concatMarkdown(parts);
}

export function serializeTable(
    state: ITableState,
    indent: string,
    statePath: TMarkdownStatePath,
    context: IMappedTableSerializationContext,
): TTrackedMarkdown {
    const result: TTrackedMarkdown[] = [];
    const row = state.children.length;
    const tableData: Array<Array<{
        cellPath: TMarkdownStatePath;
        escaped: string;
        localStart: number;
        text: string;
        textPath: TMarkdownStatePath;
    }>> = [];

    state.children.forEach((rowState, rowIndex) => {
        tableData.push(
            rowState.children.map((cell, cellIndex) => {
                const text = cell.text.trim();
                const cellPath = markdownStatePath([
                    ...statePath,
                    'children',
                    rowIndex,
                    'children',
                    cellIndex,
                ]);
                return {
                    cellPath,
                    escaped: escapeTableText(text),
                    localStart: text ? cell.text.indexOf(text) : 0,
                    text,
                    textPath: context.leafPath(cellPath),
                };
            }),
        );
    });

    const sourceSyntax = state.sourceTrivia?.tableSourceSyntax;
    if (sourceSyntax) {
        const sourceRows = [
            sourceSyntax.header,
            ...sourceSyntax.rows,
        ];
        const sourceColumnCount = sourceSyntax.header.cells.length;
        const syntaxShapeValid
            = sourceSyntax.header.segments.length
                === sourceColumnCount + 1
                && sourceSyntax.delimiter.cells.length === sourceColumnCount
                && sourceSyntax.delimiter.segments.length
                === sourceColumnCount + 1
                && sourceSyntax.alignments.length === sourceColumnCount
                && sourceSyntax.rows.every(rowSyntax =>
                    rowSyntax.cells.length === sourceColumnCount
                    && rowSyntax.segments.length === sourceColumnCount + 1);
        if (!syntaxShapeValid) {
            throw new TypeError(
                'Parser-owned table source syntax has inconsistent column counts.',
            );
        }
        const topologyMatches = sourceRows.length === tableData.length
            && tableData.every(rowData =>
                rowData.length === sourceColumnCount);
        const alignmentMatches = topologyMatches
            && state.children[0].children.every((cell, index) =>
                cell.meta.align === sourceSyntax.alignments[index]);
        if (topologyMatches && alignmentMatches) {
            const serializeSourceRow = (
                rowData: typeof tableData[number],
                rowSyntax: ITableRowSourceSyntax,
                rowPath: TMarkdownStatePath,
                delimiter = false,
            ): TTrackedMarkdown => {
                const parts: TTrackedMarkdown[] = [
                    plainMarkdown(`${indent}${rowSyntax.segments[0]}`),
                ];
                rowData.forEach((cell, cellIndex) => {
                    const content = delimiter
                        ? plainMarkdown(rowSyntax.cells[cellIndex]).withNode(
                                markdownStatePath([
                                    ...cell.cellPath,
                                    'meta',
                                    'align',
                                ]),
                            )
                        : mappedTableText(
                                cell.text,
                                cell.textPath,
                                cell.localStart,
                                context,
                            ).withNode(cell.cellPath);
                    parts.push(
                        content,
                        plainMarkdown(rowSyntax.segments[cellIndex + 1]),
                    );
                });
                return concatMarkdown([
                    concatMarkdown(parts),
                    plainMarkdown('\n'),
                ]).withNode(rowPath);
            };

            const sourceResult: TTrackedMarkdown[] = [];
            tableData.forEach((rowData, rowIndex) => {
                const rowPath = markdownStatePath([
                    ...statePath,
                    'children',
                    rowIndex,
                ]);
                sourceResult.push(serializeSourceRow(
                    rowData,
                    sourceRows[rowIndex],
                    rowPath,
                ));
                if (rowIndex === 0) {
                    sourceResult.push(serializeSourceRow(
                        rowData,
                        sourceSyntax.delimiter,
                        rowPath,
                        true,
                    ));
                }
            });
            return concatMarkdown(sourceResult);
        }
    }

    const columnWidth = state.children[0].children.map(th => ({
        width: 5,
        align: th.meta.align,
    }));

    let i;
    let j;

    for (i = 0; i < row; i++) {
        const cells = Math.min(tableData[i].length, columnWidth.length);
        for (j = 0; j < cells; j++) {
            columnWidth[j].width = Math.max(
                columnWidth[j].width,
                stringWidth(tableData[i][j].escaped) + 2,
            ); // add 2, because have two space around text
        }
    }

    tableData.forEach((r, i) => {
        const rowParts: TTrackedMarkdown[] = [plainMarkdown(`${indent}|`)];
        const emittedCells = r.slice(0, columnWidth.length);
        emittedCells.forEach((cell, j) => {
            const cellWidth = columnWidth[j].width;
            const fill = cellWidth
                - 1
                - stringWidth(cell.escaped);
            rowParts.push(concatMarkdown([
                plainMarkdown(' '),
                mappedTableText(
                    cell.text,
                    cell.textPath,
                    cell.localStart,
                    context,
                ),
                plainMarkdown(' '.repeat(Math.max(fill, 1))),
                plainMarkdown('|'),
            ]).withNode(cell.cellPath));
        });
        if (!emittedCells.length)
            rowParts.push(plainMarkdown('|'));

        const serializedRow: TTrackedMarkdown[] = [
            concatMarkdown(rowParts),
            plainMarkdown('\n'),
        ];
        if (i === 0) {
            const alignmentParts: TTrackedMarkdown[] = [
                plainMarkdown(`${indent}|`),
            ];
            columnWidth.forEach(({ width: initialWidth, align }, columnIndex) => {
                const cell = tableData[0][columnIndex];
                const width = initialWidth;
                let raw = '-'.repeat(Math.max(width, 5) - 2);
                switch (align) {
                    case 'left':
                        raw = `:${raw} `;
                        break;

                    case 'center':
                        raw = `:${raw}:`;
                        break;

                    case 'right':
                        raw = ` ${raw}:`;
                        break;
                    default:
                        raw = ` ${raw} `;
                        break;
                }

                const segment = plainMarkdown(`${raw}|`);
                alignmentParts.push(cell
                    ? segment.withNode(markdownStatePath([
                            ...cell.cellPath,
                            'meta',
                            'align',
                        ]))
                    : segment);
            });
            if (!columnWidth.length)
                alignmentParts.push(plainMarkdown('|'));
            serializedRow.push(
                concatMarkdown(alignmentParts),
                plainMarkdown('\n'),
            );
        }

        const rowPath = markdownStatePath([
            ...statePath,
            'children',
            i,
        ]);
        result.push(concatMarkdown(serializedRow).withNode(rowPath));
    });

    return concatMarkdown(result);
}
