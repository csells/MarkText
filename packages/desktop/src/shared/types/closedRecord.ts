/**
 * The one closed-record decoder every cross-process codec decodes through.
 *
 * A closed record admits exactly the keys it declares. Which of those keys are
 * required is part of the declaration, because the wire surface carries fields
 * where absent means the default — a decoder that demands exact key-set
 * equality cannot express those, and one that only rejects unknown keys lets a
 * missing required field through as `undefined`. Both strengths existed here,
 * and the difference between them was accidental.
 *
 * Section 3's stricter sentence governs `ParseConfigurationV1`, which declares
 * no optional fields and does not reach this surface.
 */

/** Every way a value can fail to be the closed record a codec declared. */
export type ClosedRecordRejection =
  | 'not-a-record'
  | 'non-plain-prototype'
  | 'unknown-key'
  | 'missing-required-key'
  | 'non-data-field'

/** The shape a codec declares: permitted keys, and which must be present. */
export interface ClosedRecordShape {
  readonly required: readonly string[]
  readonly optional?: readonly string[]
}

/**
 * A rejection a target can name.
 *
 * Carrying the vocabulary as a field rather than only in the message lets a
 * test assert *why* a record was refused, so a decoder that rejects for the
 * wrong reason is a failure rather than a passing assertion on a string.
 */
export class ClosedRecordError extends TypeError {
  readonly rejection: ClosedRecordRejection
  readonly label: string
  readonly key: string | null

  constructor(
    rejection: ClosedRecordRejection,
    label: string,
    key: string | null
  ) {
    super(
      key === null
        ? `${label} is not a closed record: ${rejection}`
        : `${label}.${key} is not a closed record field: ${rejection}`
    )
    this.name = 'ClosedRecordError'
    this.rejection = rejection
    this.label = label
    this.key = key
  }
}

/**
 * Exactly a plain object literal. A structured-clone hop produces nothing else,
 * so a null-prototype or class-backed value did not come from our encoder even
 * though it may carry the right keys.
 */
const isPlainRecord = (value: object): boolean =>
  (Object.getPrototypeOf(value) as unknown) === Object.prototype

export function closedRecord(
  value: unknown,
  label: string,
  shape: ClosedRecordShape
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ClosedRecordError('not-a-record', label, null)
  }
  if (!isPlainRecord(value)) {
    throw new ClosedRecordError('non-plain-prototype', label, null)
  }

  const permitted = new Set<string>([
    ...shape.required,
    ...shape.optional ?? []
  ])
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !permitted.has(key)) {
      throw new ClosedRecordError(
        'unknown-key',
        label,
        typeof key === 'string' ? key : null
      )
    }
  }

  const decoded: Record<string, unknown> = {}
  for (const key of permitted) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined) {
      if (shape.required.includes(key)) {
        throw new ClosedRecordError('missing-required-key', label, key)
      }
      continue
    }
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new ClosedRecordError('non-data-field', label, key)
    }
    decoded[key] = descriptor.value
  }
  return Object.freeze(decoded)
}
