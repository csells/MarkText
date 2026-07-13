/**
 * A retained slice of a footnote definition body before Marked tokenizes it.
 * Joining these slices produces the parser-facing body while preserving an
 * exact route back to the original definition source.
 */
export interface IFootnoteBodySourceSlice {
    start: number;
    end: number;
}

function isNonWhitespace(character: string | undefined): boolean {
    return character !== undefined && /\S/u.test(character);
}

/**
 * Describe the normalization performed before a footnote body is passed back
 * to Marked's block lexer. Keeping this as source slices lets parser adapters
 * apply the identical normalization without losing source provenance.
 */
export function footnoteBodySourceSlices(
    body: string,
): IFootnoteBodySourceSlice[] {
    let bodyStart = 0;

    // `[^id]: text` may contain horizontal whitespace after the marker.
    while (body[bodyStart] === ' ' || body[bodyStart] === '\t')
        bodyStart++;

    // `[^id]:\n    text` starts its parser-facing body after the blank line.
    while (body[bodyStart] === '\n')
        bodyStart++;

    // The first continuation line is de-indented independently because it no
    // longer has a preceding newline after the leading-newline step above.
    if (body.slice(bodyStart, bodyStart + 4) === '    ')
        bodyStart += 4;

    let bodyEnd = body.length;
    while (bodyEnd > bodyStart && body[bodyEnd - 1] === '\n')
        bodyEnd--;

    if (bodyStart >= bodyEnd)
        return [];

    const slices: IFootnoteBodySourceSlice[] = [];
    let sliceStart = bodyStart;

    for (let index = bodyStart; index < bodyEnd; index++) {
        const continuationStart = index + 1;
        if (
            body[index] === '\n'
            && body.slice(continuationStart, continuationStart + 4) === '    '
            && isNonWhitespace(body[continuationStart + 4])
        ) {
            slices.push({ start: sliceStart, end: continuationStart });
            sliceStart = continuationStart + 4;
            index = sliceStart - 1;
        }
    }

    if (sliceStart < bodyEnd)
        slices.push({ start: sliceStart, end: bodyEnd });

    return slices;
}

export function normalizeFootnoteBody(body: string): string {
    return footnoteBodySourceSlices(body)
        .map(slice => body.slice(slice.start, slice.end))
        .join('');
}
