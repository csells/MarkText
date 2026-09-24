// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { Content } from '../helpers/muyaTypes'

type Step = (muya: Muya) => void
interface Scenario { name: string, source: string, block?: string, text: string, offset?: number | 'end', steps: Step[] }

const up = (type: string): Step => (muya) => muya.updateParagraph(type)
const ins = (location: 'before' | 'after'): Step => (muya) => muya.insertParagraph(location)
const table: Step = (muya) => muya.createTable({ rows: 2, columns: 2 })

const TABLE = '| a | b |\n| --- | --- |\n|  | 2 |\n'
const CODE = '```js\ncode\n```\n'
const scenarios: Scenario[] = [
  { name: '4944 cell h1', source: TABLE, block: 'table.cell.content', text: '2', steps: [up('heading 1')] },
  { name: '4944 empty cell pre', source: TABLE, block: 'table.cell.content', text: '', steps: [up('pre')] },
  { name: '4944 cell paragraph', source: TABLE, block: 'table.cell.content', text: 'a', steps: [up('paragraph')] },
  { name: '4944 code h1', source: CODE, block: 'codeblock.content', text: 'code', steps: [up('heading 1')] },
  { name: '4944 code paragraph', source: CODE, block: 'codeblock.content', text: 'code', steps: [up('paragraph')] },
  { name: '4944 code pre', source: CODE, block: 'codeblock.content', text: 'code', steps: [up('pre')] },
  { name: '4944 code reset', source: CODE, block: 'codeblock.content', text: 'code', steps: [up('reset-to-paragraph')] },
  { name: '4944 lang h1', source: '```\ncode\n```\n', block: 'language-input', text: '', steps: [up('heading 1')] },
  { name: '4944 math ul', source: '$$\na+b\n$$\n', block: 'codeblock.content', text: 'a+b', steps: [up('ul-bullet')] },
  { name: '4944 html hr', source: '<div>\nhi\n</div>\n', block: 'codeblock.content', text: '<div>\nhi\n</div>', steps: [up('hr')] },
  { name: '4944 html blockquote', source: '<div>\nhi\n</div>\n', block: 'codeblock.content', text: '<div>\nhi\n</div>', steps: [up('blockquote')] },
  { name: '4944 code blockquote', source: CODE, block: 'codeblock.content', text: 'code', steps: [up('blockquote')] },
  { name: '4944 cell blockquote', source: TABLE, block: 'table.cell.content', text: '2', steps: [up('blockquote')] },
  { name: '4944 code ol', source: CODE, block: 'codeblock.content', text: 'code', steps: [up('ol-order')] },
  { name: '4944 cell ul', source: TABLE, block: 'table.cell.content', text: '2', steps: [up('ul-bullet')] },
  { name: '4944 math math', source: '$$\na+b\n$$\n', block: 'codeblock.content', text: 'a+b', steps: [up('mathblock')] },
  { name: '4944 cell insert after', source: TABLE, block: 'table.cell.content', text: '2', steps: [ins('after')] },
  { name: '4944 code insert before', source: CODE, block: 'codeblock.content', text: 'code', steps: [ins('before')] },
  { name: '4944 fm insert before+after', source: '---\ntitle: x\n---\n\nbody\n', block: 'codeblock.content', text: 'title: x', steps: [ins('before'), ins('after')] },
  { name: '4944 table after empty first cell', source: '|  | b |\n| --- | --- |\n| 1 | 2 |\n', block: 'table.cell.content', text: '1', steps: [table] },
  { name: '4944 table after langless code', source: '```\ncode\n```\n', block: 'codeblock.content', text: 'code', steps: [table] },
  { name: '4944 e2e cell', source: '| a | b |\n| --- | --- |\n| 1 | 2 |\n', block: 'table.cell.content', text: '2', offset: 'end', steps: [up('heading 1'), ins('after')] },
  { name: '4944 e2e code', source: CODE, block: 'codeblock.content', text: 'code', offset: 'end', steps: [up('heading 1'), ins('before')] },
  { name: '5366 h1', source: 'Line one\nline two\n\nafter\n', text: 'Line one\nline two', offset: 3, steps: [up('heading 1')] },
  { name: '5366 upgrade', source: 'Line one\nline two\n\nafter\n', text: 'Line one\nline two', offset: 3, steps: [up('upgrade heading')] },
  { name: '5366 setext upgrade', source: 'Line one\nline two\n---\n\nafter\n', text: 'Line one\nline two', offset: 3, steps: [up('upgrade heading')] },
  { name: '5366 h3', source: 'one\ntwo\nthree\n\nafter\n', text: 'one\ntwo\nthree', offset: 3, steps: [up('heading 3')] },
  { name: '5362 s2 up', source: 'Title\n---\n\nafter\n', text: 'Title', offset: 2, steps: [up('upgrade heading')] },
  { name: '5362 s2 down', source: 'Title\n---\n\nafter\n', text: 'Title', offset: 2, steps: [up('degrade heading')] },
  { name: '5362 s1 down', source: 'Title\n===\n\nafter\n', text: 'Title', offset: 2, steps: [up('degrade heading')] },
  { name: '5362 s1 up', source: 'Title\n===\n\nafter\n', text: 'Title', offset: 2, steps: [up('upgrade heading')] },
  { name: '5360 list up', source: '- item one\n- item two\n', text: 'item two', offset: 4, steps: [up('upgrade heading')] },
  { name: '5360 list up down', source: '- item one\n- item two\n', text: 'item two', offset: 'end', steps: [up('upgrade heading'), up('degrade heading')] },
  { name: '5360 list heading down', source: '- item one\n- ## item two\n', text: '## item two', steps: [up('degrade heading')] },
  { name: '5360 quote up', source: '> quote line\n>\n> second\n', text: 'second', steps: [up('upgrade heading')] },
  { name: '5360 nested up', source: '1. one\n2. two\n   - nested\n', text: 'nested', steps: [up('upgrade heading')] },
  { name: '5360 table', source: '| a | b |\n| --- | --- |\n| 1 | 2 |\n', block: 'table.cell.content', text: '2', steps: [up('upgrade heading'), up('degrade heading')] },
  { name: '5360 code', source: CODE, block: 'codeblock.content', text: 'code', steps: [up('upgrade heading'), up('degrade heading')] },
  { name: '5360 math', source: '$$\na+b\n$$\n', block: 'codeblock.content', text: 'a+b', steps: [up('upgrade heading'), up('degrade heading')] },
  { name: '5360 fm', source: '---\ntitle: x\n---\n\nbody\n', block: 'codeblock.content', text: 'title: x', steps: [up('upgrade heading'), up('degrade heading')] },
  { name: '5360 text up', source: 'text\n', text: 'text', steps: [up('upgrade heading')] },
  { name: '5360 ## up', source: '## Two\n', text: '## Two', steps: [up('upgrade heading')] },
  { name: '5360 ###### down', source: '###### Six\n', text: '###### Six', steps: [up('degrade heading')] }
]

const find = (muya: Muya, s: Scenario): Content => {
  let block: Content | null | undefined = muya.editor.scrollPage?.firstContentInDescendant()
  while (block && !((s.block === undefined || block.blockName === s.block) && block.text === s.text)) block = block.nextContentInContext() ?? null
  if (!block) throw new Error('no block ' + s.text)
  return block
}
const run = (muya: Muya, s: Scenario): string => {
  try {
    const block = find(muya, s)
    const offset = s.offset === 'end' ? s.text.length : s.offset ?? 0
    block.setCursor(offset, offset, true)
    for (const step of s.steps) step(muya)
    const sel = muya.getSelection()
    const anchor = muya.editor.selection.getSelection()?.anchor
    return JSON.stringify({ sel: sel ? [sel.anchor.offset, sel.focus.offset] : null, leaf: anchor ? [anchor.block.blockName, anchor.block.text] : null })
  } catch (error) {
    return 'THROW ' + (error instanceof Error ? error.message : String(error))
  }
}

// Upstream's paragraph commands act on the whole table or code-like block
// (#4944), join a multi-line block into one heading line (#5366), keep a
// setext heading's level (#5362) and change the caret's own block (#5360).
// The model-backed path must leave the same document as native Muya, compared
// after native Muya's own rewrite of the model's source (or byte for byte).
it.each(scenarios)('matches native paragraph commands: $name', (s) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const options = { math: true, frontMatter: true } as ConstructorParameters<typeof Muya>[1]
  const host = document.body.appendChild(document.createElement('div'))
  const native = new Muya(host, { ...options, markdown: s.source })
  native.init()
  run(native, s)
  native.flush()
  const expected = native.getMarkdown()
  native.destroy()
  host.remove()
  const app = bootBoundMuya(s.source)
  try {
    run(app.muya, s)
    const saved = app.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected acknowledged source')
    const normalizedHost = document.body.appendChild(document.createElement('div'))
    const normalized = new Muya(normalizedHost, { ...options, markdown: saved.source })
    normalized.init()
    const rewritten = normalized.getMarkdown()
    normalized.destroy()
    normalizedHost.remove()
    // A trailing empty paragraph is the extra blank line native Muya writes;
    // rewriting the model's source cannot keep it, so compare it separately.
    const trailingEmpty = (text: string) => /\n\n\n$/u.test(text)
    expect([saved.source, rewritten, rewritten.trimEnd() + '\n\n\n']).toContain(expected)
    expect(trailingEmpty(saved.source)).toBe(trailingEmpty(expected))
  } finally {
    app.dispose()
  }
})
