import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import {
  createEditorCoreBinding,
  type EditorCoreSubmitInput
} from '@/documentAuthority/editorCoreBinding'

// Typing text over an identical selection changes nothing, so it records no
// undo step: the next undo reverts the previous real change, tracked or not.

const replace = (start: number, end: number, data: string) => ({
  range: { start, end },
  selection: { ranges: [{ anchor: start, focus: end }], primary: 0 },
  inputType: 'insertText',
  data,
  options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
})

describe('an input that rewrites text with itself', () => {
  it.each([
    { name: 'one letter inside an Addition', source: 'x{++abc++}y\n', start: 5, end: 6, tracked: true },
    { name: 'a whole Addition payload', source: 'x{++abc++}y\n', start: 4, end: 7, tracked: true },
    { name: 'one letter inside an Addition', source: 'x{++abc++}y\n', start: 5, end: 6, tracked: false },
    { name: 'plain text', source: 'xabcy\n', start: 2, end: 3, tracked: false }
  ])('records no undo step for $name (tracked: $tracked)', async({ source, start, end, tracked }) => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => {}
    })
    await binding.open({ documentId: 'noop.md', source })
    const typed = source.slice(start, end)
    // A real change first, in its own undo step.
    expect(await binding.submit({
      edits: [{ start: 0, end: 0, insert: 'Q' }],
      projections: [],
      nativeHistoryGroup: 'view:1'
    } as EditorCoreSubmitInput).acknowledged).toMatchObject({ type: 'applied' })
    const changed = `Q${source}`
    const acknowledged = await binding.submit({
      kind: 'input',
      action: replace(start + 1, end + 1, typed),
      tracked,
      projections: [],
      nativeHistoryGroup: 'view:2'
    } as EditorCoreSubmitInput).acknowledged
    expect(acknowledged).toMatchObject({ type: 'applied' })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: changed })
    expect(await binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({ type: 'applied' })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    expect(await binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({ reason: 'history-empty' })
    actor.dispose()
  })
})
