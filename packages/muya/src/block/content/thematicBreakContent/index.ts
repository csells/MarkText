import type { Muya } from '../../../muya';
import type { IRenderCursor } from '../../../selection/types';
import { dispatchDocumentThematicBreak } from '../../../editor/documentEditing';
import { isKeyboardEvent } from '../../../utils';
import Format from '../../base/format';
import { ScrollPage } from '../../scrollPage';

function changeDocumentRule(muya: Muya, event: Event, change: 'enter' | 'reset'): void {
    const selection = muya.editor.selection.getDOMSelection();
    if (!selection)
        throw new Error('Horizontal rule key has no document selection');
    event.preventDefault();
    event.stopPropagation();
    muya.flush();
    muya.editor.history.cutoff();
    try {
        dispatchDocumentThematicBreak(muya, change, selection);
    }
    finally {
        muya.editor.history.cutoff();
    }
}

class ThematicBreakContent extends Format {
    static override blockName = 'thematicbreak.content';

    static create(muya: Muya, text: string) {
        const content = new ThematicBreakContent(muya, text);

        return content;
    }

    constructor(muya: Muya, text: string) {
        super(muya, text);
        this.classList = [...this.classList, 'mu-thematic-break-content'];
        this.createDomNode();
    }

    override getAnchor() {
        return this.parent;
    }

    override update(cursor?: IRenderCursor, highlights = []) {
        return this.inlineRenderer.patch(this, cursor, highlights);
    }

    /**
     * Create an empty paragraph bellow.
     * @param {*} event
     */
    override enterHandler(event: Event) {
        const { text, muya } = this;
        if (muya.editor?.documentEditing) {
            changeDocumentRule(muya, event, 'enter');
            return;
        }
        const { start, end } = this.getCursor()!;
        if (start.offset === end.offset && start.offset === 0) {
            event.preventDefault();
            event.stopPropagation();
            const newState = {
                name: 'paragraph',
                text: '',
            };
            const emptyParagraph = ScrollPage.loadBlock(newState.name).create(
                muya,
                newState,
            );
            const thematicBreak = this.parent;
            thematicBreak!.parent!.insertBefore(emptyParagraph, thematicBreak);
        }
        else if (isKeyboardEvent(event)) {
            const offset = text.length;
            this.setCursor(offset, offset);
            super.enterHandler(event);
        }
    }

    override backspaceHandler(event: Event) {
        const { start, end } = this.getCursor()!;
        if (start.offset === 0 && end.offset === 0) {
            if (this.muya.editor?.documentEditing) {
                changeDocumentRule(this.muya, event, 'reset');
                return;
            }
            event.preventDefault();
            // Remove the text content and convert it to paragraph
            this.text = '';
            this.convertToParagraph();
        }
        else {
            super.backspaceHandler(event);
        }
    }
}

export default ThematicBreakContent;
