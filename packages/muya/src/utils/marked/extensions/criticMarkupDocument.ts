import type {
    MarkedExtension,
    Token,
    TokenizerAndRendererExtension,
    Tokens,
} from 'marked';
import type { CriticMarkupAnalysis } from '../../../criticMarkup/analysis';
import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentFragmentInput,
    ICriticMarkupDocumentItem,
    TCriticMarkupDocumentToken,
    TCriticMarkupFragmentArm,
    TCriticMarkupFragmentRole,
} from '../../../criticMarkup/document';
import type {
    ICriticMarkupRenderFragment,
    ICriticMarkupRenderItem,
    ICriticMarkupRenderNode,
    ICriticMarkupRenderSequence,
} from '../../../criticMarkup/renderPlan';
import type { ICriticMarkupRenderLimitDiagnostic } from '../../../criticMarkup/renderPolicy';
import type {
    ICriticMarkupContextSourceBinding,
    ICriticMarkupInlineLeaf,
    ICriticMarkupLocatedInlineToken,
    ICriticMarkupPlainTextProjection,
    TMarkedParserPath,
} from '../locatedMarkdown';
import type { ILexOption } from '../types';
import {
    createMarkedProvenanceBinding,
    Lexer,
    markedDocumentOffset,
    MarkedSourceDocument,
    MarkedSourceView,
} from 'marked';
import { ExcludedRanges } from '../../../criticMarkup/excludedRanges';
import {
    buildCriticMarkupRenderPlan,
} from '../../../criticMarkup/renderPlan';
import { HalfOpenIntervalIndex, upperBound } from '../../../mapped-range';
import { sourceRange } from '../../../mappedText';
import {
    parseCriticMarkupDocumentFromContext,
    prepareCriticMarkupDocumentContext,
    prepareCriticMarkupSourceContext,
    snapshotCriticMarkupParserOptions,
} from '../criticMarkupDocument';
import {
    createCriticMarkupSessionHooks,
    createNoCandidateCriticMarkupHooks,
} from '../criticMarkupParseSession';
import {
    analyzeCriticMarkupContext,
} from '../locatedMarkdown';

interface ICriticMarkupDocumentFragmentToken extends Tokens.Generic {
    type: 'criticMarkupDocumentFragment';
    raw: string;
    itemId: string;
    parentId: string | null;
    depth: number;
    role: TCriticMarkupFragmentRole;
    criticType: TCriticMarkupDocumentToken['type'];
    critic: TCriticMarkupDocumentToken;
    fragment: ICriticMarkupRenderFragment;
    tokens: Token[];
    oldTokens: Token[];
    newTokens: Token[];
    hasContent: boolean;
    hasOld: boolean;
    hasNew: boolean;
}

interface ICriticMarkupRenderLimitToken extends Tokens.Generic {
    type: 'criticMarkupRenderLimit';
    raw: string;
    item: ICriticMarkupRenderItem;
    diagnostic: ICriticMarkupRenderLimitDiagnostic;
}

interface ICriticMarkupDocumentOptions {
    parserOptions?: ILexOption;
    sourceBinding?: ICriticMarkupContextSourceBinding;
    analysis?: CriticMarkupAnalysis;
}

function validateProvenanceInput(
    source: string,
    sourceContext: ReturnType<typeof prepareCriticMarkupSourceContext>,
    binding?: ICriticMarkupContextSourceBinding,
): void {
    if (!binding)
        return;
    if (binding.source !== sourceContext.source) {
        throw new TypeError(
            'CriticMarkup parser binding belongs to another canonical source.',
        );
    }
    ExcludedRanges.from(binding.source.length, binding.literalRanges);

    if (binding.parserMappings === undefined) {
        const start = binding.parserOffset ?? 0;
        const end = start + source.length;
        if (
            !Number.isInteger(start)
            || start < 0
            || end > binding.source.length
            || binding.source.slice(start, end) !== source
        ) {
            throw new RangeError(
                'CriticMarkup parser slice is outside or differs from its canonical source.',
            );
        }
        return;
    }

    let parserOffset = 0;
    let sourceBoundary = 0;
    for (const mapping of binding.parserMappings) {
        if (
            !Number.isInteger(mapping.parserStart)
            || !Number.isInteger(mapping.parserEnd)
            || !Number.isInteger(mapping.sourceStart)
            || !Number.isInteger(mapping.sourceEnd)
            || mapping.parserStart < parserOffset
            || mapping.parserEnd < mapping.parserStart
            || mapping.parserEnd > source.length
            || mapping.sourceStart < sourceBoundary
            || mapping.sourceEnd < mapping.sourceStart
            || mapping.sourceEnd > binding.source.length
            || mapping.parserEnd - mapping.parserStart
            !== mapping.sourceEnd - mapping.sourceStart
            || binding.source.slice(mapping.sourceStart, mapping.sourceEnd)
            !== source.slice(mapping.parserStart, mapping.parserEnd)
        ) {
            throw new RangeError(
                'CriticMarkup parser provenance mapping is invalid.',
            );
        }
        parserOffset = mapping.parserEnd;
        sourceBoundary = mapping.sourceEnd;
    }
}

function provenanceInput(
    source: string,
    sourceContext: ReturnType<typeof prepareCriticMarkupSourceContext>,
    binding?: ICriticMarkupContextSourceBinding,
): MarkedSourceView<ReturnType<typeof prepareCriticMarkupSourceContext>> {
    validateProvenanceInput(source, sourceContext, binding);
    const document = new MarkedSourceDocument(
        sourceContext,
        sourceContext.source,
    );
    if (!binding)
        return document.identity();

    if (binding.parserMappings === undefined) {
        const start = binding.parserOffset ?? 0;
        const end = start + source.length;
        const view = document.slice(
            markedDocumentOffset(start),
            markedDocumentOffset(end),
        );
        if (view.text !== source) {
            throw new TypeError(
                'CriticMarkup parser slice differs from its canonical source.',
            );
        }
        return view;
    }

    const parts: MarkedSourceView<
        ReturnType<typeof prepareCriticMarkupSourceContext>
    >[] = [];
    let parserOffset = 0;
    let sourceBoundary = 0;
    for (const mapping of binding.parserMappings) {
        if (parserOffset < mapping.parserStart) {
            parts.push(document.generated(
                source.slice(parserOffset, mapping.parserStart),
                markedDocumentOffset(mapping.sourceStart),
            ));
        }
        const mapped = document.slice(
            markedDocumentOffset(mapping.sourceStart),
            markedDocumentOffset(mapping.sourceEnd),
        );
        if (
            mapped.text
            !== source.slice(mapping.parserStart, mapping.parserEnd)
        ) {
            throw new TypeError(
                'CriticMarkup parser mapping differs from canonical bytes.',
            );
        }
        parts.push(mapped);
        parserOffset = mapping.parserEnd;
        sourceBoundary = mapping.sourceEnd;
    }
    if (parserOffset < source.length) {
        parts.push(document.generated(
            source.slice(parserOffset),
            markedDocumentOffset(sourceBoundary),
        ));
    }
    const view = MarkedSourceView.concat(parts, document);
    if (view.text !== source) {
        throw new TypeError(
            'CriticMarkup mapped parser input differs from its source.',
        );
    }
    return view;
}

function escapeAttribute(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case '\'': return '&#39;';
            default: return character;
        }
    });
}

function fragmentAttributes(token: ICriticMarkupDocumentFragmentToken): string {
    return [
        `data-critic-id="${escapeAttribute(token.itemId)}"`,
        `data-critic-role="${token.role}"`,
        `data-critic-type="${token.criticType}"`,
        `data-start="${token.critic.range.start}"`,
        `data-end="${token.critic.range.end}"`,
    ].join(' ');
}

function firstProjectionEndingAfter(
    projections: readonly ICriticMarkupPlainTextProjection[],
    offset: number,
): number {
    return upperBound(projections, offset, projection =>
        projection.localRange.end);
}

function sourceProjectionContains(
    projections: readonly ICriticMarkupPlainTextProjection[],
    item: ICriticMarkupDocumentItem<TMarkedParserPath>,
): boolean {
    const first = upperBound(
        projections,
        item.syntax.range.start,
        projection => projection.sourceRange.end,
    );
    const range = projections[first]?.sourceRange;
    return !!range
        && range.start <= item.syntax.range.start
        && item.syntax.range.end <= range.end;
}

type TCriticMarkupRenderNode = ICriticMarkupRenderNode;

interface ILocatedTokenContainer {
    readonly located: ICriticMarkupLocatedInlineToken;
    readonly parent: ILocatedTokenContainer | null;
    readonly children: ILocatedTokenContainer[];
    readonly start: number;
    readonly end: number;
    readonly depth: number;
}

interface IRenderSequencePartition {
    readonly direct: Map<Token | null, TCriticMarkupRenderNode[]>;
    readonly affectedContainers: Set<Token>;
}

function appendValues<T>(target: T[], values: readonly T[]): void {
    for (const value of values)
        target.push(value);
}

class CriticMarkupLeafTokenBuilder {
    private readonly _renderPlan;
    private readonly _projections;
    private readonly _builtTokens = new Map<
        ICriticMarkupRenderFragment,
        ICriticMarkupDocumentFragmentToken
    >();

    private readonly _loweredContainers = new Set<Token>();
    private readonly _rootContainers: ILocatedTokenContainer[] = [];
    private readonly _containerIndex: HalfOpenIntervalIndex<ILocatedTokenContainer>;
    private readonly _sequencePartitions = new WeakMap<
        ICriticMarkupRenderSequence,
        IRenderSequencePartition
    >();

    constructor(
        private readonly _leaf: ICriticMarkupInlineLeaf,
        inputs: readonly ICriticMarkupDocumentFragmentInput<TMarkedParserPath>[],
        private readonly _inlineLexer: Lexer,
        private readonly _document: CriticMarkupDocument<TMarkedParserPath>,
    ) {
        this._renderPlan = buildCriticMarkupRenderPlan(inputs);
        this._projections = [..._leaf.plainTextProjections].sort((left, right) =>
            left.localRange.start - right.localRange.start
            || left.localRange.end - right.localRange.end);
        const containers: ILocatedTokenContainer[] = [];
        const collect = (
            nodes: readonly ICriticMarkupLocatedInlineToken[],
            parent: ILocatedTokenContainer | null,
        ): ILocatedTokenContainer[] => {
            const result: ILocatedTokenContainer[] = [];
            for (const located of nodes) {
                if (!located.children.length)
                    continue;
                const container: ILocatedTokenContainer = {
                    located,
                    parent,
                    children: [],
                    start: located.children[0].localRange.start,
                    end: located.children.at(-1)!.localRange.end,
                    depth: (parent?.depth ?? -1) + 1,
                };
                appendValues(
                    container.children,
                    collect(located.children, container),
                );
                result.push(container);
                containers.push(container);
            }
            return result;
        };
        appendValues(
            this._rootContainers,
            collect(_leaf.locatedTokens, null),
        );
        this._containerIndex = new HalfOpenIntervalIndex(containers.map(container => ({
            start: container.start,
            end: container.end,
            value: container,
        })));
    }

    build(): Token[] {
        for (const renderNode of this._renderPlan.postorder)
            this._buildSemanticToken(renderNode);

        return this._tokensForRange(
            0,
            this._leaf.text.length,
            this._renderPlan.roots,
        );
    }

    private _projectedPlainText(start: number, end: number): string {
        const parts: string[] = [];
        let cursor = start;
        for (
            let index = firstProjectionEndingAfter(this._projections, start);
            index < this._projections.length;
            index++
        ) {
            const target = this._projections[index];
            if (end <= target.localRange.start)
                break;
            if (
                target.localRange.start < start
                || end < target.localRange.end
            ) {
                throw new RangeError(
                    'CriticMarkup fragment splits a plain-text projection range.',
                );
            }
            parts.push(this._leaf.text.slice(cursor, target.localRange.start));
            parts.push(this._document.projectSourceRange(
                sourceRange(
                    target.sourceRange.start,
                    target.sourceRange.end,
                ),
                'revised',
            ));
            cursor = target.localRange.end;
        }
        parts.push(this._leaf.text.slice(cursor, end));
        return parts.join('');
    }

    private _projectionIntersects(start: number, end: number): boolean {
        const projection = this._projections[firstProjectionEndingAfter(
            this._projections,
            start,
        )];
        return !!projection && projection.localRange.start < end;
    }

    private _lexPlain(start: number, end: number): Token[] {
        return start < end
            ? this._inlineLexer.inlineTokens(this._projectedPlainText(start, end), [])
            : [];
    }

    private _firstLocatedTokenEndingAfter(
        nodes: readonly ICriticMarkupLocatedInlineToken[],
        offset: number,
    ): number {
        return upperBound(nodes, offset, node => node.localRange.end);
    }

    private _nativeTokensForRange(
        start: number,
        end: number,
        nodes: readonly ICriticMarkupLocatedInlineToken[],
    ): Token[] {
        const result: Token[] = [];
        let cursor = start;
        for (
            let index = this._firstLocatedTokenEndingAfter(nodes, start);
            index < nodes.length;
            index++
        ) {
            const node = nodes[index];
            if (end <= node.localRange.start)
                break;
            const nodeStart = Math.max(start, node.localRange.start);
            const nodeEnd = Math.min(end, node.localRange.end);
            if (cursor < nodeStart)
                appendValues(result, this._lexPlain(cursor, nodeStart));

            const wholeNode = nodeStart === node.localRange.start
                && nodeEnd === node.localRange.end;
            if (
                wholeNode
                && (
                    this._loweredContainers.has(node.token)
                    || !this._projectionIntersects(nodeStart, nodeEnd)
                )
            ) {
                result.push(node.token);
            }
            else {
                appendValues(result, this._lexPlain(nodeStart, nodeEnd));
            }
            cursor = nodeEnd;
        }
        if (cursor < end)
            appendValues(result, this._lexPlain(cursor, end));
        return result;
    }

    private _tokensForRange(
        start: number,
        end: number,
        sequence: ICriticMarkupRenderSequence,
        owner: ILocatedTokenContainer | null = null,
        partition = this._partitionSequence(sequence),
    ): Token[] {
        const containers = owner?.children ?? this._rootContainers;
        for (const container of containers) {
            if (!partition.affectedContainers.has(container.located.token))
                continue;
            const token = container.located.token as Tokens.Generic & {
                tokens?: Token[];
            };
            token.tokens = this._tokensForRange(
                container.start,
                container.end,
                sequence,
                container,
                partition,
            );
            this._loweredContainers.add(container.located.token);
        }

        const direct = partition.direct.get(owner?.located.token ?? null) ?? [];
        const locatedTokens = owner?.located.children ?? this._leaf.locatedTokens;
        const result: Token[] = [];
        let cursor = start;

        for (const renderNode of direct) {
            const { item, fragment } = renderNode;
            if (end <= fragment.localRange.start)
                break;
            if (
                fragment.localRange.start < start
                || end < fragment.localRange.end
            ) {
                throw new RangeError(
                    `CriticMarkup fragment ${item.id} crosses its semantic arm.`,
                );
            }
            if (fragment.localRange.start < cursor) {
                throw new RangeError(
                    `CriticMarkup sibling fragments overlap at ${fragment.localRange.start}.`,
                );
            }

            appendValues(result, this._nativeTokensForRange(
                cursor,
                fragment.localRange.start,
                locatedTokens,
            ));
            if (renderNode.presentation === 'literal-depth-limit') {
                const raw = this._leaf.text.slice(
                    fragment.localRange.start,
                    fragment.localRange.end,
                );
                const limitToken: ICriticMarkupRenderLimitToken = {
                    type: 'criticMarkupRenderLimit',
                    raw,
                    item,
                    diagnostic: renderNode.diagnostic!,
                };
                result.push(limitToken);
            }
            else {
                const token = this._builtTokens.get(fragment);
                if (!token) {
                    throw new TypeError(
                        `CriticMarkup fragment ${item.id} was not built after its descendants.`,
                    );
                }
                result.push(token);
            }
            cursor = fragment.localRange.end;
        }

        appendValues(
            result,
            this._nativeTokensForRange(cursor, end, locatedTokens),
        );
        return result;
    }

    private _partitionSequence(
        sequence: ICriticMarkupRenderSequence,
    ): IRenderSequencePartition {
        const cached = this._sequencePartitions.get(sequence);
        if (cached)
            return cached;

        const direct = new Map<Token | null, TCriticMarkupRenderNode[]>();
        const affectedContainers = new Set<Token>();
        for (const node of sequence.nodes) {
            const containers = this._containerIndex.containingRange(
                node.fragment.localRange.start,
                node.fragment.localRange.end,
            );
            let owner: ILocatedTokenContainer | null = null;
            for (const container of containers) {
                if (!owner || owner.depth < container.depth)
                    owner = container;
            }
            const key = owner?.located.token ?? null;
            const nodes = direct.get(key) ?? [];
            nodes.push(node);
            direct.set(key, nodes);
            for (let container = owner; container; container = container.parent)
                affectedContainers.add(container.located.token);
        }
        const partition = { direct, affectedContainers };
        this._sequencePartitions.set(sequence, partition);
        return partition;
    }

    private _buildSemanticToken(
        renderNode: ICriticMarkupRenderNode,
    ): void {
        const { item, fragment } = renderNode;
        if (renderNode.presentation === 'literal-depth-limit')
            return;

        const byArm: Record<
            TCriticMarkupFragmentArm,
            Token[]
        > = {
            content: [],
            comment: [],
            old: [],
            new: [],
        };
        let hasOld = false;
        let hasNew = false;
        for (const segment of renderNode.segments) {
            if (segment.kind !== 'content')
                continue;
            if (segment.arm === 'old')
                hasOld = true;
            if (segment.arm === 'new')
                hasNew = true;
            appendValues(byArm[segment.arm], this._tokensForRange(
                segment.localRange.start,
                segment.localRange.end,
                segment.children,
            ));
        }
        const contentTokens = [
            ...byArm.content,
            ...byArm.comment,
        ];
        this._builtTokens.set(fragment, {
            type: 'criticMarkupDocumentFragment',
            raw: this._leaf.text.slice(
                fragment.localRange.start,
                fragment.localRange.end,
            ),
            itemId: item.id,
            parentId: item.parentId,
            depth: item.depth,
            role: fragment.role,
            criticType: item.syntax.type,
            critic: item.syntax,
            fragment,
            tokens: contentTokens,
            oldTokens: byArm.old,
            newTokens: byArm.new,
            hasContent: contentTokens.length > 0,
            hasOld,
            hasNew,
        });
    }
}

function buildLeafTokens(
    leaf: ICriticMarkupInlineLeaf,
    inputs: readonly ICriticMarkupDocumentFragmentInput<TMarkedParserPath>[],
    inlineLexer: Lexer,
    document: CriticMarkupDocument<TMarkedParserPath>,
): Token[] {
    return new CriticMarkupLeafTokenBuilder(
        leaf,
        inputs,
        inlineLexer,
        document,
    ).build();
}

/**
 * Replace every CriticMarkup item with linked inline AST fragments after the
 * native Markdown parser has established block, code, link, HTML, and math
 * contexts. A block boundary changes only a fragment's role.
 */
export default function criticMarkupDocumentExtension(
    source: string,
    options: ICriticMarkupDocumentOptions = {},
): MarkedExtension {
    const parserOptions = snapshotCriticMarkupParserOptions(
        options.parserOptions ?? {},
    );
    const canonicalSource = options.sourceBinding?.source ?? source;
    if (
        options.sourceBinding
        && (
            options.sourceBinding.parserMappings !== undefined
            || (
                options.sourceBinding.parserOffset ?? 0
            ) + source.length < options.sourceBinding.source.length
        )
        && !options.analysis
    ) {
        throw new TypeError(
            'A partial canonical Markdown binding requires prepared CriticMarkup analysis.',
        );
    }
    const sourceContext = prepareCriticMarkupSourceContext(
        canonicalSource,
        parserOptions,
        options.analysis,
    );
    validateProvenanceInput(source, sourceContext, options.sourceBinding);
    if (!sourceContext.hasCandidateOpener) {
        return {
            breaks: parserOptions.breaks,
            gfm: parserOptions.gfm,
            maxBlockNesting: parserOptions.maxBlockNesting,
            pedantic: parserOptions.pedantic,
            hooks: createNoCandidateCriticMarkupHooks(
                sourceContext,
                source,
            ),
        };
    }
    const provenance = createMarkedProvenanceBinding(provenanceInput(
        source,
        sourceContext,
        options.sourceBinding,
    ));
    const hooks = createCriticMarkupSessionHooks(
        sourceContext,
        source,
        provenance,
        (session, tokenList, markedOptions) => {
            if (!session.hasCandidateOpener)
                return tokenList;

            const analysis = analyzeCriticMarkupContext(
                session,
                session.level,
                options.sourceBinding,
            );
            const preparedContext = prepareCriticMarkupDocumentContext(
                analysis,
            );
            const document = parseCriticMarkupDocumentFromContext(
                preparedContext,
            );
            if (!document.items.length)
                return tokenList;

            const inlineLexer = new Lexer(markedOptions);
            inlineLexer.tokens.links = tokenList.links;
            for (const leaf of analysis.inlineLeaves) {
                const inputs = document.fragmentsForPath(
                    leaf.path,
                );
                const sourceProjections = [
                    ...leaf.plainTextProjections,
                ].sort((left, right) =>
                    left.sourceRange.start - right.sourceRange.start
                    || left.sourceRange.end - right.sourceRange.end);
                const semanticInputs: ICriticMarkupDocumentFragmentInput<
                    TMarkedParserPath
                >[] = [];
                for (const input of inputs) {
                    if (!sourceProjectionContains(
                        sourceProjections,
                        input.item,
                    )) {
                        semanticInputs.push(input);
                    }
                }
                if (
                    semanticInputs.length
                    || leaf.plainTextProjections.length
                ) {
                    leaf.replaceTokens(buildLeafTokens(
                        leaf,
                        semanticInputs,
                        inlineLexer,
                        document,
                    ));
                }
            }

            return tokenList;
        },
    );
    const extensions: TokenizerAndRendererExtension[] = [];
    extensions.push(
        {
            name: 'criticMarkupRenderLimit',
            level: 'inline',
            tokenizer() {},
            renderer(token) {
                const limit = token as ICriticMarkupRenderLimitToken;
                return `<span class="critic critic-render-limit" data-critic-diagnostic="${limit.diagnostic.code}" role="note" title="${escapeAttribute(limit.diagnostic.message)}">${escapeAttribute(limit.raw)}</span>`;
            },
        },
        {
            name: 'criticMarkupDocumentFragment',
            level: 'inline',
            childTokens: ['tokens', 'oldTokens', 'newTokens'],
            tokenizer() {},
            renderer(token) {
                const fragment
                    = token as ICriticMarkupDocumentFragmentToken;
                const { parser } = this;
                const render = (children: Token[]) =>
                    parser.parseInline(children);
                const attributes = fragmentAttributes(fragment);

                switch (fragment.criticType) {
                    case 'addition':
                        return `<ins class="critic critic-addition" ${attributes}>${render(fragment.tokens)}</ins>`;
                    case 'deletion':
                        return `<del class="critic critic-deletion" ${attributes}>${render(fragment.tokens)}</del>`;
                    case 'substitution': {
                        const oldHtml = fragment.hasOld
                            ? `<del>${render(fragment.oldTokens)}</del>`
                            : '';
                        const newHtml = fragment.hasNew
                            ? `<ins>${render(fragment.newTokens)}</ins>`
                            : '';
                        return `<span class="critic critic-substitution" ${attributes}>${oldHtml}${newHtml}</span>`;
                    }
                    case 'highlight':
                        return `<mark class="critic critic-highlight" ${attributes}>${render(fragment.tokens)}</mark>`;
                    case 'comment': {
                        const title = fragment.critic.type === 'comment'
                            ? fragment.critic.semanticContent
                            : '';
                        return `<span class="critic critic-comment" ${attributes} role="note" title="${escapeAttribute(title)}">${render(fragment.tokens)}</span>`;
                    }
                }
            },
        },
    );

    return {
        breaks: parserOptions.breaks,
        gfm: parserOptions.gfm,
        maxBlockNesting: parserOptions.maxBlockNesting,
        pedantic: parserOptions.pedantic,
        sourceProvenance: provenance.extension.sourceProvenance,
        hooks,
        extensions,
    };
}
