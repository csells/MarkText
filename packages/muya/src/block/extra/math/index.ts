import type { Muya } from '../../../muya';
import type { IMathBlockState, IMathMeta } from '../../../state/types';
import type { TBlockPath } from '../../types';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

class MathBlock extends Parent {
    get meta(): Readonly<IMathMeta> {
        return this.readBlockMeta<IMathMeta>();
    }

    static override blockName = 'math-block';

    static create(muya: Muya, state: IMathBlockState) {
        const mathBlock = new MathBlock(muya, state);

        const mathPreview = ScrollPage.loadBlock('math-preview').create(
            muya,
            state,
        );
        const mathContainer = ScrollPage.loadBlock('math-container').create(
            muya,
            state,
        );

        mathBlock.appendAttachment(mathPreview);
        mathBlock.append(mathContainer);

        return mathBlock;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    constructor(muya: Muya, { meta }: IMathBlockState) {
        super(muya);
        this.tagName = 'figure';
        this.initializeBlockMeta(meta);
        this.classList = ['mu-math-block'];
        this.createDomNode();
    }

    queryBlock(path: TBlockPath) {
        return path.length && path[0] === 'text'
            ? this.firstContentInDescendant()
            : this;
    }

    override getState(): IMathBlockState {
        const { meta } = this;
        const text = this.firstContentInDescendant()?.text;

        if (text == null)
            throw new Error('text is null when getState in math block.');

        return this.withStateSourceTrivia({
            name: 'math-block',
            text,
            meta: { ...meta },
        });
    }
}

export default MathBlock;
