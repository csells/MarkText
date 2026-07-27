import {
  type BlockConversion,
  type CriticMarkupAuthoringInput,
  type EditorIntent,
  type InitialModelSelection,
  type InlineFormat,
  type MarkupModelSelection,
  type ModelPosition,
  type ModelSelection,
  type NodeId,
  type SourceModelSelection,
  type SourceRange,
  decodeDocumentSearchQuery
} from '@marktext/document-core'
import type {
  DocumentCoreCancelDispatchRequest,
  DocumentCoreClipboardWriteRequest,
  DocumentCoreCompleteDispatchRequest,
  DocumentCoreMainDispatchRequest,
  DocumentCoreMainSelectRequest,
  DocumentCoreOpenLinkRequest,
  DocumentCoreReconfigureMarkdownOptionsRequest,
  DocumentCoreStaticSinkRequest
} from '../../shared/types/documentCore'
import { freezeDocumentCoreExportOptions } from '../../shared/types/documentCore'

const MAX_IDENTIFIER_UNITS = 1_024
const MAX_DOCUMENT_UNITS = 32_000_000
const MAX_TABLE_DIMENSION = 10_000
const MAX_FILENAME_UNITS = 255

type ClosedRecord = Readonly<Record<string, unknown>>

function hasControlCharacter(value: string): boolean {
  return [...value].some(character => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    )
  })
}

function codecError(label: string, detail: string): TypeError {
  return new TypeError(`Invalid document-core ${label}: ${detail}`)
}

function closedRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = Object.freeze([])
): ClosedRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw codecError(label, 'must be a closed record')
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    throw codecError(label, 'has an unknown symbol field')
  }
  const allowed = new Set([...required, ...optional])
  const actual = keys as string[]
  const missing = required.filter((key) => !actual.includes(key))
  const unknown = actual.filter((key) => !allowed.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length === 0 ? '' : `missing fields ${missing.join(', ')}`,
      unknown.length === 0 ? '' : `unknown fields ${unknown.join(', ')}`
    ].filter(Boolean)
    throw codecError(label, `fields are not closed (${details.join('; ')})`)
  }
  const record = value as Record<string, unknown>
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw codecError(label, `${key} must be an enumerable data field`)
    }
  }
  return record
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_UNITS ||
    hasControlCharacter(value)
  ) {
    throw codecError(label, 'identifier must be a nonempty bounded printable string')
  }
  return value
}

function text(
  value: unknown,
  label: string,
  maximumUnits = MAX_DOCUMENT_UNITS
): string {
  if (typeof value !== 'string' || value.length > maximumUnits) {
    throw codecError(label, `text must be a string of at most ${maximumUnits} UTF-16 units`)
  }
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw codecError(label, 'must be a boolean')
  }
  return value
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw codecError(label, `must be a safe integer from ${minimum} through ${maximum}`)
  }
  return value as number
}

function oneOf<const Value extends string>(
  value: unknown,
  label: string,
  allowed: readonly Value[]
): Value {
  if (
    typeof value !== 'string' ||
    !allowed.includes(value as Value)
  ) {
    throw codecError(label, `must be one of ${allowed.join(', ')}`)
  }
  return value as Value
}

function optionalText(
  record: ClosedRecord,
  key: string,
  label: string
): Readonly<Record<string, string>> {
  return record[key] === undefined
    ? Object.freeze({})
    : Object.freeze({ [key]: text(record[key], `${label}.${key}`) })
}

function modelPosition(value: unknown, label: string): ModelPosition {
  const record = closedRecord(value, label, ['offset', 'affinity'])
  return Object.freeze({
    offset: integer(record.offset, `${label}.offset`, 0, MAX_DOCUMENT_UNITS),
    affinity: oneOf(record.affinity, `${label}.affinity`, ['previous', 'next'])
  })
}

function initialModelSelection(
  value: unknown,
  label: string
): InitialModelSelection {
  const record = closedRecord(value, label, ['anchor', 'focus'])
  return Object.freeze({
    anchor: modelPosition(record.anchor, `${label}.anchor`),
    focus: modelPosition(record.focus, `${label}.focus`)
  })
}

function modelSelection(value: unknown, label: string): ModelSelection {
  const record = closedRecord(
    value,
    label,
    ['session', 'revision', 'view', 'anchor', 'focus']
  )
  const common = {
    session: identifier(record.session, `${label}.session`),
    revision: identifier(record.revision, `${label}.revision`),
    anchor: modelPosition(record.anchor, `${label}.anchor`),
    focus: modelPosition(record.focus, `${label}.focus`)
  }
  const view = oneOf(record.view, `${label}.view`, ['markup', 'source'])
  return view === 'markup'
    ? Object.freeze({ ...common, view }) as MarkupModelSelection
    : Object.freeze({ ...common, view }) as SourceModelSelection
}

function markupModelSelection(
  value: unknown,
  label: string
): MarkupModelSelection {
  const selection = modelSelection(value, label)
  if (selection.view !== 'markup') {
    throw codecError(label, 'must name the markup view')
  }
  return selection
}

function sourceModelSelection(
  value: unknown,
  label: string
): SourceModelSelection {
  const selection = modelSelection(value, label)
  if (selection.view !== 'source') {
    throw codecError(label, 'must name the source view')
  }
  return selection
}

function sourceRange(
  value: unknown,
  label: string
): SourceRange {
  const record = closedRecord(value, label, ['start', 'end'])
  const start = integer(record.start, `${label}.start`, 0, MAX_DOCUMENT_UNITS)
  const end = integer(record.end, `${label}.end`, start, MAX_DOCUMENT_UNITS)
  return Object.freeze({ start, end }) as SourceRange
}

function withTarget(
  record: ClosedRecord,
  kind: string
): Readonly<{ kind: string; target: ModelSelection }> {
  return Object.freeze({
    kind,
    target: modelSelection(record.target, `intent.${kind}.target`)
  })
}

function blockConversion(value: unknown): BlockConversion {
  const base = closedRecord(value, 'intent.convert-block.conversion', ['kind'], ['level', 'direction'])
  const kind = oneOf(
    base.kind,
    'intent.convert-block.conversion.kind',
    [
      'heading',
      'blockquote',
      'paragraph',
      'heading-shift',
      'unordered-list',
      'ordered-list',
      'task-list',
      'loose-list-item',
      'code-block',
      'math-block',
      'html-block',
      'thematic-break',
      'front-matter'
    ]
  )
  if (kind === 'heading') {
    closedRecord(value, 'intent.convert-block.conversion', ['kind', 'level'])
    return Object.freeze({
      kind,
      level: integer(base.level, 'intent.convert-block.conversion.level', 1, 6) as
        1 | 2 | 3 | 4 | 5 | 6
    })
  }
  if (kind === 'heading-shift') {
    closedRecord(value, 'intent.convert-block.conversion', ['kind', 'direction'])
    return Object.freeze({
      kind,
      direction: oneOf(
        base.direction,
        'intent.convert-block.conversion.direction',
        ['promote', 'demote']
      )
    })
  }
  closedRecord(value, 'intent.convert-block.conversion', ['kind'])
  return Object.freeze({ kind })
}

function authoringInput(value: unknown): CriticMarkupAuthoringInput {
  const base = closedRecord(
    value,
    'intent.author-critic-markup.input',
    ['kind'],
    ['replacement', 'comment']
  )
  const kind = oneOf(
    base.kind,
    'intent.author-critic-markup.input.kind',
    ['addition', 'deletion', 'substitution', 'highlight', 'comment']
  )
  if (kind === 'substitution') {
    closedRecord(value, 'intent.author-critic-markup.input', ['kind', 'replacement'])
    return Object.freeze({
      kind,
      replacement: text(
        base.replacement,
        'intent.author-critic-markup.input.replacement'
      )
    })
  }
  if (kind === 'comment') {
    closedRecord(value, 'intent.author-critic-markup.input', ['kind', 'comment'])
    return Object.freeze({
      kind,
      comment: text(base.comment, 'intent.author-critic-markup.input.comment')
    })
  }
  closedRecord(value, 'intent.author-critic-markup.input', ['kind'])
  return Object.freeze({ kind })
}

function editorIntent(value: unknown): EditorIntent {
  const base = closedRecord(value, 'intent', ['kind'], [
    'target',
    'text',
    'query',
    'format',
    'replacement',
    'conversion',
    'location',
    'direction',
    'language',
    'href',
    'title',
    'src',
    'alt',
    'label',
    'content',
    'rows',
    'columns',
    'alignment',
    'source',
    'selection',
    'input',
    'enabled',
    'checked',
    'cascade',
    'projection',
    'decision',
    'range',
    'comment'
  ])
  const kind = identifier(base.kind, 'intent.kind')
  switch (kind) {
    case 'insert-text':
    case 'replace-text':
    case 'commit-composition': {
      const record = closedRecord(value, `intent.${kind}`, ['kind', 'target', 'text'])
      return Object.freeze({
        ...withTarget(record, kind),
        text: text(record.text, `intent.${kind}.text`)
      }) as EditorIntent
    }
    case 'replace-current-matches': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'query', 'replacement']
      )
      const query = decodeDocumentSearchQuery(record.query)
      if (query.text.length > MAX_DOCUMENT_UNITS) {
        throw codecError(
          `intent.${kind}.query.text`,
          `text must be at most ${MAX_DOCUMENT_UNITS} UTF-16 units`
        )
      }
      return Object.freeze({
        ...withTarget(record, kind),
        query,
        replacement: text(
          record.replacement,
          `intent.${kind}.replacement`
        )
      }) as EditorIntent
    }
    case 'delete-text':
    case 'duplicate-block':
    case 'delete-block':
    case 'insert-paragraph-break':
    case 'insert-line-break':
    case 'remove-table-row':
    case 'remove-table-column':
    case 'delete-table-cell-contents': {
      const record = closedRecord(value, `intent.${kind}`, ['kind', 'target'])
      return withTarget(record, kind) as EditorIntent
    }
    case 'format-text': {
      const record = closedRecord(value, `intent.${kind}`, ['kind', 'target', 'format'])
      return Object.freeze({
        ...withTarget(record, kind),
        format: oneOf<InlineFormat>(
          record.format,
          'intent.format-text.format',
          [
            'strong',
            'emphasis',
            'underline',
            'superscript',
            'subscript',
            'highlight',
            'inline-code',
            'inline-math',
            'strikethrough',
            'link',
            'image',
            'clear'
          ]
        )
      }) as EditorIntent
    }
    case 'replace-structure': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'replacement']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        replacement: text(record.replacement, 'intent.replace-structure.replacement')
      }) as EditorIntent
    }
    case 'convert-block':
    case 'quick-insert-block': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'conversion']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        conversion: blockConversion(record.conversion)
      }) as EditorIntent
    }
    case 'insert-paragraph':
    case 'insert-table-row': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'location']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        location: oneOf(record.location, `intent.${kind}.location`, ['before', 'after'])
      }) as EditorIntent
    }
    case 'insert-table-column': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'location']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        location: oneOf(record.location, `intent.${kind}.location`, ['left', 'right'])
      }) as EditorIntent
    }
    case 'set-list-indentation': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'direction']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        direction: oneOf(
          record.direction,
          `intent.${kind}.direction`,
          ['increase', 'decrease']
        )
      }) as EditorIntent
    }
    case 'set-task-checked': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'checked', 'cascade']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        checked: booleanValue(
          record.checked,
          `intent.${kind}.checked`
        ),
        cascade: booleanValue(
          record.cascade,
          `intent.${kind}.cascade`
        )
      }) as EditorIntent
    }
    case 'move-table-row': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'direction']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        direction: oneOf(record.direction, `intent.${kind}.direction`, ['up', 'down'])
      }) as EditorIntent
    }
    case 'move-table-column': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'direction']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        direction: oneOf(
          record.direction,
          `intent.${kind}.direction`,
          ['left', 'right']
        )
      }) as EditorIntent
    }
    case 'set-code-language': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'language']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        language: text(record.language, `intent.${kind}.language`, 1_024)
      }) as EditorIntent
    }
    case 'insert-link': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'href'],
        ['title']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        href: text(record.href, `intent.${kind}.href`),
        ...optionalText(record, 'title', `intent.${kind}`)
      }) as EditorIntent
    }
    case 'insert-image': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'src', 'alt'],
        ['title']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        src: text(record.src, `intent.${kind}.src`),
        alt: text(record.alt, `intent.${kind}.alt`),
        ...optionalText(record, 'title', `intent.${kind}`)
      }) as EditorIntent
    }
    case 'insert-footnote': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'label', 'content']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        label: text(record.label, `intent.${kind}.label`),
        content: text(record.content, `intent.${kind}.content`)
      }) as EditorIntent
    }
    case 'create-table': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'rows', 'columns']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        rows: integer(record.rows, `intent.${kind}.rows`, 1, MAX_TABLE_DIMENSION),
        columns: integer(
          record.columns,
          `intent.${kind}.columns`,
          1,
          MAX_TABLE_DIMENSION
        )
      }) as EditorIntent
    }
    case 'align-table-column': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'alignment']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        alignment: oneOf(
          record.alignment,
          `intent.${kind}.alignment`,
          ['none', 'left', 'center', 'right']
        )
      }) as EditorIntent
    }
    case 'paste-text': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'text', 'source']
      )
      return Object.freeze({
        ...withTarget(record, kind),
        text: text(record.text, `intent.${kind}.text`),
        source: oneOf(
          record.source,
          `intent.${kind}.source`,
          ['external-text', 'raw-source-import']
        )
      }) as EditorIntent
    }
    case 'author-critic-markup': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'input']
      )
      return Object.freeze({
        kind,
        target: markupModelSelection(record.target, `intent.${kind}.target`),
        input: authoringInput(record.input)
      })
    }
    case 'edit-source': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'text', 'selection']
      )
      return Object.freeze({
        kind,
        target: sourceModelSelection(record.target, `intent.${kind}.target`),
        text: text(record.text, `intent.${kind}.text`),
        selection: initialModelSelection(
          record.selection,
          `intent.${kind}.selection`
        )
      })
    }
    case 'set-track-changes': {
      const record = closedRecord(value, `intent.${kind}`, ['kind', 'enabled'])
      return Object.freeze({
        kind,
        enabled: booleanValue(record.enabled, `intent.${kind}.enabled`)
      })
    }
    case 'set-projection': {
      const record = closedRecord(value, `intent.${kind}`, ['kind', 'projection'])
      return Object.freeze({
        kind,
        projection: oneOf(
          record.projection,
          `intent.${kind}.projection`,
          ['marked', 'original', 'revised']
        )
      })
    }
    case 'resolve-change': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'decision']
      )
      return Object.freeze({
        kind,
        target: identifier(record.target, `intent.${kind}.target`) as NodeId,
        decision: oneOf(
          record.decision,
          `intent.${kind}.decision`,
          ['accept', 'reject']
        )
      })
    }
    case 'resolve-all-changes': {
      const record = closedRecord(value, `intent.${kind}`, ['kind', 'decision'])
      return Object.freeze({
        kind,
        decision: oneOf(
          record.decision,
          `intent.${kind}.decision`,
          ['accept', 'reject']
        )
      })
    }
    case 'remove-highlight':
    case 'remove-comment': {
      const record = closedRecord(value, `intent.${kind}`, ['kind', 'target'])
      return Object.freeze({
        kind,
        target: identifier(record.target, `intent.${kind}.target`) as NodeId
      }) as EditorIntent
    }
    case 'add-comment': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'range', 'comment']
      )
      return Object.freeze({
        kind,
        range: sourceRange(record.range, `intent.${kind}.range`),
        comment: text(record.comment, `intent.${kind}.comment`)
      })
    }
    case 'edit-comment': {
      const record = closedRecord(
        value,
        `intent.${kind}`,
        ['kind', 'target', 'comment']
      )
      return Object.freeze({
        kind,
        target: identifier(record.target, `intent.${kind}.target`) as NodeId,
        comment: text(record.comment, `intent.${kind}.comment`)
      })
    }
    case 'undo':
    case 'redo':
      closedRecord(value, `intent.${kind}`, ['kind'])
      return Object.freeze({ kind })
    default:
      throw codecError('intent.kind', `unknown intent ${JSON.stringify(kind)}`)
  }
}

function documentAndTicket(
  value: unknown,
  label: string
): Readonly<{ documentId: string; ticketId: string }> {
  const record = closedRecord(value, label, ['documentId', 'ticketId'])
  return Object.freeze({
    documentId: identifier(record.documentId, `${label}.documentId`),
    ticketId: identifier(record.ticketId, `${label}.ticketId`)
  })
}

export function decodeDocumentCoreMainDispatchRequest(
  value: unknown
): DocumentCoreMainDispatchRequest {
  const record = closedRecord(
    value,
    'dispatch-start request',
    ['documentId', 'baseSnapshotId', 'intent']
  )
  return Object.freeze({
    documentId: identifier(record.documentId, 'dispatch-start request.documentId'),
    baseSnapshotId: identifier(
      record.baseSnapshotId,
      'dispatch-start request.baseSnapshotId'
    ),
    intent: editorIntent(record.intent)
  })
}

export function decodeDocumentCoreReconfigureMarkdownOptionsRequest(
  value: unknown
): DocumentCoreReconfigureMarkdownOptionsRequest {
  const record = closedRecord(
    value,
    'reconfigure request',
    ['documentId', 'baseSnapshotId', 'patch']
  )
  const patch = closedRecord(
    record.patch,
    'reconfigure request.patch',
    [],
    ['footnotes', 'gitLabMath', 'subscriptAndSuperscript']
  )
  const stablePatch: {
    footnotes?: boolean
    gitLabMath?: boolean
    subscriptAndSuperscript?: boolean
  } = {}
  for (const key of [
    'footnotes',
    'gitLabMath',
    'subscriptAndSuperscript'
  ] as const) {
    if (patch[key] !== undefined) {
      stablePatch[key] = booleanValue(
        patch[key],
        `reconfigure request.patch.${key}`
      )
    }
  }
  return Object.freeze({
    documentId: identifier(record.documentId, 'reconfigure request.documentId'),
    baseSnapshotId: identifier(
      record.baseSnapshotId,
      'reconfigure request.baseSnapshotId'
    ),
    patch: Object.freeze(stablePatch)
  })
}

export function decodeDocumentCoreCompleteDispatchRequest(
  value: unknown
): DocumentCoreCompleteDispatchRequest {
  return documentAndTicket(value, 'dispatch-complete request')
}

export function decodeDocumentCoreCancelDispatchRequest(
  value: unknown
): DocumentCoreCancelDispatchRequest {
  return documentAndTicket(value, 'dispatch-cancel request')
}

export function decodeDocumentCoreMainSelectRequest(
  value: unknown
): DocumentCoreMainSelectRequest {
  const record = closedRecord(
    value,
    'select request',
    ['documentId', 'baseSnapshotId', 'view', 'selection']
  )
  return Object.freeze({
    documentId: identifier(record.documentId, 'select request.documentId'),
    baseSnapshotId: identifier(
      record.baseSnapshotId,
      'select request.baseSnapshotId'
    ),
    view: oneOf(
      record.view,
      'select request.view',
      ['markup', 'source']
    ),
    selection: initialModelSelection(record.selection, 'select request.selection')
  })
}

function consumerView(value: unknown, label: string) {
  return oneOf(value, label, ['markup', 'original', 'revised'])
}

export function decodeDocumentCoreClipboardWriteRequest(
  value: unknown
): DocumentCoreClipboardWriteRequest {
  const candidate = value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const consumerDescriptor = candidate === null
    ? undefined
    : Object.getOwnPropertyDescriptor(candidate, 'consumer')
  if (
    consumerDescriptor !== undefined &&
    'value' in consumerDescriptor &&
    consumerDescriptor.value === 'copy-heading-link'
  ) {
    const headingRecord = closedRecord(
      value,
      'clipboard heading-link request',
      [
        'documentId',
        'revisionId',
        'view',
        'consumer',
        'targetNodeId'
      ]
    )
    return Object.freeze({
      documentId: identifier(
        headingRecord.documentId,
        'clipboard heading-link request.documentId'
      ),
      revisionId: identifier(
        headingRecord.revisionId,
        'clipboard heading-link request.revisionId'
      ),
      view: consumerView(
        headingRecord.view,
        'clipboard heading-link request.view'
      ),
      consumer: 'copy-heading-link',
      targetNodeId: identifier(
        headingRecord.targetNodeId,
        'clipboard heading-link request.targetNodeId'
      ) as NodeId
    })
  }
  const record = closedRecord(
    value,
    'clipboard request',
    ['documentId', 'revisionId', 'view', 'consumer', 'selection']
  )
  const view = oneOf(
    record.view,
    'clipboard request.view',
    ['markup', 'original', 'revised', 'source']
  )
  const consumer = oneOf(
    record.consumer,
    'clipboard request.consumer',
    [
      'normal-copy',
      'copy-rich',
      'copy-html',
      'copy-markdown',
      'copy-table',
      'cut',
      'cut-table'
    ]
  )
  if (
    view === 'source' &&
    consumer !== 'normal-copy' &&
    consumer !== 'copy-markdown' &&
    consumer !== 'cut'
  ) {
    throw codecError(
      'clipboard request.consumer',
      'source view supports only normal-copy, copy-markdown, or cut'
    )
  }
  return Object.freeze({
    documentId: identifier(record.documentId, 'clipboard request.documentId'),
    revisionId: identifier(record.revisionId, 'clipboard request.revisionId'),
    view,
    consumer,
    selection: sourceRange(record.selection, 'clipboard request.selection')
  })
}

export function decodeDocumentCoreOpenLinkRequest(
  value: unknown
): DocumentCoreOpenLinkRequest {
  const record = closedRecord(
    value,
    'open-link request',
    ['documentId', 'revisionId', 'targetNodeId']
  )
  return Object.freeze({
    documentId: identifier(
      record.documentId,
      'open-link request.documentId'
    ),
    revisionId: identifier(
      record.revisionId,
      'open-link request.revisionId'
    ),
    targetNodeId: identifier(
      record.targetNodeId,
      'open-link request.targetNodeId'
    ) as NodeId
  })
}

function suggestedFilename(value: unknown, label: string): string {
  const filename = text(value, label, MAX_FILENAME_UNITS)
  if (
    filename.length === 0 ||
    filename === '.' ||
    filename === '..' ||
    filename.includes('/') ||
    filename.includes('\\') ||
    hasControlCharacter(filename)
  ) {
    throw codecError(
      label,
      'must be a bounded filename without separators or control characters'
    )
  }
  return filename
}

export function decodeDocumentCoreStaticSinkRequest(
  value: unknown
): DocumentCoreStaticSinkRequest {
  const base = closedRecord(
    value,
    'static sink request',
    ['documentId', 'revisionId', 'view', 'consumer', 'options'],
    ['suggestedName']
  )
  const documentId = identifier(
    base.documentId,
    'static sink request.documentId'
  )
  const revisionId = identifier(
    base.revisionId,
    'static sink request.revisionId'
  )
  const view = consumerView(base.view, 'static sink request.view')
  const consumer = oneOf(
    base.consumer,
    'static sink request.consumer',
    ['styled-html', 'pdf', 'print']
  )
  const options = freezeDocumentCoreExportOptions(base.options)
  if (consumer === 'styled-html') {
    const record = closedRecord(
      value,
      'styled HTML sink request',
      [
        'documentId',
        'revisionId',
        'view',
        'consumer',
        'suggestedName',
        'options'
      ]
    )
    return Object.freeze({
      documentId,
      revisionId,
      view,
      consumer,
      options,
      suggestedName: suggestedFilename(
        record.suggestedName,
        'styled HTML sink request.suggestedName'
      )
    })
  }
  if (consumer === 'pdf') {
    const record = closedRecord(
      value,
      'PDF sink request',
      [
        'documentId',
        'revisionId',
        'view',
        'consumer',
        'suggestedName',
        'options'
      ]
    )
    return Object.freeze({
      documentId,
      revisionId,
      view,
      consumer,
      options,
      suggestedName: suggestedFilename(
        record.suggestedName,
        'PDF sink request.suggestedName'
      )
    })
  }
  closedRecord(
    value,
    'print sink request',
    ['documentId', 'revisionId', 'view', 'consumer', 'options']
  )
  return Object.freeze({
    documentId,
    revisionId,
    view,
    consumer,
    options
  })
}
