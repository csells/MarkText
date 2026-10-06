// @vitest-environment jsdom
import { createDocumentCore, type DocumentInputAction } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { MaybeContent } from '../helpers/muyaTypes'

type BoundMuya = ReturnType<typeof bootBoundMuya>

// Upstream (#5597, compatibleTaskList splitIntoRuns) renders a list whose
// items mix tasks and plain items as one list per run of same-kind items.
// An ordered run is numbered from its first item's place in the whole list.

const leaves = (app: BoundMuya) => {
  const found = []
  for (
    let block: MaybeContent = app.muya.editor.scrollPage?.firstContentInDescendant();
    block != null;
    block = block.nextContentInContext()
  ) {
    found.push(block)
  }
  return found
}

const lists = (app: BoundMuya) => {
  const root = app.muya.editor.scrollPage?.domNode
  if (!(root instanceof HTMLElement)) throw new Error('Expected rendered document')
  return [...root.querySelectorAll(':scope > ol, :scope > ul')].map(list => ({
    tag: list.tagName.toLowerCase(),
    task: list.classList.contains('mu-task-list'),
    start: list.getAttribute('start'),
    items: [...list.children].map(item => item.querySelector('.mu-task-list-checkbox') !== null)
  }))
}

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

const input = async(
  { muya, adapter }: BoundMuya,
  inputType: string,
  data: string | null = null
) => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
  await adapter.settled()
}

const endOf = (app: BoundMuya, index: number) => {
  const leaf = leaves(app)[index]
  if (leaf === undefined || !leaf.isContent()) throw new Error('Expected content leaf')
  leaf.setCursor(leaf.text.length, leaf.text.length, true)
  app.muya.flush()
}

describe('a list mixing tasks and plain items', () => {
  it.each([
    {
      markdown: '1. [x] a\n2. b\n3. [ ] c\n',
      expected: [
        { tag: 'ol', task: true, start: '1', items: [true] },
        { tag: 'ol', task: false, start: '2', items: [false] },
        { tag: 'ol', task: true, start: '3', items: [true] }
      ]
    },
    {
      markdown: '- [x] a\n- b\n',
      expected: [
        { tag: 'ul', task: true, start: null, items: [true] },
        { tag: 'ul', task: false, start: null, items: [false] }
      ]
    },
    {
      // A run is numbered by its position, not by its literal marker.
      markdown: '1. [x] a\n1. b\n',
      expected: [
        { tag: 'ol', task: true, start: '1', items: [true] },
        { tag: 'ol', task: false, start: '2', items: [false] }
      ]
    },
    {
      markdown: '99. [x] a\n100. [ ] b\n2. c\n',
      expected: [
        { tag: 'ol', task: true, start: '99', items: [true, true] },
        { tag: 'ol', task: false, start: '101', items: [false] }
      ]
    }
  ])('renders $markdown as one list per run', ({ markdown, expected }) => {
    const app = bootBoundMuya(markdown)
    try {
      expect(lists(app)).toEqual(expected)
    } finally {
      app.dispose()
    }
  })

  it('splits a nested list inside an item as well', () => {
    const app = bootBoundMuya('- a\n  - [x] b\n  - c\n')
    try {
      const root = app.muya.editor.scrollPage?.domNode
      if (!(root instanceof HTMLElement)) throw new Error('Expected rendered document')
      const nested = [...root.querySelectorAll(':scope > ul > li > ul')]
      expect(nested.map(list => list.classList.contains('mu-task-list'))).toEqual([true, false])
      expect(leaves(app).map(leaf => leaf.text)).toEqual(['a', 'b', 'c'])
    } finally {
      app.dispose()
    }
  })

  it('types, breaks and undoes in each run and keeps the source one list', async() => {
    const initial = '1. [x] a\n2. b\n3. [ ] c\n'
    const app = bootBoundMuya(initial)
    try {
      expect(leaves(app).map(leaf => leaf.text)).toEqual(['a', 'b', 'c'])
      endOf(app, 1)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('1. [x] a\n2. bx\n3. [ ] c\n')
      await input(app, 'insertParagraph')
      expect(source(app)).toBe('1. [x] a\n2. bx\n3. \n3. [ ] c\n')
      await input(app, 'insertText', 'y')
      expect(source(app)).toBe('1. [x] a\n2. bx\n3. y\n3. [ ] c\n')
      expect(lists(app).map(list => list.items)).toEqual([[true], [false, false], [true]])
      endOf(app, 0)
      await input(app, 'insertParagraph')
      expect(source(app)).toBe('1. [x] a\n2. [ ] \n2. bx\n3. y\n3. [ ] c\n')
      expect(lists(app).map(list => list.items)).toEqual([[true, true], [false, false], [true]])
      for (let undo = 0; undo < 4; undo += 1) await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
      expect(lists(app).map(list => list.items)).toEqual([[true], [false], [true]])
    } finally {
      app.dispose()
    }
  })

  it('checks a task in a later run through its checkbox', async() => {
    const app = bootBoundMuya('1. [x] a\n2. b\n3. [ ] c\n')
    try {
      const boxes = (app.muya.domNode as HTMLElement).querySelectorAll<HTMLElement>('.mu-task-list-checkbox')
      expect(boxes).toHaveLength(2)
      boxes[1]!.click()
      await app.adapter.settled()
      expect(source(app)).toBe('1. [x] a\n2. b\n3. [x] c\n')
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe('1. [x] a\n2. b\n3. [ ] c\n')
    } finally {
      app.dispose()
    }
  })

  // The model selection across the runs is the same source range Core plans
  // for, so the result is Core's own result for that range.
  it.each([
    { inputType: 'deleteContentBackward', data: null },
    { inputType: 'insertText', data: 'z' }
  ])('$inputType over a selection across the runs edits as Core plans it', async({ inputType, data }) => {
    const initial = '1. [x] ab\n2. cd\n3. [ ] ef\n'
    const app = bootBoundMuya(initial)
    try {
      const all = leaves(app)
      const first = all[0]
      const last = all[2]
      if (first === undefined || last === undefined || !first.isContent() || !last.isContent()) {
        throw new Error('Expected content leaves')
      }
      app.muya.editor.selection.setSelection(
        { block: first, path: first.path, offset: 1 },
        { block: last, path: last.path, offset: 1 }
      )
      app.muya.flush()
      await input(app, inputType, data)
      const start = initial.indexOf('ab') + 1
      const end = initial.indexOf('ef') + 1
      const core = createDocumentCore()
      const revision = core.open(initial)
      const action = {
        selection: { ranges: [{ anchor: start, focus: end }], primary: 0 },
        range: { start, end },
        inputType,
        data,
        options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
      } as DocumentInputAction
      const plan = core.planInput(revision, action)
      const expected = core.apply(revision, core.inputEdits(revision, action, plan, false)!).revision.source
      expect(source(app)).toBe(expected)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
      expect(lists(app).map(list => list.items)).toEqual([[true], [false], [true]])
    } finally {
      app.dispose()
    }
  })
})
