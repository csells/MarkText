import type { HeadingChange, ListChange } from '@marktext/input-policy';
import type { JSONOp } from 'ot-json1';
import type Content from '../block/base/content';
import type { Muya } from '../muya';
import type { ISelection } from '../selection/types';
import type { TState } from '../state/types';
import type { DocumentCompositionResult, DocumentDOMPoint, DocumentEditing, DocumentFormatInput, DocumentTextInput, DocumentTextPoint, IDocumentCommandInput } from './documentEditingTypes';
import { crossBlockReplacement } from '../clipboard/crossBlockReplacement';
import { BLOCK_DOM_PROPERTY, isOsx } from '../config';
import { findContentDOM, getOffsetOfParagraph } from '../selection/dom';

import { SelectionDirection } from '../selection/types';
import { backspaceLength, firstGraphemeLength, lastGraphemeLength } from '../utils';

export type { DocumentDOMPoint, DocumentEditing, DocumentTextInput, DocumentTextReplacement } from './documentEditingTypes';

const inputTypes = new Set([
    'insertText',
    'insertReplacementText',
    'insertFromDrop',
    'insertParagraph',
    'insertLineBreak',
    'deleteContentBackward',
    'deleteContentForward',
    'deleteWordBackward',
    'deleteWordForward',
    'deleteSoftLineBackward',
    'deleteSoftLineForward',
    'deleteHardLineBackward',
    'deleteHardLineForward',
    'deleteEntireSoftLine',
]);
// macOS text-system commands (Ctrl+T, Ctrl+Y) whose beforeinput states the
// replacement text and its target range, as insertReplacementText does.
const statedInputTypes = new Set(['insertTranspose', 'insertFromYank']);

function point(endpoint: ISelection['anchor']): DocumentTextPoint {
    return {
        path: [...endpoint.path],
        offset: endpoint.offset,
    };
}

interface IViewNode { name: string; text?: string; children?: IViewNode[]; [key: string]: unknown }

function replaceViewRange(states: TState[], start: DocumentTextPoint, end: DocumentTextPoint, text: string) {
    const roots = structuredClone(states) as IViewNode[];
    if (start.path[start.path.length - 1] === 'lang' && start.path.length === end.path.length && start.path.every((part, index) => part === end.path[index])) {
        let target: unknown = roots;
        for (const part of start.path.slice(0, -1)) {
            if (target === null || typeof target !== 'object')
                throw new Error('Code info draft target is unavailable');
            target = (target as Record<string | number, unknown>)[part];
        }
        if (target === null || typeof target !== 'object' || !('lang' in target) || typeof target.lang !== 'string')
            throw new Error('Code info draft value is unavailable');
        target.lang = target.lang.slice(0, start.offset) + text + target.lang.slice(end.offset);
        return { state: roots as TState[], path: [...start.path] };
    }

    const leaves: Array<{ node: IViewNode; path: (string | number)[] }> = [];
    const visit = (nodes: IViewNode[], parent: (string | number)[] = []) => {
        nodes.forEach((node, index) => {
            const path = [...parent, index];
            if (typeof node.text === 'string')
                leaves.push({ node, path: [...path, 'text'] });
            if (node.children)
                visit(node.children, [...path, 'children']);
        });
    };
    visit(roots);
    const samePath = (path: readonly (string | number)[], other: readonly (string | number)[]) =>
        path.length === other.length && path.every((part, index) => part === other[index]);
    const first = leaves.findIndex(leaf => samePath(leaf.path, start.path));
    const last = leaves.findIndex(leaf => samePath(leaf.path, end.path));
    if (first < 0 || last < first)
        throw new Error('Document view replacement endpoints are unavailable');
    const prefix = leaves[first]!.node.text!.slice(0, start.offset);
    const suffix = leaves[last]!.node.text!.slice(end.offset);
    if (first === 0 && last === leaves.length - 1 && prefix === '' && suffix === '') {
        return { state: [{ name: 'paragraph', text }] as TState[], path: [0, 'text'] };
    }
    leaves[first]!.node.text = prefix + text + suffix;
    const removed = new Set(leaves.slice(first + 1, last + 1).map(leaf => leaf.node));
    const retain = (nodes: IViewNode[]): IViewNode[] => nodes.flatMap((node) => {
        if (removed.has(node))
            return [];
        if (node.children) {
            node.children = retain(node.children);
            if (node.children.length === 0)
                return [];
        }
        return [node];
    });
    return { state: retain(roots) as TState[], path: [...start.path] };
}

/** The platform's caret move to the visible line end: ⌘→ on macOS, End elsewhere. */
function isLineEndKey(event: KeyboardEvent): boolean {
    if (event.shiftKey || event.altKey || event.ctrlKey)
        return false;
    return isOsx ? event.key === 'ArrowRight' && event.metaKey : event.key === 'End' && !event.metaKey;
}

/** Captures a rejected-action draft before model reconciliation can replace the view. */
export function createDocumentTextDraft(
    muya: Muya,
    selection: { anchor: DocumentDOMPoint; focus: DocumentDOMPoint },
    text: string,
): () => void {
    const anchor = muya.editor.selection.getTextPoint(selection.anchor);
    const focus = muya.editor.selection.getTextPoint(selection.focus);
    if (!anchor || !focus)
        throw new Error('Document draft selection is unavailable');
    const anchorRange = document.createRange();
    anchorRange.setStart(selection.anchor.node, selection.anchor.offset);
    const focusRange = document.createRange();
    focusRange.setStart(selection.focus.node, selection.focus.offset);
    const backwards = anchorRange.compareBoundaryPoints(Range.START_TO_START, focusRange) > 0;
    const start = backwards ? focus : anchor;
    const end = backwards ? anchor : focus;
    const state = muya.getState();
    return () => {
        const replacement = replaceViewRange(state, start, end, text);
        muya.setContent(replacement.state, false, { preserveInputGrouping: true });
        const leaf = muya.editor.scrollPage?.queryBlock(replacement.path);
        if (leaf?.isContent())
            leaf.setCursor(start.offset + text.length, start.offset + text.length, true);
    };
}

/** Claims keys submitted by beforeinput or the modified-Enter command handler. */
export function ownsDocumentTextKey(muya: Muya, event: KeyboardEvent): boolean {
    if (!muya.editor.documentEditing || event.isComposing
        || muya.editor.selection.table.hasRectangle) {
        return false;
    }
    const selection = muya.editor.selection.getSelection();
    if ((event.metaKey || event.ctrlKey || event.altKey) && event.key !== 'Enter') {
        // Word and line boundaries belong to the browser's beforeinput range.
        // Literal widget boundaries retain their native reset/no-op commands;
        // a browser range can otherwise cross the separate language field.
        if (selection?.isCollapsed && selection.anchor.block.blockName === 'codeblock.content') {
            if (event.key === 'Backspace' && selection.anchor.offset === 0)
                return false;
            if (event.key === 'Delete' && selection.focus.offset === selection.focus.block.text.length)
                return false;
        }
        return ['Backspace', 'Delete'].includes(event.key);
    }
    if (Array.from(event.key).length === 1)
        return true;
    if (!selection)
        return false;
    if (event.key === 'Enter') {
        if (selection.anchor.block.blockName === 'table.cell.content' && selection.focus.block.blockName === 'table.cell.content')
            return true;
        if (selection.anchor.block.blockName === 'codeblock.content' && selection.focus.block.blockName === 'codeblock.content')
            return true;
        return ['paragraph.content', 'atxheading.content', 'setextheading.content'].includes(selection.anchor.block.blockName)
            && ['paragraph.content', 'atxheading.content', 'setextheading.content'].includes(selection.focus.block.blockName);
    }
    if (event.key === 'Backspace')
        return !selection.isCollapsed || selection.anchor.offset > 0;
    if (event.key === 'Delete')
        return !selection.isCollapsed || selection.focus.offset < selection.focus.block.text.length;
    return false;
}

/** Form fields inside widgets edit their own value, not model-owned text. */
function isNativeTextField(target: EventTarget | null) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * Where the browser's Backspace at a caret starts: Chromium reports the whole
 * grapheme as the target range but removes only its backspace unit from the
 * caret's text node (one code point of a combining sequence).
 */
function browserBackspaceTarget(targetRange: StaticRange): StaticRange {
    const { startContainer, startOffset, endContainer, endOffset } = targetRange;
    if (!(endContainer instanceof Text) || endOffset === 0)
        return targetRange;
    const offset = endOffset - backspaceLength(endContainer.data.slice(0, endOffset));
    if (startContainer === endContainer && offset <= startOffset)
        return targetRange;
    return new StaticRange({ startContainer: endContainer, startOffset: offset, endContainer, endOffset });
}

/** The range the browser's input edits, rather than the one it reports. */
function inputTargetRange(event: InputEvent, nativeRange: Range, caret: DocumentDOMPoint, model?: DocumentEditing) {
    const reported = event.getTargetRanges?.()[0];
    return reported && nativeRange.collapsed && event.inputType === 'deleteContentBackward' && !model?.backspaceRemovesGrapheme?.(caret)
        ? browserBackspaceTarget(reported)
        : reported;
}

function inputSelection(muya: Muya, event: InputEvent | KeyboardEvent, model?: DocumentEditing) {
    const selection = muya.editor.selection.getSelection();
    const domSelection = muya.editor.selection.getDOMSelection();
    const browserSelection = muya.domNode.ownerDocument.getSelection();
    const nativeRange = browserSelection?.rangeCount ? browserSelection.getRangeAt(0) : undefined;
    if (!selection || !domSelection || !nativeRange)
        return null;
    const targetRange = event instanceof InputEvent ? inputTargetRange(event, nativeRange, domSelection.focus, model) : undefined;
    const browserRange = targetRange ?? nativeRange;
    const domRange = {
        anchor: { node: browserRange.startContainer, offset: browserRange.startOffset },
        focus: { node: browserRange.endContainer, offset: browserRange.endOffset },
    };
    if (!targetRange)
        return { selection, range: selection, domSelection, domRange };
    const anchorDom = findContentDOM(targetRange.startContainer);
    const focusDom = findContentDOM(targetRange.endContainer);
    const anchorBlock = anchorDom?.[BLOCK_DOM_PROPERTY] as Content | undefined;
    const focusBlock = focusDom?.[BLOCK_DOM_PROPERTY] as Content | undefined;
    if (!anchorDom || !focusDom || !anchorBlock || !focusBlock)
        return null;
    const anchor = { block: anchorBlock, path: anchorBlock.path, offset: getOffsetOfParagraph(targetRange.startContainer, anchorDom, targetRange.startOffset) };
    const focus = { block: focusBlock, path: focusBlock.path, offset: getOffsetOfParagraph(targetRange.endContainer, focusDom, targetRange.endOffset) };
    return {
        selection,
        domSelection,
        domRange,
        range: { ...selection, anchor, focus, direction: SelectionDirection.FORWARD, isCollapsed: targetRange.startContainer === targetRange.endContainer && targetRange.startOffset === targetRange.endOffset, isSelectionInSameBlock: anchorBlock === focusBlock },
    };
}

/**
 * A browser target range is already expanded; only a caret needs expanding:
 * forward Delete removes a grapheme, and Backspace the browser's backspace
 * unit unless upstream Muya removes the whole grapheme there.
 */
function replacementRange(range: ISelection, inputType: string, backspaceGrapheme: boolean) {
    const { anchor, focus } = range;
    const forward = range.direction !== 'backward';
    let start = point(forward ? anchor : focus);
    let end = point(forward ? focus : anchor);
    const first = forward ? anchor.block : focus.block;
    const last = forward ? focus.block : anchor.block;
    if (range.isCollapsed && inputType === 'deleteContentBackward') {
        if (start.offset === 0)
            return undefined;
        const preceding = first.text.slice(0, start.offset);
        const deleted = backspaceGrapheme ? lastGraphemeLength(preceding) : backspaceLength(preceding);
        start = { ...start, offset: start.offset - deleted };
    }
    else if (range.isCollapsed && inputType === 'deleteContentForward') {
        if (end.offset === last.text.length)
            return undefined;
        // A caret past the model's text (its DOM holds text the model lacks)
        // reaches past it, where no DOM point is found and the input is refused.
        const deleted = firstGraphemeLength(last.text.slice(end.offset)) || 1;
        end = { ...end, offset: end.offset + deleted };
    }
    return { start, end, first, last };
}

/** Native input and view echo share the exact selected range; neither diffs text. */
export function attachDocumentEditing(muya: Muya, model: DocumentEditing): () => void {
    let composition: { state: TState[]; start: DocumentTextPoint; end: DocumentTextPoint; candidate: string; cancelled: boolean; collapsed: boolean } | undefined;
    let drag: { selection: DocumentTextInput['selection']; moving: boolean } | undefined;
    const dragStart = (event: DragEvent) => {
        if ((event.target as HTMLElement)?.tagName === 'IMG')
            return;
        muya.flush();
        const selected = muya.editor.selection.getSelection();
        const selection = muya.editor.selection.getDOMSelection();
        drag = selected && !selected.isCollapsed && selection ? { selection, moving: false } : undefined;
    };
    const dragEnd = (event: DragEvent) => {
        const dropped = drag;
        drag = undefined;
        // A successful move into another editing host has no local insertion.
        // Admit its source cut only now; internal moves already consumed drag.
        if (!dropped?.moving || event.dataTransfer?.dropEffect !== 'move')
            return;
        const browser = muya.domNode.ownerDocument.getSelection();
        const external = browser?.anchorNode && browser.focusNode && !muya.domNode.contains(browser.anchorNode)
            ? { anchor: { node: browser.anchorNode, offset: browser.anchorOffset }, focus: { node: browser.focusNode, offset: browser.focusOffset } }
            : undefined;
        const focused = muya.domNode.ownerDocument.activeElement;
        const draft = createDocumentTextDraft(muya, dropped.selection, '');
        muya.flush();
        // Upstream records the browser's deleteByDrag as delete input.
        muya.editor.history.markInputBoundary('deleteByDrag', null);
        try {
            muya.editor.history.recordModelCommand(historyGroup => model.clipboard({ kind: 'cut', selection: dropped.selection, historyGroup }, draft));
        }
        finally {
            if (external?.anchor.node.isConnected && external.focus.node.isConnected) {
                if (focused instanceof HTMLElement)
                    focused.focus({ preventScroll: true });
                browser!.setBaseAndExtent(external.anchor.node, external.anchor.offset, external.focus.node, external.focus.offset);
            }
        }
    };
    const compositionStart = () => {
        muya.flush();
        const selection = muya.editor.selection.getSelection();
        const domSelection = muya.editor.selection.getDOMSelection();
        if (!selection || !domSelection)
            throw new Error('Native composition has no starting selection');
        const forward = selection.direction !== SelectionDirection.BACKWARD;
        composition = {
            state: muya.getState(),
            start: point(forward ? selection.anchor : selection.focus),
            end: point(forward ? selection.focus : selection.anchor),
            candidate: '',
            cancelled: false,
            collapsed: selection.isCollapsed,
        };
        muya.editor.documentCompositionActive = true;
        model.compositionStart({
            selection: domSelection,
            range: domSelection,
            inputType: 'insertCompositionText',
            data: null,
            options: { autoPairBracket: muya.options.autoPairBracket, autoPairQuote: muya.options.autoPairQuote, autoPairMarkdownSyntax: muya.options.autoPairMarkdownSyntax },
        });
    };
    const compositionUpdate = (event: Event) => {
        if (!composition || !(event instanceof CompositionEvent))
            return;
        composition.candidate = event.data;
        model.compositionUpdate(event.data);
    };
    const finishComposition = (result: DocumentCompositionResult) => {
        const draft = composition;
        if (!draft)
            return;
        composition = undefined;
        muya.editor.documentCompositionActive = false;
        const text = result.kind === 'commit' ? result.data : draft.candidate;
        muya.editor.history.recordModelInput('insertCompositionText', text, () => model.compositionEnd(result, () => {
            const replacement = replaceViewRange(draft.state, draft.start, draft.end, text);
            muya.setContent(replacement.state, false, { preserveInputGrouping: true });
            const leaf = muya.editor.scrollPage?.queryBlock(replacement.path);
            if (leaf?.isContent())
                leaf.setCursor(draft.start.offset + text.length, draft.start.offset + text.length, true);
        }));
    };
    const compositionEnd = (event: Event) => {
        if (!composition || !(event instanceof CompositionEvent))
            return;
        // Empty data represents either cancellation or deletion. Require an
        // observed cancellation or an unchanged collapsed range, never guess
        // the user's action from the browser's edited text.
        finishComposition(event.data.length > 0
            ? { kind: 'commit', data: event.data }
            : composition.cancelled || composition.collapsed ? { kind: 'cancel' } : { kind: 'unavailable' });
    };
    const compositionKey = (event: KeyboardEvent) => {
        if (composition && event.key === 'Escape')
            composition.cancelled = true;
    };
    const applyInput = (event: InputEvent | KeyboardEvent, inputType: string, data: string | null) => {
        // Selected cells take Backspace and Delete as a table operation; no
        // text input edits them. A press within one cell selects none.
        if (muya.editor.selection.table.hasRectangle) {
            if (!isNativeTextField(event.target))
                event.preventDefault();
            return;
        }
        const input = inputSelection(muya, event, model);
        if (!input) {
            // A caret without a model position must not let the browser edit
            // rendered DOM that the document model does not own.
            if (!isNativeTextField(event.target))
                event.preventDefault();
            return;
        }
        const { range, domSelection, domRange } = input;
        const structural = inputType === 'insertParagraph' || inputType === 'insertLineBreak';
        const text = structural ? '\n' : data ?? '';
        // Input whose text the browser does not state has nothing to submit,
        // and the browser must not edit the model's rendered text either.
        if (!structural && inputType.startsWith('insert') && data === null) {
            if (!isNativeTextField(event.target))
                event.preventDefault();
            return;
        }
        const replacement = replacementRange(range, inputType, range.isCollapsed && inputType === 'deleteContentBackward' && !!model.backspaceRemovesGrapheme?.(domSelection.focus));
        if (replacement === undefined)
            return;
        const { start, end, first, last } = replacement;
        if (first === last && first.blockName === 'language-input' && model.codeLanguage(domRange.anchor) === undefined) {
            // Indented code has no info string of its own. Its language box
            // gives the block one, as a command rather than text input.
            event.preventDefault();
            if (structural) {
                first.parent?.lastContentInDescendant()?.setCursor(0, 0, true);
                return;
            }
            const inserted = inputType.startsWith('insert') ? data ?? '' : '';
            const language = first.text.slice(0, start.offset) + inserted + first.text.slice(end.offset);
            if (language === first.text || /[\r\n`]/u.test(language))
                return;
            muya.flush();
            muya.editor.history.recordModelCommand(historyGroup => model.input({
                kind: 'command',
                historyGroup,
                command: 'setCodeLanguage',
                language,
                infoOffset: start.offset + inserted.length,
                selection: domSelection,
                options: {
                    autoPairBracket: muya.options.autoPairBracket,
                    autoPairQuote: muya.options.autoPairQuote,
                    autoPairMarkdownSyntax: muya.options.autoPairMarkdownSyntax,
                },
            }, () => {}));
            return;
        }
        let nativeStart: DocumentDOMPoint = domRange.anchor;
        let nativeEnd: DocumentDOMPoint = domRange.focus;
        // A collapsed deletion reaches one grapheme from the caret. Where that
        // point has no DOM position, the DOM holds text the model lacks (only
        // a native composition's text before the model commits it), so the
        // deletion has no model range and the browser must not make it.
        if (range.isCollapsed && inputType === 'deleteContentBackward') {
            const expanded = muya.editor.selection.getDOMPoint(start);
            if (!expanded) {
                event.preventDefault();
                return;
            }
            nativeStart = expanded;
        }
        else if (range.isCollapsed && inputType === 'deleteContentForward') {
            const expanded = muya.editor.selection.getDOMPoint(end);
            if (!expanded) {
                event.preventDefault();
                return;
            }
            nativeEnd = expanded;
        }
        const operation: DocumentTextInput = {
            selection: domSelection,
            range: { anchor: nativeStart, focus: nativeEnd },
            data: structural ? '\n' : data,
            inputType,
            options: {
                autoPairBracket: muya.options.autoPairBracket,
                autoPairQuote: muya.options.autoPairQuote,
                autoPairMarkdownSyntax: muya.options.autoPairMarkdownSyntax,
                tabSize: muya.options.tabSize,
                trimUnnecessaryCodeBlockEmptyLines: muya.options.trimUnnecessaryCodeBlockEmptyLines,
            },
        };
        // Upstream's Enter handlers mark a word boundary only on some paths;
        // on the others Enter joins the typing around it like any change.
        const enterJoinsStep = structural && !input.selection.anchor.block.enterMarksInputBoundary(inputType === 'insertLineBreak');
        event.preventDefault();
        muya.flush();
        const submit = (historyGroup: number) => model.input({ ...operation, historyGroup }, () => {
            if (first === last) {
                const prefixUnits = Array.from(first.text.slice(0, start.offset)).length;
                const deleted = first.text.slice(start.offset, end.offset);
                const edit = [
                    ...(prefixUnits === 0 ? [] : [prefixUnits]),
                    ...(deleted.length === 0 ? [] : [{ d: deleted }]),
                    ...(text.length === 0 ? [] : [text]),
                ];
                if (edit.length > 0)
                    muya.editor.updateContents([...start.path, { es: edit }] as JSONOp, null, 'api');
                first.setCursor(start.offset + text.length, start.offset + text.length, true);
            }
            else {
            // The view splice is explicit presentation work. Source structure is
            // owned by the submitted operation and the acknowledged Core projection.
                const replacement = replaceViewRange(muya.getState(), start, end, text);
                muya.setContent(replacement.state, false, { preserveInputGrouping: true });
                const leaf = muya.editor.scrollPage?.queryBlock(replacement.path);
                if (leaf?.isContent())
                    leaf.setCursor(start.offset + text.length, start.offset + text.length, true);
            }
        });
        if (enterJoinsStep)
            muya.editor.history.recordModelCommand(submit);
        else
            muya.editor.history.recordModelInput(inputType, operation.data, submit);
    };
    const commandKey = (event: KeyboardEvent) => {
        if (composition || event.isComposing || event.key !== 'Enter'
            || !(event.metaKey || event.ctrlKey || event.altKey) || muya.editor.selection.table.hasRectangle) {
            return;
        }
        if (muya.ui.handleContentKeydown(event))
            return;
        const selected = muya.editor.selection.getSelection();
        const selection = muya.editor.selection.getDOMSelection();
        if (!selected || !selection)
            return;
        if (!event.shiftKey && (isOsx ? event.metaKey : event.ctrlKey)
            && selected.anchor.block.blockName === 'table.cell.content'
            && selected.focus.block.blockName === 'table.cell.content') {
            event.preventDefault();
            event.stopImmediatePropagation();
            dispatchDocumentTableCommand(muya, { command: 'insertTableRow', selection, placement: 'after' });
        }
        else if (ownsDocumentTextKey(muya, event)) {
            event.stopImmediatePropagation();
            applyInput(event, event.shiftKey ? 'insertLineBreak' : 'insertParagraph', null);
        }
    };
    const caretKey = (event: KeyboardEvent) => {
        if (composition || event.isComposing || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey
            || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || !model.caretStep) {
            return;
        }
        const selection = muya.editor.selection.getDOMSelection();
        if (!selection || selection.anchor.node !== selection.focus.node || selection.anchor.offset !== selection.focus.offset)
            return;
        const element = selection.focus.node instanceof Element ? selection.focus.node : selection.focus.node.parentElement;
        const rtl = element?.closest('[dir]')?.getAttribute('dir') === 'rtl';
        const forward = (event.key === 'ArrowRight') !== rtl;
        const next = model.caretStep(selection.focus, forward ? 'forward' : 'backward');
        if (!next)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        muya.editor.selection.setDOMSelection(next, next);
    };
    const lineEndKey = (event: KeyboardEvent) => {
        if (!isLineEndKey(event) || composition || event.isComposing || !model.lineEndStep)
            return;
        const native = document.getSelection();
        const selection = muya.editor.selection.getDOMSelection();
        if (!native || !selection || selection.anchor.node !== selection.focus.node || selection.anchor.offset !== selection.focus.offset)
            return;
        const element = selection.focus.node instanceof Element ? selection.focus.node : selection.focus.node.parentElement;
        if (element?.closest('[dir]')?.getAttribute('dir') === 'rtl')
            return;
        // Let the browser find the visible line end, then ask the model whether
        // that position is inside syntax the line ends with.
        native.modify('move', 'forward', 'lineboundary');
        const moved = muya.editor.selection.getDOMSelection();
        const next = moved ? model.lineEndStep(moved.focus) : undefined;
        if (!next) {
            muya.editor.selection.setDOMSelection(selection.anchor, selection.focus);
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        muya.editor.selection.setDOMSelection(next, next);
    };
    const beforeInput = (event: Event) => {
        if (composition && event instanceof InputEvent && event.inputType === 'insertCompositionText') {
            if (event.data !== null) {
                composition.candidate = event.data;
                model.compositionUpdate(event.data);
            }
            return;
        }
        if (event instanceof InputEvent && event.inputType === 'deleteByDrag' && drag) {
            // The following insertFromDrop supplies the destination. Keep the
            // source untouched so the model admits the whole move atomically.
            event.preventDefault();
            drag.moving = true;
            return;
        }
        if (!(event instanceof InputEvent) || event.isComposing)
            return;
        if (!inputTypes.has(event.inputType)) {
            // Any other editing input over a cross-block selection replaces
            // the selection (#5415): left to the browser, it would delete the
            // block elements between the endpoints behind the model's back.
            const replacement = crossBlockReplacement(event.inputType, event.data);
            const selection = muya.editor.selection.getSelection();
            if (replacement != null && selection && !selection.isCollapsed && !selection.isSelectionInSameBlock)
                applyInput(event, replacement === '' ? 'deleteContentBackward' : 'insertText', replacement === '' ? null : replacement);
            // Chromium states the text; an empty kill ring states none.
            else if (statedInputTypes.has(event.inputType) && event.data)
                applyInput(event, event.inputType, event.data);
            // Formatting, list, link and native history commands have no model
            // operation here; the model owns the rendered text, so the browser
            // must not edit it either.
            else if (!isNativeTextField(event.target))
                event.preventDefault();
            return;
        }
        // In editable content the browser states dropped text and a spelling
        // correction's replacement in `dataTransfer`, not `data`.
        const data = event.inputType === 'insertFromDrop' || event.inputType === 'insertReplacementText'
            ? event.data ?? event.dataTransfer?.getData('text/plain') ?? null
            : event.data;
        if (event.inputType === 'insertFromDrop' && drag) {
            const input = inputSelection(muya, event);
            const dropped = drag;
            drag = undefined;
            event.preventDefault();
            if (!input)
                throw new Error('Text drop has no document target');
            const draft = createDocumentTextDraft(muya, input.domRange, data ?? '');
            muya.flush();
            // Upstream records a move as the browser's deleteByDrag and
            // insertFromDrop input, one change that starts a new undo step.
            if (dropped.moving)
                muya.editor.history.markInputBoundary('deleteByDrag', null);
            muya.editor.history.recordModelInput('insertFromDrop', data, historyGroup => model.input({
                kind: 'command',
                historyGroup,
                command: 'moveText',
                selection: dropped.selection,
                target: input.domRange,
                copy: !dropped.moving,
                options: {
                    autoPairBracket: muya.options.autoPairBracket,
                    autoPairQuote: muya.options.autoPairQuote,
                    autoPairMarkdownSyntax: muya.options.autoPairMarkdownSyntax,
                    tabSize: muya.options.tabSize,
                    trimUnnecessaryCodeBlockEmptyLines: muya.options.trimUnnecessaryCodeBlockEmptyLines,
                },
            }, draft));
            return;
        }
        applyInput(event, event.inputType, data);
    };
    muya.domNode.addEventListener('beforeinput', beforeInput, true);
    muya.domNode.addEventListener('compositionstart', compositionStart, true);
    muya.domNode.addEventListener('compositionupdate', compositionUpdate, true);
    muya.domNode.addEventListener('compositionend', compositionEnd, true);
    muya.domNode.addEventListener('keydown', compositionKey, true);
    muya.domNode.addEventListener('keydown', commandKey, true);
    muya.domNode.addEventListener('keydown', caretKey, true);
    muya.domNode.addEventListener('keydown', lineEndKey, true);
    muya.domNode.addEventListener('dragstart', dragStart, true);
    muya.domNode.addEventListener('dragend', dragEnd, true);

    return () => {
        if (composition)
            finishComposition({ kind: 'unavailable' });
        muya.domNode.removeEventListener('beforeinput', beforeInput, true);
        muya.domNode.removeEventListener('compositionstart', compositionStart, true);
        muya.domNode.removeEventListener('compositionupdate', compositionUpdate, true);
        muya.domNode.removeEventListener('compositionend', compositionEnd, true);
        muya.domNode.removeEventListener('keydown', compositionKey, true);
        muya.domNode.removeEventListener('keydown', commandKey, true);
        muya.domNode.removeEventListener('keydown', caretKey, true);
        muya.domNode.removeEventListener('keydown', lineEndKey, true);
        muya.domNode.removeEventListener('dragstart', dragStart, true);
        muya.domNode.removeEventListener('dragend', dragEnd, true);
    };
}

type DocumentCommand = IDocumentCommandInput extends infer Input
    ? Input extends IDocumentCommandInput ? Omit<Input, 'kind' | 'historyGroup' | 'options'> : never
    : never;

interface IDocumentCommandRun {
    /** Commit pending native text before the command reads the document. */
    readonly flush: boolean;
    /** The error thrown when no document is bound. */
    readonly missing: string;
    /** Also pass the tab size and code-block trimming preferences. */
    readonly editingOptions?: boolean;
}

/** Record one model command in its own history step; returns whether it committed a source edit. */
function runDocumentCommand(muya: Muya, command: DocumentCommand, { flush, missing, editingOptions = false }: IDocumentCommandRun): boolean {
    const model = muya.editor.documentEditing;
    if (!model)
        throw new Error(missing);
    if (flush)
        muya.flush();
    return muya.editor.history.recordModelCommand(historyGroup => model.input({
        kind: 'command',
        historyGroup,
        ...command,
        options: {
            autoPairBracket: muya.options.autoPairBracket,
            autoPairQuote: muya.options.autoPairQuote,
            autoPairMarkdownSyntax: muya.options.autoPairMarkdownSyntax,
            ...(editingOptions
                ? { tabSize: muya.options.tabSize, trimUnnecessaryCodeBlockEmptyLines: muya.options.trimUnnecessaryCodeBlockEmptyLines }
                : {}),
        },
    }, () => {}));
}

/** Keyboard and row-popup table commands share one model operation. */
export function dispatchDocumentTableCommand(muya: Muya, operation: Pick<IDocumentCommandInput, 'selection'> & (
    { command: 'createTable'; rows: number; columns: number; replace: boolean } | { command: 'moveTableRow'; target: DocumentDOMPoint; row: number } | { command: 'moveTableColumn'; target: DocumentDOMPoint; column: number } | { command: 'insertTableRow' | 'insertTableColumn'; placement: 'before' | 'after' } | { command: 'removeTableRow' | 'removeTableColumn' | 'tableBoundaryBackspace' | 'exitTable' } | { command: 'alignTableColumn'; target: DocumentDOMPoint; alignment: 'left' | 'center' | 'right' }
)): boolean {
    if (!muya.editor.documentEditing)
        return false;
    runDocumentCommand(muya, operation, { flush: true, missing: 'Table command requires a bound document', editingOptions: true });
    return true;
}

/** Checkbox widgets submit their target before changing native task state. */
export function dispatchDocumentTask(muya: Muya, checked: boolean, selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, {
        command: 'setTaskChecked',
        checked,
        selection,
        autoCheck: muya.options.autoCheck,
        autoMoveCheckedToEnd: muya.options.autoMoveCheckedToEnd,
    }, { flush: true, missing: 'Task checkbox requires a bound document' });
}

/** Code insertion retains native menus while the model owns its block and caret. */
export function dispatchDocumentCodeBlock(muya: Muya, replace: boolean, selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'createCodeBlock', replace, selection }, { flush: false, missing: 'Code block insertion requires a bound document' });
}

/** Dispatch paragraph menu actions before the native tree is mutated. */
export function dispatchDocumentBlockMove(muya: Muya, from: DocumentDOMPoint, to: DocumentDOMPoint, placement: 'before' | 'after'): void {
    const selection = muya.editor.selection.getDOMSelection() ?? { anchor: from, focus: from };
    runDocumentCommand(muya, { command: 'moveBlock', from, to, placement, selection }, { flush: true, missing: 'Block drag requires a bound document' });
}

/** Dispatch paragraph menu actions before the native tree is mutated. */
export function dispatchDocumentBlock(muya: Muya, change: Extract<IDocumentCommandInput, { command: 'changeBlock' }>['change'], selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'changeBlock', change, selection }, { flush: false, missing: 'Block command requires a bound document' });
}

/** Wrap the selected document blocks without serializing their native view. */
export function dispatchDocumentCodeWrap(muya: Muya, selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'wrapCodeBlocks', selection }, { flush: false, missing: 'Code block wrapping requires a bound document' });
}

/** Reset a code leaf through its source owner before the next user action. */
export function dispatchDocumentCodeReset(muya: Muya, selectionMode: 'preserve' | 'end', selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'resetCodeBlock', selectionMode, selection }, { flush: false, missing: 'Code block reset requires a bound document' });
}

/** Front matter creation shares the live document owner with its next input. */
export function dispatchDocumentFrontMatter(muya: Muya, replace: boolean, selection: IDocumentCommandInput['selection']): boolean {
    return runDocumentCommand(muya, {
        command: 'createFrontMatter',
        replace,
        style: muya.options.frontmatterType,
        selection,
    }, { flush: true, missing: 'Front matter insertion requires a bound document' });
}

/** Horizontal rules and their following insertion point belong to the model. */
export function dispatchDocumentThematicBreak(muya: Muya, change: 'insert' | 'replace' | 'toggle' | 'reset' | 'enter', selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'changeThematicBreak', change: { type: change }, selection }, { flush: false, missing: 'Horizontal rule insertion requires a bound document' });
}

/** Math insertion retains native menus while the model owns its block and caret. */
export function dispatchDocumentMathBlock(muya: Muya, replace: boolean, selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'createMathBlock', replace, selection }, { flush: false, missing: 'Math block insertion requires a bound document' });
}

/** HTML insertion writes the element template and its caret in one model action. */
export function dispatchDocumentHtmlBlock(muya: Muya, replace: boolean, selectionMode: 'content' | 'end', selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'createHtmlBlock', replace, selectionMode, selection }, { flush: false, missing: 'HTML block insertion requires a bound document' });
}

/** Paragraph joining submits the caret before native tree mutation. */
export function dispatchDocumentParagraphJoin(muya: Muya, direction: 'backward' | 'forward', selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, {
        command: direction === 'backward' ? 'joinParagraphBackward' : 'joinParagraphForward',
        selection,
    }, { flush: true, missing: 'Paragraph join requires a bound document' });
}

/** Tab submits the actual selection before native syntax or tree mutation. */
export function dispatchDocumentTab(muya: Muya, shift: boolean, selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'tab', shift, selection }, { flush: true, missing: 'Tab requires a bound document', editingOptions: true });
}

/** Existing-list commands reach the live model before native tree mutation. */
export function dispatchDocumentList(muya: Muya, change: ListChange, selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, {
        command: 'changeList',
        change,
        selection,
        listOptions: {
            bulletListMarker: muya.options.bulletListMarker,
            orderListDelimiter: muya.options.orderListDelimiter,
            preferLooseListItem: muya.options.preferLooseListItem,
        },
    }, { flush: false, missing: 'List model command requires a bound document' });
}

/** Menu-bar and paragraph-menu headings use the same explicit model command. */
export function dispatchDocumentHeading(muya: Muya, change: HeadingChange, selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'changeHeading', change, selection }, { flush: false, missing: 'Heading model command requires a bound document' });
}

/** Paragraph and quick-insert menus retain their distinct quote operations. */
export function dispatchDocumentBlockquote(muya: Muya, type: 'set' | 'quick-insert' | 'toggle' | 'reset', selection: IDocumentCommandInput['selection']): void {
    runDocumentCommand(muya, { command: 'changeBlockquote', change: { type }, selection }, { flush: false, missing: 'Blockquote model command requires a bound document' });
}

/** All bound format entry points dispatch before native syntax recognition. */
export function dispatchDocumentFormat(muya: Muya, type: string): boolean {
    const model = muya.editor.documentEditing;
    if (!model || !['strong', 'em', 'del', 'inline_code', 'inline_math', 'u', 'mark', 'sub', 'sup', 'link', 'image', 'clear'].includes(type))
        return false;
    muya.flush();
    const selection = muya.editor.selection.getDOMSelection();
    if (selection) {
        const format = type as Exclude<DocumentFormatInput['format'], 'image-properties'>;
        muya.editor.history.recordModelCommand(historyGroup => model.format({ format, selection, historyGroup }));
    }
    if (type === 'image')
        muya.showImageSelectorAtSelection();
    return true;
}
