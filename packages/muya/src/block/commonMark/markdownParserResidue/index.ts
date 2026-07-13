import type { Muya } from '../../../muya';
import type { IMarkdownParserResidueState } from '../../../state/types';
import type MarkdownParserResidueContent from '../../content/markdownParserResidueContent';
import { mixins } from '../../../utils';
import Parent from '../../base/parent';
import LeafQueryBlock from '../../mixins/leafQueryBlock';
import { ScrollPage } from '../../scrollPage';

@mixins(LeafQueryBlock)
class MarkdownParserResidue extends Parent {
    static override blockName = 'markdown-parser-residue';

    private readonly _diagnostic: IMarkdownParserResidueState['meta'];

    static create(muya: Muya, state: IMarkdownParserResidueState) {
        const residue = new MarkdownParserResidue(muya, state);
        residue.append(
            ScrollPage.loadBlock('markdown-parser-residue.content')
                .create(muya, state),
        );
        return residue;
    }

    constructor(muya: Muya, state: IMarkdownParserResidueState) {
        super(muya);
        this._diagnostic = state.meta;
        const diagnostic = state.meta.parserDiagnostic;
        this.tagName = 'pre';
        this.classList = ['mu-markdown-parser-residue'];
        this.attributes = {
            'data-markdown-diagnostic': diagnostic.code,
            'role': 'note',
            'title': diagnostic.message,
            ...('depth' in diagnostic
                ? {
                        'data-markdown-depth': String(diagnostic.depth),
                        'data-markdown-depth-limit': String(diagnostic.limit),
                    }
                : {}),
        };
        this.createDomNode();
    }

    override get path() {
        const { path } = this.parent!;
        return [...path, this.parent!.offset(this)];
    }

    override getState(): IMarkdownParserResidueState {
        return this.withStateSourceTrivia({
            name: 'markdown-parser-residue',
            text: (this.children.head as MarkdownParserResidueContent).text,
            meta: this._diagnostic,
        });
    }
}

export default MarkdownParserResidue;
