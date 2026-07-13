import { other } from './rules.ts';

/**
 * Helpers
 */
const escapeReplacements: { [index: string]: string } = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const getEscapeReplacement = (ch: string) => escapeReplacements[ch];

export function escapeHtmlEntities(html: string, encode?: boolean) {
  if (encode) {
    if (other.escapeTest.test(html)) {
      return html.replace(other.escapeReplace, getEscapeReplacement);
    }
  } else {
    if (other.escapeTestNoEncode.test(html)) {
      return html.replace(other.escapeReplaceNoEncode, getEscapeReplacement);
    }
  }

  return html;
}

export function cleanUrl(href: string) {
  try {
    href = encodeURI(href).replace(other.percentDecode, '%');
  } catch {
    return null;
  }
  return href;
}

export interface TableCellSourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Return the exact trimmed source range of each GFM table cell.
 *
 * This is the single authority for table-pipe recognition. Consumers that
 * need decoded cell text, mapped parser input, or lossless row syntax must all
 * derive those views from these ranges so escaped pipes and column-count
 * normalization cannot diverge.
 */
export function splitCellSourceRanges(
  tableRow: string,
  count?: number,
): TableCellSourceRange[] {
  const delimiters: number[] = [];
  for (let index = 0; index < tableRow.length; index++) {
    if (tableRow[index] !== '|') {
      continue;
    }
    let slashes = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && tableRow[cursor] === '\\';
      cursor--
    ) {
      slashes++;
    }
    if (slashes % 2 === 0) {
      delimiters.push(index);
    }
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (const delimiter of delimiters) {
    ranges.push({ start, end: delimiter });
    start = delimiter + 1;
  }
  ranges.push({ start, end: tableRow.length });

  // First/last cell in a row cannot be empty if it has no leading/trailing
  // pipe. This deliberately mirrors splitCells' historical behavior.
  if (!tableRow.slice(ranges[0].start, ranges[0].end).trim()) {
    ranges.shift();
  }
  if (
    ranges.length
    && !tableRow.slice(ranges.at(-1)!.start, ranges.at(-1)!.end).trim()
  ) {
    ranges.pop();
  }

  if (count) {
    if (ranges.length > count) {
      ranges.splice(count);
    } else {
      while (ranges.length < count) {
        ranges.push({
          start: tableRow.length,
          end: tableRow.length,
        });
      }
    }
  }

  return ranges.map((range) => {
    const source = tableRow.slice(range.start, range.end);
    const leadingLength = source.length - source.trimStart().length;
    const trimmedEnd = source.trimEnd().length;
    const trimmedStart = range.start + leadingLength;
    return {
      start: trimmedStart,
      end: range.start + Math.max(leadingLength, trimmedEnd),
    };
  });
}

export function splitCells(tableRow: string, count?: number) {
  return splitCellSourceRanges(tableRow, count).map(range => (
    tableRow.slice(range.start, range.end).replace(other.slashPipe, '|')
  ));
}

/**
 * Remove trailing 'c's. Equivalent to str.replace(/c*$/, '').
 * /c*$/ is vulnerable to REDOS.
 *
 * @param str
 * @param c
 * @param invert Remove suffix of non-c chars instead. Default falsey.
 */
export function rtrim(str: string, c: string, invert?: boolean) {
  const l = str.length;
  if (l === 0) {
    return '';
  }

  // Length of suffix matching the invert condition.
  let suffLen = 0;

  // Step left until we fail to match the invert condition.
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) {
      suffLen++;
    } else if (currChar !== c && invert) {
      suffLen++;
    } else {
      break;
    }
  }

  return str.slice(0, l - suffLen);
}

export function trimTrailingBlankLines(str: string) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && other.blankLine.test(lines[end])) {
    end--;
  }
  if (lines.length - end <= 2) {
    // we want to keep single trailing blank lines
    return str;
  }

  return lines.slice(0, end + 1).join('\n');
}

export function findClosingBracket(str: string, b: string) {
  if (str.indexOf(b[1]) === -1) {
    return -1;
  }

  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) {
        return i;
      }
    }
  }
  if (level > 0) {
    return -2;
  }

  return -1;
}

export function expandTabs(line: string, indent = 0) {
  let col = indent;
  let expanded = '';
  for (const char of line) {
    if (char === '\t') {
      const added = 4 - (col % 4);
      expanded += ' '.repeat(added);
      col += added;
    } else {
      expanded += char;
      col++;
    }
  }

  return expanded;
}
