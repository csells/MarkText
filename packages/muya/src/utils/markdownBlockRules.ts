// Markdown block-construct rules shared by the comment source-mode classifier
// (`comments/source.ts`) and the state parser's dropped-definition scan
// (`state/markdownToState.ts`). Both need to recognize fenced code, math
// blocks, indented code, and front matter while scanning raw markdown lines;
// keeping the rules here means the two scanners cannot drift apart.

export interface IFenceMarker {
    char: '`' | '~';
    length: number;
}

const FENCE_OPEN_REGEXP = /^ {0,3}(`{3,}|~{3,})/u;
const FENCE_CLOSE_REGEXP = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;

// A `$$` math-block delimiter line, and an indented-code line (>= 4 spaces or a
// tab). Consumers own the surrounding block state (a delimiter toggles a math
// block; an indented line is only code outside a paragraph).
export const MATH_BLOCK_DELIM_REGEXP = /^ {0,3}\$\$[ \t]*$/u;
export const INDENTED_CODE_REGEXP = /^(?: {4,}|\t)/u;
export const FRONT_MATTER_OPEN_REGEXP = /^(---|\+\+\+|;;;|\{)[ \t]*$/u;

// The fence marker opening `line`, or null when it does not open a fence.
export function parseFenceMarker(line: string): IFenceMarker | null {
    const match = FENCE_OPEN_REGEXP.exec(line);
    if (!match)
        return null;

    return { char: match[1][0] as '`' | '~', length: match[1].length };
}

// Whether `line` closes an open `fence` (same char, at least as long).
export function isFenceClose(line: string, fence: IFenceMarker): boolean {
    const match = FENCE_CLOSE_REGEXP.exec(line);
    return !!match && match[1][0] === fence.char && match[1].length >= fence.length;
}

// The line that closes a front matter block opened by `openMarker`.
export function frontMatterCloseMarker(openMarker: string): string {
    return openMarker === '{' ? '}' : openMarker;
}
