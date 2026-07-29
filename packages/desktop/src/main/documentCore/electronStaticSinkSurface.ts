import { BrowserWindow } from 'electron'
import path from 'node:path'
import { writeFile } from '../filesystem'
import { presentationPolicy } from '../presentationPolicy'
import type {
  DocumentCorePrintSubmission,
  DocumentCoreStaticSinkSurface
} from './staticSinkHost'
import type { DocumentCorePdfPageOptions } from './exportDecorator'

const STATIC_WINDOW_OPTIONS: Electron.BrowserWindowConstructorOptions = {
  width: 1200,
  height: 900,
  show: false,
  webPreferences: {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false
  }
}

function assertTargetPath(targetPath: string): void {
  if (targetPath.length === 0 || path.extname(targetPath).length === 0) {
    throw new TypeError('A static sink needs an explicit file target')
  }
}

async function withStaticWindow<T>(
  html: string,
  operation: (window: BrowserWindow) => Promise<T>
): Promise<T> {
  const window = new BrowserWindow(
    presentationPolicy.deriveWindowOptions(STATIC_WINDOW_OPTIONS)
  )
  try {
    const encoded = Buffer.from(html, 'utf8').toString('base64')
    await window.loadURL(`data:text/html;charset=utf-8;base64,${encoded}`)
    return await operation(window)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

async function renderPdf(
  html: string,
  pageOptions: DocumentCorePdfPageOptions
): Promise<Buffer> {
  return await withStaticWindow(html, async(window) => {
    return await window.webContents.printToPDF({
      printBackground: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
      ...pageOptions
    })
  })
}

async function writePdf(
  targetPath: string,
  html: string,
  pageOptions: DocumentCorePdfPageOptions
): Promise<number> {
  assertTargetPath(targetPath)
  const data = await renderPdf(html, pageOptions)
  await writeFile(targetPath, data, path.extname(targetPath), 'binary')
  return data.length
}

/**
 * Electron implementation of the static sink adapter.
 *
 * It receives only strings consumed from an authentic same-process
 * `TrustedHtml` capability. PDF and print artifacts are rendered in a
 * disposable sandboxed window that has no preload, Node integration, or
 * renderer IPC authority.
 */
export function createElectronDocumentCoreStaticSinkSurface():
DocumentCoreStaticSinkSurface {
  return Object.freeze({
    writeStyledHtml: async(
      targetPath: string,
      html: string
    ): Promise<number> => {
      assertTargetPath(targetPath)
      await writeFile(
        targetPath,
        html,
        path.extname(targetPath),
        'utf8'
      )
      return Buffer.byteLength(html, 'utf8')
    },
    writePdf,
    submitPrint: async(html: string): Promise<DocumentCorePrintSubmission> => {
      await withStaticWindow(html, async(window) => {
        await new Promise<void>((resolve, reject) => {
          try {
            presentationPolicy.printWebContents(
              window.webContents,
              { printBackground: true },
              (success, failureReason) => {
                if (success) {
                  resolve()
                } else {
                  reject(new Error(
                    `Native print failed: ${failureReason || 'unknown reason'}`
                  ))
                }
              }
            )
          } catch (error) {
            reject(error)
          }
        })
      })
      return Object.freeze({ kind: 'submitted' })
    }
  })
}

/**
 * The automation print destination: a deterministic PDF proof instead of a
 * native submission. Composed around a real surface so every other sink, and
 * the whole decoration path, stays exactly the production one.
 */
export function createPrintProofStaticSinkSurface(
  surface: DocumentCoreStaticSinkSurface,
  targetPath: string
): DocumentCoreStaticSinkSurface {
  return Object.freeze({
    ...surface,
    submitPrint: async(
      html: string,
      pageOptions: DocumentCorePdfPageOptions
    ): Promise<DocumentCorePrintSubmission> => Object.freeze({
      kind: 'proof-written',
      targetPath,
      bytes: await surface.writePdf(targetPath, html, pageOptions)
    })
  })
}
