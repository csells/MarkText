import type { Muya } from '../../../muya';
import type { IRenderCursor } from '../../../selection/types';
import type {
    CodeContentState,
    ICodeBlockState,
    IDiagramState,
    IFrontmatterState,
} from '../../../state/types';
import type { TokenizedFragments } from '../../../utils/prism/tokenizeReusing';
import type Code from '../../commonMark/codeBlock/code';
import type HTMLPreview from '../../commonMark/html/htmlPreview';
import { CLASS_NAMES, HTML_TAGS, VOID_HTML_TAGS } from '../../../config';
import { adjustOffset, escapeHTML, firstGraphemeLength, firstWordOfInfo, lastGraphemeLength, lineBounds } from '../../../utils';
import { codeEnter, codeTabExpansion } from '@marktext/input-policy';
import { CLASS_NAMES, EVENT_KEYS } from '../../../config';
import { dispatchDocumentBlock, dispatchDocumentTab } from '../../../editor/documentEditing';
import { adjustOffset, escapeHTML, firstGraphemeLength, firstWordOfInfo, isKeyboardEvent, lastGraphemeLength } from '../../../utils';
import { computeLineCount, repositionLineNumberSpans, syncLineNumbersSpans } from '../../../utils/codeBlockLineNumbers';
import { getHighlightHtml, MARKER_HASH } from '../../../utils/highlightHTML';
import prism, { loadedLanguages, transformAliasToOrigin, walkTokens } from '../../../utils/prism/index';
import { tokenizeReusing } from '../../../utils/prism/tokenizeReusing';
import Content from '../../base/content';
import { ScrollPage } from '../../scrollPage';

/**
 * Write `html` only when it differs from what the node already holds.
 *
 * Assigning `innerHTML` always destroys and recreates the child nodes, even for
 * a byte-identical string — so every keystroke in a code block tore down the
 * text node the caret was sitting in and built a new one, taking the native
 * selection and any IME composition anchored to it along. `Format.inputHandler`
 * has the same guard via `checkNeedRender`, which is why paragraphs never paid
 * this cost.
 */
function replaceIfChanged(domNode: HTMLElement, html: string) {
    if (domNode.innerHTML !== html)
        domNode.innerHTML = html;
}

/**
 * Make `domNode`'s children those of `drawn`, moving over only the nodes
 * between the unchanged ones at either end. A key in a long block changes a
 * token or two, so the rest of its nodes, and their layout, stay.
 */
function patchChildren(domNode: HTMLElement, drawn: HTMLElement) {
    const previous = domNode.childNodes;
    const next = drawn.childNodes;
    let start = 0;
    while (start < previous.length && start < next.length && previous[start].isEqualNode(next[start]))
        start += 1;
    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start && previous[previousEnd - 1].isEqualNode(next[nextEnd - 1])) {
        previousEnd -= 1;
        nextEnd -= 1;
    }
    if (start === previousEnd && start === nextEnd)
        return;
    const before = previous[previousEnd] ?? null;
    for (let index = previousEnd - 1; index >= start; index -= 1)
        previous[index].remove();
    const inserted = document.createDocumentFragment();
    for (let index = start; index < nextEnd; index += 1)
        inserted.appendChild(next[start]);
    domNode.insertBefore(inserted, before);
}

/**
 * A DOM child a highlight draws: a token's element, or the source text of a
 * run of untokenized strings between them.
 */
type HighlightSlot = string | Prism.Token;

/** The children a highlight draws, with the source text length each holds. */
interface IHighlightSlots {
    readonly slots: readonly HighlightSlot[];
    readonly lengths: readonly number[];
    readonly language: string;
    /** The tokens of the text's runs, which the next key's tokenize reuses. */
    readonly fragments: TokenizedFragments;
}

/**
 * The children Prism's highlight of `text` draws, as `highlightElement`
 * draws them with no markup to keep: the same hooks and tokens.
 */
function highlightSlots(text: string, lang: string, previous?: TokenizedFragments): IHighlightSlots {
    const env: { code: string; grammar: Prism.Grammar; language: string; tokens?: Array<string | Prism.Token> } = {
        code: text,
        grammar: prism.languages[lang]!,
        language: lang,
    };
    prism.hooks.run('before-tokenize', env);
    const { tokens, fragments } = tokenizeReusing(env.code, env.grammar, previous);
    env.tokens = tokens;
    prism.hooks.run('after-tokenize', env);
    const slots: HighlightSlot[] = [];
    const lengths: number[] = [];
    let run: string | null = null;
    for (const token of env.tokens) {
        if (typeof token === 'string') {
            if (token.length > 0)
                run = run === null ? token : run + token;
            continue;
        }
        if (run !== null) {
            slots.push(run);
            lengths.push(run.length);
            run = null;
        }
        slots.push(token);
        lengths.push(token.length);
    }
    if (run !== null) {
        slots.push(run);
        lengths.push(run.length);
    }
    return { slots, lengths, language: env.language, fragments };
}

type TokenContent = Prism.TokenStream | Prism.Token;

/** Whether two tokens' streams draw the same HTML: what `Token.stringify` reads is equal. */
function sameContent(left: TokenContent, right: TokenContent): boolean {
    if (left === right)
        return true;
    if (typeof left === 'string' || typeof right === 'string')
        return left === right;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
            return false;
        return left.every((entry, index) => sameContent(entry, right[index]!));
    }
    const leftAlias = left.alias ?? [];
    const rightAlias = right.alias ?? [];
    return left.type === right.type
        && (typeof leftAlias === 'string' || typeof rightAlias === 'string'
            ? leftAlias === rightAlias
            : leftAlias.length === rightAlias.length && leftAlias.every((alias, index) => alias === rightAlias[index]))
        && sameContent(left.content, right.content);
}

/** The HTML `highlightElement` draws for `slot`. */
function slotHtml(slot: HighlightSlot, language: string): string {
    return typeof slot === 'string'
        ? prism.util.encode(slot) as string
        : prism.Token.stringify(prism.util.encode(slot) as Prism.Token, language);
}

/** The slots at either end that two drawings share, as `[start, previousEnd, nextEnd)`. */
function sharedEnds(before: readonly HighlightSlot[], next: readonly HighlightSlot[]): [number, number, number] {
    let start = 0;
    while (start < before.length && start < next.length && sameContent(before[start]!, next[start]!))
        start += 1;
    let previousEnd = before.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start && sameContent(before[previousEnd - 1]!, next[nextEnd - 1]!)) {
        previousEnd -= 1;
        nextEnd -= 1;
    }
    return [start, previousEnd, nextEnd];
}

/**
 * Where `text` differs from `previous`, in `previous`, as far as a run of
 * the same characters lets the change sit, and a character either side:
 * native input wrote the change somewhere there.
 */
function changedText(previous: string, text: string): [number, number] {
    let prefix = 0;
    while (prefix < previous.length && prefix < text.length && previous[prefix] === text[prefix])
        prefix += 1;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < text.length - prefix
        && previous[previous.length - 1 - suffix] === text[text.length - 1 - suffix]) {
        suffix += 1;
    }
    return [
        Math.max(0, Math.min(prefix, previous.length - suffix) - 1),
        Math.min(previous.length, Math.max(prefix, previous.length - suffix) + 1),
    ];
}

/** Whether `children` from `start` are the nodes `drawn`, one for one. */
function sameNodes(children: NodeListOf<ChildNode>, start: number, end: number, drawn: NodeListOf<ChildNode>): boolean {
    if (end - start !== drawn.length)
        return false;
    for (let index = 0; index < drawn.length; index += 1) {
        if (!children[start + index]!.isEqualNode(drawn[index]!))
            return false;
    }
    return true;
}

const LANG_HASH = {
    'html-block': 'html',
    'math-block': 'latex',
};

function hasStateMeta(
    state: CodeContentState,
): state is ICodeBlockState | IDiagramState | IFrontmatterState {
    return /code-block|diagram|frontmatter/.test(state.name);
}

class CodeBlockContent extends Content {
    private _initialLang: string;
    public override parent: Code | null = null;

    static override blockName = 'codeblock.content';

    static create(muya: Muya, state: CodeContentState) {
        const content = new CodeBlockContent(muya, state);

        return content;
    }

    // The language word for highlighting / tokenizing — the first word of the
    // code container's info string (which may carry attributes, e.g.
    // `js title="x"`). Every consumer of `_lang` wants the language, never the
    // full info string (that is read from `meta.lang` directly by the language
    // input), so derive it once here.
    private get _lang() {
        const { _codeContainer: codeContainer } = this;

        return firstWordOfInfo(codeContainer ? codeContainer.lang : this._initialLang);
    }

    /**
     * Always be the `pre` element
     */
    private get _codeContainer() {
        return this.parent?.parent;
    }

    get outContainer() {
        const { _codeContainer: codeContainer } = this;

        return /code-block|frontmatter/.test(codeContainer!.blockName)
            ? codeContainer
            : codeContainer!.parent;
    }

    // The text the preview was last rendered from. Seeded with the initial
    // text so the create-pass update() does not re-trigger a render that races
    // the preview's own one-shot render on append (async for diagrams).
    private _lastPreviewText: string;

    constructor(muya: Muya, state: CodeContentState) {
        super(muya, state.text);
        this._lastPreviewText = state.text;
        if (hasStateMeta(state))
            this._initialLang = state.meta.lang;
        else
            this._initialLang = LANG_HASH[state.name];

        this.classList = [...this.classList, 'mu-codeblock-content'];
        // Used for empty status prompts
        this.attributes.frontMatter = muya.i18n.t('Input Front Matter...');
        this.attributes.math = muya.i18n.t('Input Mathematical Formula...');
        this.createDomNode();
    }

    override getAnchor() {
        return this.outContainer;
    }

    // Some block has a preview container, like math, diagram, html, should update the preview if the text changed.
    private _updatePreviewIfHave(text: string) {
        // update() runs during the initial create pass before this block is
        // attached, when outContainer cannot resolve its parent chain.
        if (!this._codeContainer)
            return;
        // Only re-render when the text actually changed. update() is called on
        // every render pass; without this guard a diagram's create-pass render
        // and update()'s render race (DiagramPreview.update is async), leaving
        // the SVG unmounted.
        if (text === this._lastPreviewText)
            return;
        this._lastPreviewText = text;
        if (this.outContainer?.attachments?.length)
            (this.outContainer?.attachments?.head as HTMLPreview).update(text);
    }

    /**
     * What the DOM was last drawn from, when drawn without search highlights.
     * Drawing a long block again from the same text redraws nothing.
     */
    private _drawn: { text: string; grammar: string | undefined } | null = null;

    /**
     * The children the last highlight drew from `_drawn`, and whether a
     * trailing break followed them, for redrawing only those a key changes.
     * A whole drawing leaves `slots` to the first key, so that a block no
     * key reaches is tokenized once.
     */
    private _drawnSlots: { slots: IHighlightSlots | null; trailing: boolean } | null = null;

    /**
     * Redraw a highlighted block whose last drawing `_drawnSlots` holds,
     * replacing only the children the change from `previous` to `text` can
     * reach: those whose highlight differs, and those around the changed
     * text, where native input may already have written it. Returns whether
     * a child changed, or undefined, drawing nothing, when the DOM no longer
     * holds that drawing.
     */
    private _patchHighlight(previous: string, text: string, lang: string, trailing: boolean): boolean | undefined {
        const drawn = this._drawnSlots;
        const domNode = this.domNode!;
        if (drawn === null)
            return undefined;
        const before = drawn.slots ?? highlightSlots(previous, lang);
        if (domNode.childNodes.length !== before.slots.length + (drawn.trailing ? 1 : 0))
            return undefined;
        const next = highlightSlots(text, lang, before.fragments);
        let [start, previousEnd] = sharedEnds(before.slots, next.slots);
        const [changedStart, changedEnd] = changedText(previous, text);
        let offset = 0;
        for (let slot = 0; slot < before.slots.length && offset <= changedEnd; slot += 1) {
            const end = offset + before.lengths[slot]!;
            if (end >= changedStart) {
                start = Math.min(start, slot);
                previousEnd = Math.max(previousEnd, slot + 1);
            }
            offset = end;
        }
        const nextEnd = next.slots.length - (before.slots.length - previousEnd);
        if (nextEnd < start)
            return undefined;
        const template = document.createElement('template');
        template.innerHTML = next.slots.slice(start, nextEnd).map(slot => slotHtml(slot, next.language)).join('');
        if (template.content.childNodes.length !== nextEnd - start)
            return undefined;
        const children = domNode.childNodes;
        const same = sameNodes(children, start, previousEnd, template.content.childNodes);
        if (!same) {
            const after = children[previousEnd] ?? null;
            for (let index = previousEnd - 1; index >= start; index -= 1)
                children[index]!.remove();
            domNode.insertBefore(template.content, after);
        }
        if (trailing !== drawn.trailing) {
            if (trailing)
                domNode.insertAdjacentHTML('beforeend', `<span class="${CLASS_NAMES.MU_TRAILING_BREAK}"><br></span>`);
            else
                domNode.lastChild?.remove();
        }
        this._drawnSlots = { slots: next, trailing };
        // Children elsewhere hold what was drawn there, unless something but
        // the change wrote into them; the whole drawing then reads again.
        if (domNode.textContent !== text) {
            this._drawnSlots = null;
            return undefined;
        }
        return !same || trailing !== drawn.trailing;
    }

    override update(_cursor?: IRenderCursor, highlights = []) {
        const { _lang: lang, text } = this;
        // transform alias to original language
        const fullLengthLang = transformAliasToOrigin([lang])[0];
        const grammar = fullLengthLang && loadedLanguages.has(fullLengthLang) ? fullLengthLang : undefined;
        const domNode = this.domNode!;
        // Native composition can change the DOM's text without changing ours.
        if (highlights.length === 0 && this._drawn?.text === text && this._drawn.grammar === grammar
            && domNode.textContent === text) {
            this._updateLineNumbers(text);
            this._updatePreviewIfHave(text);
            return;
        }
        // Language loading and gutter initialization can refresh this DOM after
        // the host restored a caret, or while a cross-block selection is active.
        const selection = this.presentingState ? null : this.selection.getSelection();
        const code = escapeHTML(getHighlightHtml(text, highlights, true))
            .replace(new RegExp(MARKER_HASH['<'], 'g'), '<')
            .replace(new RegExp(MARKER_HASH['>'], 'g'), '>')
            .replace(new RegExp(MARKER_HASH['"'], 'g'), '"')
            .replace(new RegExp(MARKER_HASH['\''], 'g'), '\'');

        // A final newline lays out no line of its own, so the caret after it has
        // nowhere to sit (#5114). Appended after highlighting: Prism's
        // keep-markup drops empty elements. Wrapped: Chromium puts the caret
        // just before the <br>, and (content, childIndex) would read back as
        // text offset childIndex where (wrapper, 0) reads back as the text
        // length.
        const trailingBreak = text.endsWith('\n')
            ? `<span class="${CLASS_NAMES.MU_TRAILING_BREAK}"><br></span>`
            : '';

        const drawn = this._draw(text, grammar, code, trailingBreak, highlights.length === 0);
        if (drawn && selection && (selection.anchor.block === this || selection.focus.block === this)) {
            const endpoint = (point: typeof selection.anchor) => point.block === this
                ? { ...point, offset: Math.min(point.offset, text.length) }
                : point;
            this.selection.setSelection(endpoint(selection.anchor), endpoint(selection.focus));
        }

        this._drawn = highlights.length === 0 ? { text, grammar } : null;
        this._updateLineNumbers(text);
        // Re-render the math/diagram/html preview too; undo/redo reaches this
        // block only through update(), not inputHandler (#1632).
        this._updatePreviewIfHave(text);
    }

    /**
     * Draw `text`, highlighted when `grammar` is loaded, from its escaped
     * `code`; `plain` is a drawing without search highlights, which a key's
     * change redraws in place. Returns whether any child changed, which
     * moves a selection inside them.
     */
    private _draw(text: string, grammar: string | undefined, code: string, trailingBreak: string, plain: boolean): boolean {
        const domNode = this.domNode!;
        const previous = this._drawn?.grammar === grammar ? this._drawn?.text : undefined;
        if (grammar && /\S/.test(code) && plain && previous !== undefined) {
            const patched = this._patchHighlight(previous, text, grammar, trailingBreak !== '');
            if (patched !== undefined)
                return patched;
        }
        if (grammar && /\S/.test(code)) {
            const wrapper = document.createElement('div');
            wrapper.classList.add(`language-${grammar}`);
            wrapper.innerHTML = code;
            prism.highlightElement(wrapper, false, function (this: HTMLElement) {
                if (trailingBreak)
                    this.insertAdjacentHTML('beforeend', trailingBreak);
                patchChildren(domNode, this);
            });
            this._drawnSlots = plain ? { slots: null, trailing: trailingBreak !== '' } : null;
            return true;
        }
        this._drawnSlots = null;
        replaceIfChanged(domNode, code + trailingBreak);
        return true;
    }

    private _lastLineCount = -1;
    private _lineNumberResizeObserver: ResizeObserver | null = null;

    private _updateLineNumbers(text: string) {
        if (!this.muya.options.codeBlockLineNumbers)
            return;
        const wrapper = this.parent?.lineNumbersWrapper;
        if (wrapper == null)
            return;
        const count = computeLineCount(text);
        if (count !== this._lastLineCount) {
            syncLineNumbersSpans(wrapper, count);
            this._lastLineCount = count;
        }
        this._observeLineNumberResize(wrapper);
    }

    // Re-measure the gutter after any code-block reflow (initial render, font /
    // wrap change, content edit, viewport resize). Fires post-layout, so it
    // can't read stale positions; owns all repositioning.
    private _observeLineNumberResize(wrapper: HTMLElement) {
        if (this._lineNumberResizeObserver != null || typeof ResizeObserver === 'undefined')
            return;
        const codeEl = this.domNode!;
        this._lineNumberResizeObserver = new ResizeObserver(() => {
            if (codeEl.isConnected && wrapper.isConnected)
                repositionLineNumberSpans(wrapper, codeEl);
            else
                this._lineNumberResizeObserver?.disconnect();
        });
        this._lineNumberResizeObserver.observe(codeEl);
    }

    override inputHandler(event: Event): void {
        if (this.isComposed)
            return;

        const textContent = this.domNode!.textContent!;
        const { start, end } = this.getCursor()!;
        const { text } = this.autoPair(
            event,
            textContent,
            start,
            end,
            false,
            false,
            'codeblock.content',
        );
        this.text = text;

        this._updatePreviewIfHave(text);

        this.setCursor(start!.offset, end!.offset, true);
    }

    override enterHandler(event: KeyboardEvent): void {
        event.preventDefault();

        // Shift + Enter to jump out of code block.
        if (event.shiftKey) {
            let cursorBlock;
            const nextContentBlock = this.nextContentInContext();
            if (nextContentBlock) {
                cursorBlock = nextContentBlock;
            }
            else {
                const newNodeState = {
                    name: 'paragraph',
                    text: '',
                };
                const newNode = ScrollPage.loadBlock(newNodeState.name).create(
                    this.muya,
                    newNodeState,
                );
                this.scrollPage?.append(newNode, 'user');
                cursorBlock = newNode.firstChild;
            }
            const offset = adjustOffset(0, cursorBlock, event);
            cursorBlock.setCursor(offset, offset, true);

            return;
        }

        const { tabSize } = this.muya.options;
        const { start } = this.getCursor()!;
        const { text } = this;
        const plan = codeEnter(text, start.offset, tabSize);
        this.text = text.substring(0, start.offset) + plan.insert + text.substring(start.offset);
        const offset = start.offset + plan.caret;

        this.setCursor(offset, offset, true);
    }

    override tabHandler(event: KeyboardEvent): void {
        event.preventDefault();
        if (this.muya?.editor.documentEditing) {
            const selection = this.muya.editor.selection.getDOMSelection();
            if (!selection)
                throw new Error('Code Tab has no document selection');
            dispatchDocumentTab(this.muya, event.shiftKey, selection);
            return;
        }
        const { start, end } = this.getCursor()!;
        const expansion = codeTabExpansion(this.text, start.offset, end.offset, this._lang);
        if (!expansion) {
            this.insertTab();
            return;
        }
        this.text = this.text.substring(0, expansion.start) + expansion.insert + this.text.substring(expansion.end);
        this.setCursor(expansion.selection.start, expansion.selection.end, true);
    }

    override backspaceHandler(event: KeyboardEvent): void {
        const { start, end } = this.getCursor()!;
        // If the cursor is in the first position of the code block text,
        // when backspace is pressed, this time the code block should be converted to a normal paragraph
        if (start.offset === end.offset && start.offset === 0) {
            event.preventDefault();
            if (this.muya.editor.documentEditing) {
                event.stopPropagation();
                const selection = this.muya.editor.selection.getDOMSelection();
                if (!selection)
                    throw new Error('Literal boundary reset requires a document selection');
                dispatchDocumentBlock(this.muya, { type: 'reset', scope: 'leaf', selectionMode: 'preserve' }, selection);
                return;
            }
            const { text, muya } = this;
            const state = {
                name: 'paragraph',
                text,
            };
            const newNode = ScrollPage.loadBlock(state.name).create(muya, state);
            this.outContainer!.replaceWith(newNode);
            const cursorBlock = newNode.lastContentInDescendant();

            return cursorBlock.setCursor(0, 0, true);
        }

        // Ctrl/Alt/Cmd+Backspace deletes a word or line: leave it to the browser (#5239).
        if (event.ctrlKey || event.altKey || event.metaKey)
            return;

        // The following code should fix a certain bug:
        // when there is one newline(\n) character before cursor.
        // pressing the backspace key should work properly.(compatibility with Firefox)
        if (
            start.offset === end.offset
            && this.text[start.offset - 1] === '\n'
        ) {
            event.preventDefault();
            const { text } = this;
            this.text = text.substring(0, start.offset - 1) + text.substring(start.offset);
            this._updatePreviewIfHave(this.text);
            return this.setCursor(--start.offset, --end.offset, true);
        }
        // The following code is aimed at ensuring compatibility with Firefox.
        // If the preceding character is the end of a token or the second preceding
        // character is the end of a token, the cursor may become dislocated when
        // the backspace key is pressed in Firefox. Therefore, we need to manually
        // simulate the backspace key in order to set the cursor position correctly.
        if (start.offset === end.offset) {
            const { _lang: lang, text } = this;
            // transform alias to original language
            const fullLengthLang = transformAliasToOrigin([lang])[0];
            if (fullLengthLang && /\S/.test(text) && loadedLanguages.has(fullLengthLang)) {
                const tokens = prism.tokenize(text, prism.languages[fullLengthLang]);
                let offset = start.offset;
                let code = '';
                // Remove a whole character (grapheme cluster), not one UTF-16
                // code unit: half of an emoji's surrogate pair left in the text
                // crashes the next edit with "Invalid offset - splits unicode
                // bytes" (#4926).
                let removedLength = 0;

                walkTokens(tokens, (token) => {
                    if (typeof token.content === 'string') {
                        if (token.type === 'temp-text' && offset === firstGraphemeLength(token.content)) {
                            removedLength = offset;
                            token.content = token.content.substring(removedLength);
                        }
                        else if (token.type !== 'temp-text' && offset === token.length) {
                            removedLength = lastGraphemeLength(token.content);
                            token.content = token.content.substring(0, token.length - removedLength);
                        }
                    }
                    code += token.content;
                    // string and Token both has length property...
                    offset -= token.length;
                });

                if (removedLength > 0) {
                    event.preventDefault();
                    this.text = code;
                    this._updatePreviewIfHave(this.text);
                    return this.setCursor(start.offset - removedLength, end.offset - removedLength, true);
                }
            }
        }
    }

    override keyupHandler(): void {
        if (this.isComposed)
            return;

        const { anchor, focus } = this.getCursor()!;
        // TODO: @JOCS remove use this.selection directly
        const { anchor: oldAnchor, focus: oldFocus } = this.selection;

        if (
            anchor.offset !== oldAnchor?.offset
            || focus.offset !== oldFocus?.offset
        ) {
            this.commitNativeCursor(anchor.offset, focus.offset);
        }
    }
}

export default CodeBlockContent;
