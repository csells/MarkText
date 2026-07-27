import path from 'node:path'
import type {
  ProjectCopyIntent
} from '../../shared/types/projectCopy'

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

function segments(
  value: unknown,
  label: string,
  allowEmpty: boolean
): readonly string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > 256
  ) {
    throw new TypeError(`${label} must be bounded relative segments`)
  }
  return Object.freeze(value.map((segment, index) =>
    safeSegment(segment, `${label}[${String(index)}]`)
  ))
}

export function decodeProjectCopyIntent(
  value: unknown
): ProjectCopyIntent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Project copy intent must be a closed record')
  }
  const keys = Reflect.ownKeys(value)
  const fields = [
    'schema',
    'kind',
    'entrySegments',
    'targetParentSegments'
  ]
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key))
  ) {
    throw new TypeError('Project copy intent fields are not closed')
  }
  const record = value as Readonly<Record<string, unknown>>
  if (
    record.schema !== 'project-copy-intent-1' ||
    (record.kind !== 'file' && record.kind !== 'directory')
  ) {
    throw new TypeError('Invalid project copy intent')
  }
  return Object.freeze({
    schema: 'project-copy-intent-1',
    kind: record.kind,
    entrySegments: segments(
      record.entrySegments,
      'project copy intent.entrySegments',
      false
    ),
    targetParentSegments: segments(
      record.targetParentSegments,
      'project copy intent.targetParentSegments',
      true
    )
  })
}
