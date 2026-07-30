import type {
  ICriticMarkupCommandTarget,
  ICriticMarkupReviewItem,
  ICriticMarkupReviewSnapshot,
  ICriticMarkupTrackChangeRejection,
  DocumentCoreTableShape,
  DocumentSelectionContext,
  DocumentViewOptions,
  DocumentCoreViewSnapshot,
  ILocale,
  TCriticMarkupAuthorInput,
  TCriticMarkupDecision,
  TCriticMarkupNavigationDirection
} from '@marktext/document-view'
import {
  createDocumentCoreView,
  en,
  reportAsyncFailure
} from '@marktext/document-view'
import type {
  BlockConversion,
  DocumentSearchQuery,
  DocumentFacts,
  InlineFormat,
  NodeId,
  ParseConfiguration,
  ReviewIndexItem
} from '@marktext/document-core'
import { createDocumentSearchQuery } from '@marktext/document-core'
import type {
  ImageAssetSource,
  ImageAssetStorage
} from '@shared/types/imageAsset'
import { decodeCriticMarkupCommandTarget } from '@shared/types/criticMarkup'
import bus from '@/bus'
import type {
  DocumentCoreRemoteSession
} from './documentCoreRemoteSession'

interface DocumentCoreDesktopTocItem {
  readonly nodeId: NodeId
  readonly lvl: number
  readonly content: string
  readonly slug: string
  readonly sourceOffset: number
}

interface IndexPosition {
  readonly line: number
  readonly ch: number
}

interface IndexCursor {
  readonly anchor: IndexPosition
  readonly focus: IndexPosition
}

interface SearchMatch {
  readonly start: number
  readonly end: number
  readonly match: string
}

interface SearchResult {
  readonly index: number
  readonly matches: readonly SearchMatch[]
  readonly value: string
}

function sameSearchQuery(
  left: DocumentSearchQuery,
  right: DocumentSearchQuery
): boolean {
  return (
    left.schema === right.schema &&
    left.text === right.text &&
    left.syntax === right.syntax &&
    left.caseSensitive === right.caseSensitive &&
    left.wholeWord === right.wholeWord
  )
}

export interface DocumentHostOptions {
  readonly element: HTMLElement
  readonly session: DocumentCoreRemoteSession
  readonly configuration: DocumentHostConfiguration
  readonly requestTableShape?: (
    signal: AbortSignal
  ) => Promise<DocumentCoreTableShape | null>
}

export interface DocumentHostSnapshot {
  readonly revisionId: string
  readonly source: string
  readonly sourceSelection: Readonly<{
    readonly anchor: number
    readonly focus: number
  }>
  readonly facts: DocumentFacts
  readonly blocks: DocumentCoreViewSnapshot extends infer Snapshot
    ? Snapshot extends { readonly kind: 'complete'; readonly blocks: infer Blocks }
      ? Blocks
      : never
    : never
}

export interface DocumentHostConfiguration extends DocumentViewOptions {
  readonly criticMarkupTrackChanges?: boolean
  readonly criticMarkupProjection?: 'marked' | 'original' | 'revised'
}

export type DocumentHostInteraction =
  | Readonly<{
    readonly kind: 'copy-heading-link'
    readonly targetNodeId: NodeId
  }>
  | Readonly<{
    readonly kind: 'navigate-link'
    readonly targetNodeId: NodeId
  }>
  | Readonly<{
    readonly kind: 'preview-image'
    readonly src: string
    readonly trigger: 'modifier-click' | 'keyboard'
  }>

type DisposableSubscription = Readonly<{ dispose: () => void }>

/**
 * The one target-owned document host used by Desktop.
 *
 * Document content, selection, history and rendering all remain inside the
  * document-core view. Every document-changing shell command crosses the typed
  * intent seam; static clipboard output crosses the main-owned materializer.
 */
export interface DocumentEditorHost {
  readonly domNode: HTMLElement
  readonly getMarkdown: () => string
  readonly getMarkdownSync: () => string
  readonly getProjection: () => 'marked' | 'original' | 'revised'
  readonly attachDocument: (documentId: string) => Promise<void>
  readonly editSource: (
    start: number,
    end: number,
    text: string,
    selection: Readonly<{ anchor: number; focus: number }>
  ) => Promise<void>
  readonly insertSourceImage: (image: Readonly<{
    src: string
    alt?: string
    title?: string
  }>) => Promise<void>
  readonly insertImageAsset: (image: Readonly<{
    documentId: string
    source: ImageAssetSource
    storage: ImageAssetStorage
    surface: 'markup' | 'source'
    alt?: string
    title?: string
  }>) => Promise<void>
  readonly copySource: (
    selection: Readonly<{ start: number; end: number }>
  ) => Promise<void>
  readonly cutSource: (
    selection: Readonly<{ start: number; end: number }>
  ) => Promise<void>
  readonly pasteSourceClipboard: (
    selection: Readonly<{ anchor: number; focus: number }>
  ) => Promise<void>
  readonly subscribeDocumentChange: (
    listener: () => void
  ) => DisposableSubscription
  readonly subscribeSelection: (
    listener: (context: DocumentSelectionContext) => void
  ) => DisposableSubscription
  readonly subscribeReview: (
    listener: (snapshot: ICriticMarkupReviewSnapshot) => void
  ) => DisposableSubscription
  readonly subscribeInteraction: (
    listener: (interaction: DocumentHostInteraction) => void
  ) => DisposableSubscription
  readonly subscribeTrackChangeRejection: (
    listener: (rejection: ICriticMarkupTrackChangeRejection) => void
  ) => DisposableSubscription
  readonly snapshot: () => DocumentHostSnapshot
  readonly selection: () => DocumentSelectionContext | null
  readonly settled: () => Promise<void>
  readonly flush: () => Promise<void>
  readonly destroy: () => Promise<void>
  readonly selectAll: () => void
  readonly setSelection: (start: number, end: number) => void
  readonly selectSource: (
    selection: Readonly<{ anchor: number; focus: number }>
  ) => Promise<void>
  readonly getTOC: () => DocumentCoreDesktopTocItem[]
  readonly resolveHeadingElement: (nodeId: string) => HTMLElement | null
  readonly configure: (options: DocumentHostConfiguration) => Promise<void>
  readonly setFocusMode: (enabled: boolean) => void
  readonly dismissTransientTools: () => void
  readonly openImageSelector: () => Promise<void>
  readonly hasFocus: () => boolean
  readonly focus: () => void
  readonly blur: () => void
  readonly undo: () => Promise<void>
  readonly redo: () => Promise<void>
  readonly getCursorOffset: () => IndexCursor
  readonly setCursorByOffset: (cursor: IndexCursor | number) => void
  readonly search: (query: DocumentSearchQuery) => SearchResult
  /**
   * Select the active search match in the editor and focus it — the Escape
   * teardown's handoff of the caret back to the document. Returns false when
   * no search is active.
   */
  readonly selectActiveSearchMatch: () => boolean
  readonly find: (direction: 'previous' | 'next') => SearchResult
  readonly replace: (
    replacement: string,
    options: Readonly<{
      isSingle: boolean
      query: DocumentSearchQuery
    }>
  ) => Promise<SearchResult>
  readonly replaceCurrentWord: (replacement: string) => Promise<void>
  readonly pasteAsPlainText: () => Promise<void>
  readonly insertImage: (
    image: string | Readonly<{ src: string; alt?: string; title?: string }>
  ) => Promise<void>
  readonly setCodeLanguage: (language: string) => Promise<void>
  readonly insertLink: (
    link: Readonly<{ href: string; title?: string }>
  ) => Promise<void>
  readonly insertFootnote: (
    footnote: Readonly<{ label: string; content: string }>
  ) => Promise<void>
  readonly setListIndentation: (
    direction: 'increase' | 'decrease'
  ) => Promise<void>
  readonly insertParagraph: (location?: 'before' | 'after') => Promise<void>
  readonly convertBlock: (conversion: BlockConversion) => Promise<void>
  readonly duplicateBlock: () => Promise<void>
  readonly deleteBlock: () => Promise<void>
  readonly formatText: (format: InlineFormat) => Promise<void>
  readonly requestTable: () => Promise<void>
  readonly insertTableRow: (location?: 'before' | 'after') => Promise<void>
  readonly copyAsMarkdown: () => Promise<void>
  readonly copyAsHtml: () => Promise<void>
  readonly copyAsRich: () => Promise<void>
  readonly setLocale: (locale: ILocale) => void
  readonly commitAuthoringSelection: () => Promise<void>
  readonly getCriticMarkupReviewSnapshot: () => ICriticMarkupReviewSnapshot
  readonly getCriticMarkupCommentAtPoint: (
    clientX: number,
    clientY: number
  ) => ICriticMarkupReviewItem | null
  readonly createCriticMarkup: (
    input: TCriticMarkupAuthorInput
  ) => Promise<boolean>
  readonly focusCriticMarkup: (
    target: ICriticMarkupCommandTarget
  ) => ICriticMarkupReviewItem | null
  readonly navigateCriticMarkup: (
    direction: TCriticMarkupNavigationDirection
  ) => ICriticMarkupReviewItem | null
  readonly resolveCriticMarkup: (
    decision: TCriticMarkupDecision,
    target: ICriticMarkupCommandTarget
  ) => Promise<boolean>
  readonly resolveAllCriticMarkup: (
    decision: TCriticMarkupDecision
  ) => Promise<number>
  readonly editCriticMarkupComment: (
    target: ICriticMarkupCommandTarget,
    text: string
  ) => Promise<boolean>
}

const DOCUMENT_HOST_OPTION_KEYS: ReadonlySet<keyof DocumentHostConfiguration> =
  new Set([
    'fontSize',
    'lineHeight',
    'editorFontFamily',
    'codeFontSize',
    'codeFontFamily',
    'editorLineWidth',
    'wrapCodeBlocks',
    'footnotes',
    'gitLabMath',
    'subscriptAndSuperscript',
    'spellcheck',
    'hideSpellcheckMarks',
    'autoPairBrackets',
    'autoPairQuotes',
    'autoPairMarkdown',
    'autoCheckTasks',
    'hideQuickInsertHint',
    'hideLinkTools',
    'criticMarkupTrackChanges',
    'criticMarkupProjection'
  ])

export interface DocumentGrammarConfiguration {
  readonly gitLabMath: boolean
  readonly footnotes: boolean
  readonly subscriptAndSuperscript: boolean
}

function assertDocumentHostConfiguration(
  configuration: DocumentHostConfiguration
): void {
  for (const key of Object.keys(configuration)) {
    if (!DOCUMENT_HOST_OPTION_KEYS.has(
      key as keyof DocumentHostConfiguration
    )) {
      throw new TypeError(`Unknown document option: ${key}`)
    }
  }
  if (
    configuration.criticMarkupTrackChanges !== undefined &&
    typeof configuration.criticMarkupTrackChanges !== 'boolean'
  ) {
    throw new TypeError(
      'Invalid document option value for criticMarkupTrackChanges'
    )
  }
  if (
    configuration.criticMarkupProjection !== undefined &&
    configuration.criticMarkupProjection !== 'marked' &&
    configuration.criticMarkupProjection !== 'original' &&
    configuration.criticMarkupProjection !== 'revised'
  ) {
    throw new TypeError(
      'Invalid document option value for criticMarkupProjection'
    )
  }
}

function viewOptionsFromHost(
  next: DocumentHostConfiguration
): DocumentViewOptions {
  return {
    ...(next.fontSize === undefined ? {} : { fontSize: next.fontSize }),
    ...(next.lineHeight === undefined ? {} : { lineHeight: next.lineHeight }),
    ...(next.editorFontFamily === undefined
      ? {}
      : { editorFontFamily: next.editorFontFamily }),
    ...(next.codeFontSize === undefined
      ? {}
      : { codeFontSize: next.codeFontSize }),
    ...(next.codeFontFamily === undefined
      ? {}
      : { codeFontFamily: next.codeFontFamily }),
    ...(next.editorLineWidth === undefined
      ? {}
      : { editorLineWidth: next.editorLineWidth }),
    ...(next.wrapCodeBlocks === undefined
      ? {}
      : { wrapCodeBlocks: next.wrapCodeBlocks }),
    ...(next.footnotes === undefined ? {} : { footnotes: next.footnotes }),
    ...(next.gitLabMath === undefined ? {} : { gitLabMath: next.gitLabMath }),
    ...(next.subscriptAndSuperscript === undefined
      ? {}
      : { subscriptAndSuperscript: next.subscriptAndSuperscript }),
    ...(next.spellcheck === undefined ? {} : { spellcheck: next.spellcheck }),
    ...(next.hideSpellcheckMarks === undefined
      ? {}
      : { hideSpellcheckMarks: next.hideSpellcheckMarks }),
    ...(next.autoPairBrackets === undefined
      ? {}
      : { autoPairBrackets: next.autoPairBrackets }),
    ...(next.autoPairQuotes === undefined
      ? {}
      : { autoPairQuotes: next.autoPairQuotes }),
    ...(next.autoPairMarkdown === undefined
      ? {}
      : { autoPairMarkdown: next.autoPairMarkdown }),
    ...(next.autoCheckTasks === undefined
      ? {}
      : { autoCheckTasks: next.autoCheckTasks }),
    ...(next.hideQuickInsertHint === undefined
      ? {}
      : { hideQuickInsertHint: next.hideQuickInsertHint }),
    ...(next.hideLinkTools === undefined
      ? {}
      : { hideLinkTools: next.hideLinkTools })
  }
}

function offsetFromPosition(source: string, position: IndexPosition): number {
  if (
    !Number.isInteger(position.line) ||
    position.line < 0 ||
    !Number.isInteger(position.ch) ||
    position.ch < 0
  ) {
    throw new RangeError('A source cursor requires non-negative line and ch values')
  }
  let offset = 0
  for (let line = 0; line < position.line; line += 1) {
    const next = source.indexOf('\n', offset)
    if (next === -1) return source.length
    offset = next + 1
  }
  const lineEnd = source.indexOf('\n', offset)
  return Math.min(offset + position.ch, lineEnd === -1 ? source.length : lineEnd)
}

function positionFromOffset(source: string, rawOffset: number): IndexPosition {
  const offset = Math.max(0, Math.min(source.length, rawOffset))
  const before = source.slice(0, offset)
  const lastLf = before.lastIndexOf('\n')
  return {
    line: before.split('\n').length - 1,
    ch: offset - (lastLf + 1)
  }
}

export async function createDocumentEditorHost(
  options: DocumentHostOptions
): Promise<DocumentEditorHost> {
  assertDocumentHostConfiguration(options.configuration)
  const clipboardWrite = options.session.writeClipboardMaterialization
  const clipboardRevisionId = (): string =>
    options.session.snapshot().revisionId
  const clipboardPaste = options.session.pasteClipboard
  const view = await createDocumentCoreView({
    host: options.element,
    session: options.session,
    clipboardPaste,
    // A refused browser input surfaces when it is refused: this host settles
    // the view only at flush and save boundaries, so without this report a
    // dropped keystroke would be invisible until much later, if ever.
    onBrowserInputFailure: (error: unknown) => {
      reportAsyncFailure(error, 'Document browser input')
    },
    ...(options.requestTableShape === undefined
      ? {}
      : { requestTableShape: options.requestTableShape }),
    resolveImageSource: options.session.resolveImageSource,
    clipboardWrite: request => {
      return clipboardWrite({
        revisionId: clipboardRevisionId(),
        ...request
      })
    }
  })
  view.setOptions(viewOptionsFromHost(options.configuration))
  await view.settled()
  if (
    options.configuration.criticMarkupTrackChanges !== undefined &&
    options.configuration.criticMarkupTrackChanges !== view.getTrackChanges()
  ) {
    await view.dispatchIntent({
      kind: 'set-track-changes',
      enabled: options.configuration.criticMarkupTrackChanges
    })
  }
  if (
    options.configuration.criticMarkupProjection !== undefined &&
    options.configuration.criticMarkupProjection !== view.getProjection()
  ) {
    await view.setProjection(options.configuration.criticMarkupProjection)
  }
  const documentChangeListeners = new Set<() => void>()
  const selectionListeners = new Set<
    (context: DocumentSelectionContext) => void
  >()
  const reviewListeners = new Set<
    (snapshot: ICriticMarkupReviewSnapshot) => void
  >()
  const interactionListeners = new Set<
    (interaction: DocumentHostInteraction) => void
  >()
  const trackChangeRejectionListeners = new Set<
    (rejection: ICriticMarkupTrackChangeRejection) => void
  >()
  let destroyed = false
  let destroyPromise: Promise<void> | null = null
  let pending: Promise<void> = Promise.resolve()
  let searchQuery = createDocumentSearchQuery('')
  let searchMatches: readonly SearchMatch[] = Object.freeze([])
  let searchIndex = -1
  let currentReviewTarget: ICriticMarkupCommandTarget | null = null
  let lastNotifiedSource = view.getMarkdownSync()
  let reviewTool: HTMLElement | null = null
  let reviewToolLabel = en.resource.Review
  const removeReviewTool = (): void => {
    reviewTool?.remove()
    reviewTool = null
  }

  const reviewNodeById = (): ReadonlyMap<string, ReviewIndexItem> =>
    new Map(view.getReviewIndex().items.map((item) => [item.nodeId, item]))

  const pairedCommentByHighlight = (): ReadonlyMap<string, string> =>
    new Map(view.getReviewIndex().commentedSpans.map((span) => [
      span.highlight,
      span.comment
    ]))

  const pairedHighlightByComment = (): ReadonlyMap<string, string> =>
    new Map(view.getReviewIndex().commentedSpans.map((span) => [
      span.comment,
      span.highlight
    ]))

  // A Review card names an annotation, so its text is parser-owned: the
  // engine publishes the exact payload extent between the markers, and the
  // card slices canonical source with it. A comment card's display `content`
  // stays the revised render, but the raw payload rides along because that
  // render is lossy — prefilling an editor with it silently resolved any
  // CriticMarkup nested in the payload (G30).
  const payloadText = (source: string, item: ReviewIndexItem): string =>
    source.slice(item.payloadRange.start, item.payloadRange.end)

  const reviewItemFor = (
    item: ReviewIndexItem,
    nodes: ReadonlyMap<string, ReviewIndexItem>
  ): ICriticMarkupReviewItem => {
    const source = view.getMarkdownSync()
    const range = item.modelRange
    const payloadSource = payloadText(source, item)
    const content = item.kind === 'comment'
      ? item.commentRevisedText ?? ''
      : payloadSource
    const review: ICriticMarkupReviewItem = {
      id: item.nodeId,
      type: item.kind,
      path: Object.freeze([item.nodeId]),
      start: range?.start ?? 0,
      end: range?.end ?? 0,
      sourceStart: item.sourceRange.start,
      sourceEnd: item.sourceRange.end,
      raw: source.slice(item.sourceRange.start, item.sourceRange.end),
      payloadSource,
      ...(item.kind === 'substitution'
        ? {
          oldContent: item.oldContent ?? '',
          newContent: item.newContent ?? ''
        }
        : { content })
    }
    const highlightId = pairedHighlightByComment().get(item.nodeId)
    const highlight = highlightId === undefined
      ? undefined
      : nodes.get(highlightId)
    if (highlight !== undefined && highlight.modelRange !== null) {
      return Object.freeze({
        ...review,
        anchorId: highlight.nodeId,
        anchorText: payloadText(source, highlight)
      })
    }
    return Object.freeze(review)
  }

  const reviewItems = (): readonly ICriticMarkupReviewItem[] => {
    const nodes = reviewNodeById()
    const hiddenAnchors = pairedCommentByHighlight()
    return Object.freeze(
      [...nodes.values()]
        .filter((item) => !hiddenAnchors.has(item.nodeId))
        .map((item) => reviewItemFor(item, nodes))
    )
  }

  const itemAtSelection = (
    items: readonly ICriticMarkupReviewItem[]
  ): ICriticMarkupReviewItem | null => {
    if (
      currentReviewTarget !== null &&
      currentReviewTarget.revisionId === view.snapshot().revisionId
    ) {
      const explicit = items.find(
        item => item.id === currentReviewTarget?.nodeId
      )
      if (explicit !== undefined) return explicit
    }
    currentReviewTarget = null
    const selection = view.getSelection()
    const effectiveRange = (
      item: ICriticMarkupReviewItem
    ): Readonly<{ start: number; end: number }> | null => {
      if (item.anchorId !== undefined) {
        return view.getReviewIndex().commentedSpans.find(
          span => span.comment === item.id
        )?.modelRange ?? null
      }
      const indexed = view.getReviewIndex().items.find(
        candidate => candidate.nodeId === item.id
      )
      return indexed?.modelRange ?? null
    }
    return [...items]
      .filter((item) => {
        const range = effectiveRange(item)
        return range !== null &&
          selection.start >= range.start &&
          selection.end <= range.end
      })
      .sort((left, right) => {
        const leftRange = effectiveRange(left)
        const rightRange = effectiveRange(right)
        if (leftRange === null || rightRange === null) return 0
        return (leftRange.end - leftRange.start) -
          (rightRange.end - rightRange.start)
      })[0] ?? null
  }

  const reviewSnapshot = (): ICriticMarkupReviewSnapshot => {
    const items = reviewItems()
    const current = itemAtSelection(items)
    const authoring = view.getReviewIndex().authoring
    const changeCount = items.filter((item) =>
      item.type === 'addition' ||
      item.type === 'deletion' ||
      item.type === 'substitution'
    ).length
    return Object.freeze({
      revisionId: view.snapshot().revisionId,
      items,
      currentItemId: current?.id ?? null,
      ...authoring,
      canNavigate: items.length > 0,
      canResolveCurrent: current !== null,
      canResolveAll: changeCount > 0,
      trackChanges: view.getTrackChanges(),
      projection: view.getProjection()
    })
  }

  const publishDocumentChange = (): void => {
    for (const listener of documentChangeListeners) listener()
  }

  const publishSelection = (context: DocumentSelectionContext): void => {
    for (const listener of selectionListeners) listener(context)
  }

  const publishReview = (): void => {
    const snapshot = reviewSnapshot()
    for (const listener of reviewListeners) listener(snapshot)
  }

  const publishInteraction = (
    interaction: DocumentHostInteraction
  ): void => {
    for (const listener of interactionListeners) listener(interaction)
  }

  const publishTrackChangeRejection = (
    rejection: ICriticMarkupTrackChangeRejection
  ): void => {
    for (const listener of trackChangeRejectionListeners) listener(rejection)
  }

  const enqueue = <Result>(
    operation: () => Promise<Result>
  ): Promise<Result> => {
    const result = pending.then(async() => {
      if (destroyed) throw new Error('The document-core editor is destroyed')
      return operation()
    })
    pending = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const viewChange = view.onChange(() => {
    const source = view.getMarkdownSync()
    if (source !== lastNotifiedSource) {
      lastNotifiedSource = source
      publishDocumentChange()
    }
    publishReview()
    // A SourceOnly revision mounts no semantic tree, so there is no selection
    // context to publish; asking for one throws on the notification path.
    if (view.snapshot().kind === 'complete') {
      publishSelection(view.getSelectionContext())
    }
  })
  const viewInteraction = view.subscribeInteraction((interaction) => {
    publishInteraction(interaction)
  })
  const viewSelection = view.subscribeSelection((context) => {
    publishSelection(context)
  })
  const viewTrackChangeRejection =
    view.subscribeTrackChangeRejection(publishTrackChangeRejection)

  const search = (query: DocumentSearchQuery): SearchResult => {
    searchQuery = query
    searchMatches = Object.freeze(view.search(query).map(match => Object.freeze({
      ...match,
      match: view.modelText().slice(match.start, match.end)
    })))
    searchIndex = searchMatches.length === 0 ? -1 : 0
    view.setSearchDecorations(searchMatches, searchIndex)
    return Object.freeze({
      index: searchIndex,
      matches: searchMatches,
      value: searchQuery.text
    })
  }

  const currentSearch = (): SearchResult => Object.freeze({
    index: searchIndex,
    matches: searchMatches,
    value: searchQuery.text
  })

  const settled = async(): Promise<void> => {
    await pending
    await view.settled()
  }

  interface ResolvedReviewTarget {
    readonly item: ICriticMarkupReviewItem
    readonly node: ReviewIndexItem
  }

  const reviewItemByNodeId = (
    nodeId: string
  ): ResolvedReviewTarget | null => {
    const item = reviewSnapshot().items.find(
      candidate => candidate.id === nodeId
    )
    const node = view.getReviewIndex().items.find(
      candidate => candidate.nodeId === nodeId
    )
    return item === undefined || node === undefined
      ? null
      : Object.freeze({ item, node })
  }

  const targetReviewItem = (
    value: unknown
  ): ResolvedReviewTarget | null => {
    let target
    try {
      target = decodeCriticMarkupCommandTarget(value)
    } catch {
      return null
    }
    const snapshot = reviewSnapshot()
    if (target.revisionId !== snapshot.revisionId) return null
    return reviewItemByNodeId(target.nodeId)
  }

  const focusReviewItem = (
    target: ICriticMarkupCommandTarget
  ): ICriticMarkupReviewItem | null => {
    const resolved = targetReviewItem(target)
    if (resolved === null) return null
    const { item, node } = resolved
    const span = view.getReviewIndex().commentedSpans.find(
      candidate => candidate.comment === node.nodeId
    )
    const range =
      span?.modelRange ??
      node.modelRange ?? {
        start: node.focusOffset,
        end: node.focusOffset
      }
    currentReviewTarget = Object.freeze({
      revisionId: target.revisionId,
      nodeId: node.nodeId
    })
    const applyFocus = (
      liveRange: Readonly<{ start: number; end: number }>
    ): void => {
      const { start, end } = liveRange
      view.setSelection(start, end)
      view.focus()
    }
    if (view.getProjection() === 'marked') {
      applyFocus(range)
      publishReview()
    } else {
      enqueue(async() => {
        const authenticated = targetReviewItem(target)
        if (authenticated === null) return
        await view.setProjection('marked')
        const live = targetReviewItem(target)
        if (live === null) return
        const liveSpan = view.getReviewIndex().commentedSpans.find(
          candidate => candidate.comment === live.node.nodeId
        )
        applyFocus(
          liveSpan?.modelRange ??
          live.node.modelRange ?? {
            start: live.node.focusOffset,
            end: live.node.focusOffset
          }
        )
        publishReview()
      }).catch((error: unknown) => {
        console.error('Document-core Review focus handoff failed', error)
      })
    }
    return item
  }

  const resolveReviewItem = (
    decision: TCriticMarkupDecision,
    target: ICriticMarkupCommandTarget
  ): Promise<boolean> => {
    if (decision !== 'accept' && decision !== 'reject') {
      return Promise.resolve(false)
    }
    if (targetReviewItem(target) === null) return Promise.resolve(false)
    return enqueue(async() => {
      let live = targetReviewItem(target)
      if (live === null) return false
      if (view.getProjection() !== 'marked') {
        await view.setProjection('marked')
        live = targetReviewItem(target)
        if (live === null) return false
      }
      const intent = live.item.type === 'addition' ||
        live.item.type === 'deletion' ||
        live.item.type === 'substitution'
        ? {
          kind: 'resolve-change' as const,
          target: live.node.nodeId,
          decision
        }
        : live.item.type === 'highlight'
          ? {
            kind: 'remove-highlight' as const,
            target: live.node.nodeId
          }
          : {
            kind: 'remove-comment' as const,
            target: live.node.nodeId
          }
      await view.dispatchIntent(intent)
      return true
    })
  }

  const resolveAllReviewChanges = (
    decision: TCriticMarkupDecision
  ): Promise<number> => {
    if (decision !== 'accept' && decision !== 'reject') {
      return Promise.resolve(0)
    }
    const revisionId = view.snapshot().revisionId
    const count = reviewSnapshot().items.filter((item) =>
      item.type === 'addition' ||
      item.type === 'deletion' ||
      item.type === 'substitution'
    ).length
    if (count === 0) return Promise.resolve(0)
    return enqueue(async() => {
      if (view.snapshot().revisionId !== revisionId) return 0
      if (view.getProjection() !== 'marked') {
        await view.setProjection('marked')
        if (view.snapshot().revisionId !== revisionId) return 0
      }
      const liveCount = reviewSnapshot().items.filter((item) =>
        item.type === 'addition' ||
        item.type === 'deletion' ||
        item.type === 'substitution'
      ).length
      if (liveCount === 0) return 0
      await view.dispatchIntent({
        kind: 'resolve-all-changes',
        decision
      })
      return liveCount
    })
  }

  const editReviewComment = (
    target: ICriticMarkupCommandTarget,
    text: string
  ): Promise<boolean> => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return Promise.resolve(false)
    }
    if (targetReviewItem(target)?.item.type !== 'comment') {
      return Promise.resolve(false)
    }
    return enqueue(async() => {
      let live = targetReviewItem(target)
      if (live?.item.type !== 'comment') return false
      if (view.getProjection() !== 'marked') {
        await view.setProjection('marked')
        live = targetReviewItem(target)
        if (live?.item.type !== 'comment') return false
      }
      await view.dispatchIntent({
        kind: 'edit-comment',
        target: live.node.nodeId,
        comment: text
      })
      return true
    })
  }

  const commentAtPoint = (
    clientX: number,
    clientY: number
  ): ICriticMarkupReviewItem | null => {
    const target = options.element.ownerDocument.elementFromPoint?.(
      clientX,
      clientY
    )
    if (!(target instanceof Element) || !options.element.contains(target)) {
      return null
    }
    const indicator = target.closest<HTMLElement>(
      '[data-critic-comment-node-id]'
    )
    if (indicator !== null && options.element.contains(indicator)) {
      const nodeId = indicator.dataset.criticCommentNodeId
      return reviewSnapshot().items.find(
        item => item.type === 'comment' && item.id === nodeId
      ) ?? null
    }
    const carrier = target.closest<HTMLElement>('[data-model-start]')
    if (carrier === null) return null
    const start = Number(carrier.dataset.modelStart)
    const end = Number(carrier.dataset.modelEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    return reviewSnapshot().items.find((item) => {
      if (item.type !== 'comment') return false
      const span = view.getReviewIndex().commentedSpans.find(
        (candidate) => candidate.comment === item.id
      )
      return span !== undefined &&
        start < span.modelRange.end &&
        end > span.modelRange.start
    }) ?? null
  }

  const reviewItemAtPoint = (
    clientX: number,
    clientY: number
  ): ICriticMarkupReviewItem | null => {
    const target = options.element.ownerDocument.elementFromPoint?.(
      clientX,
      clientY
    )
    if (!(target instanceof Element) || !options.element.contains(target)) {
      return null
    }
    const carrier = target.closest<HTMLElement>('[data-model-start]')
    if (carrier === null) return null
    const start = Number(carrier.dataset.modelStart)
    const end = Number(carrier.dataset.modelEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    return reviewSnapshot().items
      .filter(item =>
        item.type !== 'comment' &&
        start < item.end &&
        end > item.start
      )
      .sort((left, right) =>
        (left.end - left.start) - (right.end - right.start)
      )[0] ?? null
  }

  const showReviewTool = (
    item: ICriticMarkupReviewItem,
    clientX: number,
    clientY: number
  ): void => {
    removeReviewTool()
    currentReviewTarget = Object.freeze({
      revisionId: view.snapshot().revisionId,
      nodeId: item.id
    })
    publishReview()
    const document = options.element.ownerDocument
    const tool = document.createElement('div')
    tool.className = 'document-view-critic-markup-review-tool'
    tool.style.left = `${String(clientX)}px`
    tool.style.top = `${String(clientY)}px`
    const open = document.createElement('button')
    open.type = 'button'
    open.dataset.localeKey = 'Review'
    open.textContent = reviewToolLabel
    open.setAttribute('aria-label', reviewToolLabel)
    open.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      removeReviewTool()
      bus.emit('critic-markup-open-review', item.id)
    })
    tool.appendChild(open)
    document.body.appendChild(tool)
    reviewTool = tool
  }

  const handleReviewPointer = (event: MouseEvent): void => {
    if (
      reviewTool !== null &&
      event.target instanceof Node &&
      reviewTool.contains(event.target)
    ) {
      return
    }
    const item = reviewItemAtPoint(event.clientX, event.clientY)
    if (item === null) {
      removeReviewTool()
      return
    }
    showReviewTool(item, event.clientX, event.clientY)
  }

  options.element.addEventListener('click', handleReviewPointer)

  const authorCriticMarkup = (
    input: TCriticMarkupAuthorInput
  ): Promise<boolean> => {
    if (input.type === 'comment' && input.comment.trim().length === 0) {
      return Promise.resolve(false)
    }
    const revisionId = view.snapshot().revisionId
    const selection = view.getSelection()
    const semanticInput =
      input.type === 'substitution'
        ? {
          kind: 'substitution' as const,
          replacement: input.replacement
        }
        : input.type === 'comment'
          ? {
            kind: 'comment' as const,
            comment: input.comment
          }
          : { kind: input.type }
    return enqueue(async() => {
      const capabilities = view.getReviewIndex().authoring
      const capability =
        input.type === 'addition'
          ? capabilities.canCreateAddition
          : input.type === 'deletion'
            ? capabilities.canCreateDeletion
            : input.type === 'substitution'
              ? capabilities.canCreateSubstitution
              : input.type === 'highlight'
                ? capabilities.canCreateHighlight
                : capabilities.canCreateComment
      const liveSelection = view.getSelection()
      if (
        view.snapshot().revisionId !== revisionId ||
        liveSelection.start !== selection.start ||
        liveSelection.end !== selection.end ||
        !capability
      ) {
        return false
      }
      await view.authorCriticMarkup(semanticInput)
      return true
    })
  }

  const writeClipboard = (
    consumer: 'copy-markdown' | 'copy-html' | 'copy-rich'
  ): Promise<void> => enqueue(async() => {
    await view.commitSelection()
    const projection = view.getProjection()
    const result = await clipboardWrite({
      revisionId: view.snapshot().revisionId,
      consumer,
      view: projection === 'marked' ? 'markup' : projection,
      selection: view.getSelection()
    })
    if (result.kind !== 'written') {
      throw new Error(`Unexpected ${result.kind} receipt for ${consumer}`)
    }
  })

  const editor: DocumentEditorHost = {
    domNode: options.element,
    getMarkdown: () => view.getMarkdownSync(),
    getMarkdownSync: () => view.getMarkdownSync(),
    getProjection: () => view.getProjection(),
    attachDocument: (documentId: string) => {
      const activation = options.session.activateDocument(documentId)
      return enqueue(async() => {
        await activation
        await view.attachDocument(documentId)
        lastNotifiedSource = view.getMarkdownSync()
      })
    },
    editSource: (
      start: number,
      end: number,
      text: string,
      selection: Readonly<{ anchor: number; focus: number }>
    ) => enqueue(() => view.editSource(
      start,
      end,
      text,
      Object.freeze({
        anchor: Object.freeze({
          offset: selection.anchor,
          affinity: 'next' as const
        }),
        focus: Object.freeze({
          offset: selection.focus,
          affinity: selection.anchor === selection.focus
            ? 'next' as const
            : 'previous' as const
        })
      })
    )),
    insertSourceImage: (image: Readonly<{
      src: string
      alt?: string
      title?: string
    }>) => enqueue(() => view.insertSourceImage({
      src: image.src,
      alt: image.alt ?? '',
      ...(image.title === undefined ? {} : { title: image.title })
    })),
    insertImageAsset: (image) => {
      const register = options.session.registerImageAsset
      const registered = register(
        image.documentId,
        image.source,
        image.storage
      )
      return enqueue(async() => {
        try {
          const command = {
            src: registered.src,
            alt: image.alt ?? '',
            ...(image.title === undefined ? {} : { title: image.title })
          }
          if (image.surface === 'source') {
            await view.insertSourceImage(command)
          } else {
            await view.executeCommand({
              kind: 'insert-image',
              ...command
            })
          }
        } finally {
          registered.cancel()
        }
      })
    },
    copySource: (
      selection: Readonly<{ start: number; end: number }>
    ) => enqueue(async() => {
      const result = await clipboardWrite({
        revisionId: view.snapshot().revisionId,
        consumer: 'copy-markdown',
        view: 'source',
        selection
      })
      if (result.kind !== 'written') {
        throw new Error(
          `Unexpected ${result.kind} receipt for source copy`
        )
      }
    }),
    cutSource: (
      selection: Readonly<{ start: number; end: number }>
    ) => enqueue(() => view.cutSource(selection.start, selection.end)),
    pasteSourceClipboard: (
      selection: Readonly<{ anchor: number; focus: number }>
    ) => enqueue(() => view.pasteSourceClipboard(Object.freeze({
      anchor: Object.freeze({
        offset: selection.anchor,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: selection.focus,
        affinity: selection.anchor === selection.focus
          ? 'next' as const
          : 'previous' as const
      })
    }))),
    subscribeDocumentChange: (listener: () => void) => {
      documentChangeListeners.add(listener)
      return Object.freeze({
        dispose: () => documentChangeListeners.delete(listener)
      })
    },
    subscribeSelection: (
      listener: (context: DocumentSelectionContext) => void
    ) => {
      selectionListeners.add(listener)
      return Object.freeze({
        dispose: () => selectionListeners.delete(listener)
      })
    },
    subscribeReview: (
      listener: (snapshot: ICriticMarkupReviewSnapshot) => void
    ) => {
      reviewListeners.add(listener)
      return Object.freeze({
        dispose: () => reviewListeners.delete(listener)
      })
    },
    subscribeInteraction: (
      listener: (interaction: DocumentHostInteraction) => void
    ) => {
      interactionListeners.add(listener)
      return Object.freeze({
        dispose: () => interactionListeners.delete(listener)
      })
    },
    subscribeTrackChangeRejection: (
      listener: (rejection: ICriticMarkupTrackChangeRejection) => void
    ) => {
      trackChangeRejectionListeners.add(listener)
      return Object.freeze({
        dispose: () => trackChangeRejectionListeners.delete(listener)
      })
    },
    snapshot: () => {
      const snapshot = view.snapshot()
      return Object.freeze({
        revisionId: snapshot.revisionId,
        source: snapshot.source,
        sourceSelection: Object.freeze({
          anchor: snapshot.sourceSelection.anchor.offset,
          focus: snapshot.sourceSelection.focus.offset
        }),
        facts: snapshot.facts,
        blocks: snapshot.kind === 'complete'
          ? snapshot.blocks
          : Object.freeze([])
      })
    },
    selection: () => view.snapshot().kind === 'complete'
      ? view.getSelectionContext()
      : null,
    settled,
    destroy: () => {
      if (destroyPromise !== null) return destroyPromise
      const admitted = pending
      destroyed = true
      options.element.removeEventListener('click', handleReviewPointer)
      removeReviewTool()
      viewChange.dispose()
      viewInteraction.dispose()
      viewSelection.dispose()
      viewTrackChangeRejection.dispose()
      documentChangeListeners.clear()
      selectionListeners.clear()
      reviewListeners.clear()
      interactionListeners.clear()
      trackChangeRejectionListeners.clear()
      destroyPromise = (async() => {
        await Promise.allSettled([admitted])
        await view.destroy()
      })()
      return destroyPromise
    },
    configure: (next: DocumentHostConfiguration) => {
      assertDocumentHostConfiguration(next)
      view.setOptions(viewOptionsFromHost(next))
      const updates: Promise<unknown>[] = []
      const trackChanges = next.criticMarkupTrackChanges
      if (
        typeof trackChanges === 'boolean' &&
        trackChanges !== view.getTrackChanges()
      ) {
        updates.push(enqueue(() => view.dispatchIntent({
          kind: 'set-track-changes',
          enabled: trackChanges
        })))
      }
      const projection = next.criticMarkupProjection
      if (
        (
          projection === 'marked' ||
          projection === 'original' ||
          projection === 'revised'
        ) &&
        projection !== view.getProjection()
      ) {
        updates.push(enqueue(async() => {
          await view.setProjection(projection)
        }))
      }
      return Promise.all(updates).then(() => undefined)
    },
    setFocusMode: (enabled: boolean) => view.setFocusMode(enabled),
    dismissTransientTools: () => {
      removeReviewTool()
      view.dismissTransientTools()
    },
    openImageSelector: () => {
      removeReviewTool()
      return enqueue(() => view.openImageSelector())
    },
    hasFocus: () => view.hasFocus(),
    focus: () => view.focus(),
    blur: () => view.blur(),
    selectAll: () => view.selectAll(),
    getTOC: () => view.getTOC().map((item) => Object.freeze({
      nodeId: item.nodeId,
      lvl: item.level,
      content: item.content,
      slug: item.slug,
      sourceOffset: item.sourceOffset
    })),
    resolveHeadingElement: (nodeId: string) =>
      view.resolveHeadingElement(nodeId as NodeId),
    undo: () => enqueue(() => view.undo()),
    redo: () => enqueue(() => view.redo()),
    flush: settled,
    setSelection: (start: number, end: number) => {
      view.setSelection(start, end)
      publishSelection(view.getSelectionContext())
    },
    selectSource: (
      selection: Readonly<{ anchor: number; focus: number }>
    ) => enqueue(() => view.selectSource(Object.freeze({
      anchor: Object.freeze({
        offset: selection.anchor,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: selection.focus,
        affinity: selection.anchor === selection.focus
          ? 'next' as const
          : 'previous' as const
      })
    }))),
    getCursorOffset: (): IndexCursor => {
      const selection = view.getSourceSelection()
      const source = view.getMarkdownSync()
      return {
        anchor: positionFromOffset(source, selection.anchor.offset),
        focus: positionFromOffset(source, selection.focus.offset)
      }
    },
    setCursorByOffset: (cursor: IndexCursor | number) => {
      if (typeof cursor === 'number') {
        const caret = { offset: cursor, affinity: 'next' as const }
        view.setSourceSelection({ anchor: caret, focus: caret })
        return
      }
      const source = view.getMarkdownSync()
      view.setSourceSelection({
        anchor: {
          offset: offsetFromPosition(source, cursor.anchor),
          affinity: 'next'
        },
        focus: {
          offset: offsetFromPosition(source, cursor.focus),
          affinity: 'next'
        }
      })
    },
    search,
    selectActiveSearchMatch: (): boolean => {
      const chosen = searchIndex >= 0 ? searchMatches[searchIndex] : undefined
      if (chosen === undefined) return false
      view.setSelection(chosen.start, chosen.end)
      view.focus()
      return true
    },
    find: (direction: 'previous' | 'next'): SearchResult => {
      if (searchMatches.length === 0) return currentSearch()
      const delta = direction === 'next' ? 1 : -1
      searchIndex = (searchIndex + delta + searchMatches.length) % searchMatches.length
      view.setSearchDecorations(searchMatches, searchIndex)
      return currentSearch()
    },
    replace: async(
      replacement: string,
      replaceOptions: {
        isSingle: boolean
        query: DocumentSearchQuery
      }
    ): Promise<SearchResult> => enqueue(async() => {
      const query = replaceOptions.query
      if (!sameSearchQuery(query, searchQuery)) search(query)
      if (searchMatches.length === 0) return currentSearch()
      const chosen = searchMatches[Math.max(0, searchIndex)]
      if (chosen === undefined) return currentSearch()
      if (replaceOptions.isSingle) {
        await view.replaceRange(chosen.start, chosen.end, replacement)
      } else {
        await view.replaceCurrentMatches(query, replacement)
      }
      return search(query)
    }),
    replaceCurrentWord: (replacement: string) => {
      const selection = view.getSelection()
      return enqueue(() => view.replaceWordAt(selection.end, replacement))
    },
    pasteAsPlainText: () => enqueue(() => view.pasteFromClipboard()),
    insertImage: (
      image: string | Readonly<{
        src: string
        alt?: string
        title?: string
      }>
    ) => {
      const value = typeof image === 'string' ? { src: image } : image
      return enqueue(() => view.executeCommand({
        kind: 'insert-image',
        src: value.src,
        alt: value.alt ?? '',
        ...(value.title === undefined ? {} : { title: value.title })
      }))
    },
    setCodeLanguage: (language: string) => {
      return enqueue(() => view.executeCommand({
        kind: 'set-code-language',
        language
      }))
    },
    insertLink: (link: Readonly<{ href: string; title?: string }>) => {
      return enqueue(() => view.executeCommand({
        kind: 'insert-link',
        href: link.href,
        ...(link.title === undefined ? {} : { title: link.title })
      }))
    },
    insertFootnote: (
      footnote: Readonly<{ label: string; content: string }>
    ) => {
      return enqueue(() => view.executeCommand({
        kind: 'insert-footnote',
        label: footnote.label,
        content: footnote.content
      }))
    },
    setListIndentation: (direction: 'increase' | 'decrease') => {
      return enqueue(() => view.executeCommand({
        kind: 'set-list-indentation',
        direction
      }))
    },
    insertParagraph: (location: 'before' | 'after' = 'after') => {
      return enqueue(() => view.executeCommand({
        kind: 'insert-paragraph',
        location
      }))
    },
    setLocale: (locale: ILocale) => {
      view.setLocale(locale)
      reviewToolLabel = locale.resource.Review ?? en.resource.Review
      const openReview = reviewTool?.querySelector<HTMLButtonElement>(
        'button[data-locale-key="Review"]'
      )
      if (openReview) {
        openReview.textContent = reviewToolLabel
        openReview.setAttribute('aria-label', reviewToolLabel)
      }
    },
    convertBlock: (conversion: BlockConversion) => {
      return enqueue(() => view.executeCommand({
        kind: 'convert-block',
        conversion
      }))
    },
    duplicateBlock: () => {
      return enqueue(() => view.executeCommand({ kind: 'duplicate-block' }))
    },
    deleteBlock: () => {
      return enqueue(() => view.executeCommand({ kind: 'delete-block' }))
    },
    formatText: (format: InlineFormat) => {
      return enqueue(() => view.executeCommand({
        kind: 'format-text',
        format
      }))
    },
    requestTable: () => enqueue(() => view.requestTable()),
    insertTableRow: (location: 'before' | 'after' = 'after') => {
      return enqueue(() => view.executeCommand({
        kind: 'insert-table-row',
        location
      }))
    },
    copyAsMarkdown: () => {
      return writeClipboard('copy-markdown')
    },
    copyAsHtml: () => {
      return writeClipboard('copy-html')
    },
    copyAsRich: () => {
      return writeClipboard('copy-rich')
    },
    commitAuthoringSelection: () =>
      enqueue(async() => {
        // Review refreshes are debounced independently of browser input. A
        // slow remote edit must publish and restore its authoritative caret
        // before this boundary reads the mounted DOM range; otherwise the
        // queued select can carry pre-edit offsets into the next revision.
        await view.settled()
        // A SourceOnly revision mounts no semantic tree: there is no browser
        // selection to commit and no selection context to publish.
        if (view.snapshot().kind !== 'complete') return
        await view.commitSelection()
        publishReview()
        publishSelection(view.getSelectionContext())
      }),
    getCriticMarkupReviewSnapshot: reviewSnapshot,
    getCriticMarkupCommentAtPoint: commentAtPoint,
    createCriticMarkup: authorCriticMarkup,
    focusCriticMarkup: (
      target: ICriticMarkupCommandTarget
    ): ICriticMarkupReviewItem | null => focusReviewItem(target),
    navigateCriticMarkup: (
      direction: TCriticMarkupNavigationDirection
    ): ICriticMarkupReviewItem | null => {
      if (direction !== 'next' && direction !== 'previous') return null
      const snapshot = reviewSnapshot()
      const items = snapshot.items
      if (items.length === 0) return null
      const currentIndex =
        currentReviewTarget === null ||
        currentReviewTarget.revisionId !== snapshot.revisionId
          ? -1
          : items.findIndex(item => item.id === currentReviewTarget?.nodeId)
      const nextIndex = direction === 'next'
        ? (currentIndex + 1 + items.length) % items.length
        : (currentIndex <= 0 ? items.length : currentIndex) - 1
      const item = items[nextIndex]
      return item === undefined
        ? null
        : focusReviewItem({
          revisionId: snapshot.revisionId,
          nodeId: item.id
        })
    },
    resolveCriticMarkup: (
      decision: TCriticMarkupDecision,
      target: ICriticMarkupCommandTarget
    ) => resolveReviewItem(decision, target),
    resolveAllCriticMarkup: resolveAllReviewChanges,
    editCriticMarkupComment: (
      target: ICriticMarkupCommandTarget,
      text: string
    ) => editReviewComment(target, text)
  }

  return Object.freeze(editor)
}
