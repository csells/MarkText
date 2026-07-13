import type { Muya } from '../muya';
import type { TTrackedMarkdown } from '../state/markdownSourceMap';
import type { TState } from '../state/types';
import type {
    TCriticMarkupParserOptions,
} from '../utils/marked/criticMarkupSourceContext';
import type { CriticMarkupAnalysis } from './analysis';
import type { CriticMarkupDocument } from './document';
import {
    mappedMarkdown,
    markdownStatePath,
} from '../state/markdownSourceMap';
import StateToMarkdown from '../state/stateToMarkdown';
import {
    criticMarkupParserProfile,
    parseCriticMarkupContextDocument,
    parseCriticMarkupDocument,
    snapshotCriticMarkupParserOptions,
} from '../utils/marked/criticMarkupDocument';
import { createCriticMarkupDocument } from './document';
import {
    analyzeCriticMarkupMarkdownState,
    parseCriticMarkupMarkdownState,
} from './markdownState';

interface ICriticMarkupParserOptionsSnapshot {
    readonly key: string;
    readonly listIndentation: Muya['options']['listIndentation'];
    readonly trimUnnecessaryCodeBlockEmptyLines: boolean;
    readonly lex: TCriticMarkupParserOptions;
}

export interface ICriticMarkupDocumentSession {
    getContext: () => CriticMarkupDocument;
    createForState: (state: TState[]) => CriticMarkupDocument;
    createForMapped: (mapped: TTrackedMarkdown) => CriticMarkupDocument;
    createForSource: (markdown: string) => CriticMarkupDocument;
    mapState: (state: TState[]) => TTrackedMarkdown;
    parseState: (markdown: string) => TState[];
    bindAnalysisForState: (
        analysis: CriticMarkupAnalysis,
        state: TState[],
    ) => CriticMarkupDocument;
    stagePrepared: (document: CriticMarkupDocument) => void;
    clearPrepared: () => void;
    adoptCommitted: (document: CriticMarkupDocument) => void;
}

/** One revision-keyed document annotation model shared by commands/renderers. */
export class CriticMarkupDocumentService {
    private _revision = -1;
    private _optionsKey = '';
    private _document: CriticMarkupDocument | null = null;
    private _contextRevision = -1;
    private _contextOptionsKey = '';
    private _contextDocument: CriticMarkupDocument | null = null;
    private _preparedDocument: CriticMarkupDocument | null = null;
    private _preparedOptionsKey = '';
    private _preparedRevision = -1;

    constructor(private readonly _muya: Muya) {}

    get(): CriticMarkupDocument {
        return this._get(this._captureParserOptions());
    }

    private _get(
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): CriticMarkupDocument {
        const { jsonState } = this._muya.editor;
        // Captured Track Changes proposals mutate only an isolated draft, but
        // block handlers may synchronously re-render that draft before the
        // gateway accepts or rejects it. Its offsets must never reuse or
        // replace the durable revision cache.
        if (jsonState.isCapturing)
            return this._build(jsonState.getLiveState(), parserOptions);

        if (
            this._preparedDocument
            && this._preparedOptionsKey === parserOptions.key
            && this._preparedRevision === jsonState.documentVersion
        ) {
            return this._preparedDocument;
        }

        if (
            this._document
            && this._revision === jsonState.documentVersion
            && this._optionsKey === parserOptions.key
        ) {
            return this._document;
        }

        this._document = this._build(
            jsonState.getLiveState(),
            parserOptions,
        );
        this._revision = jsonState.documentVersion;
        this._optionsKey = parserOptions.key;

        return this._document;
    }

    /** Parser context for creating new syntax in a source with no opener yet. */
    getContext(): CriticMarkupDocument {
        return this._getContext(this._captureParserOptions());
    }

    private _getContext(
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): CriticMarkupDocument {
        const { jsonState } = this._muya.editor;
        if (
            !jsonState.isCapturing
            && this._contextDocument
            && this._contextRevision === jsonState.documentVersion
            && this._contextOptionsKey === parserOptions.key
        ) {
            return this._contextDocument;
        }

        const document = this._get(parserOptions);
        // The normal parser already materializes Markdown context whenever a
        // possible Critic opener exists, including malformed syntax. Reuse and
        // cache it so one revision never pays for a second parse or prefilter.
        if (document.analysis.hasCandidateOpener) {
            if (!jsonState.isCapturing) {
                this._contextDocument = document;
                this._contextRevision = jsonState.documentVersion;
                this._contextOptionsKey = parserOptions.key;
            }
            return document;
        }
        if (jsonState.isCapturing) {
            return this._parseMapped(
                document.mappedText,
                parserOptions,
                true,
                document.analysis,
            );
        }

        this._contextDocument = this._parseMapped(
            document.mappedText,
            parserOptions,
            true,
            document.analysis,
        );
        this._contextRevision = jsonState.documentVersion;
        this._contextOptionsKey = parserOptions.key;
        // Complete context is a strict superset of the cheap no-opener display
        // analysis. Promote it so this revision never retains two competing
        // semantic authorities under the same parser profile.
        this._document = this._contextDocument;
        this._revision = jsonState.documentVersion;
        this._optionsKey = parserOptions.key;

        return this._contextDocument;
    }

    beginSession(): ICriticMarkupDocumentSession {
        const parserOptions = this._captureParserOptions();
        const session: ICriticMarkupDocumentSession = {
            getContext: () => this._getContext(parserOptions),
            createForState: state => this._build(
                state,
                parserOptions,
                true,
            ),
            createForMapped: mapped => this._parseMapped(
                mapped,
                parserOptions,
                true,
            ),
            createForSource: markdown => this._parseMapped(mappedMarkdown(
                markdown,
                markdownStatePath(['critic-track-validation', 'text']),
                0,
            ), parserOptions, true),
            mapState: state => this._mappedState(state, parserOptions),
            parseState: markdown => this._parseCanonicalState(
                markdown,
                parserOptions,
            ),
            bindAnalysisForState: (analysis, state) => {
                const mapped = this._mappedState(state, parserOptions);
                const native = this._analyzeMappedState(
                    mapped,
                    parserOptions,
                );
                const parserProfile = criticMarkupParserProfile(
                    parserOptions.lex,
                );
                return createCriticMarkupDocument(
                    analysis,
                    mapped,
                    parserProfile,
                    'complete',
                    native.bindings,
                );
            },
            stagePrepared: document => this._stagePrepared(
                document,
                parserOptions,
            ),
            clearPrepared: () => this._clearPrepared(),
            adoptCommitted: document => this._adoptCommitted(
                document,
                parserOptions,
            ),
        };
        return Object.freeze(session);
    }

    createForState(state: TState[]): CriticMarkupDocument {
        return this._build(state, this._captureParserOptions(), true);
    }

    /** Build a fresh parser document for an exact speculative source string. */
    createForSource(markdown: string): CriticMarkupDocument {
        return this._parseMapped(mappedMarkdown(
            markdown,
            markdownStatePath(['critic-track-validation', 'text']),
            0,
        ), this._captureParserOptions(), true);
    }

    private _captureParserOptions(): ICriticMarkupParserOptionsSnapshot {
        const { options } = this._muya;
        const lex = snapshotCriticMarkupParserOptions({
            footnote: options.footnote,
            math: options.math,
            frontMatter: options.frontMatter,
            superSubScript: options.superSubScript,
            isGitlabCompatibilityEnabled:
                options.isGitlabCompatibilityEnabled,
        });
        const values = Object.freeze({
            listIndentation: options.listIndentation,
            trimUnnecessaryCodeBlockEmptyLines:
                options.trimUnnecessaryCodeBlockEmptyLines,
            lex,
        });
        return Object.freeze({
            ...values,
            key: JSON.stringify(values),
        });
    }

    private _build(
        state: ReturnType<Muya['getState']>,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
        includeContext = false,
    ): CriticMarkupDocument {
        const mapped = this._mappedState(state, parserOptions);
        let parserArtifact = this._muya.editor.jsonState
            .parserArtifactForSource(mapped.text);
        if (!parserArtifact) {
            const analyzed = this._analyzeMappedState(
                mapped,
                parserOptions,
            );
            if (analyzed.analysis) {
                parserArtifact = Object.freeze({
                    analysis: analyzed.analysis,
                    bindings: analyzed.bindings,
                });
            }
        }
        if (
            parserArtifact
            && (
                !includeContext
                || parserArtifact.analysis.contextCoverage === 'complete'
            )
        ) {
            return createCriticMarkupDocument(
                parserArtifact.analysis,
                mapped,
                criticMarkupParserProfile(parserOptions.lex),
                parserArtifact.analysis.contextCoverage,
                parserArtifact.bindings,
            );
        }

        return this._parseMapped(mapped, parserOptions, includeContext);
    }

    private _analyzeMappedState(
        mapped: TTrackedMarkdown,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): ReturnType<typeof analyzeCriticMarkupMarkdownState> {
        const analyzed = analyzeCriticMarkupMarkdownState(mapped.text, {
            listIndentation: parserOptions.listIndentation,
            trimUnnecessaryCodeBlockEmptyLines:
                parserOptions.trimUnnecessaryCodeBlockEmptyLines,
            lex: parserOptions.lex,
        });
        if (analyzed.source !== mapped.text) {
            throw new TypeError(
                'State Markdown did not produce a revision-exact native parser artifact.',
            );
        }
        return analyzed;
    }

    private _mappedState(
        state: ReturnType<Muya['getState']>,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): TTrackedMarkdown {
        return new StateToMarkdown({
            listIndentation: parserOptions.listIndentation,
        }).generateMapped(state);
    }

    /**
     * Lower one canonical tracked source through the native parser/state graph.
     * Serialization may apply documented Markdown normalization, but the
     * analyzer reparses that revision and requires the ordered CriticMarkup
     * semantic forest to remain identical. A mismatch throws; parser residue
     * remains reserved for Marked's explicit resource-limit output.
     */
    private _parseCanonicalState(
        markdown: string,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): TState[] {
        return parseCriticMarkupMarkdownState(markdown, {
            listIndentation: parserOptions.listIndentation,
            trimUnnecessaryCodeBlockEmptyLines:
                parserOptions.trimUnnecessaryCodeBlockEmptyLines,
            lex: parserOptions.lex,
        });
    }

    private _adoptCommitted(
        document: CriticMarkupDocument,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): void {
        const { jsonState } = this._muya.editor;
        if (jsonState.isCapturing) {
            throw new TypeError(
                'Cannot adopt a CriticMarkup analysis while state capture is active.',
            );
        }
        const live = this._mappedState(jsonState.getLiveState(), parserOptions);
        if (live.text !== document.markdown) {
            throw new TypeError(
                'Committed CriticMarkup analysis belongs to different live Markdown.',
            );
        }
        document.analysis.assertParserProfile(
            criticMarkupParserProfile(parserOptions.lex),
        );
        document.analysis.assertContextCoverage('complete');
        this._document = document;
        this._contextDocument = document;
        this._revision = jsonState.documentVersion;
        this._contextRevision = jsonState.documentVersion;
        this._optionsKey = parserOptions.key;
        this._contextOptionsKey = parserOptions.key;
        this._clearPrepared();
    }

    private _stagePrepared(
        document: CriticMarkupDocument,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): void {
        if (this._preparedDocument) {
            throw new TypeError(
                'A CriticMarkup document is already staged for commit.',
            );
        }
        document.analysis.assertParserProfile(
            criticMarkupParserProfile(parserOptions.lex),
        );
        document.analysis.assertContextCoverage('complete');
        this._preparedDocument = document;
        this._preparedOptionsKey = parserOptions.key;
        this._preparedRevision
            = this._muya.editor.jsonState.documentVersion + 1;
    }

    private _clearPrepared(): void {
        this._preparedDocument = null;
        this._preparedOptionsKey = '';
        this._preparedRevision = -1;
    }

    private _parseMapped(
        mapped: TTrackedMarkdown,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
        includeContext = false,
        candidateAnalysis?: CriticMarkupAnalysis,
    ): CriticMarkupDocument {
        return includeContext
            ? parseCriticMarkupContextDocument(
                    mapped,
                    parserOptions.lex,
                    candidateAnalysis,
                )
            : parseCriticMarkupDocument(mapped, parserOptions.lex);
    }
}
