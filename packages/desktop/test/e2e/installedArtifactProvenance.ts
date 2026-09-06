import type { Page } from 'playwright'

const FULL_COMMIT = /^[0-9a-f]{40}$/

export const defaultCoreLaunchEnvironment = (
  overrides: Readonly<Record<string, string>>
): Record<string, string> => {
  const environment = { ...process.env, ...overrides }
  delete environment.MARKTEXT_DOCUMENT_CORE_MODE
  delete environment.MARKTEXT_DOCUMENT_CORE_SHADOW
  delete environment.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
  return Object.fromEntries(Object.entries(environment).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  ))
}

export const requiredExpectedBuildCommit = (
  configured: string | undefined
): string => {
  if (configured === undefined || !FULL_COMMIT.test(configured)) {
    throw new Error(
      'MARKTEXT_EXPECTED_COMMIT must contain one full commit identity ' +
      'in lowercase hexadecimal'
    )
  }
  return configured
}

export const assertInstalledBuildCommit = (
  expected: string,
  actual: string
): void => {
  if (!FULL_COMMIT.test(actual) || actual !== expected) {
    throw new Error(
      `Installed artifact commit ${JSON.stringify(actual)} ` +
      `does not match ${expected}`
    )
  }
}

export const expectInstalledArtifactCommit = async(page: Page): Promise<void> => {
  const expected = requiredExpectedBuildCommit(process.env.MARKTEXT_EXPECTED_COMMIT)
  const actual = await page.evaluate(() => window.electron.buildCommit)
  assertInstalledBuildCommit(expected, actual)
}

export const expectDefaultCoreAuthority = async(page: Page): Promise<void> => {
  const launch = await page.evaluate(() => ({
    mode: window.__marktextDocumentCore?.mode,
    feature: window.electron.process.env.MARKTEXT_DOCUMENT_CORE_MODE,
    shadow: window.electron.process.env.MARKTEXT_DOCUMENT_CORE_SHADOW,
    controls: window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
  }))
  if (launch.mode !== 'core' || launch.feature !== undefined ||
      launch.shadow !== undefined || launch.controls !== undefined) {
    throw new Error('Expected default Core authority without feature or mutation flags')
  }
}
