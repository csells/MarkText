import emojis from './emojis.js'

const aliasPattern = '[a-z_\\d+-]+'
/** Complete shortcode syntax retained for the unbound native editor. */
export const emojiPattern = new RegExp(`^(:)(${aliasPattern})\\1`)
const authoringPattern = new RegExp(`(:)(${aliasPattern})(:)?`, 'y')

const byAlias = new Map<string, (typeof emojis)[number]>()
for (const emoji of emojis) {
  for (const alias of emoji.aliases) {
    if (!byAlias.has(alias)) byAlias.set(alias, emoji)
  }
}
export const validEmoji = (alias: string) => byAlias.get(alias)

/** Recognize authoring syntax only inside a parser-owned ordinary text leaf. */
export function emojiAt(source: string, start: number, end: number) {
  if (source.charCodeAt(start) !== 58 || /\w/.test(source[start - 1] ?? '')) return undefined
  let slashes = 0
  for (let at = start - 1; at >= 0 && source.charCodeAt(at) === 92; at -= 1) slashes += 1
  if (slashes % 2 !== 0) return undefined
  authoringPattern.lastIndex = start
  const match = authoringPattern.exec(source)
  if (match === null) return undefined
  const alias = match[2]!.slice(0, Math.max(0, end - start - 1))
  if (alias.length === 0) return undefined
  const closed = match[3] !== undefined && start + match[0].length <= end
  const value = closed ? validEmoji(alias)?.emoji : undefined
  return { end: start + alias.length + (closed ? 2 : 1), alias, closed, value }
}
