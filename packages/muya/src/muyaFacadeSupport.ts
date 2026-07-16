import type { IMuyaOptions } from './types';
import { CLASS_NAMES } from './config/index';

/**
 * Muya facade support: paragraph-command label tables consumed by the
 * coordinator's block commands, and root-container DOM construction.
 */

export const PARAGRAPH_LABEL_MAP: Record<string, string> = {
    'paragraph': 'paragraph',
    'hr': 'thematic-break',
    'front-matter': 'frontmatter',
    'table': 'table',
    'mathblock': 'math-block',
    'html': 'html-block',
    'pre': 'code-block',
    'blockquote': 'block-quote',
    'heading 1': 'atx-heading 1',
    'heading 2': 'atx-heading 2',
    'heading 3': 'atx-heading 3',
    'heading 4': 'atx-heading 4',
    'heading 5': 'atx-heading 5',
    'heading 6': 'atx-heading 6',
    'ul-bullet': 'bullet-list',
    'ol-order': 'order-list',
    // The desktop command palette emits `ol-bullet` for the ordered-list
    // command while the menu emits `ol-order`; accept both.
    'ol-bullet': 'order-list',
    'ul-task': 'task-list',
    'mermaid': 'diagram mermaid',
    'plantuml': 'diagram plantuml',
    'vega-lite': 'diagram vega-lite',
    'flowchart': 'diagram flowchart',
    'sequence': 'diagram sequence',
};

// The outmost-block labels that wrap a cross-block selection into a list.
export const CROSS_BLOCK_LIST_LABELS = new Set(['bullet-list', 'order-list', 'task-list']);

// Paragraph-menu labels whose block toggles back to a paragraph when the cursor
// is already inside one (the menu item is checked) — clicking unwraps/removes it.
export const TOGGLEABLE_BLOCK_LABELS = new Set([
    'bullet-list',
    'order-list',
    'task-list',
    'block-quote',
    'code-block',
    'thematic-break',
]);

// Options consumed by the markdown→state lexer (markdownToState / lexBlock).
// Changing any of these re-classifies block structure (e.g. ```math ⇄ code
// block under GitLab compatibility, front matter, footnote definitions), which
// a render-only rebuild from the already-parsed state cannot reflect — the
// document must be re-parsed from markdown. See setOptions below.
export const PARSE_AFFECTING_OPTIONS = new Set<keyof IMuyaOptions>([
    'isGitlabCompatibilityEnabled',
    'math',
    'footnote',
    'frontMatter',
    'trimUnnecessaryCodeBlockEmptyLines',
    // Inline-lexer classification AND the CriticMarkup parser profile both
    // depend on this flag; a render-only rebuild would leave the cached
    // parser artifact bound to the previous profile.
    'superSubScript',
]);

// Write provided appearance options as `--mu-*` vars / a wrap class on the root.
export function applyAppearance(domNode: HTMLElement, options: Partial<IMuyaOptions>) {
    const { style } = domNode;
    if (typeof options.fontSize === 'number')
        style.setProperty('--mu-font-size', `${options.fontSize}px`);
    if (typeof options.lineHeight === 'number')
        style.setProperty('--mu-line-height', `${options.lineHeight}`);
    if (options.editorFontFamily)
        style.setProperty('--mu-font-family', options.editorFontFamily);
    if (typeof options.codeFontSize === 'number')
        style.setProperty('--mu-code-font-size', `${options.codeFontSize}px`);
    if (options.codeFontFamily)
        style.setProperty('--mu-code-font-family', options.codeFontFamily);
    if ('wrapCodeBlocks' in options)
        domNode.classList.toggle(CLASS_NAMES.MU_CODE_WRAP, !!options.wrapCodeBlocks);
}

/**
 * [ensureContainerDiv ensure container element is div]
 */
export function getContainer(originContainer: HTMLElement, options: IMuyaOptions) {
    const { spellcheckEnabled, spellcheckHideMarks, hideQuickInsertHint, focusMode } = options;
    const newContainer = document.createElement('div');
    const attrs = originContainer.attributes;
    // Copy attrs from origin container to new container
    Array.from(attrs).forEach((attr: { name: string; value: string }) => {
        newContainer.setAttribute(attr.name, attr.value);
    });

    if (!hideQuickInsertHint)
        newContainer.classList.add(CLASS_NAMES.MU_SHOW_QUICK_INSERT_HINT);

    if (spellcheckHideMarks)
        newContainer.classList.add(CLASS_NAMES.MU_HIDE_SPELLING_MARKS);

    // Apply focus mode at construction when initially enabled; `setFocusMode`
    // toggles it thereafter.
    if (focusMode)
        newContainer.classList.add(CLASS_NAMES.MU_FOCUS_MODE);

    newContainer.classList.add(CLASS_NAMES.MU_EDITOR);

    newContainer.setAttribute('contenteditable', 'true');
    newContainer.setAttribute('autocorrect', 'false');
    newContainer.setAttribute('autocomplete', 'off');
    newContainer.setAttribute('spellcheck', spellcheckEnabled ? 'true' : 'false');
    originContainer.replaceWith(newContainer);

    applyAppearance(newContainer, options);

    return newContainer;
}

/**
 * Release parser-owned list spacing so the serializer re-spells every list
 * item from the active `listIndentation` option. Marker style and all other
 * trivia (Critic markers, block spacing, terminal EOL) stay untouched.
 */
export function stripListSpacingTrivia<T>(states: T): T {
    const strip = (value: unknown): unknown => {
        if (Array.isArray(value))
            return value.map(strip);
        if (value === null || typeof value !== 'object')
            return value;
        const record = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(record)) {
            if (key !== 'sourceTrivia') {
                result[key] = strip(entry);
                continue;
            }
            const trivia = Object.fromEntries(
                Object.entries(entry as Record<string, unknown>).filter(
                    ([triviaKey]) =>
                        triviaKey !== 'listItemLeadingPrefix'
                        && triviaKey !== 'listItemMarkerPadding'
                        && triviaKey !== 'listItemTrailingBlankLines'
                        && triviaKey !== 'listItemContinuationPrefixes',
                ),
            );
            if (Object.keys(trivia).length)
                result[key] = trivia;
        }
        return result;
    };
    return strip(states) as T;
}
