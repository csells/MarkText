import type Prism from 'prismjs';

/**
 * Prism patterns, by `flags/source`, with text every match needs: a pattern
 * searching a run without that text matches nothing in it, so the search is
 * skipped. Each test reads a part of the pattern that every match must
 * satisfy inside the searched text, lookaheads included.
 */
const REQUIRED_TEXT: ReadonlyMap<string, (text: string) => boolean> = new Map([
    // JavaScript `function-variable`: the lookahead's last group is either
    // `\bfunction\b` or a parameter list or name followed by `\s*=>`.
    ['/#?(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*[=:]\\s*(?:async\\s*)?(?:\\bfunction\\b|(?:\\((?:[^()]|\\([^()]*\\))*\\)|(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*)\\s*=>))', (text: string) => text.includes('=>') || text.includes('function')],
    // JavaScript `parameter`, first form: its captured prefix starts `function`.
    ['/(function(?:\\s+(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*)?\\s*\\(\\s*)(?!\\s)(?:[^()\\s]|\\s+(?![\\s)])|\\([^()]*\\))+(?=\\s*\\))', (text: string) => text.includes('function')],
    // JavaScript `parameter`, second form: it ends with the lookahead `(?=\s*=>)`.
    ['i/(^|[^$\\w\\xA0-\\uFFFF])(?!\\s)[_$a-z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*=>)', (text: string) => text.includes('=>')],
    // JavaScript `parameter`, third form: it ends with the lookahead `(?=\s*\)\s*=>)`.
    ['/(\\(\\s*)(?!\\s)(?:[^()\\s]|\\s+(?![\\s)])|\\([^()]*\\))+(?=\\s*\\)\\s*=>)', (text: string) => text.includes('=>')],
    // JavaScript `parameter`, fourth form: both alternatives of its prefix
    // end `\(\s*`, and it ends with the lookahead `(?=\s*\)\s*\{)`.
    ['/((?:\\b|\\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\\w\\xA0-\\uFFFF]))(?:(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*\\s*)\\(\\s*|\\]\\s*\\(\\s*)(?!\\s)(?:[^()\\s]|\\s+(?![\\s)])|\\([^()]*\\))+(?=\\s*\\)\\s*\\{)', (text: string) => text.includes('(') && text.includes('{')],
    // JavaScript `function`: its lookahead ends with `\(`.
    ['/#?(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*(?:\\.\\s*(?:apply|bind|call)\\s*)?\\()', (text: string) => text.includes('(')],
    // JavaScript `class-name`, first form: its captured prefix is one of
    // these words.
    ['/(\\b(?:class|extends|implements|instanceof|interface|new)\\s+)[\\w.\\\\]+', (text: string) => ['class', 'extends', 'implements', 'instanceof', 'interface', 'new'].some(word => text.includes(word))],
    // JavaScript `class-name`, second form: its lookahead is
    // `\.(?:constructor|prototype)`.
    ['/(^|[^$\\w\\xA0-\\uFFFF])(?!\\s)[_$A-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\.(?:constructor|prototype))', (text: string) => text.includes('.constructor') || text.includes('.prototype')],
    // JavaScript `literal-property`: its lookahead is `(?=\s*:)`.
    ['m/((?:^|[,{])[ \\t]*)(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*:)', (text: string) => text.includes(':')],
]);

/** The patterns `REQUIRED_TEXT` holds, as `flags/source`, for a test to find in Prism. */
export const PREFILTERED_PATTERNS: readonly string[] = [...REQUIRED_TEXT.keys()];

/** A pattern that searches only text holding what each of its matches needs. */
class PrefilteredRegExp extends RegExp {
    constructor(pattern: RegExp, private readonly _mayMatch: (text: string) => boolean) {
        super(pattern.source, pattern.flags);
    }

    override exec(text: string): RegExpExecArray | null {
        // Prism searches these, neither global nor sticky, from the start.
        return this._mayMatch(text) ? super.exec(text) : null;
    }
}

type Pattern = RegExp | Prism.TokenObject;

function prefiltered(pattern: RegExp): RegExp {
    const mayMatch = pattern.global || pattern.sticky ? undefined : REQUIRED_TEXT.get(`${pattern.flags}/${pattern.source}`);
    return mayMatch === undefined ? pattern : new PrefilteredRegExp(pattern, mayMatch);
}

function prefilteredPattern(pattern: Pattern): Pattern {
    if (pattern instanceof RegExp)
        return prefiltered(pattern);
    const regExp = prefiltered(pattern.pattern);
    return regExp === pattern.pattern || pattern.greedy === true ? pattern : { ...pattern, pattern: regExp };
}

const derived = new WeakMap<Prism.Grammar, Prism.Grammar>();

/**
 * `grammar` with each pattern `REQUIRED_TEXT` knows skipping runs that
 * lack what its matches need. It tokenizes every text as `grammar` does;
 * patterns inside tokens read with `grammar`'s own.
 */
export function prefilteredGrammar(grammar: Prism.Grammar): Prism.Grammar {
    let result = derived.get(grammar);
    if (result === undefined) {
        const own = grammar as Record<string, unknown>;
        const copy: Record<string, unknown> = {};
        for (const token in own) {
            // eslint-disable-next-line e18e/prefer-object-has-own -- the library target predates Object.hasOwn
            if (!Object.prototype.hasOwnProperty.call(own, token))
                continue;
            const value = own[token];
            copy[token] = token === 'rest' || !value
                ? value
                : Array.isArray(value)
                    ? (value as Pattern[]).map(prefilteredPattern)
                    : prefilteredPattern(value as Pattern);
        }
        result = copy as Prism.Grammar;
        derived.set(grammar, result);
    }
    return result;
}
