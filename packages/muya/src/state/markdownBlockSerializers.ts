import type {
    ICodeBlockState,
    IDiagramState,
    IFrontmatterState,
    IHtmlBlockState,
    IMathBlockState,
} from './types';

export function escapeTableText(text: string): string {
    return text.replace(/(?<!\\)\|/g, '\\|');
}

export function serializeFrontMatter(state: IFrontmatterState): string {
    let startToken: string | undefined;
    let endToken: string | undefined;
    switch (state.meta.lang) {
        case 'yaml':
            startToken = '---\n';
            endToken = '---\n';
            break;

        case 'toml':
            startToken = '+++\n';
            endToken = '+++\n';
            break;

        case 'json':
            if (state.meta.style === ';') {
                startToken = ';;;\n';
                endToken = ';;;\n';
            }
            else {
                startToken = '{\n';
                endToken = '}\n';
            }
            break;
    }

    return [
        startToken,
        ...state.text.split('\n').map(line => `${line}\n`),
        endToken,
    ].join('');
}

function codeFenceLength(text: string, stored?: number): number {
    let longestInterior = 0;
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (/^`+$/.test(trimmed))
            longestInterior = Math.max(longestInterior, trimmed.length);
    }

    return Math.max(3, stored ?? 3, longestInterior + 1);
}

export function serializeCodeBlock(
    state: ICodeBlockState,
    indent: string,
): string {
    const result: string[] = [];
    const { text, meta } = state;
    const lines = text.split('\n');
    // `meta.lang` holds the full info string verbatim, so emit it as-is.
    const { type, lang } = meta;

    if (type === 'fenced') {
        const fence = '`'.repeat(codeFenceLength(text, meta.fenceLength));
        result.push(`${indent}${lang ? `${fence}${lang}\n` : `${fence}\n`}`);
        for (const line of lines)
            result.push(`${indent}${line}\n`);
        if (meta.fenceClosed !== false)
            result.push(`${indent}${fence}\n`);
    }
    else {
        for (const line of lines)
            result.push(`${indent}    ${line}\n`);
    }

    return result.join('');
}

export function serializeHtmlBlock(
    state: IHtmlBlockState,
    indent: string,
): string {
    return state.text
        .split('\n')
        .map(line => `${indent}${line}\n`)
        .join('');
}

export function serializeMathBlock(
    state: IMathBlockState,
    indent: string,
): string {
    const fence = state.meta.mathStyle === '' ? '$$' : '```math';
    const close = state.meta.mathStyle === '' ? '$$' : '```';

    return [
        `${indent}${fence}\n`,
        ...state.text.split('\n').map(line => `${indent}${line}\n`),
        `${indent}${close}\n`,
    ].join('');
}

export function serializeDiagramBlock(
    state: IDiagramState,
    indent: string,
): string {
    return [
        `${indent}\`\`\`${state.meta.type}\n`,
        ...state.text.split('\n').map(line => `${indent}${line}\n`),
        `${indent}\`\`\`\n`,
    ].join('');
}
