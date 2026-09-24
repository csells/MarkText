// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Upstream renders same-line `$$…$$` (and the display backslash forms) in
// display mode only in a paragraph holding nothing but such formulas (#4904,
// #5446); the Core-bound view must present the parser's math the same way.
describe('Core math presentation', () => {
  it.each([
    { source: '$$x^2$$\n', display: [true] },
    { source: 'a $$x^2$$ b\n', display: [false] },
    { source: '$$a$$ $$b$$\n', display: [true, true] },
    { source: '$a$\n', display: [false] }
  ])('decides display mode for $source', ({ source, display }) => {
    const app = bootBoundMuya(source)
    try {
      const nodes = [...app.muya.domNode.querySelectorAll('.mu-math')]
      expect(nodes.map((node) => node.classList.contains('mu-display-math'))).toEqual(display)
    } finally {
      app.dispose()
    }
  })

  it('renders the backslash delimiters only with their option', () => {
    const on = bootBoundMuya('\\[x\\] and \\(y\\)\n', { texMathSingleBackslash: true })
    const off = bootBoundMuya('\\[x\\] and \\(y\\)\n')
    try {
      expect(on.muya.domNode.querySelectorAll('.mu-math')).toHaveLength(2)
      expect(off.muya.domNode.querySelectorAll('.mu-math')).toHaveLength(0)
    } finally {
      on.dispose()
      off.dispose()
    }
  })
})
