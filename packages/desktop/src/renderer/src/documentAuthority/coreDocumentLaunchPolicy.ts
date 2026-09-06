export type CoreDocumentLaunchEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface CoreDocumentLaunchPolicy {
  readonly coreEnabled: boolean
  readonly testControlsEnabled: boolean
}

export const resolveCoreDocumentLaunchPolicy = (
  environment: CoreDocumentLaunchEnvironment
): CoreDocumentLaunchPolicy => {
  const coreEnabled = environment.MARKTEXT_DOCUMENT_CORE_MODE === '1' ||
    (environment.MARKTEXT_DOCUMENT_CORE_MODE !== '0' &&
      environment.MARKTEXT_DOCUMENT_CORE_SHADOW !== '1')
  return Object.freeze({
    coreEnabled,
    testControlsEnabled: coreEnabled &&
      environment.PERF_TESTING === 'true' &&
      environment.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS === '1'
  })
}
