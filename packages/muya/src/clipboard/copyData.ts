import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type TreeNode from '../block/base/treeNode';
import type { TSourceRange } from '../mappedText';
import type { Muya } from '../muya';
import type { ISelection } from '../selection/types';
import type { TState } from '../state/types';
import type { Nullable } from '../types';
import type { ICriticMarkupClipboardContext } from '../utils/marked/getClipboardHtml';
import type Clipboard from './index';
import { hasCriticMarkupOpener } from '../criticMarkup/parser';
import { localOffset, sourceRange } from '../mappedText';
import { markdownStatePath } from '../state/markdownSourceMap';
import StateToMarkdown from '../state/stateToMarkdown';
import {
    getClipBoardHtml,
    getSanitizeClipboardHtml,
    sanitizeClipboardHtml,
} from '../utils/marked';
import { projectCriticMarkupMarkdown } from '../utils/marked/criticMarkupDocument';
import { CopyType } from './types';

export interface IClipboardPayload {
    html: string;
    text: string;
    /** Visible projection prepared together with rich HTML from one analysis. */
    projectedText?: string;
    /** Exact live-document context for selections containing Critic openers. */
    criticMarkupContext?: ICriticMarkupClipboardContext;
}

// Document-order resolution of a cross-block selection: the start/end outmost
// blocks, the start/end content leaves, and their offsets, ordered so `start`
// precedes `end` in the document regardless of selection direction.
interface ICopyOrder {
    anchorBlock: Content;
    focusBlock: Content;
    anchorOutMostBlock: Parent;
    focusOutMostBlock: Parent;
    startOutBlock: Parent;
    endOutBlock: Parent;
    startBlock: Content;
    endBlock: Content;
    startOffset: number;
    endOffset: number;
}

function buildHtmlOptions(options: Muya['options']) {
    const {
        criticMarkupProjection,
        footnote,
        frontMatter = true,
        math,
        isGitlabCompatibilityEnabled,
        superSubScript,
    } = options;

    return {
        criticMarkup: true,
        criticMarkupProjection,
        footnote,
        frontMatter,
        math,
        isGitlabCompatibilityEnabled,
        superSubScript,
    };
}

type TClipboardHtmlOptions = ReturnType<typeof buildHtmlOptions>;

function richClipboardPayload(
    text: string,
    options: TClipboardHtmlOptions,
    criticMarkupContext?: ICriticMarkupClipboardContext,
): IClipboardPayload {
    const projection = options.criticMarkupProjection ?? 'marked';
    const projectedText = criticMarkupContext
        ? `${criticMarkupContext.leadingMarkdown}${criticMarkupContext.document.projectSourceRange(
            criticMarkupContext.sourceRange,
            projection,
        )}${criticMarkupContext.trailingMarkdown}`
        : projectCriticMarkupMarkdown(
                text,
                projection,
                options,
            );
    const html = getClipBoardHtml(
        projection === 'marked' ? text : projectedText,
        projection === 'marked'
            ? options
            : {
                    ...options,
                    criticMarkup: false,
                    criticMarkupProjection: 'marked',
                },
        projection === 'marked' ? criticMarkupContext : undefined,
    );

    return { html, text, projectedText, criticMarkupContext };
}

function clipboardPayloadForSink(
    text: string,
    copyType: CopyType,
    options: TClipboardHtmlOptions,
    criticMarkupContext?: ICriticMarkupClipboardContext,
): IClipboardPayload {
    return copyType === CopyType.COPY_AS_RICH
        ? richClipboardPayload(text, options, criticMarkupContext)
        : { html: '', text, criticMarkupContext };
}

function sinkUsesCriticMarkupProjection(
    copyType: CopyType,
    options: TClipboardHtmlOptions,
): boolean {
    return copyType === CopyType.COPY_AS_HTML
        || copyType === CopyType.COPY_AS_RICH
        || (
            copyType === CopyType.NORMAL
            && options.criticMarkupProjection !== undefined
            && options.criticMarkupProjection !== 'marked'
        );
}

function criticMarkupContextForSelection(
    clipboard: Clipboard,
    start: Pick<ISelection['anchor'], 'path' | 'offset'>,
    end: Pick<ISelection['focus'], 'path' | 'offset'>,
    text: string,
    parserRange: TSourceRange,
    options: TClipboardHtmlOptions,
): ICriticMarkupClipboardContext | undefined {
    if (
        !sinkUsesCriticMarkupProjection(clipboard.copyType, options)
        || !hasCriticMarkupOpener(text)
    ) {
        return undefined;
    }

    const document = clipboard.muya.editor.criticMarkupDocument.get();
    const sourceRange = document.sourceRangeForLocalEndpoints(
        {
            path: markdownStatePath(start.path),
            offset: localOffset(start.offset),
        },
        {
            path: markdownStatePath(end.path),
            offset: localOffset(end.offset),
        },
    );
    const canonical = document.markdown.slice(
        sourceRange.start,
        sourceRange.end,
    );
    if (text.slice(parserRange.start, parserRange.end) !== canonical) {
        throw new RangeError(
            'Clipboard selection mapping differs from its canonical Markdown source range.',
        );
    }
    const leadingMarkdown = text.slice(0, parserRange.start);
    const trailingMarkdown = text.slice(parserRange.end);

    return Object.freeze({
        document,
        sourceRange,
        leadingMarkdown,
        trailingMarkdown,
    });
}

function projectedClipboardText(
    payload: IClipboardPayload,
    projection: TClipboardHtmlOptions['criticMarkupProjection'],
    options: TClipboardHtmlOptions,
): string {
    return payload.criticMarkupContext
        ? `${payload.criticMarkupContext.leadingMarkdown}${payload.criticMarkupContext.document.projectSourceRange(
            payload.criticMarkupContext.sourceRange,
            projection ?? 'marked',
        )}${payload.criticMarkupContext.trailingMarkdown}`
        : projectCriticMarkupMarkdown(
                payload.text,
                projection ?? 'marked',
                options,
            );
}

function completeRichClipboardPayload(
    payload: IClipboardPayload,
    options: TClipboardHtmlOptions,
): IClipboardPayload & { projectedText: string } {
    if (payload.projectedText !== undefined) {
        return {
            ...payload,
            projectedText: payload.projectedText,
        };
    }

    if (payload.html) {
        return {
            ...payload,
            projectedText: projectedClipboardText(
                payload,
                options.criticMarkupProjection,
                options,
            ),
        };
    }

    const rich = richClipboardPayload(
        payload.text,
        options,
        payload.criticMarkupContext,
    );
    if (rich.projectedText === undefined) {
        throw new TypeError(
            'Rich clipboard payload has no visible projection.',
        );
    }

    return {
        ...rich,
        projectedText: rich.projectedText,
    };
}

/**
 * Clipboard payload for a frozen cross-cell table selection, or `null` when
 * none is active. A single selected cell with text yields its plain text and
 * no HTML (so a paste lands as literal text, matching legacy
 * `docCopyHandler`); a larger rectangle serialises to GFM table markdown.
 */
function getTableSelectionClipboardData(
    clipboard: Clipboard,
): Nullable<IClipboardPayload> {
    const state = clipboard.selection.table.getStateForCopy();
    if (state == null)
        return null;

    const isSingleCell
        = state.children.length === 1 && state.children[0].children.length === 1;
    if (isSingleCell) {
        return { html: '', text: state.children[0].children[0].text };
    }

    const text = new StateToMarkdown().generate([state]);
    return clipboardPayloadForSink(
        text,
        clipboard.copyType,
        buildHtmlOptions(clipboard.muya.options),
    );
}

// Returns `null` when the outmost-block offsets can't be read (e.g. no scroll page).
function resolveSelectionOrder(
    clipboard: Clipboard,
    selection: ISelection,
): Nullable<ICopyOrder> {
    const { anchor, focus } = selection;
    const anchorBlock = anchor.block;
    const focusBlock = focus.block;
    const anchorOutMostBlock = anchorBlock.outMostBlock!;
    const focusOutMostBlock = focusBlock.outMostBlock!;
    const anchorOutMostBlockOffset = clipboard.scrollPage?.offset(anchorOutMostBlock);
    const focusOutMostBlockOffset = clipboard.scrollPage?.offset(focusOutMostBlock);
    if (anchorOutMostBlockOffset == null || focusOutMostBlockOffset == null)
        return null;

    const anchorFirst = anchorOutMostBlockOffset <= focusOutMostBlockOffset;

    return {
        anchorBlock,
        focusBlock,
        anchorOutMostBlock,
        focusOutMostBlock,
        startOutBlock: anchorFirst ? anchorOutMostBlock : focusOutMostBlock,
        endOutBlock: anchorFirst ? focusOutMostBlock : anchorOutMostBlock,
        startBlock: anchorFirst ? anchorBlock : focusBlock,
        endBlock: anchorFirst ? focusBlock : anchorBlock,
        startOffset: anchorFirst ? anchor.offset : focus.offset,
        endOffset: anchorFirst ? focus.offset : anchor.offset,
    };
}

// Truncate a leaf block's state (paragraph, heading, …) to the selected side
// of `offset`. Keeps the head (`0..offset`) for an end edge, the tail
// (`offset..`) for a start edge.
function truncateLeafState(
    leafState: TState,
    leaf: Content,
    offset: number,
    position: 'start' | 'end',
): TState {
    const text
        = position === 'start'
            ? leaf.text.substring(offset)
            : leaf.text.substring(0, offset);

    return { ...leafState, text } as TState;
}

// Build the partial state of a container (block-quote and any nested
// containers) for whichever edge `position` names: keep the sibling blocks on
// the selected side of the boundary leaf, recurse into the boundary child, and
// truncate the boundary leaf's own text. Mirrors the legacy DOM-selection
// serialization, which carried only the selected portion of a quote.
function buildPartialContainerState(
    container: Parent,
    leaf: Content,
    offset: number,
    position: 'start' | 'end',
): TState {
    const fullState = container.getState() as TState & { children?: TState[] };
    const childStates = fullState.children;
    if (childStates == null)
        return truncateLeafState(fullState, leaf, offset, position);

    const childBlocks = container.children.map(child => child);
    const idx = childBlocks.findIndex(
        child => child === leaf || leaf.isInBlock(child as Parent),
    );
    if (idx < 0)
        return fullState;

    const boundaryChild = childBlocks[idx];
    const boundaryFullState = childStates[idx] as TState & { children?: TState[] };
    const boundaryState
        = boundaryFullState.children != null
            ? buildPartialContainerState(boundaryChild as Parent, leaf, offset, position)
            : truncateLeafState(boundaryFullState, leaf, offset, position);

    const keptChildren
        = position === 'start'
            ? [boundaryState, ...childStates.slice(idx + 1)]
            : [...childStates.slice(0, idx), boundaryState];

    return { ...fullState, children: keptChildren } as TState;
}

// Build the partial state of a container when BOTH selection boundaries stay
// inside it (e.g. selecting across items of one list, or paragraphs of one
// block-quote): keep the children between the two boundary leaves, truncate
// both boundary leaves to the caret, and recurse into nested containers.
function buildRangeContainerState(
    container: Parent,
    startLeaf: Content,
    startOffset: number,
    endLeaf: Content,
    endOffset: number,
): TState {
    const fullState = container.getState() as TState & { children?: TState[] };
    const childStates = fullState.children;
    if (childStates == null) {
        // A leaf-text block with both boundaries in the same content leaf:
        // truncate to the selected span. When the boundaries are in different
        // leaves of the same block (e.g. a code fence's language line and its
        // body), there is no single text to slice — copy the whole block.
        if (startLeaf !== endLeaf)
            return fullState;

        return {
            ...fullState,
            text: startLeaf.text.substring(startOffset, endOffset),
        } as TState;
    }

    const childBlocks = container.children.map(child => child);
    const startIdx = childBlocks.findIndex(
        child => child === startLeaf || startLeaf.isInBlock(child as Parent),
    );
    const endIdx = childBlocks.findIndex(
        child => child === endLeaf || endLeaf.isInBlock(child as Parent),
    );
    if (startIdx < 0 || endIdx < 0)
        return fullState;

    // Both boundaries share a child: recurse into it (or truncate it if it is a
    // leaf block holding text directly).
    if (startIdx === endIdx) {
        const child = childBlocks[startIdx];
        const childFull = childStates[startIdx] as TState & { children?: TState[] };
        const childState
            = childFull.children != null
                ? buildRangeContainerState(child as Parent, startLeaf, startOffset, endLeaf, endOffset)
                : { ...childFull, text: startLeaf.text.substring(startOffset, endOffset) } as TState;

        return { ...fullState, children: [childState] } as TState;
    }

    const startChildFull = childStates[startIdx] as TState & { children?: TState[] };
    const startState
        = startChildFull.children != null
            ? buildPartialContainerState(childBlocks[startIdx] as Parent, startLeaf, startOffset, 'start')
            : truncateLeafState(startChildFull, startLeaf, startOffset, 'start');

    const endChildFull = childStates[endIdx] as TState & { children?: TState[] };
    const endState
        = endChildFull.children != null
            ? buildPartialContainerState(childBlocks[endIdx] as Parent, endLeaf, endOffset, 'end')
            : truncateLeafState(endChildFull, endLeaf, endOffset, 'end');

    return {
        ...fullState,
        children: [startState, ...childStates.slice(startIdx + 1, endIdx), endState],
    } as TState;
}

// Handle the start / end outmost block of a cross-block selection, pushing the
// partial state for whichever edge `position` names.
function appendPartialState(
    copyState: TState[],
    order: ICopyOrder,
    position: 'start' | 'end',
): void {
    const { startOutBlock, endOutBlock, startBlock, endBlock, startOffset, endOffset } = order;
    const outBlock = position === 'start' ? startOutBlock : endOutBlock;
    const block = position === 'start' ? startBlock : endBlock;
    const offset = position === 'start' ? startOffset : endOffset;

    // A block-quote or list endpoint is partially selected: carry only the
    // selected side of the container, with the boundary item's own text
    // truncated to the caret, rather than the whole container/item.
    if (/block-quote|bullet-list|order-list|task-list/.test(outBlock!.blockName)) {
        copyState.push(
            buildPartialContainerState(outBlock as Parent, block, offset, position),
        );

        return;
    }

    const truncated
        = position === 'start'
            ? block.text.substring(offset)
            : block.text.substring(0, offset);

    // Blocks whose marker lives in meta, not in the text: setext heading (its
    // `===`/`---` underline) and the code-family (code-block, html-block,
    // math-block, frontmatter, diagram fences/wrappers). Keep the block's own
    // type + meta and truncate only its text — the serializer rebuilds the
    // marker from meta. A fully-selected endpoint keeps the whole block. A code
    // fence's language line has no place in the body text, so copy it whole.
    if (
        /setext-heading|code-block|html-block|math-block|frontmatter|diagram/.test(outBlock!.blockName)
        && block.blockName !== 'language-input'
    ) {
        if (truncated.length === 0)
            return;
        copyState.push({ ...(outBlock as Parent).getState(), text: truncated } as TState);

        return;
    }

    // A table, or a code fence's language line, is copied whole.
    if (outBlock!.blockName === 'table' || block.blockName === 'language-input') {
        copyState.push((outBlock as Parent).getState());

        return;
    }

    // Paragraph, atx/setext heading and thematic-break: emit the substring as a
    // paragraph. An atx heading's `# ` marker lives in the text, so it rides
    // along when selected (and re-parses to a heading on paste) and is dropped
    // when the selection starts after it — matching the in-place cut.
    if (truncated.length === 0)
        return;

    copyState.push({ name: 'paragraph', text: truncated });
}

function collectSameOutMostBlockState(order: ICopyOrder): TState[] {
    const { anchorOutMostBlock, startBlock, endBlock, startOffset, endOffset } = order;
    const copyState: TState[] = [];

    // A table is copied whole (its own cross-cell selection path handles
    // partial rectangles elsewhere).
    if (anchorOutMostBlock!.blockName === 'table') {
        copyState.push((anchorOutMostBlock as Parent).getState());

        return copyState;
    }

    // List or block-quote: keep only the selected range, with both boundary
    // items/paragraphs truncated to the caret.
    copyState.push(
        buildRangeContainerState(
            anchorOutMostBlock as Parent,
            startBlock,
            startOffset,
            endBlock,
            endOffset,
        ),
    );

    return copyState;
}

function collectCopyState(order: ICopyOrder): TState[] {
    const { anchorOutMostBlock, focusOutMostBlock, startOutBlock, endOutBlock } = order;

    if (anchorOutMostBlock === focusOutMostBlock)
        return collectSameOutMostBlockState(order);

    const copyState: TState[] = [];
    appendPartialState(copyState, order, 'start');
    // Get State between the start outmost block and the end outmost block.
    let node: Nullable<TreeNode> = startOutBlock?.next;
    while (node && node !== endOutBlock) {
        copyState.push((node as Parent).getState());
        node = node.next;
    }
    appendPartialState(copyState, order, 'end');

    return copyState;
}

export function getClipboardData(clipboard: Clipboard): IClipboardPayload {
    const { copyType, copyInfo } = clipboard;
    if (copyType === CopyType.COPY_CODE_CONTENT) {
        return {
            html: '',
            text: copyInfo,
        };
    }

    // A frozen cross-cell table selection copies just that rectangle.
    const tableData = getTableSelectionClipboardData(clipboard);
    if (tableData != null)
        return tableData;

    const selection = clipboard.selection.getSelection();
    if (selection == null)
        return { html: '', text: '' };

    const { isSelectionInSameBlock, anchor, focus } = selection;
    const anchorBlock = anchor.block;
    const focusBlock = focus.block;

    if (anchorBlock == null || focusBlock == null)
        return { html: '', text: '' };

    const options = buildHtmlOptions(clipboard.muya.options);

    // Handler copy/cut in one block.
    if (isSelectionInSameBlock) {
        const begin = Math.min(anchor.offset, focus.offset);
        const end = Math.max(anchor.offset, focus.offset);

        const text = anchorBlock.text.substring(begin, end);
        const criticMarkupContext = criticMarkupContextForSelection(
            clipboard,
            { path: anchor.path, offset: begin },
            { path: anchor.path, offset: end },
            text,
            sourceRange(0, text.length),
            options,
        );

        return clipboardPayloadForSink(
            text,
            copyType,
            options,
            criticMarkupContext,
        );
    }

    // Handle select multiple blocks.
    const order = resolveSelectionOrder(clipboard, selection);
    if (order == null)
        return { html: '', text: '' };

    const copyState = collectCopyState(order);

    const tracked = new StateToMarkdown({
        listIndentation: clipboard.muya.options.listIndentation,
    }).generateMapped(copyState);
    const text = tracked.text;
    const firstSpan = tracked.sourceMap.spans[0];
    const lastSpan = tracked.sourceMap.spans.at(-1);
    const parserRange = firstSpan && lastSpan
        ? sourceRange(firstSpan.sourceStart, lastSpan.sourceEnd)
        : sourceRange(0, text.length);
    const criticMarkupContext = criticMarkupContextForSelection(
        clipboard,
        { path: order.startBlock.path, offset: order.startOffset },
        { path: order.endBlock.path, offset: order.endOffset },
        text,
        parserRange,
        options,
    );
    return clipboardPayloadForSink(
        text,
        copyType,
        options,
        criticMarkupContext,
    );
}

export function writeClipboardData(
    clipboard: Clipboard,
    event: ClipboardEvent,
): void {
    if (!event.clipboardData)
        return;

    const options = buildHtmlOptions(clipboard.muya.options ?? {});

    // A selected inline image supplies source to the same projection/mode/
    // sanitizer dispatcher as a text selection. It must not become a second
    // clipboard policy path: image alternatives can contain hostile HTML and
    // CriticMarkup whose visible value depends on the active projection.
    const selectedImage = clipboard.muya.editor?.selection?.image;
    const selectedImageSource = selectedImage?.token.raw ?? '';

    const { copyType } = clipboard;

    const payload = selectedImageSource.length > 0
        ? clipboardPayloadForSink(selectedImageSource, copyType, options)
        : clipboard.getClipboardData();
    const { text } = payload;

    // Mirror native copy behavior: leave the system clipboard untouched
    // when the selection has nothing to contribute, so a previous copy
    // from another app isn't silently clobbered (marktext #3130).
    if (text.length === 0)
        return;

    switch (copyType) {
        case CopyType.NORMAL: {
            const projection
                = clipboard.muya.options?.criticMarkupProjection ?? 'marked';
            const visibleText = projectedClipboardText(
                payload,
                projection,
                options,
            );
            event.clipboardData.setData('text/html', '');
            event.clipboardData.setData('text/plain', visibleText);
            break;
        }

        case CopyType.COPY_AS_HTML: {
            event.clipboardData.setData('text/html', '');
            event.clipboardData.setData(
                'text/plain',
                getSanitizeClipboardHtml(
                    text,
                    options,
                    payload.criticMarkupContext,
                ),
            );
            break;
        }

        // "Copy as Rich Text": put the rendered HTML in the html slot so a
        // rich-text target (Word, email, contenteditable) renders formatted
        // content, and keep the markdown source in the plain slot. Mirrors
        // the `normal` branch; `copyAsHtml` instead blanks text/html and
        // drops the markup into text/plain as literal source.
        case CopyType.COPY_AS_RICH: {
            const rich = completeRichClipboardPayload(payload, options);
            event.clipboardData.setData(
                'text/html',
                sanitizeClipboardHtml(rich.html),
            );
            event.clipboardData.setData(
                'text/plain',
                rich.projectedText,
            );
            break;
        }

        case CopyType.COPY_AS_MARKDOWN: {
            event.clipboardData.setData('text/html', '');
            event.clipboardData.setData('text/plain', text);
            break;
        }

        case CopyType.COPY_CODE_CONTENT: {
            event.clipboardData.setData('text/html', '');
            event.clipboardData.setData('text/plain', text);
            break;
        }
    }
}
