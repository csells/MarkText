// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { createDocumentCore, type DocumentSourceEdit } from '@marktext/document-core'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMuyaMarkupChanges, muyaMarkupViewPatch } from '@/documentAuthority/muyaMarkupChanges'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import { createMuyaMarkupView, type MuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { asMuyaStates } from '../helpers/muyaTypes'

// Plan 0012 G35: a key in a long document presents only the roots its
// regional reply replaced. Every other root keeps its block and rendering,
// and the result reads exactly as presenting the whole new view does.

const hosts: HTMLElement[] = []
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

const viewOf = (core: ReturnType<typeof createDocumentCore>, revision: Parameters<ReturnType<typeof createDocumentCore>['project']>[0]) =>
  createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

const mount = (view: MuyaMarkupView) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  hosts.push(host)
  const muya = new Muya(host)
  let presentation = createMuyaMarkupPresentationIndex(view)
  muya.setInlinePresentation(presentation.render)
  muya.init()
  muya.setContent(asMuyaStates(structuredClone([...view.state])))
  return {
    muya,
    present(next: MuyaMarkupView, regional: boolean) {
      const patch = muyaMarkupViewPatch(next)
      presentation = createMuyaMarkupPresentationIndex(
        next,
        presentation,
        undefined,
        undefined,
        regional ? patch : undefined
      )
      muya.setInlinePresentation(presentation.render)
      const changed = muya.reconcileContent(
        asMuyaStates(next.state),
        regional && patch !== undefined
          ? { start: patch.start, previousEnd: patch.previousEnd, nextEnd: patch.nextEnd }
          : undefined
      )
      for (const path of presentation.changedPaths) {
        const block = muya.editor.scrollPage?.queryBlock([...path])
        if (block?.isContent()) block.update()
      }
      return changed
    }
  }
}

const roots = (muya: Muya) => [...(muya.editor.scrollPage?.children.iterator() ?? [])]

describe('Presenting a regional Markup reply', () => {
  const paragraphs = [
    'Warm editing paragraph.',
    ...Array.from({ length: 30 }, (_, index) =>
      index % 3 === 0
        ? `Review {++new ${index}++} and {--old--}, {~~a~>b~~}, {==claim==}{>>Check.<<}.`
        : `Plain paragraph ${index} with ordinary words.`
    )
  ]
  const source = paragraphs.join('\n\n') + '\n'
  const cases: Array<{ name: string, edit: DocumentSourceEdit }> = [
    { name: 'typing in the first paragraph', edit: { start: 4, end: 4, insert: 'x' } },
    { name: 'splitting the first paragraph', edit: { start: 4, end: 4, insert: '\n\n' } },
    {
      name: 'a new suggestion in a later paragraph',
      edit: { start: source.indexOf('Plain paragraph 5') + 5, end: source.indexOf('Plain paragraph 5') + 5, insert: '{++q++}' }
    },
    {
      name: 'joining two later paragraphs',
      edit: { start: source.indexOf('\n\nPlain paragraph 8'), end: source.indexOf('\n\nPlain paragraph 8') + 2, insert: ' ' }
    }
  ]

  it.each(cases)('replaces only the edited roots for $name', ({ edit }) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = viewOf(core, revision)
    const commit = core.apply(revision, [edit], { projections: ['markup'] })
    const change = commit.change.projections[0]
    if (change?.name !== 'markup' || change.scope !== 'regions') {
      throw new Error('Expected a regional reply')
    }
    const next = applyMuyaMarkupChanges(before, change)
    const patch = next === undefined ? undefined : muyaMarkupViewPatch(next)
    if (next === undefined || patch === undefined) throw new Error('Expected a patched view')

    const regional = mount(before)
    const blocksBefore = roots(regional.muya)
    expect(regional.present(next, true)).toBe(true)
    const blocksAfter = roots(regional.muya)
    const delta = patch.nextEnd - patch.previousEnd
    for (let index = 0; index < blocksBefore.length; index += 1) {
      if (index < patch.start) expect(blocksAfter[index]).toBe(blocksBefore[index])
      if (index >= patch.previousEnd) expect(blocksAfter[index + delta]).toBe(blocksBefore[index])
    }

    const whole = mount(before)
    whole.present(next, false)
    expect(regional.muya.getState()).toEqual(whole.muya.getState())
    expect(regional.muya.getState()).toEqual(structuredClone([...viewOf(core, commit.revision).state]))
    expect(regional.muya.domNode.innerHTML).toBe(whole.muya.domNode.innerHTML)
  })
})
