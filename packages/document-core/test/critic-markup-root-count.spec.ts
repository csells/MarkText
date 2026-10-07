import { describe, expect, it } from 'vitest'
import { parseProfile1Document, profile1CriticMarkupRootCount } from '../src/internal/profile1Document.js'
import type { ExecutionBudgetId } from '../src/revision.js'

const budget: ExecutionBudgetId = Object.freeze({
  limitsProfile: 'desktop-v1',
  accountingSchema: 'syntax-accounting-1'
})

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
      const whole = parseProfile1Document(source, budget)
      expect(whole.kind, source).toBe('complete')
      if (whole.kind !== 'complete') continue
      expect(profile1CriticMarkupRootCount(source, budget), source)
        .toBe(whole.criticMarkup.rootCount)
    }
  })

  it('as none where the parse fails before projecting', () => {
    const source = `${'>'.repeat(200)} {++deep++}\n`
    expect(parseProfile1Document(source, budget).kind).toBe('source-only')
    expect(profile1CriticMarkupRootCount(source, budget)).toBeUndefined()
  })
})
