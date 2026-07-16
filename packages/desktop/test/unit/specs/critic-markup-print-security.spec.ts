import { afterEach, describe, expect, it, vi } from 'vitest'

// The desktop PDF/print pipeline is `exportStyledHTML` (whose final trust
// boundary is @muyajs/core's `sanitizeExportHtml`) rendered into the hidden
// print container by the print service (editor.vue `handleExport` →
// `printer.renderMarkdown(html, true)`). These specs capture that FINAL
// sanitized print document for every hostile shared-corpus row and mirror the
// assertions of muya's criticMarkupSecurity.spec.ts through the DESKTOP
// sanitizer entry: script elements, event-handler attributes, and
// javascript:/vbscript:/data: URL schemes are inert while the semantic Critic
// review attributes survive.

// `exportStyledHTML` / the print service reach `window.path` /
// `window.DIRNAME` through the preload bridge for relative-path rewriting.
// Stub those surfaces before the hoisted imports run (mirrors
// exportHtml.spec.ts / printService-image.spec.ts).
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: {
        sep: string
        join?: (...parts: string[]) => string
        resolve?: (...parts: string[]) => string
      }
      DIRNAME?: string
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    join: (...parts: string[]) => parts.join('/'),
    resolve: (...parts: string[]) =>
      parts.join('/').replace(/\/\.\//g, '/').replace(/\/{2,}/g, '/')
  }
  w.window.DIRNAME = '/docs'
})

import { exportStyledHTML } from '@/util/exportHtml'
import MarkdownPrint from '@/services/printService'
import type { ICriticMarkupCorpusRow } from '../../../../muya/src/criticMarkup/__tests__/sharedCorpus'
import { HOSTILE_CRITIC_MARKUP_CORPUS } from '../../../../muya/src/criticMarkup/__tests__/sharedCorpus'

// The export path only reads `muya.options.*` flags, so a bare options bag
// stands in for a Muya instance (same idiom as exportHtml.spec.ts).
const muyaWithOptions = (
  options: Record<string, unknown>
): Parameters<typeof exportStyledHTML>[0] =>
  ({ options } as unknown as Parameters<typeof exportStyledHTML>[0])

// Mirrors the URL-bearing attribute set of muya's criticMarkupSecurity.spec.ts.
const URL_ATTRIBUTES = new Set([
  'action',
  'formaction',
  'href',
  'poster',
  'src',
  'xlink:href'
])

const renderFinalPrintDocument = async(
  row: ICriticMarkupCorpusRow,
  projection?: 'original' | 'revised'
): Promise<HTMLElement> => {
  const html = await exportStyledHTML(
    muyaWithOptions(
      projection
        ? { ...row.options, criticMarkupProjection: projection }
        : { ...row.options }
    ),
    row.source,
    { printOptimization: true }
  )
  // Production hands the complete exported document string to the print
  // service; assert against what actually lands in the print container.
  new MarkdownPrint().renderMarkdown(html, true)
  const container = document.body.querySelector<HTMLElement>('article.print-container')
  if (!container) {
    throw new TypeError('The print service did not append its print container.')
  }
  return container
}

const removePrintContainers = (): void => {
  document.body
    .querySelectorAll('article.print-container')
    .forEach((node) => node.remove())
}

const expectInertPrintDocument = (root: HTMLElement): void => {
  expect(root.querySelector('script')).toBeNull()
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      expect(name).not.toMatch(/^on/)
      expect(name).not.toBe('srcdoc')
      if (URL_ATTRIBUTES.has(name)) {
        const compactValue = attribute.value
          .split('')
          .filter((character) => character.charCodeAt(0) > 0x20)
          .join('')
          .toLowerCase()
        expect(compactValue).not.toMatch(/^(?:javascript|vbscript|data):/)
      }
    }
  }
}

const expectCriticSemantics = (root: HTMLElement, row: ICriticMarkupCorpusRow): void => {
  const items = new Map<string, { type: string; start: number; end: number }>()

  for (const element of root.querySelectorAll<HTMLElement>('[data-critic-id]')) {
    expect(element.dataset.criticId).toMatch(/^critic-\d+-\d+$/)
    expect(element.dataset.criticRole).toMatch(/^(?:only|start|middle|end)$/)
    expect(element.dataset.criticType).toBeTruthy()
    const start = Number(element.dataset.start)
    const end = Number(element.dataset.end)
    expect(Number.isInteger(start)).toBe(true)
    expect(Number.isInteger(end)).toBe(true)
    expect(end).toBeGreaterThan(start)

    const id = element.dataset.criticId as string
    const summary = { type: element.dataset.criticType as string, start, end }
    expect(items.get(id) ?? summary).toEqual(summary)
    items.set(id, summary)
  }

  expect(
    [...items.values()]
      .sort((left, right) => left.start - right.start)
      .map((item) => item.type)
  ).toEqual(row.expected.itemTypes)
  expect(items.size).toBe(row.expected.itemRaw.length)
}

describe('desktop print pipeline — hostile CriticMarkup final-sink security', () => {
  afterEach(() => {
    removePrintContainers()
  })

  it('covers every semantic Critic form with hostile final-sink input', () => {
    expect(
      new Set(HOSTILE_CRITIC_MARKUP_CORPUS.flatMap((row) => row.expected.itemTypes))
    ).toEqual(new Set(['addition', 'deletion', 'substitution', 'highlight', 'comment']))
  })

  it.each(HOSTILE_CRITIC_MARKUP_CORPUS)(
    'keeps $id inert with Critic semantics intact in the final print document',
    async(row) => {
      expect(row.expected.mustBeInert).toBe(true)

      const marked = await renderFinalPrintDocument(row)
      expectInertPrintDocument(marked)
      expectCriticSemantics(marked, row)

      // The projected exports drop the semantic wrappers by design, so only
      // inertness is asserted there (mirrors muya's security suite).
      for (const projection of ['original', 'revised'] as const) {
        removePrintContainers()
        const projected = await renderFinalPrintDocument(row, projection)
        expectInertPrintDocument(projected)
      }
    }
  )
})
