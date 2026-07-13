import { _defaults } from './defaults.ts';
import {
  rtrim,
  splitCells,
  splitCellSourceRanges,
  findClosingBracket,
  expandTabs,
  trimTrailingBlankLines,
} from './helpers.ts';
import type { Rules } from './rules.ts';
import type { _Lexer } from './Lexer.ts';
import type { Links, Tokens, Token } from './Tokens.ts';
import type { MarkedOptions } from './MarkedOptions.ts';
import {
  MarkedSourceView,
  markedViewOffset,
} from './SourceProvenance.ts';

type MappedLexerSource = string | MarkedSourceView<object>;

function trailingBlankLineCount(raw: string): number {
  let cursor = raw.length;
  if (!cursor || raw[cursor - 1] !== '\n') {
    return 0;
  }
  cursor--;
  if (cursor && raw[cursor - 1] === '\r') {
    cursor--;
  }

  let count = 0;
  while (cursor >= 0) {
    const lineEnd = cursor;
    let lineStart = lineEnd;
    while (lineStart > 0 && raw[lineStart - 1] !== '\n') {
      lineStart--;
    }
    let blank = true;
    for (let index = lineStart; index < lineEnd; index++) {
      const character = raw[index];
      if (character !== ' ' && character !== '\t' && character !== '\r') {
        blank = false;
        break;
      }
    }
    if (!blank) {
      break;
    }
    count++;
    if (!lineStart) {
      break;
    }
    cursor = lineStart - 1;
    if (cursor && raw[cursor - 1] === '\r') {
      cursor--;
    }
  }
  return count;
}

interface INativeBlockReconstruction {
  readonly lexer: _Lexer;
  readonly tokens: Token[];
  readonly previous: Token;
  readonly replacement: Token;
}

const NATIVE_BLOCK_RECONSTRUCTIONS = new WeakMap<
  object,
  INativeBlockReconstruction
>();

function nativeBlockReconstruction(
  lexer: _Lexer,
  tokens: Token[],
  previous: Token,
  replacement: Token,
): object {
  const authority = Object.freeze({});
  NATIVE_BLOCK_RECONSTRUCTIONS.set(authority, {
    lexer,
    tokens,
    previous,
    replacement,
  });
  return authority;
}

export function consumeNativeBlockReconstruction(
  authority: object,
  lexer: _Lexer,
  tokens: Token[],
  previous: Token,
  replacement: Token,
): void {
  const expected = NATIVE_BLOCK_RECONSTRUCTIONS.get(authority);
  NATIVE_BLOCK_RECONSTRUCTIONS.delete(authority);
  if (
    !expected
    || expected.lexer !== lexer
    || expected.tokens !== tokens
    || expected.previous !== previous
    || expected.replacement !== replacement
  ) {
    throw new TypeError(
      'Marked native block reconstruction authority is missing, reused, or detached.',
    );
  }
}

function currentSourceView(
  lexer: _Lexer,
  source: string,
): MarkedSourceView<object> | null {
  const view = lexer.currentSourceView;
  if (view && view.text.length < source.length) {
    throw new TypeError(
      'Marked tokenizer source exceeds its active mapped input.',
    );
  }
  return view && view.text.length !== source.length
    ? view.slice(
        markedViewOffset(0),
        markedViewOffset(source.length),
      )
    : view;
}

function mappedPrefix(
  lexer: _Lexer,
  source: string,
  length: number,
): MarkedSourceView<object> | null {
  const view = currentSourceView(lexer, source);
  return view?.slice(markedViewOffset(0), markedViewOffset(length)) ?? null;
}

function lexerSource(
  text: string,
  source: MarkedSourceView<object> | null,
): MappedLexerSource {
  if (source && source.text !== text) {
    throw new TypeError(
      'Marked child parser text differs from its mapped source view.',
    );
  }
  return source ?? text;
}

function trimMapped(
  source: MarkedSourceView<object>,
  side: 'both' | 'end' | 'start' = 'both',
): MarkedSourceView<object> {
  const start = side === 'end'
    ? 0
    : source.text.length - source.text.trimStart().length;
  const unclampedEnd = side === 'start'
    ? source.text.length
    : source.text.trimEnd().length;
  const end = Math.max(start, unclampedEnd);
  return source.slice(markedViewOffset(start), markedViewOffset(end));
}

function replaceMapped(
  source: MarkedSourceView<object>,
  expression: RegExp,
  replacement: (
    match: RegExpExecArray,
    matched: MarkedSourceView<object>,
  ) => readonly MarkedSourceView<object>[],
): MarkedSourceView<object> {
  if (!expression.global) {
    throw new TypeError('Mapped tokenizer replacement requires a global rule.');
  }
  const matcher = new RegExp(expression.source, expression.flags);
  const parts: MarkedSourceView<object>[] = [];
  let offset = 0;
  let changed = false;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source.text)) !== null) {
    if (!match[0].length) {
      throw new TypeError('Mapped tokenizer replacement cannot be empty.');
    }
    changed = true;
    if (offset < match.index) {
      parts.push(source.slice(
        markedViewOffset(offset),
        markedViewOffset(match.index),
      ));
    }
    const matched = source.slice(
      markedViewOffset(match.index),
      markedViewOffset(match.index + match[0].length),
    );
    parts.push(...replacement(match, matched));
    offset = match.index + match[0].length;
  }
  if (!changed)
    return source;
  if (offset < source.text.length) {
    parts.push(source.slice(
      markedViewOffset(offset),
      markedViewOffset(source.text.length),
    ));
  }
  if (!parts.length) {
    parts.push(source.slice(
      markedViewOffset(offset),
      markedViewOffset(offset),
    ));
  }
  return MarkedSourceView.concat(parts, source.document);
}

function expandTabsMapped(
  source: MarkedSourceView<object>,
  initialColumn = 0,
  tabStops = true,
): MarkedSourceView<object> {
  const parts: MarkedSourceView<object>[] = [];
  let start = 0;
  let column = initialColumn;
  for (let index = 0; index < source.text.length; index++) {
    if (source.text[index] !== '\t') {
      column++;
      continue;
    }
    if (start < index) {
      parts.push(source.slice(
        markedViewOffset(start),
        markedViewOffset(index),
      ));
    }
    const width = tabStops ? 4 - column % 4 : 4;
    parts.push(source.generated(
      ' '.repeat(width),
      markedViewOffset(index),
      markedViewOffset(index + 1),
    ));
    column += width;
    start = index + 1;
  }
  if (!parts.length)
    return source;
  if (start < source.text.length) {
    parts.push(source.slice(
      markedViewOffset(start),
      markedViewOffset(source.text.length),
    ));
  }
  return MarkedSourceView.concat(parts, source.document);
}

function unescapeLinkText(
  source: MarkedSourceView<object>,
): MarkedSourceView<object> {
  return replaceMapped(source, /\\([\[\]])/g, (_match, matched) => [
    matched.slice(markedViewOffset(1), markedViewOffset(2)),
  ]);
}

function blockquoteTextView(
  source: MarkedSourceView<object>,
  rules: Rules,
): MarkedSourceView<object> {
  const protectedSetext = replaceMapped(
    source,
    rules.other.blockquoteSetextReplace,
    (match, matched) => {
      const captured = match[1];
      const captureStart = match[0].lastIndexOf(captured);
      return [
        matched.slice(markedViewOffset(0), markedViewOffset(1)),
        matched.generated(
          '    ',
          markedViewOffset(captureStart),
          markedViewOffset(captureStart),
        ),
        matched.slice(
          markedViewOffset(captureStart),
          markedViewOffset(captureStart + captured.length),
        ),
      ];
    },
  );
  return replaceMapped(
    protectedSetext,
    rules.other.blockquoteSetextReplace2,
    () => [],
  );
}

interface IMappedTableCell {
  readonly text: string;
  readonly source: MarkedSourceView<object>;
}

function splitMappedCells(
  source: MarkedSourceView<object>,
  rules: Rules,
  count?: number,
): IMappedTableCell[] {
  const ranges = splitCellSourceRanges(source.text, count);

  const cells = ranges.map((range) => {
    let view = trimMapped(source.slice(
      markedViewOffset(range.start),
      markedViewOffset(range.end),
    ));
    view = replaceMapped(view, rules.other.slashPipe, (_match, matched) => [
      matched.slice(
        markedViewOffset(matched.text.length - 1),
        markedViewOffset(matched.text.length),
      ),
    ]);
    return { text: view.text, source: view };
  });
  const expected = splitCells(source.text, count);
  if (
    expected.length !== cells.length
    || expected.some((text, index) => text !== cells[index].text)
  ) {
    throw new TypeError(
      'Marked table-cell mapping differs from its tokenizer split.',
    );
  }
  return cells;
}

function tableRowSourceSyntax(
  source: string,
  rules: Rules,
  count?: number,
): Tokens.TableRowSourceSyntax {
  const ranges = splitCellSourceRanges(source, count);
  const cells = ranges.map(range => source.slice(range.start, range.end));
  const segments: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.end < range.start) {
      throw new TypeError('Marked table-cell source ranges overlap.');
    }
    segments.push(source.slice(cursor, range.start));
    cursor = range.end;
  }
  segments.push(source.slice(cursor));

  const reconstructed = cells.reduce(
    (row, cell, index) => row + cell + segments[index + 1],
    segments[0],
  );
  if (
    segments.length !== cells.length + 1
    || reconstructed !== source
  ) {
    throw new TypeError(
      'Marked table row source syntax does not reconstruct its parser input.',
    );
  }

  const expected = splitCells(source, count);
  const decoded = cells.map(cell => cell.replace(rules.other.slashPipe, '|'));
  if (
    expected.length !== decoded.length
    || expected.some((cell, index) => cell !== decoded[index])
  ) {
    throw new TypeError(
      'Marked table row source syntax differs from its tokenizer split.',
    );
  }

  return Object.freeze({
    cells: Object.freeze(cells),
    segments: Object.freeze(segments),
  });
}

function outputLink(cap: string[], link: Pick<Tokens.Link, 'href' | 'title'>, raw: string, lexer: _Lexer, rules: Rules): Tokens.Link | Tokens.Image {
  const href = link.href;
  const title = link.title || null;
  const text = cap[1].replace(rules.other.outputLinkReplace, '$1');
  const rawView = mappedPrefix(lexer, raw, raw.length);
  const labelStart = raw.startsWith('!') ? 2 : 1;
  const labelView = rawView
    ? unescapeLinkText(rawView.slice(
        markedViewOffset(labelStart),
        markedViewOffset(labelStart + cap[1].length),
      ))
    : null;

  lexer.state.inLink = true;
  const token: Tokens.Link | Tokens.Image = {
    type: cap[0].charAt(0) === '!' ? 'image' : 'link',
    raw,
    href,
    title,
    text,
    tokens: lexer.inlineTokens(lexerSource(text, labelView)),
  };
  lexer.state.inLink = false;
  return token;
}

function indentCodeCompensation(raw: string, text: string, rules: Rules) {
  const matchIndentToCode = raw.match(rules.other.indentCodeCompensation);

  if (matchIndentToCode === null) {
    return text;
  }

  const indentToCode = matchIndentToCode[1];

  return text
    .split('\n')
    .map(node => {
      const matchIndentInNode = node.match(rules.other.beginningSpace);
      if (matchIndentInNode === null) {
        return node;
      }

      const [indentInNode] = matchIndentInNode;

      if (indentInNode.length >= indentToCode.length) {
        return node.slice(indentToCode.length);
      }

      return node;
    })
    .join('\n');
}

/**
 * Tokenizer
 */
export class _Tokenizer<ParserOutput = string, RendererOutput = string> {
  options: MarkedOptions<ParserOutput, RendererOutput>;
  rules!: Rules; // set by the lexer
  lexer!: _Lexer<ParserOutput, RendererOutput>; // set by the lexer

  constructor(options?: MarkedOptions<ParserOutput, RendererOutput>) {
    this.options = options || _defaults;
  }

  space(src: string): Tokens.Space | undefined {
    const cap = this.rules.block.newline.exec(src);
    if (cap && cap[0].length > 0) {
      return {
        type: 'space',
        raw: cap[0],
      };
    }
  }

  code(src: string): Tokens.Code | undefined {
    const cap = this.rules.block.code.exec(src);
    if (cap) {
      const raw = this.options.pedantic
        ? cap[0]
        : trimTrailingBlankLines(cap[0]);
      const text = raw.replace(this.rules.other.codeRemoveIndent, '');
      return {
        type: 'code',
        raw,
        codeBlockStyle: 'indented',
        text,
      };
    }
  }

  fences(src: string): Tokens.Code | undefined {
    const cap = this.rules.block.fences.exec(src);
    if (cap) {
      const raw = cap[0];
      const text = indentCodeCompensation(raw, cap[3] || '', this.rules);
      const withoutTerminalEol = raw.endsWith('\n')
        ? raw.slice(0, -1)
        : raw;
      const lastLineStart = withoutTerminalEol.lastIndexOf('\n') + 1;
      const lastLine = withoutTerminalEol.slice(lastLineStart);
      const indentation = /^ {0,3}/.exec(lastLine)?.[0] ?? '';
      const closingCandidate = lastLine
        .slice(indentation.length)
        .trimEnd();
      const fenceCharacter = cap[1][0];
      const closingFence = closingCandidate.length >= cap[1].length
        && [...closingCandidate].every(character =>
          character === fenceCharacter)
        ? lastLine
        : null;

      return {
        type: 'code',
        raw,
        lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, '$1') : cap[2],
        text,
        sourceSyntax: {
          openingFence: cap[1],
          closingFence,
        },
      };
    }
  }

  heading(src: string): Tokens.Heading | undefined {
    const cap = this.rules.block.heading.exec(src);
    if (cap) {
      let text = cap[2].trim();
      const rawView = mappedPrefix(this.lexer, src, rtrim(cap[0], '\n').length);
      const captureStart = cap[0].indexOf(cap[2], cap[1].length);
      let textView = rawView
        ? trimMapped(rawView.slice(
            markedViewOffset(captureStart),
            markedViewOffset(captureStart + cap[2].length),
          ))
        : null;

      // remove trailing #s
      if (this.rules.other.endingHash.test(text)) {
        const trimmed = rtrim(text, '#');
        if (this.options.pedantic) {
          text = trimmed.trim();
        } else if (!trimmed || this.rules.other.endingSpaceChar.test(trimmed)) {
          // CommonMark requires space before trailing #s
          text = trimmed.trim();
        }
      }
      if (textView) {
        const finalStart = textView.text.indexOf(text);
        if (finalStart < 0) {
          throw new TypeError(
            'Marked heading text differs from its parser capture.',
          );
        }
        textView = textView.slice(
          markedViewOffset(finalStart),
          markedViewOffset(finalStart + text.length),
        );
      }

      return {
        type: 'heading',
        raw: rtrim(cap[0], '\n'),
        depth: cap[1].length,
        text,
        tokens: this.lexer.inline(lexerSource(text, textView)),
      };
    }
  }

  hr(src: string): Tokens.Hr | undefined {
    const cap = this.rules.block.hr.exec(src);
    if (cap) {
      return {
        type: 'hr',
        raw: rtrim(cap[0], '\n'),
      };
    }
  }

  blockquote(src: string): Tokens.Blockquote | undefined {
    const cap = this.rules.block.blockquote.exec(src);
    if (cap) {
      const matchedRaw = rtrim(cap[0], '\n');
      let lines = matchedRaw.split('\n');
      let raw = '';
      let text = '';
      let rawSource: MarkedSourceView<object> | null = null;
      let textSource: MarkedSourceView<object> | null = null;
      let sourceCursor = 0;
      const tokens: Token[] = [];
      const sourceView = mappedPrefix(
        this.lexer,
        src,
        matchedRaw.length,
      );

      // A lazy continuation is split into segments by the ordinary Marked
      // algorithm. At the parser resource boundary those segments must become
      // one literal subtree, otherwise reconstruction can bypass the depth
      // budget and manufacture multiple sibling fallbacks. Transform the
      // complete blockquote body once and let the parser-owned block entry
      // create the single residue envelope.
      if (this.lexer.blockNestingLimitAppliesToChild()) {
        raw = matchedRaw;
        text = raw
          .replace(this.rules.other.blockquoteSetextReplace, '\n    $1')
          .replace(this.rules.other.blockquoteSetextReplace2, '');
        textSource = sourceView
          ? blockquoteTextView(sourceView, this.rules)
          : null;
        if (textSource && textSource.text !== text) {
          throw new TypeError(
            'Marked resource-limited blockquote differs from its mapped source.',
          );
        }
        this.lexer.blockTokens(
          lexerSource(text, textSource),
          tokens,
        );
        return {
          type: 'blockquote',
          raw,
          tokens,
          text,
        };
      }

      while (lines.length > 0) {
        let inBlockquote = false;
        const currentLines = [];

        let i;
        for (i = 0; i < lines.length; i++) {
          // get lines up to a continuation
          if (this.rules.other.blockquoteStart.test(lines[i])) {
            currentLines.push(lines[i]);
            inBlockquote = true;
          } else if (!inBlockquote) {
            currentLines.push(lines[i]);
          } else {
            break;
          }
        }
        lines = lines.slice(i);

        const currentRaw = currentLines.join('\n');
        const currentRawStart = sourceCursor;
        const currentRawView = sourceView?.slice(
          markedViewOffset(currentRawStart),
          markedViewOffset(currentRawStart + currentRaw.length),
        ) ?? null;
        const currentText = currentRaw
          // precede setext continuation with 4 spaces so it isn't a setext
          .replace(this.rules.other.blockquoteSetextReplace, '\n    $1')
          .replace(this.rules.other.blockquoteSetextReplace2, '');
        const currentTextView = currentRawView
          ? blockquoteTextView(currentRawView, this.rules)
          : null;
        if (currentTextView && currentTextView.text !== currentText) {
          throw new TypeError(
            'Marked blockquote transformation differs from its mapped source '
            + `(parser length ${currentText.length}, mapped length ${currentTextView.text.length}).`,
          );
        }
        const join = raw && sourceView
          ? sourceView.slice(
              markedViewOffset(currentRawStart - 1),
              markedViewOffset(currentRawStart),
            )
          : null;
        raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
        text = text ? `${text}\n${currentText}` : currentText;
        if (currentRawView) {
          rawSource = rawSource
            ? MarkedSourceView.concat([rawSource, join!, currentRawView])
            : currentRawView;
        }
        if (currentTextView) {
          textSource = textSource
            ? MarkedSourceView.concat([textSource, join!, currentTextView])
            : currentTextView;
        }
        sourceCursor = currentRawStart
          + currentRaw.length
          + (lines.length ? 1 : 0);

        // parse blockquote lines as top level tokens
        // merge paragraphs if this is a continuation
        const top = this.lexer.state.top;
        this.lexer.state.top = true;
        this.lexer.blockTokens(
          lexerSource(currentText, currentTextView),
          tokens,
          true,
        );
        this.lexer.state.top = top;

        // if there is no continuation then we are done
        if (lines.length === 0) {
          break;
        }

        const lastToken = tokens.at(-1);

        if (lastToken?.type === 'code') {
          // blockquote continuation cannot be preceded by a code block
          break;
        } else if (lastToken?.type === 'blockquote') {
          // include continuation in nested blockquote
          const oldToken = lastToken as Tokens.Blockquote;
          const newText = oldToken.raw + '\n' + lines.join('\n');
          const oldTokenSource = this.lexer.sourceViewForParsedToken(
            tokens,
            oldToken,
          );
          if (!text.endsWith(oldToken.raw)) {
            throw new TypeError(
              'Marked nested blockquote is not the terminal parser token source.',
            );
          }
          const textPrefixLength = text.length - oldToken.raw.length;
          const remainingStart = sourceCursor;
          const newTextSource = oldTokenSource && sourceView
            ? MarkedSourceView.concat([
                oldTokenSource,
                sourceView.slice(
                  markedViewOffset(remainingStart - 1),
                  markedViewOffset(remainingStart),
                ),
                sourceView.slice(
                  markedViewOffset(remainingStart),
                  markedViewOffset(remainingStart + lines.join('\n').length),
                ),
              ])
            : null;
          const newToken = this.lexer.reparseNestedBlockToken(
            lexerSource(newText, newTextSource),
            nestedSource => this.blockquote(nestedSource),
          );
          this.lexer.replaceReconstructedBlockToken(
            tokens,
            oldToken,
            newToken,
            nativeBlockReconstruction(
              this.lexer,
              tokens,
              oldToken,
              newToken,
            ),
          );

          text = text.slice(0, textPrefixLength) + newToken.raw;
          if (textSource && newTextSource) {
            textSource = MarkedSourceView.concat([
              textSource.slice(
                markedViewOffset(0),
                markedViewOffset(textPrefixLength),
              ),
              newTextSource.slice(
                markedViewOffset(0),
                markedViewOffset(newToken.raw.length),
              ),
            ]);
          }
          raw = matchedRaw;
          break;
        } else if (lastToken?.type === 'list') {
          // include continuation in nested list
          const oldToken = lastToken as Tokens.List;
          const newText = oldToken.raw + '\n' + lines.join('\n');
          const oldTokenSource = this.lexer.sourceViewForParsedToken(
            tokens,
            oldToken,
          );
          if (!text.endsWith(oldToken.raw)) {
            throw new TypeError(
              'Marked nested list is not the terminal parser token source.',
            );
          }
          const textPrefixLength = text.length - oldToken.raw.length;
          const remainingStart = sourceCursor;
          const newTextSource = oldTokenSource && sourceView
            ? MarkedSourceView.concat([
                oldTokenSource,
                sourceView.slice(
                  markedViewOffset(remainingStart - 1),
                  markedViewOffset(remainingStart),
                ),
                sourceView.slice(
                  markedViewOffset(remainingStart),
                  markedViewOffset(remainingStart + lines.join('\n').length),
                ),
              ])
            : null;
          const newToken = this.lexer.reparseNestedBlockToken(
            lexerSource(newText, newTextSource),
            nestedSource => this.list(nestedSource),
          );
          this.lexer.replaceReconstructedBlockToken(
            tokens,
            oldToken,
            newToken,
            nativeBlockReconstruction(
              this.lexer,
              tokens,
              oldToken,
              newToken,
            ),
          );

          text = text.slice(0, textPrefixLength) + newToken.raw;
          if (textSource && newTextSource) {
            textSource = MarkedSourceView.concat([
              textSource.slice(
                markedViewOffset(0),
                markedViewOffset(textPrefixLength),
              ),
              newTextSource.slice(
                markedViewOffset(0),
                markedViewOffset(newToken.raw.length),
              ),
            ]);
          }
          if (newToken.type === 'parser_residue') {
            raw = matchedRaw;
            lines = [];
            break;
          }
          const rebuiltPrefixLength = oldToken.raw.length + 1;
          const consumedContinuation = Math.max(
            0,
            Math.min(
              lines.join('\n').length,
              newToken.raw.length - rebuiltPrefixLength,
            ),
          );
          sourceCursor = remainingStart + consumedContinuation;
          let remainingText = newText.substring(newToken.raw.length);
          if (remainingText.startsWith('\n')) {
            sourceCursor++;
            remainingText = remainingText.substring(1);
          }
          lines = remainingText ? remainingText.split('\n') : [];
          raw = matchedRaw.slice(
            0,
            sourceCursor - (lines.length ? 1 : 0),
          );
          continue;
        }
      }

      if (raw.length > matchedRaw.length) {
        const extra = raw.slice(matchedRaw.length);
        if (
          !raw.startsWith(matchedRaw)
          || !extra.length
          || /[^\n]/.test(extra)
          || !text.endsWith(extra)
        ) {
          throw new TypeError(
            'Marked blockquote reconstruction differs from its parser capture '
            + `(rebuilt length ${raw.length}, capture length ${matchedRaw.length}).`,
          );
        }
        raw = matchedRaw;
        text = text.slice(0, -extra.length);
      } else if (!matchedRaw.startsWith(raw)) {
        let mismatch = 0;
        const commonLength = Math.min(matchedRaw.length, raw.length);
        while (mismatch < commonLength && matchedRaw[mismatch] === raw[mismatch]) {
          mismatch++;
        }
        throw new TypeError(
          'Marked blockquote reconstruction is not a parser-capture prefix '
          + `(rebuilt length ${raw.length}, capture length ${matchedRaw.length}, `
          + `first mismatch ${mismatch}, rebuilt ${JSON.stringify(raw.slice(mismatch, mismatch + 40))}, `
          + `capture ${JSON.stringify(matchedRaw.slice(mismatch, mismatch + 40))}).`,
        );
      }

      return {
        type: 'blockquote',
        raw,
        tokens,
        text,
      };
    }
  }

  list(src: string): Tokens.List | undefined {
    const listSource = currentSourceView(this.lexer, src);
    const listSourceLength = src.length;
    const itemSources: Array<MarkedSourceView<object> | null> = [];
    let cap = this.rules.block.list.exec(src);
    if (cap) {
      let bull = cap[1].trim();
      const isordered = bull.length > 1;

      const list: Tokens.List = {
        type: 'list',
        raw: '',
        ordered: isordered,
        start: isordered ? +bull.slice(0, -1) : '',
        loose: false,
        items: [],
      };

      bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;

      if (this.options.pedantic) {
        bull = isordered ? bull : '[*+-]';
      }

      // Get next list item
      const itemRegex = this.rules.other.listItemRegex(bull);
      let endsWithBlankLine = false;
      // Check if current bullet point can start a new List Item
      while (src) {
        let endEarly = false;
        let raw = '';
        let itemContents = '';
        const continuationPrefixes: string[] = [];
        const itemParts: MarkedSourceView<object>[] = [];
        const itemSourceStart = listSourceLength - src.length;
        if (!(cap = itemRegex.exec(src))) {
          break;
        }
        const markerCapture = cap[1];
        const marker = markerCapture.trim();
        if (!markerCapture.endsWith(marker)) {
          throw new TypeError(
            'Marked list marker is not a suffix of its parser capture.',
          );
        }
        const leadingPrefix = markerCapture.slice(
          0,
          markerCapture.length - marker.length,
        );

        if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
          break;
        }

        raw = cap[0];
        src = src.substring(raw.length);

        const firstLine = cap[2].split('\n', 1)[0];
        const firstLineStart = cap[0].indexOf(cap[2], cap[1].length);
        let lineView = listSource?.slice(
          markedViewOffset(itemSourceStart + firstLineStart),
          markedViewOffset(itemSourceStart + firstLineStart + firstLine.length),
        ) ?? null;
        if (lineView)
          lineView = expandTabsMapped(lineView, cap[1].length);
        let line = expandTabs(firstLine, cap[1].length);
        if (lineView && lineView.text !== line) {
          throw new TypeError(
            'Marked list first-line expansion differs from its mapped source.',
          );
        }
        let nextLine = src.split('\n', 1)[0];
        let blankLine = !line.trim();

        let indent = 0;
        let markerPadding = '';
        if (this.options.pedantic) {
          indent = 2;
          itemContents = line.trimStart();
          markerPadding = line.slice(0, line.length - itemContents.length);
          if (lineView)
            itemParts.push(trimMapped(lineView, 'start'));
        } else if (blankLine) {
          indent = cap[1].length + 1;
          markerPadding = line;
        } else {
          indent = line.search(this.rules.other.nonSpaceChar); // Find first non-space char
          indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
          markerPadding = line.slice(0, indent);
          itemContents = line.slice(indent);
          if (lineView) {
            itemParts.push(lineView.slice(
              markedViewOffset(Math.min(indent, lineView.text.length)),
              markedViewOffset(lineView.text.length),
            ));
          }
          indent += cap[1].length;
        }

        if (blankLine && this.rules.other.blankLine.test(nextLine)) { // Items begin with at most one blank line
          raw += nextLine + '\n';
          src = src.substring(nextLine.length + 1);
          endEarly = true;
        }

        if (!endEarly) {
          const nextBulletRegex = this.rules.other.nextBulletRegex(indent);
          const hrRegex = this.rules.other.hrRegex(indent);
          const fencesBeginRegex = this.rules.other.fencesBeginRegex(indent);
          const headingBeginRegex = this.rules.other.headingBeginRegex(indent);
          const htmlBeginRegex = this.rules.other.htmlBeginRegex(indent);
          const blockquoteBeginRegex = this.rules.other.blockquoteBeginRegex(indent);

          // Check if following lines should be included in List Item
          while (src) {
            const rawLine = src.split('\n', 1)[0];
            const rawLineStart = listSourceLength - src.length;
            const rawLineView = listSource?.slice(
              markedViewOffset(rawLineStart),
              markedViewOffset(rawLineStart + rawLine.length),
            ) ?? null;
            let nextLineWithoutTabs;
            let nextLineView = rawLineView;
            nextLine = rawLine;

            // Re-align to follow commonmark nesting rules
            if (this.options.pedantic) {
              nextLine = nextLine.replace(this.rules.other.listReplaceNesting, '  ');
              nextLineWithoutTabs = nextLine;
              if (nextLineView) {
                const nesting = new RegExp(
                  this.rules.other.listReplaceNesting.source,
                  this.rules.other.listReplaceNesting.flags.includes('g')
                    ? this.rules.other.listReplaceNesting.flags
                    : `${this.rules.other.listReplaceNesting.flags}g`,
                );
                nextLineView = replaceMapped(
                  nextLineView,
                  nesting,
                  (_match, matched) => [matched.generated(
                    '  ',
                    markedViewOffset(0),
                    markedViewOffset(matched.text.length),
                  )],
                );
              }
            } else {
              nextLineWithoutTabs = nextLine.replace(this.rules.other.tabCharGlobal, '    ');
              if (nextLineView)
                nextLineView = expandTabsMapped(nextLineView, 0, false);
            }
            if (nextLineView && nextLineView.text !== nextLineWithoutTabs) {
              throw new TypeError(
                'Marked list continuation differs from its mapped source.',
              );
            }

            // End list item if found code fences
            if (fencesBeginRegex.test(nextLine)) {
              break;
            }

            // End list item if found start of new heading
            if (headingBeginRegex.test(nextLine)) {
              break;
            }

            // End list item if found start of html block
            if (htmlBeginRegex.test(nextLine)) {
              break;
            }

            // End list item if found start of blockquote
            if (blockquoteBeginRegex.test(nextLine)) {
              break;
            }

            // End list item if found start of new bullet
            if (nextBulletRegex.test(nextLine)) {
              break;
            }

            // Horizontal rule found
            if (hrRegex.test(nextLine)) {
              break;
            }

            if (nextLineWithoutTabs.search(this.rules.other.nonSpaceChar) >= indent || !nextLine.trim()) { // Dedent if possible
              itemContents += '\n' + nextLineWithoutTabs.slice(indent);
              continuationPrefixes.push(nextLineWithoutTabs.slice(
                0,
                Math.min(indent, nextLineWithoutTabs.length),
              ));
              if (nextLineView && listSource) {
                itemParts.push(listSource.slice(
                  markedViewOffset(Math.max(0, rawLineStart - 1)),
                  markedViewOffset(rawLineStart),
                ));
                itemParts.push(nextLineView.slice(
                  markedViewOffset(Math.min(indent, nextLineView.text.length)),
                  markedViewOffset(nextLineView.text.length),
                ));
              }
            } else {
              // not enough indentation
              if (blankLine) {
                break;
              }

              // paragraph continuation unless last line was a different block level element
              if (line.replace(this.rules.other.tabCharGlobal, '    ').search(this.rules.other.nonSpaceChar) >= 4) { // indented code block
                break;
              }
              if (fencesBeginRegex.test(line)) {
                break;
              }
              if (headingBeginRegex.test(line)) {
                break;
              }
              if (hrRegex.test(line)) {
                break;
              }

              itemContents += '\n' + nextLine;
              continuationPrefixes.push('');
              if (nextLineView && listSource) {
                itemParts.push(listSource.slice(
                  markedViewOffset(Math.max(0, rawLineStart - 1)),
                  markedViewOffset(rawLineStart),
                ));
                itemParts.push(nextLineView);
              }
            }

            blankLine = !nextLine.trim();

            raw += rawLine + '\n';
            src = src.substring(rawLine.length + 1);
            line = nextLineWithoutTabs.slice(indent);
          }
        }

        if (!list.loose) {
          // If the previous item ended with a blank line, the list is loose
          if (endsWithBlankLine) {
            list.loose = true;
          } else if (this.rules.other.doubleBlankLine.test(raw)) {
            endsWithBlankLine = true;
          }
        }

        const trailingBlankLines = trailingBlankLineCount(raw);
        const contentContinuationPrefixes = trailingBlankLines
          ? continuationPrefixes.slice(
              0,
              Math.max(0, continuationPrefixes.length - trailingBlankLines),
            )
          : continuationPrefixes;
        list.items.push({
          type: 'list_item',
          raw,
          leadingPrefix,
          marker,
          markerPadding,
          trailingBlankLines,
          continuationPrefixes: contentContinuationPrefixes,
          task: !!this.options.gfm && this.rules.other.listIsTask.test(itemContents),
          loose: false,
          text: itemContents,
          tokens: [],
        });
        if (listSource) {
          const itemSource = itemParts.length
            ? MarkedSourceView.concat(itemParts, listSource.document)
            : listSource.slice(
                markedViewOffset(itemSourceStart),
                markedViewOffset(itemSourceStart),
              );
          if (itemSource.text !== itemContents) {
            throw new TypeError(
              'Marked list item text differs from its mapped source.',
            );
          }
          itemSources.push(itemSource);
        } else {
          itemSources.push(null);
        }

        list.raw += raw;
      }

      // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
      const lastItem = list.items.at(-1);
      if (lastItem) {
        lastItem.raw = lastItem.raw.trimEnd();
        lastItem.text = lastItem.text.trimEnd();
        lastItem.trailingBlankLines = 0;
        const finalSource = itemSources.at(-1);
        if (finalSource)
          itemSources[itemSources.length - 1] = trimMapped(finalSource, 'end');
      } else {
        // not a list since there were no items
        return;
      }
      list.raw = list.raw.trimEnd();

      // Item child tokens handled here at end because we needed to have the final item to trim it first
      for (let itemIndex = 0; itemIndex < list.items.length; itemIndex++) {
        const item = list.items[itemIndex];
        this.lexer.state.top = false;
        item.tokens = this.lexer.blockTokens(
          lexerSource(item.text, itemSources[itemIndex]),
          [],
        );
        const itemToken = item.tokens[0];
        if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
          // Remove checkbox markdown from item tokens
          item.text = item.text.replace(this.rules.other.listReplaceTask, '');
          itemToken.raw = itemToken.raw.replace(this.rules.other.listReplaceTask, '');
          itemToken.text = itemToken.text.replace(this.rules.other.listReplaceTask, '');
          for (let i = this.lexer.inlineQueue.length - 1; i >= 0; i--) {
            const queued = this.lexer.inlineQueue[i].src;
            const queuedText = queued instanceof MarkedSourceView
              ? queued.text
              : queued;
            if (this.rules.other.listIsTask.test(queuedText)) {
              if (queued instanceof MarkedSourceView) {
                const task = this.rules.other.listReplaceTask.exec(queued.text);
                if (!task) {
                  throw new TypeError(
                    'Marked task source differs from its task token.',
                  );
                }
                this.lexer.inlineQueue[i].src = queued.slice(
                  markedViewOffset(task[0].length),
                  markedViewOffset(queued.text.length),
                );
              } else {
                this.lexer.inlineQueue[i].src = queued.replace(
                  this.rules.other.listReplaceTask,
                  '',
                );
              }
              break;
            }
          }

          const taskRaw = this.rules.other.listTaskCheckbox.exec(item.raw);
          if (taskRaw) {
            const checkboxToken: Tokens.Checkbox = {
              type: 'checkbox',
              raw: taskRaw[0] + ' ',
              checked: taskRaw[0] !== '[ ]',
            };
            item.checked = checkboxToken.checked;
            if (list.loose) {
              const first = item.tokens[0];
              if ((first?.type === 'paragraph' || first?.type === 'text') && first.tokens) {
                first.raw = checkboxToken.raw + first.raw;
                first.text = checkboxToken.raw + first.text;
                first.tokens.unshift(checkboxToken);
              } else {
                item.tokens.unshift({
                  type: 'paragraph',
                  raw: checkboxToken.raw,
                  text: checkboxToken.raw,
                  tokens: [checkboxToken],
                });
              }
            } else {
              item.tokens.unshift(checkboxToken);
            }
          }
        } else if (item.task) {
          item.task = false;
        }

        if (!list.loose) {
          // Check if list should be loose
          const spacers = item.tokens.filter(t => t.type === 'space');
          const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => this.rules.other.anyLine.test(t.raw));

          list.loose = hasMultipleLineBreaks;
        }
      }

      // Set all items to loose if list is loose
      if (list.loose) {
        for (const item of list.items) {
          item.loose = true;
          for (const token of item.tokens) {
            if (token.type === 'text') {
              token.type = 'paragraph';
            }
          }
        }
      }

      return list;
    }
  }

  html(src: string): Tokens.HTML | undefined {
    const cap = this.rules.block.html.exec(src);
    if (cap) {
      const raw = trimTrailingBlankLines(cap[0]);
      const token: Tokens.HTML = {
        type: 'html',
        block: true,
        raw,
        pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
        text: raw,
      };
      return token;
    }
  }

  def(src: string): Tokens.Def | undefined {
    const cap = this.rules.block.def.exec(src);
    if (cap) {
      const tag = cap[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, ' ');
      const href = cap[2] ? cap[2].replace(this.rules.other.hrefBrackets, '$1').replace(this.rules.inline.anyPunctuation, '$1') : '';
      const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, '$1') : cap[3];
      return {
        type: 'def',
        tag,
        raw: rtrim(cap[0], '\n'),
        href,
        title,
      };
    }
  }

  table(src: string): Tokens.Table | undefined {
    const cap = this.rules.block.table.exec(src);
    if (!cap) {
      return;
    }

    if (!this.rules.other.tableDelimiter.test(cap[2])) {
      // delimiter row must have a pipe (|) or colon (:) otherwise it is a setext heading
      return;
    }

    const raw = rtrim(cap[0], '\n');
    const rawView = mappedPrefix(this.lexer, src, raw.length);
    const headerStart = cap[0].indexOf(cap[1]);
    const headerView = rawView?.slice(
      markedViewOffset(headerStart),
      markedViewOffset(headerStart + cap[1].length),
    ) ?? null;
    const headers = headerView
      ? splitMappedCells(headerView, this.rules)
      : splitCells(cap[1]).map(text => ({ text, source: null }));
    const aligns = cap[2].replace(this.rules.other.tableAlignChars, '').split('|');
    const rowText = cap[3]?.trim()
      ? cap[3].replace(this.rules.other.tableRowBlankLine, '')
      : '';
    const rows = rowText ? rowText.split('\n') : [];
    const rowViews: Array<MarkedSourceView<object> | null> = [];
    if (rawView && cap[3] && rowText) {
      const rowCaptureStart = cap[0].indexOf(
        cap[3],
        headerStart + cap[1].length,
      );
      const bodyView = rawView.slice(
        markedViewOffset(rowCaptureStart),
        markedViewOffset(rowCaptureStart + rowText.length),
      );
      let rowStart = 0;
      for (const row of rows) {
        rowViews.push(bodyView.slice(
          markedViewOffset(rowStart),
          markedViewOffset(rowStart + row.length),
        ));
        rowStart += row.length + 1;
      }
    } else {
      rows.forEach(() => rowViews.push(null));
    }

    if (headers.length !== aligns.length) {
      // header and align columns must be equal, rows can be different.
      return;
    }

    const headerSourceSyntax = tableRowSourceSyntax(
      cap[1],
      this.rules,
    );
    const delimiterSourceSyntax = tableRowSourceSyntax(
      cap[2],
      this.rules,
    );
    const rowSourceSyntax = rows.map(row => tableRowSourceSyntax(
      row,
      this.rules,
      headers.length,
    ));
    if (
      headerSourceSyntax.cells.length !== headers.length
      || delimiterSourceSyntax.cells.length !== aligns.length
      || rowSourceSyntax.some(row => row.cells.length !== headers.length)
    ) {
      throw new TypeError(
        'Marked table source syntax column count differs from its token.',
      );
    }

    const item: Tokens.Table = {
      type: 'table',
      raw,
      header: [],
      align: [],
      rows: [],
      sourceSyntax: Object.freeze({
        header: headerSourceSyntax,
        delimiter: delimiterSourceSyntax,
        rows: Object.freeze(rowSourceSyntax),
      }),
    };

    for (const align of aligns) {
      if (this.rules.other.tableAlignRight.test(align)) {
        item.align.push('right');
      } else if (this.rules.other.tableAlignCenter.test(align)) {
        item.align.push('center');
      } else if (this.rules.other.tableAlignLeft.test(align)) {
        item.align.push('left');
      } else {
        item.align.push(null);
      }
    }

    for (let i = 0; i < headers.length; i++) {
      item.header.push({
        text: headers[i].text,
        tokens: this.lexer.inline(lexerSource(
          headers[i].text,
          headers[i].source,
        )),
        header: true,
        align: item.align[i],
      });
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const cells = rowViews[rowIndex]
        ? splitMappedCells(
            rowViews[rowIndex]!,
            this.rules,
            item.header.length,
          )
        : splitCells(row, item.header.length).map(text => ({
            text,
            source: null,
          }));
      item.rows.push(cells.map((cell, i) => {
        return {
          text: cell.text,
          tokens: this.lexer.inline(lexerSource(cell.text, cell.source)),
          header: false,
          align: item.align[i],
        };
      }));
    }

    return item;
  }

  lheading(src: string): Tokens.Heading | undefined {
    const cap = this.rules.block.lheading.exec(src);
    if (cap) {
      const text = cap[1].trim();
      const raw = rtrim(cap[0], '\n');
      const rawView = mappedPrefix(this.lexer, src, raw.length);
      const captureStart = cap[0].indexOf(cap[1]);
      const textView = rawView
        ? trimMapped(rawView.slice(
            markedViewOffset(captureStart),
            markedViewOffset(captureStart + cap[1].length),
          ))
        : null;
      return {
        type: 'heading',
        raw,
        depth: cap[2].charAt(0) === '=' ? 1 : 2,
        text,
        tokens: this.lexer.inline(lexerSource(text, textView)),
      };
    }
  }

  paragraph(src: string): Tokens.Paragraph | undefined {
    const cap = this.rules.block.paragraph.exec(src);
    if (cap) {
      const text = cap[1].charAt(cap[1].length - 1) === '\n'
        ? cap[1].slice(0, -1)
        : cap[1];
      const textView = mappedPrefix(this.lexer, src, text.length);
      return {
        type: 'paragraph',
        raw: cap[0],
        text,
        tokens: this.lexer.inline(lexerSource(text, textView)),
      };
    }
  }

  text(src: string): Tokens.Text | undefined {
    const cap = this.rules.block.text.exec(src);
    if (cap) {
      return {
        type: 'text',
        raw: cap[0],
        text: cap[0],
        tokens: this.lexer.inline(lexerSource(
          cap[0],
          mappedPrefix(this.lexer, src, cap[0].length),
        )),
      };
    }
  }

  escape(src: string): Tokens.Escape | undefined {
    const cap = this.rules.inline.escape.exec(src);
    if (cap) {
      return {
        type: 'escape',
        raw: cap[0],
        text: cap[1],
      };
    }
  }

  tag(src: string): Tokens.Tag | undefined {
    const cap = this.rules.inline.tag.exec(src);
    if (cap) {
      if (!this.lexer.state.inLink && this.rules.other.startATag.test(cap[0])) {
        this.lexer.state.inLink = true;
      } else if (this.lexer.state.inLink && this.rules.other.endATag.test(cap[0])) {
        this.lexer.state.inLink = false;
      }
      if (!this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(cap[0])) {
        this.lexer.state.inRawBlock = true;
      } else if (this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(cap[0])) {
        this.lexer.state.inRawBlock = false;
      }

      return {
        type: 'html',
        raw: cap[0],
        inLink: this.lexer.state.inLink,
        inRawBlock: this.lexer.state.inRawBlock,
        block: false,
        text: cap[0],
      };
    }
  }

  link(src: string): Tokens.Link | Tokens.Image | undefined {
    const cap = this.rules.inline.link.exec(src);
    if (cap) {
      const trimmedUrl = cap[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(trimmedUrl)) {
        // commonmark requires matching angle brackets
        if (!(this.rules.other.endAngleBracket.test(trimmedUrl))) {
          return;
        }

        // ending angle bracket cannot be escaped
        const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
        if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
          return;
        }
      } else {
        // find closing parenthesis
        const lastParenIndex = findClosingBracket(cap[2], '()');
        if (lastParenIndex === -2) {
          // more open parens than closed
          return;
        }

        if (lastParenIndex > -1) {
          const start = cap[0].indexOf('!') === 0 ? 5 : 4;
          const linkLen = start + cap[1].length + lastParenIndex;
          cap[2] = cap[2].substring(0, lastParenIndex);
          cap[0] = cap[0].substring(0, linkLen).trim();
          cap[3] = '';
        }
      }
      let href = cap[2];
      let title = '';
      if (this.options.pedantic) {
        // split pedantic href and title
        const link = this.rules.other.pedanticHrefTitle.exec(href);

        if (link) {
          href = link[1];
          title = link[3];
        }
      } else {
        title = cap[3] ? cap[3].slice(1, -1) : '';
      }

      href = href.trim();
      if (this.rules.other.startAngleBracket.test(href)) {
        if (this.options.pedantic && !(this.rules.other.endAngleBracket.test(trimmedUrl))) {
          // pedantic allows starting angle bracket without ending angle bracket
          href = href.slice(1);
        } else {
          href = href.slice(1, -1);
        }
      }
      return outputLink(cap, {
        href: href ? href.replace(this.rules.inline.anyPunctuation, '$1') : href,
        title: title ? title.replace(this.rules.inline.anyPunctuation, '$1') : title,
      }, cap[0], this.lexer, this.rules);
    }
  }

  reflink(src: string, links: Links): Tokens.Link | Tokens.Image | Tokens.Text | undefined {
    let cap;
    if ((cap = this.rules.inline.reflink.exec(src))
      || (cap = this.rules.inline.nolink.exec(src))) {
      const linkString = (cap[2] || cap[1]).replace(this.rules.other.multipleSpaceGlobal, ' ');
      const link = links[linkString.toLowerCase()];
      if (!link) {
        const text = cap[0].charAt(0);
        return {
          type: 'text',
          raw: text,
          text,
        };
      }
      return outputLink(cap, link, cap[0], this.lexer, this.rules);
    }
  }

  emStrong(src: string, maskedSrc: string, prevChar = ''): Tokens.Em | Tokens.Strong | undefined {
    let match = this.rules.inline.emStrongLDelim.exec(src);
    if (!match) return;
    if (!match[1] && !match[2] && !match[3] && !match[4]) return;

    // _ can't be between two alphanumerics. \p{L}\p{N} includes non-english alphabet/numbers as well
    if (match[4] && prevChar.match(this.rules.other.unicodeAlphaNumeric)) return;

    const nextChar = match[1] || match[3] || '';

    if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
      // unicode Regex counts emoji as 1 char; spread into array for proper count (used multiple times below)
      const lLength = [...match[0]].length - 1;
      let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;

      const endReg = match[0][0] === '*' ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      endReg.lastIndex = 0;

      // Clip maskedSrc to same section of string as src (move to lexer?)
      maskedSrc = maskedSrc.slice(-1 * src.length + lLength);

      while ((match = endReg.exec(maskedSrc)) !== null) {
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];

        if (!rDelim) continue; // skip single * in __abc*abc__

        rLength = [...rDelim].length;

        if (match[3] || match[4]) { // found another Left Delim
          delimTotal += rLength;
          continue;
        } else if (match[5] || match[6]) { // either Left or Right Delim
          if (lLength % 3 && !((lLength + rLength) % 3)) {
            midDelimTotal += rLength;
            continue; // CommonMark Emphasis Rules 9-10
          }
        }

        delimTotal -= rLength;

        if (delimTotal > 0) continue; // Haven't found enough closing delimiters

        // Remove extra characters. *a*** -> *a*
        rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
        // char length can be >1 for unicode characters;
        const lastCharLength = [...match[0]][0].length;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

        // Create `em` if smallest delimiter has odd char count. *a***
        if (Math.min(lLength, rLength) % 2) {
          const text = raw.slice(1, -1);
          const rawView = mappedPrefix(this.lexer, src, raw.length);
          const textView = rawView?.slice(
            markedViewOffset(1),
            markedViewOffset(raw.length - 1),
          ) ?? null;
          return {
            type: 'em',
            raw,
            text,
            tokens: this.lexer.inlineTokens(lexerSource(text, textView)),
          };
        }

        // Create 'strong' if smallest delimiter has even char count. **a***
        const text = raw.slice(2, -2);
        const rawView = mappedPrefix(this.lexer, src, raw.length);
        const textView = rawView?.slice(
          markedViewOffset(2),
          markedViewOffset(raw.length - 2),
        ) ?? null;
        return {
          type: 'strong',
          raw,
          text,
          tokens: this.lexer.inlineTokens(lexerSource(text, textView)),
        };
      }
    }
  }

  codespan(src: string): Tokens.Codespan | undefined {
    const cap = this.rules.inline.code.exec(src);
    if (cap) {
      let text = cap[2].replace(this.rules.other.newLineCharGlobal, ' ');
      const hasNonSpaceChars = this.rules.other.nonSpaceChar.test(text);
      const hasSpaceCharsOnBothEnds = this.rules.other.startingSpaceChar.test(text) && this.rules.other.endingSpaceChar.test(text);
      if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
        text = text.substring(1, text.length - 1);
      }
      return {
        type: 'codespan',
        raw: cap[0],
        text,
      };
    }
  }

  br(src: string): Tokens.Br | undefined {
    const cap = this.rules.inline.br.exec(src);
    if (cap) {
      return {
        type: 'br',
        raw: cap[0],
      };
    }
  }

  del(src: string, maskedSrc: string, prevChar = ''): Tokens.Del | undefined {
    let match = this.rules.inline.delLDelim.exec(src);
    if (!match) return;

    const nextChar = match[1] || '';

    if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
      // unicode Regex counts emoji as 1 char; spread into array for proper count
      const lLength = [...match[0]].length - 1;
      let rDelim, rLength, delimTotal = lLength;

      const endReg = this.rules.inline.delRDelim;
      endReg.lastIndex = 0;

      // Clip maskedSrc to same section of string as src
      maskedSrc = maskedSrc.slice(-1 * src.length + lLength);

      while ((match = endReg.exec(maskedSrc)) !== null) {
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];

        if (!rDelim) continue;

        rLength = [...rDelim].length;

        if (rLength !== lLength) continue;

        if (match[3] || match[4]) { // found another Left Delim
          delimTotal += rLength;
          continue;
        }

        delimTotal -= rLength;

        if (delimTotal > 0) continue; // Haven't found enough closing delimiters

        // Remove extra characters
        rLength = Math.min(rLength, rLength + delimTotal);
        // char length can be >1 for unicode characters
        const lastCharLength = [...match[0]][0].length;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

        // Create del token - only single ~ or double ~~ supported
        const text = raw.slice(lLength, -lLength);
        const rawView = mappedPrefix(this.lexer, src, raw.length);
        const textView = rawView?.slice(
          markedViewOffset(lLength),
          markedViewOffset(raw.length - lLength),
        ) ?? null;
        return {
          type: 'del',
          raw,
          text,
          tokens: this.lexer.inlineTokens(lexerSource(text, textView)),
        };
      }
    }
  }

  autolink(src: string): Tokens.Link | undefined {
    const cap = this.rules.inline.autolink.exec(src);
    if (cap) {
      let text, href;
      if (cap[2] === '@') {
        text = cap[1];
        href = 'mailto:' + text;
      } else {
        text = cap[1];
        href = text;
      }

      return {
        type: 'link',
        raw: cap[0],
        text,
        href,
        tokens: [
          {
            type: 'text',
            raw: text,
            text,
          },
        ],
      };
    }
  }

  url(src: string): Tokens.Link | undefined {
    let cap;
    if (cap = this.rules.inline.url.exec(src)) {
      let text, href;
      if (cap[2] === '@') {
        text = cap[0];
        href = 'mailto:' + text;
      } else {
        // do extended autolink path validation
        let prevCapZero;
        do {
          prevCapZero = cap[0];
          cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? '';
        } while (prevCapZero !== cap[0]);
        text = cap[0];
        if (cap[1] === 'www.') {
          href = 'http://' + cap[0];
        } else {
          href = cap[0];
        }
      }
      return {
        type: 'link',
        raw: cap[0],
        text,
        href,
        tokens: [
          {
            type: 'text',
            raw: text,
            text,
          },
        ],
      };
    }
  }

  inlineText(src: string): Tokens.Text | undefined {
    const cap = this.rules.inline.text.exec(src);
    if (cap) {
      const escaped = this.lexer.state.inRawBlock;
      return {
        type: 'text',
        raw: cap[0],
        text: cap[0],
        escaped,
      };
    }
  }
}
