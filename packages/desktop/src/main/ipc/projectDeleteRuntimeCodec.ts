import path from 'node:path'
import type {
  ProjectDeleteIntent
} from '../../shared/types/projectDeletion'

function safeSegment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    path.isAbsolute(value) ||
    [...value].some(character => {
      const point = character.codePointAt(0) ?? 0
      return point <= 0x1f || (point >= 0x7f && point <= 0x9f)
    })
  ) {
    throw new TypeError(`${label} must be one safe path segment`)
  }
  return value
}

export function decodeProjectDeleteIntent(
  value: unknown
): ProjectDeleteIntent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Project delete intent must be a closed record')
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== 3 ||
    keys.some(key =>
      typeof key !== 'string' ||
      !['schema', 'kind', 'entrySegments'].includes(key)
    )
  ) {
    throw new TypeError('Project delete intent fields are not closed')
  }
  const record = value as Readonly<Record<string, unknown>>
  if (
    record.schema !== 'project-delete-intent-1' ||
    (record.kind !== 'file' && record.kind !== 'directory') ||
    !Array.isArray(record.entrySegments) ||
    record.entrySegments.length === 0 ||
    record.entrySegments.length > 256
  ) {
    throw new TypeError('Invalid project delete intent')
  }
  return Object.freeze({
    schema: 'project-delete-intent-1',
    kind: record.kind,
    entrySegments: Object.freeze(record.entrySegments.map((segment, index) =>
      safeSegment(
        segment,
        `project delete intent.entrySegments[${String(index)}]`
      )
    ))
  })
}
