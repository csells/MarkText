import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as zlib from 'node:zlib'
import { CRITIC_MARKUP_CORPUS } from '../fixtures/profile1Adversarial'
import { clickMenuById, launchWithMarkdown } from './helpers'

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
// Chromium's Skia PDF producer Flate-compresses page content streams and font
// ToUnicode CMaps, and shows text as hex glyph strings (`<...> Tj`) encoded
// with per-subset glyph ids. Inflate every stream, build the glyph->unicode
// map from the bfchar/bfrange CMap entries, and decode every shown string so
// specs can assert on the rendered TEXT of an artifact rather than raw bytes.

const inflatedPdfStreams = (data: Buffer): string[] => {
  const raw = data.toString('latin1')
  const streams: string[] = []
  const streamKeyword = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = streamKeyword.exec(raw)) !== null) {
    // Skip the `stream` inside `endstream`.
    if (match.index >= 3 && raw.slice(match.index - 3, match.index) === 'end') continue
    const dataStart = match.index + match[0].length
    const endAt = raw.indexOf('endstream', dataStart)
    if (endAt === -1) break
    const chunk = data.subarray(dataStart, endAt)
    try {
      streams.push(zlib.inflateSync(chunk).toString('latin1'))
    } catch {
      streams.push(chunk.toString('latin1'))
    }
    streamKeyword.lastIndex = endAt
  }
  return streams
}

const utf16FromHex = (hex: string): string => {
  let out = ''
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16))
  }
  return out
}

const glyphToUnicodeMap = (streams: string[]): Map<number, string> => {
  const map = new Map<number, string>()
  for (const stream of streams) {
    if (!stream.includes('beginbfchar') && !stream.includes('beginbfrange')) continue
    const charSections = stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)
    for (const section of charSections) {
      for (const entry of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(Number.parseInt(entry[1], 16), utf16FromHex(entry[2]))
      }
    }
    const rangeSections = stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)
    for (const section of rangeSections) {
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
  }
  return map
}

const extractPdfText = (data: Buffer): string => {
  const streams = inflatedPdfStreams(data)
  const cmap = glyphToUnicodeMap(streams)
  const decodeHex = (hex: string): string => {
    let out = ''
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      const code = Number.parseInt(hex.slice(i, i + 4), 16)
      out += cmap.get(code) ?? ''
    }
    return out
  }
  const parts: string[] = []
  for (const stream of streams) {
    if (!/\bT[Jj]\b/.test(stream)) continue
    // Hex-string shows: `<...> Tj` and TJ arrays of hex strings.
    for (const shown of stream.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      parts.push(decodeHex(shown[1]))
    }
    for (const array of stream.matchAll(/\[((?:[^\]])*)\]\s*TJ/g)) {
      for (const shown of array[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
        parts.push(decodeHex(shown[1]))
      }
    }
    // Literal-string shows (simple fonts): `(...) Tj`.
    for (const shown of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      parts.push(shown[1].replace(/\\([\\()])/g, '$1'))
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
    if (app) await app.close()
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
    if (app) await app.close()
  })

  // Byte-level artifact checks shared by both projections: real %PDF bytes,
  // one rendered page, and the artifact persisted to the test output dir with
  // the exact byte count that came out of the PDF producer.
  const expectPdfArtifact = (data: Buffer, artifactName: string): void => {
    expect(data.length).toBeGreaterThan(500)
    expect(data.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(data.subarray(-6).toString('latin1')).toContain('%%EOF')
    expect(countPdfPages(data)).toBe(1)
    const artifactPath = test.info().outputPath(artifactName)
    fs.writeFileSync(artifactPath, data)
    expect(fs.statSync(artifactPath).size).toBe(data.length)
  }

  test('prints all five Critic forms and the Original projection to distinct PDF artifacts', async() => {
    await expect(page.locator('.editor-component')).toContainText('focus')

    const marked = await printHiddenEditorToPdf(app, page)
    expectPdfArtifact(marked, 'critic-marked.pdf')

    // Switch the live document to the Original projection through the real
    // Review menu; the printed artifact must follow the projected content.
    await clickMenuById(app, 'reviewShowOriginalMenuItem')
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'data-critic-projection',
      'original'
    )
    await expect(page.locator('.editor-component')).not.toContainText('new')

    const original = await printHiddenEditorToPdf(app, page)
    expectPdfArtifact(original, 'critic-original.pdf')

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
