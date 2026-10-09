import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore } from '@marktext/document-core'
import { createCoreActor } from '@/documentAuthority/coreActor'

// Core plans every tracked key (B17). The actor leaves a tracked input
// unchanged only where Core returns no plan or refuses the edit, so typing
// must never reach that fallback: every tracked plan Core is asked for is
// recorded here, and none may be missing.

const OPTIONS = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

type Key = readonly [caret: number, inputType: 'insertText' | 'deleteContentBackward', data: string | null]

const recordingCore = (unplanned: string[]) => (): DocumentCore => {
  const core = createDocumentCore()
  return Object.freeze({
    ...core,
    inputEdits: (...args: Parameters<DocumentCore['inputEdits']>) => {
      const [, action, , tracked] = args
      try {
        const edits = core.inputEdits(...args)
        if (tracked && edits === undefined) unplanned.push(JSON.stringify(action))
        return edits
      } catch (error) {
        if (tracked) unplanned.push(`${JSON.stringify(action)}: ${String(error)}`)
        throw error
      }
    }
  })
}

const typeTracked = async(source: string, [caret, inputType, data]: Key) => {
  const unplanned: string[] = []
  const actor = createCoreActor(recordingCore(unplanned))
  try {
    const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source })
    const result = await actor.handle({
      type: 'input',
      session: 1,
      sequence: 2,
      baseRevision: opened.revision,
      tracked: true,
      action: {
        range: inputType === 'deleteContentBackward' ? { start: caret - 1, end: caret } : { start: caret, end: caret },
        selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
        inputType,
        data,
        options: OPTIONS
      },
      projections: []
    })
    return { result, unplanned }
  } finally {
    actor.dispose()
  }
}

const expectPlanned = async(source: string, key: Key) => {
  const { result, unplanned } = await typeTracked(source, key)
  expect(result, JSON.stringify({ source, key })).toMatchObject({ type: 'applied' })
  expect(unplanned, JSON.stringify({ source, key })).toEqual([])
}

// No spelling of `$$` typed here holds in any window or in the document.
const unplannable = '$$\n\n{++x\n\n\n++}\n\n\ny\n$$~~}\n'

// Pool keys (input pool 95/9 and 71/7) and the ks-132-8 key, whose
// spellings the document's search budget decides.
const budgeted: readonly (readonly [string, Key])[] = [
  ['{~~```js\nconst a = 0\n```\n~>``js\nconst a = 1\n```\n~~}\n\n{~~<div>\nold html\n</div>\n~><div>\nnew htxml\n</div>\n~~}\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\nText {==marked {++\n\n++}*text*==}{>>see **this** {++and that++}<<} end.\n\nPlain wo{--r--}ds here.\n\n{++\n++}{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}{--\n--}', [50, 'insertText', 'x']],
  ['Text {==ma{--r--}ked *text*==}{>>see **this** {++and that++}<<}{++\n\n++} end.\n\n{~~<div>\nold html\n</div>\n~><dv>\nnew html\n</div>\n~~}\n\n# Heading {++added++}\n{++\n\n++}\n<div>\nhtml 0\nhtml 1\nhtml 2\n</div>\n\nPlain w{++\n\nx++}ords her{--e--}.\n', [197, 'deleteContentBackward', null]],
  ['$$\nx + y\n$$\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n{=={--gone--}==}{>>only deleted<<} tail.\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n<div>\nhtml 0\n</div>\n\n    indented 0\n    indented 1\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\nPara with `one` and `two` code spans {++here++}.\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n1. first `x` one\n2. second {++y++}\n3. third\n\n# Heading {++added++}\n\n# Heading {++added++}\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n```js\nconst a = 0\nconst b = 1\n```\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n$$\nx + y\n$$\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\nPara with `one` and `two` code spans {++here++}.\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n    indented 0\n    indented 1\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n> quoted {~~a~>b~~} line\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n', [49, 'insertText', '`']]
]

// Keys no record can hold: each re-pairs the document's opening `$$` with the
// `$$` it writes, so any marker around the keystroke reads as math,
// and a wider record would hold the Addition's own markers in an arm. They are
// applied as typed (owner decision, 9 October 2026): undo restores them
// exactly and Accept All keeps them; Reject All cannot remove them.
// Each with the edit its input plan makes.
const unrecordable: readonly (readonly [Key, { start: number, end: number, insert: string }])[] = [
  [[5, 'insertText', '$$'], { start: 5, end: 5, insert: '$$' }],
  [[6, 'insertText', '$$'], { start: 6, end: 6, insert: '$$' }]
]

// Backspace into the `$$` before the stray `~~}` dissolves the Addition, which
// Core refuses untracked as well, so it changes nothing in either mode until
// the owner decides how an untracked refusal of typing is applied.
const refusedUntracked = new Set(['20', '21'])

const typed = (session: number, revision: number, [caret, inputType, data]: Key, tracked: boolean) => ({
  type: 'input' as const,
  session,
  sequence: 2,
  baseRevision: revision,
  tracked,
  action: {
    range: inputType === 'deleteContentBackward' ? { start: caret - 1, end: caret } : { start: caret, end: caret },
    selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
    inputType,
    data,
    options: OPTIONS
  },
  projections: []
})

const sourceOf = async(actor: ReturnType<typeof createCoreActor>, revision: number, sequence: number) => {
  const saved = await actor.handle({ type: 'source-at-barrier', session: 1, sequence, baseRevision: revision })
  if (saved.type !== 'source') throw new Error(`source-at-barrier was ${saved.type}`)
  return saved.source
}

const acceptedAll = async(source: string) => {
  const actor = createCoreActor()
  try {
    const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source })
    const accepted = await actor.handle({ type: 'resolve-all', session: 1, sequence: 2, baseRevision: opened.revision, decision: 'accept', projections: [] })
    return accepted.type === 'applied' ? await sourceOf(actor, accepted.revision, 3) : source
  } finally {
    actor.dispose()
  }
}

describe('tracked typing', () => {
  it('is planned at every caret of a document no spelling search holds in', async() => {
    for (let caret = 0; caret <= unplannable.length; caret += 1) {
      await expectPlanned(unplannable, [caret, 'insertText', 'x'])
      await expectPlanned(unplannable, [caret, 'insertText', '$$'])
      if (caret > 0 && !refusedUntracked.has(String(caret))) await expectPlanned(unplannable, [caret, 'deleteContentBackward', null])
    }
  }, 60_000)

  it.todo('applies Backspace into the `$$` before a stray closer, which Core refuses untracked as well')

  it.each(unrecordable)('applies a keystroke no record holds as typed (%j)', async(key, edit) => {
    const unplanned: string[] = []
    const actor = createCoreActor(recordingCore(unplanned))
    try {
      const expected = unplannable.slice(0, edit.start) + edit.insert + unplannable.slice(edit.end)
      const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source: unplannable })
      const result = await actor.handle(typed(1, opened.revision, key, true))
      expect(unplanned).toEqual([])
      if (result.type !== 'applied') throw new Error(`tracked keystroke was ${result.type}`)
      // The keystroke is applied as typed, and Accept All keeps it.
      const applied = await sourceOf(actor, result.revision, 3)
      expect(applied).toBe(expected)
      expect(await acceptedAll(applied)).toBe(await acceptedAll(expected))
      // Undo restores the document exactly.
      const undone = await actor.handle({ type: 'undo', session: 1, sequence: 4, baseRevision: result.revision, projections: [] })
      if (undone.type !== 'applied') throw new Error(`undo was ${undone.type}`)
      expect(await sourceOf(actor, undone.revision, 5)).toBe(unplannable)
    } finally {
      actor.dispose()
    }
  })

  it.each(budgeted)('is planned where the search budget decides the spelling (%#)', async(source, key) => {
    await expectPlanned(source, key)
  })
})
