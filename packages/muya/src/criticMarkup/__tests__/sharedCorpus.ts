export interface ICriticMarkupCorpusRow {
    id: string;
    tags: readonly string[];
    source: string;
    options: {
        footnote?: boolean;
        frontMatter?: boolean;
        isGitlabCompatibilityEnabled?: boolean;
        math?: boolean;
        superSubScript?: boolean;
    };
    normalization:
        | { kind: 'exact' }
        | { kind: 'known'; output: string; reason: string };
    expected: {
        itemTypes: readonly string[];
        itemRaw: readonly string[];
        /**
         * Semantic coordinates are against `normalization.output` when the
         * row names a known serializer normalization, otherwise `source`.
         * They are declarations, never values derived from the document under
         * test.
         */
        itemContracts: readonly ICriticMarkupCorpusItemContract[];
        literalRanges: readonly ICriticMarkupCorpusRange[];
        /**
         * Items whose visible owner cannot contain semantic wrapper nodes.
         * Both index and range are explicit so repeated image alternatives do
         * not collapse to raw-text identity.
         */
        plainTextItems: readonly {
            itemIndex: number;
            sourceRange: ICriticMarkupCorpusRange;
        }[];
        original: string;
        revised: string;
        /**
         * Exact Markdown produced after the app reparses a resolved projection.
         * Name this only when the pre-existing block serializer normalizes
         * bytes exposed by removing CriticMarkup syntax. The direct parser
         * projections above remain lossless and are asserted independently.
         */
        resolution?: {
            accept: string;
            reject: string;
            reason: string;
        };
        mustBeInert?: boolean;
    };
}

export interface ICriticMarkupCorpusRange {
    start: number;
    end: number;
}

export interface ICriticMarkupCorpusFragmentContract {
    role: 'only' | 'start' | 'middle' | 'end';
    path: readonly (string | number)[];
    localRange: ICriticMarkupCorpusRange;
    sourceRange: ICriticMarkupCorpusRange;
}

export interface ICriticMarkupCorpusItemContract {
    itemIndex: number;
    sourceRange: ICriticMarkupCorpusRange;
    parentIndex: number | null;
    depth: number;
    documentOrder: number;
    fragments: readonly ICriticMarkupCorpusFragmentContract[];
}

function range(start: number, end: number): ICriticMarkupCorpusRange {
    return { start, end };
}

function fragment(
    role: ICriticMarkupCorpusFragmentContract['role'],
    path: readonly (string | number)[],
    localStart: number,
    localEnd: number,
    sourceStart: number,
    sourceEnd: number,
): ICriticMarkupCorpusFragmentContract {
    return {
        role,
        path,
        localRange: range(localStart, localEnd),
        sourceRange: range(sourceStart, sourceEnd),
    };
}

function item(
    itemIndex: number,
    sourceStart: number,
    sourceEnd: number,
    parentIndex: number | null,
    depth: number,
    documentOrder: number,
    fragments: readonly ICriticMarkupCorpusFragmentContract[],
): ICriticMarkupCorpusItemContract {
    return {
        itemIndex,
        sourceRange: range(sourceStart, sourceEnd),
        parentIndex,
        depth,
        documentOrder,
        fragments,
    };
}

/**
 * Data-only corpus shared by the parser, live editor, projection, and sink
 * adapters. Add syntax/context rows here instead of copying source fixtures
 * between boundary-specific suites.
 */
export const CRITIC_MARKUP_CORPUS: readonly ICriticMarkupCorpusRow[] = [
    {
        id: 'all-five-canonical-forms',
        tags: ['syntax', 'canonical', 'adjacent'],
        source: 'A {++new++} {--old--} {~~old~>new~~} {==focus==}{>>note<<}.\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [
                'addition',
                'deletion',
                'substitution',
                'highlight',
                'comment',
            ],
            itemRaw: [
                '{++new++}',
                '{--old--}',
                '{~~old~>new~~}',
                '{==focus==}',
                '{>>note<<}',
            ],
            itemContracts: [
                item(0, 2, 11, null, 0, 0, [
                    fragment('only', [0, 'text'], 2, 11, 2, 11),
                ]),
                item(1, 12, 21, null, 0, 1, [
                    fragment('only', [0, 'text'], 12, 21, 12, 21),
                ]),
                item(2, 22, 36, null, 0, 2, [
                    fragment('only', [0, 'text'], 22, 36, 22, 36),
                ]),
                item(3, 37, 48, null, 0, 3, [
                    fragment('only', [0, 'text'], 37, 48, 37, 48),
                ]),
                item(4, 48, 58, null, 0, 4, [
                    fragment('only', [0, 'text'], 48, 58, 48, 58),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: 'A  old old focus.\n',
            revised: 'A new  new focus.\n',
        },
    },
    {
        id: 'empty-forms-and-substitution-arms',
        tags: ['syntax', 'empty'],
        source: '{++++}|{----}|{~~~>new~~}|{~~old~>~~}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [
                'addition',
                'deletion',
                'substitution',
                'substitution',
            ],
            itemRaw: [
                '{++++}',
                '{----}',
                '{~~~>new~~}',
                '{~~old~>~~}',
            ],
            itemContracts: [
                item(0, 0, 6, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 6, 0, 6),
                ]),
                item(1, 7, 13, null, 0, 1, [
                    fragment('only', [0, 'text'], 7, 13, 7, 13),
                ]),
                item(2, 14, 25, null, 0, 2, [
                    fragment('only', [0, 'text'], 14, 25, 14, 25),
                ]),
                item(3, 26, 37, null, 0, 3, [
                    fragment('only', [0, 'text'], 26, 37, 26, 37),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '|||old\n',
            revised: '||new|\n',
        },
    },
    {
        id: 'mixed-nested-forms',
        tags: ['syntax', 'nested'],
        source: '{++outer {--inner--} {==focus==}++}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'deletion', 'highlight'],
            itemRaw: [
                '{++outer {--inner--} {==focus==}++}',
                '{--inner--}',
                '{==focus==}',
            ],
            itemContracts: [
                item(0, 0, 35, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 35, 0, 35),
                ]),
                item(1, 9, 20, 0, 1, 1, [
                    fragment('only', [0, 'text'], 9, 20, 9, 20),
                ]),
                item(2, 21, 32, 0, 1, 2, [
                    fragment('only', [0, 'text'], 21, 32, 21, 32),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '\n',
            revised: 'outer  focus\n',
        },
    },
    {
        id: 'same-type-nested-additions',
        tags: ['syntax', 'nested', 'same-type'],
        source: '{++outer {++inner++} tail++}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition'],
            itemRaw: [
                '{++outer {++inner++} tail++}',
                '{++inner++}',
            ],
            itemContracts: [
                item(0, 0, 28, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 28, 0, 28),
                ]),
                item(1, 9, 20, 0, 1, 1, [
                    fragment('only', [0, 'text'], 9, 20, 9, 20),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '\n',
            revised: 'outer inner tail\n',
        },
    },
    {
        id: 'malformed-outer-recovers-inner-and-later-items',
        tags: ['syntax', 'malformed', 'recovery'],
        source: '{++unfinished {--complete--} and {~~bad no separator~~} {==later==}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['deletion', 'highlight'],
            itemRaw: ['{--complete--}', '{==later==}'],
            itemContracts: [
                item(0, 14, 28, null, 0, 0, [
                    fragment('only', [0, 'text'], 14, 28, 14, 28),
                ]),
                item(1, 56, 67, null, 0, 1, [
                    fragment('only', [0, 'text'], 56, 67, 56, 67),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '{++unfinished complete and {~~bad no separator~~} later\n',
            revised: '{++unfinished  and {~~bad no separator~~} later\n',
        },
    },
    {
        id: 'multiple-substitution-separators-recover-later-item',
        tags: ['syntax', 'malformed', 'recovery'],
        source: '{~~a~>b~>c~~} {++later++}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++later++}'],
            itemContracts: [
                item(0, 14, 25, null, 0, 0, [
                    fragment('only', [0, 'text'], 14, 25, 14, 25),
                ]),
            ],
            literalRanges: [range(4, 8)],
            plainTextItems: [],
            original: '{~~a~>b~>c~~} \n',
            revised: '{~~a~>b~>c~~} later\n',
        },
    },
    {
        id: 'dangling-mismatched-zero-and-multiple-separators',
        tags: [
            'syntax',
            'malformed',
            'recovery',
            'dangling-close',
            'mismatched-close',
            'zero-separator',
            'multiple-separator',
        ],
        source: 'orphan ++} {++wrong--} {~~zero~~} {~~many~>one~>two~~} {--later--}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['deletion'],
            itemRaw: ['{--later--}'],
            itemContracts: [
                item(0, 55, 66, null, 0, 0, [
                    fragment('only', [0, 'text'], 55, 66, 55, 66),
                ]),
            ],
            literalRanges: [range(41, 47)],
            plainTextItems: [],
            original: 'orphan ++} {++wrong--} {~~zero~~} {~~many~>one~>two~~} later\n',
            revised: 'orphan ++} {++wrong--} {~~zero~~} {~~many~>one~>two~~} \n',
        },
    },
    {
        id: 'escaped-opener-and-closer-like-payload',
        tags: ['syntax', 'escape'],
        source: '\\{++literal++} {++a\\++}b++}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++a\\++}b++}'],
            itemContracts: [
                item(0, 15, 27, null, 0, 0, [
                    fragment('only', [0, 'text'], 15, 27, 15, 27),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '\\{++literal++} \n',
            revised: '\\{++literal++} a\\++}b\n',
        },
    },
    {
        id: 'odd-and-even-backslash-runs-at-delimiters',
        tags: ['syntax', 'escape', 'odd-even'],
        source: 'odd \\{++literal++} even \\\\{++live++}\n'
            + '{++close \\++} inside \\\\++}\n'
            + '{~~old \\~> still old \\\\~>new~~}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition', 'substitution'],
            itemRaw: [
                '{++live++}',
                '{++close \\++} inside \\\\++}',
                '{~~old \\~> still old \\\\~>new~~}',
            ],
            itemContracts: [
                item(0, 26, 36, null, 0, 0, [
                    fragment('only', [0, 'text'], 26, 36, 26, 36),
                ]),
                item(1, 37, 63, null, 0, 1, [
                    fragment('only', [0, 'text'], 37, 63, 37, 63),
                ]),
                item(2, 64, 95, null, 0, 2, [
                    fragment('only', [0, 'text'], 64, 95, 64, 95),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: 'odd \\{++literal++} even \\\\'
                + '\n\n'
                + 'old ~> still old \\\\'
                + '\n',
            revised: 'odd \\{++literal++} even \\\\live\n'
                + 'close \\++} inside \\\\'
                + '\nnew\n',
            resolution: {
                accept: 'odd \\{++literal++} even \\\\live\n'
                    + 'close \\++} inside \\\\'
                    + '\nnew\n',
                reject: 'odd \\{++literal++} even \\\\'
                    + '\nold ~> still old \\\\'
                    + '\n',
                reason: 'Rejecting the second-line addition erases the whole line, so resolution collapses the vacated mid-document junction that the lossless projection keeps blank.',
            },
        },
    },
    {
        id: 'block-spanning-addition',
        tags: ['syntax', 'block-spanning'],
        source: 'before {++one\n\n# two++} after\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++one\n\n# two++}'],
            itemContracts: [
                item(0, 7, 23, null, 0, 0, [
                    fragment('start', [0, 'text'], 7, 13, 7, 13),
                    fragment('end', [1, 'text'], 0, 8, 15, 23),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: 'before  after\n',
            revised: 'before one\n\n# two after\n',
        },
    },
    {
        id: 'nested-block-spanning-addition-and-deletion',
        tags: ['syntax', 'nested', 'block-spanning'],
        source: 'before {++outer\n\n# {--inner\n\ntail--} end++} after\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'deletion'],
            itemRaw: [
                '{++outer\n\n# {--inner\n\ntail--} end++}',
                '{--inner\n\ntail--}',
            ],
            itemContracts: [
                item(0, 7, 43, null, 0, 0, [
                    fragment('start', [0, 'text'], 7, 15, 7, 15),
                    fragment('middle', [1, 'text'], 0, 10, 17, 27),
                    fragment('end', [2, 'text'], 0, 14, 29, 43),
                ]),
                item(1, 19, 36, 0, 1, 1, [
                    fragment('start', [1, 'text'], 2, 10, 19, 27),
                    fragment('end', [2, 'text'], 0, 7, 29, 36),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: 'before  after\n',
            revised: 'before outer\n\n#  end after\n',
            resolution: {
                accept: 'before outer\n\n# end after\n',
                reject: 'before  after\n',
                reason: 'Resolving the nested deletion exposes a second ATX heading separator space, which the existing heading serializer trims.',
            },
        },
    },
    {
        id: 'inline-fenced-and-indented-code-contexts',
        tags: ['context', 'code', 'literal-context'],
        source: '`{++inline++}` {++visible++}\n\n```md\n{--fenced--}\n```\n\n    {==indented==}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++visible++}'],
            itemContracts: [
                item(0, 15, 28, null, 0, 0, [
                    fragment('only', [0, 'text'], 15, 28, 15, 28),
                ]),
            ],
            literalRanges: [range(0, 14), range(30, 52), range(54, 73)],
            plainTextItems: [],
            original: '`{++inline++}` \n\n```md\n{--fenced--}\n```\n\n    {==indented==}\n',
            revised: '`{++inline++}` visible\n\n```md\n{--fenced--}\n```\n\n    {==indented==}\n',
        },
    },
    {
        id: 'soft-wrapped-inline-code-span',
        tags: ['context', 'code', 'soft-wrap', 'literal-context'],
        source: 'before `{++literal\ncontinued++}` after {--visible--}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['deletion'],
            itemRaw: ['{--visible--}'],
            itemContracts: [
                item(0, 39, 52, null, 0, 0, [
                    fragment('only', [0, 'text'], 39, 52, 39, 52),
                ]),
            ],
            literalRanges: [range(7, 32)],
            plainTextItems: [],
            original: 'before `{++literal\ncontinued++}` after visible\n',
            revised: 'before `{++literal\ncontinued++}` after \n',
        },
    },
    {
        id: 'fenced-code-inside-blockquote-and-list',
        tags: [
            'context',
            'code',
            'fence',
            'blockquote',
            'list',
            'literal-context',
        ],
        source: '> ```md\n> {++quoted literal++}\n> ```\n\n- ```md\n  {--listed literal--}\n  ```\n\n{==visible==}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['highlight'],
            itemRaw: ['{==visible==}'],
            itemContracts: [
                item(0, 76, 89, null, 0, 0, [
                    fragment('only', [2, 'text'], 0, 13, 76, 89),
                ]),
            ],
            literalRanges: [range(2, 36), range(40, 74)],
            plainTextItems: [],
            original: '> ```md\n> {++quoted literal++}\n> ```\n\n- ```md\n  {--listed literal--}\n  ```\n\nvisible\n',
            revised: '> ```md\n> {++quoted literal++}\n> ```\n\n- ```md\n  {--listed literal--}\n  ```\n\nvisible\n',
        },
    },
    {
        id: 'ordinary-gfm-strike-beside-substitution',
        tags: ['syntax', 'gfm-strikethrough'],
        source: '~~ordinary~~ {~~old~>new~~}\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['substitution'],
            itemRaw: ['{~~old~>new~~}'],
            itemContracts: [
                item(0, 13, 27, null, 0, 0, [
                    fragment('only', [0, 'text'], 13, 27, 13, 27),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '~~ordinary~~ old\n',
            revised: '~~ordinary~~ new\n',
        },
    },
    {
        id: 'bom-crlf-and-astral-boundaries',
        tags: ['bytes', 'bom', 'crlf', 'astral'],
        source: '\uFEFF😀 {++🚀++}\r\n{--旧--}\r\n',
        options: {},
        normalization: {
            kind: 'known',
            output: '\uFEFF😀 {++🚀++}\n{--旧--}\r\n',
            reason: 'The parser normalizes internal CRLF to LF while terminal-EOL trivia preserves the final CRLF.',
        },
        expected: {
            itemTypes: ['addition', 'deletion'],
            itemRaw: ['{++🚀++}', '{--旧--}'],
            itemContracts: [
                item(0, 4, 12, null, 0, 0, [
                    fragment('only', [0, 'text'], 4, 12, 4, 12),
                ]),
                item(1, 13, 20, null, 0, 1, [
                    fragment('only', [0, 'text'], 13, 20, 13, 20),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '\uFEFF😀 \r\n旧\r\n',
            revised: '\uFEFF😀 🚀\r\n\r\n',
        },
    },
    {
        id: 'yaml-front-matter',
        tags: ['front-matter', 'literal-context'],
        source: '---\ntitle: "{++literal++}"\n---\n\nBody\n',
        options: { frontMatter: true },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [],
            itemRaw: [],
            itemContracts: [],
            literalRanges: [range(0, 32)],
            plainTextItems: [],
            original: '---\ntitle: "{++literal++}"\n---\n\nBody\n',
            revised: '---\ntitle: "{++literal++}"\n---\n\nBody\n',
        },
    },
    {
        id: 'toml-front-matter',
        tags: ['front-matter', 'literal-context'],
        source: '+++\ntitle = "{++literal++}"\n+++\n\nBody\n',
        options: { frontMatter: true },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [],
            itemRaw: [],
            itemContracts: [],
            literalRanges: [range(0, 33)],
            plainTextItems: [],
            original: '+++\ntitle = "{++literal++}"\n+++\n\nBody\n',
            revised: '+++\ntitle = "{++literal++}"\n+++\n\nBody\n',
        },
    },
    {
        id: 'semicolon-json-front-matter',
        tags: ['front-matter', 'literal-context'],
        source: ';;;\n{"title":"{++literal++}"}\n;;;\n\nBody\n',
        options: { frontMatter: true },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [],
            itemRaw: [],
            itemContracts: [],
            literalRanges: [range(0, 35)],
            plainTextItems: [],
            original: ';;;\n{"title":"{++literal++}"}\n;;;\n\nBody\n',
            revised: ';;;\n{"title":"{++literal++}"}\n;;;\n\nBody\n',
        },
    },
    {
        id: 'brace-json-front-matter',
        tags: ['front-matter', 'literal-context'],
        source: '{\n"title":"{++literal++}"\n}\n\nBody\n',
        options: { frontMatter: true },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [],
            itemRaw: [],
            itemContracts: [],
            literalRanges: [range(0, 29)],
            plainTextItems: [],
            original: '{\n"title":"{++literal++}"\n}\n\nBody\n',
            revised: '{\n"title":"{++literal++}"\n}\n\nBody\n',
        },
    },
    {
        id: 'unterminated-yaml-front-matter-looking-prefix',
        tags: ['front-matter-lookalike', 'recovery'],
        source: '---\ntitle: {++visible++}\n',
        options: { frontMatter: true },
        normalization: {
            kind: 'known',
            output: '---\n\ntitle: {++visible++}\n',
            reason: 'The existing block serializer separates a thematic break from the following paragraph with one blank line.',
        },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++visible++}'],
            itemContracts: [
                item(0, 12, 25, null, 0, 0, [
                    fragment('only', [1, 'text'], 7, 20, 12, 25),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '---\ntitle: \n',
            revised: '---\ntitle: visible\n',
        },
    },
    {
        id: 'bare-yaml-front-matter-looking-prefix',
        tags: ['front-matter-lookalike', 'recovery'],
        source: '---\n\n{++visible++}\n',
        options: { frontMatter: true },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++visible++}'],
            itemContracts: [
                item(0, 5, 18, null, 0, 0, [
                    fragment('only', [1, 'text'], 0, 13, 5, 18),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '---\n\n\n',
            revised: '---\n\nvisible\n',
            resolution: {
                accept: '---\n\nvisible\n',
                reject: '---\n',
                reason: 'Rejecting the only paragraph erases the final line, so resolution collapses the vacated junction to exactly one final newline.',
            },
        },
    },
    {
        id: 'yaml-front-matter-option-disabled',
        tags: ['front-matter-disabled', 'parser-options'],
        source: '---\ntitle: "{++visible++}"\n---\n\nBody\n',
        options: { frontMatter: false },
        normalization: {
            kind: 'known',
            output: '---\n\ntitle: "{++visible++}"\n---\n\nBody\n',
            reason: 'With front matter disabled, the existing block serializer separates the opening thematic break from the following paragraph.',
        },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++visible++}'],
            itemContracts: [
                item(0, 13, 26, null, 0, 0, [
                    fragment('only', [1, 'text'], 8, 21, 13, 26),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '---\ntitle: ""\n---\n\nBody\n',
            revised: '---\ntitle: "visible"\n---\n\nBody\n',
        },
    },
    {
        id: 'identical-substitution-arms-with-literal-link-destinations',
        tags: ['substitution', 'repeated-text', 'link-destination'],
        source: '{~~[x](u{++v++})~>[x](u{++v++})~~}',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['substitution'],
            itemRaw: ['{~~[x](u{++v++})~>[x](u{++v++})~~}'],
            itemContracts: [
                item(0, 0, 34, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 34, 0, 34),
                ]),
            ],
            literalRanges: [
                range(3, 4),
                range(5, 16),
                range(18, 19),
                range(20, 31),
            ],
            plainTextItems: [],
            original: '[x](u{++v++})',
            revised: '[x](u{++v++})',
        },
    },
    {
        id: 'substitution-new-arm-inline-math-owns-inner-critic-bytes',
        tags: ['substitution', 'semantic-arm', 'math', 'literal-context'],
        source: '{~~placeholder~>$x + {++literal++}$~~}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: true,
            math: true,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['substitution'],
            itemRaw: ['{~~placeholder~>$x + {++literal++}$~~}'],
            itemContracts: [
                item(0, 0, 38, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 38, 0, 38),
                ]),
            ],
            literalRanges: [range(16, 35)],
            plainTextItems: [],
            original: 'placeholder\n',
            revised: '$x + {++literal++}$\n',
        },
    },
    {
        id: 'additions-construct-inline-math-delimiters',
        tags: ['addition', 'constructed-context', 'math'],
        source: '{++$++}x{++$++}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: true,
            math: true,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition'],
            itemRaw: ['{++$++}', '{++$++}'],
            itemContracts: [
                item(0, 0, 7, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 7, 0, 7),
                ]),
                item(1, 8, 15, null, 0, 1, [
                    fragment('only', [0, 'text'], 8, 15, 8, 15),
                ]),
            ],
            literalRanges: [range(3, 4), range(7, 8), range(11, 12)],
            plainTextItems: [],
            original: 'x\n',
            revised: '$x$\n',
        },
    },
    {
        id: 'three-root-additions-construct-inline-math',
        tags: ['addition', 'constructed-context', 'math', 'adjacent'],
        source: '{++$++}{++x++}{++$++}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: true,
            math: true,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition', 'addition'],
            itemRaw: ['{++$++}', '{++x++}', '{++$++}'],
            itemContracts: [
                item(0, 0, 7, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 7, 0, 7),
                ]),
                item(1, 7, 14, null, 0, 1, [
                    fragment('only', [0, 'text'], 7, 14, 7, 14),
                ]),
                item(2, 14, 21, null, 0, 2, [
                    fragment('only', [0, 'text'], 14, 21, 14, 21),
                ]),
            ],
            literalRanges: [range(3, 4), range(10, 11), range(17, 18)],
            plainTextItems: [],
            original: '\n',
            revised: '$x$\n',
        },
    },
    {
        id: 'comment-arm-inline-code-owns-inner-critic-bytes',
        tags: ['comment', 'semantic-arm', 'code', 'literal-context'],
        source: '{>>note `{++literal++}`<<}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['comment'],
            itemRaw: ['{>>note `{++literal++}`<<}'],
            itemContracts: [
                item(0, 0, 26, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 26, 0, 26),
                ]),
            ],
            literalRanges: [range(8, 23)],
            plainTextItems: [],
            original: '\n',
            revised: '\n',
        },
    },
    {
        id: 'headings-emphasis-and-line-breaks',
        tags: ['context', 'heading', 'emphasis', 'line-break'],
        source: '# {++ATX++} **{==bold==}** {--gone--}\n\nSetext {~~old~>new~~}\n----------------------\n\nSoft {==line\nbreak==}  \nhard {++end++}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [
                'addition',
                'highlight',
                'deletion',
                'substitution',
                'highlight',
                'addition',
            ],
            itemRaw: [
                '{++ATX++}',
                '{==bold==}',
                '{--gone--}',
                '{~~old~>new~~}',
                '{==line\nbreak==}',
                '{++end++}',
            ],
            itemContracts: [
                item(0, 2, 11, null, 0, 0, [
                    fragment('only', [0, 'text'], 2, 11, 2, 11),
                ]),
                item(1, 14, 24, null, 0, 1, [
                    fragment('only', [0, 'text'], 14, 24, 14, 24),
                ]),
                item(2, 27, 37, null, 0, 2, [
                    fragment('only', [0, 'text'], 27, 37, 27, 37),
                ]),
                item(3, 46, 60, null, 0, 3, [
                    fragment('only', [1, 'text'], 7, 21, 46, 60),
                ]),
                item(4, 90, 106, null, 0, 4, [
                    fragment('only', [2, 'text'], 5, 21, 90, 106),
                ]),
                item(5, 114, 123, null, 0, 5, [
                    fragment('only', [2, 'text'], 29, 38, 114, 123),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '#  **bold** gone\n\nSetext old\n----------------------\n\nSoft line\nbreak  \nhard \n',
            revised: '# ATX **bold** \n\nSetext new\n----------------------\n\nSoft line\nbreak  \nhard end\n',
            resolution: {
                accept: '# ATX **bold**\n\nSetext new\n----------------------\n\nSoft line\nbreak  \nhard end\n',
                reject: '# **bold** gone\n\nSetext old\n----------------------\n\nSoft line\nbreak  \nhard \n',
                reason: 'Removing heading-edge review syntax exposes leading or trailing ATX whitespace that the existing heading serializer trims.',
            },
        },
    },
    {
        id: 'links-images-autolinks-and-reference-definitions',
        tags: [
            'context',
            'link',
            'image',
            'autolink',
            'reference-definition',
            'literal-context',
        ],
        source: '[label {++new++}](https://e.test/{--dest--} "{==title==}") ![{++new++}](img/{--path--}.png "{>>image title<<}") <https://e.test/{++auto++}>\n\n[id]: https://e.test/{++ref-dest++} "{--ref-title--}"\n\n[ref {~~old~>new~~}][id] ![{--ref alt--}][id]\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: [
                'addition',
                'addition',
                'substitution',
                'deletion',
            ],
            itemRaw: [
                '{++new++}',
                '{++new++}',
                '{~~old~>new~~}',
                '{--ref alt--}',
            ],
            itemContracts: [
                item(0, 7, 16, null, 0, 0, [
                    fragment('only', [0, 'text'], 7, 16, 7, 16),
                ]),
                item(1, 61, 70, null, 0, 1, [
                    fragment('only', [0, 'text'], 61, 70, 61, 70),
                ]),
                item(2, 201, 215, null, 0, 2, [
                    fragment('only', [2, 'text'], 5, 19, 201, 215),
                ]),
                item(3, 223, 236, null, 0, 3, [
                    fragment('only', [2, 'text'], 27, 40, 223, 236),
                ]),
            ],
            literalRanges: [
                range(0, 1),
                range(16, 58),
                range(59, 61),
                range(70, 111),
                range(112, 139),
                range(141, 194),
                range(196, 197),
                range(215, 220),
                range(221, 223),
                range(236, 241),
            ],
            plainTextItems: [
                { itemIndex: 1, sourceRange: range(61, 70) },
                { itemIndex: 3, sourceRange: range(223, 236) },
            ],
            original: '[label ](https://e.test/{--dest--} "{==title==}") ![](img/{--path--}.png "{>>image title<<}") <https://e.test/{++auto++}>\n\n[id]: https://e.test/{++ref-dest++} "{--ref-title--}"\n\n[ref old][id] ![ref alt][id]\n',
            revised: '[label new](https://e.test/{--dest--} "{==title==}") ![new](img/{--path--}.png "{>>image title<<}") <https://e.test/{++auto++}>\n\n[id]: https://e.test/{++ref-dest++} "{--ref-title--}"\n\n[ref new][id] ![][id]\n',
        },
    },
    {
        id: 'repeated-identical-link-labels-and-image-alternatives',
        tags: [
            'context',
            'link',
            'image',
            'image-alt',
            'repeated-text',
            'plain-text-owner',
        ],
        source: '[same {++x++}](u) [same {++x++}](u) ![{--alt--}](img.png) ![{--alt--}](img.png)\n',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition', 'deletion', 'deletion'],
            itemRaw: [
                '{++x++}',
                '{++x++}',
                '{--alt--}',
                '{--alt--}',
            ],
            itemContracts: [
                item(0, 6, 13, null, 0, 0, [
                    fragment('only', [0, 'text'], 6, 13, 6, 13),
                ]),
                item(1, 24, 31, null, 0, 1, [
                    fragment('only', [0, 'text'], 24, 31, 24, 31),
                ]),
                item(2, 38, 47, null, 0, 2, [
                    fragment('only', [0, 'text'], 38, 47, 38, 47),
                ]),
                item(3, 60, 69, null, 0, 3, [
                    fragment('only', [0, 'text'], 60, 69, 60, 69),
                ]),
            ],
            literalRanges: [
                range(0, 1),
                range(13, 17),
                range(18, 19),
                range(31, 35),
                range(36, 38),
                range(47, 57),
                range(58, 60),
                range(69, 79),
            ],
            plainTextItems: [
                { itemIndex: 2, sourceRange: range(38, 47) },
                { itemIndex: 3, sourceRange: range(60, 69) },
            ],
            original: '[same ](u) [same ](u) ![alt](img.png) ![alt](img.png)\n',
            revised: '[same x](u) [same x](u) ![](img.png) ![](img.png)\n',
        },
    },
    {
        id: 'inline-and-all-raw-html-block-classes',
        tags: ['context', 'html', 'literal-context'],
        source: '<script>\n{++script literal++}\n</script>\n\n<!-- {--comment literal--} -->\n\n<?review {==pi literal==}?>\n\n<!DOCTYPE html {--declaration literal--}>\n\n<![CDATA[{~~old literal~>new literal~~}]]>\n\n<div data-review="{++attribute literal++}">\n{--block literal--}\n</div>\n\n<x-review data-review="{==type seven literal==}">\n\ninline <span title="{++inline attribute++}">{++visible++}</span> {--outside--}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'deletion'],
            itemRaw: ['{++visible++}', '{--outside--}'],
            itemContracts: [
                item(0, 356, 369, null, 0, 0, [
                    fragment('only', [7, 'text'], 44, 57, 356, 369),
                ]),
                item(1, 377, 390, null, 0, 1, [
                    fragment('only', [7, 'text'], 65, 78, 377, 390),
                ]),
            ],
            literalRanges: [
                range(0, 39),
                range(41, 71),
                range(73, 100),
                range(102, 143),
                range(145, 187),
                range(189, 259),
                range(261, 310),
                range(319, 356),
                range(369, 376),
            ],
            plainTextItems: [],
            original: '<script>\n{++script literal++}\n</script>\n\n<!-- {--comment literal--} -->\n\n<?review {==pi literal==}?>\n\n<!DOCTYPE html {--declaration literal--}>\n\n<![CDATA[{~~old literal~>new literal~~}]]>\n\n<div data-review="{++attribute literal++}">\n{--block literal--}\n</div>\n\n<x-review data-review="{==type seven literal==}">\n\ninline <span title="{++inline attribute++}"></span> outside\n',
            revised: '<script>\n{++script literal++}\n</script>\n\n<!-- {--comment literal--} -->\n\n<?review {==pi literal==}?>\n\n<!DOCTYPE html {--declaration literal--}>\n\n<![CDATA[{~~old literal~>new literal~~}]]>\n\n<div data-review="{++attribute literal++}">\n{--block literal--}\n</div>\n\n<x-review data-review="{==type seven literal==}">\n\ninline <span title="{++inline attribute++}">visible</span> \n',
        },
    },
    {
        id: 'active-inline-block-gitlab-math-and-diagram-contexts',
        tags: [
            'context',
            'math',
            'gitlab',
            'diagram',
            'literal-context',
        ],
        source: 'Inline $x + {++inline math++}$ and {++visible++}.\n\n$$\n{--block math--}\n$$\n\n```math\n{==gitlab math==}\n```\n\n```mermaid\n{>>diagram<<}\n```\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: true,
            math: true,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++visible++}'],
            itemContracts: [
                item(0, 35, 48, null, 0, 0, [
                    fragment('only', [0, 'text'], 35, 48, 35, 48),
                ]),
            ],
            literalRanges: [range(7, 30), range(51, 104), range(106, 135)],
            plainTextItems: [],
            original: 'Inline $x + {++inline math++}$ and .\n\n$$\n{--block math--}\n$$\n\n```math\n{==gitlab math==}\n```\n\n```mermaid\n{>>diagram<<}\n```\n',
            revised: 'Inline $x + {++inline math++}$ and visible.\n\n$$\n{--block math--}\n$$\n\n```math\n{==gitlab math==}\n```\n\n```mermaid\n{>>diagram<<}\n```\n',
        },
    },
    {
        id: 'math-option-disabled-makes-dollar-content-semantic',
        tags: ['context', 'math-disabled', 'parser-options'],
        source: 'Math disabled: $x {++addition++}$ and $$ {--deletion--} $$.\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'deletion'],
            itemRaw: ['{++addition++}', '{--deletion--}'],
            itemContracts: [
                item(0, 18, 32, null, 0, 0, [
                    fragment('only', [0, 'text'], 18, 32, 18, 32),
                ]),
                item(1, 41, 55, null, 0, 1, [
                    fragment('only', [0, 'text'], 41, 55, 41, 55),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: 'Math disabled: $x $ and $$ deletion $$.\n',
            revised: 'Math disabled: $x addition$ and $$  $$.\n',
        },
    },
    {
        id: 'nested-tight-loose-list-blockquote-lazy-and-tab-contexts',
        tags: [
            'context',
            'list',
            'blockquote',
            'lazy-continuation',
            'tab',
            'literal-context',
        ],
        source: '- tight {++tight++}\n  - nested {~~old~>new~~}\n- sibling {==focus==}\n\n- loose first\n\n  > quote {++quoted++}\n  >\n  > lazy continuation {--old quote--}\n\n1. ordered\n   continuation {++lazy++}\n\noutside\n\n\t{--tab literal--}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: {
            kind: 'known',
            output: '- tight {++tight++}\n\n  - nested {~~old~>new~~}\n- sibling {==focus==}\n\n- loose first\n\n  > quote {++quoted++}\n  >\n  > lazy continuation {--old quote--}\n\n1. ordered\n   continuation {++lazy++}\n\noutside\n\n    {--tab literal--}\n',
            reason: 'The serializer canonicalizes the first nested-list paragraph break and tab-indented code while preserving container separation.',
        },
        expected: {
            itemTypes: [
                'addition',
                'substitution',
                'highlight',
                'addition',
                'deletion',
                'addition',
            ],
            itemRaw: [
                '{++tight++}',
                '{~~old~>new~~}',
                '{==focus==}',
                '{++quoted++}',
                '{--old quote--}',
                '{++lazy++}',
            ],
            itemContracts: [
                item(0, 8, 19, null, 0, 0, [
                    fragment(
                        'only',
                        [0, 'children', 0, 'children', 0, 'text'],
                        6,
                        17,
                        8,
                        19,
                    ),
                ]),
                item(1, 32, 46, null, 0, 1, [
                    fragment(
                        'only',
                        [0, 'children', 0, 'children', 1, 'children', 0, 'children', 0, 'text'],
                        7,
                        21,
                        32,
                        46,
                    ),
                ]),
                item(2, 57, 68, null, 0, 2, [
                    fragment(
                        'only',
                        [0, 'children', 1, 'children', 0, 'text'],
                        8,
                        19,
                        57,
                        68,
                    ),
                ]),
                item(3, 95, 107, null, 0, 3, [
                    fragment(
                        'only',
                        [0, 'children', 2, 'children', 1, 'children', 0, 'text'],
                        6,
                        18,
                        95,
                        107,
                    ),
                ]),
                item(4, 134, 149, null, 0, 4, [
                    fragment(
                        'only',
                        [0, 'children', 2, 'children', 1, 'children', 1, 'text'],
                        18,
                        33,
                        134,
                        149,
                    ),
                ]),
                item(5, 178, 188, null, 0, 5, [
                    fragment(
                        'only',
                        [1, 'children', 0, 'children', 0, 'text'],
                        21,
                        31,
                        178,
                        188,
                    ),
                ]),
            ],
            literalRanges: [range(199, 221)],
            plainTextItems: [],
            original: '- tight \n  - nested old\n- sibling focus\n\n- loose first\n\n  > quote \n  >\n  > lazy continuation old quote\n\n1. ordered\n   continuation \n\noutside\n\n\t{--tab literal--}\n',
            revised: '- tight tight\n  - nested new\n- sibling focus\n\n- loose first\n\n  > quote quoted\n  >\n  > lazy continuation \n\n1. ordered\n   continuation lazy\n\noutside\n\n\t{--tab literal--}\n',
        },
    },
    {
        id: 'repeated-table-cells-and-escaped-pipes',
        tags: ['context', 'table', 'repeated-text', 'escaped-pipe'],
        source: '| repeated | repeated | escaped |\n| --- | --- | --- |\n| {++same++} | {++same++} | a\\|b {~~old~>new~~} |\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition', 'substitution'],
            itemRaw: ['{++same++}', '{++same++}', '{~~old~>new~~}'],
            itemContracts: [
                item(0, 56, 66, null, 0, 0, [
                    fragment(
                        'only',
                        [0, 'children', 1, 'children', 0, 'text'],
                        0,
                        10,
                        56,
                        66,
                    ),
                ]),
                item(1, 69, 79, null, 0, 1, [
                    fragment(
                        'only',
                        [0, 'children', 1, 'children', 1, 'text'],
                        0,
                        10,
                        69,
                        79,
                    ),
                ]),
                item(2, 87, 101, null, 0, 2, [
                    fragment(
                        'only',
                        [0, 'children', 1, 'children', 2, 'text'],
                        4,
                        18,
                        87,
                        101,
                    ),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: '| repeated | repeated | escaped |\n| --- | --- | --- |\n|  |  | a\\|b old |\n',
            revised: '| repeated | repeated | escaped |\n| --- | --- | --- |\n| same | same | a\\|b new |\n',
        },
    },
    {
        id: 'footnote-body-nested-list-and-definition-contexts',
        tags: [
            'context',
            'footnote',
            'nested-list',
            'reference-definition',
            'literal-context',
        ],
        source: 'Text[^n] {++outside++}.\n\n[^n]: intro {++inside++}\n\n    - nested {~~old~>new~~}\n    - code `{--literal--}`\n\n    [inner]: https://e.test/{==literal==} "{>>literal<<}"\n\n    tail {==focus==}\n',
        options: {
            footnote: true,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition', 'substitution', 'highlight'],
            itemRaw: [
                '{++outside++}',
                '{++inside++}',
                '{~~old~>new~~}',
                '{==focus==}',
            ],
            itemContracts: [
                item(0, 9, 22, null, 0, 0, [
                    fragment('only', [0, 'text'], 9, 22, 9, 22),
                ]),
                item(1, 37, 49, null, 0, 1, [
                    fragment(
                        'only',
                        [1, 'children', 0, 'text'],
                        6,
                        18,
                        37,
                        49,
                    ),
                ]),
                item(2, 64, 78, null, 0, 2, [
                    fragment(
                        'only',
                        [1, 'children', 1, 'children', 0, 'children', 0, 'text'],
                        7,
                        21,
                        64,
                        78,
                    ),
                ]),
                item(3, 175, 186, null, 0, 3, [
                    fragment(
                        'only',
                        [1, 'children', 3, 'text'],
                        5,
                        16,
                        175,
                        186,
                    ),
                ]),
            ],
            literalRanges: [range(90, 105), range(111, 164)],
            plainTextItems: [],
            original: 'Text[^n] .\n\n[^n]: intro \n\n    - nested old\n    - code `{--literal--}`\n\n    [inner]: https://e.test/{==literal==} "{>>literal<<}"\n\n    tail focus\n',
            revised: 'Text[^n] outside.\n\n[^n]: intro inside\n\n    - nested new\n    - code `{--literal--}`\n\n    [inner]: https://e.test/{==literal==} "{>>literal<<}"\n\n    tail focus\n',
        },
    },
    {
        id: 'no-final-newline-repeated-blanks-astral-and-identical-text',
        tags: [
            'bytes',
            'no-final-newline',
            'repeated-blanks',
            'astral',
            'repeated-text',
        ],
        source: 'same {++same++} same {++same++}\n\n\n😀 {~~same~>same~~}',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition', 'addition', 'substitution'],
            itemRaw: ['{++same++}', '{++same++}', '{~~same~>same~~}'],
            itemContracts: [
                item(0, 5, 15, null, 0, 0, [
                    fragment('only', [0, 'text'], 5, 15, 5, 15),
                ]),
                item(1, 21, 31, null, 0, 1, [
                    fragment('only', [0, 'text'], 21, 31, 21, 31),
                ]),
                item(2, 37, 53, null, 0, 2, [
                    fragment('only', [1, 'text'], 3, 19, 37, 53),
                ]),
            ],
            literalRanges: [],
            plainTextItems: [],
            original: 'same  same \n\n\n😀 same',
            revised: 'same same same same\n\n\n😀 same',
        },
    },
    {
        id: 'hostile-addition-html-and-url',
        tags: ['hostile', 'addition', 'security'],
        source: '{++<img src=x onerror="globalThis.__criticXss=1"><script>globalThis.__criticXss=2</script>[click](javascript:alert(1))++}',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++<img src=x onerror="globalThis.__criticXss=1"><script>globalThis.__criticXss=2</script>[click](javascript:alert(1))++}'],
            itemContracts: [
                item(0, 0, 121, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 121, 0, 121),
                ]),
            ],
            literalRanges: [range(3, 57), range(81, 91), range(96, 118)],
            plainTextItems: [],
            original: '',
            revised: '<img src=x onerror="globalThis.__criticXss=1"><script>globalThis.__criticXss=2</script>[click](javascript:alert(1))',
            mustBeInert: true,
        },
    },
    {
        id: 'hostile-comment-title',
        tags: ['hostile', 'comment', 'security'],
        source: '{>>"><img src=x onerror="globalThis.__criticXss=3"><<}',
        options: {},
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['comment'],
            itemRaw: ['{>>"><img src=x onerror="globalThis.__criticXss=3"><<}'],
            itemContracts: [
                item(0, 0, 54, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 54, 0, 54),
                ]),
            ],
            literalRanges: [range(5, 51)],
            plainTextItems: [],
            original: '',
            revised: '',
            mustBeInert: true,
        },
    },
    {
        id: 'hostile-deletion-html-events-script-and-url',
        tags: ['hostile', 'deletion', 'security'],
        source: '{--<svg onload="globalThis.__criticXss=4"><a href="javascript:alert(4)">old</a><script>globalThis.__criticXss=5</script></svg>--}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['deletion'],
            itemRaw: ['{--<svg onload="globalThis.__criticXss=4"><a href="javascript:alert(4)">old</a><script>globalThis.__criticXss=5</script></svg>--}'],
            itemContracts: [
                item(0, 0, 129, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 129, 0, 129),
                ]),
            ],
            literalRanges: [range(3, 72), range(75, 87), range(111, 126)],
            plainTextItems: [],
            original: '<svg onload="globalThis.__criticXss=4"><a href="javascript:alert(4)">old</a><script>globalThis.__criticXss=5</script></svg>\n',
            revised: '\n',
            mustBeInert: true,
        },
    },
    {
        id: 'hostile-substitution-both-arms',
        tags: ['hostile', 'substitution', 'security'],
        source: '{~~<img src="javascript:alert(5)" onerror="globalThis.__criticXss=6">old~><svg onload="globalThis.__criticXss=7"><a href="data:text/html,evil">new</a></svg>~~}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['substitution'],
            itemRaw: ['{~~<img src="javascript:alert(5)" onerror="globalThis.__criticXss=6">old~><svg onload="globalThis.__criticXss=7"><a href="data:text/html,evil">new</a></svg>~~}'],
            itemContracts: [
                item(0, 0, 159, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 159, 0, 159),
                ]),
            ],
            literalRanges: [range(3, 69), range(74, 143), range(146, 156)],
            plainTextItems: [],
            original: '<img src="javascript:alert(5)" onerror="globalThis.__criticXss=6">old\n',
            revised: '<svg onload="globalThis.__criticXss=7"><a href="data:text/html,evil">new</a></svg>\n',
            mustBeInert: true,
        },
    },
    {
        id: 'hostile-highlight-markdown-image-fields',
        tags: ['hostile', 'highlight', 'image', 'security'],
        source: '{==![alt" onerror="globalThis.__criticXss=8](javascript:alert%288%29 \'title" onload="globalThis.__criticXss=9\')==}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['highlight'],
            itemRaw: ['{==![alt" onerror="globalThis.__criticXss=8](javascript:alert%288%29 \'title" onload="globalThis.__criticXss=9\')==}'],
            itemContracts: [
                item(0, 0, 114, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 114, 0, 114),
                ]),
            ],
            literalRanges: [range(3, 5), range(43, 111)],
            plainTextItems: [],
            original: '![alt" onerror="globalThis.__criticXss=8](javascript:alert%288%29 \'title" onload="globalThis.__criticXss=9\')\n',
            revised: '![alt" onerror="globalThis.__criticXss=8](javascript:alert%288%29 \'title" onload="globalThis.__criticXss=9\')\n',
            mustBeInert: true,
        },
    },
    {
        id: 'hostile-highlight-quote-breaking-attributes',
        tags: ['hostile', 'highlight', 'attribute', 'security'],
        source: '{==<span title="safe&quot; onfocus=&quot;globalThis.__criticXss=10" onmouseover="globalThis.__criticXss=11">focus</span>==}\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['highlight'],
            itemRaw: ['{==<span title="safe&quot; onfocus=&quot;globalThis.__criticXss=10" onmouseover="globalThis.__criticXss=11">focus</span>==}'],
            itemContracts: [
                item(0, 0, 123, null, 0, 0, [
                    fragment('only', [0, 'text'], 0, 123, 0, 123),
                ]),
            ],
            literalRanges: [range(3, 108), range(113, 120)],
            plainTextItems: [],
            original: '<span title="safe&quot; onfocus=&quot;globalThis.__criticXss=10" onmouseover="globalThis.__criticXss=11">focus</span>\n',
            revised: '<span title="safe&quot; onfocus=&quot;globalThis.__criticXss=10" onmouseover="globalThis.__criticXss=11">focus</span>\n',
            mustBeInert: true,
        },
    },
    {
        id: 'hostile-cross-block-addition',
        tags: ['hostile', 'addition', 'block-spanning', 'security'],
        source: 'before {++<img src="javascript:alert(12)" onerror="globalThis.__criticXss=12">\n\n# [jump](vbscript:msgbox(12))\n\npayload++} after\n',
        options: {
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: true,
        },
        normalization: { kind: 'exact' },
        expected: {
            itemTypes: ['addition'],
            itemRaw: ['{++<img src="javascript:alert(12)" onerror="globalThis.__criticXss=12">\n\n# [jump](vbscript:msgbox(12))\n\npayload++}'],
            itemContracts: [
                item(0, 7, 121, null, 0, 0, [
                    fragment('start', [0, 'text'], 7, 78, 7, 78),
                    fragment('middle', [1, 'text'], 0, 29, 80, 109),
                    fragment('end', [2, 'text'], 0, 10, 111, 121),
                ]),
            ],
            literalRanges: [range(10, 78), range(82, 83), range(87, 109)],
            plainTextItems: [],
            original: 'before  after\n',
            revised: 'before <img src="javascript:alert(12)" onerror="globalThis.__criticXss=12">\n\n# [jump](vbscript:msgbox(12))\n\npayload after\n',
            mustBeInert: true,
        },
    },
];

export const FRONT_MATTER_CORPUS = CRITIC_MARKUP_CORPUS.filter(row =>
    row.tags.includes('front-matter'));

export const FRONT_MATTER_LOOKALIKE_CORPUS = CRITIC_MARKUP_CORPUS.filter(row =>
    row.tags.includes('front-matter-lookalike'));

export const FRONT_MATTER_DISABLED_CORPUS = CRITIC_MARKUP_CORPUS.filter(row =>
    row.tags.includes('front-matter-disabled'));

export const IDENTICAL_SUBSTITUTION_ARM_CORPUS = CRITIC_MARKUP_CORPUS.filter(
    row => row.tags.includes('repeated-text')
        && row.tags.includes('link-destination'),
);

export const HOSTILE_CRITIC_MARKUP_CORPUS = CRITIC_MARKUP_CORPUS.filter(row =>
    row.tags.includes('hostile'));

/**
 * Scale fixtures stay generated in their dedicated specs so this data module
 * does not allocate multi-megabyte/deep sources in every consumer suite. This
 * manifest is the explicit bridge from the shared corpus's byte/scale axis to
 * those executable contracts.
 */
export const CRITIC_MARKUP_SCALE_CORPUS_LINKS = [
    {
        id: 'ordinary-no-opener-4096-lines',
        axis: 'long-no-opener',
        sourceShape: '4,096 ordinary Markdown/JSON/link lines',
        coveredBy: 'packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts',
        contract: 'skips Markdown context analysis and preserves the source',
    },
    {
        id: 'malformed-opener-run-16000',
        axis: 'long-malformed',
        sourceShape: '16,000 incomplete addition openers',
        coveredBy: 'packages/muya/src/criticMarkup/__tests__/parser.spec.ts',
        contract: 'one linear scan with exact literal preservation',
    },
    {
        id: 'deep-balanced-additions-12000',
        axis: 'above-budget-depth',
        sourceShape: '12,000 nested balanced additions around one payload',
        coveredBy: 'packages/muya/src/criticMarkup/__tests__/deepNesting.spec.ts',
        contract: 'iterative scan, projection, flatten, and indexed lookup',
    },
    {
        id: 'deep-context-additions-1024',
        axis: 'below-budget-depth',
        sourceShape: '1,024 nested balanced additions around one payload',
        coveredBy: 'packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts',
        contract: 'Markdown-context parse count is independent of depth',
    },
    {
        id: 'native-markdown-nesting-5000',
        axis: 'above-budget-markdown-depth',
        sourceShape: '5,000 nested native blockquotes around one addition',
        coveredBy: 'packages/muya/src/state/__tests__/criticMarkupFinalAdapterScale.spec.ts',
        contract: 'preserves excess Markdown literally and surfaces a parser diagnostic',
    },
    {
        id: 'wide-adjacent-additions-257',
        axis: 'wide-dense-items',
        sourceShape: '257 adjacent mapped additions',
        coveredBy: 'packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts',
        contract: 'one span index serves every item without repeated rescans',
    },
    {
        id: 'exclusion-heavy-prefix-1024',
        axis: 'many-excluded-ranges',
        sourceShape: '1,024 disjoint exclusions before one valid addition',
        coveredBy: 'packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts',
        contract: 'sequential grammar scan uses only the forward cursor',
    },
] as const;
