import path from 'node:path'
import type { UploaderSettings } from './uploaderService'

export type UploaderPersistedSettingsProvider = () => unknown

let persistedSettingsProvider: UploaderPersistedSettingsProvider | null = null

function closedPersistedRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Persisted uploader settings must be a closed record')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 2 ||
    !keys.includes('currentUploader') ||
    !keys.includes('cliScript')
  ) {
    throw new TypeError('Persisted uploader settings fields are not closed')
  }
  return record
}

export function decodePersistedUploaderSettings(
  value: unknown
): UploaderSettings {
  const record = closedPersistedRecord(value)
  if (
    typeof record.cliScript !== 'string' ||
    record.cliScript.includes('\0')
  ) {
    throw new TypeError('Persisted uploader executable must be a string')
  }
  if (record.currentUploader === 'picgo') {
    return Object.freeze({ kind: 'picgo' })
  }
  if (
    record.currentUploader === 'cliScript' &&
    record.cliScript.length > 0 &&
    path.isAbsolute(record.cliScript)
  ) {
    return Object.freeze({
      kind: 'custom-cli',
      executablePath: record.cliScript
    })
  }
  throw new TypeError('Persisted uploader selection is invalid')
}

export function configureUploaderSettings(
  provider: UploaderPersistedSettingsProvider
): void {
  persistedSettingsProvider = provider
}

export function readUploaderSettings(): UploaderSettings {
  if (persistedSettingsProvider === null) {
    throw new Error('Uploader settings are not configured')
  }
  return decodePersistedUploaderSettings(persistedSettingsProvider())
}
