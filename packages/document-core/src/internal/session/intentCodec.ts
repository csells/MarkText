import type {
  BlockConversion,
  DiagramFenceLanguage,
  CriticMarkupProjection,
  EditorIntent,
  InitialModelSelection,
  InlineFormat,
  ModelPosition,
  ModelSelection,
  MarkupModelSelection,
  QuickInsertBlock,
  SourceModelSelection
} from '../../documentSession.js'
import type { NodeId, SourceOffset, SourceRange } from '../../revision.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'
import {
  decodeDocumentSearchQuery,
  DOCUMENT_SEARCH_RESOURCE_POLICY_V1
} from '../../search.js'
import type { CriticMarkupAuthoringInput } from '../../transformationKernel.js'

const MAXIMUM_METADATA_UNITS =
  DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumQueryUnits
const MAXIMUM_INTENT_PAYLOAD_UNITS =
  DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumGeneratedReplacementUnits

const INLINE_FORMATS = new Set<InlineFormat>([
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
])

const SIMPLE_BLOCK_CONVERSIONS = new Set<BlockConversion['kind']>([
  'blockquote',
  'paragraph',
  'unordered-list',
  'ordered-list',
  'task-list',
  'loose-list-item',
  'code-block',
  'math-block',
  'html-block',
  'thematic-break',
  'front-matter'
])

const DIAGRAM_FENCE_LANGUAGES = new Set<DiagramFenceLanguage>([
  'vega-lite',
  'mermaid',
  'plantuml',
  'flowchart',
  'sequence'
])

type ClosedRecord = Readonly<Record<string, unknown>>

export class EditorIntentDecodeError extends TypeError {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'EditorIntentDecodeError'
  }
}

function fail(message: string): never {
  throw new EditorIntentDecodeError(`Editor intent ${message}`)
}

function record(value: unknown, path: string): ClosedRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`${path} must be a closed record`)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(`${path} must have a plain prototype`)
  }
  return value as ClosedRecord
}

function dataField(value: ClosedRecord, field: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field)
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !('value' in descriptor)
  ) {
    return fail(`${path}.${field} must be an enumerable data field`)
  }
  return descriptor.value
}

function closedRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = Object.freeze([])
): ClosedRecord {
  const stable = record(value, path)
  const allowed = new Set([...required, ...optional])
  const keys = Reflect.ownKeys(stable)
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    required.some((field) => !keys.includes(field))
  ) {
    return fail(`${path} fields are not closed`)
  }
  for (const key of keys) {
    dataField(stable, key as string, path)
  }
  return stable
}

function stringValue(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = true
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  ) {
    return fail(`${path} exceeds its string resource policy`)
  }
  return value
}

function enumValue<const Value extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<Value>
): Value {
  if (typeof value !== 'string' || !allowed.has(value as Value)) {
    return fail(`${path} is not supported`)
  }
  return value as Value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    return fail(`${path} must be a boolean`)
  }
  return value
}

function boundedInteger(
  value: unknown,
  path: string,
  maximum: number = DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    return fail(`${path} exceeds its integer resource policy`)
  }
  return value
}

function position(value: unknown, path: string): ModelPosition {
  const stable = closedRecord(value, path, ['offset', 'affinity'])
  return Object.freeze({
    offset: boundedInteger(dataField(stable, 'offset', path), `${path}.offset`),
    affinity: enumValue(
      dataField(stable, 'affinity', path),
      `${path}.affinity`,
      new Set(['previous', 'next'] as const)
    )
  })
}

function initialSelection(
  value: unknown,
  path: string
): InitialModelSelection {
  const stable = closedRecord(value, path, ['anchor', 'focus'])
  return Object.freeze({
    anchor: position(dataField(stable, 'anchor', path), `${path}.anchor`),
    focus: position(dataField(stable, 'focus', path), `${path}.focus`)
  })
}

function selection(
  value: unknown,
  path: string,
  requiredView: 'markup'
): MarkupModelSelection
function selection(
  value: unknown,
  path: string,
  requiredView: 'source'
): SourceModelSelection
function selection(
  value: unknown,
  path: string,
  requiredView?: undefined
): ModelSelection
function selection(
  value: unknown,
  path: string,
  requiredView?: 'markup' | 'source'
): ModelSelection {
  const stable = closedRecord(
    value,
    path,
    ['session', 'revision', 'view', 'anchor', 'focus']
  )
  const view = enumValue(
    dataField(stable, 'view', path),
    `${path}.view`,
    new Set(['markup', 'source'] as const)
  )
  if (requiredView !== undefined && view !== requiredView) {
    return fail(`${path}.view must be ${requiredView}`)
  }
  return Object.freeze({
    session: stringValue(
      dataField(stable, 'session', path),
      `${path}.session`,
      MAXIMUM_METADATA_UNITS,
      false
    ),
    revision: stringValue(
      dataField(stable, 'revision', path),
      `${path}.revision`,
      MAXIMUM_METADATA_UNITS,
      false
    ),
    view,
    anchor: position(dataField(stable, 'anchor', path), `${path}.anchor`),
    focus: position(dataField(stable, 'focus', path), `${path}.focus`)
  }) as ModelSelection
}

function nodeId(value: unknown, path: string): NodeId {
  return stringValue(
    value,
    path,
    MAXIMUM_METADATA_UNITS,
    false
  ) as NodeId
}

function sourceRange(value: unknown, path: string): SourceRange {
  const stable = closedRecord(value, path, ['start', 'end'])
  const start = boundedInteger(dataField(stable, 'start', path), `${path}.start`)
  const end = boundedInteger(dataField(stable, 'end', path), `${path}.end`)
  if (end < start) {
    return fail(`${path} is reversed`)
  }
  return Object.freeze({
    start: start as SourceOffset,
    end: end as SourceOffset
  })
}

function payloadString(value: unknown, path: string): string {
  return stringValue(value, path, MAXIMUM_INTENT_PAYLOAD_UNITS)
}

function wholeSource(value: unknown, path: string): string {
  return stringValue(
    value,
    path,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
}

function assertAggregate(
  values: readonly string[],
  path: string
): void {
  let total = 0
  for (const value of values) {
    total += value.length
    if (total > MAXIMUM_INTENT_PAYLOAD_UNITS) {
      fail(`${path} exceeds its aggregate string resource policy`)
    }
  }
}

function blockConversion(value: unknown, path: string): BlockConversion {
  const base = record(value, path)
  const kind = stringValue(
    dataField(base, 'kind', path),
    `${path}.kind`,
    MAXIMUM_METADATA_UNITS,
    false
  )
  if (kind === 'heading') {
    const stable = closedRecord(value, path, ['kind', 'level'])
    const level = boundedInteger(dataField(stable, 'level', path), `${path}.level`, 6)
    if (level < 1) fail(`${path}.level is not supported`)
    return Object.freeze({
      kind: 'heading' as const,
      level: level as 1 | 2 | 3 | 4 | 5 | 6
    })
  }
  if (kind === 'heading-shift') {
    const stable = closedRecord(value, path, ['kind', 'direction'])
    return Object.freeze({
      kind: 'heading-shift' as const,
      direction: enumValue(
        dataField(stable, 'direction', path),
        `${path}.direction`,
        new Set(['promote', 'demote'] as const)
      )
    })
  }
  const stableKind = enumValue(kind, `${path}.kind`, SIMPLE_BLOCK_CONVERSIONS)
  closedRecord(value, path, ['kind'])
  return Object.freeze({ kind: stableKind }) as BlockConversion
}

function quickInsertBlock(value: unknown, path: string): QuickInsertBlock {
  const base = record(value, path)
  const kind = stringValue(
    dataField(base, 'kind', path),
    `${path}.kind`,
    MAXIMUM_METADATA_UNITS,
    false
  )
  if (kind === 'conversion') {
    const stable = closedRecord(value, path, ['kind', 'conversion'])
    const conversion = blockConversion(
      dataField(stable, 'conversion', path),
      `${path}.conversion`
    )
    if (
      conversion.kind === 'heading-shift' ||
      conversion.kind === 'loose-list-item'
    ) {
      fail(`${path}.conversion.kind is not supported`)
    }
    return Object.freeze({
      kind,
      conversion
    })
  }
  if (kind === 'diagram') {
    const stable = closedRecord(value, path, ['kind', 'language'])
    return Object.freeze({
      kind,
      language: enumValue(
        dataField(stable, 'language', path),
        `${path}.language`,
        DIAGRAM_FENCE_LANGUAGES
      )
    })
  }
  if (kind === 'table') {
    const stable = closedRecord(value, path, [
      'kind',
      'rows',
      'columns'
    ])
    const rows = boundedInteger(
      dataField(stable, 'rows', path),
      `${path}.rows`,
      30
    )
    const columns = boundedInteger(
      dataField(stable, 'columns', path),
      `${path}.columns`,
      20
    )
    if (rows < 1 || columns < 1) {
      fail(`${path} table shape is not supported`)
    }
    return Object.freeze({ kind, rows, columns })
  }
  return fail(`${path}.kind is not supported`)
}

function criticMarkupInput(
  value: unknown,
  path: string
): CriticMarkupAuthoringInput {
  const base = record(value, path)
  const kind = stringValue(
    dataField(base, 'kind', path),
    `${path}.kind`,
    MAXIMUM_METADATA_UNITS,
    false
  )
  if (kind === 'substitution') {
    const stable = closedRecord(value, path, ['kind', 'replacement'])
    return Object.freeze({
      kind: 'substitution' as const,
      replacement: payloadString(
        dataField(stable, 'replacement', path),
        `${path}.replacement`
      )
    })
  }
  if (kind === 'comment') {
    const stable = closedRecord(value, path, ['kind', 'comment'])
    return Object.freeze({
      kind: 'comment' as const,
      comment: payloadString(
        dataField(stable, 'comment', path),
        `${path}.comment`
      )
    })
  }
  const stableKind = enumValue(
    kind,
    `${path}.kind`,
    new Set(['addition', 'deletion', 'highlight'] as const)
  )
  closedRecord(value, path, ['kind'])
  return Object.freeze({ kind: stableKind })
}

function targetIntent(
  value: unknown,
  kind: string
): Readonly<{ target: ModelSelection }> {
  const stable = closedRecord(value, 'root', ['kind', 'target'])
  return Object.freeze({
    target: selection(dataField(stable, 'target', 'root'), `${kind}.target`)
  })
}

/**
 * Decode and detach one complete editor gesture before assigning it a ticket
 * or exposing any part of it to the durable journal.
 */
export function decodeEditorIntent(value: unknown): EditorIntent {
  try {
    const base = record(value, 'root')
    const kind = stringValue(
      dataField(base, 'kind', 'root'),
      'root.kind',
      MAXIMUM_METADATA_UNITS,
      false
    )

    if (kind === 'undo' || kind === 'redo') {
      closedRecord(value, 'root', ['kind'])
      return Object.freeze({ kind })
    }
    if (
      kind === 'delete-text' ||
      kind === 'duplicate-block' ||
      kind === 'delete-block' ||
      kind === 'insert-paragraph-break' ||
      kind === 'insert-line-break' ||
      kind === 'remove-table-row' ||
      kind === 'remove-table-column' ||
      kind === 'delete-table-cell-contents'
    ) {
      return Object.freeze({ kind, ...targetIntent(value, kind) }) as EditorIntent
    }
    if (
      kind === 'insert-text' ||
      kind === 'replace-text' ||
      kind === 'commit-composition'
    ) {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'text'])
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        text: payloadString(
          dataField(stable, 'text', 'root'),
          `${kind}.text`
        )
      }) as EditorIntent
    }
    if (kind === 'replace-structure') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'replacement']
      )
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        replacement: payloadString(
          dataField(stable, 'replacement', 'root'),
          `${kind}.replacement`
        )
      })
    }
    if (kind === 'replace-current-matches') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'query', 'replacement']
      )
      return Object.freeze({
        kind,
        target: selection(
          dataField(stable, 'target', 'root'),
          'replace-current-matches.target'
        ),
        query: decodeDocumentSearchQuery(dataField(stable, 'query', 'root')),
        replacement: payloadString(
          dataField(stable, 'replacement', 'root'),
          'replace-current-matches.replacement'
        )
      })
    }
    if (kind === 'format-text') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'format'])
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), 'format-text.target'),
        format: enumValue(
          dataField(stable, 'format', 'root'),
          'format-text.format',
          INLINE_FORMATS
        )
      })
    }
    if (kind === 'convert-block') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'conversion'])
      return Object.freeze({
        kind,
        target: selection(
          dataField(stable, 'target', 'root'),
          `${kind}.target`
        ),
        conversion: blockConversion(
          dataField(stable, 'conversion', 'root'),
          'convert-block.conversion'
        )
      })
    }
    if (kind === 'quick-insert-block') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'block'])
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        block: quickInsertBlock(
          dataField(stable, 'block', 'root'),
          `${kind}.block`
        )
      })
    }
    if (kind === 'insert-paragraph') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'location'])
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), 'insert-paragraph.target'),
        location: enumValue(
          dataField(stable, 'location', 'root'),
          'insert-paragraph.location',
          new Set(['before', 'after'] as const)
        )
      })
    }
    if (kind === 'set-list-indentation') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'direction'])
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        direction: enumValue(
          dataField(stable, 'direction', 'root'),
          `${kind}.direction`,
          new Set(['increase', 'decrease'] as const)
        )
      })
    }
    if (kind === 'set-task-checked') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'checked', 'cascade']
      )
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        checked: booleanValue(
          dataField(stable, 'checked', 'root'),
          `${kind}.checked`
        ),
        cascade: booleanValue(
          dataField(stable, 'cascade', 'root'),
          `${kind}.cascade`
        )
      })
    }
    if (kind === 'set-code-language') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'language'])
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        language: stringValue(
          dataField(stable, 'language', 'root'),
          `${kind}.language`,
          MAXIMUM_METADATA_UNITS
        )
      })
    }
    if (kind === 'insert-link') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'href'],
        ['title']
      )
      const href = payloadString(dataField(stable, 'href', 'root'), `${kind}.href`)
      const title = Reflect.has(stable, 'title')
        ? payloadString(dataField(stable, 'title', 'root'), `${kind}.title`)
        : undefined
      assertAggregate(title === undefined ? [href] : [href, title], kind)
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        href,
        ...(title === undefined ? {} : { title })
      })
    }
    if (kind === 'insert-image') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'src', 'alt'],
        ['title']
      )
      const src = payloadString(dataField(stable, 'src', 'root'), `${kind}.src`)
      const alt = payloadString(dataField(stable, 'alt', 'root'), `${kind}.alt`)
      const title = Reflect.has(stable, 'title')
        ? payloadString(dataField(stable, 'title', 'root'), `${kind}.title`)
        : undefined
      assertAggregate(title === undefined ? [src, alt] : [src, alt, title], kind)
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        src,
        alt,
        ...(title === undefined ? {} : { title })
      })
    }
    if (kind === 'insert-footnote') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'label', 'content']
      )
      const label = payloadString(dataField(stable, 'label', 'root'), `${kind}.label`)
      const content = payloadString(
        dataField(stable, 'content', 'root'),
        `${kind}.content`
      )
      assertAggregate([label, content], kind)
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        label,
        content
      })
    }
    if (kind === 'create-table') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'rows', 'columns']
      )
      const rows = boundedInteger(
        dataField(stable, 'rows', 'root'),
        `${kind}.rows`,
        30
      )
      const columns = boundedInteger(
        dataField(stable, 'columns', 'root'),
        `${kind}.columns`,
        20
      )
      if (rows < 1 || columns < 1) {
        fail(`${kind} table shape is not supported`)
      }
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        rows,
        columns
      })
    }
    if (kind === 'insert-table-row' || kind === 'insert-table-column') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'location'])
      const location = kind === 'insert-table-row'
        ? enumValue(
          dataField(stable, 'location', 'root'),
          `${kind}.location`,
          new Set(['before', 'after'] as const)
        )
        : enumValue(
          dataField(stable, 'location', 'root'),
          `${kind}.location`,
          new Set(['left', 'right'] as const)
        )
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        location
      }) as EditorIntent
    }
    if (kind === 'align-table-column') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'alignment'])
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        alignment: enumValue(
          dataField(stable, 'alignment', 'root'),
          `${kind}.alignment`,
          new Set(['none', 'left', 'center', 'right'] as const)
        )
      })
    }
    if (kind === 'move-table-row' || kind === 'move-table-column') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'direction'])
      const direction = kind === 'move-table-row'
        ? enumValue(
          dataField(stable, 'direction', 'root'),
          `${kind}.direction`,
          new Set(['up', 'down'] as const)
        )
        : enumValue(
          dataField(stable, 'direction', 'root'),
          `${kind}.direction`,
          new Set(['left', 'right'] as const)
        )
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        direction
      }) as EditorIntent
    }
    if (kind === 'paste-text') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'payload'])
      const payload = closedRecord(
        dataField(stable, 'payload', 'root'),
        `${kind}.payload`,
        ['kind', 'text']
      )
      return Object.freeze({
        kind,
        target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
        payload: Object.freeze({
          kind: enumValue(
            dataField(payload, 'kind', `${kind}.payload`),
            `${kind}.payload.kind`,
            new Set(['private-source', 'markdown', 'external-text'] as const)
          ),
          text: payloadString(
            dataField(payload, 'text', `${kind}.payload`),
            `${kind}.payload.text`
          )
        })
      })
    }
    if (kind === 'author-critic-markup') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'input'])
      return Object.freeze({
        kind,
        target: selection(
          dataField(stable, 'target', 'root'),
          `${kind}.target`,
          'markup'
        ),
        input: criticMarkupInput(dataField(stable, 'input', 'root'), `${kind}.input`)
      })
    }
    if (kind === 'reload-source-from-file') {
      const stable = closedRecord(value, 'root', ['kind', 'source'])
      return Object.freeze({
        kind,
        source: wholeSource(dataField(stable, 'source', 'root'), `${kind}.source`)
      })
    }
    if (kind === 'edit-source') {
      const stable = closedRecord(
        value,
        'root',
        ['kind', 'target', 'text', 'selection']
      )
      return Object.freeze({
        kind,
        target: selection(
          dataField(stable, 'target', 'root'),
          `${kind}.target`,
          'source'
        ),
        text: payloadString(dataField(stable, 'text', 'root'), `${kind}.text`),
        selection: initialSelection(
          dataField(stable, 'selection', 'root'),
          `${kind}.selection`
        )
      })
    }
    if (kind === 'set-track-changes') {
      const stable = closedRecord(value, 'root', ['kind', 'enabled'])
      return Object.freeze({
        kind,
        enabled: booleanValue(dataField(stable, 'enabled', 'root'), `${kind}.enabled`)
      })
    }
    if (kind === 'set-projection') {
      const stable = closedRecord(value, 'root', ['kind', 'projection'])
      return Object.freeze({
        kind,
        projection: enumValue(
          dataField(stable, 'projection', 'root'),
          `${kind}.projection`,
          new Set<CriticMarkupProjection>(['marked', 'original', 'revised'])
        )
      })
    }
    if (kind === 'resolve-change') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'decision'])
      return Object.freeze({
        kind,
        target: nodeId(dataField(stable, 'target', 'root'), `${kind}.target`),
        decision: enumValue(
          dataField(stable, 'decision', 'root'),
          `${kind}.decision`,
          new Set(['accept', 'reject'] as const)
        )
      })
    }
    if (kind === 'resolve-all-changes') {
      const stable = closedRecord(value, 'root', ['kind', 'decision'])
      return Object.freeze({
        kind,
        decision: enumValue(
          dataField(stable, 'decision', 'root'),
          `${kind}.decision`,
          new Set(['accept', 'reject'] as const)
        )
      })
    }
    if (kind === 'remove-all-annotations') {
      closedRecord(value, 'root', ['kind'])
      return Object.freeze({ kind })
    }
    if (kind === 'remove-highlight' || kind === 'remove-comment') {
      const stable = closedRecord(value, 'root', ['kind', 'target'])
      return Object.freeze({
        kind,
        target: nodeId(dataField(stable, 'target', 'root'), `${kind}.target`)
      })
    }
    if (kind === 'add-comment') {
      const stable = closedRecord(value, 'root', ['kind', 'range', 'comment'])
      return Object.freeze({
        kind,
        range: sourceRange(dataField(stable, 'range', 'root'), `${kind}.range`),
        comment: payloadString(
          dataField(stable, 'comment', 'root'),
          `${kind}.comment`
        )
      })
    }
    if (kind === 'edit-comment') {
      const stable = closedRecord(value, 'root', ['kind', 'target', 'comment'])
      return Object.freeze({
        kind,
        target: nodeId(dataField(stable, 'target', 'root'), `${kind}.target`),
        comment: payloadString(
          dataField(stable, 'comment', 'root'),
          `${kind}.comment`
        )
      })
    }

    return fail(`kind ${JSON.stringify(kind)} is not supported`)
  } catch (error) {
    if (error instanceof EditorIntentDecodeError) throw error
    throw new EditorIntentDecodeError('Editor intent is malformed', error)
  }
}
