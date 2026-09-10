import type { Muya, TState } from '@muyajs/core';
import type { CoreAppliedReply } from '../../../desktop/src/renderer/src/documentAuthority/coreProtocol';
import { createEditorCoreBinding } from '../../../desktop/src/renderer/src/documentAuthority/editorCoreBinding';
import { createLocalCoreOwner } from '../../../desktop/src/renderer/src/documentAuthority/localCoreOwner';
import { createMuyaMarkupPresentationIndex } from '../../../desktop/src/renderer/src/documentAuthority/muyaMarkupPresentationIndex';
import { createMuyaModelSelection, muyaActiveFormats, muyaClipboardSelection, muyaClipboardInputSelection, muyaClipboardCurrentSelection, muyaClipboardToModel, muyaFormatToModel, muyaInputToModel } from '../../../desktop/src/renderer/src/documentAuthority/muyaModelSelection';
import { presentPendingClipboardImage } from '../../../desktop/src/renderer/src/documentAuthority/muyaPendingClipboardImage';
import { createMuyaPlainTextCoreAdapter } from '../../../desktop/src/renderer/src/documentAuthority/muyaPlainTextCoreAdapter';
import { reconcileMuyaDocumentView } from '../../../desktop/src/renderer/src/documentAuthority/reconcileMuyaDocumentView';

import { installProjectedSelectionClipboardGuard } from '../../../desktop/src/renderer/src/documentConsumers/projectedClipboardGuard';
import { createProjectedSelectionClipboardAuthority } from '../../../desktop/src/renderer/src/documentConsumers/projectedSelectionClipboardAuthority';

export function bootCoreBoundary(muya: Muya, source: string, tracked = false, existingBinding?: ReturnType<typeof createEditorCoreBinding>) {
    const binding = existingBinding ?? createEditorCoreBinding(createLocalCoreOwner());
    if (existingBinding === undefined)
        binding.open({ documentId: 'browser-boundary.md', source });
    const initial = binding.plainTextViewAtBarrier();
    if (initial.type !== 'plain-text-view' || !('state' in initial.view))
        throw new Error('Missing initial view');
    let view = initial.view;
    let presentation = createMuyaMarkupPresentationIndex(view);
    let adapter: ReturnType<typeof createMuyaPlainTextCoreAdapter>;
    const reconcile = (outcome: CoreAppliedReply) => {
        const next = binding.plainTextViewAtBarrier();
        if (next.type !== 'plain-text-view' || !('state' in next.view))
            throw new Error('Missing resulting view');
        view = next.view;
        presentation = createMuyaMarkupPresentationIndex(view, presentation);
        muya.setInlinePresentation(presentation.render);
        reconcileMuyaDocumentView({ muya, view, outcome, sourcePosition: adapter.reconciledSourcePosition, dirtyPaths: presentation.changedPaths, applyEditability: bindings => muya.setEditablePaths(bindings.filter(item => item.editable !== false).map(item => item.path)) });
        return view.bindings;
    };
    adapter = createMuyaPlainTextCoreAdapter(view.bindings, binding, undefined, reconcile);
    const snapshot = () => ({
        source: binding.sourceAtBarrier(),
        anchor: muya.getSelection()?.anchor.offset,
        caret: muya.getSelection()?.focus.offset,
        text: muya.editor.scrollPage?.firstContentInDescendant()?.domNode?.textContent,
    });
    const legacyCalls: unknown[] = [];
    const legacyChange = (change: unknown) => {
        if (change !== null && typeof change === 'object' && (change as { source?: unknown }).source === 'api')
            return;
        legacyCalls.push(change);
        adapter.accept(change);
    };
    muya.on('json-change', legacyChange);
    const actions: Array<{ selection: unknown; range: unknown; accepted: boolean; result: ReturnType<typeof snapshot> }> = [];
    const compositions: Array<{ selection: unknown; range: unknown }> = [];
    const browserEvents: Array<{ type: string; trusted: boolean; data: string | null; composing: boolean }> = [];
    const eventTypes = ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input'];
    const recordEvent = (event: Event) => browserEvents.push({
        type: event.type,
        trusted: event.isTrusted,
        data: event instanceof CompositionEvent || event instanceof InputEvent ? event.data : null,
        composing: event instanceof InputEvent && event.isComposing,
    });
    for (const type of eventTypes) muya.domNode.addEventListener(type, recordEvent, true);
    muya.setInlinePresentation(presentation.render);
    muya.setContent(structuredClone([...view.state]) as TState[]);
    muya.editor.bindDocumentEditing({
        async prepareImage(operation, payload, prepare) {
            const action = muyaFormatToModel(muya, view, operation, tracked);
            if (action.format !== 'image-properties')
                throw new Error('Image preparation requires image properties');
            const preparation = adapter.prepareImage(action, payload, reconcile);
            const presentImage = presentPendingClipboardImage(muya, preparation, () => view, payload);
            try {
                const properties = await prepare((payload) => {
                    preparation.capturePayload(payload);
                    presentImage(payload);
                });
                if (properties === undefined) {
                    preparation.cancel();
                    return false;
                }
                const currentSelection = () => {
                    const selection = muyaClipboardInputSelection(muya, view);
                    if (selection === undefined)
                        throw new Error('Prepared image has no current selection');
                    return selection;
                };
                return (await preparation.complete(properties, currentSelection)).changed;
            }
            catch (error) {
                preparation.fail(error instanceof Error ? error : new Error(String(error)));
                throw error;
            }
        },
        async prepareClipboard(selection, payload, prepare) {
            const action = muyaClipboardToModel(muya, view, 'kind' in selection ? { kind: 'table', operation: 'paste', selection, markdown: '' } : { kind: 'paste', selection, markdown: '' }, tracked);
            if (action.kind !== 'paste' && !(action.kind === 'table' && action.operation === 'paste'))
                throw new Error('Clipboard preparation requires a paste');
            const preparation = adapter.prepareClipboard(action, payload, reconcile);
            const presentImage = presentPendingClipboardImage(muya, preparation, () => view, payload);
            try {
                const imported = await prepare((payload) => {
                    preparation.capturePayload(payload);
                    presentImage(payload);
                });
                const currentSelection = () => {
                    const selection = muyaClipboardCurrentSelection(muya, view);
                    if (selection === undefined)
                        throw new Error('Prepared clipboard has no current selection');
                    return selection;
                };
                return (await preparation.complete(imported.markdown, { ...imported, currentSelection })).changed;
            }
            catch (error) {
                preparation.fail(error instanceof Error ? error : new Error(String(error)));
                throw error;
            }
        },
        activeFormats: selection => muyaActiveFormats(muya, view, selection),
        clipboard(operation, present) {
            const result = adapter.clipboard(muyaClipboardToModel(muya, view, operation, tracked), reconcile);
            if (!result.accepted)
                present();
            return result.changed;
        },
        format(operation) { return adapter.format(muyaFormatToModel(muya, view, operation, tracked), reconcile).changed; },
        compositionStart(operation) {
            const input = muyaInputToModel(muya, view, operation);
            compositions.push({ selection: input.selection, range: input.range });
            adapter.compositionStart(input);
        },
        compositionUpdate(data) { adapter.compositionUpdate(data); },
        compositionEnd(outcome, present) {
            const result = adapter.compositionEnd(outcome, reconcile, tracked);
            if (!result.accepted)
                present();
            return result.changed;
        },
        input(operation, present) {
            const input = muyaInputToModel(muya, view, operation);
            const result = adapter.input(input, reconcile, tracked);
            actions.push({ selection: input.selection, range: 'range' in input ? input.range : undefined, accepted: result.accepted, result: snapshot() });
            if (!result.accepted)
                present();
            return result.changed;
        },
    });
    const selected = createMuyaModelSelection(muya, view);
    const outside = selected.modelPointToDOM(0);
    if (outside === undefined)
        muya.editor.scrollPage?.firstContentInDescendant()?.setCursor(0, 0);
    else muya.editor.selection.setDOMSelection(outside, outside);
    const clipboardAuthority = createProjectedSelectionClipboardAuthority({
        settle: () => adapter.settled(),
        currentSelection: () => {
            const source = binding.sourceAtBarrier();
            const range = muyaClipboardSelection(muya, view);
            return source.type === 'source' && range !== undefined && ('kind' in range || range.start !== range.end) ? { range, revision: source.revision } : undefined;
        },
        selectionProjectionAtBarrier: async (range) => {
            const reply = binding.selectionProjectionAtBarrier(range);
            if (reply.type !== 'selection-projection')
                throw new Error('Clipboard selection projection unavailable');
            return reply.projection;
        },
    });
    let uninstallClipboardGuard: (() => void) | undefined;
    let currentClipboardData: DataTransfer;
    let clipboardRetry: Promise<void> | undefined;
    const dispatchClipboard = (operation: 'copy' | 'cut') => muya.domNode.dispatchEvent(new ClipboardEvent(operation, { clipboardData: currentClipboardData, bubbles: true, cancelable: true }));
    return {
        async prepareClipboardCopy() {
            uninstallClipboardGuard ??= installProjectedSelectionClipboardGuard(muya.domNode, () => clipboardAuthority.payload(), () => muya.editor.clipboard.cutHandler(), (operation) => {
                clipboardRetry = clipboardAuthority.prepare('rich').then((payload) => {
                    if (payload !== undefined)
                        dispatchClipboard(operation);
                });
            });
            return clipboardAuthority.prepare('rich');
        },
        async guardedClipboard(operation: 'copy' | 'cut') {
            currentClipboardData = new DataTransfer();
            clipboardRetry = undefined;
            dispatchClipboard(operation);
            await clipboardRetry;
            return { text: currentClipboardData.getData('text/plain'), html: currentClipboardData.getData('text/html') };
        },
        recovery: () => adapter.recoveryDraft(),
        read: () => ({ ...snapshot(), actions, compositions, browserEvents, legacyCalls }),
        settle: () => adapter.settled(),
        history: (kind: 'undo' | 'redo') => adapter.history(kind, reconcile),
        reopen: () => {
            const saved = binding.sourceAtBarrier();
            if (saved.type !== 'source')
                throw new Error('Missing acknowledged source');
            const reopened = createEditorCoreBinding(createLocalCoreOwner());
            try {
                reopened.open({ documentId: 'reopened-browser-boundary.md', source: saved.source });
                const result = reopened.sourceAtBarrier();
                if (result.type !== 'source')
                    throw new Error('Reopened source is unavailable');
                return result;
            }
            finally {
                reopened.dispose();
            }
        },
        dispose: () => {
            uninstallClipboardGuard?.();
            clipboardAuthority.reset();
            for (const type of eventTypes) muya.domNode.removeEventListener(type, recordEvent, true);
            muya.off('json-change', legacyChange);
            adapter.dispose();
            binding.dispose();
        },
    };
}

declare global {
    // eslint-disable-next-line ts/naming-convention -- Browser global augmentation uses its platform name.
    interface Window { coreBoundary: ReturnType<typeof bootCoreBoundary> }
}
