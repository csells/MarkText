import type { ImageAssetStorage } from '@shared/types/imageAsset'

export interface ImageAssetPolicyInput {
  readonly action: 'path' | 'folder' | 'upload'
  readonly source: 'native-capability' | 'binary'
  readonly documentPersisted: boolean
  readonly preferDocumentRelative: boolean
}

export function imageAssetStorage({
  action,
  source,
  documentPersisted,
  preferDocumentRelative
}: ImageAssetPolicyInput): ImageAssetStorage {
  if (action === 'path' && source === 'native-capability') return 'reference'
  return documentPersisted && preferDocumentRelative
    ? 'document-relative'
    : 'configured-folder'
}

export function isRemoteImageReference(reference: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(reference)
}
