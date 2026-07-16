import {
  _Tokenizer,
  consumeNativeBlockReconstruction,
} from './Tokenizer.ts';
import { _defaults } from './defaults.ts';
import { other, block, inline } from './rules.ts';
import type { Token, TokensList, Tokens } from './Tokens.ts';
import type { MarkedOptions } from './MarkedOptions.ts';
import {
  MarkedSourceView,
  markedViewOffset,
} from './SourceProvenance.ts';
import type {
  IMarkedProvenanceRecorder,
  IMarkedTokenConsumption,
} from './SourceProvenance.ts';

type LexerSource = string | MarkedSourceView<object>;

function appendCriticMarkupBoundaries(
  token: Token,
  edge: 'before' | 'after',
  attachments: readonly Tokens.CriticMarkupBoundaryAttachment[],
): void {
  if (!attachments.length)
    return;
  const key = edge === 'before' ? 'criticMarkupBefore' : 'criticMarkupAfter';
  const existing = token[key] ?? [];
  for (const attachment of attachments) {
    if (attachment.edge !== edge) {
      throw new TypeError(
        `Marked CriticMarkup ${edge} boundary has ${attachment.edge} edge.`,
      );
    }
  }
  token[key] = Object.freeze([...existing, ...attachments]);
}

function replaceMappedSource(
  source: MarkedSourceView<object>,
  expression: RegExp,
  replacement: (match: string) => string,
): MarkedSourceView<object> {
  if (!expression.global) {
    throw new TypeError(
      'Mapped lexer normalization requires a global expression.',
    );
  }

  const matcher = new RegExp(expression.source, expression.flags);
  const parts: MarkedSourceView<object>[] = [];
  let offset = 0;
  let changed = false;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source.text)) !== null) {
    if (!match[0].length) {
      throw new TypeError(
        'Mapped lexer normalization cannot replace an empty match.',
      );
    }
    changed = true;
    if (offset < match.index) {
      parts.push(source.slice(
        markedViewOffset(offset),
        markedViewOffset(match.index),
      ));
    }
    parts.push(source.generated(
      replacement(match[0]),
      markedViewOffset(match.index),
      markedViewOffset(match.index + match[0].length),
    ));
    offset = match.index + match[0].length;
  }

  if (!changed) {
    return source;
  }
  if (offset < source.text.length) {
    parts.push(source.slice(
      markedViewOffset(offset),
      markedViewOffset(source.text.length),
    ));
  }
  return MarkedSourceView.concat(parts, source.document);
}

function mappedLineSeparator(
  left: MarkedSourceView<object>,
  right: MarkedSourceView<object>,
): MarkedSourceView<object> {
  if (left.document !== right.document) {
    throw new TypeError(
      'Marked token merge cannot cross source documents.',
    );
  }
  const start = left.documentOffsetAt(
    markedViewOffset(left.text.length),
    'previous',
  );
  const end = right.documentOffsetAt(markedViewOffset(0), 'next');
  return left.document.text.slice(start, end) === '\n'
    ? left.document.slice(start, end)
    : left.document.replacement('\n', start, end);
}

/**
 * Block Lexer
 */
export class _Lexer<ParserOutput = string, RendererOutput = string> {
  tokens: TokensList;
  options: MarkedOptions<ParserOutput, RendererOutput>;
  state: {
    inLink: boolean;
    inRawBlock: boolean;
    top: boolean;
  };

  public inlineQueue: { src: LexerSource, tokens: Token[] }[];

  private tokenizer: _Tokenizer<ParserOutput, RendererOutput>;
  private provenanceRecorder: IMarkedProvenanceRecorder<object> | null = null;
  private provenanceInvocations: ReturnType<
    IMarkedProvenanceRecorder<object>['beginInvocation']
  >[] = [];
  private provenanceParserSources: string[] = [];
  private provenanceSourceOverrides: Array<{
    source: MarkedSourceView<object>;
    invocationDepth: number;
  }> = [];
  private provenanceCompleted = false;
  private blockNestingDepth = 0;
  private reconstructedTokenSources = new WeakMap<
    Token,
    MarkedSourceView<object>
  >();

  constructor(options?: MarkedOptions<ParserOutput, RendererOutput>) {
    // TokenList cannot be created in one go
    this.tokens = [] as unknown as TokensList;
    this.tokens.links = Object.create(null);
    this.tokens.criticMarkup = null;
    this.tokens.criticMarkupUnanchored = Object.freeze([]);
    this.options = options || _defaults;
    const maxBlockNesting = this.options.maxBlockNesting;
    if (
      maxBlockNesting !== undefined
      && (!Number.isSafeInteger(maxBlockNesting) || maxBlockNesting < 0)
    ) {
      throw new RangeError(
        'Marked maxBlockNesting must be a non-negative safe integer.',
      );
    }
    this.options.tokenizer = this.options.tokenizer || new _Tokenizer<ParserOutput, RendererOutput>();
    this.tokenizer = this.options.tokenizer;
    this.tokenizer.options = this.options;
    this.tokenizer.lexer = this;
    this.inlineQueue = [];
    this.state = {
      inLink: false,
      inRawBlock: false,
      top: true,
    };

    const rules = {
      other,
      block: block.normal,
      inline: inline.normal,
    };

    if (this.options.pedantic) {
      rules.block = block.pedantic;
      rules.inline = inline.pedantic;
    } else if (this.options.gfm) {
      rules.block = block.gfm;
      if (this.options.breaks) {
        rules.inline = inline.breaks;
      } else {
        rules.inline = inline.gfm;
      }
    }
    this.tokenizer.rules = rules;
    for (const initialize of this.options.extensions?.initializeTokens ?? [])
      initialize.call({ lexer: this }, this.tokens);
  }

  /**
   * Expose Rules
   */
  static get rules() {
    return {
      block,
      inline,
    };
  }

  /**
   * Static Lex Method
   */
  static lex<ParserOutput = string, RendererOutput = string>(src: string, options?: MarkedOptions<ParserOutput, RendererOutput>) {
    const lexer = new _Lexer<ParserOutput, RendererOutput>(options);
    return lexer.lex(src);
  }

  /**
   * Static Lex Inline Method
   */
  static lexInline<ParserOutput = string, RendererOutput = string>(src: string, options?: MarkedOptions<ParserOutput, RendererOutput>) {
    const lexer = new _Lexer<ParserOutput, RendererOutput>(options);
    return lexer.lexInline(src);
  }

  /**
   * Exact mapped source remaining in the active parser invocation.
   */
  get currentSourceView(): MarkedSourceView<object> | null {
    if (!this.provenanceRecorder) {
      return null;
    }
    const override = this.provenanceSourceOverrides.at(-1);
    if (
      override
      && this.provenanceInvocations.length <= override.invocationDepth
    ) {
      return override.source;
    }
    const invocation = this.provenanceInvocations.at(-1);
    const parserSource = this.provenanceParserSources.at(-1);
    if (!invocation || parserSource === undefined) {
      throw new TypeError(
        'Marked provenance has no active parser source.',
      );
    }
    return this.provenanceRecorder.remaining(invocation, parserSource);
  }

  /** Validate an externally supplied tokenizer string against parser state. */
  sourceViewFor(source: string): MarkedSourceView<object> | null {
    const view = this.currentSourceView;
    if (view && view.text !== source) {
      throw new TypeError(
        'Marked tokenizer source differs from its active mapped input.',
      );
    }
    return view;
  }

  /** Exact parser-owned source carried by the current final parsed token. */
  sourceViewForParsedToken(
    tokens: readonly Token[],
    token: Token,
  ): MarkedSourceView<object> | null {
    if (tokens.at(-1) !== token) {
      throw new TypeError(
        'Marked parsed-token source requires the exact final token carrier.',
      );
    }
    if (!this.provenanceRecorder) {
      return null;
    }
    const source = this.reconstructedTokenSources.get(token)
      ?? this.provenanceRecorder.consumedTokenSource(token);
    if (source.text !== token.raw) {
      throw new TypeError(
        'Marked parsed-token source differs from its token raw text.',
      );
    }
    return source;
  }

  /** Parser-internal source context for direct recursive tokenizer calls. */
  withSourceView<Result>(
    source: MarkedSourceView<object>,
    consume: () => Result,
  ): Result {
    if (!this.provenanceRecorder)
      return consume();
    if (source.document !== this.provenanceRecorder.input.document) {
      throw new TypeError(
        'Marked tokenizer override belongs to another source document.',
      );
    }
    this.provenanceSourceOverrides.push({
      source,
      invocationDepth: this.provenanceInvocations.length,
    });
    try {
      return consume();
    } finally {
      this.provenanceSourceOverrides.pop();
    }
  }

  /**
   * Preprocessing
   */
  lex(src: string) {
    if (this.options.sourceProvenance) {
      this.startProvenance('block', src);
      let source = this.provenanceRecorder!.input;
      source = replaceMappedSource(source, other.carriageReturn, () => '\n');

      this.blockTokens(source, this.tokens);

      for (let i = 0; i < this.inlineQueue.length; i++) {
        const next = this.inlineQueue[i];
        if (!(next.src instanceof MarkedSourceView)) {
          throw new TypeError(
            'Mapped block lexing produced a detached inline source.',
          );
        }
        this.inlineTokens(next.src, next.tokens);
      }
      this.inlineQueue = [];
      this.completeProvenance('block', this.tokens);
      return this.tokens;
    }

    src = src.replace(other.carriageReturn, '\n');

    this.blockTokens(src, this.tokens);

    for (let i = 0; i < this.inlineQueue.length; i++) {
      const next = this.inlineQueue[i];
      this.inlineTokens(next.src as string, next.tokens);
    }
    this.inlineQueue = [];

    return this.tokens;
  }

  /**
   * Inline root lexing with the same provenance lifecycle as block lexing.
   */
  lexInline(src: string) {
    if (!this.options.sourceProvenance) {
      return this.inlineTokens(src);
    }
    this.startProvenance('inline', src);
    const tokens = this.inlineTokens(this.provenanceRecorder!.input);
    this.completeProvenance('inline', tokens);
    return tokens;
  }

  /**
   * Lexing
   */
  blockTokens(src: LexerSource, tokens?: Token[], lastParagraphClipped?: boolean): Token[];
  blockTokens(src: LexerSource, tokens?: TokensList, lastParagraphClipped?: boolean): TokensList;
  blockTokens(source: LexerSource, tokens: Token[] = [], lastParagraphClipped = false) {
    const depth = this.blockNestingDepth;
    this.blockNestingDepth++;
    try {
      const limit = this.options.maxBlockNesting;
      if (limit !== undefined && depth >= limit) {
        return this.blockNestingLimitToken(source, tokens, depth, limit);
      }
      return this.blockTokensAtDepth(source, tokens, lastParagraphClipped);
    } finally {
      this.blockNestingDepth--;
    }
  }

  /**
   * Re-tokenize a nested block container while preserving its semantic depth.
   *
   * Blockquote lazy-continuation repair rebuilds an already nested blockquote
   * or list after the ordinary recursive `blockTokens` calls have unwound.
   * Using the then-current call-stack depth would let every rebuild restart
   * the resource budget from its shallower parent. This parser-owned entry
   * carries the nested container's real depth into that reconstruction.
   */
  reparseNestedBlockToken<NestedToken extends Token>(
    source: string | MarkedSourceView<object>,
    tokenize: (source: string) => NestedToken | undefined,
  ): NestedToken | Tokens.ParserResidue {
    const nestedDepth = this.blockNestingDepth;
    const limit = this.options.maxBlockNesting;
    if (limit !== undefined && nestedDepth >= limit) {
      const tokens: Token[] = [];
      this.blockNestingLimitToken(source, tokens, nestedDepth, limit);
      return tokens[0] as Tokens.ParserResidue;
    }

    const previousDepth = this.blockNestingDepth;
    this.blockNestingDepth = nestedDepth + 1;
    try {
      const text = source instanceof MarkedSourceView ? source.text : source;
      const token = source instanceof MarkedSourceView
        ? this.withSourceView(source, () => tokenize(text))
        : tokenize(text);
      if (!token) {
        throw new TypeError(
          'Marked nested block reconstruction produced no parser token.',
        );
      }
      if (source instanceof MarkedSourceView) {
        if (!source.text.startsWith(token.raw)) {
          throw new TypeError(
            'Marked reconstructed token is not a prefix of its parser-owned source.',
          );
        }
        this.reconstructedTokenSources.set(
          token,
          source.text.length === token.raw.length
            ? source
            : source.slice(
                markedViewOffset(0),
                markedViewOffset(token.raw.length),
              ),
        );
      }
      return token;
    } finally {
      this.blockNestingDepth = previousDepth;
    }
  }

  replaceReconstructedBlockToken(
    tokens: Token[],
    previous: Token,
    replacement: Token,
    authority: object,
  ): void {
    consumeNativeBlockReconstruction(
      authority,
      this,
      tokens,
      previous,
      replacement,
    );
    const index = tokens.length - 1;
    if (index < 0 || tokens[index] !== previous || previous === replacement) {
      throw new TypeError(
        'Marked nested block reconstruction must replace its exact prior token.',
      );
    }
    appendCriticMarkupBoundaries(
      replacement,
      'before',
      previous.criticMarkupBefore ?? [],
    );
    appendCriticMarkupBoundaries(
      replacement,
      'after',
      previous.criticMarkupAfter ?? [],
    );
    this.provenanceRecorder?.supersedeToken(previous, replacement);
    tokens[index] = replacement;
  }

  /** True when parsing one more block container must become literal residue. */
  blockNestingLimitAppliesToChild(): boolean {
    const limit = this.options.maxBlockNesting;
    return limit !== undefined && this.blockNestingDepth >= limit;
  }

  private blockNestingLimitToken(
    source: LexerSource,
    tokens: Token[],
    depth: number,
    limit: number,
  ): Token[] {
    if (this.provenanceRecorder && !(source instanceof MarkedSourceView)) {
      throw new TypeError(
        'Marked block nesting fallback requires mapped source provenance.',
      );
    }
    if (!this.provenanceRecorder && source instanceof MarkedSourceView) {
      throw new TypeError(
        'Mapped block nesting fallback requires an active provenance recorder.',
      );
    }
    const text = source instanceof MarkedSourceView ? source.text : source;
    if (!text.length) {
      if (source instanceof MarkedSourceView) {
        this.beginProvenanceInvocation('block', source, tokens);
        this.endProvenanceInvocation();
      }
      return tokens;
    }
    const message = `Markdown nested beyond ${limit} block levels is shown as literal source.`;
    const token: Tokens.ParserResidue = {
      type: 'parser_residue',
      raw: text,
      text: text.endsWith('\n') ? text.slice(0, -1) : text,
      level: 'block',
      diagnostic: {
        code: 'marked-block-nesting-limit',
        depth,
        limit,
        message,
      },
    };
    if (source instanceof MarkedSourceView) {
      this.beginProvenanceInvocation('block', source, tokens);
      this.recordResidueConsumption(
        text.length,
        'parser-resource-limit',
        undefined,
        token,
        'source-envelope',
      );
      this.endProvenanceInvocation();
    }
    tokens.push(token);
    return tokens;
  }

  private blockTokensAtDepth(
    source: LexerSource,
    tokens: Token[],
    lastParagraphClipped: boolean,
  ) {
    this.tokenizer.lexer = this;
    let mappedSource: MarkedSourceView<object> | null = null;
    let src: string;
    if (this.provenanceRecorder) {
      if (!(source instanceof MarkedSourceView)) {
        throw new TypeError(
          'Recursive block lexing requires mapped source provenance.',
        );
      }
      mappedSource = source;
      if (this.options.pedantic) {
        mappedSource = replaceMappedSource(
          mappedSource,
          other.tabCharGlobal,
          () => '    ',
        );
        mappedSource = replaceMappedSource(
          mappedSource,
          other.spaceLine,
          () => '',
        );
      }
      src = mappedSource.text;
      this.beginProvenanceInvocation('block', mappedSource, tokens);
    } else {
      if (source instanceof MarkedSourceView) {
        throw new TypeError(
          'Mapped block source requires an active provenance recorder.',
        );
      }
      src = source;
      if (this.options.pedantic) {
        src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
      }
    }

    let srcLength = Infinity;
    while (src) {
      this.setCurrentParserSource(src);
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }

      let token: Tokens.Generic | undefined;

      if (this.options.extensions?.block?.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          this.recordTokenConsumption(token, token.raw.length);
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }

      // newline
      if (token = this.tokenizer.space(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (token.raw.length === 1 && lastToken !== undefined) {
          this.recordTokenConsumption(lastToken, token.raw.length);
          // if there's a single \n as a spacer, it's terminating the last line,
          // so move it there so that we don't get unnecessary paragraph tags
          lastToken.raw += '\n';
        } else {
          this.recordTokenConsumption(token, token.raw.length);
          tokens.push(token);
        }
        continue;
      }

      // code
      if (token = this.tokenizer.code(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        // An indented code block cannot interrupt a paragraph.
        if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
          const consumption = this.recordTokenConsumption(
            lastToken,
            token.raw.length,
          );
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.appendTransformedInlineSource(
            consumption,
            token.text,
            this.tokenizer.rules.other.codeRemoveIndent,
            lastToken.text,
          );
        } else {
          this.recordTokenConsumption(token, token.raw.length);
          tokens.push(token);
        }
        continue;
      }

      // fences
      if (token = this.tokenizer.fences(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // heading
      if (token = this.tokenizer.heading(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // hr
      if (token = this.tokenizer.hr(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // blockquote
      if (token = this.tokenizer.blockquote(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // list
      let listSource = src;
      let listSourceView: MarkedSourceView<object> | null = null;
      if (this.blockNestingDepth > 1 && this.options.extensions?.startBlock) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        for (const getStartIndex of this.options.extensions.startBlock) {
          const candidate = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof candidate === 'number' && candidate >= 0)
            startIndex = Math.min(startIndex, candidate);
        }
        if (startIndex < Infinity) {
          const cut = startIndex + 1;
          listSource = src.substring(0, cut);
          const current = this.currentSourceView;
          if (current) {
            listSourceView = current.slice(
              markedViewOffset(0),
              markedViewOffset(cut),
            );
          }
        }
      }
      token = listSourceView
        ? this.withSourceView(
            listSourceView,
            () => this.tokenizer.list(listSource),
          )
        : this.tokenizer.list(listSource);
      if (token) {
        if (listSource.length < src.length)
          (token as Tokens.List).suppressBlockSeparatorAfter = true;
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // html
      if (token = this.tokenizer.html(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // def
      if (token = this.tokenizer.def(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
          const consumption = this.recordTokenConsumption(
            lastToken,
            token.raw.length,
          );
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.raw;
          this.appendIdentityInlineSource(
            consumption,
            lastToken.text,
          );
        } else if (!this.tokens.links[token.tag]) {
          this.recordTokenConsumption(token, token.raw.length);
          this.tokens.links[token.tag] = {
            href: token.href,
            title: token.title,
          };
          tokens.push(token);
        } else {
          this.recordResidueConsumption(
            token.raw.length,
            'discarded-token',
            token.type,
          );
        }
        continue;
      }

      // table (gfm)
      if (token = this.tokenizer.table(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // lheading
      if (token = this.tokenizer.lheading(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // top-level paragraph
      // prevent paragraph consuming extensions by clipping 'src' to extension start
      let cutSrc = src;
      if (this.options.extensions?.startBlock) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.options.extensions.startBlock.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === 'number' && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
        const lastToken = tokens.at(-1);
        if (lastParagraphClipped && lastToken?.type === 'paragraph') {
          this.recordTokenConsumption(lastToken, token.raw.length);
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.mergeQueuedInlineSource(lastToken.text);
        } else {
          this.recordTokenConsumption(token, token.raw.length);
          tokens.push(token);
        }
        lastParagraphClipped = cutSrc.length !== src.length;
        src = src.substring(token.raw.length);
        continue;
      }

      // text
      if (token = this.tokenizer.text(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          this.recordTokenConsumption(lastToken, token.raw.length);
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.mergeQueuedInlineSource(lastToken.text);
        } else {
          this.recordTokenConsumption(token, token.raw.length);
          tokens.push(token);
        }
        continue;
      }

      if (src) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }

    this.state.top = true;
    this.endProvenanceInvocation();
    return tokens;
  }

  inline(src: LexerSource, tokens?: Token[]): Token[];
  inline(src: LexerSource, tokens: Token[] = []) {
    if (this.provenanceRecorder && !(src instanceof MarkedSourceView)) {
      throw new TypeError(
        'Deferred inline lexing requires mapped source provenance.',
      );
    }
    if (!this.provenanceRecorder && src instanceof MarkedSourceView) {
      throw new TypeError(
        'Mapped inline source requires an active provenance recorder.',
      );
    }
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }

  /**
   * Lexing/Compiling
   */
  inlineTokens(src: LexerSource, tokens?: Token[]): Token[];
  inlineTokens(source: LexerSource, tokens: Token[] = []): Token[] {
    this.tokenizer.lexer = this;
    let src: string;
    if (this.provenanceRecorder) {
      if (!(source instanceof MarkedSourceView)) {
        throw new TypeError(
          'Recursive inline lexing requires mapped source provenance.',
        );
      }
      src = source.text;
      this.beginProvenanceInvocation('inline', source, tokens);
    } else {
      if (source instanceof MarkedSourceView) {
        throw new TypeError(
          'Mapped inline source requires an active provenance recorder.',
        );
      }
      src = source;
    }
    // String with links masked to avoid interference with em and strong
    let maskedSrc = src;
    let match: RegExpExecArray | null = null;

    // Mask out reflinks
    if (this.tokens.links) {
      const links = Object.keys(this.tokens.links);
      if (links.length > 0) {
        while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) !== null) {
          if (links.includes(match[0].slice(match[0].lastIndexOf('[') + 1, -1))) {
            maskedSrc = maskedSrc.slice(0, match.index)
              + '[' + 'a'.repeat(match[0].length - 2) + ']'
              + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
          }
        }
      }
    }

    // Mask out escaped characters
    while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) !== null) {
      maskedSrc = maskedSrc.slice(0, match.index) + '++' + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    }

    // Mask out other blocks
    let offset;
    while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) !== null) {
      offset = match[2] ? match[2].length : 0;
      maskedSrc = maskedSrc.slice(0, match.index + offset) + '[' + 'a'.repeat(match[0].length - offset - 2) + ']' + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    }

    // Mask out blocks from extensions
    maskedSrc = this.options.hooks?.emStrongMask?.call({ lexer: this }, maskedSrc) ?? maskedSrc;

    let keepPrevChar = false;
    let prevChar = '';
    let srcLength = Infinity;
    while (src) {
      this.setCurrentParserSource(src);
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }

      if (!keepPrevChar) {
        prevChar = '';
      }
      keepPrevChar = false;

      let token: Tokens.Generic | undefined;

      // extensions
      if (this.options.extensions?.inline?.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          this.recordTokenConsumption(token, token.raw.length);
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }

      // escape
      if (token = this.tokenizer.escape(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // tag
      if (token = this.tokenizer.tag(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // link
      if (token = this.tokenizer.link(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // reflink, nolink
      if (token = this.tokenizer.reflink(src, this.tokens.links)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (token.type === 'text' && lastToken?.type === 'text') {
          this.recordTokenConsumption(lastToken, token.raw.length);
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          this.recordTokenConsumption(token, token.raw.length);
          tokens.push(token);
        }
        continue;
      }

      // em & strong
      if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // code
      if (token = this.tokenizer.codespan(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // br
      if (token = this.tokenizer.br(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // del (gfm)
      if (token = this.tokenizer.del(src, maskedSrc, prevChar)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // autolink
      if (token = this.tokenizer.autolink(src)) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // url (gfm)
      if (!this.state.inLink && (token = this.tokenizer.url(src))) {
        this.recordTokenConsumption(token, token.raw.length);
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // text
      // prevent inlineText consuming extensions by clipping 'src' to extension start
      let cutSrc = src;
      if (this.options.extensions?.startInline) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.options.extensions.startInline.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === 'number' && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (token = this.tokenizer.inlineText(cutSrc)) {
        src = src.substring(token.raw.length);
        if (token.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
          prevChar = token.raw.slice(-1);
        }
        keepPrevChar = true;
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          this.recordTokenConsumption(lastToken, token.raw.length);
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          this.recordTokenConsumption(token, token.raw.length);
          tokens.push(token);
        }
        continue;
      }

      if (src) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }

    this.endProvenanceInvocation();
    return tokens;
  }

  private startProvenance(level: 'block' | 'inline', source: string) {
    if (
      this.provenanceRecorder
      || this.provenanceCompleted
      || !this.options.sourceProvenance
    ) {
      throw new TypeError(
        'Marked lexer provenance requires one fresh root per lexer.',
      );
    }
    this.provenanceRecorder = this.options.sourceProvenance.create(
      level,
      source,
      this.options,
    );
    if (this.provenanceRecorder.input.text !== source) {
      throw new TypeError(
        'Marked provenance factory returned a detached root source.',
      );
    }
  }

  private beginProvenanceInvocation(
    level: 'block' | 'inline',
    source: MarkedSourceView<object>,
    tokens: Token[] | TokensList,
  ) {
    if (!this.provenanceRecorder) {
      return;
    }
    const invocation = this.provenanceRecorder.beginInvocation(
      level,
      source,
      tokens,
    );
    this.provenanceInvocations.push(invocation);
    this.provenanceParserSources.push(source.text);
  }

  private recordTokenConsumption(
    token: Token,
    length: number,
  ): IMarkedTokenConsumption<object> | null {
    if (!this.provenanceRecorder) {
      return null;
    }
    const invocation = this.provenanceInvocations.at(-1);
    if (!invocation) {
      throw new TypeError(
        'Marked token consumption has no active parser invocation.',
      );
    }
    const consumption = this.provenanceRecorder.consumeToken(
      invocation,
      token,
      length,
    );
    const extensions = this.options.extensions?.sourceBoundary ?? [];
    for (const extension of extensions) {
      const attachments = extension.call(
        { lexer: this },
        token,
        consumption.source,
        invocation.level,
      ) ?? [];
      appendCriticMarkupBoundaries(
        token,
        'before',
        attachments.filter(attachment => attachment.edge === 'before'),
      );
      appendCriticMarkupBoundaries(
        token,
        'after',
        attachments.filter(attachment => attachment.edge === 'after'),
      );
    }
    return consumption;
  }

  /**
   * Offer a tokenizer-internal token (one that never passes through
   * blockTokens consumption, e.g. a list item) to the source-boundary
   * extensions so boundary attachments can anchor to it. `source` is the
   * token's raw envelope in the active provenance domain.
   */
  recordNestedTokenBoundary(
    token: Token,
    source: MarkedSourceView<object> | null,
  ): void {
    if (!this.provenanceRecorder || !source) {
      return;
    }
    const extensions = this.options.extensions?.sourceBoundary ?? [];
    for (const extension of extensions) {
      const attachments = extension.call(
        { lexer: this },
        token,
        source,
        'block',
      ) ?? [];
      appendCriticMarkupBoundaries(
        token,
        'before',
        attachments.filter(attachment => attachment.edge === 'before'),
      );
      appendCriticMarkupBoundaries(
        token,
        'after',
        attachments.filter(attachment => attachment.edge === 'after'),
      );
    }
  }

  private recordResidueConsumption(
    length: number,
    reason: 'discarded-token' | 'consumed-without-token' | 'parser-resource-limit',
    discardedTokenType?: string,
    literalToken?: Token,
    coverage?: 'mapped-spans' | 'source-envelope',
  ) {
    if (!this.provenanceRecorder) {
      return;
    }
    const invocation = this.provenanceInvocations.at(-1);
    if (!invocation) {
      throw new TypeError(
        'Marked residue consumption has no active parser invocation.',
      );
    }
    this.provenanceRecorder.consumeResidue(
      invocation,
      length,
      reason,
      discardedTokenType,
      literalToken,
      coverage,
    );
  }

  private endProvenanceInvocation() {
    if (!this.provenanceRecorder) {
      return;
    }
    const invocation = this.provenanceInvocations.pop();
    const parserSource = this.provenanceParserSources.pop();
    if (!invocation || parserSource === undefined) {
      throw new TypeError(
        'Marked provenance has no parser invocation to end.',
      );
    }
    this.provenanceRecorder.endInvocation(invocation);
  }

  private setCurrentParserSource(source: string) {
    if (!this.provenanceRecorder) {
      return;
    }
    const index = this.provenanceParserSources.length - 1;
    if (index < 0) {
      throw new TypeError(
        'Marked parser source has no active provenance invocation.',
      );
    }
    this.provenanceParserSources[index] = source;
  }

  private completeProvenance(
    level: 'block' | 'inline',
    tokens: Token[] | TokensList,
  ) {
    if (!this.provenanceRecorder || this.provenanceCompleted) {
      throw new TypeError(
        'Marked lexer provenance cannot complete this root.',
      );
    }
    if (this.provenanceInvocations.length) {
      throw new TypeError(
        'Marked lexer provenance cannot complete an active parser.',
      );
    }
    this.provenanceRecorder.complete(level, tokens);
    this.provenanceCompleted = true;
  }

  private appendTransformedInlineSource(
    consumption: IMarkedTokenConsumption<object> | null,
    text: string,
    expression: RegExp,
    expected: string,
  ) {
    if (!this.provenanceRecorder) {
      this.inlineQueue.at(-1)!.src = expected;
      return;
    }
    if (!consumption) {
      throw new TypeError(
        'Mapped inline source requires its token consumption.',
      );
    }
    const source = replaceMappedSource(
      consumption.source,
      expression,
      () => '',
    );
    if (source.text !== text) {
      throw new TypeError(
        'Marked code transformation differs from its mapped source.',
      );
    }
    this.appendMappedInlineSource(source, expected);
  }

  private appendIdentityInlineSource(
    consumption: IMarkedTokenConsumption<object> | null,
    expected: string,
  ) {
    if (!this.provenanceRecorder) {
      this.inlineQueue.at(-1)!.src = expected;
      return;
    }
    if (!consumption) {
      throw new TypeError(
        'Mapped inline source requires its token consumption.',
      );
    }
    this.appendMappedInlineSource(consumption.source, expected);
  }

  private appendMappedInlineSource(
    source: MarkedSourceView<object>,
    expected: string,
  ) {
    const queued = this.inlineQueue.at(-1);
    if (!queued || !(queued.src instanceof MarkedSourceView)) {
      throw new TypeError(
        'Marked token merge has no mapped inline source to extend.',
      );
    }
    const separator = mappedLineSeparator(queued.src, source);
    const merged = MarkedSourceView.concat([
      queued.src,
      separator,
      source,
    ]);
    if (merged.text !== expected) {
      throw new TypeError(
        'Marked token merge differs from its mapped inline source.',
      );
    }
    queued.src = merged;
  }

  private mergeQueuedInlineSource(expected: string) {
    if (!this.provenanceRecorder) {
      this.inlineQueue.pop();
      this.inlineQueue.at(-1)!.src = expected;
      return;
    }
    const appended = this.inlineQueue.pop();
    const queued = this.inlineQueue.at(-1);
    if (
      !appended
      || !queued
      || !(appended.src instanceof MarkedSourceView)
      || !(queued.src instanceof MarkedSourceView)
    ) {
      throw new TypeError(
        'Marked token merge requires two mapped inline sources.',
      );
    }
    const separator = mappedLineSeparator(queued.src, appended.src);
    const merged = MarkedSourceView.concat([
      queued.src,
      separator,
      appended.src,
    ]);
    if (merged.text !== expected) {
      throw new TypeError(
        'Marked token merge differs from its queued inline sources.',
      );
    }
    queued.src = merged;
  }

  private infiniteLoopError(byte: number) {
    const errMsg = 'Infinite loop on byte: ' + byte;
    if (this.options.silent) {
      console.error(errMsg);
    } else {
      throw new Error(errMsg);
    }
  }
}
