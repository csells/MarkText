/**
 * Seeded Markdown differential: document-core against micromark (CommonMark
 * 0.31.2) and marked (the parser upstream MarkText's Muya uses).
 *
 *   pnpm --filter @marktext/document-core differential \
 *     [--count 6000] [--seed 1] [--out <dir>] [--no-minimize]
 *     [--source <markdown> ...]   (renders only the given documents)
 *
 * Every generated document is rendered by all three in a CommonMark run (GFM
 * off) and a GFM run (tables, task items and strikethrough on; GFM autolink
 * literals, tag filtering and footnotes off in every parser). Core renders
 * through the public projection consumer that
 * commonmark-upstream-parity.spec.ts uses. A differing run is classified as:
 *
 *   a      micromark and marked agree and Core differs: a Core defect.
 *   b-*    marked differs from micromark. Profile 1 keeps upstream's reading
 *          or a recorded §2.2 ruling, so these are counted by the side Core
 *          takes: b-marked, b-micromark or b-neither.
 *   error  a renderer threw.
 *
 * Class a, b-neither and error documents are shrunk line- and
 * character-wise while they keep their class, and grouped by the result.
 * marked's HTML stands in for upstream: Muya's own post-processing of
 * marked's tokens (an empty bullet task item, for one) is not modelled.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { decodeHTML, decodeHTMLAttribute } from 'entities'
import { Marked } from 'marked'
import { micromark } from 'micromark'
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough'
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table'
import { gfmTaskListItem, gfmTaskListItemHtml } from 'micromark-extension-gfm-task-list-item'

import { createDocumentCore } from '../../src/index.js'
import { renderPublicMarkdownProjectionToHtml } from '../support/publicMarkdownHtmlConsumer.js'

type Run = 'commonmark' | 'gfm'
type DiffClass = 'a' | 'b-marked' | 'b-micromark' | 'b-neither'

interface Rendered {
  readonly core: string
  readonly micromark: string
  readonly marked: string
}

// A small, dependency-free PRNG keeps a seed reproducible across Node versions.
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Generator {
  private readonly random: () => number

  constructor(seed: number) {
    this.random = mulberry32(seed)
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1))
  }

  chance(probability: number): boolean {
    return this.random() < probability
  }

  pick<T>(values: readonly T[]): T {
    const value = values[this.int(0, values.length - 1)]
    if (value === undefined) throw new Error('pick from an empty list')
    return value
  }

  spaces(max: number): string {
    return ' '.repeat(this.int(0, max))
  }

  // Inline content avoids bare URLs, `$`, `^`, `:` and single `~` so that
  // extensions only one parser enables (GFM autolink literals, math,
  // emoji, sub/superscript) cannot differ.
  word(): string {
    return this.pick([
      'foo', 'bar', 'baz', 'alpha', 'beta', 'x', 'y', 'q', 'Foo', 'text',
      '*em*', '**strong**', '_em_', '__strong__', '***both***', '*a **b** c*',
      '`code`', '``a ` b``', '[link](/url)', '[link](/url "title")', '[ref]',
      '[ref][]', '[text][ref]', '![img](/i.png)', '<http://a.example>',
      '<span>', '</span>', '\\*', '\\#', '&amp;', '&copy;', '&#35;', 'a*b',
      '*', '_', '**', '`', '[', ']', '<', '>', '&', '|', '#', '-', '+', '1.',
      '~~del~~', 'foo_bar_baz', '"quote"', "it's"
    ])
  }

  text(): string {
    const words: string[] = []
    const count = this.int(1, 4)
    for (let i = 0; i < count; i += 1) words.push(this.word())
    let line = words.join(' ')
    if (this.chance(0.08)) line += '  '
    else if (this.chance(0.05)) line += '\\'
    return line
  }

  listMarker(): string {
    return this.pick(['-', '*', '+', '1.', '2.', '1)', '3)', '10.', '0.'])
  }

  // One source line, possibly with container prefixes.
  line(): string {
    const prefix = this.chance(0.25)
      ? this.pick(['> ', '>', '> > ', '>  ', ' > '])
      : ''
    const indent = this.chance(0.35) ? this.spaces(6) : ''
    const kind = this.int(0, 21)
    let body: string
    switch (kind) {
      case 0:
      case 1:
      case 2:
      case 3:
        body = this.text()
        break
      case 4:
        body = `${'#'.repeat(this.int(1, 7))}${this.chance(0.85) ? ' ' : ''}${this.chance(0.8) ? this.text() : ''}${this.chance(0.15) ? ' ##' : ''}`
        break
      case 5:
        body = this.pick(['=', '==', '===', '-', '--', '---', '- -', '= ='])
        break
      case 6:
        body = this.pick(['***', '* * *', '___', '---', '- - -', '_ _ _', '****'])
        break
      case 7:
      case 8:
      case 9: {
        const marker = this.listMarker()
        const gap = this.pick(['', ' ', ' ', ' ', '  ', '   ', '     '])
        const content = gap === '' || this.chance(0.15) ? '' : this.text()
        body = `${marker}${gap}${content}`
        break
      }
      case 10:
        body = `${this.pick(['- ', '* ', '1. '])}${this.pick(['[ ]', '[x]', '[X]', '[ ]  '])}${this.chance(0.85) ? ` ${this.text()}` : ''}`
        break
      case 11:
        body = this.pick(['```', '```js', '~~~', '````', '``` a b', '~~~~'])
        break
      case 12:
        body = `    ${this.text()}`
        break
      case 13:
        body = this.pick([
          '<div>', '</div>', '<div class="a">', '<!-- c -->', '<!--', '-->',
          '<pre>', '</pre>', '<p>x</p>', '<table>', '<custom-tag>', '<?php x ?>',
          '<![CDATA[x]]>', '<span>x</span>', '<del>', '<script>', '</script>'
        ])
        break
      case 14:
        body = this.pick([
          '[ref]: /url', '[ref]: /url "title"', '[ref]: <a b>', '[Ref]:\n/url',
          '[foo]: /foo', '[ref]:', "[ref]: /url 'title'", '[ref]: /url (t)'
        ])
        break
      case 15:
      case 16:
        body = this.pick([
          '| a | b |', '| a |', 'a | b', '|---|---|', '|:--|--:|', '| --- |',
          '--- | ---', '|-|-|', '| x | y | z |', '|---|', '| \\| | b |'
        ])
        break
      case 17:
        body = `${this.listMarker()} ${this.listMarker()} ${this.text()}`
        break
      case 18:
        body = `${this.listMarker()} > ${this.text()}`
        break
      case 19:
        body = `> ${this.listMarker()} ${this.text()}`
        break
      case 20:
        body = this.pick(['\t', '\tcode', ' \t', '  ', ''])
        break
      default:
        body = ''
    }
    return `${prefix}${indent}${body}`
  }

  lineSoup(): string {
    const lines: string[] = []
    const count = this.int(1, 8)
    for (let i = 0; i < count; i += 1) {
      lines.push(this.chance(0.18) ? '' : this.line())
    }
    return `${lines.join('\n')}${this.chance(0.9) ? '\n' : ''}`
  }

  // Whole blocks, optionally nested inside containers.
  block(depth = 0): string[] {
    const kind = this.int(0, depth < 2 ? 11 : 8)
    switch (kind) {
      case 0: {
        const lines = [this.text()]
        while (this.chance(0.4)) lines.push((this.chance(0.3) ? this.spaces(3) : '') + this.text())
        return lines
      }
      case 1:
        return [`${'#'.repeat(this.int(1, 6))} ${this.text()}`]
      case 2:
        return [this.text(), this.pick(['===', '---', '=', '-'])]
      case 3:
        return [this.pick(['***', '---', '___'])]
      case 4: {
        const fence = this.pick(['```', '~~~'])
        const lines = [`${fence}${this.chance(0.4) ? 'js' : ''}`]
        const count = this.int(0, 3)
        for (let i = 0; i < count; i += 1) lines.push(this.chance(0.2) ? '' : this.line())
        if (this.chance(0.85)) lines.push(fence)
        return lines
      }
      case 5: {
        const lines = [`    ${this.text()}`]
        while (this.chance(0.4)) lines.push(this.chance(0.3) ? '' : `    ${this.text()}`)
        return lines
      }
      case 6: {
        const lines = [this.pick(['<div>', '<!--', '<pre>', '<table>', '<custom-tag>'])]
        const count = this.int(0, 2)
        for (let i = 0; i < count; i += 1) lines.push(this.line())
        if (this.chance(0.7)) lines.push(this.pick(['</div>', '-->', '</pre>', '</table>', '']))
        return lines
      }
      case 7:
        return [this.pick(['[ref]: /url', '[ref]: /url "title"', '[text]: <a b>']), this.text()]
      case 8: {
        const columns = this.int(1, 3)
        const row = (): string => `| ${Array.from({ length: columns }, () => this.pick(['a', 'b', '*x*', '`c`', ''])).join(' | ')} |`
        const lines = [row(), `|${Array.from({ length: columns }, () => this.pick(['---', ':--', '--:', ':-:'])).join('|')}|`]
        const count = this.int(0, 3)
        for (let i = 0; i < count; i += 1) lines.push(this.chance(0.8) ? row() : this.line())
        return lines
      }
      case 9:
      case 10: {
        const marker = this.listMarker()
        const lines: string[] = []
        const items = this.int(1, 3)
        let ordinal = Number.parseInt(marker, 10)
        for (let item = 0; item < items; item += 1) {
          const spelled = Number.isNaN(ordinal) ? marker : `${String(ordinal)}${marker.slice(-1)}`
          ordinal += 1
          const gap = this.pick([' ', ' ', '  ', '   '])
          const contentIndent = ' '.repeat(spelled.length + gap.length)
          const task = this.chance(0.15) ? `${this.pick(['[ ]', '[x]'])} ` : ''
          const inner = this.blocks(depth + 1, 2)
          const [first = '', ...rest] = inner
          lines.push(`${spelled}${gap}${task}${first}`.trimEnd())
          for (const line of rest) {
            const indent = this.chance(0.85) ? contentIndent : this.spaces(contentIndent.length + 1)
            lines.push(line === '' ? '' : `${indent}${line}`)
          }
          if (this.chance(0.3)) lines.push('')
        }
        return lines
      }
      default: {
        const inner = this.blocks(depth + 1, 2)
        return inner.map(line => (this.chance(0.9) ? `>${line === '' ? '' : ' '}${line}` : line))
      }
    }
  }

  blocks(depth: number, max: number): string[] {
    const lines: string[] = []
    const count = this.int(1, max)
    for (let i = 0; i < count; i += 1) {
      if (i > 0 && this.chance(0.6)) lines.push('')
      lines.push(...this.block(depth))
    }
    return lines
  }

  document(): string {
    if (this.chance(0.5)) return this.lineSoup()
    return `${this.blocks(0, 4).join('\n')}\n`
  }
}

const CORE_OPTIONS = {
  gfmTagFilter: false,
  gfmAutolinks: false,
  frontMatter: false,
  texMathDollars: false,
  texMathGfm: false,
  footnotes: false,
  subscriptAndSuperscript: false
} as const

const renderCore = (source: string, run: Run): string => {
  const core = createDocumentCore()
  const revision = core.open(source, { ...CORE_OPTIONS, gfm: run === 'gfm' })
  return renderPublicMarkdownProjectionToHtml(core.project(revision, 'original'))
}

const renderMicromark = (source: string, run: Run): string => micromark(source, {
  allowDangerousHtml: true,
  allowDangerousProtocol: true,
  ...(run === 'gfm'
    ? {
      extensions: [gfmTable(), gfmStrikethrough(), gfmTaskListItem()],
      htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml(), gfmTaskListItemHtml()]
    }
    : {})
})

const markedParsers: Record<Run, Marked> = {
  commonmark: new Marked({ gfm: false }),
  gfm: new Marked({ gfm: true })
}

const renderMarked = (source: string, run: Run): string =>
  markedParsers[run].parse(source, { async: false })

// Renderers spell the same HTML differently (`<hr>` / `<hr />`, `&#39;` /
// `'`, attribute order, a newline after raw HTML or a task checkbox), so
// each tag is respelled canonically, text is decoded and re-escaped, and
// whitespace next to a tag is dropped. Raw HTML is not parsed into a DOM:
// an unclosed tag must not restructure the markup around it.
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/gu
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu

const escapeText = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const canonicalTag = (closing: string, name: string, attributes: string): string => {
  const pairs = [...attributes.matchAll(ATTRIBUTE)].map(match => {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    return ` ${(match[1] ?? '').toLowerCase()}="${escapeText(decodeHTMLAttribute(value))}"`
  }).sort()
  return `<${closing}${name.toLowerCase()}${pairs.join('')}>`
}

const canonicalHtml = (html: string): string => {
  let result = ''
  let last = 0
  const text = (value: string): string => escapeText(decodeHTML(value)).replace(/\s+/gu, ' ')
  for (const match of html.matchAll(TAG)) {
    result += `${text(html.slice(last, match.index)).trimEnd()}\uE000`
    result += canonicalTag(match[1] ?? '', match[2] ?? '', match[3] ?? '')
    result += '\uE000'
    last = match.index + match[0].length
  }
  result += text(html.slice(last))
  return result.replace(/\uE000\s*/gu, '').trim()
}

const render = (source: string, run: Run): Rendered => ({
  core: canonicalHtml(renderCore(source, run)),
  micromark: canonicalHtml(renderMicromark(source, run)),
  marked: canonicalHtml(renderMarked(source, run))
})

const classify = (rendered: Rendered): DiffClass | undefined => {
  if (rendered.micromark === rendered.marked) {
    return rendered.core === rendered.micromark ? undefined : 'a'
  }
  if (rendered.core === rendered.marked) return 'b-marked'
  if (rendered.core === rendered.micromark) return 'b-micromark'
  return 'b-neither'
}

const safeClassify = (source: string, run: Run): DiffClass | 'error' | undefined => {
  try {
    return classify(render(source, run))
  } catch {
    return 'error'
  }
}

// Greedy delta debugging over lines, then characters, keeping the class.
const minimize = (source: string, run: Run, target: DiffClass | 'error'): string => {
  const keeps = (candidate: string): boolean => safeClassify(candidate, run) === target
  let current = source
  let changed = true
  while (changed) {
    changed = false
    const lines = current.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const candidate = [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n')
      if (candidate !== current && keeps(candidate)) {
        current = candidate
        changed = true
        break
      }
    }
    if (changed) continue
    for (let index = 0; index < current.length; index += 1) {
      const candidate = current.slice(0, index) + current.slice(index + 1)
      if (keeps(candidate)) {
        current = candidate
        changed = true
        break
      }
    }
  }
  return current
}

interface Finding {
  readonly index: number
  readonly run: Run
  readonly diffClass: DiffClass | 'error'
  readonly source: string
  readonly minimized?: string
  readonly rendered?: Rendered
}

const main = (): void => {
  const { values } = parseArgs({
    options: {
      count: { type: 'string', default: '6000' },
      seed: { type: 'string', default: '1' },
      out: { type: 'string' },
      'no-minimize': { type: 'boolean', default: false },
      source: { type: 'string', multiple: true }
    }
  })
  if (values.source !== undefined) {
    for (const source of values.source) {
      for (const run of ['commonmark', 'gfm'] as const) {
        const rendered = render(source, run)
        process.stdout.write(`[${classify(rendered) ?? 'same'} ${run}] ${JSON.stringify(source)}\n` +
          `  core      ${rendered.core}\n  micromark ${rendered.micromark}\n  marked    ${rendered.marked}\n`)
      }
    }
    return
  }
  const count = Number.parseInt(values.count, 10)
  const seed = Number.parseInt(values.seed, 10)
  const generator = new Generator(seed)
  const findings: Finding[] = []
  const differingDocuments = new Set<number>()
  const tally: Record<Run, Record<string, number>> = { commonmark: {}, gfm: {} }

  for (let index = 0; index < count; index += 1) {
    const source = generator.document()
    for (const run of ['commonmark', 'gfm'] as const) {
      let rendered: Rendered | undefined
      let diffClass: DiffClass | 'error' | undefined
      try {
        rendered = render(source, run)
        diffClass = classify(rendered)
      } catch {
        diffClass = 'error'
      }
      if (diffClass === undefined) continue
      differingDocuments.add(index)
      tally[run][diffClass] = (tally[run][diffClass] ?? 0) + 1
      const minimized = !values['no-minimize'] && (diffClass === 'a' || diffClass === 'b-neither' || diffClass === 'error')
        ? minimize(source, run, diffClass)
        : undefined
      findings.push({
        index,
        run,
        diffClass,
        source,
        ...(minimized === undefined ? {} : { minimized }),
        ...(rendered === undefined ? {} : { rendered })
      })
    }
  }

  const groups = new Map<string, { diffClass: string, run: Run, minimized: string, count: number, rendered: Rendered | undefined }>()
  for (const finding of findings) {
    if (finding.minimized === undefined) continue
    const key = `${finding.run}\uE000${finding.diffClass}\uE000${finding.minimized}`
    const group = groups.get(key)
    if (group) group.count += 1
    else {
      let rendered: Rendered | undefined
      try {
        rendered = render(finding.minimized, finding.run)
      } catch {
        rendered = undefined
      }
      groups.set(key, { diffClass: finding.diffClass, run: finding.run, minimized: finding.minimized, count: 1, rendered })
    }
  }

  const summary = {
    seed,
    documents: count,
    differingDocuments: differingDocuments.size,
    byRun: tally,
    minimizedGroups: [...groups.values()].sort((left, right) => right.count - left.count)
  }

  if (values.out) {
    const out = resolve(values.out)
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    writeFileSync(join(out, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`)
  }

  process.stdout.write(`seed ${String(seed)}, ${String(count)} documents, ${String(differingDocuments.size)} differ\n`)
  for (const run of ['commonmark', 'gfm'] as const) {
    process.stdout.write(`${run}: ${JSON.stringify(tally[run])}\n`)
  }
  for (const group of summary.minimizedGroups) {
    process.stdout.write(`\n[${group.diffClass} ${group.run} x${String(group.count)}] ${JSON.stringify(group.minimized)}\n`)
    if (group.rendered) {
      process.stdout.write(`  core      ${group.rendered.core}\n`)
      process.stdout.write(`  micromark ${group.rendered.micromark}\n`)
      process.stdout.write(`  marked    ${group.rendered.marked}\n`)
    }
  }
}

main()
