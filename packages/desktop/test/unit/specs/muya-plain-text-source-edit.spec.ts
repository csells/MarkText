// @vitest-environment happy-dom

import { Muya } from '@muyajs/core'
import { type as json1, type JSONOp } from 'ot-json1'
import { canonicalSourceForMuyaTable } from '@/documentAuthority/muyaTableSourceCodec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMuyaPlainTextSourceEditAdapter,
  sourceEditForMuyaTwoParagraphPaste
} from '@/documentAuthority/muyaPlainTextSourceEdit'

const hosts: HTMLElement[] = []

beforeEach(() => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
})

afterEach(() => {
  while (hosts.length > 0) hosts.pop()?.remove()
  document.getSelection()?.removeAllRanges()
})

const boot = (markdown: string): Muya => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const muya = new Muya(host, {
    markdown
  } as ConstructorParameters<typeof Muya>[1])
  muya.init()
  hosts.push(muya.domNode)
  return muya
}

describe('Muya plain-text source edit adapter', () => {
  it('maps native Enter at the end of a paragraph to a source paragraph boundary', () => {
    const muya = boot('seed\n')
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (block == null || !block.isContent()) throw new Error('Expected paragraph')
    muya.editor.activeContentBlock = block
    block.setCursor(4, 4)
    let observed: unknown
    muya.eventCenter.on('json-change', (change: unknown) => {
      observed = sourceEditForMuyaTwoParagraphPaste(
        [
          {
            path: [0, 'text'],
            text: 'seed',
            sourceRange: { start: 0, end: 4 }
          }
        ],
        change
      )
    })
    block.enterHandler(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
    muya.flush()
    expect(observed).toEqual({ start: 4, end: 4, insert: '\n\n' })
  })

  it('continues native typing inside an addition without editing hidden delimiters', () => {
    const muya = boot('seed A')
    const adapter = createMuyaPlainTextSourceEditAdapter({
      path: [0, 'text'],
      sourceRange: { start: 0, end: 9 },
      text: 'seed A',
      segments: [
        { text: { start: 0, end: 4 }, source: { start: 0, end: 4 } },
        { text: { start: 4, end: 6 }, source: { start: 7, end: 9 } }
      ]
    })
    const observed: Array<ReturnType<typeof adapter.accept>> = []
    muya.eventCenter.on('json-change', (change: unknown) => {
      observed.push(adapter.accept(change))
    })
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (block == null || !block.isContent() || block.domNode === null) {
      throw new Error('Expected the mapped paragraph')
    }
    muya.editor.activeContentBlock = block
    for (const text of ['seed AB', 'seed ABC']) {
      block.domNode.textContent = text
      block.setCursor(text.length, text.length)
      block.inputHandler(
        new InputEvent('input', {
          bubbles: true,
          data: text.at(-1),
          inputType: 'insertText'
        })
      )
      muya.flush()
    }
    expect(observed).toEqual([
      { kind: 'edit', edit: { start: 9, end: 9, insert: 'B' } },
      { kind: 'edit', edit: { start: 10, end: 10, insert: 'C' } }
    ])
  })

  it('turns one native middle-paragraph edit into an exact source edit', () => {
    const muya = boot('head\n\nmiddle\n\ntail\n')
    const adapter = createMuyaPlainTextSourceEditAdapter({
      path: [1, 'text'],
      sourceRange: { start: 6, end: 12 },
      text: 'middle'
    })
    const serialize = vi.spyOn(muya, 'getMarkdown')
    let observed: ReturnType<typeof adapter.accept> | undefined
    muya.eventCenter.on('json-change', (change: unknown) => {
      observed = adapter.accept(change)
    })

    const block = muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (block === undefined || block === null || !block.isContent()) {
      throw new Error('Expected the middle paragraph content block')
    }
    if (block.domNode === null) throw new Error('Expected a mounted content block')
    muya.editor.activeContentBlock = block
    block.domNode.textContent = 'midXle'
    block.setCursor(4, 4)
    block.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: 'X',
        inputType: 'insertText'
      })
    )
    muya.flush()

    expect(observed).toEqual({
      kind: 'edit',
      edit: { start: 9, end: 10, insert: 'X' }
    })
    expect(structuredClone(observed)).toEqual(observed)
    expect(serialize).not.toHaveBeenCalled()
  })

  it('advances one regional binding across consecutive native text operations', () => {
    const muya = boot('head\n\nmiddle\n\ntail\n')
    const adapter = createMuyaPlainTextSourceEditAdapter({
      path: [1, 'text'],
      sourceRange: { start: 6, end: 12 },
      text: 'middle'
    })
    const observed: Array<ReturnType<typeof adapter.accept>> = []
    muya.eventCenter.on('json-change', (change: unknown) => {
      observed.push(adapter.accept(change))
    })
    const block = muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (block === undefined || block === null || !block.isContent()) {
      throw new Error('Expected the middle paragraph content block')
    }
    if (block.domNode === null) throw new Error('Expected a mounted content block')
    muya.editor.activeContentBlock = block

    block.domNode.textContent = 'midXle'
    block.setCursor(4, 4)
    block.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: 'X',
        inputType: 'insertText'
      })
    )
    muya.flush()
    block.domNode.textContent = 'midXYle'
    block.setCursor(5, 5)
    block.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: 'Y',
        inputType: 'insertText'
      })
    )
    muya.flush()

    expect(observed).toEqual([
      { kind: 'edit', edit: { start: 9, end: 10, insert: 'X' } },
      { kind: 'edit', edit: { start: 10, end: 10, insert: 'Y' } }
    ])
  })

  it('rejects a claimed next state that the native text operation cannot produce', () => {
    const adapter = createMuyaPlainTextSourceEditAdapter({
      path: [1, 'text'],
      sourceRange: { start: 6, end: 12 },
      text: 'middle'
    })

    expect(
      adapter.accept({
        source: 'user',
        op: [1, 'text', { es: [3, { d: 'q' }, 'X'] }],
        prevDoc: [
          { name: 'paragraph', text: 'head' },
          { name: 'paragraph', text: 'middle' }
        ],
        doc: [
          { name: 'paragraph', text: 'head' },
          { name: 'paragraph', text: 'midXle' }
        ]
      })
    ).toEqual({
      kind: 'unsupported',
      reason: 'operation-mismatch'
    })
  })

  it('captures the native paragraph-to-heading operation for the structural lane', () => {
    const muya = boot('plain\n')
    let observed: unknown
    muya.eventCenter.on('json-change', (change: unknown) => {
      observed = change
    })
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (block === undefined || block === null || !block.isContent()) {
      throw new Error('Expected the paragraph content block')
    }
    if (block.domNode === null) throw new Error('Expected a mounted content block')
    muya.editor.activeContentBlock = block
    block.domNode.textContent = '# title'
    block.setCursor(7, 7)
    block.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: '# title',
        inputType: 'insertText'
      })
    )
    muya.flush()

    expect(observed).toEqual({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'plain' }],
      doc: [{ name: 'atx-heading', text: '# title', meta: { level: 1 } }],
      op: [
        0,
        {
          r: true,
          i: { name: 'atx-heading', text: '# title', meta: { level: 1 } }
        }
      ]
    })
  })

  it('preserves the native cross-paragraph replacement across Cut and typing publications', () => {
    const muya = boot('alpha\n\nbeta\n\ngamma\n')
    const first = muya.editor.scrollPage?.queryBlock([0, 'text'])
    const last = muya.editor.scrollPage?.queryBlock([2, 'text'])
    if (
      first === undefined ||
      first === null ||
      !first.isContent() ||
      last === undefined ||
      last === null ||
      !last.isContent()
    ) {
      throw new Error('Expected the endpoint paragraph content blocks')
    }
    const firstPath = first.path
    const lastPath = last.path
    const originalSelection = muya.editor.selection.getSelection.bind(muya.editor.selection)
    muya.editor.selection.getSelection = () => ({
      anchor: { offset: 2, block: first, path: firstPath },
      focus: { offset: 2, block: last, path: lastPath },
      isCollapsed: false,
      isSelectionInSameBlock: false,
      direction: 'forward' as never,
      type: 'Range' as never
    })
    const observed: Array<{ source: string; prevDoc: unknown; doc: unknown; op: JSONOp }> = []
    muya.eventCenter.on('json-change', (change: (typeof observed)[number]) => {
      observed.push(change)
    })

    muya.editor.clipboard.cutHandler()
    muya.editor.selection.getSelection = originalSelection
    const merged = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (merged === undefined || merged === null || !merged.isContent() || merged.domNode === null) {
      throw new Error('Expected the merged paragraph content block')
    }
    muya.editor.activeContentBlock = merged
    merged.domNode.textContent = 'alXmma'
    merged.setCursor(3, 3)
    merged.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: 'X',
        inputType: 'insertText'
      })
    )
    muya.flush()

    // This explicit Cut is now published before the following input. The
    // composed native operation must still produce the exact original result.
    expect(observed).toHaveLength(2)
    expect(observed.map((change) => change.source)).toEqual(['user', 'user'])
    expect(observed[0].doc).toEqual(observed[1].prevDoc)
    expect({
      source: observed[0].source,
      prevDoc: observed[0].prevDoc,
      doc: observed[1].doc,
      op: json1.compose(observed[0].op, observed[1].op)
    }).toEqual({
      source: 'user',
      prevDoc: [
        { name: 'paragraph', text: 'alpha' },
        { name: 'paragraph', text: 'beta' },
        { name: 'paragraph', text: 'gamma' }
      ],
      doc: [{ name: 'paragraph', text: 'alXmma' }],
      op: [
        [0, 'text', { es: [2, 'X', { d: 'ph' }, 'mm'] }],
        [1, { r: true }],
        [2, { r: true }]
      ]
    })
    expect(muya.getMarkdown()).toBe('alXmma\n')
    muya.undo()
    muya.flush()
    expect(muya.getMarkdown()).toBe('alpha\n\nbeta\n\ngamma\n')
    muya.redo()
    muya.flush()
    expect(muya.getMarkdown()).toBe('alXmma\n')
  })

  it('emits no native change until IME composition commits its final text', () => {
    const muya = boot('seed\n')
    const observed: unknown[] = []
    muya.eventCenter.on('json-change', (change: unknown) => observed.push(change))
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (block === undefined || block === null || !block.isContent() || block.domNode === null) {
      throw new Error('Expected the paragraph content block')
    }
    muya.editor.activeContentBlock = block
    block.setCursor(4, 4)
    block.composeHandler(
      new CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      })
    )

    block.domNode.textContent = 'seedに'
    block.setCursor(5, 5)
    block.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: 'に',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    )
    block.domNode.textContent = 'seed日本'
    block.setCursor(6, 6)
    block.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: '日本',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    )
    muya.flush()
    expect(observed).toEqual([])

    block.composeHandler(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: '日本'
      })
    )
    muya.flush()

    expect(observed).toEqual([
      {
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [{ name: 'paragraph', text: 'seed日本' }],
        op: [0, 'text', { es: [4, '日本'] }]
      }
    ])
  })

  it('captures the native paragraph-to-math-block operation and canonical result', () => {
    const muya = boot('seed\n')
    const observed: unknown[] = []
    muya.eventCenter.on('json-change', (change: unknown) => observed.push(change))
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (block === undefined || block === null || !block.isContent() || block.domNode === null) {
      throw new Error('Expected the paragraph content block')
    }
    muya.editor.activeContentBlock = block
    block.domNode.textContent = '$$'
    block.setCursor(2, 2)
    block.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: '$$',
        inputType: 'insertText'
      })
    )
    block.enterHandler(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      })
    )
    muya.flush()
    const math = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (math === undefined || math === null || !math.isContent() || math.domNode === null) {
      throw new Error('Expected the mounted math content block')
    }
    muya.editor.activeContentBlock = math
    math.domNode.textContent = 'x^2'
    math.setCursor(3, 3)
    math.inputHandler(
      new InputEvent('input', {
        bubbles: true,
        data: 'x^2',
        inputType: 'insertText'
      })
    )
    muya.flush()

    expect({ observed, markdown: muya.getMarkdown() }).toEqual({
      observed: [
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'seed' }],
          doc: [{ name: 'math-block', text: '', meta: { mathStyle: '' } }],
          op: [
            0,
            {
              r: true,
              i: { name: 'math-block', text: '', meta: { mathStyle: '' } }
            }
          ]
        },
        {
          source: 'user',
          prevDoc: [{ name: 'math-block', text: '', meta: { mathStyle: '' } }],
          doc: [{ name: 'math-block', text: 'x^2', meta: { mathStyle: '' } }],
          op: [0, 'text', { es: ['x^2'] }]
        }
      ],
      markdown: '$$\nx^2\n$$\n'
    })
  })

  it.each(['---', ':---', '---:', ':---:'])(
    'matches native Unicode table spelling for %s alignment within its exact source budget',
    (delimiter) => {
      const muya = boot(`| 中 | e\u0301 |\n| ${delimiter} | ${delimiter} |\n| ab | xyz |\n`)
      try {
        const expected = muya.getMarkdown().replace(/\n$/u, '')
        const table = muya.getState()[0]
        expect(canonicalSourceForMuyaTable(table, expected.length)).toEqual({
          kind: 'source',
          markdown: expected
        })
        expect(canonicalSourceForMuyaTable(table, expected.length - 1)).toEqual({
          kind: 'unsupported'
        })
      } finally {
        muya.destroy()
      }
    }
  )

  it('captures the native markdown-table paste operation and canonical result', async() => {
    const muya = boot('seed\n')
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (block === undefined || block === null || !block.isContent()) {
      throw new Error('Expected the paragraph content block')
    }
    const path = block.path
    muya.editor.selection.getSelection = () => ({
      anchor: { offset: 0, block, path },
      focus: { offset: 4, block, path },
      isCollapsed: false,
      isSelectionInSameBlock: true,
      direction: 'forward' as never,
      type: 'Range' as never
    })
    const markdown = '| a | b |\n| - | - |\n| 1 | 2 |'
    const event = {
      preventDefault() {},
      stopPropagation() {},
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? markdown : ''),
        files: [],
        items: []
      }
    } as unknown as ClipboardEvent
    const observed: unknown[] = []
    muya.eventCenter.on('json-change', (change: unknown) => observed.push(change))

    await muya.editor.clipboard.pasteHandler(event, markdown, '')
    muya.flush()

    const table = {
      name: 'table',
      children: [
        {
          name: 'table.row',
          children: [
            { name: 'table.cell', text: 'a', meta: { align: 'none' } },
            { name: 'table.cell', text: 'b', meta: { align: 'none' } }
          ]
        },
        {
          name: 'table.row',
          children: [
            { name: 'table.cell', text: '1', meta: { align: 'none' } },
            { name: 'table.cell', text: '2', meta: { align: 'none' } }
          ]
        }
      ]
    }
    expect({ observed, markdown: muya.getMarkdown() }).toEqual({
      observed: [
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'seed' }],
          doc: [table],
          op: [0, { r: true, i: table }]
        }
      ],
      markdown: '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n'
    })
  })

  it('decodes a native multi-paragraph paste at paragraph end', async() => {
    const muya = boot('Z\n')
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (block === undefined || block === null || !block.isContent()) {
      throw new Error('Expected the target paragraph content block')
    }
    const path = block.path
    muya.editor.selection.getSelection = () => ({
      anchor: { offset: 1, block, path },
      focus: { offset: 1, block, path },
      isCollapsed: true,
      isSelectionInSameBlock: true,
      direction: 'forward' as never,
      type: 'Caret' as never
    })
    const text = 'copied\n\nnew\n\nbe'
    const event = {
      preventDefault() {},
      stopPropagation() {},
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? text : ''),
        files: [],
        items: []
      }
    } as unknown as ClipboardEvent
    let observed: unknown
    muya.eventCenter.on('json-change', (change: unknown) => {
      observed = change
    })

    await muya.editor.clipboard.pasteHandler(event, text, '')
    muya.flush()

    expect(
      sourceEditForMuyaTwoParagraphPaste(
        Object.freeze([
          {
            path: Object.freeze([0, 'text'] as const),
            sourceRange: Object.freeze({ start: 0, end: 1 }),
            text: 'Z'
          }
        ]),
        observed
      )
    ).toEqual({
      start: 1,
      end: 1,
      insert: text
    })
    expect(muya.getMarkdown()).toBe('Zcopied\n\nnew\n\nbe\n')
  })
})
