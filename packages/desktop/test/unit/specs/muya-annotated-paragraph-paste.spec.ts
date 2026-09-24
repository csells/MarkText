// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const plainPaste = (app: ReturnType<typeof bootBoundMuya>, text: string) =>
  app.muya.editor.clipboard.pasteHandler({
    preventDefault() {},
    stopPropagation() {},
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      files: [],
      items: []
    }
  } as unknown as ClipboardEvent)

describe('ordinary paragraph paste inside existing annotations', () => {
  it.each([
    { source: 'a{++bc++}d\n', expected: 'a{++bOne\n\nTwoc++}d\n', offset: 2 },
    { source: 'a{--bc--}d\n', expected: 'a{--bOne\n\nTwoc--}d\n', offset: 2 },
    { source: 'a{==bc==}d\n', expected: 'a{==bOne\n\nTwoc==}d\n', offset: 2 },
    { source: 'a{~~old~>bc~~}d\n', expected: 'a{~~old~>bOne\n\nTwoc~~}d\n', offset: 5 }
  ])('preserves the owner and exact history for $source', async({ source, expected, offset }) => {
    const app = bootBoundMuya(source)
    try {
      const target = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (target == null || !target.isContent()) throw new Error('Missing paste target')
      target.setCursor(offset, offset, true)
      await plainPaste(app, 'One\n\nTwo')
      await app.adapter.settled()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
    } finally {
      app.dispose()
    }
  })
})
