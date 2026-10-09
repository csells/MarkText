import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { checkReadingWindows, inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

// A key whose reading can change far beyond its own lines, as one that breaks
// a fence, derives its spelling from the change it makes to the document's
// reading (owner decision, 8 October 2026). The change is read off a parse
// of the edited document from a block before the key, where that parse
// provably reads as the whole document does, and off a whole parse
// otherwise. With the check on, both are read and must agree.
const fence = (text: string) => '```js\n' + text + '\n```'
interface Key { readonly name: string, readonly source: string, readonly at: string, readonly insert: string, readonly remove?: number }
const keys: readonly Key[] = [
  { name: 'a fence opener losing a backtick', source: `Intro words.\n\nSecond para.\n\n${fence('const a = 1')}\n\nAfter the fence.\n\n${fence('more')}\n\nTail.\n`, at: '```js\nconst a', insert: '', remove: 1 },
  { name: 'a quote marker at a line start', source: 'Intro words.\n\nFirst line\nsecond line\n\n- item\n- item\n\nTail.\n', at: 'First line', insert: '>' },
  { name: 'a math opener a fence hides the closer of', source: 'Lead.\n\n$$\na\n\nmid words\n\n```\n$$\n```\n\nend\n', at: '```\n$$', insert: '', remove: 1 },
  { name: 'a blank line typed after a table', source: 'Lead.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nnext `x` line\n\nTail.\n', at: '\nnext', insert: '`' },
  { name: 'a key after a list', source: 'Lead words.\n\n- one\n- two\n\nKey line here.\n\n```\ncode\n```\n\nTail.\n', at: 'Key line', insert: '```' }
]

const typed = (checked: boolean, source: string, at: string, insert: string, remove = 0) => {
  checkReadingWindows(checked)
  const core = createDocumentCore()
  const opened = core.open(source)
  const start = source.indexOf(at)
  if (start < 0) throw new Error(`No ${at} in the source`)
  const before = inspectDocumentCore(core).documentParseSourceUnits
  const edit = core.trackedEdit(opened, { start, end: start + remove, insert })
  return { edit, units: inspectDocumentCore(core).documentParseSourceUnits - before }
}

describe('a key\'s reading change read off a window', () => {
  afterEach(() => checkReadingWindows(false))

  it.each(keys)('is the whole document\'s for $name', ({ source, at, insert, remove }) => {
    // The check throws where the two readings differ.
    expect(typed(true, source, at, insert, remove).edit).toEqual(typed(false, source, at, insert, remove).edit)
  })

  it('spares the whole parse of the edited document', () => {
    const { source, at, insert, remove } = keys[0]!
    expect(typed(false, source, at, insert, remove).units).toBeLessThan(typed(true, source, at, insert, remove).units)
  })
})
