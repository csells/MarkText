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
/**
 * Where a wire intent came from. The renderer origin is the restrictive
 * default: host-only intents decode only when the caller vouches for the
 * host boundary (journal recovery, the main process's own file flows).
 */
export interface EditorIntentDecodeContext {
  readonly origin: 'host' | 'renderer'
}

const RENDERER_ORIGIN: EditorIntentDecodeContext =
  Object.freeze({ origin: 'renderer' })

type IntentOfKind<K extends EditorIntent['kind']> =
  Extract<EditorIntent, { kind: K }>

type IntentDecoder<K extends EditorIntent['kind']> = (
  value: unknown,
  context: EditorIntentDecodeContext
) => IntentOfKind<K>

function kindOnly<K extends 'undo' | 'redo' | 'remove-all-annotations'>(
  kind: K
): IntentDecoder<K> {
  return (value) => {
    closedRecord(value, 'root', ['kind'])
    return Object.freeze({ kind }) as IntentOfKind<K>
  }
}

function targetOnly<K extends
  | 'delete-text'
  | 'duplicate-block'
  | 'delete-block'
  | 'insert-paragraph-break'
  | 'insert-line-break'
  | 'remove-table-row'
  | 'remove-table-column'
  | 'delete-table-cell-contents'
>(kind: K): IntentDecoder<K> {
  return (value) =>
    Object.freeze({ kind, ...targetIntent(value, kind) }) as IntentOfKind<K>
}

function targetAndText<K extends
  | 'insert-text'
  | 'replace-text'
  | 'commit-composition'
>(kind: K): IntentDecoder<K> {
  return (value) => {
    const stable = closedRecord(value, 'root', ['kind', 'target', 'text'])
    return Object.freeze({
      kind,
      target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
      text: payloadString(
        dataField(stable, 'text', 'root'),
        `${kind}.text`
      )
    }) as IntentOfKind<K>
  }
}

function targetAndEnum<
  K extends EditorIntent['kind'],
  F extends string,
  V extends string
>(
  kind: K,
  field: F,
  values: ReadonlySet<V>
): IntentDecoder<K> {
  return (value) => {
    const stable = closedRecord(value, 'root', ['kind', 'target', field])
    return Object.freeze({
      kind,
      target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
      [field]: enumValue(
        dataField(stable, field, 'root'),
        `${kind}.${field}`,
        values
      )
    }) as unknown as IntentOfKind<K>
  }
}

function nodeTarget<K extends 'remove-highlight' | 'remove-comment'>(
  kind: K
): IntentDecoder<K> {
  return (value) => {
    const stable = closedRecord(value, 'root', ['kind', 'target'])
    return Object.freeze({
      kind,
      target: nodeId(dataField(stable, 'target', 'root'), `${kind}.target`)
    }) as IntentOfKind<K>
  }
}

/**
 * One decoder per union arm. The mapped key set is the drift guard: a union
 * arm without a decoder, or a decoder without a union arm, is a compile
 * error — the union stays the single hand-written intent declaration.
 */
const INTENT_DECODERS: {
  readonly [K in EditorIntent['kind']]: IntentDecoder<K>
} = Object.freeze({
  'undo': kindOnly('undo'),
  'redo': kindOnly('redo'),
  'remove-all-annotations': kindOnly('remove-all-annotations'),
  'delete-text': targetOnly('delete-text'),
  'duplicate-block': targetOnly('duplicate-block'),
  'delete-block': targetOnly('delete-block'),
  'insert-paragraph-break': targetOnly('insert-paragraph-break'),
  'insert-line-break': targetOnly('insert-line-break'),
  'remove-table-row': targetOnly('remove-table-row'),
  'remove-table-column': targetOnly('remove-table-column'),
  'delete-table-cell-contents': targetOnly('delete-table-cell-contents'),
  'insert-text': targetAndText('insert-text'),
  'replace-text': targetAndText('replace-text'),
  'commit-composition': targetAndText('commit-composition'),
  'replace-structure': (value) => {
    const stable = closedRecord(
      value,
      'root',
      ['kind', 'target', 'replacement']
    )
    const kind = 'replace-structure' as const
    return Object.freeze({
      kind,
      target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
      replacement: payloadString(
        dataField(stable, 'replacement', 'root'),
        `${kind}.replacement`
      )
    })
  },
  'replace-current-matches': (value) => {
    const stable = closedRecord(
      value,
      'root',
      ['kind', 'target', 'query', 'replacement']
    )
    return Object.freeze({
      kind: 'replace-current-matches' as const,
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
  },
  'format-text': (value) => {
    const stable = closedRecord(value, 'root', ['kind', 'target', 'format'])
    return Object.freeze({
      kind: 'format-text' as const,
      target: selection(dataField(stable, 'target', 'root'), 'format-text.target'),
      format: enumValue(
        dataField(stable, 'format', 'root'),
        'format-text.format',
        INLINE_FORMATS
      )
    })
  },
  'convert-block': (value) => {
    const kind = 'convert-block' as const
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
  },
  'quick-insert-block': (value) => {
    const kind = 'quick-insert-block' as const
    const stable = closedRecord(value, 'root', ['kind', 'target', 'block'])
    return Object.freeze({
      kind,
      target: selection(dataField(stable, 'target', 'root'), `${kind}.target`),
      block: quickInsertBlock(
        dataField(stable, 'block', 'root'),
        `${kind}.block`
      )
    })
  },
  'insert-paragraph': targetAndEnum(
    'insert-paragraph',
    'location',
    new Set(['before', 'after'] as const)
  ),
  'set-list-indentation': targetAndEnum(
    'set-list-indentation',
    'direction',
    new Set(['increase', 'decrease'] as const)
  ),
  'set-task-checked': (value) => {
    const kind = 'set-task-checked' as const
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
  },
  'set-code-language': (value) => {
    const kind = 'set-code-language' as const
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
  },
  'insert-link': (value) => {
    const kind = 'insert-link' as const
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
  },
  'insert-image': (value) => {
    const kind = 'insert-image' as const
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
  },
  'insert-footnote': (value) => {
    const kind = 'insert-footnote' as const
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
  },
  'create-table': (value) => {
    const kind = 'create-table' as const
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
  },
  'insert-table-row': targetAndEnum(
    'insert-table-row',
    'location',
    new Set(['before', 'after'] as const)
  ),
  'insert-table-column': targetAndEnum(
    'insert-table-column',
    'location',
    new Set(['left', 'right'] as const)
  ),
  'align-table-column': targetAndEnum(
    'align-table-column',
    'alignment',
    new Set(['none', 'left', 'center', 'right'] as const)
  ),
  'move-table-row': targetAndEnum(
    'move-table-row',
    'direction',
    new Set(['up', 'down'] as const)
  ),
  'move-table-column': targetAndEnum(
    'move-table-column',
    'direction',
    new Set(['left', 'right'] as const)
  ),
  'paste-text': (value) => {
    const kind = 'paste-text' as const
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
  },
  'author-critic-markup': (value) => {
    const kind = 'author-critic-markup' as const
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
  },
  'reload-source-from-file': (value, context) => {
    const kind = 'reload-source-from-file' as const
    if (context.origin !== 'host') {
      return fail(
        'reload-source-from-file is host-only: a renderer edits source ' +
        'through authenticated ranges and can never supply a ' +
        'whole-document replacement'
      )
    }
    const stable = closedRecord(value, 'root', ['kind', 'source'])
    return Object.freeze({
      kind,
      source: wholeSource(dataField(stable, 'source', 'root'), `${kind}.source`)
    })
  },
  'edit-source': (value) => {
    const kind = 'edit-source' as const
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
  },
  'set-track-changes': (value) => {
    const kind = 'set-track-changes' as const
    const stable = closedRecord(value, 'root', ['kind', 'enabled'])
    return Object.freeze({
      kind,
      enabled: booleanValue(dataField(stable, 'enabled', 'root'), `${kind}.enabled`)
    })
  },
  'set-projection': (value) => {
    const kind = 'set-projection' as const
    const stable = closedRecord(value, 'root', ['kind', 'projection'])
    return Object.freeze({
      kind,
      projection: enumValue(
        dataField(stable, 'projection', 'root'),
        `${kind}.projection`,
        new Set<CriticMarkupProjection>(['marked', 'original', 'revised'])
      )
    })
  },
  'resolve-change': (value) => {
    const kind = 'resolve-change' as const
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
  },
  'resolve-all-changes': (value) => {
    const kind = 'resolve-all-changes' as const
    const stable = closedRecord(value, 'root', ['kind', 'decision'])
    return Object.freeze({
      kind,
      decision: enumValue(
        dataField(stable, 'decision', 'root'),
        `${kind}.decision`,
        new Set(['accept', 'reject'] as const)
      )
    })
  },
  'remove-highlight': nodeTarget('remove-highlight'),
  'remove-comment': nodeTarget('remove-comment'),
  'add-comment': (value) => {
    const kind = 'add-comment' as const
    const stable = closedRecord(value, 'root', ['kind', 'range', 'comment'])
    return Object.freeze({
      kind,
      range: sourceRange(dataField(stable, 'range', 'root'), `${kind}.range`),
      comment: payloadString(
        dataField(stable, 'comment', 'root'),
        `${kind}.comment`
      )
    })
  },
  'edit-comment': (value) => {
    const kind = 'edit-comment' as const
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
})

export function decodeEditorIntent(
  value: unknown,
  context: EditorIntentDecodeContext = RENDERER_ORIGIN
): EditorIntent {
  try {
    const base = record(value, 'root')
    const kind = stringValue(
      dataField(base, 'kind', 'root'),
      'root.kind',
      MAXIMUM_METADATA_UNITS,
      false
    )
    if (!Object.hasOwn(INTENT_DECODERS, kind)) {
      return fail(`kind ${JSON.stringify(kind)} is not supported`)
    }
    const decoder = INTENT_DECODERS[
      kind as EditorIntent['kind']
    ] as IntentDecoder<EditorIntent['kind']>
    return decoder(value, context)
  } catch (error) {
    if (error instanceof EditorIntentDecodeError) throw error
    throw new EditorIntentDecodeError('Editor intent is malformed', error)
  }
}
