import {
  closedRecord as decodeClosedRecord
} from '@shared/types/closedRecord'
import type { ProjectCreateIntent } from '@shared/types/projectCreate'

function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Record<string, unknown> {
  return decodeClosedRecord(value, label, { required: fields }) as Record<string, unknown>
}

export function decodeProjectCreateIntent(value: unknown): ProjectCreateIntent {
  const record = closedRecord(value, 'project-create intent', [
    'schema',
    'kind',
    'parentSegments',
    'name'
  ])
  if (record.schema !== 'project-create-intent-1') {
    throw new TypeError('Invalid project-create intent schema')
  }
  if (record.kind !== 'file' && record.kind !== 'directory') {
    throw new TypeError('Invalid project-create intent kind')
  }
  if (
    !Array.isArray(record.parentSegments) ||
    record.parentSegments.some(segment => typeof segment !== 'string')
  ) {
    throw new TypeError('Project-create parentSegments must be strings')
  }
  if (typeof record.name !== 'string') {
    throw new TypeError('Project-create name must be a string')
  }
  return Object.freeze({
    schema: 'project-create-intent-1',
    kind: record.kind,
    parentSegments: Object.freeze([...record.parentSegments]),
    name: record.name
  })
}
