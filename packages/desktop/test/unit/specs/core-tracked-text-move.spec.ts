import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

it.each([
  {
    source: 'one {--two--} end\n',
    from: 7,
    end: 10,
    to: 0,
    expected: '{++{--two--}++}one {--two--} end\n',
    typed: '{++{--two--}X++}one {--two--} end\n',
    caret: 12
  },
  {
    source: 'A{++bc{>>note<<}de++}F end\n',
    from: 5,
    end: 16,
    to: 22,
    expected: 'A{++bde++}F{++{++c{>>note<<}++}++} end\n',
    typed: 'A{++bde++}F{++{++c{>>note<<}X++}++} end\n',
    caret: 31
  }
])('preserves a tracked annotation move through history and save: $source', async(example) => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  try {
    await binding.open({ documentId: 'tracked-move.md', source: example.source })
    const moved = await binding.submit({
      kind: 'input',
      action: {
        kind: 'command',
        command: 'moveText',
        copy: false,
        options,
        selection: { ranges: [{ anchor: example.end, focus: example.from }], primary: 0 },
        target: { start: example.to, end: example.to }
      },
      tracked: true,
      projections: ['markup']
    }).acknowledged
    const selection = { ranges: [{ anchor: example.caret, focus: example.caret }], primary: 0 }
    expect(moved).toMatchObject({ type: 'applied', inputResult: { selection } })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
    expect(
      await binding.submit({
        kind: 'input',
        action: {
          selection,
          range: { start: example.caret, end: example.caret },
          inputType: 'insertText',
          data: 'X',
          options
        },
        tracked: true,
        projections: ['markup']
      }).acknowledged
    ).toMatchObject({ type: 'applied' })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.typed })
    await binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
    await binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.source })
    await binding.submit({ kind: 'redo', projections: [] }).acknowledged
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
    await binding.submit({ kind: 'redo', projections: [] }).acknowledged
    const saved = await binding.sourceAtBarrier()
    expect(saved).toMatchObject({ source: example.typed })
    if (saved.type !== 'source') throw new Error('Expected saved source')
    const reopened = createDocumentCore()
    expect(reopened.open(saved.source).source).toBe(example.typed)
  } finally {
    binding.dispose()
  }
})
