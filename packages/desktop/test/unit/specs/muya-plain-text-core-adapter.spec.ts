import type { DocumentSourceEdit } from '@marktext/document-core'
import type { DocumentEditing } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'

import {
  createMuyaPlainTextCoreAdapter,
  type MuyaPlainTextSourceBinding
} from '@/documentAuthority/muyaPlainTextCoreAdapter'
import type {
  EditorCoreApplyOutcome,
  EditorCoreBinding,
  EditorCoreSubmitInput,
  EditorCoreSubmission
} from '@/documentAuthority/editorCoreBinding'
import type { CoreAuthorityPerformanceEvent } from '@/documentAuthority/coreAuthorityPerformanceTrace'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { mappedMuyaSourceRange } from '@/documentAuthority/muyaMarkupView'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { muyaClipboardToModel, muyaFormatToModel } from '@/documentAuthority/muyaModelSelection'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const unexpectedPreparation = (): never => {
  throw new Error('Unexpected resource preparation')
}
const preparationMethods = {
  retainSelection: unexpectedPreparation,
  retainedSelectionAtBarrier: unexpectedPreparation,
  releaseSelection: unexpectedPreparation
}
const unexpectedBinding = {
  ...preparationMethods,
  submit: (): never => {
    throw new Error('Unexpected submission')
  }
}

const compositionInput = (at: number) => ({
  range: { start: at, end: at },
  selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
  inputType: 'insertCompositionText',
  data: null,
  options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
})

const recordingModelBinding = (documentId: string, inputs: EditorCoreSubmitInput[]) => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId, source: 'seed\n' })
  return {
    submit(input: EditorCoreSubmitInput) {
      inputs.push(structuredClone(input))
      return binding.submit(input)
    },
    retainSelection: binding.retainSelection,
    retainedSelectionAtBarrier: binding.retainedSelectionAtBarrier,
    releaseSelection: binding.releaseSelection,
    sourceAtBarrier: binding.sourceAtBarrier,
    dispose: binding.dispose
  }
}

const liveModelAdapter = (source: string) => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'native-command.md', source })
  const view = () => {
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Missing model view')
    return reply.view
  }
  const reconcile = () => view().bindings
  const adapter = createMuyaPlainTextCoreAdapter(view().bindings, binding, undefined, reconcile)
  return {
    binding,
    adapter,
    reconcile,
    dispose() {
      adapter.dispose()
      binding.dispose()
    }
  }
}

const applied = (
  revision: number,
  edit: DocumentSourceEdit
): Extract<EditorCoreApplyOutcome, { readonly type: 'applied' }> =>
  Object.freeze({
    type: 'applied',
    session: 1,
    sequence: revision,
    revision,
    accepted: true,
    sourceLength: 20,
    diagnosticCount: 0,
    diagnostics: Object.freeze([]),
    change: Object.freeze({
      appliedEdits: Object.freeze([Object.freeze({ ...edit })]),
      projections: Object.freeze([])
    })
  })

const mockOutcome = (
  outcomes: readonly EditorCoreApplyOutcome[],
  count: number
): EditorCoreApplyOutcome => {
  const outcome = outcomes[count - 1]
  if (outcome === undefined) throw new Error('Unexpected additional model operation')
  return outcome
}

describe('Muya plain-text Core command lane', () => {
  it.each(['paragraph', 'code'] as const)(
    'queues native fence typing and %s state from an empty paragraph before its first acknowledgement',
    async(target) => {
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => {}
      })
      await binding.open({ documentId: 'empty-native-fence.md', source: '\n' })
      const initial = binding.plainTextViewAtBarrier()
      if (initial.type !== 'plain-text-view') throw new Error('Missing view')
      const reconcile = () => {
        const next = binding.plainTextViewAtBarrier()
        if (next.type !== 'plain-text-view') throw new Error('Missing view')
        return next.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        binding,
        undefined,
        reconcile
      )
      let text = ''
      for (const character of '```js') {
        const next = text + character
        expect(
          adapter.accept({
            source: 'user',
            prevDoc: [{ name: 'paragraph', text }],
            doc: [{ name: 'paragraph', text: next }],
            op: [0, 'text', { es: [...(text.length === 0 ? [] : [text.length]), character] }]
          }),
          JSON.stringify({ text, bindings: initial.view.bindings })
        ).toBe('accepted')
        text = next
      }
      if (target === 'code') {
        const code = { name: 'code-block', meta: { lang: 'js', type: 'fenced' }, text: '' }
        expect(
          adapter.accept({
            source: 'user',
            prevDoc: [{ name: 'paragraph', text }],
            doc: [code],
            op: [0, { r: true, i: code }]
          })
        ).toBe('accepted')
      }
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: target === 'paragraph' ? '```js\n' : '```js\n\n```\n'
      })
      adapter.dispose()
    }
  )

  it.each(['ordinary', 'tracked'] as const)(
    'preserves an annotation during %s native bullet-list conversion and history',
    async(lane) => {
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => {}
      })
      const source = '{++plain++}\n\nuntouched\n'
      await binding.open({ documentId: 'annotated-list.md', source })
      const initial = binding.plainTextViewAtBarrier()
      if (initial.type !== 'plain-text-view' || !('state' in initial.view)) {
        throw new Error('Missing view')
      }
      const reconcile = () => {
        const next = binding.plainTextViewAtBarrier()
        if (next.type !== 'plain-text-view') throw new Error('Missing view')
        return next.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        binding,
        undefined,
        reconcile
      )
      const list = {
        name: 'bullet-list',
        meta: { marker: '-', loose: false },
        children: [{ name: 'list-item', children: [initial.view.state[0]] }]
      }
      const change = {
        source: 'user',
        prevDoc: initial.view.state,
        doc: [list, initial.view.state[1]],
        op: [0, { r: true, i: list }]
      }
      expect(
        lane === 'ordinary' ? adapter.accept(change) : adapter.acceptTracked(change, reconcile)
      ).toBe('accepted')
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source:
          lane === 'ordinary' ? '- {++plain++}\n\nuntouched\n' : '{++- plain++}\n\nuntouched\n'
      })
      const next = binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view' || !('state' in next.view)) {
        throw new Error('Missing view')
      }
      expect(next.view.state[0]).toMatchObject({
        name: 'bullet-list',
        children: [{ name: 'list-item' }]
      })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
      adapter.dispose()
    }
  )

  it.each(['tracked', 'queued-semantic'] as const)(
    'maps a %s native code conversion through the shared structural decoder',
    async(lane) => {
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => {}
      })
      await binding.open({ documentId: 'code.md', source: '{++seed++}\n\nplain\n' })
      const initial = binding.plainTextViewAtBarrier()
      if (initial.type !== 'plain-text-view') throw new Error('Missing view')
      const reconcile = () => {
        const next = binding.plainTextViewAtBarrier()
        if (next.type !== 'plain-text-view') throw new Error('Missing view')
        return next.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        binding,
        undefined,
        reconcile
      )
      const first = { name: 'paragraph', text: 'seed' }
      const plain = { name: 'paragraph', text: 'plain' }
      const prior = [first, plain]
      if (lane === 'queued-semantic') {
        const typed = { name: 'paragraph', text: 'seed!' }
        expect(
          adapter.acceptTracked(
            {
              source: 'user',
              prevDoc: prior,
              doc: [typed, plain],
              op: [0, 'text', { es: [4, '!'] }]
            },
            reconcile,
            true
          )
        ).toBe('accepted')
        prior[0] = typed
      }
      const code = { name: 'code-block', text: 'plain', meta: { type: 'fenced', lang: 'js' } }
      expect(
        adapter.acceptTracked(
          {
            source: 'user',
            prevDoc: prior,
            doc: [prior[0], code],
            op: [1, { r: true, i: code }]
          },
          reconcile,
          lane === 'queued-semantic'
        )
      ).toBe('accepted')
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source:
          lane === 'tracked'
            ? '{++seed++}\n\n{~~plain~>```js\nplain\n```~~}\n'
            : '{++seed!++}\n\n```js\nplain\n```\n'
      })
      adapter.dispose()
    }
  )

  it.each(['before {++plain++} after\n', '{++plain++} after\n'])(
    'preserves existing annotations when a native heading formats %s',
    async(source) => {
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => {}
      })
      await binding.open({ documentId: 'annotated-heading.md', source })
      const view = binding.plainTextViewAtBarrier()
      if (view.type !== 'plain-text-view') throw new Error('Missing view')
      const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
      const at = view.view.bindings[0].sourceRange.start
      expect(
        adapter.input(
          {
            kind: 'command',
            command: 'changeHeading',
            change: { type: 'set', level: 1 },
            selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
            options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
          },
          () => {
            const next = binding.plainTextViewAtBarrier()
            if (next.type !== 'plain-text-view') throw new Error('Missing view')
            return next.view.bindings
          }
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: `# ${source}` })
      adapter.dispose()
    }
  )

  it.each(
    (['ordinary', 'markup', 'tracked'] as const).flatMap((lane) =>
      [false, true].flatMap((finishInSameTask) =>
        [false, true].map((queued) => ({ lane, finishInSameTask, queued }))
      )
    )
  )(
    'preserves an IME draft after earlier synchronous input: $lane, sameTaskEnd=$finishInSameTask, queued=$queued',
    async({ lane, finishInSameTask, queued }) => {
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => {}
      })
      const source = lane === 'markup' ? '{++seed++}\n' : 'seed\n'
      await binding.open({ documentId: 'pending-ime.md', source })
      const initial = binding.plainTextViewAtBarrier()
      if (initial.type !== 'plain-text-view') throw new Error('Missing view')
      let reconciled = 0
      const protectedDrafts: boolean[] = []
      const reconcile = () => {
        protectedDrafts.push(adapter.hasPendingEdits())
        const reply = binding.plainTextViewAtBarrier()
        if (reply.type !== 'plain-text-view') throw new Error('Missing view')
        reconciled += 1
        return reply.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        binding,
        undefined,
        reconcile
      )
      const accept = (before: string, after: string, offset: number, insert: string) => {
        const change = {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: before }],
          doc: [{ name: 'paragraph', text: after }],
          op: [0, 'text', { es: [offset, insert] }]
        }
        return lane === 'tracked'
          ? adapter.acceptTracked(change, reconcile)
          : adapter.accept(change)
      }
      expect(accept('seed', 'seedX', 4, 'X')).toBe('accepted')
      if (queued) expect(accept('seedX', 'seedXY', 5, 'Y')).toBe('accepted')
      const base = queued ? 'seedXY' : 'seedX'
      const live = binding.plainTextViewAtBarrier()
      if (live.type !== 'plain-text-view') throw new Error('Missing composition view')
      const sourceRange = mappedMuyaSourceRange(live.view.bindings[0]!, {
        start: base.length,
        end: base.length
      })
      if (sourceRange === undefined) throw new Error('Missing composition source position')
      adapter.compositionStart(compositionInput(sourceRange.start))
      const saved = adapter.settled()
      saved.catch(() => {})
      adapter.compositionUpdate('日')
      if (!finishInSameTask) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(reconciled).toBe(queued ? 2 : 1)
        expect(protectedDrafts).toEqual(Array(queued ? 2 : 1).fill(false))
      }
      adapter.compositionUpdate('日本')
      const ending = adapter.compositionEnd(
        { kind: 'commit', data: '日本' },
        reconcile,
        lane === 'tracked'
      )
      expect(ending).toEqual({ accepted: true, changed: true })
      await saved
      const expected =
        lane === 'ordinary'
          ? `${base}日本\n`
          : lane === 'markup'
            ? `{++${base}日本++}\n`
            : `seed{++${queued ? 'XY' : 'X'}日本++}\n`
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source:
          lane === 'ordinary'
            ? `${base}\n`
            : lane === 'markup'
              ? `{++${base}++}\n`
              : `seed{++${queued ? 'XY' : 'X'}++}\n`
      })
      adapter.dispose()
    }
  )

  it.each([false, true])(
    'keeps admitted presentation when composition ends without committed input: cancelled=%s',
    async(cancelled) => {
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
      binding.open({ documentId: 'cancel-ime.md', source: 'seed\n' })
      const initial = binding.plainTextViewAtBarrier()
      if (initial.type !== 'plain-text-view') throw new Error('Missing composition view')
      const protectedDrafts: boolean[] = []
      const reconcile = () => {
        protectedDrafts.push(adapter.hasPendingEdits())
        const current = binding.plainTextViewAtBarrier()
        if (current.type !== 'plain-text-view') throw new Error('Missing acknowledged view')
        return current.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        binding,
        undefined,
        reconcile
      )
      try {
        expect(
          adapter.input({ ...compositionInput(4), inputType: 'insertText', data: 'X' }, reconcile)
        ).toEqual({ accepted: true, changed: true })
        const before = binding.sourceAtBarrier()
        expect(before).toMatchObject({ source: 'seedX\n' })
        adapter.compositionStart(compositionInput(5))
        if (cancelled) adapter.compositionUpdate('日')
        const settled = adapter.settled()
        if (before.type !== 'source') throw new Error('Missing source checkpoint')
        expect(binding.sourceAtBarrier()).toMatchObject({
          source: before.source,
          revision: before.revision,
          recoveryHistory: before.recoveryHistory
        })
        expect(adapter.compositionEnd({ kind: 'cancel' }, reconcile)).toEqual({
          accepted: true,
          changed: false
        })
        await settled
        expect(binding.sourceAtBarrier()).toMatchObject({
          source: before.source,
          revision: before.revision,
          recoveryHistory: before.recoveryHistory
        })
        expect(protectedDrafts).toEqual([false, false])
      } finally {
        adapter.dispose()
        binding.dispose()
      }
    }
  )

  it.each(['ordinary', 'semantic'] as const)(
    'orders the heading command immediately after a %s edit in a different annotated paragraph',
    async(lane) => {
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => {}
      })
      await binding.open({ documentId: 'queued-heading.md', source: '{++seed++}\n\nplain\n' })
      const view = binding.plainTextViewAtBarrier()
      if (view.type !== 'plain-text-view') throw new Error('Missing view')
      const reconcile = () => {
        const reply = binding.plainTextViewAtBarrier()
        if (reply.type !== 'plain-text-view') throw new Error('Missing view')
        return reply.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        view.view.bindings,
        binding,
        undefined,
        reconcile
      )
      const accept = (change: unknown) =>
        lane === 'ordinary'
          ? adapter.accept(change)
          : adapter.acceptTracked(change, reconcile, true)
      const original = [
        { name: 'paragraph', text: 'seed' },
        { name: 'paragraph', text: 'plain' }
      ]
      const typed = [{ name: 'paragraph', text: 'seed!' }, original[1]]
      expect(
        accept({
          source: 'user',
          prevDoc: original,
          doc: typed,
          op: [0, 'text', { es: [4, '!'] }]
        })
      ).toBe('accepted')
      const target = reconcile().find((item) => item.path[0] === 1)?.sourceRange
      if (target === undefined) throw new Error('Missing second paragraph')
      const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      expect(
        adapter.input(
          {
            range: target,
            selection: { ranges: [{ anchor: target.start, focus: target.end }], primary: 0 },
            inputType: 'insertText',
            data: 'title',
            options
          },
          reconcile
        )
      ).toEqual({ accepted: true, changed: true })
      expect(
        adapter.input(
          {
            kind: 'command',
            command: 'changeHeading',
            change: { type: 'set', level: 1 },
            selection: { ranges: [{ anchor: target.start, focus: target.start }], primary: 0 },
            options
          },
          reconcile
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: '{++seed!++}\n\n# title\n' })
      adapter.dispose()
    }
  )

  it('does not flatten an annotation arm or accept changed child text as a blockquote wrapper', () => {
    const submissions: EditorCoreSubmitInput[] = []
    for (const annotationContext of [false, true]) {
      const adapter = createMuyaPlainTextCoreAdapter(
        [
          {
            path: [0, 'text'],
            text: 'plain',
            sourceRange: { start: 0, end: 5 },
            ...(annotationContext ? { annotationContext: true as const } : {})
          }
        ],
        {
          ...preparationMethods,
          submit(input) {
            submissions.push(input)
            throw new Error('Unexpected submission')
          }
        }
      )
      const quote = {
        name: 'block-quote',
        children: [
          {
            name: 'paragraph',
            text: annotationContext ? 'plain' : 'changed'
          }
        ]
      }
      expect(
        adapter.accept({
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'plain' }],
          doc: [quote],
          op: [0, { r: true, i: quote }]
        })
      ).toBe('unsupported')
      adapter.dispose()
    }
    expect(submissions).toEqual([])
  })

  it('applies the native blockquote command and accepts text at its reconciled nested path', async() => {
    const app = liveModelAdapter('plain\n')
    const { adapter, binding, reconcile } = app
    const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
    try {
      expect(
        adapter.input(
          {
            kind: 'command',
            command: 'changeBlockquote',
            change: { type: 'set' },
            selection: { ranges: [{ anchor: 5, focus: 5 }], primary: 0 },
            options
          },
          reconcile
        )
      ).toEqual({ accepted: true, changed: true })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: '> plain\n' })
      expect(
        adapter.input(
          {
            inputType: 'insertText',
            data: '!',
            range: { start: 7, end: 7 },
            selection: { ranges: [{ anchor: 7, focus: 7 }], primary: 0 },
            options
          },
          reconcile
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(binding.sourceAtBarrier()).toMatchObject({ source: '> plain!\n' })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: '> plain\n' })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: 'plain\n' })
      await adapter.history('redo', reconcile)
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: '> plain!\n' })
      const core = createDocumentCore()
      expect(core.project(core.open('> plain!\n'), 'revised').markdown).toBe('> plain!\n')
    } finally {
      app.dispose()
    }
  })

  it('uses the direct source lane for a leaf outside all annotation contexts', async() => {
    const inputs: EditorCoreSubmitInput[] = []
    const adapter = createMuyaPlainTextCoreAdapter(
      [
        {
          path: [0, 'text'],
          text: 'plain',
          sourceRange: { start: 0, end: 5 }
        }
      ],
      {
        ...preparationMethods,
        submit(input) {
          inputs.push(input)
          return {
            identity: { documentId: 'plain.md', generation: 1, transactionId: 1 },
            acknowledged: applied(2, { start: 5, end: 5, insert: '!' })
          }
        }
      },
      undefined,
      () => [{ path: [0, 'text'], text: 'plain!', sourceRange: { start: 0, end: 6 } }]
    )
    adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'plain' }],
      doc: [{ name: 'paragraph', text: 'plain!' }],
      op: [0, 'text', { es: [5, '!'] }]
    })
    await adapter.settled()
    expect(inputs).toEqual([{ edits: [{ start: 5, end: 5, insert: '!' }], projections: [] }])
    adapter.dispose()
  })
  it('maps each native input against the latest model revision across task boundaries', async() => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => {}
    })
    await binding.open({ documentId: 'burst.md', source: '{++seed++}\n' })
    const view = binding.plainTextViewAtBarrier()
    if (view.type !== 'plain-text-view') throw new Error('Missing view')
    const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding, undefined, () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view') throw new Error('Missing view')
      return reply.view.bindings
    })
    const type = (previous: string, character: string) =>
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: previous }],
        doc: [{ name: 'paragraph', text: previous + character }],
        op: [0, 'text', { es: [previous.length, character] }]
      })
    expect(type('seed', '1')).toBe('accepted')
    expect(type('seed1', '2')).toBe('accepted')
    expect(type('seed12', '3')).toBe('accepted')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(binding.sourceAtBarrier()).toMatchObject({ source: '{++seed123++}\n' })
    expect(type('seed123', '4')).toBe('accepted')
    for (let count = 0; count < 3; count += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: '{++seed1234++}\n' })
    adapter.dispose()
  })
  it('rebases text queued behind an ordinary paragraph split before publishing it', async() => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => {}
    })
    await binding.open({ documentId: 'split.md', source: 'seed\n' })
    const view = binding.plainTextViewAtBarrier()
    if (view.type !== 'plain-text-view') throw new Error('Missing view')
    const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding, undefined, () => {
      const view = binding.plainTextViewAtBarrier()
      if (view.type !== 'plain-text-view') throw new Error('Missing view')
      return view.view.bindings
    })
    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [
          { name: 'paragraph', text: 'seed' },
          { name: 'paragraph', text: '' }
        ],
        op: [1, { i: { name: 'paragraph', text: '' } }]
      })
    ).toBe('accepted')
    let previous = ''
    for (const character of 'next') {
      expect(
        adapter.accept({
          source: 'user',
          prevDoc: [
            { name: 'paragraph', text: 'seed' },
            { name: 'paragraph', text: previous }
          ],
          doc: [
            { name: 'paragraph', text: 'seed' },
            { name: 'paragraph', text: previous + character }
          ],
          op: [
            1,
            'text',
            { es: previous.length === 0 ? [character] : [previous.length, character] }
          ]
        })
      ).toBe('accepted')
      previous += character
    }
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed\n\nnext\n' })
    adapter.dispose()
  })
  it('keeps an ordinary IME composition untracked through its deferred commit', async() => {
    const inputs: EditorCoreSubmitInput[] = []
    const binding = recordingModelBinding('ime.md', inputs)
    const adapter = createMuyaPlainTextCoreAdapter(
      [
        {
          path: [0, 'text'],
          text: 'seed',
          annotationContext: true,
          sourceRange: { start: 0, end: 4 }
        }
      ],
      binding,
      undefined,
      () => [{ path: [0, 'text'], text: 'seed日', sourceRange: { start: 0, end: 5 } }]
    )
    adapter.compositionStart(compositionInput(4))
    adapter.compositionUpdate('日')
    expect(inputs).toEqual([])
    expect(adapter.compositionEnd({ kind: 'commit', data: '日' }, () => [])).toEqual({
      accepted: true,
      changed: true
    })
    await adapter.settled()
    expect(inputs).toEqual([
      {
        kind: 'input',
        action: { ...compositionInput(4), data: '日' },
        tracked: false,
        projections: []
      }
    ])
    expect(binding.sourceAtBarrier()).toMatchObject({ source: 'seed日\n' })
    adapter.dispose()
    binding.dispose()
  })
  it('resumes the acknowledged revision when the editor remounts after a saved edit', () => {
    const adapter = createMuyaPlainTextCoreAdapter([], unexpectedBinding, undefined, undefined, 7)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 7 })
    adapter.dispose()
  })
  it('settles an ordinary Markdown edit only after its semantic presentation reconciles', async() => {
    let reconciled = false
    const adapter = createMuyaPlainTextCoreAdapter(
      [
        {
          path: [0, 'text'],
          text: 'seed',
          sourceRange: { start: 0, end: 4 }
        }
      ],
      {
        ...preparationMethods,
        submit: () => ({
          identity: { documentId: 'ordinary.md', generation: 1, transactionId: 1 },
          acknowledged: applied(2, { start: 4, end: 4, insert: '!' })
        })
      },
      undefined,
      () => {
        reconciled = true
        return [{ path: [0, 'text'], text: 'seed!', sourceRange: { start: 0, end: 5 } }]
      }
    )
    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [{ name: 'paragraph', text: 'seed!' }],
        op: [0, 'text', { es: [4, '!'] }]
      })
    ).toBe('accepted')
    await adapter.settled()
    expect(reconciled).toBe(true)
    adapter.dispose()
  })

  it('keeps canonical segment coordinates through consecutive ordinary edits inside an addition', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const adapter = createMuyaPlainTextCoreAdapter(
      [
        {
          path: [0, 'text'],
          text: 'seed A',
          sourceRange: { start: 0, end: 12 },
          segments: [
            { text: { start: 0, end: 4 }, source: { start: 0, end: 4 } },
            { text: { start: 4, end: 6 }, source: { start: 7, end: 9 } }
          ]
        }
      ],
      {
        ...preparationMethods,
        submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
          submissions.push(input)
          const edit = 'edits' in input ? input.edits[0] : undefined
          if (edit === undefined) throw new Error('Expected ordinary edit')
          return {
            identity: {
              documentId: 'ordinary.md',
              generation: 1,
              transactionId: submissions.length
            },
            acknowledged: applied(submissions.length + 1, edit)
          }
        }
      }
    )
    for (const [previous, next, offset, insert] of [
      ['seed A', 'seed AB', 6, 'B'],
      ['seed AB', 'seed ABC', 7, 'C']
    ] as const) {
      expect(
        adapter.accept({
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: previous }],
          doc: [{ name: 'paragraph', text: next }],
          op: [0, 'text', { es: [offset, insert] }]
        })
      ).toBe('accepted')
      await adapter.settled()
    }
    expect(submissions.map((input) => ('edits' in input ? input.edits : undefined))).toEqual([
      [{ start: 9, end: 9, insert: 'B' }],
      [{ start: 10, end: 10, insert: 'C' }]
    ])
    expect(
      adapter.selectionSourceRange({
        anchor: { path: [0, 'text'], offset: 4 },
        focus: { path: [0, 'text'], offset: 8 }
      })
    ).toEqual({ start: 7, end: 11 })
    adapter.dispose()
  })

  it('adopts an externally authorized applied revision only through reconciliation', async() => {
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 3 }),
          text: 'cat'
        }
      ]),
      unexpectedBinding
    )

    await expect(
      adapter.reconcileApplied(applied(2, { start: 0, end: 3, insert: 'dog' }), () =>
        Object.freeze([
          {
            path: Object.freeze([0, 'text'] as const),
            sourceRange: Object.freeze({ start: 0, end: 3 }),
            text: 'dog'
          }
        ])
      )
    ).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
    expect(
      adapter.selectionSourceRange({
        anchor: { path: [0, 'text'], offset: 0 },
        focus: { path: [0, 'text'], offset: 3 }
      })
    ).toEqual({ start: 0, end: 3 })
    adapter.dispose()
  })

  it('maps a live bound selection to canonical source coordinates without widening scope', () => {
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 11, end: 15 }),
          text: 'seed'
        },
        {
          path: Object.freeze([1, 'text'] as const),
          sourceRange: Object.freeze({ start: 17, end: 21 }),
          text: 'next'
        }
      ]),
      unexpectedBinding
    )

    expect(
      adapter.selectionSourceRange({
        anchor: { path: [0, 'text'], offset: 4 },
        focus: { path: [0, 'text'], offset: 1 }
      })
    ).toEqual({ start: 12, end: 15 })
    expect(
      adapter.selectionSourceRange({
        anchor: { path: [0, 'text'], offset: 1 },
        focus: { path: [1, 'text'], offset: 2 }
      })
    ).toEqual({ start: 12, end: 19 })
    expect(
      adapter.selectionSourceRange({
        anchor: { path: [1, 'text'], offset: 2 },
        focus: { path: [0, 'text'], offset: 1 }
      })
    ).toEqual({ start: 12, end: 19 })
    expect(
      adapter.selectionSourceRange({
        anchor: { path: [0, 'text'], offset: 1 },
        focus: { path: [0, 'text'], offset: 1 }
      })
    ).toBeUndefined()
    expect(
      adapter.selectionSourceRange({
        anchor: { path: [0, 'text'], offset: 1 },
        focus: { path: [2, 'text'], offset: 1 }
      })
    ).toBeUndefined()
    expect(
      adapter.selectionSourceRange({
        anchor: { path: [0, 'text'], offset: 1 },
        focus: { path: [1, 'text'], offset: 5 }
      })
    ).toBeUndefined()

    adapter.dispose()
  })

  it('submits an empty Comment payload and distinguishes it from cancellation', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'empty-comment.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 0,
            end: 4,
            insert: '{==seed==}{>><<}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ]),
      binding
    )

    await expect(
      adapter.author(
        'comment',
        {
          anchor: { path: [0, 'text'], offset: 0 },
          focus: { path: [0, 'text'], offset: 4 }
        },
        '',
        () => Object.freeze([])
      )
    ).resolves.toMatchObject({
      type: 'applied',
      revision: 2
    })
    expect(submissions).toEqual([
      {
        kind: 'author',
        form: 'comment',
        range: { start: 0, end: 4 },
        text: '',
        projections: []
      }
    ])
  })

  it('reports bounded dispatch, acknowledgement, and reconciliation phases', async() => {
    const events: CoreAuthorityPerformanceEvent[] = []
    let now = 10
    const binding = {
      ...preparationMethods,
      submit(): EditorCoreSubmission {
        now = 13
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'latency.md',
            generation: 1,
            transactionId: 7
          }),
          acknowledged: applied(2, {
            start: 4,
            end: 4,
            insert: '!'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ]),
      binding,
      {
        documentId: 'latency.md',
        record(event) {
          events.push(Object.freeze({ ...event }))
        },
        clock: () => now
      }
    )

    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [{ name: 'paragraph', text: 'seed!' }],
        op: [0, 'text', { es: [4, '!'] }]
      })
    ).toBe('accepted')
    now = 13
    await Promise.resolve()
    now = 15
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(events).toEqual([
      {
        phase: 'dispatch',
        documentId: 'latency.md',
        transaction: 7,
        pendingDepth: 1,
        insertedUnits: 1,
        deletedUnits: 0,
        at: 10
      },
      {
        phase: 'ack',
        documentId: 'latency.md',
        transaction: 7,
        at: 13
      },
      {
        phase: 'reconcile',
        documentId: 'latency.md',
        transaction: 7,
        corrected: false,
        at: 13
      }
    ])
  })

  it('routes one native insertion through actor-owned Track Changes and rebinds before settlement', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-one.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, { start: 4, end: 4, insert: '{++!++}' })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ]),
      binding
    )

    expect(
      adapter.acceptTracked(
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'seed' }],
          doc: [{ name: 'paragraph', text: 'seed!' }],
          op: [0, 'text', { es: [4, '!'] }]
        },
        () => Object.freeze([])
      )
    ).toBe('accepted')
    expect(submissions).toEqual([
      {
        kind: 'track',
        range: { start: 4, end: 4 },
        text: '!',
        projections: []
      }
    ])
    expect(submissions[0]).not.toHaveProperty('edits')

    const barrier = adapter.settled()

    await Promise.resolve()
    let settled = false
    barrier
      .then(() => {
        settled = true
      })
      .catch(() => {})
    await Promise.resolve()
    expect(settled).toBe(true)

    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('routes one native replacement through actor-owned Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-replacement.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 1,
            end: 2,
            insert: '{~~b~>X~~}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 2 }),
          text: 'ab'
        }
      ]),
      binding
    )

    expect(
      adapter.acceptTracked(
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'ab' }],
          doc: [{ name: 'paragraph', text: 'aX' }],
          op: [0, 'text', { es: [1, { d: 'b' }, 'X'] }]
        },
        () => Object.freeze([])
      )
    ).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(submissions).toEqual([
      {
        kind: 'track',
        range: { start: 1, end: 2 },
        text: 'X',
        projections: []
      }
    ])
  })

  it('admits a second tracked keystroke against the first result in the same task', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-fast-typing.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: mockOutcome(
            [
              applied(2, { start: 4, end: 4, insert: '{++!++}' }),
              applied(3, { start: 8, end: 8, insert: '?' })
            ],
            submissions.length
          )
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const initialBindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 4 }),
        text: 'seed'
      }
    ])
    const afterFirst = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 3, end: 8 }),
        text: 'seed!'
      }
    ])
    const afterSecond = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 3, end: 9 }),
        text: 'seed!?'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(initialBindings, binding)
    let reconciliation = 0
    const reconcile = () => (reconciliation++ === 0 ? afterFirst : afterSecond)

    expect(
      adapter.acceptTracked(
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'seed' }],
          doc: [{ name: 'paragraph', text: 'seed!' }],
          op: [0, 'text', { es: [4, '!'] }]
        },
        reconcile
      )
    ).toBe('accepted')
    expect(
      adapter.acceptTracked(
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'seed!' }],
          doc: [{ name: 'paragraph', text: 'seed!?' }],
          op: [0, 'text', { es: [5, '?'] }]
        },
        reconcile
      )
    ).toBe('accepted')

    expect(submissions).toEqual([
      { kind: 'track', range: { start: 4, end: 4 }, text: '!', projections: [] },
      { kind: 'track', range: { start: 8, end: 8 }, text: '?', projections: [] }
    ])

    await Promise.resolve()
    await Promise.resolve()
    expect(submissions).toEqual([
      {
        kind: 'track',
        range: { start: 4, end: 4 },
        text: '!',
        projections: []
      },
      {
        kind: 'track',
        range: { start: 8, end: 8 },
        text: '?',
        projections: []
      }
    ])

    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 3 })
  })

  it('commits one native composition as one actor-owned tracked change', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = recordingModelBinding('track-composition.md', submissions)
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ]),
      binding
    )

    adapter.compositionStart(compositionInput(4))
    const saveBarrier = adapter.settled()
    adapter.compositionUpdate('日')
    adapter.compositionUpdate('日本')
    expect(submissions).toEqual([])

    const ending = adapter.compositionEnd({ kind: 'commit', data: '日本' }, () => [], true)
    expect(submissions).toEqual([
      {
        kind: 'input',
        action: { ...compositionInput(4), data: '日本' },
        tracked: true,
        projections: []
      }
    ])
    expect(ending).toEqual({ accepted: true, changed: true })
    await expect(saveBarrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
    expect(binding.sourceAtBarrier()).toMatchObject({ source: 'seed{++日本++}\n' })
    adapter.dispose()
    binding.dispose()
  })

  it('resolves one Review item through the actor lane and settles after view reconciliation', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'review.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 7,
            end: 16,
            insert: 'old'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([]), binding)

    const resolving = adapter.resolve(
      { kind: 'deletion', range: { start: 7, end: 16 } },
      1,
      'reject',
      () => Object.freeze([])
    )
    const barrier = adapter.settled()
    await Promise.resolve()

    expect(submissions).toEqual([
      {
        kind: 'resolve',
        authoredRevision: 1,
        annotation: { kind: 'deletion', range: { start: 7, end: 16 } },
        decision: 'reject',
        projections: []
      }
    ])
    let resolved = false
    resolving
      .then(() => {
        resolved = true
      })
      .catch(() => {})
    await Promise.resolve()
    expect(resolved).toBe(true)

    await expect(resolving).resolves.toMatchObject({ revision: 2 })
    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('resolves all Review suggestions through one atomic actor command', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'resolve-all.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 2,
            end: 11,
            insert: 'new'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 3 }),
        text: 'new'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(adapter.resolveAll('accept', () => bindings)).resolves.toMatchObject({
      type: 'applied',
      revision: 2
    })
    expect(submissions).toEqual([
      {
        kind: 'resolve-all',
        decision: 'accept',
        projections: []
      }
    ])
  })

  it('edits one Review Comment through the actor lane before settlement', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'edit-comment.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 17,
            end: 31,
            insert: '{>>new note<<}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 10, end: 14 }),
        text: 'text'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)
    let reconciled = false

    await expect(
      adapter.editComment(
        {
          kind: 'commented-span',
          range: { start: 7, end: 31 },
          highlightRange: { start: 7, end: 17 },
          commentRange: { start: 17, end: 31 }
        },
        1,
        'new note',
        () => {
          reconciled = true
          return bindings
        }
      )
    ).resolves.toMatchObject({ type: 'applied', revision: 2 })

    expect(submissions).toEqual([
      {
        kind: 'edit-comment',
        authoredRevision: 1,
        annotation: {
          kind: 'commented-span',
          range: { start: 7, end: 31 },
          highlightRange: { start: 7, end: 17 },
          commentRange: { start: 17, end: 31 }
        },
        text: 'new note',
        projections: []
      }
    ])
    expect(reconciled).toBe(true)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('keeps Comment editing ready after a no-change or stale target refusal', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const reasons = ['no-change', 'annotation-not-found'] as const
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const reason = reasons[submissions.length - 1]
        if (reason === undefined) throw new Error('Unexpected Comment edit')
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'edit-comment-refusal.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: Object.freeze({
            type: 'rejected' as const,
            session: 1,
            sequence: submissions.length,
            revision: 1,
            accepted: false as const,
            reason,
            sourceLength: 31
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([]), binding)
    const locator = Object.freeze({
      kind: 'comment' as const,
      range: Object.freeze({ start: 17, end: 31 })
    })
    let reconciliations = 0
    const reconcile = () => {
      reconciliations += 1
      return Object.freeze([])
    }

    await expect(adapter.editComment(locator, 1, 'same', reconcile)).resolves.toBeUndefined()
    await expect(adapter.editComment(locator, 1, 'stale', reconcile)).resolves.toBeUndefined()
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(reconciliations).toBe(0)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 1 })
    expect(submissions).toHaveLength(2)
  })

  it('keeps WYSIWYG authority ready after a stale Review locator is rejected', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const outcome: EditorCoreApplyOutcome =
          input.kind === 'resolve'
            ? Object.freeze({
              type: 'rejected',
              session: 1,
              sequence: 1,
              revision: 1,
              accepted: false,
              reason: 'annotation-not-found',
              sourceLength: 4
            })
            : applied(2, { start: 4, end: 4, insert: '!' })
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'stale-review.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: outcome
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ]),
      binding
    )
    let reconciled = false

    await expect(
      adapter.resolve({ kind: 'deletion', range: { start: 7, end: 16 } }, 1, 'reject', () => {
        reconciled = true
        return Object.freeze([])
      })
    ).resolves.toBeUndefined()
    expect(reconciled).toBe(false)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 1 })

    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [{ name: 'paragraph', text: 'seed!' }],
        op: [0, 'text', { es: [4, '!'] }]
      })
    ).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
    expect(submissions).toHaveLength(2)
  })

  it('keeps WYSIWYG authority ready after a history-resource Review refusal', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const outcome: EditorCoreApplyOutcome =
          input.kind === 'resolve'
            ? Object.freeze({
              type: 'rejected',
              session: 1,
              sequence: 1,
              revision: 1,
              accepted: false,
              reason: 'history-resource',
              sourceLength: 12
            })
            : applied(2, { start: 4, end: 4, insert: '!' })
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'history-resource-review.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: outcome
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 4 }),
        text: 'seed'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)
    let reconciled = false

    await expect(
      adapter.resolve({ kind: 'addition', range: { start: 0, end: 12 } }, 1, 'accept', () => {
        reconciled = true
        return bindings
      })
    ).resolves.toBeUndefined()
    expect(reconciled).toBe(false)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 1 })

    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [{ name: 'paragraph', text: 'seed!' }],
        op: [0, 'text', { es: [4, '!'] }]
      })
    ).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('maps a selected plain-text binding into one actor-owned author command', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'author.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 6,
            end: 14,
            insert: '{==selected==}{>>note<<}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 20 }),
        text: 'alpha selected omega'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(
      adapter.author(
        'comment',
        {
          anchor: { path: [0, 'text'], offset: 6 },
          focus: { path: [0, 'text'], offset: 14 }
        },
        'note',
        () => bindings
      )
    ).resolves.toMatchObject({
      type: 'applied',
      revision: 2
    })
    expect(submissions).toEqual([
      {
        kind: 'author',
        form: 'comment',
        range: { start: 6, end: 14 },
        text: 'note',
        projections: []
      }
    ])
  })

  it('maps later-block authoring after an earlier synchronous paragraph edit', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'shifted-author.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: mockOutcome(
            [
              applied(2, { start: 5, end: 5, insert: '!' }),
              applied(3, {
                start: 8,
                end: 13,
                insert: '{~~omega~>replacement~~}'
              })
            ],
            submissions.length
          )
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 5 }),
        text: 'alpha'
      },
      {
        path: Object.freeze([1, 'text'] as const),
        sourceRange: Object.freeze({ start: 7, end: 12 }),
        text: 'omega'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'alpha' }],
        doc: [{ name: 'paragraph', text: 'alpha!' }],
        op: [0, 'text', { es: [5, '!'] }]
      })
    ).toBe('accepted')
    const authoring = adapter.author(
      'substitution',
      {
        anchor: { path: [1, 'text'], offset: 0 },
        focus: { path: [1, 'text'], offset: 5 }
      },
      'replacement',
      () => bindings
    )

    expect(submissions).toEqual([
      { edits: [{ start: 5, end: 5, insert: '!' }], projections: [] },
      {
        kind: 'author',
        form: 'substitution',
        range: { start: 8, end: 13 },
        text: 'replacement',
        projections: []
      }
    ])

    await Promise.resolve()
    await Promise.resolve()
    expect(submissions[1]).toEqual({
      kind: 'author',
      form: 'substitution',
      range: { start: 8, end: 13 },
      text: 'replacement',
      projections: []
    })

    await expect(authoring).resolves.toMatchObject({ revision: 3 })
  })

  it('orders immediate undo after its edit and reconciles before the next action', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'undo.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: mockOutcome(
            [
              applied(2, { start: 4, end: 4, insert: '!' }),
              applied(3, { start: 4, end: 5, insert: '' }),
              applied(4, { start: 4, end: 4, insert: '?' })
            ],
            submissions.length
          )
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ]),
      binding
    )

    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [{ name: 'paragraph', text: 'seed!' }],
        op: [0, 'text', { es: [4, '!'] }]
      })
    ).toBe('accepted')
    let reconciliationRevision: number | undefined
    const undoing = adapter.history('undo', (outcome) => {
      reconciliationRevision = outcome.revision
      return Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ])
    })
    const barrier = adapter.settled()

    expect(submissions).toEqual([
      { edits: [{ start: 4, end: 4, insert: '!' }], projections: [] },
      { kind: 'undo', projections: [] }
    ])

    await Promise.resolve()
    expect(submissions).toEqual([
      { edits: [{ start: 4, end: 4, insert: '!' }], projections: [] },
      { kind: 'undo', projections: [] }
    ])

    await Promise.resolve()
    expect(reconciliationRevision).toBe(3)
    let barrierResolved = false
    barrier
      .then(() => {
        barrierResolved = true
      })
      .catch(() => {})
    await Promise.resolve()
    expect(barrierResolved).toBe(true)

    await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 3 })

    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'seed' }],
        doc: [{ name: 'paragraph', text: 'seed?' }],
        op: [0, 'text', { es: [4, '?'] }]
      })
    ).toBe('accepted')
    expect(submissions.at(-1)).toEqual({
      edits: [{ start: 4, end: 4, insert: '?' }],
      projections: []
    })

    await expect(adapter.settled()).resolves.toBeUndefined()
  })

  it('admits consecutive native operations and reconciles each result synchronously', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const acknowledged = mockOutcome(
          [
            applied(2, { start: 9, end: 10, insert: 'X' }),
            applied(3, { start: 10, end: 10, insert: 'Y' })
          ],
          submissions.length
        )
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'plain.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings: readonly MuyaPlainTextSourceBinding[] = Object.freeze([
      {
        path: Object.freeze([1, 'text'] as const),
        sourceRange: Object.freeze({ start: 6, end: 12 }),
        text: 'middle'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    expect(
      adapter.accept({
        source: 'user',
        op: [1, 'text', { es: [3, { d: 'd' }, 'X'] }],
        prevDoc: [
          { name: 'paragraph', text: 'head' },
          { name: 'paragraph', text: 'middle' }
        ],
        doc: [
          { name: 'paragraph', text: 'head' },
          { name: 'paragraph', text: 'midXle' }
        ]
      })
    ).toBe('accepted')
    expect(
      adapter.accept({
        source: 'user',
        op: [1, 'text', { es: [4, 'Y'] }],
        prevDoc: [
          { name: 'paragraph', text: 'head' },
          { name: 'paragraph', text: 'midXle' }
        ],
        doc: [
          { name: 'paragraph', text: 'head' },
          { name: 'paragraph', text: 'midXYle' }
        ]
      })
    ).toBe('accepted')

    expect(submissions).toEqual([
      { edits: [{ start: 9, end: 10, insert: 'X' }], projections: [] },
      { edits: [{ start: 10, end: 10, insert: 'Y' }], projections: [] }
    ])
    const barrier = adapter.settled()

    await Promise.resolve()
    expect(submissions).toEqual([
      { edits: [{ start: 9, end: 10, insert: 'X' }], projections: [] },
      { edits: [{ start: 10, end: 10, insert: 'Y' }], projections: [] }
    ])

    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 3 })
  })

  it('faults closed on an unsupported structural operation', async() => {
    const binding = {
      ...preparationMethods,
      submit(): never {
        throw new Error('must not submit')
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 5 }),
          text: 'plain'
        }
      ]),
      binding
    )

    expect(
      adapter.accept({
        source: 'user',
        op: [0, { r: true, i: { name: 'atx-heading', text: 'plain' } }],
        prevDoc: [{ name: 'paragraph', text: 'plain' }],
        doc: [{ name: 'atx-heading', text: 'plain' }]
      })
    ).toBe('unsupported')

    await expect(adapter.settled()).rejects.toThrow('operation-shape')
    expect(adapter.state()).toMatchObject({ status: 'faulted' })
  })

  it.each([false, true])(
    'submits the actual heading command with its selected source through Track=%s',
    async(tracked) => {
      const binding = createEditorCoreBinding(createLocalCoreOwner())
      binding.open({ documentId: 'heading-command.md', source: 'title\n' })
      const view = () => {
        const reply = binding.plainTextViewAtBarrier()
        if (reply.type !== 'plain-text-view') throw new Error('Missing view')
        return reply.view
      }
      const adapter = createMuyaPlainTextCoreAdapter(view().bindings, binding)
      const command = {
        kind: 'command' as const,
        command: 'changeHeading' as const,
        change: { type: 'set' as const, level: 1 },
        selection: { ranges: [{ anchor: 1, focus: 4 }], primary: 0 },
        options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      }
      try {
        expect(adapter.input(command, () => view().bindings, tracked)).toEqual({
          accepted: true,
          changed: true
        })
        const expected = tracked ? '{++# ++}title\n' : '# title\n'
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
        await adapter.history('undo', () => view().bindings)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: 'title\n' })
        await adapter.history('redo', () => view().bindings)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        adapter.dispose()
        binding.dispose()
      }
    }
  )

  it.each([
    { tracked: false, expected: 'alXmma\n' },
    { tracked: true, expected: 'al{~~pha\n\nbeta\n\nga~>X~~}mma\n' }
  ])(
    'submits one native cross-paragraph typing replacement exactly (Track=$tracked)',
    async({ tracked, expected }) => {
      const source = 'alpha\n\nbeta\n\ngamma\n'
      const app = bootBoundMuya(source)
      app.track(tracked)
      try {
        const first = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
        const last = app.muya.editor.scrollPage?.queryBlock([2, 'text'])
        if (!first?.isContent() || !last?.isContent()) { throw new Error('Expected native selection endpoints') }
        app.muya.editor.selection.setSelection(
          { block: first, path: first.path, offset: 2 },
          { block: last, path: last.path, offset: 2 }
        )
        const event = new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
        first.domNode.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(app.adapter.state().status).toBe('ready')
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
        const core = createDocumentCore()
        expect(core.project(core.open(expected), 'revised').markdown).toBe('alXmma\n')
        if (tracked) expect(core.project(core.open(expected), 'original').markdown).toBe(source)
        const selected = app.muya.getSelection()
        expect(selected?.anchor.offset).toBe(selected?.focus.offset)
        expect(selected?.anchor.offset).toBe(3)
        app.muya.flush()
        expect(app.legacyChanges).toEqual([])
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
        await app.adapter.history('redo', app.reconcile)
        const saved = app.binding.sourceAtBarrier()
        expect(saved).toMatchObject({ source: expected })
        if (saved.type !== 'source') throw new Error('Expected save-barrier source')
        const reopened = bootBoundMuya(saved.source)
        try {
          expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
        } finally {
          reopened.dispose()
        }
      } finally {
        app.dispose()
      }
    }
  )

  it('routes one native cross-paragraph cut through Track Changes', async() => {
    const source = 'alpha\n\nbeta\n\ngamma\n'
    const expected = 'al{--pha\n\nbeta\n\nga--}mma\n'
    const app = bootBoundMuya(source)
    app.track(true)
    const model = app.muya.editor.documentEditing
    if (!model) throw new Error('Expected native document owner')
    const clipboard: DocumentEditing['clipboard'] = (operation, present) => {
      const action = muyaClipboardToModel(app.muya, app.view(), operation, true)
      const result = app.adapter.clipboard(action, app.reconcile)
      if (!result.accepted) present()
      return result.changed
    }
    model.clipboard = clipboard
    try {
      const first = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      const last = app.muya.editor.scrollPage?.queryBlock([2, 'text'])
      if (!first?.isContent() || !last?.isContent()) { throw new Error('Expected native cut endpoints') }
      app.muya.editor.selection.setSelection(
        { block: first, path: first.path, offset: 2 },
        { block: last, path: last.path, offset: 2 }
      )
      app.muya.editor.clipboard.cutHandler()
      expect(app.adapter.state().status).toBe('ready')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      const core = createDocumentCore()
      expect(core.project(core.open(expected), 'original').markdown).toBe(source)
      expect(core.project(core.open(expected), 'revised').markdown).toBe('almma\n')
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      const saved = app.binding.sourceAtBarrier()
      expect(saved).toMatchObject({ source: expected })
      if (saved.type !== 'source') throw new Error('Expected save-barrier source')
      const reopened = bootBoundMuya(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  })

  it('rejects a detached selection while the next key uses the reconciled cross-paragraph result', async() => {
    const source = 'alpha\n\nbeta\n\ngamma\n'
    const app = bootBoundMuya(source)
    try {
      const first = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      const removed = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
      if (!first?.isContent() || !removed?.isContent()) { throw new Error('Expected native selection endpoints') }
      removed.setCursor(0, 4, true)
      const stale = app.muya.editor.selection.getDOMSelection()
      if (!stale) throw new Error('Expected captured native selection')
      app.muya.editor.selection.setSelection(
        { block: first, path: first.path, offset: 2 },
        { block: removed, path: removed.path, offset: 2 }
      )
      first.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'LONG',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'alLONGta\n\ngamma\n' })
      expect(removed.domNode.isConnected).toBe(false)
      // A stale DOM selection must not resolve to gamma merely because it now
      // occupies beta's former path. Native authoring consumes this same mapping.
      expect(() =>
        muyaFormatToModel(app.muya, app.view(), { format: 'mark', selection: stale }, false)
      ).toThrow('The current model has no source position for the native formatting selection')
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 6 }, focus: { offset: 6 } })
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode.isConnected) throw new Error('Expected reconciled native caret')
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      const expected = 'alLONGxta\n\ngamma\n'
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 7 }, focus: { offset: 7 } })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      const saved = app.binding.sourceAtBarrier()
      expect(saved).toMatchObject({ source: expected })
      if (saved.type !== 'source') throw new Error('Expected save-barrier source')
      const reopened = bootBoundMuya(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  })

  it('maps Mark Highlight without inventing a text payload', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'highlight.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 1,
            end: 4,
            insert: '{==eed==}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 4 }),
        text: 'seed'
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(
      adapter.author(
        'highlight',
        {
          anchor: { path: [0, 'text'], offset: 1 },
          focus: { path: [0, 'text'], offset: 4 }
        },
        '',
        () => bindings
      )
    ).resolves.toMatchObject({ revision: 2 })
    expect(submissions).toEqual([
      {
        kind: 'author',
        form: 'highlight',
        range: { start: 1, end: 4 },
        text: '',
        projections: []
      }
    ])
  })

  it('maps authoring through a selection-only structural paragraph binding', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'reference.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 5,
            end: 14,
            insert: '{==important==}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const bindings = Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 25 }),
        text: 'See [important][ref].[^n]',
        editable: false as const
      }
    ])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(
      adapter.author(
        'highlight',
        {
          anchor: { path: [0, 'text'], offset: 5 },
          focus: { path: [0, 'text'], offset: 14 }
        },
        '',
        () => bindings
      )
    ).resolves.toMatchObject({ revision: 2 })
    expect(submissions).toEqual([
      {
        kind: 'author',
        form: 'highlight',
        range: { start: 5, end: 14 },
        text: '',
        projections: []
      }
    ])
    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'See [important][ref].[^n]' }],
        doc: [{ name: 'paragraph', text: 'changed' }],
        op: [[0, 'text', { es: [{ d: 'See [important][ref].[^n]' }, 'changed'] }]]
      })
    ).toBe('unsupported')
  })

  it('holds save settlement through IME and submits only the committed text', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = recordingModelBinding('ime.md', submissions)
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }
      ]),
      binding
    )

    adapter.compositionStart(compositionInput(4))
    const saveBarrier = adapter.settled()
    adapter.compositionUpdate('日本')
    expect(submissions).toEqual([])

    const ending = adapter.compositionEnd({ kind: 'commit', data: '日本' }, () => [])
    expect(submissions).toEqual([
      {
        kind: 'input',
        action: { ...compositionInput(4), data: '日本' },
        tracked: false,
        projections: []
      }
    ])
    expect(ending).toEqual({ accepted: true, changed: true })
    await expect(saveBarrier).resolves.toBeUndefined()
    expect(binding.sourceAtBarrier()).toMatchObject({ source: 'seed日本\n' })
    adapter.dispose()
    binding.dispose()
  })

  it.each([false, true])(
    'creates and edits a math block through the live model (tracked=%s)',
    async(tracked) => {
      const app = liveModelAdapter('seed\n')
      const { adapter, binding, reconcile } = app
      const converted = tracked ? '{~~seed~>$$\n\n$$~~}\n' : '$$\n\n$$\n'
      const typed = tracked ? '{~~seed~>$$\nx^2\n$$~~}\n' : '$$\nx^2\n$$\n'
      const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      try {
        expect(
          adapter.input(
            {
              kind: 'command',
              command: 'createMathBlock',
              replace: true,
              selection: { ranges: [{ anchor: 0, focus: 4 }], primary: 0 },
              options
            },
            reconcile,
            tracked
          ).accepted
        ).toBe(true)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
        const caret = converted.indexOf('$$') + 3
        expect(
          adapter.input(
            {
              inputType: 'insertText',
              data: 'x^2',
              range: { start: caret, end: caret },
              selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
              options
            },
            reconcile,
            tracked
          ).accepted
        ).toBe(true)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
        await adapter.history('undo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
        await adapter.history('undo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: 'seed\n' })
        await adapter.history('redo', reconcile)
        await adapter.history('redo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        app.dispose()
      }
    }
  )

  for (const example of [
    {
      name: 'Unicode alignment',
      source: 'seed\r\n',
      markdown: '| 中  | e\u0301   |\n| --- | --- |\n| ab  | xyz |'
    },
    {
      name: 'ordinary cells',
      source: 'seed\n',
      markdown: '| a   | b   |\n| --- | --- |\n| 1   | 2   |'
    }
  ]) {
    it.each([false, true])(
      `preserves exact ${example.name} table paste and history with tracked=%s`,
      async(tracked) => {
        const { source, markdown } = example
        const app = liveModelAdapter(source)
        const { adapter, binding, reconcile } = app
        try {
          expect(
            adapter.clipboard(
              {
                kind: 'paste',
                selection: { ranges: [{ anchor: 0, focus: 4 }], primary: 0 },
                markdown,
                tracked
              },
              reconcile
            )
          ).toEqual({ accepted: true, changed: true })
          const expected = (tracked ? `{~~seed~>${markdown}~~}` : markdown) + source.slice(4)
          expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
          await adapter.settled()
          expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
          await adapter.history('undo', reconcile)
          expect(binding.sourceAtBarrier()).toMatchObject({ source })
          await adapter.history('redo', reconcile)
          expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
          const core = createDocumentCore()
          const reopened = core.open(expected)
          expect(core.project(reopened, 'original').markdown).toBe(tracked ? source : expected)
          expect(core.project(reopened, 'revised').markdown).toBe(markdown + source.slice(4))
        } finally {
          app.dispose()
        }
      }
    )
  }

  it('routes one native two-paragraph paste through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-plain-paste.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 3,
            end: 3,
            insert: '{++one\n\ntwo++}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 6 }),
          text: 'foobar'
        }
      ]),
      binding
    )
    let reconcile = false

    expect(
      adapter.acceptTracked(
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'foobar' }],
          doc: [
            { name: 'paragraph', text: 'fooone' },
            { name: 'paragraph', text: 'twobar' }
          ],
          op: [
            [0, 'text', { es: [3, { d: 'bar' }, 'one'] }],
            [1, { i: { name: 'paragraph', text: 'twobar' } }]
          ]
        },
        () => {
          reconcile = true
          return Object.freeze([])
        }
      )
    ).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(reconcile).toBe(true)
    expect(submissions).toEqual([
      {
        kind: 'track',
        range: { start: 3, end: 3 },
        text: 'one\n\ntwo',
        projections: []
      }
    ])
  })

  it('routes one native three-paragraph paste through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-three-paragraph-paste.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 3,
            end: 3,
            insert: '{++one\n\ntwo\n\nthree++}'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 6 }),
          text: 'foobar'
        }
      ]),
      binding
    )

    expect(
      adapter.acceptTracked(
        {
          source: 'user',
          prevDoc: [{ name: 'paragraph', text: 'foobar' }],
          doc: [
            { name: 'paragraph', text: 'fooone' },
            { name: 'paragraph', text: 'two' },
            { name: 'paragraph', text: 'threebar' }
          ],
          op: [
            [0, 'text', { es: [3, { d: 'bar' }, 'one'] }],
            [1, { i: { name: 'paragraph', text: 'two' } }],
            [2, { i: { name: 'paragraph', text: 'threebar' } }]
          ]
        },
        () => Object.freeze([])
      )
    ).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(submissions).toEqual([
      {
        kind: 'track',
        range: { start: 3, end: 3 },
        text: 'one\n\ntwo\n\nthree',
        projections: []
      }
    ])
  })

  it('submits one native two-paragraph paste exactly', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      ...preparationMethods,
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'plain-paste.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: applied(2, {
            start: 3,
            end: 3,
            insert: 'one\n\ntwo'
          })
        })
      }
    } as Pick<
      EditorCoreBinding,
      'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
    >
    const adapter = createMuyaPlainTextCoreAdapter(
      Object.freeze([
        {
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 6 }),
          text: 'foobar'
        }
      ]),
      binding
    )

    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'foobar' }],
        doc: [
          { name: 'paragraph', text: 'fooone' },
          { name: 'paragraph', text: 'twobar' }
        ],
        op: [
          [0, 'text', { es: [3, { d: 'bar' }, 'one'] }],
          [1, { i: { name: 'paragraph', text: 'twobar' } }]
        ]
      })
    ).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(submissions).toEqual([
      {
        edits: [{ start: 3, end: 3, insert: 'one\n\ntwo' }],
        projections: []
      }
    ])
  })
})
