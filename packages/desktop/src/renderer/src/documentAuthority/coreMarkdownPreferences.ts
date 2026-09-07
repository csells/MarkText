import type { MarkdownOptions } from '@marktext/document-core'

export interface CoreMarkdownPreferences {
  readonly superSubScript: boolean
  readonly footnote: boolean
  readonly isGitlabCompatibilityEnabled: boolean
}

/** Map existing desktop language switches once for every document session. */
export const coreMarkdownOptionsFromPreferences = (
  preferences: CoreMarkdownPreferences
): Readonly<Partial<MarkdownOptions>> =>
  Object.freeze({
    subscriptAndSuperscript: preferences.superSubScript,
    footnotes: preferences.footnote,
    gitLabMath: preferences.isGitlabCompatibilityEnabled
  })
