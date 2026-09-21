/** Block kinds whose children carry literal values, never inline Markdown. */
export const isLiteralBlock = (kind: string): boolean =>
  kind === 'code-block' || kind === 'math-block' || kind === 'diagram' || kind === 'html-block' || kind === 'front-matter'

/** Preserve a literal value as ordinary paragraph text, including dormant markup. */
export const literalParagraphSpelling = (text: string): string =>
  text.replace(/[!-/:-@[-`{-~]/gu, character => `\\${character}`)
