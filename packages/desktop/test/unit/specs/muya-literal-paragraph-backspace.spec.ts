// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { separateUndoSteps } from '../helpers/separateUndoSteps'

separateUndoSteps()

it.each(
  [
    {
      name: 'math',
      source: '$$\na\n$$\n\nb\n',
      joined: '$$\nab\n$$\n',
      typed: '$$\naxb\n$$\n',
      offset: 1,
      body: 'axb'
    },
    {
      name: 'diagram',
      source: '```mermaid\na\n```\n\nb\n',
      joined: '```mermaid\nab\n```\n',
      typed: '```mermaid\naxb\n```\n',
      offset: 1,
      body: 'axb'
    },
    {
      name: 'front matter',
      source: '---\na\n---\n\nb\n',
      joined: '---\nab\n---\n',
      typed: '---\naxb\n---\n',
      offset: 1,
      body: 'axb'
    },
    {
      name: 'HTML',
      source: '<div>a</div>\n\nb\n',
      joined: '<div>a</div>b\n',
      typed: '<div>a</div>xb\n',
      offset: 12,
      body: '<div>a</div>xb'
    },
    {
      name: 'annotated paragraph into math',
      source: '$$\na\n$$\n\nb{++c++}d{>>note<<}\n',
      joined: '$$\nab{++c++}d{>>note<<}\n$$\n',
      typed: '$$\naxb{++c++}d{>>note<<}\n$$\n',
      offset: 1,
      body: 'axb{++c++}d{>>note<<}'
    }
  ].flatMap((example) =>
    ['\n', '\r\n', '\r'].flatMap((ending) =>
      [false, true].map((tracked) => ({ ...example, ending, tracked }))
    )
  )
)(
  'joins a paragraph into $name before the next native key with canonical history ($ending, tracked=$tracked)',
  async(example) => {
    const spelling = (text: string) =>
      (text + '\noutside{>>keep<<}\n').replaceAll('\n', example.ending)
    const source = spelling(example.source)
    const joined = spelling(example.joined)
    const typed = spelling(example.typed)
    const app = bootBoundMuya(source)
    app.track(example.tracked)
    const expectSource = (expected: string) => {
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected acknowledged source')
      if (!example.tracked) expect(saved.source).toBe(expected)
      const core = createDocumentCore()
      expect(core.project(core.open(saved.source), 'revised').markdown).toBe(
        expected.replace('outside{>>keep<<}', 'outside')
      )
      return saved.source
    }
    try {
      const paragraph = app.muya.editor.scrollPage
        ?.firstContentInDescendant()
        ?.nextContentInContext()
      if (!paragraph) throw new Error('Expected paragraph after math')
      expect(paragraph.text).toBe(example.name === 'annotated paragraph into math' ? 'bcd' : 'b')
      paragraph.setCursor(0, 0, true)
      paragraph.domNode!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      )
      expectSource(joined)
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: example.offset },
        focus: { offset: example.offset }
      })
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode?.isConnected) throw new Error('Expected literal selection')
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      const saved = expectSource(typed)
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expectSource(joined)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: saved })
      const reopened = bootBoundMuya(saved)
      try {
        const core = createDocumentCore()
        expect(core.project(core.open(saved), 'revised').markdown).toBe(
          typed.replace('outside{>>keep<<}', 'outside')
        )
        if (!example.tracked) {
          expect(reopened.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(
            example.body
          )
        }
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
