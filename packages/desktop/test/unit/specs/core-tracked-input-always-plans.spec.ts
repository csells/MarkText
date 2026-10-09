import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore } from '@marktext/document-core'
import { createCoreActor } from '@/documentAuthority/coreActor'

// Every keystroke is applied, with Track Changes on or off (B17; owner
// decision, 9 October 2026: always apply). The actor leaves an input
// unchanged, or rejects it, only where Core returns no plan or refuses the
// edit, so typing must never reach those paths: every plan Core is asked for
// is recorded here, and none may be missing.

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
        if (edits === undefined) unplanned.push(`${JSON.stringify(action)} tracked=${String(tracked)}`)
        return edits
      } catch (error) {
        unplanned.push(`${JSON.stringify(action)} tracked=${String(tracked)}: ${String(error)}`)
        throw error
      }
    },
    planClipboard: (...args: Parameters<DocumentCore['planClipboard']>) => {
      try {
        return core.planClipboard(...args)
      } catch (error) {
        if (args[1].tracked === true) unplanned.push(`${JSON.stringify(args[1])}: ${String(error)}`)
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

// Keys typed inside the Addition's opener, or into the `$$` before the stray
// `~~}`: each re-pairs the document's math around the Addition's markers. Each
// is recorded over the math block whole, which Accept All and Reject All read
// as the operation and the document as it was, byte for byte.
const recorded: readonly (readonly [Key, { start: number, end: number, insert: string }])[] = [
  [[5, 'insertText', '$$'], { start: 5, end: 5, insert: '$$' }],
  [[6, 'insertText', '$$'], { start: 6, end: 6, insert: '$$' }],
  [[20, 'deleteContentBackward', null], { start: 19, end: 21, insert: '' }],
  [[21, 'deleteContentBackward', null], { start: 20, end: 21, insert: '' }]
]

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

const resolvedAll = async(source: string, decision: 'accept' | 'reject') => {
  const actor = createCoreActor()
  try {
    const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source })
    const resolved = await actor.handle({ type: 'resolve-all', session: 1, sequence: 2, baseRevision: opened.revision, decision, projections: [] })
    return resolved.type === 'applied' ? await sourceOf(actor, resolved.revision, 3) : source
  } finally {
    actor.dispose()
  }
}

describe('tracked typing', () => {
  it('is planned at every caret of a document no spelling search holds in', async() => {
    for (let caret = 0; caret <= unplannable.length; caret += 1) {
      await expectPlanned(unplannable, [caret, 'insertText', 'x'])
      await expectPlanned(unplannable, [caret, 'insertText', '$$'])
      if (caret > 0) await expectPlanned(unplannable, [caret, 'deleteContentBackward', null])
    }
  }, 60_000)

  it.each(recorded)('records a keystroke around the Addition exactly (%j)', async(key, edit) => {
    const unplanned: string[] = []
    const actor = createCoreActor(recordingCore(unplanned))
    try {
      const typedText = unplannable.slice(0, edit.start) + edit.insert + unplannable.slice(edit.end)
      const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source: unplannable })
      const result = await actor.handle(typed(1, opened.revision, key, true))
      expect(unplanned).toEqual([])
      if (result.type !== 'applied') throw new Error(`tracked keystroke was ${result.type}`)
      const applied = await sourceOf(actor, result.revision, 3)
      expect(applied).not.toBe(typedText)
      // Accept All reads as the keystroke and Reject All as the document as
      // it was, byte for byte.
      expect(await resolvedAll(applied, 'accept')).toBe(await resolvedAll(typedText, 'accept'))
      expect(await resolvedAll(applied, 'reject')).toBe(await resolvedAll(unplannable, 'reject'))
      const undone = await actor.handle({ type: 'undo', session: 1, sequence: 4, baseRevision: result.revision, projections: [] })
      if (undone.type !== 'applied') throw new Error(`undo was ${undone.type}`)
      expect(await sourceOf(actor, undone.revision, 5)).toBe(unplannable)
    } finally {
      actor.dispose()
    }
  })

  // Deleting the escape that keeps `{--` literal in an Addition: no record of
  // it leaves the Addition whole, so it is applied as typed, undo restores it,
  // and Accept All keeps it (owner decision, 9 October 2026: always apply).
  it('applies a keystroke no record holds as typed', async() => {
    const unplanned: string[] = []
    const actor = createCoreActor(recordingCore(unplanned))
    try {
      const source = 'a{++\\{--x++}b\n'
      const expected = 'a{++{--x++}b\n'
      const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source })
      const result = await actor.handle(typed(1, opened.revision, [5, 'deleteContentBackward', null], true))
      expect(unplanned).toEqual([])
      if (result.type !== 'applied') throw new Error(`tracked keystroke was ${result.type}`)
      const applied = await sourceOf(actor, result.revision, 3)
      expect(applied).toBe(expected)
      expect(await resolvedAll(applied, 'accept')).toBe(await resolvedAll(expected, 'accept'))
      const undone = await actor.handle({ type: 'undo', session: 1, sequence: 4, baseRevision: result.revision, projections: [] })
      if (undone.type !== 'applied') throw new Error(`undo was ${undone.type}`)
      expect(await sourceOf(actor, undone.revision, 5)).toBe(source)
    } finally {
      actor.dispose()
    }
  })

  it.each(budgeted)('is planned where the search budget decides the spelling (%#)', async(source, key) => {
    await expectPlanned(source, key)
  })

  // The input pool's documents (literal blocks, suggestions around them) and
  // its keys at every caret class, each typed on a fresh document, tracked and
  // untracked.
  it('is applied in either mode at the input pool\'s keys', async() => {
    const lcg = (seed: number) => (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const lines = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n')
    const blocks = [
      'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.',
      'Plain words here.', 'Text {==marked *text*==}{>>see **this** {++and that++}<<} end.', '- item {++one++}\n- item {--two--}',
      '> quoted {~~a~>b~~} line', '# Heading {++added++}', '```js\n' + lines(4, index => `const v${index} = ${index}`) + '\n```',
      '$$\n' + lines(3, index => `x_{${index}} + y`) + '\n$$', '<div>\n' + lines(3, index => `html ${index}`) + '\n</div>',
      lines(3, index => `    indented ${index}`), '{++```js\nconst added = 1\n```\n++}', '{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}',
      '{~~$$\nx_0\n$$\n~>$$\ny_0 + 1\n$$\n~~}', '{~~<div>\nold html\n</div>\n~><div>\nnew html\n</div>\n~~}', '{--```\ngone\n```\n--}',
      'x{~~```\nold\n```\n~>```\nnq\nqqw\n```\n~~}'
    ]
    const inputTypes = ['insertText', 'deleteContentBackward'] as const
    const refused: string[] = []
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = lcg(seed * 4441)
      const source = Array.from({ length: 3 + Math.floor(random() * 5) }, () => blocks[Math.floor(random() * blocks.length)] ?? '').join('\n\n') + '\n'
      for (let press = 0; press < 12; press += 1) {
        const caret = 1 + Math.floor(random() * source.length)
        const inputType = inputTypes[Math.floor(random() * inputTypes.length)] ?? 'insertText'
        const key: Key = [caret, inputType, inputType === 'insertText' ? 'x' : null]
        for (const tracked of [true, false]) {
          const unplanned: string[] = []
          const actor = createCoreActor(recordingCore(unplanned))
          try {
            const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source })
            const result = await actor.handle(typed(1, opened.revision, key, tracked))
            if (result.type !== 'applied' || unplanned.length > 0) refused.push(`${seed}/${press} ${JSON.stringify(key)} tracked=${String(tracked)} ${result.type}`)
          } finally {
            actor.dispose()
          }
        }
      }
    }
    expect(refused).toEqual([])
  }, 120_000)

  // Cut and paste with Track Changes on are planned too, at every caret of the
  // document no spelling search holds in.
  it('plans tracked cut and paste at every caret', async() => {
    const refused: string[] = []
    const clipboard = async(action: Record<string, unknown>) => {
      const unplanned: string[] = []
      const actor = createCoreActor(recordingCore(unplanned))
      try {
        const opened = await actor.handle({ type: 'open', session: 1, sequence: 1, source: unplannable })
        const result = await actor.handle({ type: 'clipboard', session: 1, sequence: 2, baseRevision: opened.revision, action: { ...action, tracked: true }, projections: [] } as never)
        if (result.type !== 'applied' || unplanned.length > 0) refused.push(`${JSON.stringify(action)} ${result.type} ${unplanned.join(' ')}`)
      } finally {
        actor.dispose()
      }
    }
    for (let caret = 0; caret <= unplannable.length; caret += 1) {
      for (const markdown of ['x', '$$', '{++']) {
        await clipboard({ kind: 'paste', selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, markdown })
      }
      if (caret > 0) await clipboard({ kind: 'cut', selection: { ranges: [{ anchor: caret - 1, focus: caret }], primary: 0 } })
      if (caret > 2) await clipboard({ kind: 'cut', selection: { ranges: [{ anchor: caret - 3, focus: caret }], primary: 0 } })
    }
    expect(refused).toEqual([])
  }, 120_000)
})
