// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { Content, MaybeContent } from '../helpers/muyaTypes'

const leaves = (muya: Muya): Content[] => {
  const found: Content[] = []
  for (let block: MaybeContent = muya.editor.scrollPage?.firstContentInDescendant(); block != null; block = block.nextContentInContext()) found.push(block)
  return found
}
const find = (muya: Muya, text: string, nth = 0) => {
  const leaf = leaves(muya).filter(block => block.text === text)[nth]
  if (!leaf) throw new Error('no leaf ' + text + ' in ' + JSON.stringify(leaves(muya).map(b => b.text)))
  return leaf
}
type Step = { text: string, nth?: number, start: number, end?: number, key?: string, input?: string, data?: string, shift?: boolean } | { type: 'setText', text: string, value: string, caret: number }

const act = (muya: Muya, bound: boolean, step: Step) => {
  if ('type' in step) {
    const leaf = find(muya, step.text)
    leaf.text = step.value
    leaf.setCursor(step.caret, step.caret, true)
    return
  }
  const leaf = find(muya, step.text, step.nth)
  muya.editor.activeContentBlock = leaf
  leaf.setCursor(step.start, step.end ?? step.start, true)
  if (step.key) {
    const event = new KeyboardEvent('keydown', { key: step.key, shiftKey: step.shift ?? false, bubbles: true, cancelable: true })
    leaf.domNode!.dispatchEvent(event)
    if (bound && !event.defaultPrevented && step.input) {
      const live = muya.editor.selection.getSelection()?.anchor.block
      live?.domNode?.dispatchEvent(new InputEvent('beforeinput', { inputType: step.input, data: step.data ?? null, bubbles: true, cancelable: true }))
    }
  } else if (!bound && step.input === 'insertLineBreak') {
    leaf.domNode!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
  } else if (!bound && step.input === 'insertParagraph') {
    leaf.domNode!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  } else if (step.input) {
    leaf.domNode!.dispatchEvent(new InputEvent('beforeinput', { inputType: step.input, data: step.data ?? null, bubbles: true, cancelable: true }))
  }
  muya.flush()
}

const scenarios: Array<{ name: string, source: string, steps: Step[] }> = [
  { name: '5423 quote origin', source: 'a\n\n> p\n>\n> q\n', steps: [{ text: 'a', start: 1, key: 'Delete' }] },
  { name: '5423 nested quote', source: '- a\n\n  > p\n  >\n  > q\n', steps: [{ text: 'a', start: 1, key: 'Delete' }] },
  { name: '5423 quote in quote', source: '> a\n>\n> > p\n> >\n> > q\n', steps: [{ text: 'a', start: 1, key: 'Delete' }] },
  { name: '5423 task sublist', source: '- [ ] a\n- [ ] C\n  - D\n', steps: [{ text: 'a', start: 1, key: 'Delete' }] },
  { name: '5386 table then two paragraphs', source: '| x | y |\n| - | - |\n| 1 | 2 |\n\np\n\nq\n', steps: [{ text: '2', start: 1, key: 'Delete' }] },
  { name: '5386 list table', source: '- a\n\n  | x | y |\n  | - | - |\n  | 1 | 2 |\n- b\n  - c\n', steps: [{ text: '2', start: 1, key: 'Delete' }] },
  { name: '5388 atx space', source: '# Heading\n', steps: [{ text: '# Heading', start: 2, key: 'Backspace', input: 'deleteContentBackward' }] },
  { name: '5388 atx level', source: '## Heading\n', steps: [{ text: '## Heading', start: 1, key: 'Backspace', input: 'deleteContentBackward' }] },
  { name: '5035 setext', source: '- one\n- two\n\nHeading\n---\n', steps: [{ text: 'Heading', start: 0, key: 'Backspace' }] },
  { name: '5300 end twice', source: 'abc\n', steps: [{ text: 'abc', start: 3, input: 'insertLineBreak' }, { text: 'abc\n', start: 4, input: 'insertLineBreak' }] },
  { name: '5300 before def', source: 'abc\ndef\n', steps: [{ text: 'abc\ndef', start: 4, input: 'insertLineBreak' }] },
  { name: '5300 caret before soft break', source: 'abc\ndef\n', steps: [{ text: 'abc\ndef', start: 3, input: 'insertLineBreak' }] },
  { name: '5300 start', source: 'abc\n', steps: [{ text: 'abc', start: 0, input: 'insertLineBreak' }] },
  { name: '5300 selection', source: 'abc\ndef\n', steps: [{ text: 'abc\ndef', start: 4, end: 6, input: 'insertLineBreak' }] },
  { name: '5300 list', source: '- abc\n', steps: [{ text: 'abc', start: 3, input: 'insertLineBreak' }, { text: 'abc\n', start: 4, input: 'insertLineBreak' }] },
  { name: '5300 list several', source: '- abc\n\n  def\n', steps: [{ text: 'def', start: 3, input: 'insertLineBreak' }, { text: 'def\n', start: 4, input: 'insertLineBreak' }] },
  { name: '5300 quote', source: '> abc\n', steps: [{ text: 'abc', start: 3, input: 'insertLineBreak' }, { text: 'abc\n', start: 4, input: 'insertLineBreak' }] },
  { name: '5300 setext', source: 'Title\n===\n', steps: [{ text: 'Title', start: 5, input: 'insertLineBreak' }, { text: 'Title\n', start: 6, input: 'insertLineBreak' }] },
  { name: '5300 hard break spaces', source: 'abc  \ndef\n', steps: [{ text: 'abc  \ndef', start: 6, input: 'insertLineBreak' }] },
  { name: '5300 hard break backslash', source: 'abc\\\ndef\n', steps: [{ text: 'abc\\\ndef', start: 5, input: 'insertLineBreak' }] },
  { name: '4926 code backspace', source: '```js\n// ship \u{1F680}\n```\n', steps: [{ text: '// ship \u{1F680}', start: 10, key: 'Backspace', input: 'deleteContentBackward' }] },
  { name: '4926 code skin', source: '```js\n// ok \u{1F44D}\u{1F3FD}\n```\n', steps: [{ text: '// ok \u{1F44D}\u{1F3FD}', start: 10, key: 'Backspace', input: 'deleteContentBackward' }] },
  { name: '4926 para family', source: '\u{1F468}‍\u{1F469}‍\u{1F467}abc\n', steps: [{ text: '\u{1F468}‍\u{1F469}‍\u{1F467}abc', start: 8, key: 'Backspace', input: 'deleteContentBackward' }] },
  { name: '4926 para before strong', source: '\u{1F604}**b**\n', steps: [{ text: '\u{1F604}**b**', start: 2, key: 'Backspace', input: 'deleteContentBackward' }] },
]

// Upstream's native editing is the oracle (#5423, #5386, #5388, #5035, #5300,
// #4926): the model-backed path must leave the same document. Native Muya
// rewrites the whole document, so the model's source is compared after that
// rewrite, or byte for byte where the rewrite cannot keep an empty paragraph.
// Cases whose native run depends on browser default editing are left out.
it.each(scenarios)('matches native editing: $name', ({ source, steps }) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const native = new Muya(host, { markdown: source })
  native.init()
  let expected: string
  try {
    for (const step of steps) act(native, false, step)
    expected = native.getMarkdown()
  } finally {
    native.destroy()
    host.remove()
  }
  const app = bootBoundMuya(source)
  try {
    for (const step of steps) act(app.muya, true, step)
    const reply = app.binding.sourceAtBarrier()
    if (reply.type !== 'source') throw new Error('Expected acknowledged source')
    const normalizedHost = document.body.appendChild(document.createElement('div'))
    const normalized = new Muya(normalizedHost, { markdown: reply.source })
    normalized.init()
    try {
      expect([reply.source, normalized.getMarkdown()]).toContain(expected)
    } finally {
      normalized.destroy()
      normalizedHost.remove()
    }
  } finally {
    app.dispose()
  }
})
