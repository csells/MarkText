import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

it('replaces the owned annotated quick-insert trigger with an empty heading and preserves following content', () => {
  const core = createDocumentCore()
  const previous = core.open('/h{++e++}ad\n\noutside{>>keep<<}\n')
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeHeading',
    change: { type: 'quick-insert', level: 2 },
    selection: { ranges: [{ anchor: 11, focus: 11 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe('## \n\noutside{>>keep<<}\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 3, focus: 3 }], primary: 0 })
  expect(core.open(commit.revision.source).source).toBe(commit.revision.source)
})

it('tracks trigger consumption as one replacement while retaining its old annotated content', () => {
  const core = createDocumentCore()
  const previous = core.open('/h{++e++}ad\n\noutside{>>keep<<}\n')
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeHeading',
    change: { type: 'quick-insert', level: 2 },
    selection: { ranges: [{ anchor: 11, focus: 11 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe('{~~/h{++e++}ad~>## ~~}\n\noutside{>>keep<<}\n')
  expect(core.project(commit.revision, 'original').markdown).toBe('/had\n\noutside\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe('## \n\noutside\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 19, focus: 19 }], primary: 0 })
})

it('consumes comments inside the replaced trigger paragraph but keeps adjacent review content', () => {
  const core = createDocumentCore()
  const previous = core.open('/h{>>inside<<}ead\n\noutside{>>keep<<}\n')
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeHeading',
    change: { type: 'quick-insert', level: 2 },
    selection: { ranges: [{ anchor: 17, focus: 17 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe('## \n\noutside{>>keep<<}\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 3, focus: 3 }], primary: 0 })
})

it('keeps the consumed comment in the tracked old arm and restores it when rejecting that replacement', () => {
  const core = createDocumentCore()
  const source = '/h{>>inside<<}ead\n\noutside{>>keep<<}\n'
  const previous = core.open(source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeHeading',
    change: { type: 'quick-insert', level: 2 },
    selection: { ranges: [{ anchor: 17, focus: 17 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe('{~~/h{>>inside<<}ead~>## ~~}\n\noutside{>>keep<<}\n')
  expect(core.project(commit.revision, 'original').markdown).toBe('/head\n\noutside\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe('## \n\noutside\n')
  const suggestion = commit.revision.annotations.find(annotation => annotation.kind === 'substitution')
  expect(suggestion).toBeDefined()
  expect(core.resolve(commit.revision, suggestion!, 'reject').revision.source).toBe(source)
})

it('does not change ordinary visible text replacement comment retention', () => {
  const core = createDocumentCore()
  const previous = core.open('/h{>>inside<<}ead\n')
  const action: DocumentInputAction = {
    inputType: 'insertText',
    data: 'X',
    range: { start: 0, end: 17 },
    selection: { ranges: [{ anchor: 0, focus: 17 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  expect(core.apply(previous, core.inputEdits(previous, action, plan, false)!).revision.source).toBe('X{>>inside<<}\n')
})

it.each([
  { source: '{++/head++}\n\noutside{>>keep<<}\n', tracked: true, caret: 6, expected: '{++## ++}\n\noutside{>>keep<<}\n' },
  { source: '{++/head++}\n\noutside{>>keep<<}\n', tracked: false, caret: 3, expected: '## \n\noutside{>>keep<<}\n' },
  { source: '{++/head\n\nother++}\n\noutside{>>keep<<}\n', tracked: false, caret: 6, expected: '{++## \n\nother++}\n\noutside{>>keep<<}\n' }
])('consumes only annotation ownership confined to the trigger paragraph: $source Track=$tracked', ({ source, expected, tracked, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeHeading',
    change: { type: 'quick-insert', level: 2 },
    selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, tracked)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  if (tracked) expect(core.project(commit.revision, 'original').markdown).toBe('\n\noutside\n')
})

it('consumes the pending final query character created by the immediately preceding tracked key', () => {
  const core = createDocumentCore()
  const previous = core.open('/h{++e++}a{++d++}\n\noutside{>>keep<<}\n')
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeHeading',
    change: { type: 'quick-insert', level: 2 },
    selection: { ranges: [{ anchor: 17, focus: 17 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  expect(plan.edits).toEqual([{ start: 0, end: 14, insert: '## ' }])
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe('{~~/h{++e++}a{++d++}~>## ~~}\n\noutside{>>keep<<}\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 25, focus: 25 }], primary: 0 })
})
