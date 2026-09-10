/** Native fenced spelling and its body position share one serializer. */
export function fencedCodeMarkdown(text: string, language = '', indent = '', storedFenceLength?: number, lineEnding = '\n'): Readonly<{ markdown: string, contentStart: number }> {
  let longestInterior = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (/^`+$/.test(trimmed)) longestInterior = Math.max(longestInterior, trimmed.length)
  }
  const fence = '`'.repeat(Math.max(3, storedFenceLength ?? 3, longestInterior + 1))
  const opening = indent + fence + language + lineEnding
  return {
    markdown: opening + text.split('\n').map(line => indent + line + lineEnding).join('') + indent + fence + lineEnding,
    contentStart: opening.length + indent.length
  }
}
