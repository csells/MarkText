/** Existing code-widget indentation policy, independent of document parsing. */
export function codeEnter(text: string, offset: number, tabSize: number, lineEnding = '\n'): { insert: string; caret: number } {
  const pair = /^(?:\{\}|\[\]|\(\)|><)$/.test(text.substring(offset - 1, offset + 1))
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  let lineEnd = text.indexOf('\n', lineStart)
  if (lineEnd === -1) lineEnd = text.length
  const indent = /^(\s*)\S/.exec(text.slice(lineStart, lineEnd))?.[1] ?? ''
  const extra = pair ? ' '.repeat(tabSize) : ''
  return {
    insert: lineEnding + indent + extra + (pair ? lineEnding + indent : ''),
    caret: lineEnding.length + indent.length + extra.length
  }
}
