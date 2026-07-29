import {
  closedRecord as decodeClosedRecord
} from '@shared/types/closedRecord'
import path from 'node:path'
import type {
  ProjectRelocateIntent
} from '../../shared/types/projectRelocation'

function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  return decodeClosedRecord(value, label, { required: fields })
}
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

export function decodeProjectRelocateIntent(
  value: unknown
): ProjectRelocateIntent {
  const record = closedRecord(value, 'project relocation intent', [
    'schema',
    'kind',
    'entrySegments',
    'targetParentSegments',
    'newName'
  ])
  if (
    record.schema !== 'project-relocate-intent-1' ||
    (record.kind !== 'file' && record.kind !== 'directory') ||
    !Array.isArray(record.entrySegments) ||
    record.entrySegments.length === 0 ||
    record.entrySegments.length > 256 ||
    !Array.isArray(record.targetParentSegments) ||
    record.targetParentSegments.length > 255
  ) {
    throw new TypeError('Invalid project relocation intent')
  }
  return Object.freeze({
    schema: 'project-relocate-intent-1',
    kind: record.kind,
    entrySegments: Object.freeze(record.entrySegments.map((segment, index) =>
      safeSegment(
        segment,
        `project relocation intent.entrySegments[${String(index)}]`
      )
    )),
    targetParentSegments: Object.freeze(
      record.targetParentSegments.map((segment, index) =>
        safeSegment(
          segment,
          `project relocation intent.targetParentSegments[${String(index)}]`
        )
      )
    ),
    newName: safeSegment(
      record.newName,
      'project relocation intent.newName'
    )
  })
}
