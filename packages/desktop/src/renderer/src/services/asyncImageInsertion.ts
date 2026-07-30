import type {
  UploaderUploadReceipt
} from '@shared/types/uploader'
import {
  decodeUploaderUploadReceipt
} from './uploaderClient'

export type ImageInsertionSurface = 'markup' | 'source'

export interface ImageInsertionSnapshotHost {
  readonly settled: () => Promise<void>
  readonly snapshot: () => Readonly<{
    readonly revisionId: string
    readonly sourceSelection: Readonly<{
      readonly anchor: number
      readonly focus: number
    }>
  }>
  readonly selection: () => Readonly<{
    readonly anchor: Readonly<{ readonly offset: number }>
    readonly focus: Readonly<{ readonly offset: number }>
  }> | null
}

export interface ImageReferenceInsertionHost
  extends ImageInsertionSnapshotHost {
  readonly insertImage: (
    image: Readonly<{ readonly src: string }>
  ) => Promise<void>
  readonly insertSourceImage: (
    image: Readonly<{ readonly src: string }>
  ) => Promise<void>
}

export interface ImageInsertionContext<
  Host extends ImageInsertionSnapshotHost = ImageInsertionSnapshotHost
> {
  readonly documentId: string | null
  readonly surface: ImageInsertionSurface
  readonly host: Host | null
}

interface ImageInsertionIdentity {
  readonly documentId: string
  readonly revisionId: string
  readonly surface: ImageInsertionSurface
  readonly selection: Readonly<{
    readonly anchor: number
    readonly focus: number
  }>
}

export interface ImageInsertionAdmission<
  Host extends ImageInsertionSnapshotHost = ImageInsertionSnapshotHost
> extends ImageInsertionIdentity {
  readonly host: Host
}

export class ImageInsertionAdmissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageInsertionAdmissionError'
  }
}

export function isImageInsertionAdmissionError(
  value: unknown
): value is ImageInsertionAdmissionError {
  return value instanceof ImageInsertionAdmissionError
}

function requireContext<Host extends ImageInsertionSnapshotHost>(
  context: ImageInsertionContext<Host>
): Readonly<{
    documentId: string
    surface: ImageInsertionSurface
    host: Host
  }> {
  if (
    context.documentId === null ||
    context.documentId.length === 0 ||
    context.host === null
  ) {
    throw new ImageInsertionAdmissionError(
      'Image insertion requires an admitted document'
    )
  }
  return Object.freeze({
    documentId: context.documentId,
    surface: context.surface,
    host: context.host
  })
}

function captureIdentity<Host extends ImageInsertionSnapshotHost>(
  context: Readonly<{
    documentId: string
    surface: ImageInsertionSurface
    host: Host
  }>
): ImageInsertionIdentity {
  const snapshot = context.host.snapshot()
  const markupSelection = context.surface === 'markup'
    ? context.host.selection()
    : null
  const selection = context.surface === 'source'
    ? snapshot.sourceSelection
    : Object.freeze({
      anchor: markupSelection?.anchor.offset ?? -1,
      focus: markupSelection?.focus.offset ?? -1
    })
  if (
    snapshot.revisionId.length === 0 ||
    !Number.isInteger(selection.anchor) ||
    !Number.isInteger(selection.focus) ||
    selection.anchor < 0 ||
    selection.focus < 0
  ) {
    throw new ImageInsertionAdmissionError(
      'Image insertion target identity is invalid'
    )
  }
  return Object.freeze({
    documentId: context.documentId,
    revisionId: snapshot.revisionId,
    surface: context.surface,
    selection: Object.freeze({
      anchor: selection.anchor,
      focus: selection.focus
    })
  })
}

function sameIdentity(
  left: ImageInsertionIdentity,
  right: ImageInsertionIdentity
): boolean {
  return (
    left.documentId === right.documentId &&
    left.revisionId === right.revisionId &&
    left.surface === right.surface &&
    left.selection.anchor === right.selection.anchor &&
    left.selection.focus === right.selection.focus
  )
}

export async function admitImageInsertion<
  Host extends ImageInsertionSnapshotHost
>(
  readContext: () => ImageInsertionContext<Host>
): Promise<ImageInsertionAdmission<Host>> {
  const initial = requireContext(readContext())
  await initial.host.settled()
  const current = requireContext(readContext())
  if (
    current.documentId !== initial.documentId ||
    current.surface !== initial.surface ||
    current.host !== initial.host
  ) {
    throw new ImageInsertionAdmissionError(
      'Image insertion context changed before admission'
    )
  }
  return Object.freeze({
    ...captureIdentity(current),
    host: current.host
  })
}

export async function assertImageInsertionAdmission<
  Host extends ImageInsertionSnapshotHost
>(
  admission: ImageInsertionAdmission<Host>,
  readContext: () => ImageInsertionContext<Host>
): Promise<void> {
  await admission.host.settled()
  const current = requireContext(readContext())
  if (current.host !== admission.host) {
    throw new ImageInsertionAdmissionError(
      'Image insertion host changed after admission'
    )
  }
  if (!sameIdentity(admission, captureIdentity(current))) {
    throw new ImageInsertionAdmissionError(
      'Image insertion document, revision, surface, or selection changed'
    )
  }
}

export async function completeAsyncImageInsertion<
  Host extends ImageInsertionSnapshotHost,
  Result
>(
  admission: ImageInsertionAdmission<Host>,
  pending: Promise<Result>,
  readContext: () => ImageInsertionContext<Host>,
  insert: (
    host: Host,
    surface: ImageInsertionSurface,
    result: Result
  ) => void | Promise<void>
): Promise<Result> {
  const result = await pending
  await assertImageInsertionAdmission(admission, readContext)
  await insert(admission.host, admission.surface, result)
  return result
}

export async function insertImageReference(
  host: ImageReferenceInsertionHost,
  surface: ImageInsertionSurface,
  reference: string
): Promise<void> {
  if (surface === 'source') {
    await host.insertSourceImage(Object.freeze({ src: reference }))
  } else {
    await host.insertImage(Object.freeze({ src: reference }))
  }
}

export async function completeUploadedImageInsertion<
  Host extends ImageReferenceInsertionHost
>(
  admission: ImageInsertionAdmission<Host>,
  pending: Promise<UploaderUploadReceipt>,
  readContext: () => ImageInsertionContext<Host>,
  observeReceipt?: (receipt: UploaderUploadReceipt) => void
): Promise<UploaderUploadReceipt> {
  const receipt = decodeUploaderUploadReceipt(
    await pending,
    admission.documentId
  )
  observeReceipt?.(receipt)
  await assertImageInsertionAdmission(admission, readContext)
  await insertImageReference(admission.host, admission.surface, receipt.url)
  return receipt
}
