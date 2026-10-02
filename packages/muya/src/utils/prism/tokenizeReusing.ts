import Prism from 'prismjs';

type Pattern = RegExp | Prism.TokenObject;
type Patterns = Record<string, Prism.GrammarValue>;

/**
 * A grammar split where Prism stops matching across the whole text: `prefix`
 * holds every pattern up to its last greedy one, `tail` the non-greedy
 * patterns after it.
 */
interface ISplitGrammar {
    readonly prefix: Prism.Grammar;
    readonly tail: Prism.Grammar | undefined;
}

const splits = new WeakMap<Prism.Grammar, ISplitGrammar>();

function patternsOf(value: Prism.GrammarValue): readonly Pattern[] {
    return Array.isArray(value) ? value : [value];
}

function isGreedy(pattern: Pattern): boolean {
    return !(pattern instanceof RegExp) && pattern.greedy === true;
}

/** `grammar`'s patterns in the order `Prism.tokenize` reads them, its `rest` among them. */
function resolvedEntries(grammar: Prism.Grammar): [string, Prism.GrammarValue][] {
    const own = grammar as Record<string, unknown>;
    const resolved: Patterns = {};
    for (const token in own) {
        // eslint-disable-next-line e18e/prefer-object-has-own -- the library target predates Object.hasOwn
        if (token !== 'rest' && Object.prototype.hasOwnProperty.call(own, token))
            resolved[token] = own[token] as Prism.GrammarValue;
    }
    const rest = own.rest as Record<string, unknown> | undefined;
    for (const token in rest ?? {})
        resolved[token] = rest![token] as Prism.GrammarValue;
    return Object.entries(resolved);
}

function splitGrammar(grammar: Prism.Grammar): ISplitGrammar {
    let split = splits.get(grammar);
    if (split !== undefined)
        return split;
    const entries = resolvedEntries(grammar);
    let lastToken = -1;
    let lastPattern = -1;
    entries.forEach(([, value], token) => {
        if (!value)
            return;
        patternsOf(value).forEach((pattern, index) => {
            if (isGreedy(pattern)) {
                lastToken = token;
                lastPattern = index;
            }
        });
    });
    const prefix: Patterns = {};
    const tail: Patterns = {};
    entries.forEach(([token, value], index) => {
        if (index < lastToken) {
            prefix[token] = value;
        }
        else if (index > lastToken) {
            tail[token] = value;
        }
        else {
            const patterns = patternsOf(value);
            prefix[token] = Array.isArray(value) ? patterns.slice(0, lastPattern + 1) : value;
            if (patterns.length > lastPattern + 1)
                tail[token] = patterns.slice(lastPattern + 1);
        }
    });
    split = { prefix, tail: Object.keys(tail).length === 0 ? undefined : tail };
    splits.set(grammar, split);
    return split;
}

/** The tokens of each run of text the greedy patterns left, from one tokenize to the next. */
export type TokenizedFragments = Map<string, readonly (string | Prism.Token)[]>;

/**
 * `Prism.tokenize(text, grammar)`, reading again only the runs of text that
 * changed since `previous` was made.
 *
 * Prism applies a grammar's patterns in order to the text's untokenized
 * runs. A greedy pattern matches across the whole text, but a non-greedy one
 * matches within each run on its own, from that run's text alone, and puts
 * its tokens in the run's place. So once the last greedy pattern has run,
 * every later pattern makes of a run what it makes of that run's text
 * tokenized alone: the tokens of a run unchanged since the last tokenize are
 * the ones it had then.
 *
 * Runs share their tokens with earlier results, so a hook that rewrites
 * tokens after tokenizing makes every run read again.
 */
export function tokenizeReusing(
    text: string,
    grammar: Prism.Grammar,
    previous: TokenizedFragments | undefined,
): { tokens: (string | Prism.Token)[]; fragments: TokenizedFragments } {
    const { prefix, tail } = splitGrammar(grammar);
    const rewritten = (Prism.hooks.all['after-tokenize']?.length ?? 0) > 0;
    if (tail === undefined || rewritten)
        return { tokens: Prism.tokenize(text, grammar), fragments: new Map() };
    const fragments: TokenizedFragments = new Map();
    const tokens: (string | Prism.Token)[] = [];
    for (const token of Prism.tokenize(text, prefix)) {
        if (typeof token !== 'string') {
            tokens.push(token);
            continue;
        }
        const read = fragments.get(token) ?? previous?.get(token) ?? Prism.tokenize(token, tail);
        fragments.set(token, read);
        tokens.push(...read);
    }
    return { tokens, fragments };
}
