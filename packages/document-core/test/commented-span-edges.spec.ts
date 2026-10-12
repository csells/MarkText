import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

// ADR 0003: nothing typed, pasted or dropped in Markup enters
// the gap between a Highlight and its Comment. Text at a commented span's edges
// stays outside it, as Google Docs keeps text typed at a comment's edge out of
// the comment; text typed inside the commented text joins it.

const options = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }
const source = 'x {==abc==}{>>n<<} y\n'
// x0 ' '1 {==2-4 a5 b6 c7 ==}8-10 {>>11-13 n14 <<}15-17 ' '18 y19

const input = (at: number, inputType: string, data: string | null): DocumentInputAction => ({
  selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
  range: { start: at, end: at },
  inputType,
  data,
  options
})

const perform = (text: string, action: DocumentInputAction, tracked: boolean) => {
  const core = createDocumentCore()
  const previous = core.open(text)
  const plan = core.planInput(previous, action, { tracked })
  const edits = core.inputEdits(previous, action, plan, tracked)
  if (edits === undefined) throw new Error('Input was refused')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  const caret = selection !== undefined && 'ranges' in selection ? selection.ranges[selection.primary]?.anchor : undefined
  return { source: commit.revision.source, caret }
}

it.each([
  { at: 8, name: 'the end of the commented text', untracked: 'x {==abc==}{>>n<<}Z y\n', tracked: 'x {==abc==}{>>n<<}{++Z++} y\n' },
  { at: 11, name: 'the gap before the comment', untracked: 'x {==abc==}{>>n<<}Z y\n', tracked: 'x {==abc==}{>>n<<}{++Z++} y\n' },
  { at: 5, name: 'the start of the commented text', untracked: 'x Z{==abc==}{>>n<<} y\n', tracked: 'x {++Z++}{==abc==}{>>n<<} y\n' },
  { at: 6, name: 'the middle of the commented text', untracked: 'x {==aZbc==}{>>n<<} y\n', tracked: 'x {==a{++Z++}bc==}{>>n<<} y\n' }
])('typing at $name keeps the commented span intact', ({ at, untracked, tracked }) => {
  const plain = perform(source, input(at, 'insertText', 'Z'), false)
  expect(plain.source).toBe(untracked)
  expect(plain.source.slice(0, plain.caret)).toMatch(/Z$/u)
  expect(perform(source, input(at, 'insertText', 'Z'), true).source).toBe(tracked)
})

it('Enter in the gap starts the new paragraph after the comment', () => {
  expect(perform(source, input(11, 'insertParagraph', null), false).source).toBe('x {==abc==}{>>n<<}\n\n y\n')
})

it('typing at the end of nested commented text leaves every span it ends', () => {
  expect(perform('{=={==a==}{>>m<<}==}{>>n<<}\n', input(7, 'insertText', 'Z'), false).source)
    .toBe('{=={==a==}{>>m<<}==}{>>n<<}Z\n')
})

it('an empty highlight keeps its gap closed too', () => {
  expect(perform('x {====}{>>n<<}\n', input(8, 'insertText', 'Z'), false).source).toBe('x {====}{>>n<<}Z\n')
})

it.each([8, 11])('paste at %i lands after the comment', (at) => {
  for (const tracked of [false, true]) {
    const core = createDocumentCore()
    const previous = core.open(source)
    const plan = core.planClipboard(previous, { kind: 'paste', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, markdown: 'P', tracked })
    const result = core.apply(previous, plan.edits).revision.source
    expect(result).toBe(tracked ? 'x {==abc==}{>>n<<}{++P++} y\n' : 'x {==abc==}{>>n<<}P y\n')
  }
})

it('a drop into the gap lands after the comment', () => {
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'moveText',
    copy: false,
    options,
    selection: { ranges: [{ anchor: 19, focus: 20 }], primary: 0 },
    target: { start: 11, end: 11 }
  }
  expect(perform('x {==abc==}{>>n<<} yz\n', action, false).source).toBe('x {==abc==}{>>n<<}y z\n')
})

it('Source edits keep the bytes the author typed (ADR 0015)', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  expect(core.apply(previous, [{ start: 11, end: 11, insert: 'Z' }]).revision.source).toBe('x {==abc==}Z{>>n<<} y\n')
})

// Profile 2, "Editing around commented spans": resolution keeps the Highlight/Comment relation meaningful.
const resolved = (text: string, decision: 'accept' | 'reject', kind: 'addition' | 'deletion' | 'substitution' = 'addition') => {
  const core = createDocumentCore()
  const previous = core.open(text)
  const pending = [...previous.annotations]
  while (pending.length > 0) {
    const annotation = pending.shift()!
    if (annotation.kind === kind) return core.resolve(previous, annotation, decision).revision.source
    for (const arm of annotation.arms) pending.push(...arm.annotations)
  }
  throw new Error(`No ${kind} in ${text}`)
}

it.each([
  { text: 'x {=={++new++}==}{>>n<<} y', decision: 'reject' as const, kind: 'addition' as const, expected: 'x {>>n<<} y' },
  { text: 'x {=={--old--}==}{>>n<<} y', decision: 'accept' as const, kind: 'deletion' as const, expected: 'x {>>n<<} y' },
  { text: 'x {=={++new++}==}{>>n<<} y', decision: 'accept' as const, kind: 'addition' as const, expected: 'x {==new==}{>>n<<} y' },
  { text: 'x {==a{++b++}==}{>>n<<} y', decision: 'reject' as const, kind: 'addition' as const, expected: 'x {==a==}{>>n<<} y' }
])('resolving the only text of commented passage $text ($decision) leaves a standalone comment', ({ text, decision, kind, expected }) => {
  expect(resolved(text, decision, kind)).toBe(expected)
})

it.each([
  { text: '{==a==}{++x++}{>>n<<} y', decision: 'reject' as const, kind: 'addition' as const, expected: '{==a{>>n<<}==} y' },
  { text: '{==a==}{--x--}{>>n<<} y', decision: 'accept' as const, kind: 'deletion' as const, expected: '{==a{>>n<<}==} y' },
  { text: '{==a==}{~~x~>~~}{>>n<<} y', decision: 'accept' as const, kind: 'substitution' as const, expected: '{==a{>>n<<}==} y' },
  { text: '{==a==}{++x++}{>>n<<} y', decision: 'accept' as const, kind: 'addition' as const, expected: '{==a==}x{>>n<<} y' },
  { text: '{==z==}{=={++x++}==}{>>n<<} y', decision: 'reject' as const, kind: 'addition' as const, expected: '{==z{>>n<<}==} y' }
])('resolving $text ($decision) does not pair a highlight with a comment it was not paired with', ({ text, decision, kind, expected }) => {
  expect(resolved(text, decision, kind)).toBe(expected)
})
