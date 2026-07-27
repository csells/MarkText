import type { DocumentCoreHistoryState } from '@shared/types/documentCore'
import type { NodeId } from '@marktext/document-core'

export interface SourceModeSelection {
  readonly anchor: number
  readonly focus: number
}

export interface SourceModeOutlineItem {
  readonly nodeId: NodeId
  readonly slug: string
  readonly sourceOffset: number
}

export interface SourceModePublication {
  readonly documentId: string
  readonly revisionId: string
  readonly source: string
  readonly selection: SourceModeSelection
  readonly history: DocumentCoreHistoryState
  readonly outline: readonly SourceModeOutlineItem[]
}

export interface SourceModeEditRequest {
  readonly revisionId: string
  readonly start: number
  readonly end: number
  readonly text: string
  readonly selection: SourceModeSelection
}

export interface SourceModeImageRequest {
  readonly src: string
  readonly alt: string
  readonly title?: string
}

export interface SourceModeCopyRequest {
  readonly revisionId: string
  readonly start: number
  readonly end: number
}

export interface SourceModePasteRequest {
  readonly revisionId: string
  readonly selection: SourceModeSelection
}

interface Disposable {
  readonly dispose: () => void
}

export interface SourceModeDocumentPort {
  readonly snapshot: () => SourceModePublication
  readonly subscribe: (
    listener: (publication: SourceModePublication) => void
  ) => Disposable
  readonly edit: (
    request: SourceModeEditRequest
  ) => Promise<SourceModePublication>
  readonly cut: (
    request: SourceModeEditRequest
  ) => Promise<SourceModePublication>
  readonly copy: (request: SourceModeCopyRequest) => Promise<void>
  readonly paste: (
    request: SourceModePasteRequest
  ) => Promise<SourceModePublication>
  readonly insertImage: (
    request: SourceModeImageRequest
  ) => Promise<SourceModePublication>
  readonly select: (
    selection: SourceModeSelection
  ) => Promise<SourceModePublication>
  readonly undo: () => Promise<SourceModePublication>
  readonly redo: () => Promise<SourceModePublication>
  readonly settled: () => Promise<void>
}

export interface SourceModeSurface {
  /**
   * Mount one main-verified publication. User input may already be visible
   * optimistically in the native surface; this method never receives a draft.
   */
  readonly mount: (publication: SourceModePublication) => void
  /** Render an admitted local gesture while main verification is pending. */
  readonly preview: (
    source: string,
    selection: SourceModeSelection
  ) => void
}

export interface SourceModeController {
  readonly start: () => void
  readonly edit: (
    gesture: Omit<SourceModeEditRequest, 'revisionId'>
  ) => Promise<void>
  readonly cut: (
    gesture: Omit<SourceModeEditRequest, 'revisionId'>
  ) => Promise<void>
  readonly copy: (
    selection: Readonly<{ start: number; end: number }>
  ) => Promise<void>
  readonly paste: (selection: SourceModeSelection) => Promise<void>
  readonly select: (selection: SourceModeSelection) => Promise<void>
  readonly insertImage: (request: SourceModeImageRequest) => Promise<void>
  readonly undo: () => Promise<void>
  readonly redo: () => Promise<void>
  readonly refresh: () => Promise<void>
  readonly settled: () => Promise<void>
  readonly destroy: () => void
}

function applyEdit(
  source: string,
  gesture: Omit<SourceModeEditRequest, 'revisionId'>
): string {
  if (
    !Number.isInteger(gesture.start) ||
    !Number.isInteger(gesture.end) ||
    gesture.start < 0 ||
    gesture.end < gesture.start ||
    gesture.end > source.length
  ) {
    throw new RangeError('Source gesture is outside the projected publication')
  }
  return source.slice(0, gesture.start) +
    gesture.text +
    source.slice(gesture.end)
}

export function createSourceModeController(
  port: SourceModeDocumentPort,
  surface: SourceModeSurface
): SourceModeController {
  let subscription: Disposable | null = null
  let verified = port.snapshot()
  let optimisticSource = verified.source
  let pendingGestures = 0
  let generation = 0
  let destroyed = false
  let tail = Promise.resolve()

  const mount = (publication: SourceModePublication): void => {
    if (!destroyed) surface.mount(publication)
  }

  const enqueue = <Result>(
    operation: () => Promise<Result>
  ): Promise<Result> => {
    const run = tail.then(operation)
    tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  const rollback = (): void => {
    verified = port.snapshot()
    optimisticSource = verified.source
    generation += 1
    mount(verified)
  }

  const start = (): void => {
    if (subscription !== null) return
    verified = port.snapshot()
    optimisticSource = verified.source
    subscription = port.subscribe(publication => {
      verified = publication
      if (pendingGestures === 0) {
        optimisticSource = publication.source
        mount(publication)
      }
    })
    mount(verified)
  }

  const submitEdit = (
    gesture: Omit<SourceModeEditRequest, 'revisionId'>,
    submit: (
      request: SourceModeEditRequest
    ) => Promise<SourceModePublication>
  ): Promise<void> => {
    if (destroyed) {
      return Promise.reject(new Error('Source-mode controller is destroyed'))
    }
    const baseSource = optimisticSource
    const nextSource = applyEdit(baseSource, gesture)
    const admittedGeneration = generation
    optimisticSource = nextSource
    pendingGestures += 1
    surface.preview(nextSource, gesture.selection)

    return enqueue(async() => {
      if (admittedGeneration !== generation) {
        pendingGestures -= 1
        throw new Error('Source gesture depended on a rejected publication')
      }
      const current = port.snapshot()
      if (current.source !== baseSource) {
        pendingGestures -= 1
        rollback()
        throw new Error('Source gesture base no longer matches the publication')
      }
      try {
        const publication = await submit(Object.freeze({
          revisionId: current.revisionId,
          ...gesture
        }))
        if (publication.source !== nextSource) {
          throw new Error('Source edit publication does not match the gesture')
        }
        verified = publication
        pendingGestures -= 1
        if (pendingGestures === 0) {
          optimisticSource = publication.source
          mount(publication)
        }
      } catch (error) {
        pendingGestures -= 1
        rollback()
        throw error
      }
    })
  }

  const edit = (
    gesture: Omit<SourceModeEditRequest, 'revisionId'>
  ): Promise<void> => submitEdit(gesture, port.edit)

  const cut = (
    gesture: Omit<SourceModeEditRequest, 'revisionId'>
  ): Promise<void> => submitEdit(gesture, port.cut)

  const copy = (
    selection: Readonly<{ start: number; end: number }>
  ): Promise<void> => {
    const sourceAtAdmission = optimisticSource
    if (
      !Number.isInteger(selection.start) ||
      !Number.isInteger(selection.end) ||
      selection.start < 0 ||
      selection.end < selection.start ||
      selection.end > sourceAtAdmission.length
    ) {
      return Promise.reject(
        new RangeError('Source copy is outside the projected publication')
      )
    }
    return enqueue(async() => {
      const current = port.snapshot()
      if (current.source !== sourceAtAdmission) {
        throw new Error('Source copy base no longer matches the publication')
      }
      await port.copy(Object.freeze({
        revisionId: current.revisionId,
        start: selection.start,
        end: selection.end
      }))
    })
  }

  const publishOperation = (
    operation: () => Promise<SourceModePublication>
  ): Promise<void> => enqueue(async() => {
    try {
      const publication = await operation()
      verified = publication
      optimisticSource = publication.source
      mount(publication)
    } catch (error) {
      rollback()
      throw error
    }
  })

  const paste = (selection: SourceModeSelection): Promise<void> => {
    const sourceAtAdmission = optimisticSource
    return publishOperation(() => {
      const current = port.snapshot()
      if (current.source !== sourceAtAdmission) {
        throw new Error(
          'Source paste base no longer matches the publication'
        )
      }
      return port.paste(Object.freeze({
        revisionId: current.revisionId,
        selection
      }))
    })
  }

  return Object.freeze({
    start,
    edit,
    cut,
    copy,
    paste,
    select: (selection: SourceModeSelection) =>
      publishOperation(() => port.select(selection)),
    insertImage: (request: SourceModeImageRequest) =>
      publishOperation(() => port.insertImage(request)),
    undo: () => publishOperation(port.undo),
    redo: () => publishOperation(port.redo),
    refresh: () => publishOperation(async() => {
      await port.settled()
      return port.snapshot()
    }),
    settled: async() => tail,
    destroy: () => {
      destroyed = true
      subscription?.dispose()
      subscription = null
    }
  })
}
