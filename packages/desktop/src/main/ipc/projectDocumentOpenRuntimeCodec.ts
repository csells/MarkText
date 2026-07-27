import type {
  ProjectDocumentOpenRequest
} from '@shared/types/projectDocumentOpen'

const MAX_PATH_LENGTH = 32_768

export function decodeProjectDocumentOpenRequest(
  value: unknown
): ProjectDocumentOpenRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Project document open request must be a closed record')
  }
  const keys = Reflect.ownKeys(value)
  const fields = ['schema', 'candidatePath']
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key))
  ) {
    throw new TypeError('Project document open request fields are not closed')
  }
  const record = value as Readonly<Record<string, unknown>>
  if (
    record.schema !== 'project-document-open-request-1' ||
    typeof record.candidatePath !== 'string' ||
    record.candidatePath.length === 0 ||
    record.candidatePath.length > MAX_PATH_LENGTH ||
    [...record.candidatePath].some(character => {
      const point = character.codePointAt(0) ?? 0
      return point <= 0x1f || (point >= 0x7f && point <= 0x9f)
    })
  ) {
    throw new TypeError('Invalid project document open request')
  }
  return Object.freeze({
    schema: 'project-document-open-request-1',
    candidatePath: record.candidatePath
  })
}
