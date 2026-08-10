export type ProfileParseTraceViewV1 =
  | 'original'
  | 'revised'
  | 'comment-display'
  | 'editing'

/**
 * Transitional private hook shape used inside the research parser. The
 * bounded facade supplies no recorder, so tracing is not part of its public
 * interface or steady-state work.
 */
export interface ProfileParseTraceRecorderV1 {
  readonly recordInlineCodeExtensionAnalysis: (
    view: ProfileParseTraceViewV1,
    start: number,
    end: number
  ) => void
  readonly recordInlineCodeCloserQuery: (
    view: ProfileParseTraceViewV1,
    start: number,
    end: number
  ) => void
  readonly recordInlineCodeCloserCandidate: (
    view: ProfileParseTraceViewV1,
    start: number,
    end: number
  ) => void
  readonly recordArmTerminationFenceProbe: (
    view: ProfileParseTraceViewV1,
    start: number,
    end: number
  ) => void
  readonly recordCanonicalSourceAdmission: (sourceLength: number) => void
  readonly recordSourceProgression: (owner: 'markdown-kernel') => void
  readonly recordAuthoritativeMarkdownParse: (
    input: 'canonical-source',
    view?: ProfileParseTraceViewV1
  ) => void
}
