import type {
    MarkupRenderBlock,
    MarkupRenderElement,
    MarkupRenderNode,
    MarkupRenderText,
    ReviewIndex,
    ReviewIndexItem,
} from '@marktext/document-core';
import { setDocumentCoreModelBoundaries } from './documentCoreInputAdapter';

/**
 * Mount the engine's portable semantic tree.
 *
 * This module is intentionally a closed kind→DOM presentation table. It never
 * reads source, recognizes Markdown, decodes entities, or reconstructs a
 * range. All structure, safe attributes, visible text, Review wrappers, and
 * coordinate maps arrive in the parser-owned descriptor.
 */

interface RenderContext {
    readonly tightList?: boolean;
    readonly tableHeader?: boolean;
    readonly presentLocalImage?: DocumentCoreLocalImagePresenter;
    readonly mountImage?: (
        image: HTMLImageElement,
        node: MarkupRenderNode,
    ) => void;
    readonly setTaskChecked?: DocumentCoreTaskChecked;
    readonly completedTaskLabel: string;
    readonly incompleteTaskLabel: string;
    /**
     * Parser heading identity -> the exact element this renderer created.
     *
     * Consumers retain this capability instead of rediscovering ownership from
     * queryable DOM attributes that document content could imitate.
     */
    readonly headingElements: Map<string, HTMLElement>;
}

export type DocumentCoreLocalImagePresenter = (
    image: HTMLImageElement,
    reference: string,
) => void;

export type DocumentCoreTaskChecked = (
    task: MarkupRenderNode,
    checked: boolean,
) => void;

const HIDDEN_KINDS = new Set([
    'definition',
    'front-matter',
    'footnote-definition',
]);

function setModelRange(
    element: Element,
    start: number,
    end: number,
): void {
    element.setAttribute('data-model-start', String(start));
    element.setAttribute('data-model-end', String(end));
}

function isNestedInComment(
    item: ReviewIndexItem,
    itemsById: ReadonlyMap<string, ReviewIndexItem>,
): boolean {
    let parent = item.parent;
    while (parent !== null) {
        const owner = itemsById.get(parent);
        if (owner === undefined)
            return false;
        if (owner.kind === 'comment')
            return true;
        parent = owner.parent;
    }
    return false;
}

function renderCommentIndicators(
    host: HTMLElement,
    reviewIndex: ReviewIndex,
    label: string,
): void {
    const itemsById = new Map(
        reviewIndex.items.map(item => [item.nodeId, item]),
    );
    const anchorsByComment = new Map(
        reviewIndex.commentedSpans.map(span => [span.comment, span]),
    );
    const runs = [
        ...host.querySelectorAll<HTMLElement>(
            '.document-view-run[data-model-start][data-model-end]',
        ),
    ];
    const tailByOffset = new Map<number, HTMLElement>();

    for (const comment of reviewIndex.items) {
        if (
            comment.kind !== 'comment'
            || isNestedInComment(comment, itemsById)
        ) {
            continue;
        }
        const offset = anchorsByComment.get(comment.nodeId)
            ?.modelRange.end ?? comment.focusOffset;
        const indicator = host.ownerDocument.createElement('span');
        indicator.className = 'document-view-critic-comment-indicator';
        indicator.setAttribute('role', 'img');
        indicator.setAttribute('aria-label', label);
        indicator.dataset.localeKey = 'Comment';
        indicator.setAttribute('contenteditable', 'false');
        indicator.setAttribute('data-critic-type', 'comment');
        indicator.dataset.criticCommentNodeId = comment.nodeId;
        setModelRange(indicator, offset, offset);

        const previousIndicator = tailByOffset.get(offset);
        if (previousIndicator !== undefined) {
            previousIndicator.after(indicator);
            tailByOffset.set(offset, indicator);
            continue;
        }
        const precedingRun = [...runs].reverse().find(
            run => Number(run.dataset.modelEnd) === offset,
        );
        if (precedingRun !== undefined) {
            precedingRun.after(indicator);
            tailByOffset.set(offset, indicator);
            continue;
        }
        const followingRun = runs.find(
            run => Number(run.dataset.modelStart) === offset,
        );
        if (followingRun !== undefined) {
            followingRun.before(indicator);
            tailByOffset.set(offset, indicator);
            continue;
        }

        // A document containing only hidden Comments has no visible run.
        // The parser-issued focus offset still gives the indicator an exact
        // model boundary and keeps its payload out of the DOM.
        host.appendChild(indicator);
        tailByOffset.set(offset, indicator);
    }
}

function wrapReviewElements(
    document: Document,
    content: Node,
    elements: readonly MarkupRenderElement[],
    start: number,
    end: number,
): Node {
    let result = content;
    // ReviewIndex retains the complete node hierarchy. DOM wrappers carry only
    // the three presentation states, so repeated wrappers add no Review
    // identity and can make an otherwise valid deep document crash a renderer.
    // Keep each element's innermost occurrence and its effective cascade order;
    // this bounds every text carrier to at most ins/del/mark.
    const seen = new Set<MarkupRenderElement>();
    const effective: MarkupRenderElement[] = [];
    for (let index = elements.length - 1; index >= 0; index -= 1) {
        const semantic = elements[index];
        if (semantic !== undefined && !seen.has(semantic)) {
            seen.add(semantic);
            effective.push(semantic);
        }
    }
    for (const semantic of effective) {
        const wrapper = document.createElement(semantic);
        setModelRange(wrapper, start, end);
        wrapper.appendChild(result);
        result = wrapper;
    }
    return result;
}

function renderText(document: Document, run: MarkupRenderText): HTMLElement {
    const carrier = document.createElement('span');
    carrier.className = 'document-view-run';
    setModelRange(carrier, run.modelRange.start, run.modelRange.end);
    setDocumentCoreModelBoundaries(carrier, {
        kind: run.boundaryMapping,
        start: run.modelRange.start,
        end: run.modelRange.end,
        textLength: run.text.length,
    });
    const text = document.createTextNode(run.text);
    carrier.appendChild(wrapReviewElements(
        document,
        text,
        run.elements,
        run.modelRange.start,
        run.modelRange.end,
    ));
    return carrier;
}

function appendText(
    document: Document,
    parent: Node,
    runs: readonly MarkupRenderText[],
): void {
    for (const run of runs)
        parent.appendChild(renderText(document, run));
}

function atomicCarrier(
    document: Document,
    node: MarkupRenderNode,
    content: Node,
): HTMLElement {
    const carrier = document.createElement('span');
    carrier.className = 'document-view-run document-view-atomic';
    setModelRange(carrier, node.modelRange.start, node.modelRange.end);
    setDocumentCoreModelBoundaries(
        carrier,
        {
            kind: 'collapsed',
            start: node.modelRange.start,
            end: node.modelRange.end,
            textLength: 1,
        },
    );
    carrier.appendChild(wrapReviewElements(
        document,
        content,
        node.elements,
        node.modelRange.start,
        node.modelRange.end,
    ));
    return carrier;
}

function addSemanticClasses(
    element: HTMLElement,
    node: MarkupRenderNode,
): void {
    element.classList.add(
        'document-view-node',
        `document-view-${node.kind}`,
    );
    element.setAttribute('data-markdown-kind', node.kind);
    element.setAttribute('data-node-id', node.key);
    setModelRange(element, node.modelRange.start, node.modelRange.end);
}

function appendChildren(
    document: Document,
    parent: Node,
    node: MarkupRenderNode,
    context: RenderContext,
): void {
    appendText(document, parent, node.text);
    for (const child of node.children) {
        const rendered = renderSemanticNode(document, child, context);
        if (rendered !== null)
            parent.appendChild(rendered);
    }
}

function paragraphNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): Node {
    if (context.tightList === true) {
        const fragment = document.createDocumentFragment();
        appendChildren(document, fragment, node, context);
        return fragment;
    }
    const paragraph = document.createElement('p');
    addSemanticClasses(paragraph, node);
    appendChildren(document, paragraph, node, context);
    return paragraph;
}

function headingNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    const configured = Number(node.attributes.level ?? 1);
    const level = Number.isInteger(configured)
        ? Math.max(1, Math.min(6, configured))
        : 1;
    const heading = document.createElement(`h${level}`);
    addSemanticClasses(heading, node);
    appendChildren(document, heading, node, context);
    if (context.headingElements.has(node.key))
        throw new Error(`Duplicate parser heading identity ${node.key}`);

    context.headingElements.set(node.key, heading);
    return heading;
}

function listNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    const ordered = node.attributes.ordered === true;
    const list = document.createElement(ordered ? 'ol' : 'ul');
    addSemanticClasses(list, node);
    if (
        ordered
        && typeof node.attributes.start === 'number'
        && node.attributes.start !== 1
    ) {
        list.setAttribute('start', String(node.attributes.start));
    }
    if (node.attributes.taskList === true)
        list.classList.add('contains-task-list');

    const tight = node.attributes.tight !== false;
    for (const child of node.children) {
        const rendered = renderSemanticNode(document, child, {
            ...context,
            tightList: tight,
        });
        if (rendered !== null)
            list.appendChild(rendered);
    }
    return list;
}

function listItemNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    const item = document.createElement('li');
    addSemanticClasses(item, node);
    if (node.attributes.task === true) {
        item.classList.add('task-list-item', 'document-view-task-list-item');
        const checkbox = document.createElement('input');
        checkbox.setAttribute('type', 'checkbox');
        checkbox.classList.add('document-view-task-list-checkbox');
        checkbox.checked = node.attributes.checked === true;
        checkbox.classList.toggle(
            'document-view-checkbox-checked',
            checkbox.checked,
        );
        checkbox.dataset.localeKey = checkbox.checked
            ? 'Completed task'
            : 'Incomplete task';
        if (context.setTaskChecked === undefined) {
            checkbox.disabled = true;
        }
        else {
            checkbox.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                context.setTaskChecked?.(node, checkbox.checked);
            });
        }
        checkbox.setAttribute('aria-label', checkbox.checked
            ? context.completedTaskLabel
            : context.incompleteTaskLabel);
        item.append(checkbox, document.createTextNode(' '));
    }
    appendChildren(document, item, node, context);
    return item;
}

function tableNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    const table = document.createElement('table');
    addSemanticClasses(table, node);
    const header = document.createElement('thead');
    const body = document.createElement('tbody');
    for (const row of node.children) {
        const isHeader = row.attributes.header === true;
        const rendered = renderSemanticNode(document, row, {
            ...context,
            tableHeader: isHeader,
        });
        if (rendered !== null)
            (isHeader ? header : body).appendChild(rendered);
    }
    if (header.childElementCount > 0)
        table.appendChild(header);
    if (body.childElementCount > 0)
        table.appendChild(body);
    return table;
}

function tableRowNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    const row = document.createElement('tr');
    addSemanticClasses(row, node);
    appendChildren(document, row, node, context);
    return row;
}

function tableCellNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    const cell = document.createElement(context.tableHeader === true
        ? 'th'
        : 'td');
    addSemanticClasses(cell, node);
    const alignment = node.attributes.alignment;
    if (
        alignment === 'left'
        || alignment === 'center'
        || alignment === 'right'
    ) {
        cell.setAttribute('align', alignment);
    }
    appendChildren(document, cell, node, context);
    return cell;
}

function inlineContainer(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
    tag: 'em' | 'strong' | 'del' | 'sub' | 'sup',
): HTMLElement {
    const element = document.createElement(tag);
    addSemanticClasses(element, node);
    appendChildren(document, element, node, context);
    return element;
}

function linkNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    if (node.attributes.resolved === false)
        return unresolvedReferenceNode(document, node);
    const link = document.createElement('a');
    addSemanticClasses(link, node);
    const href = node.attributes.href;
    link.setAttribute('href', typeof href === 'string' ? href : '');
    const title = node.attributes.title;
    if (typeof title === 'string')
        link.setAttribute('title', title);

    appendChildren(document, link, node, context);
    return link;
}

function imageNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): HTMLElement {
    if (node.attributes.resolved === false)
        return unresolvedReferenceNode(document, node);
    const image = document.createElement('img');
    addSemanticClasses(image, node);
    const source = node.attributes.src;
    if (
        typeof source === 'string'
        && /^(?:https?:|data:|blob:)/i.test(source)
    ) {
        image.setAttribute('src', source);
    }
    else if (typeof source === 'string' && source.length > 0) {
        context.presentLocalImage?.(image, source);
    }
    image.setAttribute(
        'alt',
        typeof node.attributes.alt === 'string' ? node.attributes.alt : '',
    );
    const title = node.attributes.title;
    if (typeof title === 'string')
        image.setAttribute('title', title);
    context.mountImage?.(image, node);

    return atomicCarrier(document, node, image);
}

function unresolvedReferenceNode(
    document: Document,
    node: MarkupRenderNode,
): HTMLElement {
    const literal = document.createElement('span');
    addSemanticClasses(literal, node);
    literal.classList.add('document-view-unresolved-reference');
    appendText(document, literal, node.text);
    return literal;
}

function literalInlineNode(
    document: Document,
    node: MarkupRenderNode,
    tag: 'code' | 'span',
    semanticClass?: string,
): HTMLElement {
    const element = document.createElement(tag);
    addSemanticClasses(element, node);
    if (semanticClass)
        element.classList.add(semanticClass);

    appendText(document, element, node.text);
    return element;
}

function literalBlockNode(
    document: Document,
    node: MarkupRenderNode,
    semanticClass?: string,
): HTMLElement {
    const pre = document.createElement('pre');
    addSemanticClasses(pre, node);
    if (semanticClass)
        pre.classList.add(semanticClass);

    const code = document.createElement('code');
    const language = node.kind === 'diagram'
        ? node.attributes.language
        : node.attributes.info;
    if (typeof language === 'string' && language.length > 0) {
        code.setAttribute('data-language', language);
        if (node.kind === 'diagram')
            pre.setAttribute('data-language', language);
    }
    appendText(document, code, node.text);
    pre.appendChild(code);
    return pre;
}

function footnoteReferenceNode(
    document: Document,
    node: MarkupRenderNode,
): Node {
    if (node.attributes.resolved !== true) {
        const fragment = document.createDocumentFragment();
        appendText(document, fragment, node.text);
        return fragment;
    }
    const sup = document.createElement('sup');
    addSemanticClasses(sup, node);
    sup.classList.add('footnote-ref');
    const link = document.createElement('a');
    link.setAttribute('href', `#${String(node.attributes.definitionId)}`);
    link.setAttribute('id', String(node.attributes.referenceId));
    link.textContent = String(node.attributes.ordinal);
    sup.appendChild(link);
    return atomicCarrier(document, node, sup);
}

function renderSemanticNode(
    document: Document,
    node: MarkupRenderNode,
    context: RenderContext,
): Node | null {
    if (HIDDEN_KINDS.has(node.kind))
        return null;

    switch (node.kind) {
        case 'document': {
            const root = document.createElement('div');
            addSemanticClasses(root, node);
            appendChildren(document, root, node, context);
            return root;
        }
        case 'paragraph':
            return paragraphNode(document, node, context);
        case 'heading':
            return headingNode(document, node, context);
        case 'blockquote': {
            const quote = document.createElement('blockquote');
            addSemanticClasses(quote, node);
            appendChildren(document, quote, node, context);
            return quote;
        }
        case 'list':
            return listNode(document, node, context);
        case 'list-item':
            return listItemNode(document, node, context);
        case 'thematic-break': {
            const rule = document.createElement('hr');
            addSemanticClasses(rule, node);
            return rule;
        }
        case 'table':
            return tableNode(document, node, context);
        case 'table-row':
            return tableRowNode(document, node, context);
        case 'table-cell':
            return tableCellNode(document, node, context);
        case 'text': {
            const text = document.createElement('span');
            addSemanticClasses(text, node);
            appendText(document, text, node.text);
            return text;
        }
        case 'soft-break': {
            const softBreak = document.createElement('span');
            addSemanticClasses(softBreak, node);
            appendText(document, softBreak, node.text);
            return softBreak;
        }
        case 'hard-break': {
            const lineBreak = document.createElement('br');
            addSemanticClasses(lineBreak, node);
            return atomicCarrier(document, node, lineBreak);
        }
        case 'emphasis':
            return inlineContainer(document, node, context, 'em');
        case 'strong':
            return inlineContainer(document, node, context, 'strong');
        case 'strikethrough':
            return inlineContainer(document, node, context, 'del');
        case 'subscript':
            return inlineContainer(document, node, context, 'sub');
        case 'superscript':
            return inlineContainer(document, node, context, 'sup');
        case 'link':
            return linkNode(document, node, context);
        case 'image':
            return imageNode(document, node, context);
        case 'inline-code':
            return literalInlineNode(document, node, 'code');
        case 'inline-html':
            return literalInlineNode(document, node, 'code', 'html-inline');
        case 'inline-math':
            return literalInlineNode(document, node, 'span', 'math-inline');
        case 'code-block':
            return literalBlockNode(document, node);
        case 'html-block':
            return literalBlockNode(document, node, 'html-block');
        case 'math-block':
            return literalBlockNode(document, node, 'math-block');
        case 'diagram':
            return literalBlockNode(document, node, 'diagram');
        case 'autolink':
            return linkNode(document, node, context);
        case 'footnote-reference':
            return footnoteReferenceNode(document, node);
        case 'definition':
        case 'front-matter':
        case 'footnote-definition':
            return null;
    }
}

function renderFootnotes(
    document: Document,
    definitions: readonly MarkupRenderNode[],
    context: RenderContext,
): HTMLElement | null {
    const referenced = definitions.filter(
        node => node.attributes.referenced === true,
    );
    if (referenced.length === 0)
        return null;

    const section = document.createElement('section');
    section.className = 'footnotes';
    const list = document.createElement('ol');
    for (const definition of referenced) {
        const item = document.createElement('li');
        item.setAttribute('id', String(definition.attributes.definitionId));
        addSemanticClasses(item, definition);
        for (const child of definition.children) {
            const rendered = renderSemanticNode(document, child, context);
            if (rendered !== null)
                item.appendChild(rendered);
        }
        const backlinkParent = item.lastElementChild?.tagName === 'P'
            ? item.lastElementChild
            : item;
        const total = Number(definition.attributes.referenceTotal ?? 0);
        for (let occurrence = 1; occurrence <= total; occurrence += 1) {
            const suffix = occurrence === 1
                ? ''
                : `-${String(occurrence)}`;
            const back = document.createElement('a');
            back.className = 'footnote-backref';
            back.setAttribute(
                'href',
                `#fnref-${encodeURIComponent(
                    String(definition.attributes.label ?? ''),
                )}${suffix}`,
            );
            back.setAttribute(
                'aria-label',
                `Back to reference ${String(
                    definition.attributes.ordinal,
                )}${suffix}`,
            );
            back.textContent = '↩';
            if (occurrence > 1) {
                const index = document.createElement('span');
                index.className = 'footnote-backref-index';
                index.textContent = String(occurrence);
                back.appendChild(index);
            }
            backlinkParent.append(
                document.createTextNode(' '),
                back,
            );
        }
        list.appendChild(item);
    }
    section.appendChild(list);
    return section;
}

// Byte-identical plan blocks mount byte-identical DOM: engine provenance
// keeps node keys stable for untouched regions and offsets before an edit
// point do not shift, so a block whose serialized plan matches the previous
// render's can reuse its mounted subtree verbatim. Anything else — shifted
// offsets, new keys, changed content — re-renders. Without this, any
// keystroke the patcher cannot apply re-mounted the whole document
// (measured 12.5s at a 12,000-addition family with the worker idle).
const mountedBlockPools = new WeakMap<HTMLElement, Map<string, HTMLElement[]>>();

function reuseBlockElement(
    pool: Map<string, HTMLElement[]> | undefined,
    signature: string,
): HTMLElement | undefined {
    const queue = pool?.get(signature);
    const element = queue?.shift();
    if (element === undefined)
        return undefined;
    // Indicators repaint after mounting; a reused subtree must not carry
    // the previous render's copies into the fresh pass.
    for (const indicator of element.querySelectorAll(
        '.document-view-critic-comment-indicator',
    ))
        indicator.remove();
    return element;
}

export function renderDocumentCoreBlocks(
    host: HTMLElement,
    blocks: readonly MarkupRenderBlock[],
    presentLocalImage?: DocumentCoreLocalImagePresenter,
    reviewIndex?: ReviewIndex,
    commentLabel = 'Comment',
    setTaskChecked?: DocumentCoreTaskChecked,
    taskLabels: Readonly<{
        completed: string;
        incomplete: string;
    }> = Object.freeze({
        completed: 'Completed task',
        incomplete: 'Incomplete task',
    }),
    mountImage?: (
        image: HTMLImageElement,
        node: MarkupRenderNode,
    ) => void,
): ReadonlyMap<string, HTMLElement> {
    const document = host.ownerDocument;
    const headingElements = new Map<string, HTMLElement>();
    const context: RenderContext = {
        headingElements,
        ...(presentLocalImage === undefined ? {} : { presentLocalImage }),
        ...(mountImage === undefined ? {} : { mountImage }),
        ...(setTaskChecked === undefined ? {} : { setTaskChecked }),
        completedTaskLabel: taskLabels.completed,
        incompleteTaskLabel: taskLabels.incomplete,
    };
    const previousPool = mountedBlockPools.get(host);
    const nextPool = new Map<string, HTMLElement[]>();
    host.replaceChildren();
    host.classList.add('document-view-document');
    host.setAttribute('data-markdown-kind', 'document');
    const footnotes: MarkupRenderNode[] = [];
    for (const block of blocks) {
        if (block.tree.kind === 'footnote-definition') {
            footnotes.push(block.tree);
            continue;
        }
        const signature = JSON.stringify(block);
        const reused = reuseBlockElement(previousPool, signature);
        let rendered: Node | null;
        if (reused !== undefined) {
            rendered = reused;
            const headingSelector =
                'h1[data-node-id], h2[data-node-id], h3[data-node-id], '
                + 'h4[data-node-id], h5[data-node-id], h6[data-node-id]';
            if (reused.matches(headingSelector)) {
                const key = reused.getAttribute('data-node-id');
                if (key !== null)
                    headingElements.set(key, reused);
            }
            for (const heading of reused.querySelectorAll<HTMLElement>(
                headingSelector,
            )) {
                const key = heading.getAttribute('data-node-id');
                if (key !== null)
                    headingElements.set(key, heading);
            }
        }
        else {
            rendered = renderSemanticNode(document, block.tree, context);
            if (rendered instanceof HTMLElement)
                rendered.classList.add('document-view-block');
        }
        if (rendered === null)
            continue;

        host.appendChild(rendered);
        if (rendered instanceof HTMLElement) {
            const queue = nextPool.get(signature);
            if (queue === undefined)
                nextPool.set(signature, [rendered]);
            else
                queue.push(rendered);
        }
    }
    mountedBlockPools.set(host, nextPool);
    const section = renderFootnotes(document, footnotes, context);
    if (section !== null)
        host.appendChild(section);
    if (reviewIndex !== undefined)
        renderCommentIndicators(host, reviewIndex, commentLabel);

    return headingElements;
}
