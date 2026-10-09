import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { planFromGeneralCompile, searchWithoutBudget } from '../src/internal/documentCoreInspection.js'

// A backtick typed on the empty line after a table pairs with one far below
// it, and the line joins the table. The document's spelling search stops at
// its budget (owner decision, 8 October 2026) and the key takes its closest
// spelling that leaves no marker unpaired: the empty line struck and the
// typed one proposed, which Accept All and Reject All read as the untracked
// edit and the document as it was.
const source = '$$\nx + y\n$$\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n{=={--gone--}==}{>>only deleted<<} tail.\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n<div>\nhtml 0\n</div>\n\n    indented 0\n    indented 1\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\nPara with `one` and `two` code spans {++here++}.\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n1. first `x` one\n2. second {++y++}\n3. third\n\n# Heading {++added++}\n\n# Heading {++added++}\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n```js\nconst a = 0\nconst b = 1\n```\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n$$\nx + y\n$$\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\nPara with `one` and `two` code spans {++here++}.\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n    indented 0\n    indented 1\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n> quoted {~~a~>b~~} line\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n'
const key = { start: 49, end: 49, insert: '`' }

const typed = (core: ReturnType<typeof createDocumentCore>, opened: ReturnType<ReturnType<typeof createDocumentCore>['open']>) => {
  const action = {
    range: { start: key.start, end: key.end },
    selection: { ranges: [{ anchor: key.start, focus: key.start }], primary: 0 },
    inputType: 'insertText',
    data: key.insert,
    options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  } as const
  return core.inputEdits(opened, action, core.planInput(opened, action, { tracked: true }), true)
}

describe('a document-level spelling search past its budget', () => {
  it('takes the closest spelling, which resolves exactly', () => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const planned = typed(core, opened)
    expect(planned).toEqual([{ start: 49, end: 50, insert: '{--\n--}{++`\n++}' }])
    const next = core.apply(opened, planned ?? []).revision
    expect(next.diagnostics.length).toBeLessThanOrEqual(opened.diagnostics.length)
    // Accepting the suggestions it authors gives the untracked edit, and
    // rejecting them the document as it was, byte for byte.
    const tracked = next.source
    expect(tracked.replace('{--\n--}{++`\n++}', '`\n'))
      .toBe(source.slice(0, key.start) + key.insert + source.slice(key.end))
    expect(tracked.replace('{--\n--}{++`\n++}', '\n')).toBe(source)
  })

  it('as the unbudgeted reference spells it, where no spelling holds', () => {
    const reference = createDocumentCore()
    planFromGeneralCompile(reference)
    expect(typed(reference, reference.open(source))).toEqual([{ start: 49, end: 49, insert: '{++`++}' }])
  })
})

// Pool keys whose spelling the budget decides (input pool 95/9 and 71/7): the
// unbudgeted search finds another spelling past the budget. The budgeted one
// is still a spelling of the key: it adds no diagnostic, Reject All of what it
// authors gives the document as it was, and Accept All the key as typed.
// 95/9 types inside a Substitution's closer (`~~|}`): no spelling's Accept All
// reads as the raw key there, budgeted or not, so only Reject All and the
// diagnostics are weighed for it.
const budgeted = [
  ['95/9', '{~~```js\nconst a = 0\n```\n~>``js\nconst a = 1\n```\n~~}\n\n{~~<div>\nold html\n</div>\n~><div>\nnew htxml\n</div>\n~~}\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\nText {==marked {++\n\n++}*text*==}{>>see **this** {++and that++}<<} end.\n\nPlain wo{--r--}ds here.\n\n{++\n++}{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}{--\n--}', 50, 'insertText'],
  ['71/7', 'Text {==ma{--r--}ked *text*==}{>>see **this** {++and that++}<<}{++\n\n++} end.\n\n{~~<div>\nold html\n</div>\n~><dv>\nnew html\n</div>\n~~}\n\n# Heading {++added++}\n{++\n\n++}\n<div>\nhtml 0\nhtml 1\nhtml 2\n</div>\n\nPlain w{++\n\nx++}ords her{--e--}.\n', 197, 'deleteContentBackward']
] as const

const press = (core: ReturnType<typeof createDocumentCore>, text: string, caret: number, inputType: string, tracked: boolean) => {
  const opened = core.open(text)
  const range = inputType === 'deleteContentBackward'
    ? { start: Math.max(0, caret - 1), end: caret }
    : inputType === 'deleteContentForward' ? { start: caret, end: caret + 1 } : { start: caret, end: caret }
  const action = {
    range,
    selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
    inputType,
    data: inputType === 'insertText' ? 'x' : null,
    options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  } as never
  return { opened, edits: core.inputEdits(opened, action, core.planInput(opened, action, { tracked }), tracked) }
}

describe('a pool key whose spelling the budget decides', () => {
  it.each(budgeted)('%s is still spelled, exactly', (_name, text, caret, inputType) => {
    const core = createDocumentCore()
    const { opened, edits } = press(core, text, caret, inputType, true)
    const unbudgeted = createDocumentCore()
    searchWithoutBudget(unbudgeted)
    expect(press(unbudgeted, text, caret, inputType, true).edits).not.toEqual(edits)
    unbudgeted.open(text)
    const [edit] = edits ?? []
    if (edit === undefined) throw new Error('Expected a tracked plan')
    const next = core.apply(opened, [edit]).revision
    expect(next.diagnostics.length).toBeLessThanOrEqual(opened.diagnostics.length)
    // Accept All reads as the unbudgeted spelling's Accept All, the key as
    // typed, and Reject All as the document as it was.
    const other = press(unbudgeted, text, caret, inputType, true)
    const reference = unbudgeted.apply(other.opened, other.edits ?? []).revision
    if (_name !== '95/9') expect(core.project(next, 'revised').markdown).toBe(unbudgeted.project(reference, 'revised').markdown)
    expect(core.project(next, 'original').markdown).toBe(core.project(opened, 'original').markdown)
  })
})

// A dollar-heavy agreement key (132/3) the budget once decided (coordinator
// sign-off, 9 October 2026). Since math in a suggestion's arms reads as the
// document reads it (B19), the budgeted and unbudgeted searches spell it
// alike, over the suggestions around it whole; its spelling adds no
// diagnostic and resolves to the operation's bytes.
describe('the dollar-heavy key 132/3 past its budget', () => {
  const text = 'q> $$\n> q\n\n{++$\n\n$$\n$\nx\ny\n$$++}\n\n{++x\n\n$$\ny\n\nw++}\n\n{++$$\nx\ny\n$$++}\n\n{++x\n\n$$\ny\n\nw++}\n\n```\ncode $$\n```\n\ncosts $$5 and $3\n\n{++x\n\n$$\ny\n\nw++}\n\ncosts $$5 and $3\n\nReview {++new++} and {--old--} text.\n\ninline \n$a$ math\n\n{++$$\nx\ny\n$$++}\n\nReview {++new++} and {--old--} text.\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\nPlain words here.\n\nReview {++new++} and {--old--} text.\n\n```\ncode $$\n```\n\nz\n$$\n\n$$\n\n{++x\n\n$$\ny\n\nw++}\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\n$$\nx_0 + y\nx_1\n$$\n\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\nReview {++new++} and {--old--} text.\n\nz{++$$++}\n$$\n\n$$\n\n{++$$\nx\ny\n$$++}\n\n- item $$\n- item\n\ncosts $$5 and $3\n\n$$\nx_0 + y\nx_1\n$$\n\nReview {++new++} and {--old--} text.\n\nx\n$$\n\nz\n$$\n\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\nPlain words here.\n\ninline $a$ math\n\n> $$\n> q\n\n$$\n\nPlain words here.\n\n{++$$\nx\ny\n$$++}\n\nReview {++new++} and {--old--} text.\n\ninline $a$ math\n'
  const key = { start: 562, end: 562, insert: 'x' }

  it('takes a spelling that adds no diagnostic and resolves exactly', () => {
    const core = createDocumentCore()
    const opened = core.open(text)
    const spelled = core.trackedEdit(opened, key)
    const unbudgeted = createDocumentCore()
    searchWithoutBudget(unbudgeted)
    expect(unbudgeted.trackedEdit(unbudgeted.open(text), key)).toEqual(spelled)
    if (spelled === undefined) throw new Error('Expected a tracked plan')
    const next = core.apply(opened, [spelled]).revision
    expect(next.diagnostics.length).toBeLessThanOrEqual(opened.diagnostics.length)
    const typed = text.slice(0, key.start) + key.insert + text.slice(key.end)
    // The suggestions it authors resolved, each to the arm the decision keeps
    // as written, as the oracle resolves them.
    const authored = next.annotations.filter(annotation => annotation.range.start >= spelled.start &&
      annotation.range.end <= spelled.start + spelled.insert.length)
    const kept = { accept: { addition: 'content', substitution: 'new' }, reject: { deletion: 'content', substitution: 'old' } } as const
    const resolve = (decision: 'accept' | 'reject'): string => [...authored].reverse().reduce((source, annotation) => {
      const name = (kept[decision] as Record<string, string>)[annotation.kind]
      const arm = annotation.arms.find(candidate => candidate.name === name)?.range
      return source.slice(0, annotation.range.start) + (arm === undefined ? '' : next.source.slice(arm.start, arm.end)) + source.slice(annotation.range.end)
    }, next.source)
    expect(resolve('accept')).toBe(typed)
    expect(resolve('reject')).toBe(text)
  })
})

// Enter typed in a math Substitution's new text beside a separator a line
// break already broke (input pool, the 9/10 shape): no spelling of it adds no
// diagnostic, with or without the budget, so the budget's closest spelling
// stands as a budget outcome where Accept All and Reject All resolve it to the
// operation's bytes (coordinator ruling, 9 October 2026).
describe('a key no diagnostic-free spelling holds, past its budget', () => {
  const text = '{-- --}{++\n++}{~~   indented 0\n    indented 1\n    indented 2\n~>    indented 0\n   indented 1\n   indented 2\n~~}\n{--```\ngone\n```\n--}\n\nTex{--t--} {++\n\n++}{++\n\n++}{==marked *text*==}{>>see **this** {++and that++}<<} end.\n\n# Heading {++added++}\n\n{--```\ngone\n```\n--}\n\n{~~$$\nx_{0} + y\nx_{1} + y\nx_{2} + y\n$$~\n>$$\nx_{0}x + y\nx_{1} + y\nx_{2} + y\n$$~~}{--\n--}'
  const enter = {
    range: { start: 293, end: 293 },
    selection: { ranges: [{ anchor: 293, focus: 293 }], primary: 0 },
    inputType: 'insertParagraph',
    data: null,
    options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  } as const

  it('takes a spelling that resolves exactly', () => {
    const plans = [false, true].map(unbudgeted => {
      const core = createDocumentCore()
      if (unbudgeted) searchWithoutBudget(core)
      const opened = core.open(text)
      const plan = core.planInput(opened, enter, { tracked: true })
      const edits = core.inputEdits(opened, enter, plan, true) ?? []
      const next = core.apply(opened, edits).revision
      return { plan, edits, next, before: opened.diagnostics.length }
    })
    const [budgeted, unbudgeted] = plans
    if (budgeted === undefined || unbudgeted === undefined) throw new Error('Expected both plans')
    expect(budgeted.edits).not.toEqual(unbudgeted.edits)
    for (const { next, before } of plans) expect(next.diagnostics.length).toBeGreaterThan(before)
    const [spelled] = budgeted.edits
    if (spelled === undefined) throw new Error('Expected a tracked plan')
    let typed = text
    for (const edit of [...budgeted.plan.edits].reverse()) typed = typed.slice(0, edit.start) + edit.insert + typed.slice(edit.end)
    const next = budgeted.next
    const authored = next.annotations.filter(annotation => annotation.range.start >= spelled.start &&
      annotation.range.end <= spelled.start + spelled.insert.length)
    const kept = { accept: { addition: 'content', substitution: 'new' }, reject: { deletion: 'content', substitution: 'old' } } as const
    const resolve = (decision: 'accept' | 'reject'): string => [...authored].reverse().reduce((source, annotation) => {
      const name = (kept[decision] as Record<string, string>)[annotation.kind]
      const arm = annotation.arms.find(candidate => candidate.name === name)?.range
      return source.slice(0, annotation.range.start) + (arm === undefined ? '' : next.source.slice(arm.start, arm.end)) + source.slice(annotation.range.end)
    }, next.source)
    expect(resolve('accept')).toBe(typed)
    expect(resolve('reject')).toBe(text)
  })
})
