import type { MarkdownOptions } from '@marktext/document-core'

export interface CoreMarkdownPreferences {
  readonly superSubScript: boolean
  readonly footnote: boolean
  readonly texMathDollars: boolean
  readonly texMathGfm: boolean
  readonly texMathSingleBackslash: boolean
  readonly texMathDoubleBackslash: boolean
  readonly highlightSyntax: boolean
  readonly inlineDiff: boolean
  readonly multilineBlockquote: boolean
}

/** Map existing desktop language switches once for every document session. */
export const coreMarkdownOptionsFromPreferences = (
  preferences: CoreMarkdownPreferences
): Readonly<Partial<MarkdownOptions>> =>
  Object.freeze({
    subscriptAndSuperscript: preferences.superSubScript,
    footnotes: preferences.footnote,
    texMathDollars: preferences.texMathDollars,
    texMathGfm: preferences.texMathGfm,
    texMathSingleBackslash: preferences.texMathSingleBackslash,
    texMathDoubleBackslash: preferences.texMathDoubleBackslash,
    highlightSyntax: preferences.highlightSyntax,
    inlineDiff: preferences.inlineDiff,
    multilineBlockquote: preferences.multilineBlockquote
  })
