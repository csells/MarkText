/**
 * The lengths of the longest common prefix of `a` and `b`, and of their
 * longest common suffix within what the prefix leaves of the shorter text.
 */
export function commonAffixes(a: string, b: string): { readonly prefix: number, readonly suffix: number } {
  const shorter = Math.min(a.length, b.length)
  let prefix = 0
  while (prefix < shorter && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix += 1
  let suffix = 0
  while (suffix < shorter - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix += 1
  return { prefix, suffix }
}
