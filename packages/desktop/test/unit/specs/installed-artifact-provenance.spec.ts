import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertInstalledBuildCommit,
  requiredExpectedBuildCommit
} from '../../e2e/installedArtifactProvenance'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

describe('installed artifact provenance', () => {
  it('requires the exact full checked-out commit from the evidence runner', () => {
    expect(requiredExpectedBuildCommit(COMMIT)).toBe(COMMIT)
    expect(() => requiredExpectedBuildCommit(undefined))
      .toThrow(/MARKTEXT_EXPECTED_COMMIT/)
    expect(() => requiredExpectedBuildCommit('0123456'))
      .toThrow(/full commit/i)
  })

  it('rejects an installed executable built from another commit', () => {
    expect(() => assertInstalledBuildCommit(COMMIT, COMMIT)).not.toThrow()
    expect(() => assertInstalledBuildCommit(
      COMMIT,
      'fedcba9876543210fedcba9876543210fedcba98'
    )).toThrow(/installed artifact.*commit/i)
    expect(() => assertInstalledBuildCommit(COMMIT, 'unavailable'))
      .toThrow(/installed artifact.*commit/i)
  })

  it('builds and mounts one exact fresh DMG under a clean-tree evidence gate', () => {
    const runner = readFileSync(
      resolve(__dirname, '../../e2e/run-installed-core-review.sh'),
      'utf8'
    )
    expect(runner).toContain('diff --quiet')
    expect(runner).toContain('diff --cached --quiet')
    expect(runner).toContain('ls-files --others --exclude-standard')
    expect(runner).toContain('MARKTEXT_ALLOW_DIRTY_PACKAGE')
    expect(runner).toContain('rev-parse --verify HEAD')
    expect(runner).toContain('TOOL_SHIM_DIR=')
    expect(runner).toContain(
      // eslint-disable-next-line no-template-curly-in-string
      'corepack enable --install-directory "${TOOL_SHIM_DIR}" pnpm'
    )
    // eslint-disable-next-line no-template-curly-in-string
    expect(runner).toContain('export PATH="${TOOL_SHIM_DIR}:${PATH}"')
    // Assertions quote shell parameter syntax, not TypeScript templates.
    // eslint-disable-next-line no-template-curly-in-string
    expect(runner).toContain('marktext-mac-${ARCH}-${VERSION}.dmg')
    // eslint-disable-next-line no-template-curly-in-string
    expect(runner).toContain('hdiutil attach "${DMG}" -nobrowse -readonly')
    expect(runner).toContain('--project=installed')
  })
})
