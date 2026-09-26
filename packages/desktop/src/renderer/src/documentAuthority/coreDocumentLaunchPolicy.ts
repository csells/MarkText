export type CoreDocumentLaunchEnvironment = Readonly<
  Record<string, string | undefined>
>

/** Core always owns the document; a launch only chooses whether its test hooks exist. */
export interface CoreDocumentLaunchPolicy {
  readonly testControlsEnabled: boolean
}

export const resolveCoreDocumentLaunchPolicy = (
  environment: CoreDocumentLaunchEnvironment
): CoreDocumentLaunchPolicy =>
  Object.freeze({
    testControlsEnabled:
      environment.PERF_TESTING === 'true' &&
      environment.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS === '1'
  })
