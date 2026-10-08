import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const splice = (source: string, edits: readonly { start: number; end: number; insert: string }[]) =>
  [...edits]
    .reverse()
    .reduce((text, edit) => text.slice(0, edit.start) + edit.insert + text.slice(edit.end), source)

describe('Core actor sparse native input results', () => {
  it('preserves tracked paired deletion and keeps the caret before the struck pair', () => {
    // Google Docs: a tracked Backspace leaves the caret before the text it strikes.
    const actor = createCoreActor()
    try {
      const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source: '()' })
      const result = actor.handle({
        type: 'input',
        session: 1,
        sequence: 2,
        baseRevision: opened.revision,
        action: {
          range: { start: 0, end: 1 },
          selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
          inputType: 'deleteContentBackward',
          data: null,
          options
        },
        tracked: true,
        projections: ['markup']
      })
      expect(result).toMatchObject({
        type: 'applied',
        inputResult: {
          compilerReconciliation: [{ start: 0, end: 0, insert: '{--()--}' }],
          selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 }
        }
      })
      expect(
        actor.handle({
          type: 'source-at-barrier',
          session: 1,
          sequence: 3,
          baseRevision: result.revision
        })
      ).toMatchObject({ source: '{--()--}' })
    } finally {
      actor.dispose()
    }
  })

  it.each([
    {
      source: '{~~(~>)~~}',
      start: 3,
      end: 4,
      caret: 4,
      inputType: 'deleteContentBackward',
      expected: ''
    },
    {
      source: '{~~(~>)~~}',
      start: 6,
      end: 7,
      caret: 6,
      inputType: 'deleteContentForward',
      expected: ''
    },
    {
      source: '{~~({>>note<<}~>)~~}',
      start: 3,
      end: 4,
      caret: 4,
      inputType: 'deleteContentBackward',
      expected: '{>>note<<}'
    },
    {
      source: '{~~({>>note<<}~>)~~}',
      start: 16,
      end: 17,
      caret: 16,
      inputType: 'deleteContentForward',
      expected: '{>>note<<}'
    }
  ])(
    'returns source and selection for $inputType across $source',
    ({ source, start, end, caret, inputType, expected }) => {
      const actor = createCoreActor()
      try {
        const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
        expect(opened.type).toBe('opened')
        const result = actor.handle({
          type: 'input',
          session: 1,
          sequence: 2,
          baseRevision: opened.revision,
          action: {
            range: { start, end },
            selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
            inputType,
            data: null,
            options
          },
          tracked: false,
          projections: ['markup']
        })
        expect(result.type).toBe('applied')
        if (result.type !== 'applied') throw new Error('Sparse input was not admitted')
        expect(
          actor.handle({
            type: 'source-at-barrier',
            session: 1,
            sequence: 3,
            baseRevision: result.revision
          })
        ).toMatchObject({ source: expected })
        expect(result.inputResult?.compilerReconciliation).toBeDefined()
        expect(result.inputResult?.selection).toEqual({
          ranges: [{ anchor: 0, focus: 0 }],
          primary: 0
        })
        const input = result.inputResult
        if (input?.compilerReconciliation === undefined) { throw new Error('Sparse input mapping is absent') }
        expect(splice(splice(source, input.policy.edits), input.compilerReconciliation)).toBe(
          expected
        )
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
    }
  )

  // Vision principle 7: any edit that can be made untracked can be made
  // tracked, so no tracked input is a no-op. One no narrower suggestion can
  // spell, as a `$$` typed in an Addition that pairs with the `$$` opening
  // the document, falls back to replacing the text whole, which Accept All
  // and Reject All resolve exactly.
  it('suggests the whole text when no narrower spelling reads as the tracked input', () => {
    const actor = createCoreActor()
    try {
      const source = '$$\n\n{++x\n\nw++}\n\n\ny\n$$~~}\n'
      const typed = source.slice(0, 8) + '$$' + source.slice(8)
      const spelled = `{--${source}--}{++${typed}++}`
      const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
      const result = actor.handle({
        type: 'input',
        session: 1,
        sequence: 2,
        baseRevision: opened.revision,
        action: {
          range: { start: 8, end: 8 },
          selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 },
          inputType: 'insertText',
          data: '$$',
          options
        },
        tracked: true,
        projections: ['markup']
      })
      expect(result).toMatchObject({
        type: 'applied',
        change: { appliedEdits: [{ start: 0, end: source.length, insert: spelled }] }
      })
      expect(actor.handle({ type: 'source-at-barrier', session: 1, sequence: 3, baseRevision: result.revision })).toMatchObject({ source: spelled })
      const undone = actor.handle({ type: 'undo', session: 1, sequence: 4, baseRevision: result.revision, projections: [] })
      expect(actor.handle({ type: 'source-at-barrier', session: 1, sequence: 5, baseRevision: undone.revision })).toMatchObject({ source })
    } finally {
      actor.dispose()
    }
  })

  // Vision principle 7: any edit that can be made untracked can be made
  // tracked. A backtick typed in struck text splits the deletion at the
  // caret, as any character typed there does (Google Docs), now that the
  // Addition's unfinished backtick before it no longer reads on past its
  // closer (Profile 1 L2a).
  it('splits struck text at the caret for a tracked backtick (vision principle 7)', () => {
    const actor = createCoreActor()
    const resolveAll = (text: string, accept: boolean): string =>
      text.replace(/\{\+\+([^]*?)\+\+\}|\{--([^]*?)--\}|\{~~([^]*?)~>([^]*?)~~\}/gu,
        (_whole, added = '', deleted = '', old = '', next = '') => accept ? added + next : deleted + old)
    try {
      const source = 'the {--s--}{++`++}{~~low~>fast~~} fox\n'
      const spelled = 'the {--s--}{++`++}{--l--}{++`++}{~~ow~>fast~~} fox\n'
      const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
      const result = actor.handle({
        type: 'input',
        session: 1,
        sequence: 2,
        baseRevision: opened.revision,
        action: {
          range: { start: 22, end: 22 },
          selection: { ranges: [{ anchor: 22, focus: 22 }], primary: 0 },
          inputType: 'insertText',
          data: '`',
          options
        },
        tracked: true,
        projections: ['markup']
      })
      expect(result).toMatchObject({
        type: 'applied',
        inputResult: { selection: { ranges: [{ anchor: 29, focus: 29 }], primary: 0 } }
      })
      expect(actor.handle({ type: 'source-at-barrier', session: 1, sequence: 3, baseRevision: result.revision })).toMatchObject({ source: spelled })
      // Accept All shows the typed backtick where it was typed; Reject All
      // restores the original text exactly.
      expect(resolveAll(spelled, true)).toBe('the ``fast fox\n')
      expect(resolveAll(spelled, false)).toBe(resolveAll(source, false))
      const undone = actor.handle({ type: 'undo', session: 1, sequence: 4, baseRevision: result.revision, projections: [] })
      expect(actor.handle({ type: 'source-at-barrier', session: 1, sequence: 5, baseRevision: undone.revision })).toMatchObject({ source })
    } finally {
      actor.dispose()
    }
  })
})
