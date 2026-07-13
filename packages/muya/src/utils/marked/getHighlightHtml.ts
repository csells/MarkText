import type { CriticMarkupAnalysis } from '../../criticMarkup/analysis';
import type { ILexOption } from './types';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import Prism from 'prismjs';
import {
    criticMarkupParserProfile,
    projectCriticMarkupMarkdown,
} from './criticMarkupDocument';
import cjkEmStrongExtension from './extensions/cjkEmStrong';
import criticMarkupDocumentExtension from './extensions/criticMarkupDocument';
import emojiExtension from './extensions/emoji';
import footnoteExtension from './extensions/footnote';
import mathExtension from './extensions/math';
import superSubScriptExtension from './extensions/superSubscript';
import fm, { frontMatterRender } from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

const DIAGRAM_TYPE = [
    'mermaid',
    'plantuml',
    'vega-lite',
    'flowchart',
    'sequence',
];

function highlight(code: string, lang: string) {
    // Language may be undefined (GH#591)
    if (!lang)
        return code;

    if (DIAGRAM_TYPE.includes(lang))
        return code;

    const grammar = Prism.languages[lang];
    if (!grammar) {
        console.warn(`Unable to find grammar for "${lang}".`);
        return code;
    }
    return Prism.highlight(code, grammar, lang);
}

export function getHighlightHtml(
    src: string,
    options: ILexOption = {},
    preparedAnalysis?: CriticMarkupAnalysis,
) {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const {
        criticMarkup,
        criticMarkupProjection,
        footnote,
        frontMatter,
        math,
        isGitlabCompatibilityEnabled,
        superSubScript,
    } = options;

    // Build a fresh Marked instance per call. `Marked.use({ walkTokens })`
    // chains rather than replaces, so reusing a module-level singleton would
    // cause walkTokens to fire N times after N invocations and corrupt token
    // state (e.g. wiping `lang` on subsequent runs).
    const marked = new Marked(markedHighlight({ highlight }));

    marked.use({
        walkTokens: walkTokens({ math, isGitlabCompatibilityEnabled }),
    });

    // Treat CJK characters as punctuation for emphasis/strong flanking so
    // `中文**"加粗"**中文` bolds (marktext/marktext#4307). Additive override —
    // never regresses spec-conformant Latin emphasis.
    marked.use(cjkEmStrongExtension());

    marked.use(emojiExtension({ isRenderEmoji: true }));

    if (math) {
        marked.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (superSubScript)
        marked.use(superSubScriptExtension());

    if (footnote)
        marked.use(footnoteExtension());

    let html = '';
    const canonicalSource = src;
    let parserSourceOffset = 0;

    // Projection owns the full canonical document. Stripping front matter
    // first would let a body-leading `---` block masquerade as a second
    // document header and hide its CriticMarkup from the real context model.
    if (criticMarkup && criticMarkupProjection !== 'marked') {
        if (preparedAnalysis) {
            if (preparedAnalysis.source !== src) {
                throw new TypeError(
                    'Prepared CriticMarkup analysis belongs to different export Markdown.',
                );
            }
            preparedAnalysis.assertParserProfile(
                criticMarkupParserProfile(options),
            );
            if (preparedAnalysis.hasCandidateOpener)
                preparedAnalysis.assertContextCoverage('complete');
            src = preparedAnalysis.project(
                criticMarkupProjection ?? 'marked',
            );
        }
        else {
            src = projectCriticMarkupMarkdown(
                src,
                criticMarkupProjection ?? 'marked',
                options,
            );
        }
    }

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            html = frontMatterRender(token);
            parserSourceOffset = token.raw.length;
            src = newSrc;
        }
    }

    if (criticMarkup && criticMarkupProjection === 'marked') {
        marked.use(criticMarkupDocumentExtension(src, {
            parserOptions: options,
            analysis: preparedAnalysis,
            ...(parserSourceOffset
                ? {
                        sourceBinding: {
                            source: canonicalSource,
                            parserOffset: parserSourceOffset,
                            literalRanges: [{
                                start: 0,
                                end: parserSourceOffset,
                            }],
                        },
                    }
                : {}),
        }));
    }

    html += marked.parse(src, options);

    return html;
}
