import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'
import { markupEditOwnership } from '../src/markupEditOwnership.js'

it.each([false, true])('replaces a complete slash trigger including its leading comment (Track=%s)', tracked => {
  const core = createDocumentCore()
  const trigger = '{>>inside<<}/code'
  const suffix = '\n\noutside{>>keep<<}\n'
  const revision = core.open(trigger + suffix)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'createCodeBlock',
    replace: true,
    selection: { ranges: [{ anchor: trigger.length, focus: trigger.length }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(revision, action)
  expect(plan.edits).toEqual([{ start: 0, end: trigger.length, insert: '```\n\n```' }])
  const edits = core.inputEdits(revision, action, plan, tracked)
  expect(edits).toBeDefined()
  if (edits === undefined) throw new Error('The complete owned trigger was rejected')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe((tracked ? '{~~' + trigger + '~>```\n\n```~~}' : '```\n\n```') + suffix)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({
    ranges: [{ anchor: tracked ? trigger.length + 9 : 4, focus: tracked ? trigger.length + 9 : 4 }], primary: 0
  })
})

it('keeps visible replacements and partial annotation delimiters outside structural admission', () => {
  const core = createDocumentCore()
  const source = '{>>inside<<}/code\n'
  const revision = core.open(source)
  expect(core.markupEdits(revision, [{ start: 0, end: source.length - 1, insert: 'x' }])).toBeUndefined()
  expect(markupEditOwnership(core, revision, [{ start: 1, end: source.length - 1, insert: 'x' }], 'structure')).toBeUndefined()
})
