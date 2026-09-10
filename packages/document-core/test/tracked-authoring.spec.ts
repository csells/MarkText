import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

describe('tracked text authoring', () => {
  it('refuses a compound suggestion that activates previously literal delimiter fragments', () => {
    const source = '- item\n\n  ```js\n  const x = 1\n  ```\n- second++native++}\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const starts = [0, source.indexOf('  ```js'), source.indexOf('  const'), source.lastIndexOf('  ```'), source.indexOf('- second')]
    const edits = starts.map((start, index) => ({ start, end: start + 2, insert: index === starts.length - 1 ? '\n' : '' }))
    const nativeOffset = source.indexOf('++native')
    edits.push({ start: nativeOffset, end: nativeOffset, insert: '{' })
    edits.push({ start: source.length - 1, end: source.length - 1, insert: '!' })
    expect(core.trackedEdits(revision, edits)).toBeUndefined()
    expect(revision.source).toBe(source)
    expect(core.project(revision, 'revised').markdown).toBe(source)
  })

  it('keeps native delimiter text literal when compound tracking retains canonical markup', () => {
    const source = '- item\n\n  ```js\n  const x = 1\n  ```\n- second\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const starts = [0, source.indexOf('  ```js'), source.indexOf('  const'), source.lastIndexOf('  ```'), source.indexOf('- second')]
    const edits = starts.map((start, index) => ({ start, end: start + 2, insert: index === starts.length - 1 ? '\n' : '' }))
    edits.push({ start: source.length - 1, end: source.length - 1, insert: '{++native++}' })
    const planned = core.trackedEdits(revision, edits)
    expect(planned).toBeDefined()
    const result = core.apply(revision, planned!).revision
    expect(core.project(result, 'original').markdown).toBe(source)
    expect(core.project(result, 'revised').markdown).toBe('item\n\n```js\nconst x = 1\n```\n\nsecond\\{++native\\++}\n')
    expect(result.annotations.flatMap(annotation => annotation.arms).flatMap(arm => arm.annotations)).toEqual([])
  })

  it.each(['\n', '\r\n', '\r'].flatMap(ending => ['item', '{++item++}{>>keep<<}'].map(item => ({ ending, item }))))('tracks compound list removal across a fenced body atomically ($ending, $item)', ({ ending, item }) => {
    const source = ('- ' + item + '\n\n  ```js\n  const x = 1\n  ```\n- second\n').replaceAll('\n', ending)
    const expected = 'item\n\n```js\nconst x = 1\n```\n\nsecond\n'.replaceAll('\n', ending)
    const core = createDocumentCore()
    const revision = core.open(source)
    const starts = [0, source.indexOf('  ```js'), source.indexOf('  const'), source.lastIndexOf('  ```'), source.indexOf('- second')]
    const edits = starts.map((start, index) => ({ start, end: start + 2, insert: index === starts.length - 1 ? ending : '' }))
    const planned = core.trackedEdits(revision, edits)
    expect(planned).toBeDefined()
    expect(revision.source).toBe(source)
    const result = core.apply(revision, planned!).revision
    expect(core.project(result, 'original').markdown).toBe(source.replace('{++item++}{>>keep<<}', ''))
    expect(core.project(result, 'revised').markdown).toBe(expected)
  })

  it.each([
    { source: '$word$', offset: 3, revised: '$woXrd$' },
    { source: '$$\nword\n$$\n', offset: 5, revised: '$$\nwoXrd\n$$\n' },
    { source: '<script>word</script>\n', offset: 10, revised: '<script>woXrd</script>\n' },
    { source: '---\ntitle: word\n---\n', offset: 13, revised: '---\ntitle: woXrd\n---\n' }
  ])('tracks literal payload edits without activating markers inside $source', ({ source, offset, revised }) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const edited = core.track(revision, { start: offset, end: offset, insert: 'X' }).revision
    expect(edited.annotations).toHaveLength(1)
    expect(edited.annotations[0]?.kind).toBe('substitution')
    expect(core.project(edited, 'original').markdown).toBe(source)
    expect(core.project(edited, 'revised').markdown).toBe(revised)
  })

  it('preserves the revision when an EOF-terminated HTML literal would consume the suggestion boundary', () => {
    const core = createDocumentCore()
    const source = '<div>word</div>\n'
    const revision = core.open(source)
    expect(core.trackedEdit(revision, { start: 7, end: 7, insert: 'X' })).toBeUndefined()
    expect(core.project(revision, 'original').markdown).toBe(source)
    expect(core.project(revision, 'revised').markdown).toBe(source)
  })

  it('tracks an edit inside inline code by replacing its complete literal syntax', () => {
    const core = createDocumentCore()
    const revision = core.open('before `word` after')
    const edited = core.track(revision, { start: 10, end: 10, insert: 'X' }).revision
    expect(edited.source).toBe('before {~~`word`~>`woXrd`~~} after')
    expect(core.project(edited, 'original').markdown).toBe('before `word` after')
    expect(core.project(edited, 'revised').markdown).toBe('before `woXrd` after')
  })

  it('tracks code-block typing while preserving exact Original and Revised fences', () => {
    const core = createDocumentCore()
    const revision = core.open('```js\nword\n```\n')
    const edited = core.track(revision, { start: 8, end: 8, insert: 'X' }).revision
    expect(edited.annotations).toHaveLength(1)
    expect(edited.annotations[0]?.kind).toBe('substitution')
    expect(core.project(edited, 'original').markdown).toBe('```js\nword\n```\n')
    expect(core.project(edited, 'revised').markdown).toBe('```js\nwoXrd\n```\n')
  })

  it('tracks typing inside a highlighted passage without removing its attached comment', () => {
    const core = createDocumentCore()
    const revision = core.open('{==word==}{>>note<<}')
    const edited = core.track(revision, { start: 5, end: 5, insert: 'X' }).revision
    expect(edited.source).toBe('{==wo{++X++}rd==}{>>note<<}')
    expect(core.project(edited, 'original').markdown).toBe('word')
    expect(core.project(edited, 'revised').markdown).toBe('woXrd')
  })

  it('continues typing at the edge of a tracked deletion without changing the deleted text', () => {
    const core = createDocumentCore()
    const revision = core.open('w{--or--}d')
    const edited = core.track(revision, { start: 6, end: 6, insert: 'X' }).revision
    expect(edited.source).toBe('w{--or--}{++X++}d')
    expect(core.project(edited, 'original').markdown).toBe('word')
    expect(core.project(edited, 'revised').markdown).toBe('wXd')
  })

  it.each([
    { insert: '', source: '{==w{--or--}d==}{>>note<<}', revised: 'wd' },
    { insert: 'X', source: '{==w{~~or~>X~~}d==}{>>note<<}', revised: 'wXd' }
  ])('tracks a selected edit inside a highlight ($revised)', ({ insert, source, revised }) => {
    const core = createDocumentCore()
    const revision = core.open('{==word==}{>>note<<}')
    const edited = core.track(revision, { start: 4, end: 6, insert }).revision
    expect(edited.source).toBe(source)
    expect(core.project(edited, 'original').markdown).toBe('word')
    expect(core.project(edited, 'revised').markdown).toBe(revised)
  })

  it('validates against retained full-document context without publishing a speculative revision', () => {
    const core = createDocumentCore()
    const source = 'typing\n\n' + 'A {++new++} B {--old--} C {~~old~>new~~}.\n\n'.repeat(80)
    const revision = core.open(source)
    const markup = core.project(revision, 'markup')
    const before = inspectDocumentCore(core)
    const edit = core.trackedEdit(revision, { start: 6, end: 6, insert: 'x' })
    const after = inspectDocumentCore(core)
    expect(edit).toEqual({ start: 6, end: 6, insert: '{++x++}' })
    expect(after.documentParses - before.documentParses).toBe(1)
    const candidateCore = createDocumentCore()
    candidateCore.open(source.slice(0, 6) + '{++x++}' + source.slice(6))
    expect(after.intrinsicSourceUnits - before.intrinsicSourceUnits)
      .toBeLessThanOrEqual(inspectDocumentCore(candidateCore).intrinsicSourceUnits)
    expect(after.regionalInventoryBuildUnits).toBe(before.regionalInventoryBuildUnits)
    expect(inspectDocumentCore(candidateCore).regionalInventoryBuildUnits).toBeGreaterThan(0)
    expect(after.fullProductStoresStrongCurrent).toBe(before.fullProductStoresStrongCurrent)
    expect(after.fullProductStoreReleases).toBe(before.fullProductStoreReleases)
    expect(core.project(revision, 'markup')).toBe(markup)
    if (edit === undefined) throw new Error('Expected a safe tracked edit')
    expect(core.apply(revision, [edit]).revision.source)
      .toBe(source.slice(0, 6) + '{++x++}' + source.slice(6))
  })

  it('reuses retained parsing for ordinary edits in a plain region of a marked document', () => {
    const core = createDocumentCore()
    const source = 'typing\n\n' + 'A {++new++} B {--old--}.\n\n'.repeat(80)
    const revision = core.open(source)
    const before = inspectDocumentCore(core)
    const planned = core.markupEdit(revision, { start: 6, end: 6, insert: 'x' })
    const after = inspectDocumentCore(core)
    expect(planned).toEqual([{ start: 6, end: 6, insert: 'x' }])
    const reference = createDocumentCore()
    reference.open('typingx' + source.slice(6))
    expect(after.intrinsicSourceUnits - before.intrinsicSourceUnits)
      .toBeLessThan(inspectDocumentCore(reference).intrinsicSourceUnits)
    if (planned === undefined) throw new Error('Expected a safe Markup edit')
    expect(core.apply(revision, planned).revision.source).toBe('typingx' + source.slice(6))
  })

  it('keeps the current revision and literal context while planning a code replacement', () => {
    const core = createDocumentCore()
    const revision = core.open('`literal`\n\ntext')
    const before = inspectDocumentCore(core)
    expect(core.trackedEdit(revision, { start: 4, end: 4, insert: 'x' }))
      .toEqual({ start: 0, end: 9, insert: '{~~`literal`~>`litxeral`~~}' })
    const after = inspectDocumentCore(core)
    expect(after.documentParses).toBeGreaterThan(before.documentParses)
    expect(after.fullProductStoreReleases).toBe(before.fullProductStoreReleases)
    expect(core.track(revision, { start: 15, end: 15, insert: 'x' }).revision.source)
      .toBe('`literal`\n\ntext{++x++}')
  })

  it('extends one pending addition through successive typing and removes added text without a deletion', () => {
    const core = createDocumentCore()
    let revision = core.open('hello')
    revision = core.track(revision, { start: 5, end: 5, insert: 'a' }).revision
    expect(revision.source).toBe('hello{++a++}')
    revision = core.track(revision, { start: 9, end: 9, insert: 'b' }).revision
    expect(revision.source).toBe('hello{++ab++}')
    revision = core.track(revision, { start: 8, end: 9, insert: '' }).revision
    expect(revision.source).toBe('hello{++b++}')
    revision = core.track(revision, { start: 8, end: 9, insert: '' }).revision
    expect(revision.source).toBe('hello')
  })

  it('edits nested additions using their owned arm and preserves surrounding highlights', () => {
    const core = createDocumentCore()
    let revision = core.open('{==a{++bc++}d==}')
    revision = core.track(revision, { start: 8, end: 8, insert: 'X' }).revision
    expect(revision.source).toBe('{==a{++bXc++}d==}')
    revision = core.track(revision, { start: 8, end: 9, insert: 'Y' }).revision
    expect(revision.source).toBe('{==a{++bYc++}d==}')
    revision = core.track(revision, { start: 7, end: 10, insert: '' }).revision
    expect(revision.source).toBe('{==ad==}')
  })

  it('retains a substitution old arm while typing and turns an emptied new arm into a deletion', () => {
    const core = createDocumentCore()
    let revision = core.open('{~~old~>new~~}')
    revision = core.track(revision, { start: 11, end: 11, insert: '!' }).revision
    expect(revision.source).toBe('{~~old~>new!~~}')
    revision = core.track(revision, { start: 8, end: 12, insert: '' }).revision
    expect(revision.source).toBe('{--old--}')
    expect(core.project(revision, 'original').markdown).toBe('old')
  })

  it('escapes native CriticMarkup tokens without changing the old arm', () => {
    const core = createDocumentCore()
    let revision = core.open('{~~old~>new~~}')
    revision = core.track(revision, { start: 11, end: 11, insert: '~~}' }).revision
    expect(revision.source).toBe('{~~old~>new\\~~}~~}')
    expect(core.project(revision, 'original').markdown).toBe('old')
    expect(core.project(revision, 'revised').markdown).toBe('new\\~~}')
  })

  it('joins successive tracked insertion at the exterior end of a pending addition', () => {
    const core = createDocumentCore()
    let revision = core.open('a{++b++}')
    revision = core.track(revision, { start: 8, end: 8, insert: 'c' }).revision
    expect(revision.source).toBe('a{++bc++}')
  })

  it('restores unchanged text when a replacement is edited back to its original spelling', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~old~>new~~}')
    const restored = core.track(revision, { start: 8, end: 11, insert: 'old' })
    expect(restored.revision.source).toBe('old')
    expect(restored.revision.annotations).toHaveLength(0)
  })

  it('rejects editing the old arm without publishing or consuming the acknowledged revision', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~old~>new~~}')
    expect(core.trackedEdit(revision, { start: 4, end: 4, insert: 'X' })).toBeUndefined()
    expect(revision.source).toBe('{~~old~>new~~}')
    const next = core.track(revision, { start: 11, end: 11, insert: '!' })
    expect(next.revision.source).toBe('{~~old~>new!~~}')
  })
})

it.each([
  { source: 'a{++b++}c', start: 1, end: 8, expected: 'ac' },
  { source: 'a{++b{>>inside<<}++}{>>outside<<}c', start: 1, end: 20, expected: 'a{>>outside<<}c' },
  { source: 'a{++b++}{++c++}d', start: 1, end: 8, expected: 'a{++c++}d' }
])('cancels the exact owned pending addition in $source', ({ source, start, end, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const edit = core.trackedEdit(revision, { start, end, insert: '' })
  expect(edit).toBeDefined()
  if (edit === undefined) throw new Error('Pending addition cancellation refused')
  const next = core.apply(revision, [edit]).revision
  expect(next.source).toBe(expected)
  expect(core.project(next, 'original').markdown).toBe(core.project(revision, 'original').markdown)
})

it('does not cancel an addition within an existing deleted arm', () => {
  const core = createDocumentCore()
  const revision = core.open('a{--{++b++}--}c')
  expect(core.trackedEdit(revision, { start: 4, end: 11, insert: '' })).toBeUndefined()
  expect(revision.source).toBe('a{--{++b++}--}c')
})

it.each([
  { source: '{++ab++}', at: 0, expected: '{++Xab++}' },
  { source: '{++ab++}', at: 3, expected: '{++Xab++}' },
  { source: '{++ab++}', at: 5, expected: '{++abX++}' },
  { source: '{++ab++}', at: 8, expected: '{++abX++}' },
  { source: '{~~old~>new~~}', at: 0, expected: '{~~old~>Xnew~~}' },
  { source: '{~~old~>new~~}', at: 8, expected: '{~~old~>Xnew~~}' },
  { source: '{~~old~>new~~}', at: 11, expected: '{~~old~>newX~~}' },
  { source: '{~~old~>new~~}', at: 14, expected: '{~~old~>newX~~}' }
])('preserves inline draft merging at the exterior or interior boundary $at in $source', ({ source, at, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  expect(core.track(previous, { start: at, end: at, insert: 'X' }).revision.source).toBe(expected)
})
