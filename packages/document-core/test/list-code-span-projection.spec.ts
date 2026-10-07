import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

// A backtick string pairs with the next one of its length, as CommonMark
// reads it. A suggestion holding a backtick in one list item once paired the
// first item's code span opener with the last item's closer when the views
// were written, lengthening both, and the oracle then rejected every narrow
// spelling of a key typed beside them.

describe('code spans beside a suggestion holding a backtick in a list', () => {
  it('projects each item\'s code span as written', () => {
    for (const [source, revised] of [
      ['- a `c1` w\n- {~~`x`~>`y`~~} v\n- b `c2` w\n', '- a `c1` w\n- `y` v\n- b `c2` w\n'],
      ['- a `c1` w\n- t {++`x`++} v\n- b `c2` w\n', '- a `c1` w\n- t `x` v\n- b `c2` w\n']
    ] as const) {
      const core = createDocumentCore()
      const revision = core.open(source)
      expect(core.project(revision, 'revised').markdown).toBe(revised)
      expect(core.project(revision, 'original').markdown).toContain('`c1` w')
      expect(core.project(revision, 'original').markdown).toContain('`c2` w')
    }
  })
})
