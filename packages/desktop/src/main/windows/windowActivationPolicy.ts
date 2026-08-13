export type WindowActivationEnvironment = Readonly<Record<string, string | undefined>>

export const isHiddenE2eWindow = (
  environment: WindowActivationEnvironment = process.env
): boolean => environment.PERF_TESTING === 'true' &&
  environment.MARKTEXT_E2E_HIDDEN_WINDOW === '1'

export const windowActivationAllowed = (
  environment: WindowActivationEnvironment = process.env
): boolean => !isHiddenE2eWindow(environment)
