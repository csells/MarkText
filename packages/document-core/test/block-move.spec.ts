import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

it.each([
  { source: 'one\n\ntwo\n\nthree\n', from: 0, to: 10, expected: 'two\n\nthree\n\none\n', anchor: 3, focus: 1, nextAnchor: 15, nextFocus: 13 },
  { source: 'one\r\n\r\ntwo\r\n\r\nthree', from: 0, to: 14, expected: 'two\r\n\r\nthree\r\n\r\none', anchor: 3, focus: 1, nextAnchor: 19, nextFocus: 17 },
  { source: 'one\n\n{++two++}{>>keep<<}\n\nthree\n', from: 8, to: 26, expected: 'one\n\nthree\n\n{++two++}{>>keep<<}\n', anchor: 10, focus: 9, nextAnchor: 17, nextFocus: 16 },
  { source: 'one\n\n> s{++a++}me\n> tail\n\nthree\n', from: 7, to: 26, expected: 'one\n\nthree\n\n> s{++a++}me\n> tail\n', anchor: 2, focus: 1, nextAnchor: 2, nextFocus: 1 }
])('moves exact owned source without normalizing spelling: $source', example => {
  const core = createDocumentCore()
  const revision = core.open(example.source)
  const action: DocumentInputAction = { kind: 'command', command: 'moveBlock', from: example.from, to: example.to, placement: 'after', selection: { ranges: [{ anchor: example.anchor, focus: example.focus }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(example.expected)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: example.nextAnchor, focus: example.nextFocus }], primary: 0 })
  expect(core.open(commit.revision.source).source).toBe(example.expected)
})

it('splits a shared multi-block addition when one owned paragraph is moved outside it', () => {
  const source = 'one\n\n{++two\n\nthree++}\n\nfour\n'
  const expected = 'one\n\n{++three++}\n\nfour\n\n{++two++}\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'moveBlock', from: source.indexOf('two'), to: source.indexOf('four'), placement: 'after', selection: { ranges: [{ anchor: 10, focus: 9 }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(expected)
  expect(core.project(commit.revision, 'revised').markdown).toBe('one\n\nthree\n\nfour\n\ntwo\n')
  expect(core.project(commit.revision, 'original').markdown).toBe('one\n\n\n\nfour\n\n\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 29, focus: 28 }], primary: 0 })
  expect(core.open(commit.revision.source).source).toBe(expected)
})

it.each([
  { source: '{--one\n\ntwo--}\n\nlast\n', expected: '{--two--}\n\nlast\n\n{--one--}\n', revised: '\n\nlast\n\n\n', original: 'two\n\nlast\n\none\n' },
  { source: '{==one\n\ntwo==}\n\nlast\n', expected: '{==two==}\n\nlast\n\n{==one==}\n', revised: 'two\n\nlast\n\none\n', original: 'two\n\nlast\n\none\n' },
  { source: '{++one{>>keep<<}\n\n{==two==}\n\nthree++}\n\nlast\n', expected: '{++{==two==}\n\nthree++}\n\nlast\n\n{++one{>>keep<<}++}\n', revised: 'two\n\nthree\n\nlast\n\none\n', original: '\n\nlast\n\n\n' },
  { source: '{~~one\n\ntwo~>three\n\nfour~~}\n\nlast\n', expected: '{~~two~>three\n\nfour~~}\n\nlast\n\n{~~one~>~~}\n', revised: 'three\n\nfour\n\nlast\n\n\n', original: 'two\n\nlast\n\none\n' }
])('retains shared annotation arms and nested comments: $source', example => {
  const core = createDocumentCore()
  const revision = core.open(example.source)
  const action: DocumentInputAction = { kind: 'command', command: 'moveBlock', from: example.source.indexOf('one'), to: example.source.indexOf('last'), placement: 'after', selection: { ranges: [{ anchor: 4, focus: 4 }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(example.expected)
  expect(core.project(commit.revision, 'original').markdown).toBe(example.original)
  expect(core.project(commit.revision, 'revised').markdown).toBe(example.revised)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toBeDefined()
  expect(core.open(commit.revision.source).source).toBe(example.expected)
})

it('tracks a block move as one structural replacement with original and revised order', () => {
  const core = createDocumentCore()
  const revision = core.open('one\n\ntwo\n\nthree\n')
  const action: DocumentInputAction = { kind: 'command', command: 'moveBlock', from: 5, to: 10, placement: 'after', selection: { ranges: [{ anchor: 7, focus: 7 }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(core.project(commit.revision, 'original').markdown).toBe('one\n\ntwo\n\nthree\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe('one\n\nthree\n\ntwo\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toBeDefined()
})
