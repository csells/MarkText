// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { Content, MaybeContent } from '../helpers/muyaTypes'

type End = { name: string; text: string; offset: number; nth?: number }
// Cross-block cuts ending in or starting from tables and code blocks follow
// upstream's structure-preserving cut (#5405, #5400, #5399, #5398, #5385,
// #5371, #5368, #4903, #5148). Native Muya is the oracle; it rewrites the
// whole document, so the model's source is compared after that rewrite.
const scenarios: Array<{ id: string; source: string; from: End; to: End }> = [
  { id: 't1', source: '- a\n\n  | h |\n  | --- |\n  | 1 |\n\nafter\n\nmore\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'table.cell.content', text: '1', offset: 0 } },
  { id: 't2', source: '- a\n\n> | h |\n> | --- |\n> | 1 |\n\nafter\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'table.cell.content', text: '1', offset: 0 } },
  { id: 't3', source: '- a\n- b\n\n| h |\n| --- |\n| 12 |\n| 34 |\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'table.cell.content', text: '12', offset: 1 } },
  { id: 't4', source: '- a\n\n| h |\n| --- |\n| 1 |\n\ntail\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'table.cell.content', text: '1', offset: 1 } },
  { id: 't5', source: '- a\n\n> | h |\n> | --- |\n> | 1 |\n\ntail\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'table.cell.content', text: '1', offset: 1 } },
  { id: 't6', source: '- a\n\n| h |\n| --- |\n| 1 |\n\ntail\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'table.cell.content', text: '1', offset: 0 } },
  { id: 't7', source: '| a1 | b1 |\n| --- | --- |\n| c1 | d1 |\n', from: { name: 'table.cell.content', text: 'a1', offset: 1 }, to: { name: 'table.cell.content', text: 'd1', offset: 1 } },
  { id: 't8', source: '- a\n\n| h |\n| --- |\n| 1 |\n\ntail\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'paragraph.content', text: 'tail', offset: 1 } },
  { id: 'c1', source: '- a\n- b\n- c\n\ntail\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'paragraph.content', text: 'tail', offset: 1 } },
  { id: 'c2', source: '> a\n>\n> b\n\ntail\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'paragraph.content', text: 'tail', offset: 1 } },
  { id: 'c3', source: '- a\n  - x\n  - y\n- b\n\ntail\n', from: { name: 'paragraph.content', text: 'x', offset: 1 }, to: { name: 'paragraph.content', text: 'tail', offset: 1 } },
  { id: 'c4', source: '- a\n\n  more\n\n  ```js\n  code\n  ```\n\n- b\n\ntail\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'paragraph.content', text: 'tail', offset: 1 } },
  { id: 'c5', source: '- a\n  - nested\n- c\n', from: { name: 'paragraph.content', text: 'a', offset: 1 }, to: { name: 'paragraph.content', text: 'c', offset: 1 } },
  { id: 'c7', source: '- a\n\n  ```js\n  code\n  ```\n\n  more\n\n- b\n\ntail\n', from: { name: 'language-input', text: 'js', offset: 1 }, to: { name: 'paragraph.content', text: 'tail', offset: 1 } },
  { id: 'l1', source: 'Intro paragraph\n\n```js\ncode\n```\n\nOutro\n', from: { name: 'paragraph.content', text: 'Intro paragraph', offset: 3 }, to: { name: 'language-input', text: 'js', offset: 1 } },
  { id: 'l2', source: 'intro\n\n- item\n\n  ```js\n  code\n  ```\n\n  tail\n', from: { name: 'paragraph.content', text: 'intro', offset: 2 }, to: { name: 'language-input', text: 'js', offset: 0 } },
  { id: 'l3', source: 'Intro\n\n```js\ncode\n```\n', from: { name: 'paragraph.content', text: 'Intro', offset: 5 }, to: { name: 'language-input', text: 'js', offset: 2 } },
  { id: 'l4', source: '```js\na\n```\n\nmid\n\n```py\nb\n```\n', from: { name: 'language-input', text: 'js', offset: 1 }, to: { name: 'language-input', text: 'py', offset: 1 } },
  { id: 'n1', source: '- item one\n\n  ```js\n  const a = 1\n  ```\n\n- item two\n', from: { name: 'language-input', text: 'js', offset: 1 }, to: { name: 'codeblock.content', text: 'const a = 1', offset: 3 } },
  { id: 'n2', source: '> quote\n>\n> ```js\n> code\n> ```\n>\n> tail\n', from: { name: 'language-input', text: 'js', offset: 0 }, to: { name: 'codeblock.content', text: 'code', offset: 2 } },
  { id: 'n3', source: '- item one\n\n  ```js\n  const a = 1\n  ```\n\n- item two\n\nafter\n', from: { name: 'language-input', text: 'js', offset: 1 }, to: { name: 'paragraph.content', text: 'after', offset: 2 } },
  { id: 'n4', source: 'before\n\n```js\nconst a = 1\n```\n\nafter\n', from: { name: 'language-input', text: 'js', offset: 1 }, to: { name: 'codeblock.content', text: 'const a = 1', offset: 3 } },
  { id: 'k1', source: 'intro\n\n- item\n\n  ```js\n  code\n  ```\n\n  tail\n', from: { name: 'paragraph.content', text: 'intro', offset: 2 }, to: { name: 'codeblock.content', text: 'code', offset: 2 } },
  { id: 'k2', source: 'intro\n\n> quote\n>\n> $$\n> a+b\n> $$\n>\n> tail\n', from: { name: 'paragraph.content', text: 'intro', offset: 2 }, to: { name: 'codeblock.content', text: 'a+b', offset: 1 } },
  { id: 'k3', source: 'intro\n\n- item\n\n  <div>\n  hi\n  </div>\n\n  tail\n', from: { name: 'paragraph.content', text: 'intro', offset: 2 }, to: { name: 'codeblock.content', text: 'div', offset: 5 } },
  { id: 'k4', source: '```js\nconst x = 1\n```\n\nhello world\n', from: { name: 'language-input', text: 'js', offset: 1 }, to: { name: 'codeblock.content', text: 'const x = 1', offset: 3 } },
  { id: 'k5', source: 'intro\n\n```js\nconst x = 1\n```\n', from: { name: 'language-input', text: 'js', offset: 1 }, to: { name: 'codeblock.content', text: 'const x = 1', offset: 3 } }
]

const leaves = (muya: Muya) => {
  const found: Content[] = []
  for (let block: MaybeContent = muya.editor.scrollPage?.firstContentInDescendant(); block != null; block = block.nextContentInContext()) found.push(block)
  return found
}
const find = (muya: Muya, end: End) => {
  const block = leaves(muya).filter((b) => b.blockName === end.name && b.text.includes(end.text))[end.nth ?? 0]
  if (!block) throw new Error('no ' + end.name + ' ' + end.text)
  return block
}
const cut = async(muya: Muya, from: End, to: End, settle: () => Promise<void>) => {
  const a = find(muya, from)
  const f = find(muya, to)
  const host = muya.domNode as HTMLElement
  host.tabIndex = -1
  host.focus()
  muya.editor.selection.setSelection({ block: a, path: a.path, offset: from.offset }, { block: f, path: f.path, offset: to.offset })
  const data = new Map<string, string>()
  const event = new Event('cut', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', files: [], items: [] } })
  a.domNode!.dispatchEvent(event)
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    muya.flush()
    await settle()
  }
}

it.each(scenarios)('$id', async(s) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host, { markdown: s.source, math: true } as ConstructorParameters<typeof Muya>[1])
  muya.init()
  let native: string
  try {
    await cut(muya, s.from, s.to, async() => {})
    native = muya.getMarkdown()
  } finally {
    muya.destroy()
    host.remove()
  }
  const app = bootBoundMuya(s.source)
  let bound = ''
  let err = ''
  let normalized = ''
  try {
    await cut(app.muya, s.from, s.to, () => app.adapter.settled())
    const r = app.binding.sourceAtBarrier()
    bound = r.type === 'source' ? r.source : 'ERR'
    const h2 = document.body.appendChild(document.createElement('div'))
    const norm = new Muya(h2, { markdown: bound, math: true } as ConstructorParameters<typeof Muya>[1])
    norm.init()
    normalized = norm.getMarkdown()
    norm.destroy(); h2.remove()
  } catch (e) {
    err = String(e)
  } finally {
    app.dispose()
  }
  expect(err).toBe('')
  expect([bound, normalized]).toContain(native)
})
