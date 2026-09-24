// @vitest-environment jsdom
import type { DocumentSelection } from '@marktext/document-core'
import { expect, it } from 'vitest'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { modelInputOptions as options, openModelInputSession } from '../helpers/modelInputSession'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const liveTarget = (app: BoundMuya): HTMLElement => {
  const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  return target
}

const input = (app: BoundMuya, inputType: string, data: string | null = null): void => {
  liveTarget(app).dispatchEvent(
    new InputEvent('beforeinput', { data, inputType, bubbles: true, cancelable: true })
  )
}

const typeText = (app: BoundMuya, text: string): void => {
  for (const character of text) input(app, 'insertText', character)
}

const backspace = (app: BoundMuya): void => {
  const key = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
  liveTarget(app).dispatchEvent(key)
  if (!key.defaultPrevented) input(app, 'deleteContentBackward')
}

const caretAtEnd = (app: BoundMuya, path: readonly (string | number)[]): void => {
  const block = app.muya.editor.scrollPage?.queryBlock([...path])
  if (block == null || !block.isContent()) throw new Error('Expected content leaf')
  block.setCursor(block.text.length, block.text.length, true)
}

const openModel = (source: string, seededEdits: readonly string[] = []) => {
  const session = openModelInputSession(source, { seededEdits })
  return {
    ...session,
    view: () => session.view().bindings,
    command: (action: Record<string, unknown>) =>
      expect(session.command(action)).toEqual({ accepted: true, changed: true }),
    input: (inputType: string, data: string | null = null, tracked = false) =>
      expect(session.input(inputType, data, tracked)).toEqual({ accepted: true, changed: true })
  }
}

it.each([
  { source: '\n', markers: ['#'] },
  { source: '#\n', markers: ['##'] },
  { source: '\n', markers: ['#', '##'] }
])('preserves native $markers spelling before queued text', async({ source, markers }) => {
  const app = bootBoundMuya(source)
  try {
    caretAtEnd(app, [0, 'text'])
    const existing = source.trimEnd()
    for (const marker of markers) {
      typeText(app, marker.slice(existing.length + (markers.indexOf(marker) === 0 ? 0 : 1)))
    }
    typeText(app, ' Hello')
    await app.adapter.settled()
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: `${markers.at(-1)} Hello\n` })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it.each([
  { label: 'heading 1', seed: 'seed' },
  { label: 'ul-bullet', seed: 'seed' },
  { label: 'heading 1', seed: '' }
])(
  'retains native typing and history immediately after $label of "$seed"',
  async({ label, seed }) => {
    const app = bootBoundMuya(`${seed}\n`)
    const { muya, binding, adapter, reconcile } = app
    try {
      const paragraph = muya.editor.scrollPage?.firstContentInDescendant()
      if (paragraph == null) throw new Error('Expected paragraph')
      paragraph.setCursor(seed.length, seed.length, true)
      muya.updateParagraph(label)
      // Typing runs in the same task, against the command's resulting model selection.
      typeText(app, '!x')
      await adapter.settled()
      const prefix = label === 'heading 1' ? '# ' : '- '
      expect(binding.sourceAtBarrier()).toMatchObject({ source: `${prefix}${seed}!x\n` })
      expect(muya.domNode.querySelector(label === 'heading 1' ? 'h1' : 'ul li')).not.toBeNull()
      expect(app.legacyChanges).toEqual([])
      for (const source of [`${prefix}${seed}\n`, `${seed}\n`]) {
        await adapter.history('undo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source })
      }
      for (const source of [`${prefix}${seed}\n`, `${prefix}${seed}!x\n`]) {
        await adapter.history('redo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source })
      }
    } finally {
      app.dispose()
    }
  }
)

it.each(
  ['ordinary', 'tracked'].flatMap((lane) => [1, 2].map((undoCount) => ({ lane, undoCount })))
)(
  'reconciles $lane typing in the same task after $undoCount undo decisions',
  async({ lane, undoCount }) => {
    const model = openModel('A\n', undoCount === 2 ? [' B', ' D'] : [' B'])
    const history = model.adapter.history('undo', model.reconcile)
    const secondHistory =
      undoCount === 2 ? model.adapter.history('undo', model.reconcile) : undefined
    // Model acceptance and presentation finish before the next browser event.
    expect(model.view()[0].text).toBe('A')
    expect(model.binding.sourceAtBarrier()).toMatchObject({ source: 'A\n' })
    try {
      model.select(1)
      model.type(' C!', lane === 'tracked')
      expect(model.view()[0].text).toBe('A C!')
      expect(model.binding.sourceAtBarrier()).toMatchObject({
        source: lane === 'ordinary' ? 'A C!\n' : 'A{++ C!++}\n'
      })
      expect(model.adapter.state()).toMatchObject({ status: 'ready' })
      await Promise.all([history, secondHistory, model.adapter.settled()])
    } finally {
      model.dispose()
    }
  }
)

it('keeps literal suggestion delimiters literal inside an addition immediately after undo', async() => {
  const model = openModel('{++A++}\n')
  model.binding.submit({ edits: [{ start: 4, end: 4, insert: ' B' }], projections: [] })
  const adapter = createMuyaPlainTextCoreAdapter(model.view(), model.binding, undefined, 2)
  let selection: DocumentSelection | undefined
  const reconcile = (outcome: CoreAppliedReply) => {
    selection = outcome.historyResult?.selection ?? outcome.inputResult?.selection
    return model.view()
  }
  const history = adapter.history('undo', reconcile)
  try {
    expect(model.view()[0].text).toBe('A')
    selection ??= { ranges: [{ anchor: 4, focus: 4 }], primary: 0 }
    if (!('ranges' in selection)) throw new Error('Missing text caret')
    const caret = selection.ranges[selection.primary].focus
    expect(caret).toBe(4)
    expect(
      adapter.input(
        {
          range: { start: caret, end: caret },
          selection,
          inputType: 'insertText',
          data: '{--X--}',
          options
        },
        reconcile
      )
    ).toEqual({ accepted: true, changed: true })
    await history
    await adapter.settled()
    expect(model.binding.sourceAtBarrier()).toMatchObject({ source: '{++A\\{--X\\--}++}\n' })
  } finally {
    history.catch(() => {})
    adapter.dispose()
    model.dispose()
  }
})

it.each([false, true])(
  'preserves source while backspaces remove every list item (settled: %s)',
  async(settleEach) => {
    const app = bootBoundMuya('# Doc\n\n- a\n- b\n- c\n')
    try {
      caretAtEnd(app, [1, 'children', 2, 'children', 0, 'text'])
      const sources: string[] = []
      for (let presses = 0; presses < 12; presses += 1) {
        backspace(app)
        if (settleEach) await app.adapter.settled()
        const current = app.binding.sourceAtBarrier()
        if (current.type !== 'source') throw new Error('Expected source')
        sources.push(current.source)
        if (current.source === '# Doc\n') break
      }
      await app.adapter.settled()
      expect(sources.at(-1)).toBe('# Doc\n')
      // Every intermediate document keeps the heading and never gains text.
      for (const source of sources) {
        expect(source.startsWith('# Doc\n')).toBe(true)
        expect(source.replace(/[\s\-#]/gu, '').length).toBeLessThanOrEqual(5)
      }
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

it.each(['\n', '\r\n', '\r'])(
  'inserts a rule before an unchanged empty paragraph and keeps following typing (%j)',
  async(eol) => {
    const app = bootBoundMuya(eol)
    try {
      caretAtEnd(app, [0, 'text'])
      app.muya.updateParagraph('hr')
      typeText(app, 'after')
      await app.adapter.settled()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: `---${eol}${eol}after${eol}` })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

for (const { name, source } of [
  { name: 'a plain final paragraph', source: 'sample text' },
  { name: 'an annotated final paragraph without consuming its markers', source: '{~~old~>new~~}' }
]) {
  it.each(['\n', '\r\n', '\r'])(
    `appends a code block after ${name} and preserves input (%j)`,
    async(eol) => {
      const model = openModel(`${source}${eol}`)
      try {
        model.select(source.length)
        model.command({ command: 'createCodeBlock', replace: false })
        model.type('after')
        await model.adapter.settled()
        expect(model.binding.sourceAtBarrier()).toMatchObject({
          source: `${source}${eol}${eol}\`\`\`${eol}after${eol}\`\`\`${eol}`
        })
        await model.undoUntil(`${source}${eol}`)
        expect(model.binding.sourceAtBarrier()).toMatchObject({ source: `${source}${eol}` })
      } finally {
        model.dispose()
      }
    }
  )
}

it('appends a heading beyond tracked text at an EOF without a line ending', async() => {
  const model = openModel('plain')
  try {
    model.select(5)
    model.type('X', true)
    expect(model.binding.sourceAtBarrier()).toMatchObject({ source: 'plain{++X++}' })
    model.select('plain{++X++}'.length)
    model.input('insertParagraph')
    model.type('# Heading')
    await model.adapter.settled()
    // Enter ends the new final paragraph's line, as upstream writes it.
    expect(model.binding.sourceAtBarrier()).toMatchObject({ source: 'plain{++X++}\n\n# Heading\n' })
    await model.undoUntil('plain')
    expect(model.binding.sourceAtBarrier()).toMatchObject({ source: 'plain' })
  } finally {
    model.dispose()
  }
})

it('uses the accepted tracked replacement while adding a heading and editing both leaves', async() => {
  const model = openModel('plain')
  try {
    model.select(0, 1)
    model.type('X', true)
    expect(model.view()[0].text).toBe('pXlain')
    const replaced = '{~~p~>X~~}lain'
    expect(model.binding.sourceAtBarrier()).toMatchObject({ source: replaced })
    model.select(replaced.length)
    model.input('insertParagraph')
    model.type('# Heading')
    model.select(replaced.length)
    model.type('Z')
    await model.adapter.settled()
    expect(model.binding.sourceAtBarrier()).toMatchObject({
      source: '{~~p~>X~~}lainZ\n\n# Heading\n'
    })
    await model.undoUntil('plain')
    expect(model.binding.sourceAtBarrier()).toMatchObject({ source: 'plain' })
  } finally {
    model.dispose()
  }
})
