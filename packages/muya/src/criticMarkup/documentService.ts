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
    plainMarkdown,
} from '../state/markdownSourceMap';
import { rebindCriticMarkupStateBindings } from '../state/rebindCriticMarkupStateBindings';
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

/**
 * Single-parse artifact for a revision about to be committed. Every member
 * derives from one native analysis run: `states`, `document.analysis`, and
 * `proofDocument.analysis` share the identical analysis object, so consumers
 * can verify authority by identity instead of reparsing.
 */
export interface ICriticMarkupCommitAnalysis {
    /** Byte-exact analyzed revision; `document.markdown === source`. */
    readonly source: string;
    readonly states: TState[];
    /** Fragment-bearing document valid for stagePrepared/adoptCommitted. */
    readonly document: CriticMarkupDocument;
    /** Semantic-only view for projection proofs; refuses live-path lookups. */
    readonly proofDocument: CriticMarkupDocument;
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
    analyzeForCommit: (
        markdown: string,
    ) => ICriticMarkupCommitAnalysis | null;
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
    private _captureDocument: CriticMarkupDocument | null = null;
    private _captureOptionsKey = '';
    private _captureDraftVersion = -1;
    private _captureContextDocument: CriticMarkupDocument | null = null;
    private _captureContextOptionsKey = '';
    private _captureContextDraftVersion = -1;

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
        if (jsonState.isCapturing) {
            const captureDraftVersion = jsonState.captureDraftVersion;
            if (captureDraftVersion === null) {
                throw new TypeError(
                    'Active state capture has no speculative cache identity.',
                );
            }
            if (
                this._captureDocument
                && this._captureDraftVersion === captureDraftVersion
                && this._captureOptionsKey === parserOptions.key
            ) {
                return this._captureDocument;
            }
            this._captureDocument = this._build(
                jsonState.getLiveState(),
                parserOptions,
            );
            this._captureDraftVersion = captureDraftVersion;
            this._captureOptionsKey = parserOptions.key;
            return this._captureDocument;
        }

        this._captureDocument = null;
        this._captureDraftVersion = -1;
        this._captureOptionsKey = '';
        this._captureContextDocument = null;
        this._captureContextDraftVersion = -1;
        this._captureContextOptionsKey = '';

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
            false,
            true,
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
            const captureDraftVersion = jsonState.captureDraftVersion;
            if (captureDraftVersion === null) {
                throw new TypeError(
                    'Active state capture has no context cache identity.',
                );
            }
            if (
                this._captureContextDocument
                && this._captureContextDraftVersion === captureDraftVersion
                && this._captureContextOptionsKey === parserOptions.key
            ) {
                return this._captureContextDocument;
            }
            this._captureContextDocument = this._parseMapped(
                document.mappedText,
                parserOptions,
                true,
                document.analysis,
            );
            this._captureContextDraftVersion = captureDraftVersion;
            this._captureContextOptionsKey = parserOptions.key;
            return this._captureContextDocument;
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
                const native = this._analyzeSource(
                    mapped.text,
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
                    this._bindingsForMappedState(
                        native,
                        mapped,
                        parserOptions,
                    ),
                );
            },
            analyzeForCommit: markdown => this._analyzeForCommit(
                markdown,
                parserOptions,
            ),
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
        reuseLiveArtifact = false,
    ): CriticMarkupDocument {
        const mapped = this._mappedState(state, parserOptions);
        const parserProfile = criticMarkupParserProfile(parserOptions.lex);
        let parserArtifact = reuseLiveArtifact
            ? this._muya.editor.jsonState.parserArtifactForSource(mapped.text)
            : null;
        if (
            parserArtifact
            && !parserArtifact.analysis.matchesParserProfile(parserProfile)
        ) {
            parserArtifact = null;
        }
        if (!parserArtifact) {
            const analyzed = this._analyzeSource(
                mapped.text,
                parserOptions,
            );
            // A drifted openerless analysis describes the normalized
            // revision, not this one; the mapped parse below stays the
            // authority for the live bytes.
            if (analyzed.analysis && analyzed.source === mapped.text) {
                parserArtifact = Object.freeze({
                    analysis: analyzed.analysis,
                    bindings: this._bindingsForMappedState(
                        analyzed,
                        mapped,
                        parserOptions,
                    ),
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
                parserProfile,
                parserArtifact.analysis.contextCoverage,
                parserArtifact.bindings,
            );
        }

        return this._parseMapped(mapped, parserOptions, includeContext);
    }

    private _analyzeSource(
        source: string,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): ReturnType<typeof analyzeCriticMarkupMarkdownState> {
        const analyzed = analyzeCriticMarkupMarkdownState(source, {
            listIndentation: parserOptions.listIndentation,
            trimUnnecessaryCodeBlockEmptyLines:
                parserOptions.trimUnnecessaryCodeBlockEmptyLines,
            lex: parserOptions.lex,
        });
        // Only an item-bearing revision must be byte-exact: its analysis
        // and bindings anchor to exact offsets. A revision without Critic
        // items has no semantics to bind, so documented serializer
        // normalization drift is not an artifact failure.
        if (analyzed.analysis?.roots.length && analyzed.source !== source) {
            throw new TypeError(
                'State Markdown did not produce a revision-exact native parser artifact.',
            );
        }
        return analyzed;
    }

    private _bindingsForMappedState(
        analyzed: ReturnType<typeof analyzeCriticMarkupMarkdownState>,
        mapped: TTrackedMarkdown,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ) {
        if (analyzed.source !== mapped.text) {
            throw new TypeError(
                'Native CriticMarkup bindings belong to a different source revision.',
            );
        }
        const parserMapped = this._mappedState(
            analyzed.states,
            parserOptions,
        );
        if (parserMapped.text !== analyzed.source) {
            throw new TypeError(
                'Native CriticMarkup bindings do not reproduce their parser revision.',
            );
        }
        return rebindCriticMarkupStateBindings(
            analyzed.bindings,
            parserMapped,
            mapped,
        );
    }

    /**
     * One native parse is the sole analysis authority for a commit revision.
     * Returns null when that parse cannot describe the byte-exact requested
     * revision (openerless coverage or documented no-item normalization
     * drift) so the caller keeps the parser-context path; an item-bearing
     * drift stays a hard artifact failure inside `_analyzeSource`.
     */
    private _analyzeForCommit(
        markdown: string,
        parserOptions: ICriticMarkupParserOptionsSnapshot,
    ): ICriticMarkupCommitAnalysis | null {
        const analyzed = this._analyzeSource(markdown, parserOptions);
        if (
            !analyzed.analysis
            || analyzed.source !== markdown
            || analyzed.analysis.contextCoverage !== 'complete'
        ) {
            return null;
        }
        const mapped = this._mappedState(analyzed.states, parserOptions);
        if (mapped.text !== analyzed.source) {
            throw new TypeError(
                'Committed CriticMarkup states did not serialize to their analyzed revision.',
            );
        }
        const parserProfile = criticMarkupParserProfile(parserOptions.lex);
        return Object.freeze({
            source: analyzed.source,
            states: analyzed.states,
            document: createCriticMarkupDocument(
                analyzed.analysis,
                mapped,
                parserProfile,
                'complete',
                analyzed.bindings,
            ),
            proofDocument: createCriticMarkupDocument(
                analyzed.analysis,
                plainMarkdown(markdown),
                parserProfile,
                'complete',
                'semantic-only',
            ),
        });
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
