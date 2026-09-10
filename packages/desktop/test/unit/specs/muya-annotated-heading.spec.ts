// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya as boot } from '../helpers/boundMuyaDocument'

it.each([
  {
    source: '{~~old~>new~~}\n',
    expected: '# {~~old~>new~~}\n',
    original: '# old\n',
    revised: '# new\n',
    headings: 1
  },
  {
    source: '{~~old~>new~~} tail\n',
    expected: '# {~~old~>new~~} tail\n',
    original: '# old tail\n',
    revised: '# new tail\n',
    headings: 1
  },
  {
    source: '{--plain--}\n',
    expected: '{--# plain--}\n',
    original: '# plain\n',
    revised: '\n',
    headings: 1
  },
  {
    source: '{~~plain~># new~~}\n',
    expected: '{~~# plain~># new~~}\n',
    original: '# plain\n',
    revised: '# new\n',
    headings: 2
  },
  {
    source: '{~~# old~>plain~~}\n',
    expected: '{~~# old~># plain~~}\n',
    original: '# old\n',
    revised: '# plain\n',
    headings: 2
  }
])('formats only the paragraph-owned arm of $source', async(example) => {
  const app = boot(example.source)
  try {
    const index = app.view().state.findIndex((block) => block.name === 'paragraph')
    const paragraph = app.muya.editor.scrollPage?.queryBlock([index, 'text'])
    if (!paragraph?.isContent()) throw new Error('Expected paragraph')
    paragraph.setCursor(0, 0, true)
    app.muya.updateParagraph('heading 1')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
    expect(app.legacyChanges).toEqual([])
    expect(app.muya.domNode.querySelectorAll('h1')).toHaveLength(example.headings)
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
    const core = createDocumentCore()
    const revision = core.open(example.expected)
    expect(core.project(revision, 'original').markdown).toBe(example.original)
    expect(core.project(revision, 'revised').markdown).toBe(example.revised)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
  } finally {
    app.dispose()
  }
})

it('keeps an immediate heading command at its paragraph boundary after an earlier tracked insertion', async() => {
  const app = boot('p\n\n{~~old~>new~~}\n')
  try {
    app.track(true)
    const first = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!first?.isContent()) throw new Error('Expected first paragraph')
    first.setCursor(1, 1, true)
    first.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        data: 'X',
        inputType: 'insertText',
        bubbles: true,
        cancelable: true
      })
    )
    app.track(false)
    const second = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!second?.isContent()) throw new Error('Expected second paragraph')
    second.setCursor(0, 0, true)
    app.muya.updateParagraph('heading 1')
    expect(app.legacyChanges).toEqual([])
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: 'p{++X++}\n\n# {~~old~>new~~}\n'
    })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'p{++X++}\n\n{~~old~>new~~}\n' })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'p\n\n{~~old~>new~~}\n' })
  } finally {
    app.dispose()
  }
})
