import codeMirror from '@/codeMirror'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { sourceCodeCoreAdapterOptions } from '@/documentAuthority/sourceCodeCoreAdapterOptions'
import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { coreMarkdownOptionsFromPreferences } from '@/documentAuthority/coreMarkdownPreferences'
import type { MarkdownAstNode } from '@marktext/document-core'

const kinds = (node: MarkdownAstNode): string[] => [node.kind, ...node.children.flatMap(kinds)]
const managerForTest = () =>
  createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      return createEditorCoreBinding({
        request: async(request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
    }
  })

describe('Core Markdown preference changes', () => {
  it('waits for an admitted configuration before reading a review item', async() => {
    const actor = createCoreActor()
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const manager = createCoreDocumentSessionManager({
      createBinding: () =>
        createEditorCoreBinding({
          request: async(request) => {
            if (request.type === 'configure') await held
            return actor.handle(request)
          },
          dispose: () => actor.dispose()
        })
    })
    await manager.open({ documentId: 'review.md', source: '{>>2^n^<<}', lineEnding: '\n' })
    const lease = manager.lease('review.md')
    const changing = lease.binding.submit({
      kind: 'configure',
      options: { subscriptAndSuperscript: true },
      projections: []
    }).acknowledged
    const reading = lease.binding.reviewItemAtBarrier('next', 0)
    const checked = expect(reading).resolves.toMatchObject({ type: 'review-item', revision: 2 })
    release?.()
    try {
      await changing
      await checked
    } finally {
      await manager.handoff(lease)
      await manager.close(lease.documentId)
    }
  })

  it.each(['save', 'display', 'consumer', 'selection', 'review', 'native'] as const)(
    'orders a %s read before configuration admitted at the pending-drain boundary',
    async(readKind) => {
      const actor = createCoreActor()
      let releaseConfigure: (() => void) | undefined
      const heldConfigure = new Promise<void>((resolve) => {
        releaseConfigure = resolve
      })
      const manager = createCoreDocumentSessionManager({
        createBinding: () =>
          createEditorCoreBinding({
            request: async(request) => {
              if (request.type === 'configure') await heldConfigure
              return actor.handle(request)
            },
            dispose: () => actor.dispose()
          })
      })
      await manager.open({ documentId: 'read-order.md', source: 'H~2~O', lineEnding: '\n' })
      const lease = manager.lease('read-order.md')
      const read =
        readKind === 'save'
          ? manager.saveBarrier(lease.documentId)
          : readKind === 'display'
            ? lease.displayProjectionAtBarrier('revised')
            : readKind === 'consumer'
              ? lease.consumerProjectionAtBarrier()
              : readKind === 'selection'
                ? lease.selectionProjectionAtBarrier({ start: 0, end: 5 })
                : readKind === 'review'
                  ? Promise.resolve().then(() => lease.binding.reviewItemAtBarrier('next', 0))
                  : lease.projectAcknowledgedPlainTextView(1)
      let changing: Promise<unknown> | undefined
      queueMicrotask(() => {
        changing = lease.binding.submit({
          kind: 'configure',
          options: { subscriptAndSuperscript: true },
          projections: []
        }).acknowledged
      })
      try {
        await expect(read).resolves.toBeDefined()
      } finally {
        releaseConfigure?.()
        await changing
        await manager.handoff(lease)
        await manager.close(lease.documentId)
      }
    }
  )

  it('opens with the supported desktop preferences for document and isolated comment semantics', async() => {
    const manager = managerForTest()
    const source =
      '{>>2^n^; note[^c].\n\n[^c]: local body\n\n<<}\n\nH~2~O; note[^a].\n\n[^a]: body\n'
    await manager.open({
      documentId: 'enabled.md',
      source,
      lineEnding: '\n',
      options: coreMarkdownOptionsFromPreferences({
        superSubScript: true,
        footnote: true,
        isGitlabCompatibilityEnabled: true
      })
    })
    const lease = manager.lease('enabled.md')
    expect(kinds((await lease.displayProjectionAtBarrier('revised')).ast.root)).toEqual(
      expect.arrayContaining(['subscript', 'footnote-reference', 'footnote-definition'])
    )
    const comment = await lease.binding.reviewItemAtBarrier('previous', source.length)
    expect(comment.type).toBe('review-item')
    if (comment.type !== 'review-item' || comment.commentProjection === undefined) { throw new Error('Expected isolated comment') }
    expect(kinds(comment.commentProjection.ast.root)).toEqual(
      expect.arrayContaining(['superscript', 'footnote-reference', 'footnote-definition'])
    )
    expect((await manager.saveBarrier(lease.documentId)).source).toBe(source)
    await manager.handoff(lease)
    await manager.close(lease.documentId)
  })

  it('changes language interpretation without changing exact source or undo/redo history', async() => {
    const manager = managerForTest()
    const source = 'H~2~O and 2^n^; note[^a].\n\n[^a]: Footnote body.\n\n```math\nx^2\n```\n'
    await manager.open({ documentId: 'preferences.md', source, lineEnding: '\n' })
    const lease = manager.lease('preferences.md')
    await lease.binding.submit({ edits: [{ start: 0, end: 0, insert: 'Edit ' }], projections: [] })
      .acknowledged
    await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect(kinds((await lease.displayProjectionAtBarrier('revised')).ast.root)).not.toContain(
      'footnote-definition'
    )

    await lease.binding.submit({
      kind: 'configure',
      options: { footnotes: true, subscriptAndSuperscript: true, gitLabMath: true },
      projections: []
    }).acknowledged
    const nodes = kinds((await lease.displayProjectionAtBarrier('revised')).ast.root)
    expect(nodes).toEqual(
      expect.arrayContaining([
        'subscript',
        'superscript',
        'footnote-reference',
        'footnote-definition',
        'math-block'
      ])
    )
    expect((await manager.saveBarrier(lease.documentId)).source).toBe(source)
    await lease.binding.submit({ kind: 'redo', projections: [] }).acknowledged
    expect((await manager.saveBarrier(lease.documentId)).source).toBe('Edit ' + source)
    await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect((await manager.saveBarrier(lease.documentId)).source).toBe(source)
    await lease.binding.submit({
      kind: 'configure',
      options: { footnotes: false, subscriptAndSuperscript: false, gitLabMath: false },
      projections: []
    }).acknowledged
    expect(kinds((await lease.displayProjectionAtBarrier('revised')).ast.root)).not.toContain(
      'footnote-definition'
    )
    await manager.handoff(lease)
    await manager.close(lease.documentId)
  })

  it('queues Source preference changes after composition and preserves input/history through Worker recovery', async() => {
    const manager = managerForTest()
    const source = 'note[^a].\n\n[^a]: body\n'
    await manager.open({ documentId: 'pending.md', source, lineEnding: '\n' })
    let lease = manager.lease('pending.md')
    const doc = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      doc,
      lease.binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )
    lease.settleView(() => adapter.settled())
    lease.onHandoff(() => adapter.dispose())
    adapter.compositionStart()
    doc.replaceRange('日本 ', { line: 0, ch: 0 }, undefined, '+input')
    let configured = false
    const changing = adapter.configure({ footnotes: true }).then((result) => {
      configured = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(configured).toBe(false)
    await adapter.compositionEnd()
    expect((await changing)?.type).toBe('applied')
    expect(doc.getValue()).toBe('日本 ' + source)
    expect((await manager.saveBarrier(lease.documentId)).source).toBe('日本 ' + source)
    lease.faultView(new Error('Injected view failure'))
    lease = await manager.recover(lease)
    expect(kinds((await lease.displayProjectionAtBarrier('revised')).ast.root)).toContain(
      'footnote-definition'
    )
    await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect((await manager.saveBarrier(lease.documentId)).source).toBe(source)
    await manager.handoff(lease)
    await manager.close(lease.documentId)
  })

  it('queues Markup preferences after composition without replacing its binding or adding an undo step', async() => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: async(request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'markup.md', source: 'H~2~O' })
    const initial = await binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view') throw new Error('Expected initial view')
    const reconcile = async() => {
      const view = await binding.plainTextViewAtBarrier()
      if (view.type !== 'plain-text-view') throw new Error('Expected configured view')
      return view.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(
      initial.view.bindings,
      binding,
      undefined,
      reconcile
    )
    adapter.compositionStart()
    expect(
      adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: 'H~2~O' }],
        doc: [{ name: 'paragraph', text: '日H~2~O' }],
        op: [0, 'text', { es: ['日'] }]
      })
    ).toBe('accepted')
    let configured = false
    const changing = adapter
      .configure({ subscriptAndSuperscript: true }, reconcile)
      .then((reply) => {
        configured = true
        return reply
      })
    await Promise.resolve()
    expect(configured).toBe(false)
    await adapter.compositionEnd()
    expect((await changing)?.type).toBe('applied')
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: '日H~2~O' })
    const projected = await binding.displayProjectionAtBarrier!('revised')
    if (projected.type !== 'display-projection') throw new Error('Expected revised view')
    expect(kinds(projected.projection.ast.root)).toContain('subscript')
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'H~2~O' })
    adapter.dispose()
    binding.dispose()
  })

  it('replays language changes in order when a Worker fails before the next checkpoint', async() => {
    const manager = managerForTest()
    await manager.open({ documentId: 'journal.md', source: 'H~2~O', lineEnding: '\n' })
    let lease = manager.lease('journal.md')
    await lease.binding.submit({
      kind: 'configure',
      options: { subscriptAndSuperscript: true },
      projections: []
    }).acknowledged
    await lease.binding.submit({ edits: [{ start: 0, end: 0, insert: 'Water ' }], projections: [] })
      .acknowledged
    lease.faultView(new Error('Injected Worker failure before save'))
    lease = await manager.recover(lease)
    expect(kinds((await lease.displayProjectionAtBarrier('revised')).ast.root)).toContain(
      'subscript'
    )
    expect((await manager.saveBarrier(lease.documentId)).source).toBe('Water H~2~O')
    await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect((await manager.saveBarrier(lease.documentId)).source).toBe('H~2~O')
    await manager.handoff(lease)
    await manager.close(lease.documentId)
  })
})
