import { describe, expect, it } from 'vitest'
import {
  freezeDocumentCoreHistoryState
} from '@shared/types/documentCore'

const state = (
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> => ({
  canUndo: true,
  canRedo: false,
  dirty: true,
  headIdentity: 'revision:head',
  savedIdentity: 'revision:saved',
  ...overrides
})

describe('document-core history state codec', () => {
  it('accepts a state whose flags and identities agree', () => {
    expect(freezeDocumentCoreHistoryState(state())).toMatchObject({
      dirty: true,
      headIdentity: 'revision:head',
      savedIdentity: 'revision:saved'
    })
  })

  // Dirtiness is content-addressed: a document edited back to the bytes it was
  // saved with is clean, even though its head is a later revision than the one
  // persisted. Deriving `dirty` from identity equality contradicts that, and
  // rejects a publication main legitimately produced — which is how removing a
  // Comment that restores a file to its saved bytes failed to mount at all.
  it('accepts a clean document whose head moved past its saved revision', () => {
    expect(freezeDocumentCoreHistoryState(state({
      dirty: false,
      headIdentity: 'revision:head',
      savedIdentity: 'revision:saved'
    }))).toMatchObject({
      dirty: false,
      headIdentity: 'revision:head',
      savedIdentity: 'revision:saved'
    })
  })

  it('accepts a dirty document whose head equals its saved revision', () => {
    expect(freezeDocumentCoreHistoryState(state({
      dirty: true,
      headIdentity: 'revision:same',
      savedIdentity: 'revision:same'
    }))).toMatchObject({ dirty: true })
  })

  it.each([
    { name: 'a missing head identity', patch: { headIdentity: '' } },
    { name: 'a missing saved identity', patch: { savedIdentity: '' } },
    { name: 'a non-boolean dirty flag', patch: { dirty: 'yes' } },
    { name: 'a non-boolean undo flag', patch: { canUndo: 1 } }
  ])('rejects $name', ({ patch }) => {
    expect(() => freezeDocumentCoreHistoryState(state(patch)))
      .toThrow(/Invalid document-core history state/)
  })
})
