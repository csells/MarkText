import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as zlib from 'node:zlib'
import { CRITIC_MARKUP_CORPUS } from '../fixtures/profile1Adversarial'
import { closeElectron, clickMenuById, launchWithMarkdown } from './helpers'

// Exercise Chromium's real PDF producer against the hidden MarkText editor
// window. Native save-dialog composition and cancellation are unit-tested at
// the presentation-policy boundary; an E2E test must not patch Electron or add
// a production-only authorization backdoor merely to choose a destination.

const PDF_DOC =
  '# Export Smoke\n\n' +
  'First paragraph with **bold** and *italic* text.\n\n' +
  'Second paragraph for a multi-block document.\n\n' +
  '- list item one\n- list item two\n'

// Print the editor window backing `page` — matched by webContents URL, never
// by getAllWindows() order (the background presentation policy gives no
// ordering guarantee, and printing an arbitrary hidden window would silently
// capture an unchanging document).
const printHiddenEditorToPdf = async(
  app: ElectronApplication,
  page: Page
): Promise<Buffer> => {
  const base64 = await app.evaluate(async({ BrowserWindow }, editorUrl) => {
    const win = BrowserWindow.getAllWindows().find(
      (candidate) =>
        !candidate.isDestroyed() && candidate.webContents.getURL() === editorUrl
    )
    if (!win) {
      const urls = BrowserWindow.getAllWindows().map((candidate) =>
        candidate.isDestroyed() ? '<destroyed>' : candidate.webContents.getURL()
      )
      throw new Error(
        `No live window matches the editor page URL ${editorUrl}; windows: ${JSON.stringify(urls)}`
      )
    }
    const data = await win.webContents.printToPDF({
      printBackground: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true
    })
    return data.toString('base64')
  }, page.url())
  return Buffer.from(base64, 'base64')
}

// --- Minimal PDF text extraction -------------------------------------------
// Chromium's Skia PDF producer embeds ONE subsetted font per typeface, each
// with its own ToUnicode CMap keyed by per-subset glyph ids. Glyph ids collide
// across fonts, so decoding is font-aware: parse the object graph, map each
// page's font resources to their CMaps, and walk each content stream in
// operator order so every shown hex string decodes through the font selected
// by the preceding Tf. A single merged CMap interleaves garbage.

interface PdfObject {
  dict: string
  stream?: Buffer
}

const parsePdfObjects = (data: Buffer): Map<number, PdfObject> => {
  const raw = data.toString('latin1')
  const objects = new Map<number, PdfObject>()
  const header = /(\d+)\s+0\s+obj/g
  let match: RegExpExecArray | null
  while ((match = header.exec(raw)) !== null) {
    const objectNumber = Number(match[1])
    const bodyStart = match.index + match[0].length
    const endObj = raw.indexOf('endobj', bodyStart)
    if (endObj === -1) break
    const streamAt = /stream\r?\n/g
    streamAt.lastIndex = bodyStart
    const streamMatch = streamAt.exec(raw)
    if (streamMatch !== null && streamMatch.index < endObj) {
      const dataStart = streamMatch.index + streamMatch[0].length
      const endStream = raw.indexOf('endstream', dataStart)
      if (endStream === -1) break
      const chunk = data.subarray(dataStart, endStream)
      let stream: Buffer
      try {
        stream = zlib.inflateSync(chunk)
      } catch {
        stream = Buffer.from(chunk)
      }
      objects.set(objectNumber, {
        dict: raw.slice(bodyStart, streamMatch.index),
        stream
      })
      header.lastIndex = endStream
    } else {
      objects.set(objectNumber, { dict: raw.slice(bodyStart, endObj) })
      header.lastIndex = endObj
    }
  }
  return objects
}

const utf16FromHex = (hex: string): string => {
  let out = ''
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16))
  }
  return out
}

const cmapFromToUnicode = (stream: string): Map<number, string> => {
  const map = new Map<number, string>()
  for (const section of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(Number.parseInt(entry[1], 16), utf16FromHex(entry[2]))
    }
  }
  for (const section of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const ranges = section[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    )
    for (const entry of ranges) {
      const lo = Number.parseInt(entry[1], 16)
      const hi = Number.parseInt(entry[2], 16)
      const dst = Number.parseInt(entry[3], 16)
      for (let code = lo; code <= hi; code++) {
        map.set(code, String.fromCharCode(dst + (code - lo)))
      }
    }
  }
  return map
}

const extractPdfText = (data: Buffer): string => {
  const objects = parsePdfObjects(data)

  const fontCmaps = new Map<number, Map<number, string>>()
  for (const [objectNumber, object] of objects) {
    const toUnicode = object.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/)
    if (!toUnicode) continue
    const cmapStream = objects.get(Number(toUnicode[1]))?.stream
    if (!cmapStream) continue
    fontCmaps.set(objectNumber, cmapFromToUnicode(cmapStream.toString('latin1')))
  }

  const parts: string[] = []
  for (const object of objects.values()) {
    if (!/\/Type\s*\/Page\b/.test(object.dict)) continue

    let resources = object.dict
    const resourcesRef = object.dict.match(/\/Resources\s+(\d+)\s+0\s+R/)
    if (resourcesRef) {
      resources = objects.get(Number(resourcesRef[1]))?.dict ?? ''
    }
    const fontsByName = new Map<string, Map<number, string>>()
    const fontDict = resources.match(/\/Font\s*<<([\s\S]*?)>>/)
    if (fontDict) {
      for (const entry of fontDict[1].matchAll(/\/([\w.]+)\s+(\d+)\s+0\s+R/g)) {
        const cmap = fontCmaps.get(Number(entry[2]))
        if (cmap) fontsByName.set(entry[1], cmap)
      }
    }

    const contentRefs: number[] = []
    const contentsArray = object.dict.match(/\/Contents\s*\[([\s\S]*?)\]/)
    if (contentsArray) {
      for (const ref of contentsArray[1].matchAll(/(\d+)\s+0\s+R/g)) {
        contentRefs.push(Number(ref[1]))
      }
    } else {
      const single = object.dict.match(/\/Contents\s+(\d+)\s+0\s+R/)
      if (single) contentRefs.push(Number(single[1]))
    }

    for (const ref of contentRefs) {
      const content = objects.get(ref)?.stream?.toString('latin1')
      if (!content) continue
      let cmap: Map<number, string> | undefined
      const decodeHex = (hex: string): string => {
        let out = ''
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          const code = Number.parseInt(hex.slice(i, i + 4), 16)
          out += cmap?.get(code) ?? ''
        }
        return out
      }
      const ops = content.matchAll(
        /\/([\w.]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|\[((?:[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj/g
      )
      for (const op of ops) {
        if (op[1] !== undefined) {
          cmap = fontsByName.get(op[1])
        } else if (op[2] !== undefined) {
          parts.push(decodeHex(op[2]))
        } else if (op[3] !== undefined) {
          for (const shown of op[3].matchAll(/<([0-9A-Fa-f]+)>/g)) {
            parts.push(decodeHex(shown[1]))
          }
        } else if (op[4] !== undefined) {
          parts.push(op[4].replace(/\\([\\()])/g, '$1'))
        }
      }
    }
  }
  return parts.join('')
}

test.describe('hidden Electron PDF generation (item 231)', () => {
  test.describe.configure({ timeout: 60000 })

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(PDF_DOC)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('prints the real editor window to a non-empty PDF artifact', async() => {
    await expect(page.locator('body')).toContainText('Export Smoke')

    const data = await printHiddenEditorToPdf(app, page)

    expect(data.length).toBeGreaterThan(500)
    expect(data.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(data.subarray(-6).toString('latin1')).toContain('%%EOF')
    // The artifact carries the live document's TEXT, not merely valid PDF
    // bytes (an all-blank page also satisfies the byte checks above).
    expect(extractPdfText(data)).toContain('Export Smoke')
  })

  test('can print the same live document repeatedly without presentation UI', async() => {
    const first = await printHiddenEditorToPdf(app, page)
    const second = await printHiddenEditorToPdf(app, page)

    expect(first.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(second.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(second.length).toBeGreaterThan(500)
    expect(second.subarray(-6).toString('latin1')).toContain('%%EOF')
  })
})

const criticRow = CRITIC_MARKUP_CORPUS.find((row) => row.id === 'all-five-canonical-forms')
if (!criticRow) {
  throw new TypeError('Shared CriticMarkup corpus row all-five-canonical-forms is missing.')
}

// Count real page objects in the PDF body. Chromium's Skia PDF writer emits
// page dictionaries uncompressed, and the `\b` keeps `/Type /Pages` (the
// page-tree root) from matching.
const countPdfPages = (data: Buffer): number =>
  (data.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length

test.describe('hidden Electron PDF generation — CriticMarkup projections', () => {
  test.describe.configure({ timeout: 60000 })

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(criticRow.source)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  // Byte-level artifact checks shared by both projections: real %PDF bytes,
  // one rendered page, and the artifact persisted to the test output dir with
  // the exact byte count that came out of the PDF producer.
  const expectPdfArtifact = async(
    data: Buffer,
    artifactName: string
  ): Promise<void> => {
    expect(data.length).toBeGreaterThan(500)
    expect(data.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(data.subarray(-6).toString('latin1')).toContain('%%EOF')
    expect(countPdfPages(data)).toBe(1)
    const artifactPath = test.info().outputPath(artifactName)
    fs.writeFileSync(artifactPath, data)
    expect(fs.statSync(artifactPath).size).toBe(data.length)
    await test.info().attach(artifactName.replace(/\.pdf$/u, ''), {
      path: artifactPath,
      contentType: 'application/pdf'
    })
  }

  test('prints all five Critic forms and the Original projection to distinct PDF artifacts', async() => {
    await expect(page.locator('.editor-component')).toContainText('focus')

    const marked = await printHiddenEditorToPdf(app, page)
    await expectPdfArtifact(marked, 'critic-marked.pdf')

    // Switch the live document to the Original projection through the real
    // Review menu; the printed artifact must follow the projected content.
    await clickMenuById(app, 'reviewShowOriginalMenuItem')
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'data-critic-projection',
      'original'
    )
    await expect(page.locator('.editor-component')).not.toContainText('new')

    const original = await printHiddenEditorToPdf(app, page)
    await expectPdfArtifact(original, 'critic-original.pdf')

    // Content-level projection proof: the Marked artifact renders the
    // addition payload; the Original projection must drop it while keeping
    // the deletion payload visible. The byte check then proves the two
    // artifacts really are distinct PDF outputs.
    const markedText = extractPdfText(marked)
    const originalText = extractPdfText(original)
    expect(markedText).toContain('new')
    expect(markedText).toContain('old')
    expect(originalText).not.toContain('new')
    expect(originalText).toContain('old')
    expect(original.equals(marked)).toBe(false)

    await clickMenuById(app, 'reviewShowMarkedMenuItem')
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'data-critic-projection',
      'marked'
    )
  })
})
