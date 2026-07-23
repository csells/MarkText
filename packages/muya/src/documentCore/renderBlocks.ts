import type {
    MarkupRenderBlock,
    MarkupRenderElement,
    MarkupRenderRun,
} from '@marktext/document-core';

/**
 * Render the document engine's block tree into DOM.
 *
 * This is where muya becomes a *view* over `@marktext/document-core` rather than
 * a second authority: the engine decides the blocks, the inline runs and every
 * offset, and this only mounts them (ADR-0009, ADR-0013). Nothing here parses
 * Markdown, recognizes CriticMarkup, or derives a position from rendered text
 * length — doing any of those would reintroduce the drift between what is
 * displayed and what the document actually says.
 */

/** Block kinds the engine emits, mapped to the element a view mounts. */
const BLOCK_TAGS: Readonly<Record<string, string>> = {
    'paragraph': 'p',
    'heading': 'h1',
    'blockquote': 'blockquote',
    'list': 'ul',
    'list-item': 'li',
    'code-block': 'pre',
    'thematic-break': 'hr',
    'html-block': 'div',
};

function blockTag(block: MarkupRenderBlock): string {
    if (block.kind === 'heading') {
        // The parser recorded the level; mount it rather than flattening every
        // heading to one element.
        const level = block.attributes.level;
        if (typeof level === 'number' && level >= 1 && level <= 6)
            return `h${level}`;
    }
    if (block.kind === 'list' && block.attributes.ordered === true)
        return 'ol';

    return BLOCK_TAGS[block.kind] ?? 'p';
}

/**
 * Wrap a run's text in its CriticMarkup elements, outermost first, so nested
 * marks nest in the DOM the same way they nest in the document.
 */
function renderRun(document: Document, run: MarkupRenderRun): Node {
    let node: Node = document.createTextNode(run.text);
    for (const element of [...run.elements].reverse()) {
        const wrapper = document.createElement(elementTag(element));
        wrapper.appendChild(node);
        node = wrapper;
    }
    if (node instanceof HTMLElement) {
        // Model offsets travel with the DOM so a selection maps back to the
        // engine exactly, instead of being recomputed from text lengths.
        node.setAttribute('data-model-start', String(run.modelRange.start));
        node.setAttribute('data-model-end', String(run.modelRange.end));
    }
    return node;
}

function elementTag(element: MarkupRenderElement): string {
    return element;
}

export function renderDocumentCoreBlocks(
    host: HTMLElement,
    blocks: readonly MarkupRenderBlock[],
): void {
    const document = host.ownerDocument;
    host.replaceChildren();
    for (const block of blocks) {
        const element = document.createElement(blockTag(block));
        element.setAttribute('data-model-start', String(block.modelRange.start));
        element.setAttribute('data-model-end', String(block.modelRange.end));
        for (const run of block.runs)
            element.appendChild(renderRun(document, run));

        host.appendChild(element);
    }
}
