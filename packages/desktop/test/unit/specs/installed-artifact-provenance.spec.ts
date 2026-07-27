import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertInstalledBuildCommit,
  requiredExpectedBuildCommit
} from '../../e2e/installedArtifactProvenance'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

describe('installed artifact provenance', () => {
  it('requires one exact full commit identity from the evidence runner', () => {
    expect(requiredExpectedBuildCommit(COMMIT)).toBe(COMMIT)
    expect(() => requiredExpectedBuildCommit(undefined))
      .toThrow(/MARKTEXT_EXPECTED_COMMIT/)
    expect(() => requiredExpectedBuildCommit('0123456'))
      .toThrow(/full commit/i)
  })

  it('rejects an installed executable built from any other commit', () => {
    expect(() => assertInstalledBuildCommit(COMMIT, COMMIT)).not.toThrow()
    expect(() => assertInstalledBuildCommit(
      COMMIT,
      'fedcba9876543210fedcba9876543210fedcba98'
    )).toThrow(/installed artifact.*commit/i)
    expect(() => assertInstalledBuildCommit(COMMIT, 'unavailable'))
      .toThrow(/installed artifact.*commit/i)
  })

  it('derives the packaged stamp only from the checked-out commit', () => {
    const config = readFileSync(
      resolve(__dirname, '../../../electron.vite.config.ts'),
      'utf8'
    )
    expect(config).not.toContain('process.env.MARKTEXT_BUILD_COMMIT')
    expect(config).not.toContain("return 'unavailable'")
    expect(config).toContain("['rev-parse', '--verify', 'HEAD']")
  })

  it('builds and mounts the exact fresh DMG without an artifact override', () => {
    const runner = readFileSync(
      resolve(__dirname, '../../e2e/run-packaged-smoke.sh'),
      'utf8'
    )
    expect(runner).not.toContain('MARKTEXT_DMG')
    expect(runner).not.toContain('ls -t')
    expect(runner).toContain('git rev-parse --verify HEAD')
    expect(runner).toContain('marktext-mac-${ARCH}-${VERSION}.dmg')
    expect(runner).toContain('hdiutil attach "${DMG}" -nobrowse -readonly')
  })
})
