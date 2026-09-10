import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createMuyaMarkupView, mappedMuyaSourceRange } from '@/documentAuthority/muyaMarkupView'
import { reconcileMuyaNativeBindings } from '@/documentAuthority/muyaNativeReconciliation'
import {
  assertMuyaPlainTextSourceBinding,
  type MuyaPlainTextSourceBinding
} from '@/documentAuthority/muyaPlainTextSourceEdit'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const plain = (text: string): MuyaPlainTextSourceBinding => ({
  path: [0, 'text'],
  text,
  sourceRange: { start: 0, end: text.length }
})
const caret = (binding: MuyaPlainTextSourceBinding, offset: number) =>
  mappedMuyaSourceRange(binding, { start: offset, end: offset }, binding.insertionAffinity)

describe('native coordinate reconciliation from Core input plans', () => {
  it('keeps the next queued insertion after a skipped closer', () => {
    const core = createDocumentCore()
    const revision = core.open('seed()')
    const plan = core.planInput(revision, {
      range: { start: 5, end: 5 },
      selection: { ranges: [{ anchor: 5, focus: 5 }], primary: 0 },
      inputType: 'insertText',
      data: ')',
      options
    })
    expect(plan.reconciliation).toEqual([{ start: 6, end: 7, insert: '' }])
    const [binding] = reconcileMuyaNativeBindings([plain('seed())')], plan.reconciliation)
    expect(binding.text).toBe('seed())')
    expect(caret(binding, 6)).toEqual({ start: 6, end: 6 })
    expect(caret(binding, 7)).toEqual({ start: 6, end: 6 })
    expect(() => assertMuyaPlainTextSourceBinding(binding)).not.toThrow()
  })

  it('keeps the pending domain when paired deletion removes the surviving raw closer', () => {
    const core = createDocumentCore()
    const revision = core.open('seed()')
    const plan = core.planInput(revision, {
      range: { start: 4, end: 5 },
      selection: { ranges: [{ anchor: 5, focus: 5 }], primary: 0 },
      inputType: 'deleteContentBackward',
      data: null,
      options
    })
    const [binding] = reconcileMuyaNativeBindings([plain('seed)')], plan.reconciliation)
    expect(binding.text).toBe('seed)')
    expect(caret(binding, 4)).toEqual({ start: 4, end: 4 })
    expect(caret(binding, 5)).toEqual({ start: 4, end: 4 })
    expect(() => assertMuyaPlainTextSourceBinding(binding)).not.toThrow()
  })

  it('retains the hidden-comment gap when the model removes an echoed closer before it', () => {
    const core = createDocumentCore()
    const revision = core.open('({>>note<<})')
    const plan = core.planInput(revision, {
      range: { start: 1, end: 1 },
      selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
      inputType: 'insertText',
      data: ')',
      options
    })
    const echo = core.open('(){>>note<<})')
    const native = createMuyaMarkupView(core.project(echo, 'markup'), echo.annotations).bindings[0]
    const [binding] = reconcileMuyaNativeBindings([native], plan.reconciliation)
    expect(binding.text).toBe('())')
    expect(caret(binding, 1)).toEqual({ start: 1, end: 1 })
    expect(caret(binding, 2)).toEqual({ start: 11, end: 11 })
    expect(caret(binding, 3)).toEqual({ start: 12, end: 12 })
    expect(mappedMuyaSourceRange(binding, { start: 0, end: 3 })).toBeUndefined()
    expect(() => assertMuyaPlainTextSourceBinding(binding)).not.toThrow()
  })

  it('retains every pending position inside a removed span and across a later insertion', () => {
    const [removed] = reconcileMuyaNativeBindings(
      [plain('abcdef')],
      [{ start: 1, end: 4, insert: '' }]
    )
    for (const offset of [1, 2, 3, 4]) expect(caret(removed, offset)).toEqual({ start: 1, end: 1 })
    const [inserted] = reconcileMuyaNativeBindings([removed], [{ start: 1, end: 1, insert: 'xy' }])
    for (const offset of [1, 2, 3, 4]) expect(caret(inserted, offset)).toEqual({ start: 3, end: 3 })
    expect(inserted.text).toBe('abcdef')
    expect(caret(inserted, 6)).toEqual({ start: 5, end: 5 })
    expect(() => assertMuyaPlainTextSourceBinding(inserted)).not.toThrow()
  })

  it('keeps inserted model syntax outside the retained native segments', () => {
    const [binding] = reconcileMuyaNativeBindings(
      [plain('ab')],
      [
        { start: 0, end: 0, insert: '{++' },
        { start: 2, end: 2, insert: '++}' }
      ]
    )
    expect(binding.text).toBe('ab')
    expect(caret(binding, 0)).toEqual({ start: 3, end: 3 })
    expect(caret(binding, 2)).toEqual({ start: 5, end: 5 })
    expect(mappedMuyaSourceRange(binding, { start: 0, end: 2 })).toEqual({ start: 3, end: 5 })
    expect(() => assertMuyaPlainTextSourceBinding(binding)).not.toThrow()
  })

  it('preserves normalized newlines through replacement and whole-segment deletion', () => {
    const native: MuyaPlainTextSourceBinding = {
      path: [0, 'text'],
      text: 'a\nb',
      sourceRange: { start: 0, end: 4 },
      segments: [
        { text: { start: 0, end: 1 }, source: { start: 0, end: 1 } },
        { text: { start: 1, end: 2 }, source: { start: 1, end: 3 } },
        { text: { start: 2, end: 3 }, source: { start: 3, end: 4 } }
      ]
    }
    const [replaced] = reconcileMuyaNativeBindings([native], [{ start: 0, end: 1, insert: 'xy' }])
    expect(caret(replaced, 1)).toEqual({ start: 2, end: 2 })
    expect(caret(replaced, 2)).toEqual({ start: 4, end: 4 })
    expect(() => assertMuyaPlainTextSourceBinding(replaced)).not.toThrow()
    const [removed] = reconcileMuyaNativeBindings([native], [{ start: 1, end: 3, insert: '' }])
    expect(caret(removed, 1)).toEqual({ start: 1, end: 1 })
    expect(caret(removed, 2)).toEqual({ start: 1, end: 1 })
    expect(() => assertMuyaPlainTextSourceBinding(removed)).not.toThrow()
    expect(() => reconcileMuyaNativeBindings([native], [{ start: 2, end: 3, insert: '' }])).toThrow(
      'Native reconciliation crosses a nonlinear text segment'
    )
  })

  it('preserves source positions across disjoint replacements and invalidates an enclosed leaf owner', () => {
    const [binding] = reconcileMuyaNativeBindings(
      [plain('abcdefgh')],
      [
        { start: 1, end: 3, insert: 'X' },
        { start: 5, end: 7, insert: '' }
      ]
    )
    expect(binding.text).toBe('abcdefgh')
    expect(caret(binding, 2)).toEqual({ start: 2, end: 2 })
    expect(caret(binding, 4)).toEqual({ start: 3, end: 3 })
    expect(caret(binding, 6)).toEqual({ start: 4, end: 4 })
    expect(caret(binding, 8)).toEqual({ start: 5, end: 5 })
    expect(() => assertMuyaPlainTextSourceBinding(binding)).not.toThrow()
    const [enclosed] = reconcileMuyaNativeBindings(
      [
        {
          path: [0, 'text'],
          text: 'cd',
          sourceRange: { start: 2, end: 4 },
          outerBlock: { range: { start: 2, end: 4 }, source: 'cd' }
        }
      ],
      [{ start: 1, end: 5, insert: '' }]
    )
    expect(enclosed.outerBlock).toBeUndefined()
    expect(caret(enclosed, 1)).toEqual({ start: 1, end: 1 })
    expect(() => assertMuyaPlainTextSourceBinding(enclosed)).not.toThrow()
  })

  it('refuses reversed or arbitrary nonlinear source spans', () => {
    for (const source of [
      { start: 1, end: 0 },
      { start: 0, end: 1 }
    ]) {
      expect(() =>
        assertMuyaPlainTextSourceBinding({
          ...plain('abc'),
          segments: [{ text: { start: 0, end: 3 }, source }]
        })
      ).toThrow('Muya source segments are invalid')
    }
  })
})
