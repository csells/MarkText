/** Block kinds whose children carry literal values, never inline Markdown. */
export const isLiteralBlock = (kind: string): boolean =>
  kind === 'code-block' || kind === 'math-block' || kind === 'diagram' || kind === 'html-block' || kind === 'front-matter'
