import {
  DOCUMENT_RESOURCE_POLICY_V1,
  openVerifiedSourceReplicaV1,
  retainVerifiedSourceReplicaV1,
  revisionSemanticHashV1,
  reviseVerifiedSourceReplicaV1,
  type ParseConfiguration,
  type RevisionSemanticHashV1,
  type SourceHashV1,
  type VerifiedSourceReplicaV1
} from '@marktext/document-core'
import type {
  DocumentCorePortableSnapshot,
  DocumentCoreSessionSourceDelta
} from './types/documentCore'

const verifiedSourceReplicas = new WeakMap<
  DocumentCorePortableSnapshot,
  VerifiedSourceReplicaV1
>()

export interface VerifiedDocumentCoreSourceDelta {
  readonly source: string
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
  readonly replica: VerifiedSourceReplicaV1
  readonly sourceEdits: readonly VerifiedDocumentCoreSourceEdit[]
}

export interface VerifiedDocumentCoreSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain record`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Object.keys(descriptors)
  if (
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be closed over known fields`)
  }
  for (const field of fields) {
    const descriptor = descriptors[field]
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError(`${label}.${field} must be an enumerable data field`)
    }
  }
  return value as Readonly<Record<string, unknown>>
}

function kindOf(value: unknown): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError('Session source delta must be a plain record')
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'kind')
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !('value' in descriptor)
  ) {
    throw new TypeError(
      'Session source delta.kind must be an enumerable data field'
    )
  }
  return descriptor.value
}

function decodeEdits(
  value: unknown,
  baseLength: number
): readonly VerifiedDocumentCoreSourceEdit[] {
  if (
    !Array.isArray(value) ||
    value.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
  ) {
    throw new TypeError('Edited session source has invalid edits')
  }
  const edits: VerifiedDocumentCoreSourceEdit[] = []
  let previousEnd = 0
  let nextLength = baseLength
  let inserted = 0
  for (const [index, rawEdit] of value.entries()) {
    const edit = closedRecord(rawEdit, `Session source edit ${String(index)}`, [
      'start',
      'end',
      'insert'
    ])
    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      Number(edit.start) < previousEnd ||
      Number(edit.end) < Number(edit.start) ||
      Number(edit.end) > baseLength ||
      typeof edit.insert !== 'string'
    ) {
      throw new TypeError(`Session source edit ${String(index)} is invalid`)
    }
    const stable = Object.freeze({
      start: Number(edit.start),
      end: Number(edit.end),
      insert: edit.insert
    })
    previousEnd = stable.end
    inserted += stable.insert.length
    nextLength += stable.insert.length - (stable.end - stable.start)
    if (
      !Number.isSafeInteger(nextLength) ||
      nextLength < 0 ||
      nextLength > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits ||
      inserted > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
    ) {
      throw new TypeError('Edited session source exceeds its resource limit')
    }
    edits.push(stable)
  }
  return Object.freeze(edits)
}

function applyEdits(
  source: string,
  edits: readonly VerifiedDocumentCoreSourceEdit[]
): string {
  const pieces: string[] = []
  let sourceOffset = 0
  for (const edit of edits) {
    pieces.push(source.slice(sourceOffset, edit.start), edit.insert)
    sourceOffset = edit.end
  }
  pieces.push(source.slice(sourceOffset))
  return pieces.join('')
}

export function verifyDocumentCoreSourceDelta(
  value: unknown,
  base: DocumentCorePortableSnapshot | undefined,
  expectedSourceHash: unknown,
  expectedSemanticHash: unknown,
  parseConfiguration: ParseConfiguration
): VerifiedDocumentCoreSourceDelta {
  if (
    typeof expectedSourceHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(expectedSourceHash) ||
    typeof expectedSemanticHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(expectedSemanticHash)
  ) {
    throw new TypeError('Session delta has invalid hash fields')
  }

  let source: string
  let replica: VerifiedSourceReplicaV1
  let sourceEdits: readonly VerifiedDocumentCoreSourceEdit[] = Object.freeze([])
  const kind = kindOf(value)
  if (kind === 'full') {
    if (base !== undefined) {
      throw new TypeError('A mounted session transition requires source edits')
    }
    const full = closedRecord(value, 'Full session source delta', [
      'kind',
      'text'
    ])
    if (
      typeof full.text !== 'string' ||
      full.text.length > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
    ) {
      throw new TypeError('Full session source delta has invalid text')
    }
    source = full.text
    replica = openVerifiedSourceReplicaV1(
      source,
      expectedSourceHash as SourceHashV1
    )
  } else if (kind === 'retain') {
    if (base === undefined) {
      throw new TypeError('Retained session source requires a mounted base')
    }
    const retained = closedRecord(value, 'Retained session source delta', [
      'kind',
      'baseRevisionId',
      'baseSourceHash',
      'baseSemanticHash',
      'baseSourceLength'
    ])
    if (
      retained.baseRevisionId !== base.revisionId ||
      retained.baseSourceHash !== base.sourceHash ||
      retained.baseSemanticHash !== base.semanticHash ||
      retained.baseSourceLength !== base.source.length
    ) {
      throw new TypeError('Retained session source does not name its exact base')
    }
    source = base.source
    const baseReplica = verifiedSourceReplicas.get(base)
    if (baseReplica === undefined) {
      throw new TypeError('Retained session source has an unverified base')
    }
    replica = retainVerifiedSourceReplicaV1(
      baseReplica,
      expectedSourceHash as SourceHashV1,
      base.source.length
    )
  } else if (kind === 'edit') {
    if (base === undefined) {
      throw new TypeError('Edited session source requires a mounted base')
    }
    const delta = closedRecord(value, 'Edited session source delta', [
      'kind',
      'baseRevisionId',
      'baseSourceHash',
      'baseSemanticHash',
      'baseSourceLength',
      'edits'
    ]) as unknown as DocumentCoreSessionSourceDelta &
      Readonly<Record<string, unknown>>
    if (
      delta.baseRevisionId !== base.revisionId ||
      delta.baseSourceHash !== base.sourceHash ||
      delta.baseSemanticHash !== base.semanticHash ||
      delta.baseSourceLength !== base.source.length
    ) {
      throw new TypeError('Edited session source does not name its exact base')
    }
    const edits = decodeEdits(delta.edits, base.source.length)
    if (edits.length === 0) {
      throw new TypeError('Edited session source requires at least one edit')
    }
    source = applyEdits(base.source, edits)
    const baseReplica = verifiedSourceReplicas.get(base)
    if (baseReplica === undefined) {
      throw new TypeError('Edited session source has an unverified base')
    }
    replica = reviseVerifiedSourceReplicaV1(
      baseReplica,
      source,
      edits,
      expectedSourceHash as SourceHashV1
    )
    sourceEdits = edits
  } else {
    throw new TypeError('Session source delta has an invalid kind')
  }

  const semanticHash = revisionSemanticHashV1(
    replica.sourceHash,
    parseConfiguration
  )
  if (
    expectedSourceHash !== replica.sourceHash ||
    expectedSemanticHash !== semanticHash
  ) {
    throw new TypeError('Session delta has invalid source or semantic hashes')
  }
  return Object.freeze({
    source,
    sourceHash: replica.sourceHash,
    semanticHash,
    replica,
    sourceEdits
  })
}

export function retainDocumentCoreSourceVerification(
  snapshot: DocumentCorePortableSnapshot,
  verified: VerifiedDocumentCoreSourceDelta
): void {
  verifiedSourceReplicas.set(snapshot, verified.replica)
}
