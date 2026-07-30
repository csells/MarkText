// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  documentParseConfigurationFor as createDocumentParseConfiguration
} from 'main_renderer/documentCore/documentParseConfiguration'
import { createSourceSnapshot } from '@marktext/document-core'
import {
  createTestDocumentCoreSession
} from '../../../../document-view/src/documentCore/__tests__/testDocumentCoreSession'
import {
  installTestDocumentHostCapabilities
} from '../helpers/documentHostSession'
import {
  createDocumentEditorHost,
  type DocumentEditorHost
} from '@/components/editorWithTabs/documentCoreDesktopEditor'

// A17 reproduces here rather than in Electron: Remove comment leaves the
// document byte-identical with no preceding edit, on a comment whose card is
// rendered. The kernel accepts `remove-comment` on a paired comment, so the
// drop is in the renderer's resolution path, which this exercises directly.
const openHost = async(source: string): Promise<{
  editor: DocumentEditorHost
  host: HTMLElement
}> => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const session = await createTestDocumentCoreSession(
    createSourceSnapshot(source),
    createDocumentParseConfiguration({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false
    })
  )
  const editor = await createDocumentEditorHost({
    element: host,
    session: installTestDocumentHostCapabilities(session, {
      pasteClipboard: async() => {
        throw new Error('Review removal must not reach the clipboard')
      },
      writeClipboardMaterialization: async() => Object.freeze({
        kind: 'written' as const
      })
    }),
    configuration: {}
  })
  return { editor, host }
}

const selectText = (host: HTMLElement, text: string): void => {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const node = nodes.find(candidate => candidate.data.includes(text))
  if (node === undefined) throw new Error(`Could not find ${text}`)
  const range = document.createRange()
  range.setStart(node, node.data.indexOf(text))
  range.setEnd(node, node.data.indexOf(text) + text.length)
  const selection = document.getSelection()
  if (selection === null) throw new Error('Expected a browser Selection')
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('Review remove-annotation', () => {
  it('removes an anchored comment the sidebar offers', async() => {
    const { editor, host } = await openHost(
      'alpha {==target==}{>>first note<<} omega\n'
    )

    const snapshot = editor.getCriticMarkupReviewSnapshot()
    const comment = snapshot.items.find(item => item.type === 'comment')
    expect(comment).toBeDefined()
    if (comment === undefined) throw new Error('No comment item was offered')
    expect(comment.anchorId).toBeDefined()

    // The sidebar maps Remove comment onto an 'accept' decision.
    const resolved = await editor.resolveCriticMarkup('accept', {
      revisionId: snapshot.revisionId,
      nodeId: comment.id
    })

    expect(resolved).toBe(true)
    expect(editor.getMarkdown()).toBe('alpha target omega\n')

    editor.destroy()
    host.remove()
  })

  // The sidebar can offer Remove comment while the editor shows a resolved
  // projection. Switching back to 'marked' to apply the edit produces a new
  // revision, so re-authenticating the click against the *pre-switch* revision
  // id cannot succeed — the command drops silently, which is A17 and a
  // non-negotiable 10 violation at once.
  it('removes an anchored comment offered from a resolved projection', async() => {
    const { editor, host } = await openHost(
      'alpha {==target==}{>>first note<<} omega\n'
    )
    await editor.configure({ criticMarkupProjection: 'revised' })

    const snapshot = editor.getCriticMarkupReviewSnapshot()
    const comment = snapshot.items.find(item => item.type === 'comment')
    if (comment === undefined) throw new Error('No comment item was offered')

    const resolved = await editor.resolveCriticMarkup('accept', {
      revisionId: snapshot.revisionId,
      nodeId: comment.id
    })

    expect(resolved).toBe(true)
    expect(editor.getMarkdown()).toBe('alpha target omega\n')

    editor.destroy()
    host.remove()
  })

  // A17's sequence: the comment the user removes is one they just authored,
  // so its node ids come from the authoring revision rather than from the
  // opened file.
  it('removes a comment authored in this session', async() => {
    const { editor, host } = await openHost('alpha target omega\n')

    selectText(host, 'target')

    expect(await editor.createCriticMarkup({
      type: 'comment',
      comment: 'first note'
    })).toBe(true)
    expect(editor.getMarkdown())
      .toBe('alpha {==target==}{>>first note<<} omega\n')

    const snapshot = editor.getCriticMarkupReviewSnapshot()
    const comment = snapshot.items.find(item => item.type === 'comment')
    if (comment === undefined) throw new Error('No comment item was offered')

    const resolved = await editor.resolveCriticMarkup('accept', {
      revisionId: snapshot.revisionId,
      nodeId: comment.id
    })

    expect(resolved).toBe(true)
    expect(editor.getMarkdown()).toBe('alpha target omega\n')

    editor.destroy()
    host.remove()
  })

  // Node ids are positional counters minted in parse order (`p1:1`, `p1:2`, …),
  // so the same id denotes a different node after any revision. That makes the
  // card's revision stamp load-bearing: a Review command authenticated only by
  // node id would resolve a stale card onto whatever now occupies that slot and
  // silently remove the wrong annotation. This pins the refusal, so a future
  // attempt to "fix" a dropped command by loosening authentication fails here
  // rather than in a user's document.
  it('refuses a superseded card rather than resolving the wrong node',
    async() => {
      const { editor, host } = await openHost(
        'alpha {==target==}{>>first note<<} omega\n'
      )

      const stale = editor.getCriticMarkupReviewSnapshot()
      const comment = stale.items.find(item => item.type === 'comment')
      if (comment === undefined) throw new Error('No comment item was offered')

      selectText(host, 'omega')
      expect(await editor.createCriticMarkup({ type: 'highlight' })).toBe(true)
      const supersededBy = editor.getCriticMarkupReviewSnapshot()
      expect(supersededBy.revisionId).not.toBe(stale.revisionId)
      const before = editor.getMarkdown()

      const resolved = await editor.resolveCriticMarkup('accept', {
        revisionId: stale.revisionId,
        nodeId: comment.id
      })

      expect(resolved).toBe(false)
      // Refusing is only safe if nothing moved: neither the comment the card
      // named nor the annotation that now occupies its id.
      expect(editor.getMarkdown()).toBe(before)

      editor.destroy()
      host.remove()
    })

  // The same command carrying the live stamp must still succeed, so the
  // refusal above is authentication and not a disabled feature.
  it('resolves the same card once it carries the live stamp', async() => {
    const { editor, host } = await openHost(
      'alpha {==target==}{>>first note<<} omega\n'
    )
    selectText(host, 'omega')
    expect(await editor.createCriticMarkup({ type: 'highlight' })).toBe(true)

    const live = editor.getCriticMarkupReviewSnapshot()
    const comment = live.items.find(item => item.type === 'comment')
    if (comment === undefined) throw new Error('No comment item was offered')

    expect(await editor.resolveCriticMarkup('accept', {
      revisionId: live.revisionId,
      nodeId: comment.id
    })).toBe(true)
    expect(editor.getMarkdown()).toBe('alpha target {==omega==}\n')

    editor.destroy()
    host.remove()
  })
})
