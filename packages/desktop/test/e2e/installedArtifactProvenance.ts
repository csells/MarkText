import type { Page } from 'playwright'

const FULL_COMMIT = /^[0-9a-f]{40}$/

export function requiredExpectedBuildCommit(
  configured: string | undefined
): string {
  if (configured === undefined || !FULL_COMMIT.test(configured)) {
    throw new Error(
      'MARKTEXT_EXPECTED_COMMIT must contain one full commit identity ' +
      'in lowercase hexadecimal'
    )
  }
  return configured
}

export function assertInstalledBuildCommit(
  expected: string,
  actual: string
): void {
  if (!FULL_COMMIT.test(actual) || actual !== expected) {
    throw new Error(
      `Installed artifact commit ${JSON.stringify(actual)} ` +
      `does not match ${expected}`
    )
  }
}

export async function expectInstalledArtifactCommit(page: Page): Promise<void> {
  const expected = requiredExpectedBuildCommit(
    process.env.MARKTEXT_EXPECTED_COMMIT
  )
  const actual = await page.evaluate(() => window.electron.buildCommit)
  assertInstalledBuildCommit(expected, actual)
}
