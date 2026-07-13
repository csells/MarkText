import type { MarkedExtension, MarkedOptions } from './MarkedOptions.ts';
import type { Token, TokensList } from './Tokens.ts';
import {
  assertMarkedTokenGraphUnchanged,
  markedSemanticTokenGraphContains,
  snapshotMarkedTokenGraph,
  snapshotMarkedSemanticTokenGraph,
} from './TokenGraphAuthority.ts';
import type { IMarkedTokenGraphSnapshot } from './TokenGraphAuthority.ts';

declare const DOCUMENT_OFFSET: unique symbol;
declare const VIEW_OFFSET: unique symbol;
declare const INVOCATION_ID: unique symbol;

export type TMarkedDocumentOffset = number & {
  readonly [DOCUMENT_OFFSET]: true;
};

export type TMarkedViewOffset = number & {
  readonly [VIEW_OFFSET]: true;
};

export type TMarkedInvocationId = number & {
  readonly [INVOCATION_ID]: true;
};

export interface IMarkedViewRange {
  readonly start: TMarkedViewOffset;
  readonly end: TMarkedViewOffset;
}

export interface IMarkedDocumentRange {
  readonly start: TMarkedDocumentOffset;
  readonly end: TMarkedDocumentOffset;
}

export interface IMarkedSourceSpan {
  readonly viewStart: TMarkedViewOffset;
  readonly viewEnd: TMarkedViewOffset;
  readonly documentStart: TMarkedDocumentOffset;
  readonly documentEnd: TMarkedDocumentOffset;
}

export interface IMarkedSourceBoundary {
  readonly viewOffset: TMarkedViewOffset;
  readonly documentOffset: TMarkedDocumentOffset;
}

export function markedDocumentOffset(value: number): TMarkedDocumentOffset {
  return value as TMarkedDocumentOffset;
}

export function markedViewOffset(value: number): TMarkedViewOffset {
  return value as TMarkedViewOffset;
}

const documentOffset = markedDocumentOffset;
const viewOffset = markedViewOffset;

function invocationId(value: number): TMarkedInvocationId {
  return value as TMarkedInvocationId;
}

function assertIntegerRange(
  start: number,
  end: number,
  length: number,
  label: string,
) {
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end < start
    || end > length
  ) {
    throw new RangeError(`${label} must be a forward range inside its source.`);
  }
}

function freezeSpan(span: IMarkedSourceSpan): IMarkedSourceSpan {
  return Object.freeze({ ...span });
}

function freezeBoundary(
  boundary: IMarkedSourceBoundary,
): IMarkedSourceBoundary {
  return Object.freeze({ ...boundary });
}

interface IMarkedSourceMapping {
  readonly length: number;
  readonly spans: readonly IMarkedSourceSpan[];
  readonly boundaries: readonly IMarkedSourceBoundary[];
}

interface IMarkedSourceWindow {
  readonly authority: object;
  readonly mapping: IMarkedSourceMapping;
  readonly start: number;
  readonly end: number;
}

const SOURCE_WINDOW_AUTHORITY = Object.freeze({});
const SOURCE_WINDOW = Symbol('marked-source-window');

function lowerBoundBy<T>(
  values: readonly T[],
  target: number,
  select: (value: T) => number,
): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (select(values[middle]) < target)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}

function upperBoundBy<T>(
  values: readonly T[],
  target: number,
  select: (value: T) => number,
): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (select(values[middle]) <= target)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}

export class MarkedSourceDocument<SourceId extends object> {
  readonly id: SourceId;
  readonly text: string;

  constructor(id: SourceId, text: string) {
    if (
      id === null
      || (typeof id !== 'object' && typeof id !== 'function')
    ) {
      throw new TypeError('Marked source documents require an object identity.');
    }
    if (typeof text !== 'string') {
      throw new TypeError('Marked source document text must be a string.');
    }
    this.id = id;
    this.text = text;
    Object.freeze(this);
  }

  identity(): MarkedSourceView<SourceId> {
    return this.slice(documentOffset(0), documentOffset(this.text.length));
  }

  slice(
    start: TMarkedDocumentOffset,
    end: TMarkedDocumentOffset,
  ): MarkedSourceView<SourceId> {
    assertIntegerRange(start, end, this.text.length, 'Marked document slice');
    const text = this.text.slice(start, end);
    return new MarkedSourceView(
      this,
      text,
      text.length
        ? [{
            viewStart: viewOffset(0),
            viewEnd: viewOffset(text.length),
            documentStart: documentOffset(start),
            documentEnd: documentOffset(end),
          }]
        : [],
      [{
        viewOffset: viewOffset(0),
        documentOffset: documentOffset(start),
      }],
    );
  }

  generated(
    text: string,
    at: TMarkedDocumentOffset,
  ): MarkedSourceView<SourceId> {
    return this.replacement(text, at, at);
  }

  replacement(
    text: string,
    sourceStart: TMarkedDocumentOffset,
    sourceEnd: TMarkedDocumentOffset,
  ): MarkedSourceView<SourceId> {
    assertIntegerRange(
      sourceStart,
      sourceEnd,
      this.text.length,
      'Marked replacement source',
    );
    if (typeof text !== 'string') {
      throw new TypeError('Marked generated source text must be a string.');
    }
    const boundaries: IMarkedSourceBoundary[] = [{
      viewOffset: viewOffset(0),
      documentOffset: sourceStart,
    }];
    if (text.length || sourceEnd !== sourceStart) {
      boundaries.push({
        viewOffset: viewOffset(text.length),
        documentOffset: sourceEnd,
      });
    }
    return new MarkedSourceView(this, text, [], boundaries);
  }

  compose(
    parts: readonly MarkedSourceView<SourceId>[],
  ): MarkedSourceView<SourceId> {
    return MarkedSourceView.concat(parts, this);
  }
}

export class MarkedSourceView<SourceId extends object> {
  readonly document: MarkedSourceDocument<SourceId>;
  readonly text: string;
  readonly #mapping: IMarkedSourceMapping;
  readonly #mappingStart: number;
  readonly #mappingEnd: number;
  #materializedSpans: readonly IMarkedSourceSpan[] | null = null;
  #materializedBoundaries: readonly IMarkedSourceBoundary[] | null = null;

  constructor(
    document: MarkedSourceDocument<SourceId>,
    text: string,
    spans: readonly IMarkedSourceSpan[],
    boundaries: readonly IMarkedSourceBoundary[] = [],
    window?: IMarkedSourceWindow,
  ) {
    if (!(document instanceof MarkedSourceDocument)) {
      throw new TypeError('Marked source views require a source document.');
    }
    if (typeof text !== 'string') {
      throw new TypeError('Marked source view text must be a string.');
    }

    this.document = document;
    this.text = text;
    if (window) {
      if (
        window.authority !== SOURCE_WINDOW_AUTHORITY
        || !Number.isInteger(window.start)
        || !Number.isInteger(window.end)
        || window.start < 0
        || window.end < window.start
        || window.end > window.mapping.length
        || text.length !== window.end - window.start
      ) {
        throw new TypeError('Marked source window is detached from its mapping.');
      }
      this.#mapping = window.mapping;
      this.#mappingStart = window.start;
      this.#mappingEnd = window.end;
    } else {
      let previousViewEnd = 0;
      let previousDocumentEnd = 0;
      const frozenSpans: IMarkedSourceSpan[] = [];
      for (const span of spans) {
        assertIntegerRange(
          span.viewStart,
          span.viewEnd,
          text.length,
          'Marked source span view',
        );
        assertIntegerRange(
          span.documentStart,
          span.documentEnd,
          document.text.length,
          'Marked source span document',
        );
        if (
          span.viewStart < previousViewEnd
          || span.documentStart < previousDocumentEnd
          || span.viewEnd - span.viewStart
            !== span.documentEnd - span.documentStart
          || text.slice(span.viewStart, span.viewEnd)
            !== document.text.slice(span.documentStart, span.documentEnd)
        ) {
          throw new RangeError(
            'Marked source spans must be ordered identity mappings.',
          );
        }
        previousViewEnd = span.viewEnd;
        previousDocumentEnd = span.documentEnd;
        frozenSpans.push(freezeSpan(span));
      }

      let previousBoundary = -1;
      const frozenBoundaries: IMarkedSourceBoundary[] = [];
      for (const boundary of boundaries) {
        if (
          !Number.isInteger(boundary.viewOffset)
          || !Number.isInteger(boundary.documentOffset)
          || boundary.viewOffset < previousBoundary
          || boundary.viewOffset < 0
          || boundary.viewOffset > text.length
          || boundary.documentOffset < 0
          || boundary.documentOffset > document.text.length
        ) {
          throw new RangeError(
            'Marked source boundaries must be ordered points inside both sources.',
          );
        }
        previousBoundary = boundary.viewOffset;
        frozenBoundaries.push(freezeBoundary(boundary));
      }
      this.#mapping = Object.freeze({
        length: text.length,
        spans: Object.freeze(frozenSpans),
        boundaries: Object.freeze(frozenBoundaries),
      });
      this.#mappingStart = 0;
      this.#mappingEnd = text.length;
      this.#materializedSpans = this.#mapping.spans;
      this.#materializedBoundaries = this.#mapping.boundaries;
    }
    Object.freeze(this);
  }

  get spans(): readonly IMarkedSourceSpan[] {
    this.#materializedSpans ??= this.#sliceSpans();
    return this.#materializedSpans;
  }

  get boundaries(): readonly IMarkedSourceBoundary[] {
    this.#materializedBoundaries ??= this.#sliceBoundaries();
    return this.#materializedBoundaries;
  }

  documentOffsetAt(
    local: TMarkedViewOffset,
    affinity: 'previous' | 'next' = 'next',
  ): TMarkedDocumentOffset {
    if (!Number.isInteger(local) || local < 0 || local > this.text.length) {
      throw new RangeError(
        'Marked source-view offset must be inside the view.',
      );
    }

    const absolute = this.#mappingStart + local;
    const spans = this.#mapping.spans;
    const containingIndex = upperBoundBy(
      spans,
      absolute,
      span => span.viewStart,
    ) - 1;
    const containingSpan = spans[containingIndex];
    const containing = containingSpan
      && containingSpan.viewStart <= absolute
      && absolute < containingSpan.viewEnd
      ? documentOffset(
          containingSpan.documentStart + absolute - containingSpan.viewStart,
        )
      : null;
    const previousIndex = upperBoundBy(
      spans,
      absolute,
      span => span.viewEnd,
    ) - 1;
    const previousSpanEntry = spans[previousIndex];
    const previousSpan = previousSpanEntry?.documentEnd ?? null;
    const previousAdjacent = previousSpanEntry?.viewEnd === absolute
      ? previousSpanEntry.documentEnd
      : null;
    const nextIndex = lowerBoundBy(
      spans,
      absolute,
      span => span.viewStart,
    );
    const nextSpan = spans[nextIndex]?.documentStart ?? null;

    const boundaries = this.#mapping.boundaries;
    const exactStart = lowerBoundBy(
      boundaries,
      absolute,
      boundary => boundary.viewOffset,
    );
    const exactEnd = upperBoundBy(
      boundaries,
      absolute,
      boundary => boundary.viewOffset,
    );
    const firstExactBoundary = exactStart < exactEnd
      ? boundaries[exactStart].documentOffset
      : null;
    const lastExactBoundary = exactStart < exactEnd
      ? boundaries[exactEnd - 1].documentOffset
      : null;
    const previousBoundary = exactStart > 0
      ? boundaries[exactStart - 1].documentOffset
      : null;
    const nextBoundary = exactEnd < boundaries.length
      ? boundaries[exactEnd].documentOffset
      : null;

    const result = affinity === 'previous'
      ? previousAdjacent
        ?? firstExactBoundary
        ?? containing
        ?? previousSpan
        ?? previousBoundary
        ?? nextSpan
        ?? nextBoundary
      : containing
        ?? lastExactBoundary
        ?? nextSpan
        ?? nextBoundary
        ?? previousSpan
        ?? previousBoundary;
    if (result === null) {
      throw new RangeError(
        'Marked source view has no document boundary for the requested offset.',
      );
    }
    return result;
  }

  slice(
    start: TMarkedViewOffset,
    end: TMarkedViewOffset = viewOffset(this.text.length),
  ): MarkedSourceView<SourceId> {
    assertIntegerRange(start, end, this.text.length, 'Marked source-view slice');
    return this[SOURCE_WINDOW](start, end, this.text.slice(start, end));
  }

  [SOURCE_WINDOW](
    start: TMarkedViewOffset,
    end: TMarkedViewOffset,
    text: string,
  ): MarkedSourceView<SourceId> {
    assertIntegerRange(start, end, this.text.length, 'Marked source-view window');
    if (text.length !== end - start) {
      throw new TypeError(
        'Marked source-window text length differs from its mapped range.',
      );
    }
    return new MarkedSourceView(
      this.document,
      text,
      [],
      [],
      {
        authority: SOURCE_WINDOW_AUTHORITY,
        mapping: this.#mapping,
        start: this.#mappingStart + start,
        end: this.#mappingStart + end,
      },
    );
  }

  #sliceSpans(): readonly IMarkedSourceSpan[] {
    const spans: IMarkedSourceSpan[] = [];
    const source = this.#mapping.spans;
    let index = lowerBoundBy(
      source,
      this.#mappingStart + 1,
      span => span.viewEnd,
    );
    while (index < source.length) {
      const span = source[index++];
      if (span.viewStart >= this.#mappingEnd)
        break;
      const clippedStart = Math.max(this.#mappingStart, span.viewStart);
      const clippedEnd = Math.min(this.#mappingEnd, span.viewEnd);
      if (clippedStart >= clippedEnd)
        continue;
      spans.push(freezeSpan({
        viewStart: viewOffset(clippedStart - this.#mappingStart),
        viewEnd: viewOffset(clippedEnd - this.#mappingStart),
        documentStart: documentOffset(
          span.documentStart + clippedStart - span.viewStart,
        ),
        documentEnd: documentOffset(
          span.documentStart + clippedEnd - span.viewStart,
        ),
      }));
    }
    return Object.freeze(spans);
  }

  #sliceBoundaries(): readonly IMarkedSourceBoundary[] {
    const boundaries: IMarkedSourceBoundary[] = [];
    const push = (local: number, document: TMarkedDocumentOffset) => {
      const previous = boundaries.at(-1);
      if (previous?.viewOffset === local && previous.documentOffset === document)
        return;
      boundaries.push(freezeBoundary({
        viewOffset: viewOffset(local),
        documentOffset: document,
      }));
    };
    const start = viewOffset(0);
    const end = viewOffset(this.text.length);
    push(start, this.documentOffsetAt(start, 'previous'));
    push(start, this.documentOffsetAt(start, 'next'));
    const source = this.#mapping.boundaries;
    let index = lowerBoundBy(
      source,
      this.#mappingStart + 1,
      boundary => boundary.viewOffset,
    );
    while (index < source.length) {
      const boundary = source[index++];
      if (boundary.viewOffset >= this.#mappingEnd)
        break;
      push(
        boundary.viewOffset - this.#mappingStart,
        boundary.documentOffset,
      );
    }
    if (this.text.length) {
      push(end, this.documentOffsetAt(end, 'previous'));
      push(end, this.documentOffsetAt(end, 'next'));
    }
    return Object.freeze(boundaries);
  }

  generated(
    text: string,
    at: TMarkedViewOffset,
    through: TMarkedViewOffset = at,
  ): MarkedSourceView<SourceId> {
    return this.document.replacement(
      text,
      this.documentOffsetAt(at, 'next'),
      this.documentOffsetAt(through, 'previous'),
    );
  }

  static concat<SourceId extends object>(
    parts: readonly MarkedSourceView<SourceId>[],
    emptyDocument?: MarkedSourceDocument<SourceId>,
  ): MarkedSourceView<SourceId> {
    const document = parts[0]?.document ?? emptyDocument;
    if (!document) {
      throw new TypeError(
        'Concatenating no Marked source views requires a source document.',
      );
    }
    const text: string[] = [];
    const spans: IMarkedSourceSpan[] = [];
    const boundaries: IMarkedSourceBoundary[] = [];
    let offset = 0;
    for (const part of parts) {
      if (part.document !== document) {
        throw new TypeError(
          'Marked source views from different documents cannot be combined.',
        );
      }
      text.push(part.text);
      for (const span of part.spans) {
        const adjusted: IMarkedSourceSpan = {
          ...span,
          viewStart: viewOffset(offset + span.viewStart),
          viewEnd: viewOffset(offset + span.viewEnd),
        };
        const previous = spans.at(-1);
        if (
          previous
          && previous.viewEnd === adjusted.viewStart
          && previous.documentEnd === adjusted.documentStart
        ) {
          spans[spans.length - 1] = {
            ...previous,
            viewEnd: adjusted.viewEnd,
            documentEnd: adjusted.documentEnd,
          };
        } else {
          spans.push(adjusted);
        }
      }
      for (const boundary of part.boundaries) {
        const adjusted: IMarkedSourceBoundary = {
          ...boundary,
          viewOffset: viewOffset(offset + boundary.viewOffset),
        };
        const previous = boundaries.at(-1);
        if (
          previous?.viewOffset !== adjusted.viewOffset
          || previous.documentOffset !== adjusted.documentOffset
        ) {
          boundaries.push(adjusted);
        }
      }
      offset += part.text.length;
    }
    if (!parts.length) {
      boundaries.push({
        viewOffset: viewOffset(0),
        documentOffset: documentOffset(0),
      });
    }
    return new MarkedSourceView(
      document,
      text.join(''),
      spans,
      boundaries,
    );
  }
}

export interface IMarkedTokenConsumption<SourceId extends object> {
  readonly kind: 'token';
  readonly token: Token;
  readonly invocationId: TMarkedInvocationId;
  readonly range: IMarkedViewRange;
  readonly source: MarkedSourceView<SourceId>;
}

export interface IMarkedResidueConsumption<SourceId extends object> {
  readonly kind: 'residue';
  readonly reason:
    | 'discarded-token'
    | 'consumed-without-token'
    | 'parser-resource-limit';
  readonly discardedTokenType?: string;
  /** AST presentation carrier for source the parser deliberately left literal. */
  readonly literalToken?: Token;
  readonly coverage?: 'mapped-spans' | 'source-envelope';
  readonly invocationId: TMarkedInvocationId;
  readonly range: IMarkedViewRange;
  readonly source: MarkedSourceView<SourceId>;
}

/**
 * Source consumed by a parser attempt whose token carrier was superseded by
 * native container reconstruction. It remains only in that invocation's
 * partition ledger; final token and literal-range queries never expose it.
 */
export interface IMarkedDelegatedConsumption<SourceId extends object> {
  readonly kind: 'delegated';
  readonly reason: 'superseded-token';
  readonly supersededTokenType: string;
  readonly invocationId: TMarkedInvocationId;
  readonly range: IMarkedViewRange;
  readonly source: MarkedSourceView<SourceId>;
}

export type TMarkedSourceConsumption<SourceId extends object>
  = IMarkedTokenConsumption<SourceId>
    | IMarkedResidueConsumption<SourceId>;

export type TMarkedConsumption<SourceId extends object>
  = TMarkedSourceConsumption<SourceId>
    | IMarkedDelegatedConsumption<SourceId>;

function unexpectedRecordedConsumption(value: never): never {
  throw new TypeError(
    `Marked provenance recorded an unsupported consumption kind: ${String(value)}.`,
  );
}

export interface IMarkedLexInvocation<SourceId extends object> {
  readonly id: TMarkedInvocationId;
  readonly level: 'block' | 'inline';
  readonly input: MarkedSourceView<SourceId>;
  readonly tokens: readonly Token[];
  readonly ledger: readonly TMarkedConsumption<SourceId>[];
}

interface ITraceAuthority<SourceId extends object> {
  readonly consumptions: WeakMap<Token, readonly IMarkedTokenConsumption<SourceId>[]>;
  readonly residueConsumptions: WeakMap<Token, readonly IMarkedResidueConsumption<SourceId>[]>;
  readonly invocationsByTokens: WeakMap<object, readonly IMarkedLexInvocation<SourceId>[]>;
  readonly tokenGraph: IMarkedTokenGraphSnapshot;
}

const TRACE_AUTHORITY = new WeakMap<object, ITraceAuthority<object>>();

export class MarkedParseTrace<SourceId extends object> {
  readonly level: 'block' | 'inline';
  readonly input: MarkedSourceView<SourceId>;
  readonly tokens: readonly Token[];
  readonly lexerOptions: object;
  readonly invocations: readonly IMarkedLexInvocation<SourceId>[];
  readonly residues: readonly IMarkedResidueConsumption<SourceId>[];

  constructor(
    level: 'block' | 'inline',
    input: MarkedSourceView<SourceId>,
    tokens: readonly Token[],
    lexerOptions: object,
    invocations: readonly IMarkedLexInvocation<SourceId>[],
    residues: readonly IMarkedResidueConsumption<SourceId>[],
    authority: ITraceAuthority<SourceId>,
  ) {
    this.level = level;
    this.input = input;
    this.tokens = tokens;
    this.lexerOptions = lexerOptions;
    this.invocations = Object.freeze([...invocations]);
    this.residues = Object.freeze([...residues]);
    TRACE_AUTHORITY.set(
      this,
      authority as unknown as ITraceAuthority<object>,
    );
    Object.freeze(this);
  }

  tokenConsumptions(
    token: Token,
  ): readonly IMarkedTokenConsumption<SourceId>[] {
    const authority = TRACE_AUTHORITY.get(this) as
      | ITraceAuthority<SourceId>
      | undefined;
    if (!authority)
      throw new TypeError('Marked parse trace has no provenance authority.');
    return authority.consumptions.get(token) ?? Object.freeze([]);
  }

  sourceConsumptions(
    token: Token,
  ): readonly TMarkedSourceConsumption<SourceId>[] {
    const authority = TRACE_AUTHORITY.get(this) as
      | ITraceAuthority<SourceId>
      | undefined;
    if (!authority)
      throw new TypeError('Marked parse trace has no provenance authority.');
    const semantic = authority.consumptions.get(token);
    const residue = authority.residueConsumptions.get(token);
    if (semantic?.length && residue?.length) {
      throw new TypeError(
        'Marked token cannot own both semantic and residue source.',
      );
    }
    return semantic ?? residue ?? Object.freeze([]);
  }

  invocationsForTokens(
    tokens: readonly Token[],
  ): readonly IMarkedLexInvocation<SourceId>[] {
    const authority = TRACE_AUTHORITY.get(this) as
      | ITraceAuthority<SourceId>
      | undefined;
    if (!authority)
      throw new TypeError('Marked parse trace has no provenance authority.');
    return authority.invocationsByTokens.get(tokens as object)
      ?? Object.freeze([]);
  }

  inlineInvocation(tokens: readonly Token[]): IMarkedLexInvocation<SourceId> {
    const matches = this.invocationsForTokens(tokens)
      .filter(invocation => invocation.level === 'inline');
    if (matches.length !== 1) {
      throw new TypeError(
        'Marked inline token array does not have one parser invocation.',
      );
    }
    return matches[0];
  }

  assertUnchanged(): void {
    const authority = TRACE_AUTHORITY.get(this) as
      | ITraceAuthority<SourceId>
      | undefined;
    if (!authority)
      throw new TypeError('Marked parse trace has no provenance authority.');
    assertMarkedTokenGraphUnchanged(authority.tokenGraph);
  }
}

interface IMutableInvocation<SourceId extends object> {
  readonly id: TMarkedInvocationId;
  readonly level: 'block' | 'inline';
  readonly input: MarkedSourceView<SourceId>;
  readonly tokens: Token[] | TokensList;
  readonly ledger: TMarkedSourceConsumption<SourceId>[];
  offset: number;
  ended: boolean;
}

export interface IMarkedProvenanceRecorder<SourceId extends object> {
  readonly input: MarkedSourceView<SourceId>;
  beginInvocation: (
    level: 'block' | 'inline',
    input: MarkedSourceView<SourceId>,
    tokens: Token[] | TokensList,
  ) => IMutableInvocation<SourceId>;
  remaining: (
    invocation: IMutableInvocation<SourceId>,
    source?: string,
  ) => MarkedSourceView<SourceId>;
  consumedTokenSource: (
    token: Token,
  ) => MarkedSourceView<SourceId>;
  consumeToken: (
    invocation: IMutableInvocation<SourceId>,
    token: Token,
    length: number,
  ) => IMarkedTokenConsumption<SourceId>;
  consumeResidue: (
    invocation: IMutableInvocation<SourceId>,
    length: number,
    reason: IMarkedResidueConsumption<SourceId>['reason'],
    discardedTokenType?: string,
    literalToken?: Token,
    coverage?: IMarkedResidueConsumption<SourceId>['coverage'],
  ) => IMarkedResidueConsumption<SourceId>;
  supersedeToken: (previous: Token, replacement: Token) => void;
  endInvocation: (invocation: IMutableInvocation<SourceId>) => void;
  complete: (
    level: 'block' | 'inline',
    tokens: Token[] | TokensList,
  ) => MarkedParseTrace<SourceId>;
}

export interface IMarkedProvenanceFactory {
  create(
    level: 'block' | 'inline',
    source: string,
    options: object,
  ): IMarkedProvenanceRecorder<object>;
}

export interface IMarkedProvenanceBinding<SourceId extends object> {
  readonly extension: MarkedExtension;
  claim(tokens: Token[] | TokensList): MarkedParseTrace<SourceId>;
}

class ProvenanceRecorder<SourceId extends object>
implements IMarkedProvenanceRecorder<SourceId> {
  readonly input: MarkedSourceView<SourceId>;
  private readonly _invocations: IMutableInvocation<SourceId>[] = [];
  private readonly _active: IMutableInvocation<SourceId>[] = [];
  private readonly _consumptions = new WeakMap<
    Token,
    IMarkedTokenConsumption<SourceId>[]
  >();
  private readonly _residues: IMarkedResidueConsumption<SourceId>[] = [];
  private readonly _residueConsumptions = new WeakMap<
    Token,
    IMarkedResidueConsumption<SourceId>[]
  >();
  private readonly _supersededTokens = new WeakMap<Token, Token>();
  private _nextInvocation = 0;
  private _completed = false;

  constructor(
    input: MarkedSourceView<SourceId>,
    private readonly _lexerOptions: object,
    private readonly _register: (
      tokens: Token[] | TokensList,
      trace: MarkedParseTrace<SourceId>,
    ) => void,
  ) {
    this.input = input;
  }

  beginInvocation(
    level: 'block' | 'inline',
    input: MarkedSourceView<SourceId>,
    tokens: Token[] | TokensList,
  ): IMutableInvocation<SourceId> {
    if (this._completed)
      throw new TypeError('Marked provenance recorder is already complete.');
    if (input.document !== this.input.document) {
      throw new TypeError(
        'Marked recursive parser input belongs to another source document.',
      );
    }
    const invocation: IMutableInvocation<SourceId> = {
      id: invocationId(this._nextInvocation++),
      level,
      input,
      tokens,
      ledger: [],
      offset: 0,
      ended: false,
    };
    this._invocations.push(invocation);
    this._active.push(invocation);
    return invocation;
  }

  remaining(
    invocation: IMutableInvocation<SourceId>,
    source?: string,
  ): MarkedSourceView<SourceId> {
    this._assertActive(invocation);
    const remainingLength = invocation.input.text.length - invocation.offset;
    const text = source ?? invocation.input.text.slice(invocation.offset);
    if (text.length !== remainingLength) {
      throw new TypeError(
        'Marked parser source length differs from its active provenance cursor.',
      );
    }
    return invocation.input[SOURCE_WINDOW](
      viewOffset(invocation.offset),
      viewOffset(invocation.offset + text.length),
      text,
    );
  }

  consumedTokenSource(token: Token): MarkedSourceView<SourceId> {
    if (this._completed) {
      throw new TypeError(
        'Marked consumed-token source is unavailable after parser completion.',
      );
    }
    const consumptions = this._consumptions.get(token);
    if (!consumptions?.length) {
      throw new TypeError(
        'Marked consumed-token source requires parser-owned token consumption.',
      );
    }
    return MarkedSourceView.concat(
      consumptions.map(consumption => consumption.source),
      this.input.document,
    );
  }

  consumeToken(
    invocation: IMutableInvocation<SourceId>,
    token: Token,
    length: number,
  ): IMarkedTokenConsumption<SourceId> {
    this._assertConsumption(invocation, length);
    const start = invocation.offset;
    invocation.offset += length;
    const consumption: IMarkedTokenConsumption<SourceId> = Object.freeze({
      kind: 'token',
      token,
      invocationId: invocation.id,
      range: Object.freeze({
        start: viewOffset(start),
        end: viewOffset(invocation.offset),
      }),
      source: invocation.input.slice(
        viewOffset(start),
        viewOffset(invocation.offset),
      ),
    });
    invocation.ledger.push(consumption);
    const tokenConsumptions = this._consumptions.get(token);
    if (tokenConsumptions)
      tokenConsumptions.push(consumption);
    else
      this._consumptions.set(token, [consumption]);
    return consumption;
  }

  consumeResidue(
    invocation: IMutableInvocation<SourceId>,
    length: number,
    reason: IMarkedResidueConsumption<SourceId>['reason'],
    discardedTokenType?: string,
    literalToken?: Token,
    coverage?: IMarkedResidueConsumption<SourceId>['coverage'],
  ): IMarkedResidueConsumption<SourceId> {
    this._assertConsumption(invocation, length);
    const isResourceLimit = reason === 'parser-resource-limit';
    if (
      isResourceLimit !== Boolean(literalToken)
      || isResourceLimit !== (coverage === 'source-envelope')
      || (!isResourceLimit && coverage !== undefined)
    ) {
      throw new TypeError(
        'Marked parser resource residue requires one literal token and source envelope.',
      );
    }
    const start = invocation.offset;
    invocation.offset += length;
    const residue: IMarkedResidueConsumption<SourceId> = Object.freeze({
      kind: 'residue',
      reason,
      ...(discardedTokenType ? { discardedTokenType } : {}),
      ...(literalToken ? { literalToken } : {}),
      ...(coverage ? { coverage } : {}),
      invocationId: invocation.id,
      range: Object.freeze({
        start: viewOffset(start),
        end: viewOffset(invocation.offset),
      }),
      source: invocation.input.slice(
        viewOffset(start),
        viewOffset(invocation.offset),
      ),
    });
    invocation.ledger.push(residue);
    this._residues.push(residue);
    if (literalToken) {
      const consumptions = this._residueConsumptions.get(literalToken);
      if (consumptions)
        consumptions.push(residue);
      else
        this._residueConsumptions.set(literalToken, [residue]);
    }
    return residue;
  }

  supersedeToken(previous: Token, replacement: Token): void {
    if (this._completed) {
      throw new TypeError(
        'Marked provenance cannot supersede a token after completion.',
      );
    }
    if (
      previous === replacement
      || this._supersededTokens.has(previous)
      || (
        !this._consumptions.has(previous)
        && !this._residueConsumptions.has(previous)
      )
    ) {
      throw new TypeError(
        'Marked token supersession requires one recorded prior carrier and a distinct replacement.',
      );
    }
    this._supersededTokens.set(previous, replacement);
  }

  endInvocation(invocation: IMutableInvocation<SourceId>) {
    this._assertActive(invocation);
    if (invocation.offset !== invocation.input.text.length) {
      throw new TypeError(
        'Marked parser invocation did not consume its complete mapped input.',
      );
    }
    if (this._active.at(-1) !== invocation) {
      throw new TypeError(
        'Marked parser invocations must end in stack order.',
      );
    }
    invocation.ended = true;
    this._active.pop();
  }

  complete(
    level: 'block' | 'inline',
    tokens: Token[] | TokensList,
  ): MarkedParseTrace<SourceId> {
    if (this._completed || this._active.length) {
      throw new TypeError(
        'Marked provenance cannot complete with active or reused invocations.',
      );
    }
    const root = this._invocations[0];
    if (!root || root.level !== level || root.tokens !== tokens) {
      throw new TypeError(
        'Marked provenance root differs from the completed lexer result.',
      );
    }
    this._completed = true;

    const tokenGraph = snapshotMarkedTokenGraph(tokens);
    const semanticTokenGraph = snapshotMarkedSemanticTokenGraph(
      tokens,
      (this._lexerOptions as MarkedOptions).extensions?.childTokens,
    );
    const isSemantic = (target: object) =>
      markedSemanticTokenGraphContains(semanticTokenGraph, target);
    const entryHasFinalCarrier = (
      entry: TMarkedSourceConsumption<SourceId>,
    ): boolean => {
      switch (entry.kind) {
        case 'token':
          return isSemantic(entry.token);
        case 'residue':
          return Boolean(
            entry.literalToken
            && isSemantic(entry.literalToken),
          );
        default:
          return unexpectedRecordedConsumption(entry);
      }
    };
    const retainedInvocations = this._invocations.filter((invocation) => {
      const ownsFinalTokens = isSemantic(invocation.tokens);
      if (!ownsFinalTokens && invocation.ledger.some(entryHasFinalCarrier)) {
        throw new TypeError(
          'Marked semantic token moved out of its parser invocation without parser-owned delegation.',
        );
      }
      return ownsFinalTokens;
    });
    const retainedInvocationIds = new Set(
      retainedInvocations.map(invocation => invocation.id),
    );
    const retainedResidues = this._residues.filter(residue =>
      residue.literalToken
        ? isSemantic(residue.literalToken)
        : retainedInvocationIds.has(residue.invocationId));
    const retainedResidueSet = new Set(retainedResidues);

    const invocationsByTokens = new WeakMap<
      object,
      IMarkedLexInvocation<SourceId>[]
    >();
    const finalizedEntry = (
      entry: TMarkedSourceConsumption<SourceId>,
    ): TMarkedConsumption<SourceId> => {
      const carrier = entry.kind === 'token'
        ? entry.token
        : entry.literalToken;
      let supersededTokenType: string;
      switch (entry.kind) {
        case 'token':
          if (entryHasFinalCarrier(entry))
            return entry;
          supersededTokenType = entry.token.type;
          break;
        case 'residue':
          if (!entry.literalToken || entryHasFinalCarrier(entry))
            return entry;
          supersededTokenType = entry.literalToken.type;
          break;
        default:
          return unexpectedRecordedConsumption(entry);
      }
      if (!carrier) {
        throw new TypeError(
          'Marked provenance cannot delegate source without a token carrier.',
        );
      }
      const visited = new WeakSet<Token>();
      let replacement: Token | undefined = carrier;
      while (replacement && !isSemantic(replacement)) {
        if (visited.has(replacement)) {
          throw new TypeError(
            'Marked parser-owned token supersession contains a cycle.',
          );
        }
        visited.add(replacement);
        replacement = this._supersededTokens.get(replacement);
      }
      if (!replacement) {
        throw new TypeError(
          'Marked token disappeared without parser-owned supersession to a final semantic carrier.',
        );
      }
      return Object.freeze({
        kind: 'delegated',
        reason: 'superseded-token',
        supersededTokenType,
        invocationId: entry.invocationId,
        range: entry.range,
        source: entry.source,
      });
    };
    const invocations = retainedInvocations.map((invocation) => {
      if (!invocation.ended)
        throw new TypeError('Marked provenance contains an open invocation.');
      const frozen: IMarkedLexInvocation<SourceId> = Object.freeze({
        id: invocation.id,
        level: invocation.level,
        input: invocation.input,
        tokens: invocation.tokens,
        ledger: Object.freeze(invocation.ledger.map(finalizedEntry)),
      });
      const matches = invocationsByTokens.get(invocation.tokens);
      if (matches)
        matches.push(frozen);
      else
        invocationsByTokens.set(invocation.tokens, [frozen]);
      return frozen;
    });
    for (const invocation of invocations)
      Object.freeze(invocationsByTokens.get(invocation.tokens as object)!);

    const consumptions = new WeakMap<
      Token,
      readonly IMarkedTokenConsumption<SourceId>[]
    >();
    for (const invocation of invocations) {
      for (const entry of invocation.ledger) {
        if (entry.kind !== 'token' || consumptions.has(entry.token))
          continue;
        consumptions.set(
          entry.token,
          Object.freeze([
            ...(this._consumptions.get(entry.token) ?? []).filter(
              consumption => retainedInvocationIds.has(
                consumption.invocationId,
              ),
            ),
          ]),
        );
      }
    }
    const residueConsumptions = new WeakMap<
      Token,
      readonly IMarkedResidueConsumption<SourceId>[]
    >();
    for (const residue of retainedResidues) {
      if (!residue.literalToken || residueConsumptions.has(residue.literalToken))
        continue;
      residueConsumptions.set(
        residue.literalToken,
        Object.freeze([
          ...(this._residueConsumptions.get(residue.literalToken) ?? []),
        ].filter(consumption => retainedResidueSet.has(consumption)),
        ),
      );
    }
    const trace = new MarkedParseTrace(
      level,
      this.input,
      tokens,
      this._lexerOptions,
      invocations,
      retainedResidues,
      {
        consumptions,
        residueConsumptions,
        invocationsByTokens,
        tokenGraph,
      },
    );
    this._register(tokens, trace);
    return trace;
  }

  private _assertActive(invocation: IMutableInvocation<SourceId>) {
    if (
      invocation.ended
      || !this._active.includes(invocation)
      || this._active.at(-1) !== invocation
    ) {
      throw new TypeError('Marked provenance invocation is not active.');
    }
  }

  private _assertConsumption(
    invocation: IMutableInvocation<SourceId>,
    length: number,
  ) {
    this._assertActive(invocation);
    if (
      !Number.isInteger(length)
      || length <= 0
      || invocation.offset + length > invocation.input.text.length
    ) {
      throw new RangeError(
        'Marked parser consumption must advance inside its mapped input.',
      );
    }
  }
}

export function createMarkedProvenanceBinding<SourceId extends object>(
  input: MarkedSourceView<SourceId>,
): IMarkedProvenanceBinding<SourceId> {
  if (!(input instanceof MarkedSourceView)) {
    throw new TypeError(
      'Marked provenance bindings require a mapped source view.',
    );
  }
  const traces = new WeakMap<object, MarkedParseTrace<SourceId>>();
  const claimed = new WeakSet<object>();
  const factory: IMarkedProvenanceFactory = Object.freeze({
    create(
      _level: 'block' | 'inline',
      source: string,
      options: object,
    ) {
      if (source !== input.text) {
        throw new TypeError(
          'Marked authenticated lexer invocation source differs from its provenance binding.',
        );
      }
      return new ProvenanceRecorder(
        input,
        options,
        (tokens, trace) => {
          if (traces.has(tokens)) {
            throw new TypeError(
              'Marked token root already has parser provenance.',
            );
          }
          traces.set(tokens, trace);
        },
      ) as unknown as IMarkedProvenanceRecorder<object>;
    },
  });
  const extension: MarkedExtension = Object.freeze({
    sourceProvenance: factory,
  });
  return Object.freeze({
    extension,
    claim(tokens: Token[] | TokensList) {
      const trace = traces.get(tokens);
      if (!trace || claimed.has(tokens)) {
        throw new TypeError(
          'Marked tokens require one unclaimed lexer provenance trace from an authenticated lexer invocation.',
        );
      }
      trace.assertUnchanged();
      claimed.add(tokens);
      traces.delete(tokens);
      return trace;
    },
  });
}
