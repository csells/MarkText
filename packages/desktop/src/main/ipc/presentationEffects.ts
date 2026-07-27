import path from 'node:path'
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import log from 'electron-log'
import type {
  ExternalResourceTarget,
  StaticOutputRevealRequest
} from '../../shared/types/presentationEffects'
import {
  readImageAssetProjectRoot,
  readImageAssetSettings
} from '../imageAssets/imageAssetSettings'
import { resolveStaticOutput } from '../presentation/staticOutputAuthority'
import { presentationPolicy } from '../presentationPolicy'
import { describeDocumentCoreFile } from './documentCore'
import {
  decodeDocumentRevealRequest,
  decodeExternalResourceOpenRequest,
  decodeImageFolderOpenRequest,
  decodeProjectRevealRequest,
  decodeStaticOutputRevealRequest
} from './presentationEffectsRuntimeCodec'

const EXTERNAL_RESOURCE_URLS: Readonly<
  Record<ExternalResourceTarget, string>
> = Object.freeze({
  'documentation-basics': 'https://marktext.me/docs/basics',
  'documentation-markdown-syntax':
    'https://marktext.me/docs/markdown-syntax',
  'documentation-keybindings': 'https://marktext.me/docs/key-bindings',
  'documentation-images': 'https://marktext.me/docs/images',
  'documentation-export-themes':
    'https://marktext.me/docs/export-themes',
  'pandoc-home': 'http://pandoc.org',
  'minimatch-reference': 'https://github.com/isaacs/minimatch',
  'picgo-core-repository': 'https://github.com/PicGo/PicGo-Core',
  'picgo-core-documentation':
    'https://picgo.github.io/PicGo-Core-Doc/'
})

export interface PresentationEffectSender {
  readonly id: number
}

export interface PresentationEffectHandlerDependencies {
  readonly openExternal: (target: string) => Promise<void>
  readonly openPath: (target: string) => Promise<string>
  readonly showItemInFolder: (target: string) => void
  readonly describeDocument: (
    sender: PresentationEffectSender,
    documentId: string
  ) => { readonly pathname: string | null }
  readonly resolveProjectRoot: (
    sender: PresentationEffectSender
  ) => string | null
  readonly readImageSettings: () => {
    readonly configuredFolderPath: string
  }
  readonly resolveStaticOutput: (
    sender: PresentationEffectSender,
    request: StaticOutputRevealRequest
  ) => string
  readonly reportError: (label: string, error: unknown) => void
}

const productionDependencies: PresentationEffectHandlerDependencies =
  Object.freeze({
    openExternal: (target: string) =>
      presentationPolicy.openExternal(target),
    openPath: (target: string) => presentationPolicy.openPath(target),
    showItemInFolder: (target: string) =>
      presentationPolicy.showItemInFolder(target),
    describeDocument: (
      sender: PresentationEffectSender,
      documentId: string
    ) =>
      describeDocumentCoreFile(sender as WebContents, documentId),
    resolveProjectRoot: (sender: PresentationEffectSender) => {
      const window = BrowserWindow.fromWebContents(sender as WebContents)
      return window === null
        ? null
        : readImageAssetProjectRoot(window.id)
    },
    readImageSettings: readImageAssetSettings,
    resolveStaticOutput,
    reportError: (label: string, error: unknown) =>
      log.error(`${label} failed:`, error)
  })

function retainedAbsolutePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    !path.isAbsolute(value)
  ) {
    throw new TypeError(`${label} must be a main-owned absolute path`)
  }
  return path.resolve(value)
}

function projectEntry(rootValue: string | null, segments: readonly string[]): string {
  const root = retainedAbsolutePath(rootValue, 'Project root')
  const target = path.resolve(root, ...segments)
  const relative = path.relative(root, target)
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Project reveal target escapes the retained root')
  }
  return target
}

async function runEffect(
  label: string,
  effect: () => void | Promise<void>,
  dependencies: PresentationEffectHandlerDependencies
): Promise<boolean> {
  try {
    await effect()
    return true
  } catch (error) {
    dependencies.reportError(label, error)
    return false
  }
}

export function registerPresentationEffectHandlers(
  dependencies: PresentationEffectHandlerDependencies =
  productionDependencies
): void {
  ipcMain.handle(
    'mt::external-resource::open',
    async(_event, rawRequest: unknown) => {
      const request = decodeExternalResourceOpenRequest(rawRequest)
      return await runEffect(
        'External resource open',
        async() => await dependencies.openExternal(
          EXTERNAL_RESOURCE_URLS[request.target]
        ),
        dependencies
      )
    }
  )
  ipcMain.handle(
    'mt::document::reveal',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentRevealRequest(rawRequest)
      return await runEffect(
        'Document reveal',
        () => {
          const description = dependencies.describeDocument(
            event.sender,
            request.documentId
          )
          dependencies.showItemInFolder(
            retainedAbsolutePath(
              description.pathname,
              'Retained document'
            )
          )
        },
        dependencies
      )
    }
  )
  ipcMain.handle(
    'mt::project::reveal',
    async(event, rawRequest: unknown) => {
      const request = decodeProjectRevealRequest(rawRequest)
      return await runEffect(
        'Project entry reveal',
        () => dependencies.showItemInFolder(
          projectEntry(
            dependencies.resolveProjectRoot(event.sender),
            request.entrySegments
          )
        ),
        dependencies
      )
    }
  )
  ipcMain.handle(
    'mt::image-folder::open',
    async(_event, rawRequest: unknown) => {
      decodeImageFolderOpenRequest(rawRequest)
      return await runEffect(
        'Configured image folder open',
        async() => {
          await dependencies.openPath(
            retainedAbsolutePath(
              dependencies.readImageSettings().configuredFolderPath,
              'Configured image folder'
            )
          )
        },
        dependencies
      )
    }
  )
  ipcMain.handle(
    'mt::static-output::reveal',
    async(event, rawRequest: unknown) => {
      const request = decodeStaticOutputRevealRequest(rawRequest)
      return await runEffect(
        'Static output reveal',
        () => dependencies.showItemInFolder(
          retainedAbsolutePath(
            dependencies.resolveStaticOutput(event.sender, request),
            'Retained static output'
          )
        ),
        dependencies
      )
    }
  )
}
