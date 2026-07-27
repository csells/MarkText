import type { LanguageEngine } from '../languageEngine.js'

export type ProfileParseTraceViewV1 =
  | 'original'
  | 'revised'
  | 'comment-display'
  | 'editing'

export type ProfileParseProgressionOwnerV1 = 'markdown-kernel'

export type ProfileParseCstInputV1 = 'canonical-source'

export type ProfileParsePlanningReasonV1 =
  | 'inline-code-extension-analysis'
  | 'inline-code-closer-query'
  | 'inline-code-closer-candidate'
  | 'arm-termination-fence-probe'

export type ProfileParseTraceEventV1 =
  | Readonly<{
    readonly kind: 'projection-planning-range-visit'
    readonly view: ProfileParseTraceViewV1
    readonly reason: ProfileParsePlanningReasonV1
    readonly range: Readonly<{
      readonly start: number
      readonly end: number
    }>
  }>
  | Readonly<{
    readonly kind: 'canonical-source-admission'
    readonly sourceLength: number
  }>
  | Readonly<{
    readonly kind: 'source-progression'
    readonly owner: ProfileParseProgressionOwnerV1
  }>
  | Readonly<{
    readonly kind: 'authoritative-markdown-parse'
    readonly input: ProfileParseCstInputV1
    readonly view?: ProfileParseTraceViewV1
  }>

export interface ProfileParseTraceV1 {
  readonly events: readonly ProfileParseTraceEventV1[]
}

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
  readonly recordSourceProgression: (
    owner: ProfileParseProgressionOwnerV1
  ) => void
  readonly recordAuthoritativeMarkdownParse: (
    input: ProfileParseCstInputV1,
    view?: ProfileParseTraceViewV1
  ) => void
}

const ACTIVE_RECORDERS = new WeakMap<
  LanguageEngine,
  ProfileParseTraceRecorderV1[]
>()

export function activeProfileParseTraceRecorderV1(
  engine: LanguageEngine
): ProfileParseTraceRecorderV1 | undefined {
  return ACTIVE_RECORDERS.get(engine)?.at(-1)
}

export function captureProfileParseTraceV1<T>(
  engine: LanguageEngine,
  operation: () => T
): Readonly<{ readonly value: T; readonly trace: ProfileParseTraceV1 }> {
  if ((ACTIVE_RECORDERS.get(engine)?.length ?? 0) !== 0) {
    throw new Error('Nested Profile 1 parse-trace capture is not supported')
  }
  const events: ProfileParseTraceEventV1[] = []
  const planningRecorder = (
    reason: ProfileParsePlanningReasonV1
  ) => Object.freeze((
    view: ProfileParseTraceViewV1,
    start: number,
    end: number
  ): void => {
    events.push(Object.freeze({
      kind: 'projection-planning-range-visit',
      view,
      reason,
      range: Object.freeze({ start, end })
    }))
  })
  const recorder: ProfileParseTraceRecorderV1 = Object.freeze({
    recordInlineCodeExtensionAnalysis: planningRecorder(
      'inline-code-extension-analysis'
    ),
    recordInlineCodeCloserQuery: planningRecorder('inline-code-closer-query'),
    recordInlineCodeCloserCandidate: planningRecorder(
      'inline-code-closer-candidate'
    ),
    recordArmTerminationFenceProbe: planningRecorder(
      'arm-termination-fence-probe'
    ),
    recordCanonicalSourceAdmission: Object.freeze((
      sourceLength: number
    ): void => {
      events.push(Object.freeze({
        kind: 'canonical-source-admission',
        sourceLength
      }))
    }),
    recordSourceProgression: Object.freeze((
      owner: ProfileParseProgressionOwnerV1
    ): void => {
      events.push(Object.freeze({ kind: 'source-progression', owner }))
    }),
    recordAuthoritativeMarkdownParse: Object.freeze((
      input: ProfileParseCstInputV1,
      view?: ProfileParseTraceViewV1
    ): void => {
      events.push(Object.freeze(
        view === undefined
          ? { kind: 'authoritative-markdown-parse', input }
          : { kind: 'authoritative-markdown-parse', input, view }
      ))
    })
  })
  const recorders = ACTIVE_RECORDERS.get(engine) ?? []
  if (!ACTIVE_RECORDERS.has(engine)) {
    ACTIVE_RECORDERS.set(engine, recorders)
  }
  recorders.push(recorder)
  try {
    const value = operation()
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      'then' in value &&
      typeof value.then === 'function'
    ) {
      throw new Error('Profile 1 parse-trace capture must remain synchronous')
    }
    return Object.freeze({
      value,
      trace: Object.freeze({ events: Object.freeze([...events]) })
    })
  } finally {
    recorders.pop()
    if (recorders.length === 0) {
      ACTIVE_RECORDERS.delete(engine)
    }
  }
}
