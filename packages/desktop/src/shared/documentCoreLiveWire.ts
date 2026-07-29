import type {
  CriticMarkupProjection,
  MarkdownNodeKind,
  MarkupCoordinateMapV1,
  MarkupRenderBlock,
  MarkupRenderElement,
  MarkupRenderNode,
  MarkupRenderRun,
  MarkupRenderText,
  ModelRange,
  NodeId,
  SourceOffset,
  SourceRange
} from '@marktext/document-core'
import { decodeMarkupCoordinateMapV1 } from '@marktext/document-core'
import {
  closedRecord as decodeClosedRecord
} from './types/closedRecord'

type PrimitiveAttribute = string | number | boolean

const MARKDOWN_NODE_KINDS: readonly MarkdownNodeKind[] = Object.freeze([
  'document',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'list-item',
  'thematic-break',
  'text',
  'soft-break',
  'hard-break',
  'emphasis',
  'strong',
  'strikethrough',
  'subscript',
  'superscript',
  'link',
  'image',
  'inline-code',
  'code-block',
  'inline-html',
  'html-block',
  'autolink',
  'definition',
  'front-matter',
  'inline-math',
  'math-block',
  'diagram',
  'table',
  'table-row',
  'table-cell',
  'footnote-definition',
  'footnote-reference'
])
const MAXIMUM_LIVE_TREE_DEPTH = 512
const MAXIMUM_LIVE_TREE_NODES = 1_000_000

interface EncodedModelRange {
  readonly start: number
  readonly end: number
}

interface EncodedSourceRange {
  readonly start: number
  readonly end: number
}

interface EncodedMarkupRenderRun {
  readonly key: string
  readonly elements: readonly MarkupRenderElement[]
  readonly modelRange: EncodedModelRange
  readonly sourceRange: EncodedSourceRange
}

type EncodedTextStorage =
  | Readonly<{ readonly kind: 'model-range' }>
  | Readonly<{
    readonly kind: 'materialized'
    readonly text: string
  }>

interface EncodedMarkupRenderText extends EncodedMarkupRenderRun {
  readonly text: EncodedTextStorage
  readonly boundaryMapping: 'identity' | 'collapsed'
}

interface EncodedMarkupRenderNode {
  readonly key: string
  readonly kind: MarkdownNodeKind
  readonly attributes: Readonly<Record<string, PrimitiveAttribute>>
  readonly modelRange: EncodedModelRange
  readonly elements: readonly MarkupRenderElement[]
  readonly text: readonly EncodedMarkupRenderText[]
  readonly children: readonly EncodedMarkupRenderNode[]
}

interface EncodedMarkupRenderBlock {
  readonly kind: MarkdownNodeKind
  readonly attributes: Readonly<Record<string, PrimitiveAttribute>>
  readonly modelRange: EncodedModelRange
  readonly runs: readonly EncodedMarkupRenderRun[]
  readonly tree: EncodedMarkupRenderNode
}

interface LiveTreeTopology {
  nodeCount: number
  readonly nodeKeys: Set<string>
  readonly nodeLabels: Map<string, string>
  readonly nodesByKey: Map<string, MarkupRenderNode>
}

export interface DecodedDocumentCoreLiveDeltaV1 {
  readonly schema: 'document-core-live-plan-delta-1'
  /** Text and block topology for the active Markup/Original/Revised display. */
  readonly modelText: string
  /** Retained editable-Markup map, independent of a clean display model. */
  readonly markupCoordinateMap: MarkupCoordinateMapV1
  readonly blocks: readonly MarkupRenderBlock[]
  readonly outline: readonly Readonly<{
    readonly nodeId: NodeId
    readonly level: number
    readonly content: string
    readonly slug: string
    readonly sourceOffset: number
  }>[]
  readonly listItems: readonly ModelRange[]
}

export interface EncodedDocumentCoreLiveDeltaV1 {
  readonly schema: 'document-core-live-plan-delta-1'
  readonly modelText:
    | Readonly<{ readonly kind: 'canonical-source' }>
    | Readonly<{
      readonly kind: 'materialized'
      readonly text: string
    }>
  /** Retained editable-Markup map, independent of a clean display model. */
  readonly markupCoordinateMap: MarkupCoordinateMapV1
  readonly blocks: readonly EncodedMarkupRenderBlock[]
  readonly outline: DecodedDocumentCoreLiveDeltaV1['outline']
  readonly listItems: readonly EncodedModelRange[]
}

export interface DocumentCoreLiveDeltaProjectionContract {
  readonly projection: CriticMarkupProjection
  readonly markupModelLength: number
}

function assertProjectionContract(
  contract: DocumentCoreLiveDeltaProjectionContract
): void {
  if (
    (
      contract.projection !== 'marked' &&
      contract.projection !== 'original' &&
      contract.projection !== 'revised'
    ) ||
    !Number.isSafeInteger(contract.markupModelLength) ||
    contract.markupModelLength < 0
  ) {
    throw new TypeError('Live delta has an invalid projection contract')
  }
}

function assertCoordinateSpaces(
  source: string,
  displayModelText: string,
  markupCoordinateMap: MarkupCoordinateMapV1,
  contract: DocumentCoreLiveDeltaProjectionContract
): void {
  assertProjectionContract(contract)
  if (markupCoordinateMap.sourceLength !== source.length) {
    throw new TypeError(
      'Live delta Markup coordinate map does not name its canonical source'
    )
  }
  if (markupCoordinateMap.modelLength !== contract.markupModelLength) {
    throw new TypeError(
      'Live delta Markup coordinate map does not name the declared Markup model'
    )
  }
  if (
    contract.projection === 'marked' &&
    displayModelText.length !== contract.markupModelLength
  ) {
    throw new TypeError(
      'Marked live delta display text does not name the Markup model'
    )
  }
}

function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  return decodeClosedRecord(value, label, { required: fields })
}
function dataField(
  value: unknown,
  field: string,
  label: string
): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be a record`)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  const descriptor = Object.getOwnPropertyDescriptor(value, field)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    descriptor === undefined ||
    !descriptor.enumerable ||
    !('value' in descriptor)
  ) {
    throw new TypeError(`${label}.${field} must be an enumerable data field`)
  }
  return descriptor.value
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string`)
  }
  return value
}

function finiteInteger(
  value: unknown,
  maximum: number,
  label: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw new RangeError(`${label} is outside its coordinate space`)
  }
  return Number(value)
}

function headingLevel(value: unknown, label: string): number {
  const level = finiteInteger(value, 6, label)
  if (level < 1) {
    throw new RangeError(`${label} is outside 1..6`)
  }
  return level
}

function modelRange(
  value: unknown,
  maximum: number,
  label: string
): ModelRange {
  const record = closedRecord(value, label, ['start', 'end'])
  const start = finiteInteger(record.start, maximum, `${label}.start`)
  const end = finiteInteger(record.end, maximum, `${label}.end`)
  if (end < start) {
    throw new RangeError(`${label} ends before it starts`)
  }
  return Object.freeze({ start, end })
}

function sourceRange(
  value: unknown,
  maximum: number,
  label: string
): SourceRange {
  const range = modelRange(value, maximum, label)
  return Object.freeze({
    start: range.start as SourceOffset,
    end: range.end as SourceOffset
  })
}

function elements(
  value: unknown,
  label: string
): readonly MarkupRenderElement[] {
  if (
    !Array.isArray(value) ||
    value.some(element =>
      element !== 'ins' && element !== 'del' && element !== 'mark')
  ) {
    throw new TypeError(`${label} has invalid render elements`)
  }
  return Object.freeze([...value]) as readonly MarkupRenderElement[]
}

function attributes(
  value: unknown,
  label: string
): Readonly<Record<string, PrimitiveAttribute>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an attribute record`)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  const keys = Reflect.ownKeys(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.some(key => typeof key !== 'string')
  ) {
    throw new TypeError(`${label} must be an attribute record`)
  }
  const result: Record<string, PrimitiveAttribute> = {}
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data field`)
    }
    const attribute = descriptor.value
    if (
      typeof attribute !== 'string' &&
      typeof attribute !== 'number' &&
      typeof attribute !== 'boolean'
    ) {
      throw new TypeError(`${label}.${key} is not a primitive attribute`)
    }
    if (typeof attribute === 'number' && !Number.isFinite(attribute)) {
      throw new TypeError(`${label}.${key} must be a finite number`)
    }
    result[key] = attribute
  }
  return Object.freeze(result)
}

function nodeKind(value: unknown, label: string): MarkdownNodeKind {
  if (
    typeof value !== 'string' ||
    !MARKDOWN_NODE_KINDS.includes(value as MarkdownNodeKind)
  ) {
    throw new TypeError(`${label} is not a Markdown node kind`)
  }
  return value as MarkdownNodeKind
}

function boundaryMapping(
  value: unknown,
  label: string
): 'identity' | 'collapsed' {
  if (value !== 'identity' && value !== 'collapsed') {
    throw new TypeError(`${label} has an invalid boundary mapping`)
  }
  return value
}

function encodeRunCoordinates(
  run: Omit<MarkupRenderRun, 'text'>,
  modelText: string,
  source: string
): EncodedMarkupRenderRun {
  const range = modelRange(run.modelRange, modelText.length, 'run.modelRange')
  return Object.freeze({
    key: nonemptyString(run.key, 'run.key'),
    elements: elements(run.elements, 'run.elements'),
    modelRange: range,
    sourceRange: sourceRange(
      run.sourceRange,
      source.length,
      'run.sourceRange'
    )
  })
}

function encodeRun(
  run: MarkupRenderRun,
  modelText: string,
  source: string
): EncodedMarkupRenderRun {
  const encoded = encodeRunCoordinates(run, modelText, source)
  if (
    run.text !== modelText.slice(
      encoded.modelRange.start,
      encoded.modelRange.end
    )
  ) {
    throw new TypeError('Render run text does not match its model range')
  }
  return encoded
}

function encodeText(
  text: MarkupRenderText,
  modelText: string,
  source: string
): EncodedMarkupRenderText {
  const encoded = encodeRunCoordinates(text, modelText, source)
  const identityText =
    text.text === modelText.slice(
      encoded.modelRange.start,
      encoded.modelRange.end
    )
  return Object.freeze({
    ...encoded,
    text: identityText
      ? Object.freeze({ kind: 'model-range' as const })
      : Object.freeze({
        kind: 'materialized' as const,
        text: text.text
      }),
    boundaryMapping: boundaryMapping(
      text.boundaryMapping,
      'text.boundaryMapping'
    )
  })
}

function encodeNode(
  node: MarkupRenderNode,
  modelText: string,
  source: string
): EncodedMarkupRenderNode {
  return Object.freeze({
    key: nonemptyString(node.key, 'node.key'),
    kind: nodeKind(node.kind, 'node.kind'),
    attributes: attributes(node.attributes, 'node.attributes'),
    modelRange: modelRange(
      node.modelRange,
      modelText.length,
      'node.modelRange'
    ),
    elements: elements(node.elements, 'node.elements'),
    text: Object.freeze(
      node.text.map(text => encodeText(text, modelText, source))
    ),
    children: Object.freeze(
      node.children.map(child => encodeNode(child, modelText, source))
    )
  })
}

function encodeBlock(
  block: MarkupRenderBlock,
  modelText: string,
  source: string
): EncodedMarkupRenderBlock {
  return Object.freeze({
    kind: nodeKind(block.kind, 'block.kind'),
    attributes: attributes(block.attributes, 'block.attributes'),
    modelRange: modelRange(
      block.modelRange,
      modelText.length,
      'block.modelRange'
    ),
    runs: Object.freeze(
      block.runs.map(run => encodeRun(run, modelText, source))
    ),
    tree: encodeNode(block.tree, modelText, source)
  })
}

function decodeRun(
  value: unknown,
  modelText: string,
  source: string,
  label: string,
  semanticText = false
): MarkupRenderRun {
  const record = closedRecord(
    value,
    label,
    semanticText
      ? [
        'key',
        'elements',
        'modelRange',
        'sourceRange',
        'text',
        'boundaryMapping'
      ]
      : ['key', 'elements', 'modelRange', 'sourceRange']
  )
  const range = modelRange(
    record.modelRange,
    modelText.length,
    `${label}.modelRange`
  )
  return Object.freeze({
    key: nonemptyString(record.key, `${label}.key`),
    text: modelText.slice(range.start, range.end),
    elements: elements(record.elements, `${label}.elements`),
    modelRange: range,
    sourceRange: sourceRange(
      record.sourceRange,
      source.length,
      `${label}.sourceRange`
    )
  })
}

function decodeText(
  value: unknown,
  modelText: string,
  source: string,
  label: string
): MarkupRenderText {
  const record = closedRecord(value, label, [
    'key',
    'elements',
    'modelRange',
    'sourceRange',
    'text',
    'boundaryMapping'
  ])
  const run = decodeRun(record, modelText, source, label, true)
  const storage = record.text
  const storageKind = dataField(storage, 'kind', `${label}.text`)
  const textRecord = closedRecord(
    storage,
    `${label}.text`,
    storageKind === 'model-range' ? ['kind'] : ['kind', 'text']
  )
  let text: string
  if (textRecord.kind === 'model-range') {
    text = run.text
  } else if (
    textRecord.kind === 'materialized' &&
    typeof textRecord.text === 'string'
  ) {
    text = textRecord.text
  } else {
    throw new TypeError(`${label}.text has an invalid storage kind`)
  }
  return Object.freeze({
    ...run,
    text,
    boundaryMapping: boundaryMapping(
      record.boundaryMapping,
      `${label}.boundaryMapping`
    )
  })
}

function decodeNode(
  value: unknown,
  modelText: string,
  source: string,
  label: string,
  topology: LiveTreeTopology
): MarkupRenderNode {
  interface PendingNode {
    readonly key: string
    readonly kind: MarkdownNodeKind
    readonly attributes: Readonly<Record<string, PrimitiveAttribute>>
    readonly modelRange: ModelRange
    readonly elements: readonly MarkupRenderElement[]
    readonly text: readonly MarkupRenderText[]
    readonly children: MarkupRenderNode[]
  }
  type NodeTask =
    | Readonly<{
      readonly kind: 'enter'
      readonly value: unknown
      readonly label: string
      readonly depth: number
      readonly attach: (node: MarkupRenderNode) => void
    }>
    | Readonly<{
      readonly kind: 'finish'
      readonly pending: PendingNode
      readonly attach: (node: MarkupRenderNode) => void
    }>

  let root: MarkupRenderNode | undefined
  const tasks: NodeTask[] = [{
    kind: 'enter',
    value,
    label,
    depth: 0,
    attach: node => {
      root = node
    }
  }]
  while (tasks.length > 0) {
    const task = tasks.pop()
    if (task === undefined) break
    if (task.kind === 'finish') {
      let previousChildEnd = task.pending.modelRange.start
      for (const text of task.pending.text) {
        if (
          text.modelRange.start < task.pending.modelRange.start ||
          text.modelRange.end > task.pending.modelRange.end
        ) {
          throw new RangeError(
            'Live-plan text range is outside its parent node'
          )
        }
      }
      for (const child of task.pending.children) {
        if (
          child.modelRange.start < task.pending.modelRange.start ||
          child.modelRange.end > task.pending.modelRange.end ||
          child.modelRange.start < previousChildEnd
        ) {
          throw new RangeError(
            'Live-plan child topology is outside or unordered in its parent'
          )
        }
        previousChildEnd = child.modelRange.end
      }
      const node = Object.freeze({
        key: task.pending.key,
        kind: task.pending.kind,
        attributes: task.pending.attributes,
        modelRange: task.pending.modelRange,
        elements: task.pending.elements,
        text: task.pending.text,
        children: Object.freeze(task.pending.children)
      })
      topology.nodesByKey.set(node.key, node)
      task.attach(node)
      continue
    }
    if (task.depth > MAXIMUM_LIVE_TREE_DEPTH) {
      throw new RangeError('Live-plan tree depth exceeds its bounded limit')
    }
    topology.nodeCount += 1
    if (topology.nodeCount > MAXIMUM_LIVE_TREE_NODES) {
      throw new RangeError('Live-plan node limit exceeded')
    }
    const record = closedRecord(task.value, task.label, [
      'key',
      'kind',
      'attributes',
      'modelRange',
      'elements',
      'text',
      'children'
    ])
    if (!Array.isArray(record.text) || !Array.isArray(record.children)) {
      throw new TypeError(`${task.label} has invalid child collections`)
    }
    const key = nonemptyString(record.key, `${task.label}.key`)
    if (topology.nodeKeys.has(key)) {
      const prior = topology.nodesByKey.get(key)
      throw new TypeError(
        `Live-plan node ${task.label} duplicates identity ${key} from ` +
        `${topology.nodeLabels.get(key) ?? 'an earlier node'}` +
        (
          prior === undefined
            ? ''
            : ` (${prior.kind} ${prior.modelRange.start}:${prior.modelRange.end})`
        )
      )
    }
    topology.nodeKeys.add(key)
    topology.nodeLabels.set(key, task.label)
    const pending: PendingNode = {
      key,
      kind: nodeKind(record.kind, `${task.label}.kind`),
      attributes: attributes(record.attributes, `${task.label}.attributes`),
      modelRange: modelRange(
        record.modelRange,
        modelText.length,
        `${task.label}.modelRange`
      ),
      elements: elements(record.elements, `${task.label}.elements`),
      text: Object.freeze(record.text.map((text, index) =>
        decodeText(
          text,
          modelText,
          source,
          `${task.label}.text[${index}]`
        ))),
      children: new Array<MarkupRenderNode>(record.children.length)
    }
    tasks.push({
      kind: 'finish',
      pending,
      attach: task.attach
    })
    for (let index = record.children.length - 1; index >= 0; index -= 1) {
      tasks.push({
        kind: 'enter',
        value: record.children[index],
        label: `${task.label}.children[${index}]`,
        depth: task.depth + 1,
        attach: node => {
          pending.children[index] = node
        }
      })
    }
  }
  if (root === undefined) {
    throw new TypeError(`${label} has no root node`)
  }
  return root
}

function decodeBlock(
  value: unknown,
  modelText: string,
  source: string,
  label: string,
  topology: LiveTreeTopology
): MarkupRenderBlock {
  const record = closedRecord(value, label, [
    'kind',
    'attributes',
    'modelRange',
    'runs',
    'tree'
  ])
  if (!Array.isArray(record.runs)) {
    throw new TypeError(`${label}.runs must be an array`)
  }
  const kind = nodeKind(record.kind, `${label}.kind`)
  const range = modelRange(
    record.modelRange,
    modelText.length,
    `${label}.modelRange`
  )
  const runs = Object.freeze(record.runs.map((run, index) =>
    decodeRun(run, modelText, source, `${label}.runs[${index}]`)))
  let previousRunEnd = range.start
  for (const run of runs) {
    if (
      run.modelRange.start < range.start ||
      run.modelRange.end > range.end ||
      run.modelRange.start < previousRunEnd
    ) {
      throw new RangeError('Live-plan block runs are outside or unordered')
    }
    previousRunEnd = run.modelRange.end
  }
  const tree = decodeNode(
    record.tree,
    modelText,
    source,
    `${label}.tree`,
    topology
  )
  if (
    tree.kind !== kind ||
    tree.modelRange.start !== range.start ||
    tree.modelRange.end !== range.end
  ) {
    throw new TypeError('Live-plan block and tree identities do not agree')
  }
  return Object.freeze({
    kind,
    attributes: attributes(record.attributes, `${label}.attributes`),
    modelRange: range,
    runs,
    tree
  })
}

export function encodeDocumentCoreLiveDeltaV1(
  source: string,
  value: DecodedDocumentCoreLiveDeltaV1,
  contract: DocumentCoreLiveDeltaProjectionContract
): EncodedDocumentCoreLiveDeltaV1 {
  if (value.schema !== 'document-core-live-plan-delta-1') {
    throw new TypeError('Live delta has an invalid schema')
  }
  const markupCoordinateMap =
    decodeMarkupCoordinateMapV1(value.markupCoordinateMap)
  assertCoordinateSpaces(
    source,
    value.modelText,
    markupCoordinateMap,
    contract
  )
  const blocks = Object.freeze(
    value.blocks.map(block => encodeBlock(block, value.modelText, source))
  )
  return Object.freeze({
    schema: 'document-core-live-plan-delta-1' as const,
    modelText: value.modelText === source
      ? Object.freeze({ kind: 'canonical-source' as const })
      : Object.freeze({
        kind: 'materialized' as const,
        text: value.modelText
      }),
    markupCoordinateMap,
    blocks,
    outline: Object.freeze(value.outline.map((item, index) => Object.freeze({
      nodeId: nonemptyString(item.nodeId, `outline[${index}].nodeId`) as NodeId,
      level: headingLevel(
        item.level,
        `outline[${index}].heading level`
      ),
      content: item.content,
      slug: item.slug,
      sourceOffset: finiteInteger(
        item.sourceOffset,
        source.length,
        `outline[${index}].sourceOffset`
      )
    }))),
    listItems: Object.freeze(value.listItems.map(range =>
      modelRange(range, value.modelText.length, 'listItem')))
  })
}

export function decodeDocumentCoreLiveDeltaV1(
  source: string,
  value: unknown,
  contract: DocumentCoreLiveDeltaProjectionContract
): DecodedDocumentCoreLiveDeltaV1 {
  const record = closedRecord(value, 'Live delta', [
    'schema',
    'modelText',
    'markupCoordinateMap',
    'blocks',
    'outline',
    'listItems'
  ])
  if (
    record.schema !== 'document-core-live-plan-delta-1' ||
    !Array.isArray(record.blocks) ||
    !Array.isArray(record.outline) ||
    !Array.isArray(record.listItems) ||
    record.modelText === null ||
    typeof record.modelText !== 'object'
  ) {
    throw new TypeError('Live delta has an invalid shape')
  }
  const modelStorageKind = dataField(
    record.modelText,
    'kind',
    'Live delta.modelText'
  )
  const modelStorage = closedRecord(
    record.modelText,
    'Live delta.modelText',
    modelStorageKind === 'canonical-source'
      ? ['kind']
      : ['kind', 'text']
  )
  const modelText = modelStorage.kind === 'canonical-source'
    ? source
    : modelStorage.kind === 'materialized' &&
        typeof modelStorage.text === 'string'
      ? modelStorage.text
      : null
  if (modelText === null) {
    throw new TypeError('Live delta has invalid model text storage')
  }
  const markupCoordinateMap =
    decodeMarkupCoordinateMapV1(record.markupCoordinateMap)
  assertCoordinateSpaces(
    source,
    modelText,
    markupCoordinateMap,
    contract
  )
  const topology: LiveTreeTopology = {
    nodeCount: 0,
    nodeKeys: new Set(),
    nodeLabels: new Map(),
    nodesByKey: new Map()
  }
  const blocks = Object.freeze(record.blocks.map((block, index) =>
    decodeBlock(
      block,
      modelText,
      source,
      `blocks[${index}]`,
      topology
    )))
  let previousBlockEnd = 0
  for (const block of blocks) {
    if (block.modelRange.start < previousBlockEnd) {
      throw new RangeError('Live-plan blocks are not in document order')
    }
    previousBlockEnd = block.modelRange.end
  }
  const outline = Object.freeze(record.outline.map((item, index) => {
    const outlineItem = closedRecord(item, `outline[${index}]`, [
      'nodeId',
      'level',
      'content',
      'slug',
      'sourceOffset'
    ])
    const nodeId = nonemptyString(
      outlineItem.nodeId,
      `outline[${index}].nodeId`
    ) as NodeId
    const level = headingLevel(
      outlineItem.level,
      `outline[${index}].heading level`
    )
    const heading = topology.nodesByKey.get(nodeId)
    if (heading?.kind !== 'heading') {
      throw new TypeError('Live-plan outline does not reference a heading node')
    }
    return Object.freeze({
      nodeId,
      level,
      content: typeof outlineItem.content === 'string'
        ? outlineItem.content
        : (() => {
          throw new TypeError(`outline[${index}].content must be text`)
        })(),
      slug: typeof outlineItem.slug === 'string'
        ? outlineItem.slug
        : (() => {
          throw new TypeError(`outline[${index}].slug must be text`)
        })(),
      sourceOffset: finiteInteger(
        outlineItem.sourceOffset,
        source.length,
        `outline[${index}].sourceOffset`
      )
    })
  }))
  const listItems = Object.freeze(record.listItems.map((range, index) =>
    modelRange(range, modelText.length, `listItems[${index}]`)))
  const listItemRanges = new Set(
    [...topology.nodesByKey.values()]
      .filter(node => node.kind === 'list-item')
      .map(node => `${node.modelRange.start}:${node.modelRange.end}`)
  )
  if (
    listItems.some(range =>
      !listItemRanges.has(`${range.start}:${range.end}`))
  ) {
    throw new TypeError(
      'Live-plan list-item index does not reference a list-item node'
    )
  }
  return Object.freeze({
    schema: 'document-core-live-plan-delta-1' as const,
    modelText,
    markupCoordinateMap,
    blocks,
    outline,
    listItems
  })
}
