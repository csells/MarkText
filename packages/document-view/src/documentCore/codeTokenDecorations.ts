import Prism from 'prismjs';
// Grammars beyond Prism's core bundle, imported statically so a fence never
// waits on an async load to be highlighted. Order matters: dependents come
// after the grammars they extend.
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-less';
import 'prismjs/components/prism-markdown';

/**
 * Presentation-only syntax highlighting for fenced code blocks.
 *
 * Tokens paint as attribute-free `span.token.<type>` elements wrapped around
 * the rendered text, exactly like search decorations: no model attributes and
 * identical textContent, so the input adapter's offset math and the text
 * patcher treat them as transparent inline carriers. The themes already ship
 * the Prism palettes that colour these classes.
 *
 * `Prism.tokenize` is used deliberately — never `highlightElement`, which
 * rewrites innerHTML and would destroy the parser-issued run carriers and
 * their model boundary maps.
 */

const TOKEN_SELECTOR = 'span.token';

/** Languages resolved eagerly; anything else renders unhighlighted. */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    'c++': 'cpp',
    'h++': 'cpp',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    kt: 'kotlin',
    md: 'markdown',
    html: 'markup',
    xml: 'markup',
    svg: 'markup',
    vue: 'markup',
});

interface TokenSlice {
    readonly start: number;
    readonly end: number;
    readonly type: string;
}

function grammarFor(language: string): Prism.Grammar | undefined {
    const name = ALIASES[language] ?? language;
    return Prism.languages[name] as Prism.Grammar | undefined;
}

/** Flatten Prism's nested token stream to offset slices over the code text. */
function tokenSlices(
    tokens: (string | Prism.Token)[],
    offset = 0,
    inherited?: string,
): TokenSlice[] {
    const slices: TokenSlice[] = [];
    let cursor = offset;
    for (const token of tokens) {
        if (typeof token === 'string') {
            cursor += token.length;
            continue;
        }
        const type = token.type;
        const content = token.content;
        if (typeof content === 'string') {
            slices.push({ start: cursor, end: cursor + content.length, type });
            cursor += content.length;
            continue;
        }
        const children = Array.isArray(content) ? content : [content];
        const nested = tokenSlices(children, cursor, type);
        // A nested run still belongs to its parent class where no child claims
        // it, so the parent's own span is emitted first and children layer over
        // it in document order.
        const length = children.reduce(
            (total, child) => total + (
                typeof child === 'string' ? child.length : child.length
            ),
            0,
        );
        slices.push({ start: cursor, end: cursor + length, type });
        slices.push(...nested);
        cursor += length;
    }
    if (inherited !== undefined && slices.length === 0)
        return [];

    return slices;
}

export function clearCodeTokenDecorations(host: HTMLElement): void {
    const parents = new Set<Node>();
    for (const span of host.querySelectorAll(TOKEN_SELECTOR)) {
        const parent = span.parentNode;
        if (!parent)
            continue;
        while (span.firstChild)
            parent.insertBefore(span.firstChild, span);
        span.remove();
        parents.add(parent);
    }
    for (const parent of parents)
        parent.normalize();
}

function paintCodeElement(code: HTMLElement): void {
    const language = code.dataset.language ?? '';
    if (language.length === 0)
        return;
    const grammar = grammarFor(language);
    if (grammar === undefined)
        return;

    const text = code.textContent ?? '';
    if (text.length === 0)
        return;

    const slices = tokenSlices(Prism.tokenize(text, grammar));
    if (slices.length === 0)
        return;

    // Apply last-to-first so splitting a text node cannot invalidate an
    // earlier slice's offsets.
    for (const slice of [...slices].reverse()) {
        const walker = code.ownerDocument.createTreeWalker(
            code,
            NodeFilter.SHOW_TEXT,
        );
        let consumed = 0;
        let node = walker.nextNode();
        while (node !== null) {
            const textNode = node as Text;
            const length = textNode.data.length;
            const localStart = slice.start - consumed;
            const localEnd = slice.end - consumed;
            if (localStart >= 0 && localEnd <= length && localEnd > localStart) {
                const middle = localStart === 0
                    ? textNode
                    : textNode.splitText(localStart);
                if (localEnd - localStart < middle.data.length)
                    middle.splitText(localEnd - localStart);
                const span = code.ownerDocument.createElement('span');
                span.className = `token ${slice.type}`;
                middle.parentNode?.replaceChild(span, middle);
                span.appendChild(middle);
                break;
            }
            consumed += length;
            node = walker.nextNode();
        }
    }
}

export function paintCodeTokenDecorations(host: HTMLElement): void {
    clearCodeTokenDecorations(host);
    for (const code of host.querySelectorAll<HTMLElement>(
        'pre.document-view-code-block > code[data-language]',
    )) {
        paintCodeElement(code);
    }
}
