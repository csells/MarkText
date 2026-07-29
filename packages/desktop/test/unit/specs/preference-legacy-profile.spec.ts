import { describe, expect, it } from 'vitest'
import {
  decodeRendererPreferencePatch,
  rendererPreferencePatch
} from '@shared/types/preferences'
import {
  migratePersistedPreferences
} from 'main_renderer/preferences/legacyProfileMigration'

// The preferences file is shared with any other MarkText install on the
// machine — a released build keeps writing its own keys (superSubScript,
// footnote, plantumlServer, …) into the same profile. Those bytes are user
// data this build must tolerate on every read, because the other install
// re-creates them after any cleanup.
const LEGACY_PROFILE = Object.freeze({
  autoSave: true,
  theme: 'dark',
  superSubScript: false,
  footnote: true,
  isGitlabCompatibilityEnabled: true,
  plantumlServer: 'https://example.invalid/plantuml',
  tabSize: 4
})

describe('a profile written by another MarkText install', () => {
  it('never reaches a renderer through the preference broadcast', () => {
    const patch = rendererPreferencePatch(
      LEGACY_PROFILE as Record<string, unknown>
    )
    expect(patch).toMatchObject({ autoSave: true, theme: 'dark' })
    for (const legacy of [
      'superSubScript',
      'footnote',
      'isGitlabCompatibilityEnabled',
      'plantumlServer',
      'tabSize'
    ]) {
      expect(patch).not.toHaveProperty(legacy)
    }
  })

  it('carries renamed settings forward instead of resetting them', () => {
    const migration = migratePersistedPreferences(
      LEGACY_PROFILE as Record<string, unknown>
    )
    expect(migration.renamed).toEqual({
      subscriptAndSuperscript: false,
      footnotes: true,
      gitLabMath: true
    })
  })

  it('does not let a legacy value overwrite a setting this build owns', () => {
    const migration = migratePersistedPreferences({
      ...LEGACY_PROFILE,
      subscriptAndSuperscript: true
    } as Record<string, unknown>)
    expect(migration.renamed).toEqual({
      footnotes: true,
      gitLabMath: true
    })
  })

  it('names what it cannot carry forward', () => {
    const migration = migratePersistedPreferences(
      LEGACY_PROFILE as Record<string, unknown>
    )
    expect([...migration.unknown].sort()).toEqual([
      'plantumlServer',
      'tabSize'
    ])
  })
})

// A renderer patch is untrusted input arriving over IPC. Refusing it must be
// an outcome main can log, never an exception that takes the browser process
// down with a modal dialog — which is what an unknown key did to a user whose
// profile predates a preference rename.
describe('renderer preference patches', () => {
  it('decodes a valid patch', () => {
    expect(decodeRendererPreferencePatch({ autoSave: true })).toEqual({
      kind: 'patch',
      patch: { autoSave: true }
    })
  })

  it.each([
    { name: 'an unknown key', value: { superSubScript: false } },
    { name: 'a main-only key', value: { searchExclusions: [] } },
    { name: 'a non-record', value: 'autoSave' }
  ])('refuses $name as an outcome, not an exception', ({ value }) => {
    const outcome = decodeRendererPreferencePatch(value)
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.reason.length).toBeGreaterThan(0)
    }
  })
})
