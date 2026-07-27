/**
 * GitHub-compatible heading slug base.
 *
 * Letters, numbers, combining marks, `_`, and `-` are retained across scripts;
 * punctuation and emoji are removed. Duplicate suffixes are document-context
 * policy and are applied by the parser-owned heading-link materializer.
 */
export function githubHeadingSlug(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\p{M}\w\s-]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
}
