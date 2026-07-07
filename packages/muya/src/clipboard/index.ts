import type { Muya } from '../muya';
import type { IClipboardPayload } from './copyData';
import Format from '../block/base/format';
import { SelectionDirection } from '../selection/types';
import { isClipboardEvent, isKeyboardEvent } from '../utils';
import { getClipboardData, writeClipboardData } from './copyData';
import { blockedCommentMarkerCut, cutSelection, deleteTableSelection } from './cut';
import { pastePlainText, pasteSelection } from './paste';
import { pasteImageSrc } from './pasteImage';
import { CopyType, PasteType } from './types';

// After the table/same-block guards, decide whether a keydown over a
// cross-block selection should cut (replace) the selected text. Non-editing
// keys and any modifier combo must NOT cut — in particular Ctrl+<key> (e.g.
// Ctrl+C copy on Windows/Linux), which was previously not excluded and
// silently deleted the selection (#3491). Mirrors the macOS metaKey guard.
export function shouldCrossBlockCut(key: string, metaKey: boolean, ctrlKey: boolean): boolean {
    if (/Alt|Option|Meta|Shift|CapsLock|ArrowUp|ArrowDown|ArrowLeft|ArrowRight/.test(key))
        return false;

    if (metaKey || ctrlKey)
        return false;

    return true;
}

class Clipboard {
    public copyType: CopyType = CopyType.NORMAL;
    public pasteType: PasteType = PasteType.NORMAL;
    public copyInfo: string = '';

    get selection() {
        return this.muya.editor.selection;
    }

    get scrollPage() {
        return this.muya.editor.scrollPage;
    }

    static create(muya: Muya) {
        const clipboard = new Clipboard(muya);
        clipboard._listen();

        return clipboard;
    }

    constructor(public muya: Muya) {}

    private _listen() {
        const ownsEvent = () => this.muya.hasFocus();

        const copyCutHandler = (event: Event) => {
            if (!ownsEvent() || !isClipboardEvent(event))
                return;
            event.preventDefault();
            event.stopPropagation();

            const isCut = event.type === 'cut';

            // A blocked cut must be a full no-op: skipping the copy too keeps
            // the user's existing clipboard instead of silently degrading
            // Ctrl+X to a copy of text that was never removed.
            if (isCut && blockedCommentMarkerCut(this)) {
                this.muya.notifyCommentEditBlocked();
                return;
            }

            this.copyHandler(event);

            if (isCut)
                this.cutHandler();
        };

        const keydownHandler = (event: Event) => {
            if (!ownsEvent() || !isKeyboardEvent(event))
                return;
            const { key, metaKey } = event;

            if (this.selection.table.hasSelection) {
                if (!metaKey && (key === 'Backspace' || key === 'Delete')) {
                    event.preventDefault();
                    deleteTableSelection(this);
                }
                return;
            }

            const { isSelectionInSameBlock } = this.selection.getSelection() ?? {};
            if (isSelectionInSameBlock)
                return;

            if (!shouldCrossBlockCut(key, metaKey, event.ctrlKey))
                return;

            // Enter over a cross-block selection: suppress the corrupting native
            // Enter and mirror the same-block path — delete then split (#2443).
            if (key === 'Enter') {
                event.preventDefault();
                const performed = this.cutHandler();
                const block = this.muya.editor.activeContentBlock;
                if (performed && !event.shiftKey && block instanceof Format)
                    block.enterHandler(event);
                return;
            }

            if (key === 'Backspace' || key === 'Delete')
                event.preventDefault();

            // A guard-blocked cut leaves the model untouched, so the browser's
            // native edit (a printable key replacing the still-spanning DOM
            // selection) must be suppressed too or DOM and model diverge.
            if (!this.cutHandler()) {
                event.preventDefault();
                this.muya.notifyCommentEditBlocked();
            }
        };

        // IME composition over a selection: preventDefault on the 'Process'
        // (229) keydown cannot cancel a composition and the
        // insertCompositionText beforeinput is non-cancelable, so any guarding
        // must run at compositionstart, before the native composition replaces
        // the still-spanning DOM selection and diverges from the model.
        const compositionStartHandler = (event: Event) => {
            if (!ownsEvent() || event.type !== 'compositionstart')
                return;

            const selection = this.selection.getSelection();
            if (!selection || selection.isCollapsed)
                return;

            const { anchor, focus, direction } = selection;
            const startBlock = direction === SelectionDirection.FORWARD ? anchor.block : focus.block;
            const startOffset = direction === SelectionDirection.FORWARD ? anchor.offset : focus.offset;

            // A composition over a selection covering a comment marker whose
            // partner survives elsewhere would let the native compose delete
            // the marker and orphan it — for BOTH same- and cross-block
            // selections. Collapse to a caret so the composed text inserts
            // beside the marker instead of over it.
            if (blockedCommentMarkerCut(this)) {
                startBlock.setCursor(startOffset, startOffset, true);
                return;
            }

            // An unguarded CROSS-block selection still needs the model-driven
            // cut (the native compose cannot merge blocks correctly); a
            // same-block one is left to the native compose as usual.
            if (!selection.isSelectionInSameBlock)
                this.cutHandler();
        };

        const pasteHandler = (event: Event) => {
            if (ownsEvent() && isClipboardEvent(event))
                this.pasteHandler(event);
        };

        const { eventCenter } = this.muya;

        eventCenter.attachDOMEvent(document, 'copy', copyCutHandler);
        eventCenter.attachDOMEvent(document, 'cut', copyCutHandler);
        eventCenter.attachDOMEvent(document, 'paste', pasteHandler);
        eventCenter.attachDOMEvent(document, 'keydown', keydownHandler);
        eventCenter.attachDOMEvent(document, 'compositionstart', compositionStartHandler);
    }

    getClipboardData(): IClipboardPayload {
        return getClipboardData(this);
    }

    copyHandler(event: ClipboardEvent): void {
        writeClipboardData(this, event);
    }

    // False when a comment-marker guard blocked the cut (document untouched);
    // callers must then suppress any accompanying native edit.
    cutHandler(): boolean {
        return cutSelection(this);
    }

    pasteHandler(
        event: ClipboardEvent,
        rawText?: string,
        rawHtml?: string,
    ): Promise<void> {
        return pasteSelection(this, event, rawText, rawHtml);
    }

    copyAsMarkdown() {
        this.copyType = CopyType.COPY_AS_MARKDOWN;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    copyAsHtml() {
        this.copyType = CopyType.COPY_AS_HTML;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    copyAsRich() {
        this.copyType = CopyType.COPY_AS_RICH;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    // Chromium removed programmatic clipboard reads via
    // `document.execCommand('paste')` — it returns false and fires no paste
    // event, so the old flag + execCommand approach pasted nothing. Read the
    // clipboard text ourselves and feed it through the paste pipeline.
    async pasteAsPlainText(): Promise<void> {
        const text = await this._readClipboardText();
        if (text)
            await pastePlainText(this, text);
    }

    // Insert an image at the cursor from an explicit `src` (a saved file path or
    // `data:` URL), routing through `imageAction` like a clipboard image paste.
    // Drives the macOS screenshot flow, which can no longer use the removed
    // `document.execCommand('paste')`.
    pasteImage(src: string): Promise<void> {
        return pasteImageSrc(this, src);
    }

    private async _readClipboardText(): Promise<string> {
        // Sandboxed Electron renderers can't reach the system clipboard
        // directly, so the embedder supplies a reader (e.g. an IPC bridge to
        // Electron's native `clipboard`). Fall back to the async Clipboard API
        // for standalone (browser) use.
        const reader = this.muya.options.clipboardText;
        if (typeof reader === 'function') {
            try {
                return await reader();
            }
            catch {
                return '';
            }
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
            try {
                return await navigator.clipboard.readText();
            }
            catch {
                return '';
            }
        }

        return '';
    }

    copy(type: CopyType, info: string) {
        this.copyType = type;
        this.copyInfo = info;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }
}

export default Clipboard;
