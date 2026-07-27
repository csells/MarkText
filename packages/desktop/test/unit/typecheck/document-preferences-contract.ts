import type {
  DocumentAppearancePreferences,
  DocumentAuthoringPreferences,
  DocumentGrammarPreferences,
  DocumentToolPreferences,
  IUserPreferences,
  ReviewPreferences
} from '@shared/types/preferences'

const appearance: DocumentAppearancePreferences = {
  fontSize: 18,
  editorLineWidth: '72ch',
  wrapCodeBlocks: true
}
const authoring: DocumentAuthoringPreferences = {
  autoPairBracket: true,
  autoPairMarkdownSyntax: true,
  autoPairQuote: true
}
const grammar: DocumentGrammarPreferences = {
  footnotes: true,
  gitLabMath: true,
  subscriptAndSuperscript: true
}
const tools: DocumentToolPreferences = {
  autoCheck: true,
  hideLinkPopup: false,
  hideQuickInsertHint: false
}
const review: ReviewPreferences = {
  criticMarkupProjection: 'marked',
  criticMarkupTrackChanges: true
}
const preferences: IUserPreferences = {
  ...appearance,
  ...authoring,
  ...grammar,
  ...tools
}

// @ts-expect-error unsupported document settings are absent, not ignored
preferences.tabSize = 4
// @ts-expect-error parser grammar keys use the target contract spelling
preferences.footnote = true
// @ts-expect-error arbitrary options cannot enter the persisted preference bag
preferences.notADocumentOption = true

Object.freeze(review)
