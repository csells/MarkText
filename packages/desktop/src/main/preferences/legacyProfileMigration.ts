import {
  isPersistedPreferenceKey,
  type PersistedPreferenceKey
} from '@shared/types/preferences'

/**
 * Settings this build renamed. A profile written before the rename carries the
 * user's choice under the old key; carrying the value forward is the
 * difference between an upgrade and a silent reset.
 */
export const LEGACY_PREFERENCE_RENAMES = Object.freeze({
  superSubScript: 'subscriptAndSuperscript',
  footnote: 'footnotes',
  isGitlabCompatibilityEnabled: 'gitLabMath'
} as const satisfies Readonly<Record<string, PersistedPreferenceKey>>)

export interface PersistedPreferenceMigration {
  /** Renamed settings to write, keyed by their current names. */
  readonly renamed: Readonly<Record<string, unknown>>
  /** Keys this build has no reading of. They stay on disk untouched. */
  readonly unknown: readonly string[]
}

export function migratePersistedPreferences(
  raw: Readonly<Record<string, unknown>>
): PersistedPreferenceMigration {
  const renamed: Record<string, unknown> = {}
  const unknown: string[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (isPersistedPreferenceKey(key)) continue
    const renamedTo =
      LEGACY_PREFERENCE_RENAMES[key as keyof typeof LEGACY_PREFERENCE_RENAMES]
    // A value the user set under this build's own name wins over one a legacy
    // install wrote; renames only fill settings this build has never decided.
    if (renamedTo !== undefined && !(renamedTo in raw)) {
      renamed[renamedTo] = value
    } else {
      unknown.push(key)
    }
  }
  return Object.freeze({
    renamed: Object.freeze(renamed),
    unknown: Object.freeze(unknown)
  })
}

