import { wordCount } from '@muyajs/core'
import { describe, expect, it } from 'vitest'

import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import type { MuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { createMuyaRevisedTextReader } from '@/documentAuthority/muyaRevisedText'
import {
  countProjectedDocument,
  countProjectedText
} from '@/documentConsumers/documentProjectionConsumers'

const open = (source: string) => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'count.md', source })
  const view = binding.plainTextViewAtBarrier()
  const document = binding.consumerProjectionAtBarrier?.()
  if (view.type !== 'plain-text-view' || view.view.kind !== 'view') {
    throw new Error('Expected a Markup view')
  }
  if (document?.type !== 'consumer-projection') throw new Error('Expected a projection')
  return { view: view.view as MuyaMarkupView, document: document.projection }
}

describe('word counts read Core text', () => {
  it('counts a plain document exactly as upstream counts its Markdown', () => {
    const source = '# Title **bold**\n\n- one\n- two\n\nText `code` 中文\n'
    expect(countProjectedDocument(open(source).document)).toEqual(wordCount(source))
  })

  it('counts a CRLF document as upstream counts its LF text', () => {
    const source = 'Alpha beta\r\n\r\nGamma\r\n'
    expect(countProjectedDocument(open(source).document)).toEqual(
      wordCount('Alpha beta\n\nGamma\n')
    )
    expect(countProjectedText('a\r\nb')).toEqual(wordCount('a\nb'))
  })

  it('counts the Revised document, without delimiters, deletions or comments', () => {
    const source = 'Keep {--gone--} {++new++} {~~old~>fresh~~} {==hi==}{>>note here<<}\n'
    expect(countProjectedDocument(open(source).document)).toEqual(
      wordCount('Keep  new fresh hi\n')
    )
  })

  it('reads a selected Markup leaf as Revised text', () => {
    const { view } = open('Para {--gone--} {~~o~>n~~} {++add {--x--}++} {--a {++b++}--} end\n')
    const read = createMuyaRevisedTextReader(view)
    const leaf = view.bindings[0]
    expect(leaf.text).toBe('Para gone on add x a b end')
    expect(read(leaf.path, leaf.text, 0, leaf.text.length)).toBe('Para  n add   end')
    // A range that starts or ends inside omitted text keeps only what Revised shows.
    expect(read(leaf.path, leaf.text, 7, 12)).toBe(' n')
    expect(read(leaf.path, leaf.text, 0, 4)).toBe('Para')
  })

  it('does not read a leaf whose native text differs from the acknowledged view', () => {
    const { view } = open('Plain text\n')
    const read = createMuyaRevisedTextReader(view)
    expect(read(view.bindings[0].path, 'Plain text!', 0, 3)).toBeUndefined()
    expect(read(['missing'], 'Plain text', 0, 3)).toBeUndefined()
  })
})
