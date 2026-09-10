import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

describe('native input at annotation exterior boundaries', () => {
  it.each(['{++a++}a\n', '{++{==a==}++}\n', '{>>note<<}'])(
    'inserts before %s with native undo and redo',
    (source) => {
      const actor = createCoreActor()
      try {
        const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
        const result = actor.handle({
          type: 'input',
          session: 1,
          sequence: 2,
          baseRevision: opened.revision,
          action: {
            range: { start: 0, end: 0 },
            selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
            inputType: 'insertText',
            data: 'x',
            options
          },
          tracked: false,
          projections: ['markup']
        })
        expect(result).toMatchObject({
          type: 'applied',
          inputResult: { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 } }
        })
        expect(
          actor.handle({
            type: 'source-at-barrier',
            session: 1,
            sequence: 3,
            baseRevision: result.revision
          })
        ).toMatchObject({ source: 'x' + source })
        const undone = actor.handle({
          type: 'undo',
          session: 1,
          sequence: 4,
          baseRevision: result.revision,
          projections: []
        })
        expect(undone.type).toBe('applied')
        expect(
          actor.handle({
            type: 'source-at-barrier',
            session: 1,
            sequence: 5,
            baseRevision: undone.revision
          })
        ).toMatchObject({ source })
        const redone = actor.handle({
          type: 'redo',
          session: 1,
          sequence: 6,
          baseRevision: undone.revision,
          projections: []
        })
        expect(redone.type).toBe('applied')
        expect(
          actor.handle({
            type: 'source-at-barrier',
            session: 1,
            sequence: 7,
            baseRevision: redone.revision
          })
        ).toMatchObject({ source: 'x' + source })
      } finally {
        actor.dispose()
      }
    }
  )
})

describe('native deletion target spanning elided annotation syntax', () => {
  it.each([
    { source: '{~~(~>)~~}\n', end: 7, expected: '\n' },
    { source: '{~~({>>note<<}~>)~~}\n', end: 17, expected: '{>>note<<}\n' }
  ])('normalizes Delete from source4 through $end in $source', ({ source, end, expected }) => {
    const actor = createCoreActor()
    try {
      const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
      const result = actor.handle({
        type: 'input',
        session: 1,
        sequence: 2,
        baseRevision: opened.revision,
        action: {
          range: { start: 4, end },
          selection: { ranges: [{ anchor: 4, focus: 4 }], primary: 0 },
          inputType: 'deleteContentForward',
          data: null,
          options
        },
        tracked: false,
        projections: ['markup']
      })
      expect(result).toMatchObject({
        type: 'applied',
        inputResult: { selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 } }
      })
      expect(
        actor.handle({
          type: 'source-at-barrier',
          session: 1,
          sequence: 3,
          baseRevision: result.revision
        })
      ).toMatchObject({ source: expected })
      const undone = actor.handle({
        type: 'undo',
        session: 1,
        sequence: 4,
        baseRevision: result.revision,
        projections: []
      })
      expect(
        actor.handle({
          type: 'source-at-barrier',
          session: 1,
          sequence: 5,
          baseRevision: undone.revision
        })
      ).toMatchObject({ source })
      const redone = actor.handle({
        type: 'redo',
        session: 1,
        sequence: 6,
        baseRevision: undone.revision,
        projections: []
      })
      expect(
        actor.handle({
          type: 'source-at-barrier',
          session: 1,
          sequence: 7,
          baseRevision: redone.revision
        })
      ).toMatchObject({ source: expected })
    } finally {
      actor.dispose()
    }
  })
})
