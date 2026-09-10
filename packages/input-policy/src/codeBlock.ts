/** Native fenced spelling and its body position share one serializer. */
export function fencedCodeMarkdown(text: string, language = '', indent = '', storedFenceLength?: number, lineEnding = '\n', fenceChar: '`' | '~' = '`'): Readonly<{ markdown: string, contentStart: number }> {
  // The opening fence must be longer than any interior line made only of the
  // same fence character (CommonMark §4.5), else that line closes the block.
  const fenceRun = fenceChar === '`' ? /^`+$/ : /^~+$/
  let longestInterior = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (fenceRun.test(trimmed)) longestInterior = Math.max(longestInterior, trimmed.length)
  }
  const fence = fenceChar.repeat(Math.max(3, storedFenceLength ?? 3, longestInterior + 1))
  const opening = indent + fence + language + lineEnding
  return {
    markdown: opening + text.split('\n').map(line => indent + line + lineEnding).join('') + indent + fence + lineEnding,
    contentStart: opening.length + indent.length
  }
}
