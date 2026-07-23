import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  markupRenderElement,
  renderMarkupPlan,
  type MarkupMark,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Integration vertical slice, increment 1 — the render adapter.
 *
 * A WYSIWYG view cannot consume `MarkupLiveRenderPlan.runs` directly: it needs
 * to know which HTML-ish element each run's CriticMarkup marks map to
 * (addition → <ins>, deletion → <del>, highlight → <mark>, substitution arms →
 * <del>/<ins>). `renderMarkupPlan` is the first, pure, DOM-free line of that
 * view layer — it turns the engine's plan into a structure a view mounts.
 * This is the first thing that consumes the engine toward a real editor.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('markup render adapter — mark → element', () => {
  it('maps each CriticMarkup mark to its editing-view element', () => {
    const cases: readonly [MarkupMark, string][] = [
      [{ kind: 'addition' }, 'ins'],
      [{ kind: 'deletion' }, 'del'],
      [{ kind: 'highlight' }, 'mark'],
      [{ kind: 'substitution', arm: 'old' }, 'del'],
      [{ kind: 'substitution', arm: 'new' }, 'ins']
    ]
    for (const [mark, element] of cases) {
      expect(markupRenderElement(mark)).toBe(element)
    }
  })
})

describe('markup render adapter — renderMarkupPlan', () => {
  it('renders a plan run stream into element-wrapped render runs', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('a{++new++}b'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      }
    })

    const rendered = renderMarkupPlan(session.snapshot().livePlan)

    expect(rendered.map((run) => ({ text: run.text, elements: run.elements }))).toEqual([
      { text: 'a', elements: [] },
      { text: 'new', elements: ['ins'] },
      { text: 'b', elements: [] }
    ])
    // The adapter must preserve the model↔source mapping the view needs for
    // selection and editing — it maps, it does not discard.
    // 'new' sits at source offsets 4-7 in 'a{++new++}b' (a=0, {++=1-4, new=4-7).
    expect(rendered[1]).toMatchObject({
      modelRange: { start: 1, end: 4 },
      sourceRange: { start: 4, end: 7 }
    })
    // Every run carries a stable key for view diffing.
    expect(new Set(rendered.map((run) => run.key)).size).toBe(rendered.length)
  })
})
