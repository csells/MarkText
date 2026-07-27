import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  groupRenderLines,
  renderMarkupPlan,
  type ParseConfiguration
} from '@marktext/document-core'
import { completeSnapshot } from '../helpers/completeSnapshot.js'

/**
 * Integration vertical slice, increment 2 — line grouping.
 *
 * The Markup projection is a flat run stream whose text carries literal
 * newlines; a contenteditable view cannot mount a run containing `\n`. This
 * splits the render runs into lines at newline boundaries, preserving each
 * run's CriticMarkup marks and its model/source mapping across the split — so a
 * mark spanning a newline stays on both halves. Markdown *block* rendering
 * (headings, lists) is the view's job, fed by the preserved model↔source map;
 * this only provides line structure, which every editing view needs.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

async function linesFor(source: string) {
  const session = await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
    initialView: 'markup',
    trackChanges: false,
    initialSelection: {
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 0, affinity: 'next' }
    }
  })
  return groupRenderLines(renderMarkupPlan(completeSnapshot(session).livePlan))
}

describe('markup line grouping', () => {
  it('keeps a single-line document as one non-terminated line', async() => {
    const lines = await linesFor('a{++new++}b')
    expect(lines.map((l) => l.endsWithNewline)).toEqual([false])
    expect(lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['anewb'])
  })

  it('splits a run that spans a newline, preserving its mark on both halves', async() => {
    // '{++a\nb++}' → one addition run 'a\nb' (model 0-3). After splitting, 'a'
    // and 'b' are on separate lines and BOTH keep the addition element.
    const lines = await linesFor('{++a\nb++}')
    expect(lines).toEqual([
      {
        endsWithNewline: true,
        modelRange: { start: 0, end: 1 },
        runs: [
          expect.objectContaining({ text: 'a', elements: ['ins'], modelRange: { start: 0, end: 1 } })
        ]
      },
      {
        endsWithNewline: false,
        modelRange: { start: 2, end: 3 },
        runs: [
          expect.objectContaining({ text: 'b', elements: ['ins'], modelRange: { start: 2, end: 3 } })
        ]
      }
    ])
  })

  it('emits an empty line for a blank line between blocks', async() => {
    // '# Title\n\nHello ' → lines: '# Title', '', 'Hello ' (+ trailing).
    const lines = await linesFor('# Title\n\nHello {++world++}.\n')
    const texts = lines.map((l) => l.runs.map((r) => r.text).join(''))
    expect(texts).toEqual(['# Title', '', 'Hello world.', ''])
    // '# Title' is one run; the blank line and trailing line have none;
    // 'Hello {++world++}.' is three runs ('Hello ', ins 'world', '.').
    expect(lines.map((l) => l.runs.length)).toEqual([1, 0, 3, 0])
  })

  it('reproduces the model text exactly across all lines and newlines', async() => {
    const lines = await linesFor('# Title\n\nHello {++world++}.\n')
    const reconstructed = lines
      .map((l) => l.runs.map((r) => r.text).join(''))
      .join('\n')
    // Joining line contents with '\n' must reproduce the model text (newlines
    // are the line terminators, not run content).
    expect(reconstructed).toBe('# Title\n\nHello world.\n')
  })
})
