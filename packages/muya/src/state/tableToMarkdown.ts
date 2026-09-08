import type { ITableState } from './types';
import stringWidth from '../utils/stringWidth';

function escapeText(str: string) {
    return str.replace(/(?<!\\)\|/g, '\\|');
}

/** Native table fragment spelling, excluding its enclosing block's line ending. */
export function tableToMarkdown(state: ITableState, indent?: string): string;
export function tableToMarkdown(state: ITableState, indent: string, maximumUnits: number): string | undefined;
export function tableToMarkdown(state: ITableState, indent = '', maximumUnits = Number.MAX_SAFE_INTEGER): string | undefined {
    const result: string[] = [];
    const row = state.children.length;
    const tableData = [];

    for (const rowState of state.children) {
        tableData.push(
            rowState.children.map(cell => escapeText(cell.text.trim())),
        );
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
                stringWidth(tableData[i][j]) + 2,
            ); // add 2, because have two space around text
        }
    }

    // Account for exact source units before padding expands a narrow cell to
    // another row's width. Display columns and UTF-16 units differ for Unicode.
    let outputUnits = row + indent.length + 1
        + columnWidth.reduce((sum, column) => sum + column.width + 1, 0);
    for (const cells of tableData) {
        outputUnits += indent.length + 1;
        for (let column = 0; column < Math.min(cells.length, columnWidth.length); column++) {
            const cell = cells[column];
            const fill = Math.max(columnWidth[column].width - 1 - stringWidth(cell), 0);
            outputUnits += 1 + cell.length + fill + 1;
        }
        if (outputUnits > maximumUnits)
            return undefined;
    }

    tableData.forEach((r, i) => {
        const rs
            = `${indent
            }|${
                r
                    .slice(0, columnWidth.length)
                    .map((cell, j) => {
                        // Pad by visual column width, not code-unit length,
                        // so combining marks and wide characters stay
                        // aligned (#1983). One leading space + cell + fill.
                        const fill = columnWidth[j].width - 1 - stringWidth(cell);

                        return ` ${cell}${' '.repeat(Math.max(fill, 0))}`;
                    })
                    .join('|')
            }|`;
        result.push(rs);
        if (i === 0) {
            const cutOff
                = `${indent
                }|${
                    columnWidth
                        .map(({ width, align }) => {
                            let raw = '-'.repeat(width - 2);
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

                            return raw;
                        })
                        .join('|')
                }|`;
            result.push(cutOff);
        }
    });

    return result.join('\n');
}
