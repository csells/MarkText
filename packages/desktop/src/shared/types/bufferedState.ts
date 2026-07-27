export interface BufferedDocumentTab {
  readonly documentId: string
  readonly scrollTop: number
}

export interface BufferedProjectState {
  readonly rootDirectory: string
}

export interface BufferedLayoutState {
  readonly rightColumn: string
  readonly showSideBar: boolean
  readonly showTabBar: boolean
  readonly sideBarWidth: number
}

/**
 * Renderer-authored window presentation intent.
 *
 * Document ids are references to already admitted main-owned tabs. Main
 * validates that they are an exact permutation of its retained tab registry
 * before constructing a durable checkpoint. Project identity is deliberately
 * absent.
 */
export interface WindowUiCheckpointIntent {
  readonly schema: 'document-core-window-ui-intent-1'
  readonly currentDocumentId: string | null
  readonly tabs: readonly BufferedDocumentTab[]
  readonly layout: BufferedLayoutState
}

/**
 * Main-authored durable window checkpoint and renderer restore envelope.
 *
 * Document source, history, file policy, parser configuration, durability
 * identity, and persistence state are deliberately absent. Main resolves each
 * opaque document id through its durable file/session registry.
 */
export interface BufferedState {
  readonly schema: 'document-core-window-ui-1'
  readonly currentDocumentId: string | null
  readonly tabs: readonly BufferedDocumentTab[]
  readonly project: BufferedProjectState
  readonly layout: BufferedLayoutState
}

function closedRecord(
  value: unknown,
  label: string,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a closed record`)
  }
  const actual = Reflect.ownKeys(value)
  if (
    actual.some(key => typeof key !== 'string') ||
    actual.length !== keys.length ||
    actual.some(key => !keys.includes(key as string))
  ) {
    throw new TypeError(`${label} fields are not closed`)
  }
  return value as Readonly<Record<string, unknown>>
}

function boundedString(
  value: unknown,
  label: string,
  allowEmpty: boolean
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > 32_768 ||
    [...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return (
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      )
    })
  ) {
    throw new TypeError(`${label} must be a bounded printable string`)
  }
  return value
}

function boundedNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a bounded finite number`)
  }
  return value
}

interface DecodedDocumentReferences {
  readonly currentDocumentId: string | null
  readonly tabs: readonly BufferedDocumentTab[]
}

function decodeDocumentReferences(
  record: Readonly<Record<string, unknown>>,
  label: string
): Readonly<DecodedDocumentReferences> {
  if (
    !Array.isArray(record.tabs) ||
    record.tabs.length > 1_000
  ) {
    throw new TypeError(`Invalid ${label}`)
  }
  const seen = new Set<string>()
  const tabs = record.tabs.map((rawTab, index) => {
    const tab = closedRecord(rawTab, `${label} tab ${String(index)}`, [
      'documentId',
      'scrollTop'
    ])
    const documentId = boundedString(
      tab.documentId,
      `${label} tab ${String(index)}.documentId`,
      false
    )
    if (seen.has(documentId)) {
      throw new TypeError(`Duplicate ${label} document id ${documentId}`)
    }
    seen.add(documentId)
    return Object.freeze({
      documentId,
      scrollTop: boundedNumber(
        tab.scrollTop,
        `${label} tab ${String(index)}.scrollTop`,
        0,
        1_000_000_000
      )
    })
  })
  const currentDocumentId = record.currentDocumentId === null
    ? null
    : boundedString(
      record.currentDocumentId,
      `${label}.currentDocumentId`,
      false
    )
  if (
    currentDocumentId !== null &&
    !seen.has(currentDocumentId)
  ) {
    throw new TypeError(`Current ${label} document is not an open tab`)
  }
  return Object.freeze({
    currentDocumentId,
    tabs: Object.freeze(tabs)
  })
}

function decodeLayout(
  value: unknown,
  label: string
): BufferedLayoutState {
  const layout = closedRecord(value, label, [
    'rightColumn',
    'showSideBar',
    'showTabBar',
    'sideBarWidth'
  ])
  if (
    typeof layout.showSideBar !== 'boolean' ||
    typeof layout.showTabBar !== 'boolean'
  ) {
    throw new TypeError(`Invalid ${label}`)
  }
  return Object.freeze({
    rightColumn: boundedString(
      layout.rightColumn,
      `${label}.rightColumn`,
      true
    ),
    showSideBar: layout.showSideBar,
    showTabBar: layout.showTabBar,
    sideBarWidth: boundedNumber(
      layout.sideBarWidth,
      `${label}.sideBarWidth`,
      220,
      10_000
    )
  })
}

export function decodeWindowUiCheckpointIntent(
  value: unknown
): WindowUiCheckpointIntent {
  const record = closedRecord(value, 'window UI checkpoint intent', [
    'schema',
    'currentDocumentId',
    'tabs',
    'layout'
  ])
  if (record.schema !== 'document-core-window-ui-intent-1') {
    throw new TypeError('Invalid window UI checkpoint intent')
  }
  const references = decodeDocumentReferences(
    record,
    'window UI checkpoint intent'
  )
  return Object.freeze({
    schema: record.schema,
    ...references,
    layout: decodeLayout(
      record.layout,
      'window UI checkpoint intent layout'
    )
  })
}

export function decodeBufferedState(value: unknown): BufferedState {
  const record = closedRecord(value, 'window UI state', [
    'schema',
    'currentDocumentId',
    'tabs',
    'project',
    'layout'
  ])
  if (record.schema !== 'document-core-window-ui-1') {
    throw new TypeError('Invalid window UI state')
  }
  const references = decodeDocumentReferences(record, 'window UI state')
  const project = closedRecord(record.project, 'window UI project', [
    'rootDirectory'
  ])
  return Object.freeze({
    schema: record.schema,
    ...references,
    project: Object.freeze({
      rootDirectory: boundedString(
        project.rootDirectory,
        'window UI project.rootDirectory',
        true
      )
    }),
    layout: decodeLayout(record.layout, 'window UI layout')
  })
}
