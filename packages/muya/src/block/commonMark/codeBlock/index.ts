import type { Muya } from '../../../muya';
import type { ICodeBlockState } from '../../../state/types';
import type { TBlockPath } from '../../types';
import diff from 'fast-diff';
import { diffToTextOp, firstWordOfInfo } from '../../../utils';
import { operateClassName } from '../../../utils/dom';
import logger from '../../../utils/logger';
import { loadLanguage } from '../../../utils/prism';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

const debug = logger('codeblock:');

class CodeBlock extends Parent {
    get meta(): Readonly<ICodeBlockState['meta']> {
        return this.readBlockMeta<ICodeBlockState['meta']>();
    }

    static override blockName = 'code-block';

    static create(muya: Muya, state: ICodeBlockState) {
        const codeBlock = new CodeBlock(muya, state);
        const { lang } = state.meta;

        const langInput = ScrollPage.loadBlock('language-input').create(
            muya,
            state,
        );
        const code = ScrollPage.loadBlock('code').create(muya, state);

        codeBlock.append(langInput);
        codeBlock.append(code);

        // Move the line-numbers gutter from .mu-code into the pre so that
        // .mu-code's overflow (hidden/auto) does not clip the left-side gutter.
        // The pre already has position:relative and padding-left:2.5em for this.
        const lnWrapper = (code as { lineNumbersWrapper?: HTMLElement | null }).lineNumbersWrapper;
        if (lnWrapper) {
            codeBlock.domNode!.appendChild(lnWrapper);
            // The gutter fills from CodeBlockContent.update(), a no-op until the
            // tree is wired. The language-load callback below re-runs it, but
            // language-less / unknown-language / indented blocks never load one —
            // seed them here so first render fills the gutter regardless of language.
            requestAnimationFrame(() => {
                codeBlock.lastContentInDescendant()?.update();
            });
        }

        if (lang) {
            requestAnimationFrame(() => {
                // Parsed state already owns the canonical language. Initial
                // construction only needs to load Prism and refresh the code
                // presentation; sending this through the mutation gateway
                // would turn rendering a clean/revised projection into an
                // attempted document edit.
                codeBlock._refreshLanguage(lang);
            });
        }

        return codeBlock;
    }

    get lang() {
        return this.meta.lang;
    }

    set lang(value) {
        // `lang` is a public document-editing surface (plugins and tests use it
        // directly), so it must obey the same Direct/Tracked/ReadOnly policy as
        // toolbar and keyboard commands. Calls made from LangInputContent or
        // the language selector join their already-running gateway operation.
        this.muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => this._setLanguage(value),
        );
    }

    private _setLanguage(value: string) {
        this.assertMutationAuthorized('Code-block language mutation');
        const languageInput = this.firstChild;
        if (
            !languageInput
            || !languageInput.isContent()
            || languageInput.blockName !== 'language-input'
        ) {
            throw new TypeError(
                'A code block language mutation requires its language-input child.',
            );
        }

        // The language input's Content.text setter is the canonical producer
        // of the `meta.lang` JSON operation. When this setter is nested under a
        // language-input edit or selector command, its text already equals the
        // requested value, so no duplicate operation is emitted. A direct
        // external assignment updates that child here and therefore persists
        // the same single canonical operation.
        if (languageInput.text !== value) {
            languageInput.text = value;
            languageInput.update();
        }
        let nextMeta = { ...this.meta, lang: value };

        if (this.meta.type !== 'fenced') {
            nextMeta = { ...nextMeta, type: 'fenced' };
            // dispatch change to modify json state
            const diffs = diff('indented', 'fenced');
            const { path } = this;
            path.push('meta', 'type');

            this.jsonState.editOperation(path, diffToTextOp(diffs));

            operateClassName(this.domNode!, 'remove', 'mu-indented-code');
            operateClassName(this.domNode!, 'add', 'mu-fenced-code');
        }
        this.replaceBlockMetaForDocumentEdit(
            nextMeta,
            'Code-block metadata mutation',
        );

        this._refreshLanguage(value);
    }

    /** Apply JSONState's already-committed language mirror. */
    applyLanguageFromState(value: string): void {
        this.replaceBlockMetaFromPreparedState(
            { ...this.meta, lang: value },
            'Prepared code-block language application',
        );
    }

    /** Apply JSONState's already-committed block type. */
    applyTypeFromState(value: string): void {
        this.replaceBlockMetaFromPreparedState(
            { ...this.meta, type: value },
            'Prepared code-block type application',
        );
    }

    private _refreshLanguage(value: string) {
        // `value` is the full info string; load Prism for its first word only.
        const language = firstWordOfInfo(value);
        !!language
        && loadLanguage(language)
            .then((infoList) => {
                if (!Array.isArray(infoList))
                    return;
                // There are three status `loaded`, `noexist` and `cached`.
                // if the status is `loaded`, indicated that it's a new loaded language
                const needRender = infoList.some(
                    ({ status }) => status === 'loaded' || status === 'cached',
                );
                if (needRender)
                    this.lastContentInDescendant()?.update();
            })
            .catch((err) => {
                // if no parameter provided, will cause error.
                debug.warn(err);
            });
    }

    override get path(): TBlockPath {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    constructor(muya: Muya, { meta }: ICodeBlockState) {
        super(muya);
        this.tagName = 'pre';
        this.initializeBlockMeta(meta);
        this.classList = ['mu-code-block', `mu-${meta.type}-code`];
        if (muya.options.codeBlockLineNumbers)
            this.classList.push('mu-line-numbers');
        this.createDomNode();
    }

    queryBlock(path: TBlockPath) {
        if (path.length === 0) {
            return this;
        }
        else {
            if (path[0] === 'meta' || path[0] === 'type')
                return this;
            else if (path[0] === 'lang')
                return this.firstContentInDescendant();
            else
                return this.lastContentInDescendant();
        }
    }

    override getState(): ICodeBlockState {
        const state: ICodeBlockState = {
            name: 'code-block',
            meta: { ...this.meta },
            text: this.lastContentInDescendant()!.text,
        };

        return this.withStateSourceTrivia(state);
    }
}

export default CodeBlock;
