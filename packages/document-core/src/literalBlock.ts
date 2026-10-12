/** Code, math and diagram blocks: literal text between fences, `$$` lines, or (for code) indentation. */
export const FENCED_LITERAL_BLOCKS: ReadonlySet<string> = new Set(['code-block', 'math-block', 'diagram'])

/** Literal blocks whose lines split into leaves of literal text: all but front matter. */
export const SPLITTABLE_LITERAL_BLOCKS: ReadonlySet<string> = new Set([...FENCED_LITERAL_BLOCKS, 'html-block'])

const LITERAL_BLOCKS: ReadonlySet<string> = new Set([...SPLITTABLE_LITERAL_BLOCKS, 'front-matter'])

/** Block kinds whose children carry literal values, never inline Markdown. */
export const isLiteralBlock = (kind: string): boolean => LITERAL_BLOCKS.has(kind)

/** Blocks holding text a caret can land in. */
export const CARET_TARGET_BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'table-cell', 'code-block', 'math-block', 'diagram', 'front-matter'])

/** Preserve a literal value as ordinary paragraph text, including dormant markup. */
export const literalParagraphSpelling = (text: string): string =>
  text.replace(/[!-/:-@[-`{-~]/gu, character => `\\${character}`)
