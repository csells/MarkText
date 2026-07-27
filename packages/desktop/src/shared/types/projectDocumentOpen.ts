/**
 * Renderer intent only. Main derives the editor window and retained project
 * root from the IPC sender before it resolves or reads this candidate.
 */
export interface ProjectDocumentOpenRequest {
  readonly schema: 'project-document-open-request-1'
  readonly candidatePath: string
}

export interface ProjectDocumentOpenReceipt {
  readonly schema: 'project-document-open-receipt-1'
  readonly disposition: 'admitted' | 'selected-existing'
  readonly pathname: string
}

const MAX_PATH_LENGTH = 32_768

export function decodeProjectDocumentOpenReceipt(
  value: unknown
): ProjectDocumentOpenReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Project document open receipt must be a closed record'
    )
  }
  const keys = Reflect.ownKeys(value)
  const fields = ['schema', 'disposition', 'pathname']
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key))
  ) {
    throw new TypeError(
      'Project document open receipt fields are not closed'
    )
  }
  const record = value as Readonly<Record<string, unknown>>
  if (
    record.schema !== 'project-document-open-receipt-1' ||
    (
      record.disposition !== 'admitted' &&
      record.disposition !== 'selected-existing'
    ) ||
    typeof record.pathname !== 'string' ||
    record.pathname.length === 0 ||
    record.pathname.length > MAX_PATH_LENGTH ||
    [...record.pathname].some(character => {
      const point = character.codePointAt(0) ?? 0
      return point <= 0x1f || (point >= 0x7f && point <= 0x9f)
    })
  ) {
    throw new TypeError('Invalid project document open receipt')
  }
  return Object.freeze({
    schema: 'project-document-open-receipt-1',
    disposition: record.disposition,
    pathname: record.pathname
  })
}
