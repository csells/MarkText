// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { Content } from '../helpers/muyaTypes'

type Step = { text: string; key: 'Tab' | 'ShiftTab' | 'Backspace' | 'Enter'; offset?: number | 'end' }
// Enter at the start of a first nested item is left out: native Muya rewrites
// that sublist with `*` bullets, while the model keeps the author's `-`; both
// parse to the same empty item.
const scenarios: Array<{ name: string; source: string; steps: Step[]; footnote?: boolean }> = [
  { name: '5349 task after bullet sub', source: '- [ ] a\n  - b\n- [ ] c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: '5349 plain after task sub', source: '- a\n  - [ ] b\n- c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: '5349 ordered after task sub', source: '1. a\n   - [ ] b\n2. c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: '5349 checked + next', source: '- [ ] a\n  - b\n- [x] c\n- [ ] d\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }, { text: 'd', key: 'Tab', offset: 'end' }] },
  { name: '5349 loose', source: '- [ ] a\n\n  - b\n\n- [ ] c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: '5349 same kind', source: '- a\n  - b\n- c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: '5349 task no sub', source: '- [ ] a\n- [ ] c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: '5341 task out of bullet', source: '- a\n  - [ ] b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 checked', source: '- a\n  - [x] b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 tail items', source: '- a\n  - [ ] b\n- c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 ordered numbering', source: '1. a\n   - [ ] b\n2. c\n3. d\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 plain out of task', source: '- [ ] a\n  - b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 joins following task', source: '- a\n  - [ ] b\n- [ ] x\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 different marker', source: '- a\n  * [ ] b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 siblings + trailing', source: '- a\n  - [ ] b\n  - [ ] d\n\n  c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5341 same kind ordered', source: '1. a\n   - b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 two-level quote', source: '- a\n\n  > > q\n', steps: [{ text: 'q', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 two-level quote task', source: '- [ ] a\n\n  > > q\n', steps: [{ text: 'q', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 two-level quote nested item', source: '- a\n  - b\n\n    > > q\n', steps: [{ text: 'q', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 quote list quote', source: '> - a\n>\n>   > > q\n', steps: [{ text: 'q', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 footnote in quote in item', source: '- a\n\n  > [^1]: note\n', steps: [{ text: 'note', key: 'ShiftTab', offset: 'end' }], footnote: true },
  { name: '5342 single quote', source: '- a\n\n  > q\n', steps: [{ text: 'q', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 nested bullet', source: '- a\n  - b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 nested ordered', source: '1. a\n   1. b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 nested task', source: '- [ ] a\n  - [ ] b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 trailing paragraph', source: '- a\n  - b\n\n  c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '5342 replacement', source: '- - b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '4899 trailing', source: '- a\n\n  - b\n\n  c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 1 }] },
  { name: '4899 siblings + trailing', source: '- a\n\n  - b\n\n  - d\n\n  c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 1 }] },
  { name: '5343 bs after paragraph', source: 'x\n\n[^1]: note\n', steps: [{ text: 'note', key: 'Backspace', offset: 0 }], footnote: true },
  { name: '5343 bs first block', source: '[^1]: note\n', steps: [{ text: 'note', key: 'Backspace', offset: 0 }], footnote: true },
  { name: '5343 bs multi paragraph', source: 'x\n\n[^1]: note\n\n    more\n', steps: [{ text: 'note', key: 'Backspace', offset: 0 }], footnote: true },
  { name: '5343 bs later paragraph', source: 'x\n\n[^1]: note\n\n    more\n', steps: [{ text: 'more', key: 'Backspace', offset: 0 }], footnote: true },
  { name: '5343 enter at start', source: 'x\n\n[^1]: note\n', steps: [{ text: 'note', key: 'Enter', offset: 0 }], footnote: true },
  { name: '5340 bs in item', source: '- a\n\n  [^1]: note\n', steps: [{ text: 'note', key: 'Backspace', offset: 0 }], footnote: true },
  { name: '5340 bs in task item', source: '- [ ] a\n\n  [^1]: note\n', steps: [{ text: 'note', key: 'Backspace', offset: 0 }], footnote: true },
  { name: '5340 bs in quote', source: '> a\n>\n> [^1]: note\n>\n>     more\n', steps: [{ text: 'note', key: 'Backspace', offset: 0 }], footnote: true },
  { name: '5340 enter in item', source: '- a\n\n  [^1]: note\n', steps: [{ text: 'note', key: 'Enter', offset: 0 }], footnote: true },
  { name: 'keep bs quote in item', source: '- a\n\n  > q\n', steps: [{ text: 'q', key: 'Backspace', offset: 0 }] },
  { name: 'keep bs item in quote', source: '> - a\n>\n>   c\n', steps: [{ text: 'c', key: 'Backspace', offset: 0 }] },
  { name: 'keep bs quote list', source: '> - a\n', steps: [{ text: 'a', key: 'Backspace', offset: 0 }] },
  { name: 'keep bs nested item', source: '- a\n  - b\n', steps: [{ text: 'b', key: 'Backspace', offset: 0 }] },
  { name: 'keep enter quote in item', source: '- a\n\n  > q\n', steps: [{ text: 'q', key: 'Enter', offset: 0 }] },
  { name: 'keep enter item in quote', source: '> - a\n>\n>   c\n', steps: [{ text: 'c', key: 'Enter', offset: 0 }] },
  { name: 'L same kind loose', source: '- a\n\n  - b\n\n- c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: 'L no sub loose', source: '- a\n\n- c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: 'L task loose loose sub', source: '- [ ] a\n\n  - b\n\n  - b2\n\n- [ ] c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: 'L task diff marker sub', source: '- [ ] a\n  * b\n- [ ] c\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: 'L task after bullet sub mid', source: '- [ ] a\n  - b\n- [ ] c\n- [ ] d\n', steps: [{ text: 'c', key: 'Tab', offset: 'end' }] },
  { name: 'L noop trailing', source: '- a\n  - b\n\n  c\n', steps: [] },
  { name: 'L noop siblings trailing', source: '- a\n  - [ ] b\n  - [ ] d\n\n  c\n', steps: [] },
  { name: 'L outdent ordered task tail', source: '1. a\n   - [ ] b\n   - [ ] e\n2. c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: 'L outdent plain out of task tail', source: '- [ ] a\n  - b\n- [ ] c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: 'L outdent ordered out of task', source: '- [ ] a\n  1. x\n  2. b\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: 'L outdent loose', source: '- a\n\n  - [ ] b\n\n- c\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: 'F enter end', source: 'x\n\n[^1]: note\n', steps: [{ text: 'note', key: 'Enter', offset: 'end' }], footnote: true },
  { name: 'F enter mid', source: 'x\n\n[^1]: note\n', steps: [{ text: 'note', key: 'Enter', offset: 2 }], footnote: true },
  { name: 'F enter second para', source: '[^1]: note\n\n    more\n', steps: [{ text: 'more', key: 'Enter', offset: 2 }], footnote: true },
  { name: 'F enter mid item', source: '- a\n\n  [^1]: note\n', steps: [{ text: 'note', key: 'Enter', offset: 2 }], footnote: true },
  { name: 'F enter quote', source: '> [^1]: note\n', steps: [{ text: 'note', key: 'Enter', offset: 2 }], footnote: true },
  { name: '4772 tab repeated markers', source: '1. a\n1. b\n1. c\n', steps: [{ text: 'b', key: 'Tab', offset: 'end' }] },
  { name: '4772 outdent repeated', source: '1. a\n   1. b\n   1. c\n1. d\n', steps: [{ text: 'b', key: 'ShiftTab', offset: 'end' }] },
  { name: '4772 tab keeps other list', source: '1. x\n1. y\n\ntext\n\n- a\n- b\n', steps: [{ text: 'b', key: 'Tab', offset: 'end' }] }
]

const find = (muya: Muya, text: string): Content => {
  let block = muya.editor.scrollPage?.firstContentInDescendant() ?? null
  while (block && block.text !== text) block = block.nextContentInContext() ?? null
  if (!block) throw new Error('missing ' + text)
  return block
}
const press = (muya: Muya, step: Step) => {
  const block = find(muya, step.text)
  const offset = step.offset === 'end' ? block.text.length : step.offset ?? 0
  block.setCursor(offset, offset, true)
  muya.editor.activeContentBlock = block
  if (step.key === 'Enter' || step.key === 'Backspace') {
    const handled = !block.domNode!.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true, cancelable: true }))
    if (!handled) {
      block.domNode!.dispatchEvent(new InputEvent('beforeinput', { inputType: step.key === 'Enter' ? 'insertParagraph' : 'deleteContentBackward', bubbles: true, cancelable: true }))
    }
  } else {
    block.domNode!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: step.key === 'ShiftTab', bubbles: true, cancelable: true }))
  }
}
const caret = (muya: Muya) => {
  const s = muya.getSelection() as { anchor?: { offset: number }, anchorPath?: unknown } | null
  return s ? `${JSON.stringify(s.anchorPath)}@${s.anchor?.offset}` : 'none'
}

// Upstream's native list and footnote editing (#5349, #5341, #5342, #4899,
// #5340, #5343, #4772) is the oracle: the model-backed desktop path must
// produce the same document and caret. Native Muya rewrites the whole
// document, so the model's source is compared after the same rewrite, or
// byte for byte where that rewrite cannot keep an empty paragraph.
describe('list and footnote editing parity with native Muya', () => {
  it.each(scenarios)('$name', (scenario) => {
    ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
    const options = { markdown: scenario.source, footnote: scenario.footnote === true } as ConstructorParameters<typeof Muya>[1]
    const host = document.body.appendChild(document.createElement('div'))
    const native = new Muya(host, options)
    native.init()
    let expected: string
    let expectedCaret: string
    try {
      for (const step of scenario.steps) press(native, step)
      native.flush()
      expected = native.getMarkdown()
      expectedCaret = caret(native)
    } finally {
      native.destroy()
      host.remove()
    }
    const app = bootBoundMuya(scenario.source, scenario.footnote ? { footnotes: true } : undefined)
    try {
      for (const step of scenario.steps) press(app.muya, step)
      const boundCaret = caret(app.muya)
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected acknowledged source')
      const normalizedHost = document.body.appendChild(document.createElement('div'))
      const normalized = new Muya(normalizedHost, { ...options, markdown: saved.source })
      normalized.init()
      try {
        expect([saved.source, normalized.getMarkdown()]).toContain(expected)
      } finally {
        normalized.destroy()
        normalizedHost.remove()
      }
      if (scenario.steps.length > 0) expect(boundCaret).toBe(expectedCaret)
    } finally {
      app.dispose()
    }
  })
})
