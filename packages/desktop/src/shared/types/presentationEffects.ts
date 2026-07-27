import type { DocumentCoreStaticSinkRequest } from './documentCore'

export const EXTERNAL_RESOURCE_TARGETS = Object.freeze([
  'documentation-basics',
  'documentation-markdown-syntax',
  'documentation-keybindings',
  'documentation-images',
  'documentation-export-themes',
  'pandoc-home',
  'minimatch-reference',
  'picgo-core-repository',
  'picgo-core-documentation'
] as const)

export type ExternalResourceTarget =
  (typeof EXTERNAL_RESOURCE_TARGETS)[number]

export interface ExternalResourceOpenRequest {
  readonly schema: 'external-resource-open-1'
  readonly target: ExternalResourceTarget
}

export interface DocumentRevealRequest {
  readonly schema: 'document-reveal-1'
  readonly documentId: string
}

export interface ProjectRevealRequest {
  readonly schema: 'project-reveal-1'
  readonly entrySegments: readonly string[]
}

export interface ImageFolderOpenRequest {
  readonly schema: 'image-folder-open-1'
}

export interface StaticOutputRevealRequest {
  readonly schema: 'static-output-reveal-1'
  readonly documentId: string
  readonly revisionId: string
  readonly consumer: DocumentCoreStaticSinkRequest['consumer']
  readonly view: DocumentCoreStaticSinkRequest['view']
}
