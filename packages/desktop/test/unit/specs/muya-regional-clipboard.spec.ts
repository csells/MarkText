import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { inspectDocumentCore } from '../../../../document-core/src/internal/documentCoreInspection'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { resolveMuyaViewAcknowledgement } from '@/documentAuthority/resolveMuyaViewAcknowledgement'
import type { CoreAppliedReply, CoreRequest } from '@/documentAuthority/coreProtocol'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

async function openClipboardDocument(source: string) {
  const core = createDocumentCore()
  const actor = createCoreActor(() => core)
  const requests: CoreRequest[] = []
  const manager = createCoreDocumentSessionManager({
    createBinding: () =>
      createEditorCoreBinding({
        request: (request) => {
          requests.push(request)
          return actor.handle(request)
        },
        dispose: () => actor.dispose()
      })
  })
  manager.open({ documentId: 'regional-paste.md', source, lineEnding: '\n' })
  const initial = await manager.plainTextViewBarrier('regional-paste.md')
  if (!('state' in initial.view)) throw new Error('Missing typed initial view')
  const lease = manager.lease('regional-paste.md')
  let view = initial.view
  let revision = initial.revision
  let lastOutcome: CoreAppliedReply | undefined
  const reconcile = (outcome: CoreAppliedReply) => {
    const acknowledged = resolveMuyaViewAcknowledgement({
      lease,
      outcome,
      previousView: view,
      previousRevision: revision,
      currentEditor: () => null
    }).view
    if (!('state' in acknowledged)) throw new Error('Missing typed acknowledged view')
    view = acknowledged
    revision = outcome.revision
    lastOutcome = outcome
    return view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(
    view.bindings,
    lease.binding,
    undefined,
    revision,
    true
  )
  lease.settleView(
    () => adapter.settled(),
    () => adapter.isSettled()
  )
  lease.onHandoff(() => adapter.dispose())
  return {
    core,
    requests,
    lease,
    adapter,
    reconcile,
    view: () => view,
    outcome: () => lastOutcome,
    async dispose() {
      await manager.handoff(lease)
      await manager.close(lease.documentId)
    }
  }
}

it.each(['prepared', 'direct'] as const)(
  'completes %s ordinary paste through the live lease using its canonical region',
  async(mode) => {
    const source =
      'Editing sentence.\n\n' +
      Array.from(
        { length: 80 },
        (_, index) =>
          `## Section ${index}\n\nReview {++new evidence++} and {--old wording--}.\n\n- Item\n- Another\n\n\`\`\`js\nconst x = 42\n\`\`\`\n\n`
      ).join('')
    const app = await openClipboardDocument(source)
    const { core, requests, lease, adapter, reconcile } = app
    const at = 'Editing sentence.'.length
    const selection = { ranges: [{ anchor: at, focus: at }], primary: 0 }
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const beforeInput = inspectDocumentCore(core)
        adapter.input(
          { selection, range: { start: at, end: at }, inputType: 'insertText', data: 'x', options },
          reconcile
        )
        adapter.input(
          {
            selection: { ranges: [{ anchor: at + 1, focus: at + 1 }], primary: 0 },
            range: { start: at, end: at + 1 },
            inputType: 'deleteContentBackward',
            data: null,
            options
          },
          reconcile
        )
        expect(
          inspectDocumentCore(core).documentParseSourceUnits - beforeInput.documentParseSourceUnits
        ).toBe(0)
        const beforePaste = inspectDocumentCore(core)
        const text = ' paste λ'
        if (mode === 'prepared') {
          const preparation = adapter.prepareClipboard(
            { selection, tracked: false },
            { plainText: text },
            reconcile
          )
          expect(adapter.isSettled()).toBe(false)
          expect(
            await preparation.complete(text, { plainText: text, currentSelection: () => selection })
          ).toEqual({ accepted: true, changed: true })
        } else {
          expect(
            adapter.clipboard(
              { kind: 'paste', selection, tracked: false, markdown: text, plainText: text },
              reconcile
            )
          ).toMatchObject({ accepted: true })
        }
        const afterPaste = inspectDocumentCore(core)
        // The imported fragment is parsed by the language engine. The owning
        // document's unchanged regions must not be reparsed for this insertion.
        expect(
          afterPaste.documentParseSourceUnits - beforePaste.documentParseSourceUnits
        ).toBeLessThanOrEqual(text.length)
        expect(afterPaste.sourceMaterializations - beforePaste.sourceMaterializations).toBe(0)
        expect(
          requests
            .filter(
              (request) => request.type === (mode === 'prepared' ? 'apply-prepared' : 'clipboard')
            )
            .at(-1)
        ).toMatchObject({ projections: ['markup'] })
        expect(app.outcome()?.change.projections).toMatchObject([
          { name: 'markup', scope: 'regions' }
        ])
        expect(app.view().bindings[0].text).toBe('Editing sentence.' + text)
        expect(app.outcome()?.clipboardResult?.selection).toEqual({
          ranges: [{ anchor: at + text.length, focus: at + text.length }],
          primary: 0
        })
        expect(await lease.sourceAtBarrier()).toBe(source.slice(0, at) + text + source.slice(at))
        for (let offset = text.length; offset > 0; offset -= 1) {
          adapter.input(
            {
              selection: { ranges: [{ anchor: at + offset, focus: at + offset }], primary: 0 },
              range: { start: at + offset - 1, end: at + offset },
              inputType: 'deleteContentBackward',
              data: null,
              options
            },
            reconcile
          )
        }
        expect(app.view().bindings[0].text).toBe('Editing sentence.')
        expect(await lease.sourceAtBarrier()).toBe(source)
      }
    } finally {
      await app.dispose()
    }
  }
)

for (const example of [
  {
    name: 'reference context',
    source: '[same][id]\n\nseed\n\n[id]: /target\n',
    markdown: ' paste λ',
    plainText: ' paste λ',
    inserted: ' paste λ',
    text: 'seed paste λ'
  },
  {
    name: 'literal payload',
    source: '```txt\nseed\n```\n\n{++end++}\n',
    markdown: '**bold**',
    plainText: '{++raw++}',
    inserted: '{++raw++}',
    text: 'seed{++raw++}',
    // Marker spellings inside a closed fence read as its text, which the
    // fence's own regional parse proves: every projection, the annotations
    // and the Markup events match a fresh open.
    scope: 'regions'
  },
  {
    name: 'new Markdown structure',
    source: 'seed\n\n{++end++}\n',
    markdown: '**bold**',
    plainText: 'bold',
    inserted: '**bold**',
    text: 'seed**bold**',
    // Inline structure inside plain paragraphs is re-proven by its own
    // paragraphs' regional parse.
    scope: 'regions'
  }
]) {
  it.each(['prepared', 'direct'] as const)(
    `preserves ${example.name} through %s paste, next input and history`,
    async(mode) => {
      const app = await openClipboardDocument(example.source)
      const { adapter, lease, reconcile } = app
      const at = example.source.indexOf('seed') + 'seed'.length
      const selection = { ranges: [{ anchor: at, focus: at }], primary: 0 }
      const pasted = example.source.slice(0, at) + example.inserted + example.source.slice(at)
      const caret = at + example.inserted.length
      const typed = pasted.slice(0, caret) + 'X' + pasted.slice(caret)
      try {
        if (mode === 'prepared') {
          const pending = adapter.prepareClipboard(
            { selection, tracked: false },
            { plainText: example.plainText },
            reconcile
          )
          expect(
            await pending.complete(example.markdown, {
              plainText: example.plainText,
              currentSelection: () => selection
            })
          ).toEqual({ accepted: true, changed: true })
        } else {
          expect(
            adapter.clipboard(
              {
                kind: 'paste',
                selection,
                tracked: false,
                markdown: example.markdown,
                plainText: example.plainText
              },
              reconcile
            )
          ).toEqual({ accepted: true, changed: true })
        }
        expect(app.outcome()?.change.projections).toMatchObject([
          { name: 'markup', scope: 'scope' in example ? example.scope : 'document' }
        ])
        expect(app.view().bindings.some((binding) => binding.text === example.text)).toBe(true)
        const nextSelection = app.outcome()?.clipboardResult?.selection
        expect(nextSelection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
        if (!nextSelection || !('ranges' in nextSelection)) {
          throw new Error('Missing acknowledged clipboard caret')
        }
        expect(await lease.sourceAtBarrier()).toBe(pasted)
        adapter.input(
          {
            selection: nextSelection,
            range: { start: caret, end: caret },
            inputType: 'insertText',
            data: 'X',
            options
          },
          reconcile
        )
        expect(await lease.sourceAtBarrier()).toBe(typed)
        expect(app.view().bindings.some((binding) => binding.text === example.text + 'X')).toBe(
          true
        )
        await adapter.history('undo', reconcile)
        expect(await lease.sourceAtBarrier()).toBe(pasted)
        await adapter.history('undo', reconcile)
        expect(await lease.sourceAtBarrier()).toBe(example.source)
        await adapter.history('redo', reconcile)
        await adapter.history('redo', reconcile)
        expect(await lease.sourceAtBarrier()).toBe(typed)
        const reopened = await openClipboardDocument(typed)
        try {
          expect(await reopened.lease.sourceAtBarrier()).toBe(typed)
          expect(reopened.view().state).toEqual(app.view().state)
          expect(
            reopened.view().bindings.some((binding) => binding.text === example.text + 'X')
          ).toBe(true)
        } finally {
          await reopened.dispose()
        }
      } finally {
        await app.dispose()
      }
    }
  )
}
