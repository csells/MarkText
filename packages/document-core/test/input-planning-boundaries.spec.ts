import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

describe('input planning through shared Markup edit compilation', () => {
  it('removes a substitution when its entire visible pair is selected', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~(~>)~~}')
    const edits = core.markupEdit(revision, { start: 3, end: 7, insert: '' })
    expect(edits).toBeDefined()
    if (edits === undefined) throw new Error('Selected pair deletion was not admitted')
    expect(core.apply(revision, edits).revision.source).toBe('')
  })

  it.each([
    { inputType: 'deleteContentBackward', range: { start: 3, end: 4 }, caret: 4 },
    { inputType: 'deleteContentForward', range: { start: 6, end: 7 }, caret: 6 }
  ])('admits $inputType of a pair spanning substitution arms', ({ inputType, range, caret }) => {
    const core = createDocumentCore()
    const revision = core.open('{~~(~>)~~}')
    const inputAction: DocumentInputAction = {
      range,
      selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
      inputType,
      data: null,
      options
    }
    const plan = core.planInput(revision, inputAction)
    expect(plan.edits).toEqual([
      { start: 3, end: 4, insert: '' },
      { start: 6, end: 7, insert: '' }
    ])
    const edits = core.inputEdits(revision, inputAction, plan, false)
    expect(edits).toBeDefined()
    if (edits === undefined) throw new Error('Planned pair deletion was not admitted')
    const commit = core.apply(revision, edits)
    expect(commit.revision.source).toBe('')
    expect(core.reconcileInput(revision, plan, commit, inputAction)).toMatchObject({
      compilerReconciliation: [{ start: 0, end: 8, insert: '' }],
      selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 }
    })
    expect(core.project(commit.revision, 'original').markdown).toBe('')
    expect(core.project(commit.revision, 'revised').markdown).toBe('')
  })

  it('refuses to map a different compilation for a sparse policy', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~(~>)~~}')
    const inputAction: DocumentInputAction = {
      range: { start: 3, end: 4 },
      selection: { ranges: [{ anchor: 4, focus: 4 }], primary: 0 },
      inputType: 'deleteContentBackward',
      data: null,
      options
    }
    const plan = core.planInput(revision, inputAction)
    const commit = core.apply(revision, [{ start: 0, end: 10, insert: 'different' }])
    expect(core.reconcileInput(revision, plan, commit, inputAction)).toEqual({ policy: plan })
  })
})

describe('native insertion at owned annotation boundaries', () => {
  const sources = ['{++a++}a\n', '{++{==a==}++}\n', '{>>note<<}', '{++{>>note<<}++}\n']
  it.each(sources.flatMap(source => [0, source.trimEnd().length, ...(source.includes('{==') ? [3, 10] : [])].map(at => ({ source, at }))))(
    'inserts outside annotations at $at in $source', ({ source, at }) => {
      const core = createDocumentCore()
      const revision = core.open(source)
      const inputAction: DocumentInputAction = {
        range: { start: at, end: at },
        selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
        inputType: 'insertText',
        data: 'x',
        options
      }
      const plan = core.planInput(revision, inputAction)
      const edits = core.inputEdits(revision, inputAction, plan, false)
      expect(edits).toBeDefined()
      if (edits === undefined) throw new Error('Annotation boundary input was rejected')
      const commit = core.apply(revision, edits)
      expect(commit.revision.source).toBe(source.slice(0, at) + 'x' + source.slice(at))
      expect(core.reconcileInput(revision, plan, commit, inputAction).selection).toEqual({ ranges: [{ anchor: at + 1, focus: at + 1 }], primary: 0 })
    }
  )

  it.each([1, 2, 5, 6])('does not admit marker-interior insertion at %i', at => {
    const core = createDocumentCore()
    const revision = core.open('{++a++}')
    expect(core.markupEdit(revision, { start: at, end: at, insert: 'x' })).toBeUndefined()
    expect(revision.source).toBe('{++a++}')
  })
})

describe('collapsed deletion range projection', () => {
  const splice = (source: string, edits: readonly { start: number, end: number, insert: string }[]) =>
    [...edits].reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.insert + text.slice(edit.end), source)

  it.each([
    { source: '{~~(~>)~~}\n', start: 4, end: 7, caret: 4, inputType: 'deleteContentForward', expected: '\n' },
    { source: '{~~({>>note<<}~>)~~}\n', start: 4, end: 17, caret: 4, inputType: 'deleteContentForward', expected: '{>>note<<}\n' },
    { source: '{~~(~>)~~}\n', start: 3, end: 6, caret: 6, inputType: 'deleteContentBackward', expected: '\n' },
    { source: '{~~({>>note<<}~>)~~}\n', start: 3, end: 16, caret: 16, inputType: 'deleteContentBackward', expected: '{>>note<<}\n' }
  ])('maps the exact raw target through $inputType on $source', ({ source, start, end, caret, inputType, expected }) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const inputAction: DocumentInputAction = { range: { start, end }, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, inputType, data: null, options }
    const plan = core.planInput(revision, inputAction)
    const rawEcho = source.slice(0, start) + source.slice(end)
    const plannedSource = splice(source, plan.edits)
    expect(splice(rawEcho, plan.reconciliation)).toBe(plannedSource)
    const edits = core.inputEdits(revision, inputAction, plan, false)
    expect(edits).toBeDefined()
    if (edits === undefined) throw new Error('Collapsed deletion was rejected')
    const commit = core.apply(revision, edits)
    expect(commit.revision.source).toBe(expected)
    const result = core.reconcileInput(revision, plan, commit, inputAction)
    expect(result.compilerReconciliation).toBeDefined()
    expect(result.selection).toEqual({ ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
    if (result.compilerReconciliation === undefined) throw new Error('Collapsed deletion lacks compiler mapping')
    expect(splice(plannedSource, result.compilerReconciliation)).toBe(expected)
  })

  it.each([
    { end: 11, selectionEnd: 4, expected: '(\n' },
    { end: 7, selectionEnd: 7, expected: '(x\n' }
  ])('preserves the opener for an unpaired deletion ending $end', ({ end, selectionEnd, expected }) => {
    const core = createDocumentCore()
    const revision = core.open('{~~(~>)~~}x\n')
    const inputAction: DocumentInputAction = {
      range: { start: 4, end }, selection: { ranges: [{ anchor: 4, focus: selectionEnd }], primary: 0 }, inputType: 'deleteContentForward', data: null, options
    }
    const plan = core.planInput(revision, inputAction)
    const edits = core.inputEdits(revision, inputAction, plan, false)
    expect(edits).toBeDefined()
    if (edits === undefined) throw new Error('Native deletion was rejected')
    const result = core.apply(revision, edits)
    expect(core.project(result.revision, 'markup').events.filter(event => event.kind === 'text').map(event => event.text).join(''))
      .toBe(expected)
  })
})

describe('browser-normalized collapsed insertion targets', () => {
  const splice = (source: string, edits: readonly { start: number, end: number, insert: string }[]) =>
    [...edits].reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.insert + text.slice(edit.end), source)

  it.each([
    { source: '{++a++}a\n', caret: 0, target: 3, data: 'x', expected: 'x{++a++}a\n', selected: 1 },
    { source: '{++a++}a\n', caret: 3, target: 0, data: 'x', expected: '{++xa++}a\n', selected: 4 },
    { source: '{++a++}a\n', caret: 7, target: 4, data: 'x', expected: '{++a++}xa\n', selected: 8 },
    { source: '{++a++}a\n', caret: 4, target: 7, data: 'x', expected: '{++ax++}a\n', selected: 5 },
    { source: '{++ ++}a\n', caret: 0, target: 3, data: '(', expected: '(){++ ++}a\n', selected: 1 },
    { source: '{++{==a==}++}\n', caret: 3, target: 6, data: 'x', expected: '{++x{==a==}++}\n', selected: 4 },
    { source: '| aa | bb |\n| --- | --- |{++\n|     |     |++}\n| cc | dd |\n', caret: 35, target: 41, data: 'x', expected: '| aa | bb |\n| --- | --- |{++\n|     x|     |++}\n| cc | dd |\n', selected: 36 }
  ])('uses live caret $caret rather than normalized target $target for $data', ({ source, caret, target, data, expected, selected }) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const range = { start: target, end: target }
    const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, range, inputType: 'insertText', data, options }
    const plan = core.planInput(revision, inputAction)
    const edits = core.inputEdits(revision, inputAction, plan, false)
    if (edits === undefined) throw new Error('Collapsed insertion was rejected')
    const commit = core.apply(revision, edits)
    expect(commit.revision.source).toBe(expected)
    expect(core.reconcileInput(revision, plan, commit, inputAction).selection).toEqual({ ranges: [{ anchor: selected, focus: selected }], primary: 0 })
    const raw = source.slice(0, target) + data + source.slice(target)
    expect(splice(raw, plan.reconciliation)).toBe(splice(source, plan.edits))
  })

  it('retains an explicit replacement target that covers text beyond the caret', () => {
    const core = createDocumentCore()
    const revision = core.open('teh {++word++}\n')
    const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, range: { start: 0, end: 3 }, inputType: 'insertReplacementText', data: 'the', options }
    const plan = core.planInput(revision, inputAction)
    expect(plan.edits).toEqual([{ start: 0, end: 3, insert: 'the' }])
  })

  it.each(['insertText', 'insertReplacementText', 'insertFromComposition'])('retains an expanded %s target', inputType => {
    const core = createDocumentCore()
    const revision = core.open('aaa\n')
    const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, range: { start: 0, end: 2 }, inputType, data: 'x', options }
    const plan = core.planInput(revision, inputAction)
    expect(plan.edits).toEqual([{ start: 0, end: 2, insert: 'x' }])
  })

  it.each(['insertReplacementText', 'insertFromComposition'])('retains a distinct collapsed %s target', inputType => {
    const core = createDocumentCore()
    const revision = core.open('aaa\n')
    const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 }, range: { start: 2, end: 2 }, inputType, data: 'x', options }
    const plan = core.planInput(revision, inputAction)
    expect(plan.edits).toEqual([{ start: 2, end: 2, insert: 'x' }])
  })
})
