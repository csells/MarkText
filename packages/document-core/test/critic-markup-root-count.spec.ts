import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKDOWN_OPTIONS,
  parseProfile1Document,
  parseProfile1ReaderViews,
  profile1CriticMarkupRootCount
} from '../src/internal/profile1Document.js'
import type { ExecutionBudgetId } from '../src/revision.js'

const budget: ExecutionBudgetId = Object.freeze({
  limitsProfile: 'desktop-v1'
})
const options = Object.freeze({ ...DEFAULT_MARKDOWN_OPTIONS, subscriptAndSuperscript: true })

const sources = [
  'plain text\n',
  'a {++b++} c {--d--} e {~~f~>g~~} h\n',
  '{--old--}{++new++}\n',
  '{~~a {++nested++} b~>c~~}\n',
  '`{++code++}` {++real++}\n',
  '```js\n{++fenced++}\n```\n\n{--after--}\n',
  '``>`js\nconst a = 0\n```\n\n{=={--gone--}==}{>>only deleted<<} tail.\n',
  'a {++unterminated\n\nb {--closed--}\n',
  '{++a\n\n- item {--b--}\n- item `c` {++d++}\n',
  '$$\nx {++y++}\n$$\n\n$a {++b++}$ {++c++}\n'
]

describe('the intrinsic pass counts a parse\'s root annotations', () => {
  it('as the whole parse holds them', () => {
    for (const source of sources) {
      const whole = parseProfile1Document(source, budget, options)
      expect(whole.kind, source).toBe('complete')
      if (whole.kind !== 'complete') continue
      expect(profile1CriticMarkupRootCount(source, budget, options), source)
        .toBe(whole.criticMarkup.rootCount)
    }
  })

  it('as none where the parse fails before projecting', () => {
    const source = `${'>'.repeat(200)} {++deep++}\n`
    expect(parseProfile1Document(source, budget, options).kind).toBe('source-only')
    expect(profile1CriticMarkupRootCount(source, budget, options)).toBeUndefined()
  })
})

describe('reader views read a parse as its whole parse does', () => {
  const projection = (view: { source: string }) => view.source
  it('in their annotations, diagnostics and Original and Revised projections', () => {
    for (const source of sources) {
      const whole = parseProfile1Document(source, budget, options)
      const reader = parseProfile1ReaderViews(source, budget, options)
      expect(whole.kind, source).toBe('complete')
      expect(reader.kind, source).toBe('reader')
      if (whole.kind !== 'complete' || reader.kind !== 'reader') continue
      expect(reader.criticMarkup.rootCount, source).toBe(whole.criticMarkup.rootCount)
      expect(reader.diagnostics.count, source).toBe(whole.diagnostics.count)
      expect(projection(reader.original), source).toBe(projection(whole.original))
      expect(projection(reader.revised), source).toBe(projection(whole.revised))
    }
  })

  it('and fail where the whole parse fails', () => {
    const source = `${'>'.repeat(200)} {++deep++}\n`
    expect(parseProfile1ReaderViews(source, budget, options).kind).toBe('source-only')
  })
})
