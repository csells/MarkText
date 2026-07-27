import type {
  DocumentSessionJournalContent,
  DocumentSessionJournalStorage,
  EditorIntent,
  IntentId,
  PendingInputDraft,
  RevisionId,
  SessionEffect,
  SessionLifecycleStatus,
  SessionTicketOutcome
} from '../../documentSession.js'
import { validateAndFreezeParseConfiguration } from '../../configuration.js'
import { sourceHashV1 } from '../../hashCodec.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'
import type { ParseConfiguration } from '../../revision.js'
import { decodeEditorIntent } from './intentCodec.js'
import type { RevisionWorkerCheckpoint } from './revisionWorker.js'

const JOURNAL_SCHEMA = 'marktext-session-journal-v1'
const JOURNAL_CONTENT_REFERENCE_SCHEMA =
  'marktext-session-journal-content-reference-v1'
const EXTERNAL_STRING_MINIMUM_UNITS = 64 * 1024

export interface SessionIdCheckpoint {
  readonly revision: number
  readonly snapshot: number
  readonly intent: number
  readonly operation: number
  readonly transition: number
  readonly lease: number
  readonly draft: number
  readonly plan: number
  readonly effect: number
}

export interface SessionRecoveryCheckpoint {
  readonly worker: RevisionWorkerCheckpoint
  readonly ids: SessionIdCheckpoint
  readonly retainedDrafts: readonly PendingInputDraft[]
  readonly clientSequence: number
  readonly settledWatermark: number
  readonly effects: readonly SessionEffect[]
  readonly lifecycle: SessionLifecycleStatus
  readonly reopenSemanticHashes: readonly string[]
}

export interface SessionIngressRecord {
  readonly ticket: IntentId
  readonly sequence: number
  readonly submittedAgainst: RevisionId
  readonly intent: EditorIntent
  readonly phase: 'admitted' | 'committing'
  readonly cancelRequested: boolean
}

interface JournalBody {
  readonly schema: typeof JOURNAL_SCHEMA
  readonly identity: string
  readonly checkpoint: SessionRecoveryCheckpoint | null
  readonly ingress: readonly SessionIngressRecord[]
  readonly outcomes: readonly SessionTicketOutcome[]
  readonly recognizedSemanticHashes: readonly string[]
}

interface JournalContentReference {
  readonly schema: typeof JOURNAL_CONTENT_REFERENCE_SCHEMA
  readonly id: string
  readonly units: number
}

interface JournalContentCache {
  readonly byId: ReadonlyMap<
    string,
    Readonly<{ reference: JournalContentReference, data: string }>
  >
  readonly byValue: ReadonlyMap<string, JournalContentReference>
}

interface NormalizedJournalBody {
  readonly value: unknown
  readonly contents: readonly DocumentSessionJournalContent[]
  readonly retainedContentIds: readonly string[]
  readonly cache: JournalContentCache
}

function emptyContentCache(): JournalContentCache {
  return Object.freeze({
    byId: new Map(),
    byValue: new Map()
  })
}

function validContentId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 160 &&
    /^[A-Za-z0-9._:-]+$/.test(id)
  )
}

function freezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item)
    return Object.freeze(value) as T
  }
  for (const item of Object.values(value)) freezeJson(item)
  return Object.freeze(value)
}

function contentReference(value: unknown): JournalContentReference | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== 3 ||
    !keys.includes('schema') ||
    !keys.includes('id') ||
    !keys.includes('units') ||
    record.schema !== JOURNAL_CONTENT_REFERENCE_SCHEMA ||
    typeof record.id !== 'string' ||
    !validContentId(record.id) ||
    typeof record.units !== 'number' ||
    !Number.isSafeInteger(record.units) ||
    record.units < EXTERNAL_STRING_MINIMUM_UNITS ||
    record.units > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  ) {
    return null
  }
  return Object.freeze({
    schema: JOURNAL_CONTENT_REFERENCE_SCHEMA,
    id: record.id,
    units: record.units
  })
}

function hydrateJournalBody(
  value: unknown,
  contents: readonly DocumentSessionJournalContent[]
): Readonly<{ body: unknown, cache: JournalContentCache }> {
  const contentById = new Map<string, string>()
  for (const content of contents) {
    if (
      !validContentId(content.id) ||
      content.data.length > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits ||
      contentById.has(content.id)
    ) {
      throw new Error('Session journal content has an invalid shape')
    }
    contentById.set(content.id, content.data)
  }
  const used = new Set<string>()
  const byId = new Map<
    string,
    Readonly<{ reference: JournalContentReference, data: string }>
  >()
  const byValue = new Map<string, JournalContentReference>()

  const hydrate = (candidate: unknown): unknown => {
    const reference = contentReference(candidate)
    if (reference !== null) {
      const data = contentById.get(reference.id)
      if (data === undefined || data.length !== reference.units) {
        throw new Error('Session journal content is missing or has the wrong size')
      }
      used.add(reference.id)
      byId.set(reference.id, Object.freeze({ reference, data }))
      if (reference.id.startsWith('entry:')) {
        byValue.set(data, reference)
      }
      return data
    }
    if (Array.isArray(candidate)) {
      return candidate.map((item) => hydrate(item))
    }
    if (candidate !== null && typeof candidate === 'object') {
      const hydrated: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(candidate)) {
        hydrated[key] = hydrate(item)
      }
      return hydrated
    }
    return candidate
  }

  const body = hydrate(value)
  if (
    used.size !== contentById.size ||
    [...contentById.keys()].some((id) => !used.has(id))
  ) {
    throw new Error('Session journal retained unreachable content')
  }
  return Object.freeze({
    body,
    cache: Object.freeze({ byId, byValue })
  })
}

function normalizeJournalBody(
  body: JournalBody,
  nextRevision: number,
  previous: JournalContentCache
): NormalizedJournalBody {
  const writes: DocumentSessionJournalContent[] = []
  const retained = new Set<string>()
  const byId = new Map<
    string,
    Readonly<{ reference: JournalContentReference, data: string }>
  >()
  const byValue = new Map<string, JournalContentReference>()
  let nextSlot = 0

  const externalize = (
    data: string,
    idHint?: string
  ): JournalContentReference => {
    const existing = idHint === undefined
      ? previous.byValue.get(data) ?? byValue.get(data)
      : previous.byId.get(idHint)?.reference ?? byId.get(idHint)?.reference
    if (existing !== undefined) {
      const retainedData =
        previous.byId.get(existing.id)?.data ?? byId.get(existing.id)?.data
      if (retainedData !== undefined && retainedData !== data) {
        throw new Error('Session journal content identity changed data')
      }
      retained.add(existing.id)
      byId.set(existing.id, Object.freeze({ reference: existing, data }))
      if (idHint === undefined) byValue.set(data, existing)
      return existing
    }

    const id = idHint ?? `entry:${String(nextRevision)}:${String(nextSlot++)}`
    if (!validContentId(id)) {
      throw new Error('Session journal generated an invalid content identity')
    }
    const reference = Object.freeze({
      schema: JOURNAL_CONTENT_REFERENCE_SCHEMA,
      id,
      units: data.length
    })
    writes.push(Object.freeze({ id, data }))
    retained.add(id)
    byId.set(id, Object.freeze({ reference, data }))
    if (idHint === undefined) byValue.set(data, reference)
    return reference
  }

  const normalize = (
    candidate: unknown,
    sourceIdHint?: string
  ): unknown => {
    if (typeof candidate === 'string') {
      return candidate.length < EXTERNAL_STRING_MINIMUM_UNITS
        ? candidate
        : externalize(candidate, sourceIdHint)
    }
    if (Array.isArray(candidate)) {
      return candidate.map((item) => normalize(item))
    }
    if (candidate !== null && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>
      const normalized: Record<string, unknown> = {}
      const isWorker =
        typeof record.sourceHash === 'string' &&
        typeof record.semanticHash === 'string' &&
        Reflect.has(record, 'history') &&
        Reflect.has(record, 'source')
      for (const [key, item] of Object.entries(record)) {
        normalized[key] = normalize(
          item,
          isWorker && key === 'source'
            ? `source:${record.sourceHash}`
            : undefined
        )
      }
      return normalized
    }
    return candidate
  }

  return Object.freeze({
    value: normalize(body),
    contents: Object.freeze(writes),
    retainedContentIds: Object.freeze([...retained]),
    cache: Object.freeze({ byId, byValue })
  })
}

interface JournalIdentity {
  readonly semanticHash: string
  readonly authoringTextPolicy: string
}

function parseJournalIdentity(value: unknown): JournalIdentity | null {
  if (typeof value !== 'string') return null
  const separator = value.indexOf(':')
  if (separator !== 64) return null
  const semanticHash = value.slice(0, separator)
  const authoringTextPolicy = value.slice(separator + 1)
  if (!/^[0-9a-f]{64}$/.test(semanticHash) || authoringTextPolicy.length === 0) {
    return null
  }
  return Object.freeze({ semanticHash, authoringTextPolicy })
}

type JournalRecord = Readonly<Record<string, unknown>>

function invalidJournalShape(path: string): never {
  throw new Error(`Session journal ${path} has an invalid closed shape`)
}

function closedJournalRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = Object.freeze([])
): JournalRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidJournalShape(path)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidJournalShape(path)
  }
  const allowed = new Set([...required, ...optional])
  const keys = Reflect.ownKeys(value)
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    required.some((field) => !keys.includes(field))
  ) {
    return invalidJournalShape(path)
  }
  const record = value as JournalRecord
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidJournalShape(`${path}.${String(key)}`)
    }
  }
  return record
}

function field(
  record: JournalRecord,
  name: string,
  path: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, name)
  if (descriptor === undefined || !('value' in descriptor)) {
    return invalidJournalShape(`${path}.${name}`)
  }
  return descriptor.value
}

function boundedArray(
  value: unknown,
  path: string,
  maximum: number
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return invalidJournalShape(path)
  }
  return value
}

function boundedString(
  value: unknown,
  path: string,
  maximum = 4_096,
  allowEmpty = false
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  ) {
    return invalidJournalShape(path)
  }
  return value
}

function hashString(value: unknown, path: string): string {
  const hash = boundedString(value, path, 64)
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return invalidJournalShape(path)
  }
  return hash
}

function boundedInteger(
  value: unknown,
  path: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    return invalidJournalShape(path)
  }
  return value
}

function oneOf<const Value extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<Value>
): Value {
  if (typeof value !== 'string' || !allowed.has(value as Value)) {
    return invalidJournalShape(path)
  }
  return value as Value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    return invalidJournalShape(path)
  }
  return value
}

function validatePosition(value: unknown, path: string): void {
  const position = closedJournalRecord(value, path, ['offset', 'affinity'])
  boundedInteger(
    field(position, 'offset', path),
    `${path}.offset`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  oneOf(
    field(position, 'affinity', path),
    `${path}.affinity`,
    new Set(['previous', 'next'] as const)
  )
}

function validateInitialSelection(value: unknown, path: string): void {
  const selection = closedJournalRecord(value, path, ['anchor', 'focus'])
  validatePosition(field(selection, 'anchor', path), `${path}.anchor`)
  validatePosition(field(selection, 'focus', path), `${path}.focus`)
}

function validateSelection(value: unknown, path: string): void {
  const selection = closedJournalRecord(
    value,
    path,
    ['session', 'revision', 'view', 'anchor', 'focus']
  )
  boundedString(field(selection, 'session', path), `${path}.session`)
  boundedString(field(selection, 'revision', path), `${path}.revision`)
  oneOf(
    field(selection, 'view', path),
    `${path}.view`,
    new Set(['markup', 'source'] as const)
  )
  validatePosition(field(selection, 'anchor', path), `${path}.anchor`)
  validatePosition(field(selection, 'focus', path), `${path}.focus`)
}

function validateSourceEdit(value: unknown, path: string): number {
  const edit = closedJournalRecord(value, path, ['start', 'end', 'insert'])
  const start = boundedInteger(
    field(edit, 'start', path),
    `${path}.start`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  const end = boundedInteger(
    field(edit, 'end', path),
    `${path}.end`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  if (end < start) invalidJournalShape(path)
  return boundedString(
    field(edit, 'insert', path),
    `${path}.insert`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits,
    true
  ).length
}

function validateHistoryEntry(value: unknown, path: string): number {
  const entry = closedJournalRecord(
    value,
    path,
    [
      'forward',
      'inverse',
      'beforeSelection',
      'afterSelection',
      'beforeSourceSelection',
      'afterSourceSelection'
    ]
  )
  let insertUnits = 0
  for (const direction of ['forward', 'inverse'] as const) {
    const edits = boundedArray(
      field(entry, direction, path),
      `${path}.${direction}`,
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
    )
    for (const [index, edit] of edits.entries()) {
      insertUnits += validateSourceEdit(
        edit,
        `${path}.${direction}[${String(index)}]`
      )
      if (
        insertUnits >
        DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits
      ) {
        invalidJournalShape(`${path}.${direction}`)
      }
    }
  }
  for (const name of [
    'beforeSelection',
    'afterSelection',
    'beforeSourceSelection',
    'afterSourceSelection'
  ]) {
    validateInitialSelection(field(entry, name, path), `${path}.${name}`)
  }
  return insertUnits
}

function validateWorkerCheckpoint(value: unknown, path: string): void {
  const worker = closedJournalRecord(
    value,
    path,
    [
      'session',
      'id',
      'source',
      'sourceHash',
      'semanticHash',
      'configuration',
      'selection',
      'sourceSelection',
      'trackChanges',
      'history',
      'historyCursor',
      'historyIdentities',
      'historyIdentitySequence',
      'savedHistoryIdentity'
    ]
  )
  boundedString(field(worker, 'session', path), `${path}.session`)
  boundedString(field(worker, 'id', path), `${path}.id`)
  boundedString(
    field(worker, 'source', path),
    `${path}.source`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits,
    true
  )
  hashString(field(worker, 'sourceHash', path), `${path}.sourceHash`)
  hashString(field(worker, 'semanticHash', path), `${path}.semanticHash`)
  validateAndFreezeParseConfiguration(
    field(worker, 'configuration', path) as ParseConfiguration
  )
  validateInitialSelection(
    field(worker, 'selection', path),
    `${path}.selection`
  )
  validateInitialSelection(
    field(worker, 'sourceSelection', path),
    `${path}.sourceSelection`
  )
  booleanValue(field(worker, 'trackChanges', path), `${path}.trackChanges`)
  const history = boundedArray(
    field(worker, 'history', path),
    `${path}.history`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries
  )
  let insertUnits = 0
  for (const [index, entry] of history.entries()) {
    insertUnits += validateHistoryEntry(
      entry,
      `${path}.history[${String(index)}]`
    )
    if (
      insertUnits >
      DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits
    ) {
      invalidJournalShape(`${path}.history`)
    }
  }
  boundedInteger(
    field(worker, 'historyCursor', path),
    `${path}.historyCursor`,
    history.length
  )
  const identities = boundedArray(
    field(worker, 'historyIdentities', path),
    `${path}.historyIdentities`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries + 1
  ).map((identity, index) =>
    boundedString(identity, `${path}.historyIdentities[${String(index)}]`)
  )
  if (
    identities.length !== history.length + 1 ||
    new Set(identities).size !== identities.length
  ) {
    invalidJournalShape(`${path}.historyIdentities`)
  }
  boundedInteger(
    field(worker, 'historyIdentitySequence', path),
    `${path}.historyIdentitySequence`
  )
  boundedString(
    field(worker, 'savedHistoryIdentity', path),
    `${path}.savedHistoryIdentity`
  )
}

const SESSION_ID_FIELDS = Object.freeze([
  'revision',
  'snapshot',
  'intent',
  'operation',
  'transition',
  'lease',
  'draft',
  'plan',
  'effect'
])

function validateSessionIds(value: unknown, path: string): void {
  const ids = closedJournalRecord(value, path, SESSION_ID_FIELDS)
  for (const name of SESSION_ID_FIELDS) {
    boundedInteger(field(ids, name, path), `${path}.${name}`)
  }
}

function validateDraft(value: unknown, path: string): void {
  const draft = closedJournalRecord(
    value,
    path,
    [
      'id',
      'ticketIds',
      'sequence',
      'submittedAgainst',
      'text',
      'target',
      'reason',
      'status',
      'allowedActions'
    ]
  )
  boundedString(field(draft, 'id', path), `${path}.id`)
  const tickets = boundedArray(
    field(draft, 'ticketIds', path),
    `${path}.ticketIds`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress
  )
  for (const [index, ticket] of tickets.entries()) {
    boundedString(ticket, `${path}.ticketIds[${String(index)}]`)
  }
  boundedInteger(field(draft, 'sequence', path), `${path}.sequence`)
  boundedString(
    field(draft, 'submittedAgainst', path),
    `${path}.submittedAgainst`
  )
  boundedString(
    field(draft, 'text', path),
    `${path}.text`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits,
    true
  )
  validateSelection(field(draft, 'target', path), `${path}.target`)
  boundedString(field(draft, 'reason', path), `${path}.reason`)
  if (field(draft, 'status', path) !== 'blocked') {
    invalidJournalShape(`${path}.status`)
  }
  const actions = boundedArray(
    field(draft, 'allowedActions', path),
    `${path}.allowedActions`,
    2
  )
  if (actions.length !== 2 || actions[0] !== 'retry' || actions[1] !== 'discard') {
    invalidJournalShape(`${path}.allowedActions`)
  }
}

function validateEffect(value: unknown, path: string): void {
  const effect = closedJournalRecord(
    value,
    path,
    ['id', 'kind', 'ticket', 'code', 'status']
  )
  boundedString(field(effect, 'id', path), `${path}.id`)
  if (
    field(effect, 'kind', path) !== 'dispatch-failure' ||
    field(effect, 'code', path) !== 'precommit-failed'
  ) {
    invalidJournalShape(path)
  }
  boundedString(field(effect, 'ticket', path), `${path}.ticket`)
  oneOf(
    field(effect, 'status', path),
    `${path}.status`,
    new Set(['pending', 'acknowledged', 'cancelled'] as const)
  )
}

function validateRecoveryCheckpoint(value: unknown, path: string): void {
  const checkpoint = closedJournalRecord(
    value,
    path,
    [
      'worker',
      'ids',
      'retainedDrafts',
      'clientSequence',
      'settledWatermark',
      'effects',
      'lifecycle',
      'reopenSemanticHashes'
    ]
  )
  validateWorkerCheckpoint(field(checkpoint, 'worker', path), `${path}.worker`)
  validateSessionIds(field(checkpoint, 'ids', path), `${path}.ids`)
  const drafts = boundedArray(
    field(checkpoint, 'retainedDrafts', path),
    `${path}.retainedDrafts`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress
  )
  for (const [index, draft] of drafts.entries()) {
    validateDraft(draft, `${path}.retainedDrafts[${String(index)}]`)
  }
  boundedInteger(
    field(checkpoint, 'clientSequence', path),
    `${path}.clientSequence`
  )
  boundedInteger(
    field(checkpoint, 'settledWatermark', path),
    `${path}.settledWatermark`
  )
  const effects = boundedArray(
    field(checkpoint, 'effects', path),
    `${path}.effects`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress
  )
  for (const [index, effect] of effects.entries()) {
    validateEffect(effect, `${path}.effects[${String(index)}]`)
  }
  oneOf(
    field(checkpoint, 'lifecycle', path),
    `${path}.lifecycle`,
    new Set(['open', 'closing', 'closed'] as const)
  )
  const reopenSemanticHashes = boundedArray(
    field(checkpoint, 'reopenSemanticHashes', path),
    `${path}.reopenSemanticHashes`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
  ).map((hash, index) =>
    hashString(hash, `${path}.reopenSemanticHashes[${String(index)}]`)
  )
  if (
    new Set(reopenSemanticHashes).size !== reopenSemanticHashes.length
  ) {
    invalidJournalShape(`${path}.reopenSemanticHashes`)
  }
}

function validateIngress(value: unknown, path: string): void {
  const ingress = closedJournalRecord(
    value,
    path,
    [
      'ticket',
      'sequence',
      'submittedAgainst',
      'intent',
      'phase',
      'cancelRequested'
    ]
  )
  boundedString(field(ingress, 'ticket', path), `${path}.ticket`)
  boundedInteger(field(ingress, 'sequence', path), `${path}.sequence`)
  boundedString(
    field(ingress, 'submittedAgainst', path),
    `${path}.submittedAgainst`
  )
  decodeEditorIntent(field(ingress, 'intent', path))
  oneOf(
    field(ingress, 'phase', path),
    `${path}.phase`,
    new Set(['admitted', 'committing'] as const)
  )
  booleanValue(
    field(ingress, 'cancelRequested', path),
    `${path}.cancelRequested`
  )
}

function validateOutcome(value: unknown, path: string): void {
  const base = closedJournalRecord(
    value,
    path,
    ['kind', 'ticket', 'sequence', 'submittedAgainst'],
    [
      'transition',
      'cause',
      'history',
      'revision',
      'sourceHash',
      'semanticHash',
      'reason',
      'retainedDraft',
      'effect',
      'trackChanges',
      'projection'
    ]
  )
  const kind = oneOf(
    field(base, 'kind', path),
    `${path}.kind`,
    new Set(['committed', 'rejected', 'noop', 'cancelled', 'state-changed'] as const)
  )
  boundedString(field(base, 'ticket', path), `${path}.ticket`)
  boundedInteger(field(base, 'sequence', path), `${path}.sequence`)
  boundedString(
    field(base, 'submittedAgainst', path),
    `${path}.submittedAgainst`
  )
  if (kind === 'committed') {
    const outcome = closedJournalRecord(
      value,
      path,
      [
        'kind',
        'ticket',
        'sequence',
        'submittedAgainst',
        'transition',
        'cause',
        'history',
        'revision',
        'sourceHash',
        'semanticHash'
      ]
    )
    boundedString(field(outcome, 'transition', path), `${path}.transition`)
    oneOf(
      field(outcome, 'cause', path),
      `${path}.cause`,
      new Set(['source-edit', 'undo', 'redo'] as const)
    )
    oneOf(
      field(outcome, 'history', path),
      `${path}.history`,
      new Set(['record', 'none'] as const)
    )
    const revision = closedJournalRecord(
      field(outcome, 'revision', path),
      `${path}.revision`,
      ['base', 'next']
    )
    boundedString(
      field(revision, 'base', `${path}.revision`),
      `${path}.revision.base`
    )
    boundedString(
      field(revision, 'next', `${path}.revision`),
      `${path}.revision.next`
    )
    hashString(field(outcome, 'sourceHash', path), `${path}.sourceHash`)
    hashString(field(outcome, 'semanticHash', path), `${path}.semanticHash`)
    return
  }
  if (kind === 'rejected') {
    const outcome = closedJournalRecord(
      value,
      path,
      [
        'kind',
        'ticket',
        'sequence',
        'submittedAgainst',
        'reason',
        'revision'
      ],
      ['retainedDraft', 'effect']
    )
    boundedString(field(outcome, 'reason', path), `${path}.reason`)
    boundedString(field(outcome, 'revision', path), `${path}.revision`)
    if (Reflect.has(outcome, 'retainedDraft')) {
      validateDraft(
        field(outcome, 'retainedDraft', path),
        `${path}.retainedDraft`
      )
    }
    if (Reflect.has(outcome, 'effect')) {
      validateEffect(field(outcome, 'effect', path), `${path}.effect`)
    }
    return
  }
  if (kind === 'noop' || kind === 'cancelled') {
    const outcome = closedJournalRecord(
      value,
      path,
      ['kind', 'ticket', 'sequence', 'submittedAgainst', 'reason', 'revision']
    )
    const expectedReason = kind === 'noop' ? 'empty-insertion' : 'cancelled'
    if (field(outcome, 'reason', path) !== expectedReason) {
      invalidJournalShape(`${path}.reason`)
    }
    boundedString(field(outcome, 'revision', path), `${path}.revision`)
    return
  }
  const outcome = closedJournalRecord(
    value,
    path,
    [
      'kind',
      'ticket',
      'sequence',
      'submittedAgainst',
      'transition',
      'revision',
      'trackChanges',
      'projection'
    ]
  )
  boundedString(field(outcome, 'transition', path), `${path}.transition`)
  boundedString(field(outcome, 'revision', path), `${path}.revision`)
  booleanValue(
    field(outcome, 'trackChanges', path),
    `${path}.trackChanges`
  )
  oneOf(
    field(outcome, 'projection', path),
    `${path}.projection`,
    new Set(['marked', 'original', 'revised'] as const)
  )
}

function decodeJournalBody(value: unknown): JournalBody {
  const body = closedJournalRecord(
    value,
    'body',
    [
      'schema',
      'identity',
      'checkpoint',
      'ingress',
      'outcomes',
      'recognizedSemanticHashes'
    ]
  )
  if (field(body, 'schema', 'body') !== JOURNAL_SCHEMA) {
    invalidJournalShape('body.schema')
  }
  const identity = boundedString(field(body, 'identity', 'body'), 'body.identity')
  if (parseJournalIdentity(identity) === null) {
    invalidJournalShape('body.identity')
  }
  const checkpoint = field(body, 'checkpoint', 'body')
  if (checkpoint !== null) {
    validateRecoveryCheckpoint(checkpoint, 'body.checkpoint')
  }
  const ingress = boundedArray(
    field(body, 'ingress', 'body'),
    'body.ingress',
    DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress
  )
  for (const [index, record] of ingress.entries()) {
    validateIngress(record, `body.ingress[${String(index)}]`)
  }
  const outcomes = boundedArray(
    field(body, 'outcomes', 'body'),
    'body.outcomes',
    DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
  )
  for (const [index, outcome] of outcomes.entries()) {
    validateOutcome(outcome, `body.outcomes[${String(index)}]`)
  }
  const hashes = boundedArray(
    field(body, 'recognizedSemanticHashes', 'body'),
    'body.recognizedSemanticHashes',
    DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
  ).map((hash, index) =>
    hashString(hash, `body.recognizedSemanticHashes[${String(index)}]`)
  )
  if (new Set(hashes).size !== hashes.length) {
    invalidJournalShape('body.recognizedSemanticHashes')
  }
  return body as unknown as JournalBody
}

/**
 * A durable journal may be reopened from an older source that the same journal
 * proves was committed. This is the crash window after a pinned lease reaches
 * disk but before a newer committed head does: requiring only the document's
 * first-open identity would discard that newer fsynced head.
 *
 * The authoring policy must still match, and arbitrary external source is
 * rejected because its semantic hash appears in neither the bounded committed
 * identity ring nor the verified recovery checkpoint.
 */
function recognizesIdentity(body: JournalBody, identity: string): boolean {
  if (body.identity === identity) return true
  const stored = parseJournalIdentity(body.identity)
  const incoming = parseJournalIdentity(identity)
  if (
    stored === null ||
    incoming === null ||
    stored.authoringTextPolicy !== incoming.authoringTextPolicy
  ) {
    return false
  }
  if (body.checkpoint?.worker?.semanticHash === incoming.semanticHash) {
    return true
  }
  if (
    body.checkpoint?.reopenSemanticHashes.includes(incoming.semanticHash) ===
    true
  ) {
    return true
  }
  return body.recognizedSemanticHashes.includes(incoming.semanticHash)
}

interface ParsedJournal {
  readonly body: JournalBody
  readonly cache: JournalContentCache
}

function parseEnvelope(
  data: string,
  contents: readonly DocumentSessionJournalContent[],
  identity?: string
): ParsedJournal {
  let decodedEnvelope: unknown
  try {
    decodedEnvelope = JSON.parse(data) as unknown
  } catch (error) {
    throw new Error('Session journal envelope is not valid JSON', { cause: error })
  }
  const envelope = closedJournalRecord(
    decodedEnvelope,
    'envelope',
    ['body', 'checksum']
  )
  const encodedBody = field(envelope, 'body', 'envelope')
  const checksum = field(envelope, 'checksum', 'envelope')
  if (
    typeof encodedBody !== 'string' ||
    typeof checksum !== 'string' ||
    sourceHashV1(encodedBody) !== checksum
  ) {
    throw new Error('Session journal checksum mismatch')
  }

  let decodedBody: unknown
  try {
    decodedBody = JSON.parse(encodedBody) as unknown
  } catch (error) {
    throw new Error('Session journal body is not valid JSON', { cause: error })
  }
  const hydrated = hydrateJournalBody(decodedBody, contents)
  const body = decodeJournalBody(hydrated.body)
  if (
    identity !== undefined &&
    !recognizesIdentity(body, identity)
  ) {
    throw new Error('Session journal identity or shape mismatch')
  }
  return Object.freeze({
    body: freezeJson(body),
    cache: hydrated.cache
  })
}

function encodeEnvelope(body: unknown): string {
  const encodedBody = JSON.stringify(body)
  return JSON.stringify(
    Object.freeze({
      body: encodedBody,
      checksum: sourceHashV1(encodedBody)
    })
  )
}

function synchronizeOutcomeEffects(
  outcomes: readonly SessionTicketOutcome[],
  effects: readonly SessionEffect[]
): readonly SessionTicketOutcome[] {
  const effectsById = new Map(effects.map((effect) => [effect.id, effect]))
  return Object.freeze(
    outcomes.map((outcome): SessionTicketOutcome => {
      if (outcome.kind !== 'rejected' || outcome.effect === undefined) {
        return outcome
      }
      const effect = effectsById.get(outcome.effect.id)
      return effect === undefined
        ? outcome
        : Object.freeze({ ...outcome, effect })
    })
  )
}

/**
 * Atomic durable journal/checkpoint coordinator.
 *
 * Durability is provided by the injected storage. This class requires a CAS
 * for every mutation, verifies the complete stored checkpoint before use, and
 * refuses concurrent/stale writers rather than merging histories.
 */
export class DurableSessionJournal {
  readonly #storage: DocumentSessionJournalStorage
  readonly #key: string
  #storageRevision: number | null
  #body: JournalBody
  #contentCache: JournalContentCache
  #mailbox: Promise<void> = Promise.resolve()

  private constructor(
    storage: DocumentSessionJournalStorage,
    key: string,
    storageRevision: number | null,
    body: JournalBody,
    contentCache: JournalContentCache
  ) {
    this.#storage = storage
    this.#key = key
    this.#storageRevision = storageRevision
    this.#body = body
    this.#contentCache = contentCache
  }

  static async open(
    storage: DocumentSessionJournalStorage,
    key: string,
    identity: string
  ): Promise<DurableSessionJournal> {
    if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new TypeError('Document session durability key is not a valid identity')
    }
    const stored = await storage.read(key)
    if (stored === null) {
      return new DurableSessionJournal(
        storage,
        key,
        null,
        Object.freeze({
          schema: JOURNAL_SCHEMA,
          identity,
          checkpoint: null,
          ingress: Object.freeze([]),
          outcomes: Object.freeze([]),
          recognizedSemanticHashes: Object.freeze([])
        }),
        emptyContentCache()
      )
    }
    if (!Number.isInteger(stored.revision) || stored.revision <= 0) {
      throw new Error('Session journal storage returned an invalid revision')
    }
    const parsed = parseEnvelope(stored.data, stored.contents, identity)
    return new DurableSessionJournal(
      storage,
      key,
      stored.revision,
      parsed.body,
      parsed.cache
    )
  }

  /**
   * Reopen a main-owned journal after its sole session execution was lost.
   *
   * No renderer/file baseline participates in this path. The checksum-verified
   * journal supplies its own identity and recovery checkpoint, and the
   * recovered RevisionWorker revalidates the checkpoint's exact source,
   * source hash, semantic hash, and parse configuration.
   */
  static async recover(
    storage: DocumentSessionJournalStorage,
    key: string
  ): Promise<DurableSessionJournal> {
    if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new TypeError('Document session durability key is not a valid identity')
    }
    const stored = await storage.read(key)
    if (stored === null) {
      throw new Error('Document session journal does not exist')
    }
    if (!Number.isInteger(stored.revision) || stored.revision <= 0) {
      throw new Error('Session journal storage returned an invalid revision')
    }
    const parsed = parseEnvelope(stored.data, stored.contents)
    const body = parsed.body
    if (body.checkpoint === null) {
      throw new Error('Document session journal has no recovery checkpoint')
    }
    return new DurableSessionJournal(
      storage,
      key,
      stored.revision,
      body,
      parsed.cache
    )
  }

  get recoveryCheckpoint(): SessionRecoveryCheckpoint | null {
    return this.#body.checkpoint
  }

  pendingIngress(): readonly SessionIngressRecord[] {
    return Object.freeze(
      this.#body.ingress
        .map((record) => record)
        .sort((left, right) => left.sequence - right.sequence)
    )
  }

  ticketOutcome(ticket: IntentId): SessionTicketOutcome | null {
    const outcome = this.#body.outcomes.find((candidate) => candidate.ticket === ticket)
    return outcome ?? null
  }

  async initialize(checkpoint: SessionRecoveryCheckpoint): Promise<void> {
    await this.#enqueue(async() => {
      if (this.#body.checkpoint !== null) {
        return
      }
      await this.#write(
        Object.freeze({
          ...this.#body,
          checkpoint
        })
      )
    })
  }

  async appendIngress(
    ticket: IntentId,
    sequence: number,
    submittedAgainst: RevisionId,
    intent: EditorIntent,
    checkpoint: SessionRecoveryCheckpoint
  ): Promise<void> {
    await this.#enqueue(async() => {
      if (
        this.#body.ingress.length >=
        DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress
      ) {
        throw new Error('Session journal ingress resource limit exceeded')
      }
      if (
        this.#body.ingress.some((record) => record.ticket === ticket) ||
        this.#body.outcomes.some((outcome) => outcome.ticket === ticket)
      ) {
        throw new Error('Session journal ticket was appended more than once')
      }
      await this.#write(
        Object.freeze({
          ...this.#body,
          checkpoint,
          ingress: Object.freeze([
            ...this.#body.ingress,
            Object.freeze({
              ticket,
              sequence,
              submittedAgainst,
              intent,
              phase: 'admitted' as const,
              cancelRequested: false
            })
          ])
        })
      )
    })
  }

  async requestCancel(
    ticket: IntentId,
    checkpoint: SessionRecoveryCheckpoint
  ): Promise<'requested' | 'too-late' | 'already-terminal' | 'unknown-ticket'> {
    return this.#enqueue(async() => {
      if (this.#body.outcomes.some((outcome) => outcome.ticket === ticket)) {
        return 'already-terminal'
      }
      const ingress = this.#body.ingress.find((record) => record.ticket === ticket)
      if (ingress === undefined) {
        return 'unknown-ticket'
      }
      if (ingress.phase === 'committing') {
        return 'too-late'
      }
      if (ingress.cancelRequested) {
        return 'requested'
      }
      await this.#write(
        Object.freeze({
          ...this.#body,
          checkpoint,
          ingress: Object.freeze(
            this.#body.ingress.map((record) =>
              record.ticket === ticket
                ? Object.freeze({ ...record, cancelRequested: true })
                : record
            )
          )
        })
      )
      return 'requested'
    })
  }

  async beginCommit(ticket: IntentId): Promise<'ready' | 'cancelled'> {
    return this.#enqueue(async() => {
      const ingress = this.#body.ingress.find((record) => record.ticket === ticket)
      if (ingress === undefined) {
        throw new Error('Session journal cannot begin a missing ingress ticket')
      }
      if (ingress.cancelRequested) {
        return 'cancelled'
      }
      if (ingress.phase === 'committing') {
        return 'ready'
      }
      await this.#write(
        Object.freeze({
          ...this.#body,
          ingress: Object.freeze(
            this.#body.ingress.map((record) =>
              record.ticket === ticket
                ? Object.freeze({ ...record, phase: 'committing' as const })
                : record
            )
          )
        })
      )
      return 'ready'
    })
  }

  async settle(
    ticket: IntentId,
    checkpoint: SessionRecoveryCheckpoint,
    outcome: SessionTicketOutcome
  ): Promise<void> {
    await this.#enqueue(async() => {
      if (outcome.ticket !== ticket) {
        throw new Error('Session journal outcome does not name its ingress ticket')
      }
      if (this.#body.outcomes.some((candidate) => candidate.ticket === ticket)) {
        throw new Error('Session journal ticket already has a terminal outcome')
      }
      if (!this.#body.ingress.some((record) => record.ticket === ticket)) {
        throw new Error('Session journal cannot settle a ticket without durable ingress')
      }
      await this.#write(
        Object.freeze({
          ...this.#body,
          checkpoint,
          ingress: Object.freeze(
            this.#body.ingress.filter((record) => record.ticket !== ticket)
          ),
          outcomes: Object.freeze(
            [...this.#body.outcomes, outcome].slice(
              -DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
            )
          ),
          recognizedSemanticHashes:
            outcome.kind === 'committed'
              ? Object.freeze(
                [
                  ...this.#body.recognizedSemanticHashes.filter(
                    (hash) => hash !== outcome.semanticHash
                  ),
                  outcome.semanticHash
                ].slice(
                  -DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
                )
              )
              : this.#body.recognizedSemanticHashes
        })
      )
    })
  }

  async checkpoint(checkpoint: SessionRecoveryCheckpoint): Promise<void> {
    await this.#enqueue(() =>
      this.#write(
        Object.freeze({
          ...this.#body,
          checkpoint,
          outcomes: synchronizeOutcomeEffects(
            this.#body.outcomes,
            checkpoint.effects
          )
        })
      )
    )
  }

  async #write(next: JournalBody): Promise<void> {
    const normalized = normalizeJournalBody(
      next,
      (this.#storageRevision ?? 0) + 1,
      this.#contentCache
    )
    const stored = await this.#storage.compareExchange(
      this.#key,
      this.#storageRevision,
      Object.freeze({
        data: encodeEnvelope(normalized.value),
        contents: normalized.contents,
        retainedContentIds: normalized.retainedContentIds
      })
    )
    if (stored === null) {
      throw new Error('Session journal rejected a stale or concurrent writer')
    }
    this.#storageRevision = stored.revision
    this.#body = freezeJson(next)
    this.#contentCache = normalized.cache
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mailbox.then(operation)
    this.#mailbox = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
