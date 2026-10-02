// @vitest-environment happy-dom
import type Prism from 'prismjs';
import type { TokenizedFragments } from '../tokenizeReusing';
import { beforeAll, describe, expect, it } from 'vitest';
import prism, { loadLanguage } from '../index';
import { tokenizeReusing } from '../tokenizeReusing';

// A key's tokenize reads again only the runs of text it changed, and its
// tokens are the ones Prism makes of the whole text, after every key.

type Stream = Prism.TokenStream;

/** A token stream as plain data, so streams compare by what they hold. */
function plain(stream: Stream): unknown {
    if (typeof stream === 'string')
        return stream;
    if (Array.isArray(stream))
        return stream.map(plain);
    return { type: stream.type, alias: stream.alias, length: stream.length, content: plain(stream.content) };
}

const samples: Record<string, string> = {
    // eslint-disable-next-line no-template-curly-in-string -- a template literal for the grammar to read
    javascript: 'const value = compute(1) // note\nlet text = `a ${b} c` + "d" + /re+/g;\nfunction f(x) { return x => x * 2 }\n/* block\ncomment */ class A extends B {}',
    markup: '<div class="a" id=\'b\'>text &amp; more<!-- note --><script>let x = 1</script><style>a { color: red }</style></div>',
    css: '@media screen { a:hover { color: #fff; background: url(x.png) } } /* c */ .b::after { content: "x" }',
    python: 'def f(x):\n    """doc"""\n    return x + 1  # note\nclass A(B):\n    s = f\'{x}\' + r"raw"\n',
    rust: 'fn main() {\n    let s = "text"; // note\n    println!("{}", s);\n    /* block */ let r = r#"raw"#;\n}',
    latex: '\\section{A} $x^2$ % comment\n\\begin{equation} a = b \\end{equation}',
};

const pieces = ['x', ' ', '\n', '"', '\'', '`', '/*', '*/', '//', '#', '{', '}', '(', ')', ';', '\\', '<', '>', '&', '$', '%', '=', 'class ', 'r"'];

describe('tokenizeReusing', () => {
    beforeAll(async () => {
        for (const lang of ['python', 'rust', 'latex'])
            await loadLanguage(lang);
    });

    it.each(Object.keys(samples))('tokenizes %s as Prism does after each of many keys', (lang) => {
        const grammar = prism.languages[lang]!;
        let seed = lang.length * 7919;
        const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const base = Array.from<string>({ length: 12 }).fill(samples[lang]!).join('\n');
        let text = base;
        let fragments: TokenizedFragments | undefined;
        let reused = 0;
        for (let key = 0; key < 300; key += 1) {
            const at = Math.floor(random() * (text.length + 1));
            text = random() < 0.7
                ? text.slice(0, at) + pieces[Math.floor(random() * pieces.length)] + text.slice(at)
                : text.slice(0, at) + text.slice(at + 1 + Math.floor(random() * 3));
            if (text.length === 0)
                text = base;
            const before = fragments;
            const read = tokenizeReusing(text, grammar, fragments);
            expect(plain(read.tokens), JSON.stringify(text)).toEqual(plain(prism.tokenize(text, grammar)));
            if (before !== undefined && [...read.fragments.values()].some(tokens => [...before.values()].includes(tokens)))
                reused += 1;
            fragments = read.fragments;
        }
        // A grammar with no greedy pattern leaves the whole text one run.
        if (lang === 'latex')
            expect(fragments!.size).toBe(1);
        else
            expect(reused).toBeGreaterThan(200);
    });
});
