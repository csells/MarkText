// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { muyaClipboardCurrentSelection } from '@/documentAuthority/muyaModelSelection'
import { restoreMuyaDocumentSelection } from '@/documentAuthority/reconcileMuyaDocumentView'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { asMuyaStates } from '../helpers/muyaTypes'

it.each([
  {
    source: '```js\nbody\n```\n',
    changed: '```jxs\nbody\n```\n',
    typed: '```jxys\nbody\n```\n',
    offset: 1
  },
  {
    source: '{++```js\nbody\n```++}\n',
    changed: '{++```jxs\nbody\n```++}\n',
    typed: '{++```jxys\nbody\n```++}\n',
    offset: 1
  },
  {
    source: '```  j&#115; title=\\*  \nbody\n```\n',
    changed: '```  jx&#115; title=\\*  \nbody\n```\n',
    typed: '```  jxy&#115; title=\\*  \nbody\n```\n',
    offset: 3
  },
  {
    source: '```\nbody\n```\n',
    changed: '```x\nbody\n```\n',
    typed: '```xy\nbody\n```\n',
    offset: 0
  },
  {
    source: '```j&#115; title=\\*\nbody\n```\n',
    changed: '```jx&#115; title=\\*\nbody\n```\n',
    typed: '```jxy&#115; title=\\*\nbody\n```\n',
    offset: 1
  },
  {
    source: '```&NotEqualTilde; title=\\*\nbody\n```\n',
    changed: '```≂x̸ title=\\*\nbody\n```\n',
    typed: '```≂xy̸ title=\\*\nbody\n```\n',
    offset: 1
  }
])(
  'direct language typing owns the info field in $source',
  async({ source, changed, typed, offset }) => {
    const app = bootBoundMuya(source)
    try {
      const code = app.muya.editor.scrollPage!.queryBlock([0])
      if (!code?.isParent()) throw new Error('Expected code block')
      const lang = code.firstContentInDescendant()!
      expect(lang.blockName).toBe('language-input')
      lang.setCursor(offset, offset, true)
      lang.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { path: [0, 'meta', 'lang'], offset: offset + 1 },
        focus: { path: [0, 'meta', 'lang'], offset: offset + 1 }
      })
      app.muya.editor.selection
        .getSelection()!
        .anchor.block.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'y',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { path: [0, 'meta', 'lang'], offset },
        focus: { path: [0, 'meta', 'lang'], offset }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it('retains an intrinsic info position through remount and the next key', async() => {
  const source = '```&fjlig; title=\\*\nbody\n```\n'
  const app = bootBoundMuya(source)
  try {
    const lang = app.muya.editor.scrollPage!.queryBlock([0, 'meta', 'lang'])!
    if (!lang.isContent()) throw new Error('Expected language field')
    lang.setCursor(1, 1, true)
    const selection = muyaClipboardCurrentSelection(app.muya, app.view())
    expect(selection).toEqual({
      kind: 'model-text',
      anchor: { text: { start: 3, end: 10 }, offset: 1 },
      focus: { text: { start: 3, end: 10 }, offset: 1 }
    })
    app.muya.setContent(asMuyaStates(structuredClone([...app.view().state])))
    restoreMuyaDocumentSelection(app.muya, app.view(), selection!)
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { path: [0, 'meta', 'lang'], offset: 1 },
      focus: { path: [0, 'meta', 'lang'], offset: 1 }
    })
    app.muya.editor.selection.getSelection()!.anchor.block.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '```fxj title=\\*\nbody\n```\n' })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { path: [0, 'meta', 'lang'], offset: 1 },
      focus: { path: [0, 'meta', 'lang'], offset: 1 }
    })
  } finally {
    app.dispose()
  }
})

it('direct info edits keep the next key in the field when Track Changes is enabled', async() => {
  const source = '```js\nbody\n```\n'
  const app = bootBoundMuya(source)
  try {
    const code = app.muya.editor.scrollPage!.queryBlock([0])
    if (!code?.isParent()) throw new Error('Expected code block')
    const lang = code.firstContentInDescendant()!
    lang.setCursor(1, 1, true)
    app.track(true)
    lang.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    const snapshot = app.binding.sourceAtBarrier()
    if (snapshot.type !== 'source') throw new Error('Expected source barrier')
    const core = createDocumentCore()
    const revision = core.open(snapshot.source)
    expect(core.project(revision, 'original').markdown).toBe(source)
    expect(core.project(revision, 'revised').markdown).toBe('```jxs\nbody\n```\n')
    expect(app.muya.editor.selection.getSelection()!.anchor.block.blockName).toBe('language-input')
    app.muya.editor.selection
      .getSelection()!
      .anchor.block.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'y',
        bubbles: true,
        cancelable: true
      })
    )
    const typed = app.binding.sourceAtBarrier()
    if (typed.type !== 'source') throw new Error('Expected source barrier')
    expect(core.project(core.open(typed.source), 'original').markdown).toBe(source)
    expect(core.project(core.open(typed.source), 'revised').markdown).toBe('```jxys\nbody\n```\n')
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { path: [0, 'meta', 'lang'], offset: 1 },
      focus: { path: [0, 'meta', 'lang'], offset: 1 }
    })
  } finally {
    app.dispose()
  }
})
