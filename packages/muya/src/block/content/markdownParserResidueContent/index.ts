import type { Muya } from '../../../muya';
import type { IRenderCursor } from '../../../selection/types';
import type { IMarkdownParserResidueState } from '../../../state/types';
import Content from '../../base/content';

class MarkdownParserResidueContent extends Content {
    static override blockName = 'markdown-parser-residue.content';

    static create(muya: Muya, state: IMarkdownParserResidueState) {
        return new MarkdownParserResidueContent(muya, state.text);
    }

    constructor(muya: Muya, text: string) {
        super(muya, text);
        this.classList = [
            ...this.classList,
            'mu-markdown-parser-residue-content',
        ];
        this.createDomNode();
    }

    override getAnchor() {
        return this.parent;
    }

    override update(_cursor?: IRenderCursor): void {
        this.domNode!.textContent = this.text;
    }

    override inputHandler(): void {
        if (this.isComposed)
            return;
        const cursor = this.getCursor();
        this.text = this.domNode!.textContent ?? '';
        this.muya.eventCenter.emit('content-change', { block: this });
        if (cursor) {
            const start = Math.min(cursor.start.offset, this.text.length);
            const end = Math.min(cursor.end.offset, this.text.length);
            this.setCursor(start, end, true);
        }
    }

    override enterHandler(event: KeyboardEvent): void {
        const cursor = this.getCursor();
        if (!cursor)
            return;
        event.preventDefault();
        const { start, end } = cursor;
        this.text = `${this.text.slice(0, start.offset)}\n${
            this.text.slice(end.offset)}`;
        const offset = start.offset + 1;
        this.setCursor(offset, offset, true);
        this.muya.eventCenter.emit('content-change', { block: this });
    }

    override tabHandler(event: KeyboardEvent): void {
        event.preventDefault();
        this.insertTab();
    }
}

export default MarkdownParserResidueContent;
