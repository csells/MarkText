import { describe, expect, it } from 'vitest'
import {
  createDocumentCore,
  type DocumentCore,
  type DocumentInputAction,
  type DocumentRevision,
  type MarkupEvent,
  type MarkupMark,
  type MarkupProjection,
  type MarkupRegionReplacement,
  type SourceRange
} from '../src/index.js'
import { inspectRegionalLeaves } from '../src/internal/documentCoreInspection.js'

// A regional apply that splits, joins or annotates blocks is an
// optimization of one parse. Its annotations and its projection replacement,
// composed with the previous projection, must read exactly as a fresh open of
// the resulting source, and later regional edits must build on it exactly.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Plain words here.',
  'Another ordinary sentence with more words.',
  'Text with {++added++} inside.',
  'Text {--deleted--} and {~~old~>new~~} too.',
  'Note {==marked==}{>>comment<<} end.',
  '{++Whole paragraph addition.++}',
  '# Heading',
  '- item one\n- item two',
  '> quoted line',
  '```\ncode\n\nmore\n```',
  '    indented code',
  'Para *em* and `code` here.',
  'A [link](http://x.y) here.',
  'Multi\nline\nparagraph.'
]

const insertions = ['x', ' ', '\n', '\n\n', '\n\n\n\n', '{++n++}', '{--d--}', '{++', '++}', '# ', '- ', '    ', '*', '`', '$$', '[r]', '---', '===', '<div>']

// A wider pool: tables, math blocks, quotes, lists, HTML, setext headings,
// footnotes and references around suggestions, with every delimiter piece.
const wideBlocks = [
  ...blocks,
  '| a | b |\n| --- | --- |\n| {++c++} | d |',
  '$$\nx {++y++}\n$$',
  'Math $a$ and `x {++b++}` y.',
  '> quote {--gone--}\n> more',
  '1. one {~~a~>b~~}\n2. two',
  '<div>\n{++html++}\n</div>',
  'Setext {==hi==}\n===',
  'Lazy\n- item\ncontinued {>>c<<}',
  '[^1]: note {++n++}',
  'Ref [x] {++y++}.\n\n[x]: http://x.y',
  '- a\n\n  b {--c--}\n- d'
]
const wideInsertions = ['$', '`', '``', '> ', '1. ', '|', '<!--', '-->', '{~~', '~>', '~~}', '{>>c<<}', '{==', '==}', '\\', '[^1]', ...insertions]

// Long literal blocks, whose lines a key reparses in a window of those lines
// (see `admitLiteralLines`), beside the blocks that end or continue them.
const literalLines = (count: number, line: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => line(index)).join('\n')
const literalBlocks = [
  'Plain words here.',
  'Para *em* and `code` here.',
  '```js\n' + literalLines(10, index => `const value${index} = compute(${index})`) + '\n```',
  '~~~\n' + literalLines(6, index => `\tline ${index} {x}`) + '\n~~~',
  '```\nunclosed\nfence',
  literalLines(8, index => `    indented ${index}`),
  '    a\n\n    b\n\n\n    c',
  '$$\n' + literalLines(5, index => `x_{${index}} + y`) + '\n$$',
  '<div>\n' + literalLines(5, index => `html ${index}`) + '\n</div>',
  '<!--\n' + literalLines(4, index => `comment ${index}`) + '\n-->',
  '```mermaid\n' + literalLines(4, index => `a${index} --> b${index}`) + '\n```',
  '- item one\n- item two',
  '> quote',
  '{~~```\nold\n```\n~>```\nnew\nmore\n```\n~~}'
]
// Suggestion arms each holding a whole long literal block, whose inner lines
// a key reparses in a window of those lines (see `admitArmLiteralLines`).
const armBody = (count: number, line: (index: number) => string): string => literalLines(count, line)
const armBlocks = [
  'Plain words here.',
  '{~~```js\n' + armBody(6, index => `old ${index}`) + '\n```\n~>```js\n' + armBody(7, index => `new ${index} {x}`) + '\n```\n~~}',
  '{~~$$\n' + armBody(5, index => `x_{${index}}`) + '\n$$\n~>$$\n' + armBody(6, index => `y_{${index}} + 1`) + '\n$$\n~~}',
  // A first tracked key's math Substitution, whose closer lines hold its markers.
  '{~~$$\n' + armBody(5, index => `x_{${index}} + y`) + '\n$$~>$$\n' + armBody(5, index => `y_{${index}} - y`) + '\n$$~~}',
  '{~~<div>\n' + armBody(5, index => `old html ${index}`) + '\n</div>\n~><div>\n' + armBody(5, index => `new html ${index}`) + '\n</div>\n~~}',
  '{++~~~\n' + armBody(6, index => `added ${index}`) + '\n~~~\n++}',
  '{--```\n' + armBody(5, index => `gone ${index}`) + '\n```\n--}',
  '{~~' + armBody(5, index => `    old indented ${index}`) + '\n~>' + armBody(5, index => `    new indented ${index}`) + '\n~~}',
  '{==```\n' + armBody(5, index => `marked ${index}`) + '\n```\n==}{>>a comment<<}',
  'Para *em* and `code` here.',
  '- item one\n- item two'
]
const armInsertions = ['x', ' ', '\n', '\n\n', '```', '~~~', '$$', '</div>', '    ', '{', '}', '~>', '~~}', '{++n++}', '`', '# ', '<div>', '\n```\n', '- ', '> ', '1. ', '***']

const literalInsertions = ['x', ' ', '\n', '\n\n', '```', '~~~', '    ', '\t', '$$', '</div>', '-->', '{', '}', '{++n++}', '`', '# ', '- ', '<div>', '\n```\n', '\n    ']

function applyReplacement(previous: readonly MarkupEvent[], replacement: MarkupRegionReplacement): readonly MarkupEvent[] {
  const delta = replacement.next.source.end - replacement.previous.source.end
  const shift = (range: SourceRange): SourceRange => range.end <= replacement.previous.source.end
    ? range
    : { start: range.start + delta, end: range.end + delta }
  // An annotation holding the replaced lines keeps its start and moves its end.
  const enclosing = replacement.enclosing ?? []
  const shiftAnnotation = (range: SourceRange): SourceRange =>
    enclosing.some(held => held.start === range.start && held.end === range.end)
      ? { start: range.start, end: range.end + delta }
      : shift(range)
  const marks = new Map<MarkupMark, MarkupMark>()
  const shiftMark = (mark: MarkupMark): MarkupMark => {
    const cached = marks.get(mark)
    if (cached !== undefined) return cached
    const shifted = { ...mark, annotationRange: shiftAnnotation(mark.annotationRange) } as MarkupMark
    marks.set(mark, shifted)
    return shifted
  }
  return [
    ...previous.slice(0, replacement.previous.events.start).map(event => event.kind === 'text'
      ? event
      : { ...event, mark: shiftMark(event.mark) }),
    ...replacement.events,
    ...previous.slice(replacement.previous.events.end).map(event => event.kind === 'text'
      ? { ...event, sourceRange: shift(event.sourceRange) }
      : { ...event, mark: shiftMark(event.mark) })
  ]
}

// A list also lists its items, and a literal block its lines' children,
// which a region may replace on their own.
const literalKinds = new Set(['code-block', 'math-block', 'html-block', 'diagram'])
const blockShape = (projection: MarkupProjection) => projection.syntax.ast.root.children
  .map(node => ({
    kind: node.kind,
    start: node.range.start,
    end: node.range.end,
    ...(node.kind === 'list' || literalKinds.has(node.kind)
      ? { children: node.children.map(item => ({ kind: item.kind, start: item.range.start, end: item.range.end })) }
      : {})
  }))

type BlockShape = ReturnType<typeof blockShape>[number]
const shifted = (node: BlockShape, delta: number): BlockShape => ({
  ...node,
  start: node.start + delta,
  end: node.end + delta,
  ...(node.children === undefined ? {} : { children: node.children.map(item => ({ ...item, start: item.start + delta, end: item.end + delta })) })
})

/** The previous view with the replaced region spliced in, as the desktop composes it. */
function composedShape(previous: MarkupProjection, replacement: MarkupRegionReplacement) {
  const delta = replacement.next.syntax.end - replacement.previous.syntax.end
  const lines = replacement.literalLines
  if (lines !== undefined) {
    // Lines replaced inside a literal block: its other lines stay, its end
    // moves with the edit, and later blocks shift.
    // Lines holding the opener start at its line, before an indented opener.
    const block = previous.syntax.ast.root.children.find(node => literalKinds.has(node.kind) &&
      node.range.start < replacement.previous.syntax.end && replacement.previous.syntax.start < node.range.end)
    if (block === undefined) throw new Error('A literal lines replacement has no block')
    const shape = (node: { kind: string, range: SourceRange }, shift = 0) =>
      ({ kind: node.kind, start: node.range.start + shift, end: node.range.end + shift })
    const children = [
      ...block.children.slice(0, lines.childrenBefore).map(node => shape(node)),
      ...replacement.syntaxBlocks.map(node => shape(node)),
      ...block.children.slice(lines.childrenBefore + lines.previousChildren).map(node => shape(node, delta))
    ]
    return blockShape(previous).map(node => node.start === block.range.start
      ? { kind: node.kind, start: node.start, end: node.end + delta, children }
      : node.start < block.range.start ? node : shifted(node, delta))
  }
  const items = replacement.listItems
  if (items !== undefined) {
    // Items replaced inside a list: the list's other items stay, its span
    // runs from its first item to its last, and later blocks shift.
    const list = previous.syntax.ast.root.children.find(node => node.kind === 'list' &&
      node.range.start <= replacement.previous.syntax.start && replacement.previous.syntax.start < node.range.end)
    if (list === undefined) throw new Error('A list replacement has no list')
    const shape = (node: { kind: string, range: SourceRange }, shift = 0) =>
      ({ kind: node.kind, start: node.range.start + shift, end: node.range.end + shift })
    const children = [
      ...list.children.slice(0, items.itemsBefore).map(node => shape(node)),
      ...replacement.syntaxBlocks.map(node => shape(node)),
      ...list.children.slice(items.itemsBefore + items.previousItems).map(node => shape(node, delta))
    ]
    return blockShape(previous).map(node => node.end < replacement.previous.syntax.start
      ? node
      : node.start > replacement.previous.syntax.start
        ? shifted(node, delta)
        : { kind: node.kind, start: children[0]?.start ?? node.start, end: children.at(-1)?.end ?? node.end, children })
  }
  return [
    ...blockShape(previous).filter(node => node.start < replacement.previous.syntax.start),
    ...replacement.syntaxBlocks.map(node => ({
      kind: node.kind,
      start: node.range.start,
      end: node.range.end,
      ...(node.kind === 'list' || literalKinds.has(node.kind)
        ? { children: node.children.map(item => ({ kind: item.kind, start: item.range.start, end: item.range.end })) }
        : {})
    })),
    ...blockShape(previous).filter(node => node.start >= replacement.previous.syntax.end)
      .map(node => shifted(node, delta))
  ]
}

interface Session {
  readonly core: DocumentCore
  revision: DocumentRevision
  markup: MarkupProjection
  regional: number
  /** Replacements of lines inside a suggestion arm's literal block. */
  arm?: number
}

function step(session: Session, start: number, end: number, insert: string, label: string): void {
  const { core, revision } = session
  const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
  const source = revision.source.slice(0, start) + insert + revision.source.slice(end)
  const oracle = createDocumentCore()
  const fresh = oracle.open(source)
  const freshMarkup = oracle.project(fresh, 'markup')
  expect(commit.revision.source, label).toBe(source)
  expect(commit.revision.annotations, label).toEqual(fresh.annotations)
  expect(commit.revision.diagnostics, label).toEqual(fresh.diagnostics)
  const change = commit.change.projections[0]
  if (change?.name === 'markup' && change.scope === 'regions') {
    session.regional += 1
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected a replacement')
    expect(applyReplacement(session.markup.events, replacement), label).toEqual(freshMarkup.events)
    expect(composedShape(session.markup, replacement), label).toEqual(blockShape(freshMarkup))
    // Later edits read an arm's lines from the inventory leaves a reply
    // left, so their arm blocks must be the ones a fresh open finds. Earlier
    // regional edits may leave the leaves partitioned unlike a fresh open's,
    // so the arm blocks compare by document position, and the edited leaf
    // where a fresh open has the same one.
    const leaves = (owner: DocumentCore, at: DocumentRevision) => {
      let offset = 0
      return (inspectRegionalLeaves(owner, at) ?? []).map(value => {
        const leaf = JSON.parse(JSON.stringify(value)) as { sourceLength: number, armLiterals?: Array<Record<string, unknown> & { start: number, end: number }> }
        const placed = { start: offset, leaf }
        offset += leaf.sourceLength
        return placed
      })
    }
    const arms = (placed: ReturnType<typeof leaves>) => placed.flatMap(({ start, leaf }) =>
      (leaf.armLiterals ?? []).map(({ node: _node, event: _event, eventStart, eventEnd, syntaxStart: _syntax, block: _block, ...arm }) =>
        ({ ...arm, start: start + arm.start, end: start + arm.end, eventStart: start + Number(eventStart), eventEnd: start + Number(eventEnd) })))
    const ours = leaves(core, commit.revision)
    const theirs = leaves(oracle, fresh)
    expect(arms(ours), label).toEqual(arms(theirs))
    if (replacement.enclosing !== undefined) {
      session.arm = (session.arm ?? 0) + 1
      const edited = ours.find(({ start: leafStart, leaf }) => leafStart <= start && start <= leafStart + leaf.sourceLength)
      const same = theirs.find(placed => placed.start === edited?.start && placed.leaf.sourceLength === edited.leaf.sourceLength)
      if (edited !== undefined && same !== undefined) expect(edited.leaf, label).toEqual(same.leaf)
    }
  }
  session.revision = commit.revision
  session.markup = freshMarkup
}

function documentFrom(random: () => number, pool: readonly string[] = blocks): string {
  const count = 3 + Math.floor(random() * 10)
  const parts: string[] = []
  for (let index = 0; index < count; index += 1) {
    parts.push(pool[Math.floor(random() * pool.length)] ?? '')
    if (random() < 0.15) parts.push('')
  }
  const separator = random() < 0.1 ? '\r\n' : '\n'
  const text = parts.join('\n\n') + (random() < 0.8 ? '\n' : '')
  return separator === '\n' ? text : text.replace(/\n/gu, '\r\n')
}

describe('structural regional edits read as a fresh open', () => {
  // Seeds past the first 24 are ones a 4,000-seed run once found diverging.
  const regressionSeeds = [1012, 1063, 1107, 1139, 1152, 1225, 1261, 1274, 1296]
  // `focus` names lines whose text edits favour, returning the arm line
  // replacements the edits took.
  const fuzz = (seed: number, pool: readonly string[], pieces: readonly string[], focus?: RegExp): number => {
    const random = lcg(seed * 7919)
    let arm = 0
    for (let documentIndex = 0; documentIndex < 20; documentIndex += 1) {
      const source = documentFrom(random, pool)
      const core = createDocumentCore()
      const revision = core.open(source)
      const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
      for (let edit = 0; edit < 8; edit += 1) {
        const length = session.revision.sourceLength
        const focused = focus === undefined
          ? []
          : [...session.revision.source.matchAll(new RegExp(focus.source, 'gmu'))]
        const line = focused.length > 0 && random() < 0.75 ? focused[Math.floor(random() * focused.length)] : undefined
        const start = line === undefined
          ? Math.floor(random() * (length + 1))
          : line.index + Math.floor(random() * (line[0].length + 1))
        const choice = random()
        let end = start
        let insert = ''
        if (choice < 0.55) {
          insert = pieces[Math.floor(random() * pieces.length)] ?? ''
        } else if (choice < 0.85) {
          end = Math.min(length, start + 1 + Math.floor(random() * 4))
        } else {
          end = Math.min(length, start + 1 + Math.floor(random() * 12))
          insert = random() < 0.5 ? 'Z' : '\n\n'
        }
        const label = `${JSON.stringify(session.revision.source)} [${start}, ${end}) ${JSON.stringify(insert)}`
        step(session, start, end, insert, label)
      }
      arm += session.arm ?? 0
    }
    return arm
  }
  // A list marker typed after a blank line inside display math opens no
  // list, so the blocks after the math keep their reading (B19).
  it.each([
    ['$$\ny_0 - y\ny_1 - y\n$$\n\nPlain words here.\n\nMore.\n', 14, 15, '\n\n'],
    ['{~~a~>$$\ny_1 - y\n$$~~}\n\nPlain words here.\n\nMore.\n', 12, 13, '\n\n'],
    ['{~~a~>\n$$\ny_1 - y\n$$~~}\n\nPlain words here.\n\nMore.\n', 13, 14, '\n\n'],
    ['Intro\n\n{++$$\ny_1 - y\n$$\n++}\n\nPlain words here.\n\nMore.\n', 16, 17, '\n\n'],
    ['{~~$$\nx_{0}\n$$\n~>$$\ny_{0} + 1\ny_{1} + 1\n$$\n~~}\n\nPara here.\n', 26, 26, '\n']
  ] as const)('display math line %#', (source, start, end, insert) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    step(session, start, end, insert, `${JSON.stringify(source)} [${start}, ${end}) ${JSON.stringify(insert)}`)
  })
  it.each([...Array.from({ length: 24 }, (_, seed) => seed + 1), ...regressionSeeds])('seed %i', seed => {
    fuzz(seed, blocks, insertions)
  })
  // Seeds past the first 16 once diverged: a stray separator, a definition
  // read with two extents, and a block start moved inside a window.
  it.each([...Array.from({ length: 16 }, (_, seed) => seed + 1), 18, 20, 35, 315])('wide seed %i', seed => {
    fuzz(seed, wideBlocks, wideInsertions)
  })
  // MARKTEXT_LITERAL_FUZZ_SEEDS and _FIRST run a longer stretch, as 720 seeds.
  const literalSeeds = Number(process.env.MARKTEXT_LITERAL_FUZZ_SEEDS ?? 24)
  const firstLiteralSeed = Number(process.env.MARKTEXT_LITERAL_FUZZ_FIRST ?? 1)
  it.each(Array.from({ length: literalSeeds }, (_, index) => firstLiteralSeed + index))('literal seed %i', seed => {
    fuzz(seed, literalBlocks, literalInsertions)
  })
  // MARKTEXT_ARM_FUZZ_SEEDS and _FIRST run a longer stretch.
  const armSeeds = Number(process.env.MARKTEXT_ARM_FUZZ_SEEDS ?? 24)
  const firstArmSeed = Number(process.env.MARKTEXT_ARM_FUZZ_FIRST ?? 1)
  it.each(Array.from({ length: armSeeds }, (_, index) => firstArmSeed + index))('arm literal seed %i', seed => {
    expect(fuzz(seed, armBlocks, armInsertions, /^ *(?:old|new|added|gone|marked|x_|y_).*$/)).toBeGreaterThan(0)
  }, 60_000)

  // A first tracked key in a long literal block suggests replacing it whole,
  // read with the block's lines far from the key left out (see
  // `admitArmCreation`), then keys in its lines read them alone.
  const longLines = (count: number, line: (index: number) => string): string =>
    Array.from({ length: count }, (_, index) => line(index)).join('\n')
  const longBlocks = [
    '```js\n' + longLines(160, index => `const value${index} = compute(${index})`) + '\n```',
    '~~~\n' + longLines(160, index => index % 7 === 3 ? '' : `line ${index} of text`) + '\n~~~',
    '$$\n' + longLines(160, index => `x_{${index}} + y_{${index}}`) + '\n$$',
    '<div>\n' + longLines(160, index => `html line ${index}`) + '\n</div>',
    longLines(160, index => index % 9 === 4 ? '' : `    indented line ${index}`),
    longLines(160, index => `\tindented by tab ${index}`)
  ]
  const longSeeds = Number(process.env.MARKTEXT_FIRST_KEY_SEEDS ?? 24)
  const firstLongSeed = Number(process.env.MARKTEXT_FIRST_KEY_FIRST ?? 1)
  it.each(Array.from({ length: longSeeds }, (_, index) => firstLongSeed + index))('first tracked key seed %i', seed => {
    const random = lcg(seed * 4253)
    const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    const block = longBlocks[Math.floor(random() * longBlocks.length)] ?? ''
    const source = ['Opening paragraph.', ...(random() < 0.5 ? ['Text {++added++} here.'] : []), block,
      'Closing paragraph.'].join('\n\n') + (random() < 0.8 ? '\n' : '')
    const core = createDocumentCore()
    const opened = core.open(source)
    const regional = core.apply(opened, [{ start: 1, end: 1, insert: 'q' }], { projections: ['markup'] }).revision
    const oracle = createDocumentCore()
    const session: Session = { core, revision: regional, markup: oracle.project(oracle.open(regional.source), 'markup'), regional: 0 }
    let created = 0
    for (let key = 0; key < 4; key += 1) {
      const lines = [...session.revision.source.matchAll(/^.*(?:value|line|x_|html|by tab)[^\n]*$/gmu)]
      const line = lines[Math.floor(random() * lines.length)]
      if (line === undefined) break
      const caret = line.index + Math.floor(random() * (line[0].length + 1))
      const inputType = random() < 0.8 ? 'insertText' : random() < 0.5 ? 'insertParagraph' : 'deleteContentBackward'
      const input = {
        range: inputType === 'deleteContentBackward' ? { start: caret - 1, end: caret } : { start: caret, end: caret },
        selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
        inputType,
        data: inputType === 'insertText' ? 'z' : null,
        options
      } as DocumentInputAction
      const plan = core.planInput(session.revision, input, { tracked: true })
      const edits = core.inputEdits(session.revision, input, plan, true)
      if (edits === undefined || edits.length !== 1 || edits[0] === undefined) break
      const [edit] = edits
      if (edit.insert.startsWith('{~~')) created += 1
      step(session, edit.start, edit.end, edit.insert, `${JSON.stringify(session.revision.source.slice(0, 80))} @${caret} ${inputType}`)
    }
    expect(created).toBeLessThanOrEqual(4)
  })

  // Histories a longer fuzz found diverging: a `$$` line in the window pairing
  // with one after it, a line that only a comment's hidden text leaves blank
  // read as an empty paragraph at another offset in a lone region, and a
  // block after a list read alone although the list took it in.
  it.each([
    ['a dollar run pairing past the window',
      '> quoted line\n\n1. one {~~a~>b~~}\n2. two\n\n$$\nx {++y++}\n$$\n\nMath $a$ and `x {++b++}` y.\n\nMulti\nline\nparagraph.\n\n- item one\n- item two\n\nPlain words here.\n\n```\ncode\n\nmore\n```\n\nMulti\nline\nparagraph.\n\n\n\n$$\nx {++y++}\n$$\n\nPlain words here.\n',
      [[175, 175, '<!--'], [225, 225, '[^1]'], [40, 44, ''], [90, 93, 'Z']]],
    ['a line left blank by a comment',
      '    indented {++x++}\n\n$$\nx {++y++}\n$$\n\nAnother ordinary sentence with more words.\n\n \t \n\n\n\nMulti\nline\nparagraph.\n\n   \n\n{++Whole paragraph addition.++}\n\nPara *em* and `code` here.\n\nAnother ordinary sentence with more words.\n\n| a | b |\n| --- | --- |\n| {++c++} | d |\n\n\n\n> quoted line',
      [[63, 63, '*'], [235, 239, ''], [206, 206, '\n   \n'], [110, 111, ''], [210, 210, 'x'], [113, 113, '{>>c<<}'], [89, 89, '\n'], [118, 118, '[^1]']]],
    // A paragraph after a list whose first line an opener hides spaces
    // after, which then continues the list's last item.
    ['a block a list takes in',
      'Plain words here.\n\n\n\nLazy\n- item\ncontinued {>>c<<}\n\n{++Whole paragraph addition.++}\n\n1. first step\n2. second step\n3. third\n\n{++Whole paragraph addition.++}\n\n- [ ] task one\n- [x] task two\n\nPara *em* and `code` here.\n\n- [ ] task one\n- [x] task two',
      [[188, 190, ''], [181, 182, ''], [127, 127, '   ']]]
  ] as const)('replays %s', (_name, initial, edits) => {
    const core = createDocumentCore()
    const revision = core.open(initial)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    for (const [start, end, insert] of edits) {
      step(session, start, end, insert, `${JSON.stringify(session.revision.source)} [${start}, ${end}) ${JSON.stringify(insert)}`)
    }
  })

  it('exercises regional splits, joins and new suggestions', () => {
    const paragraph = 'Plain words here.'
    const marked = [paragraph, 'A {++b++} c.', paragraph, 'D {--e--} f.', paragraph, paragraph, paragraph].join('\n\n') + '\n'
    const core = createDocumentCore()
    const revision = core.open(marked)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    const tail = marked.lastIndexOf(paragraph) + 5
    step(session, tail, tail, '\n\n', 'split in the plain tail')
    step(session, tail, tail + 2, '', 'join in the plain tail')
    step(session, 5, 5, '\n\n', 'split before the first suggestion')
    step(session, 5, 7, '', 'join before the first suggestion')
    // Markers pair as one stack across the document, so a new suggestion is
    // regional where every other marker pairs and no backtick or dollar run
    // can reach it.
    step(session, tail, tail, '{++new++}', 'suggestion beside others')
    expect(session.regional).toBe(5)

    const plainCore = createDocumentCore()
    const plainSource = Array.from({ length: 6 }, () => paragraph).join('\n\n') + '\n'
    const plainRevision = plainCore.open(plainSource)
    const plain: Session = { core: plainCore, revision: plainRevision, markup: plainCore.project(plainRevision, 'markup'), regional: 0 }
    const middle = 3 * (paragraph.length + 2) + 5
    step(plain, middle, middle, '{++new++}', 'first suggestion')
    step(plain, middle + 3, middle + 3, '\n\n', 'split inside the suggestion')
    step(plain, middle + 3, middle + 5, '', 'join inside the suggestion')
    expect(plain.regional).toBe(3)
  })

  it.each([
    ['$$\n\n{--d--}\n', 7, 7, '$$'],
    ['$$\n\n{++.++} ', 11, 11, '$$'],
    ['$$\n{++++}\n\ne', 11, 11, '$$'],
    ['$$\n\nt', 4, 4, '$$'],
    ['$$\n\na\n\nb $$ {++c++}\n', 11, 13, ''],
    ['x$$\n\na\n\nb $$ {++c++}\n', 0, 1, '']
  ] as const)('re-pairs a $$ math block far from the edit in %j', (source, start, end, insert) => {
    // A `$$` alone on its line closes at the next `$$` anywhere later, so an
    // edit to a `$` can change a math block outside every reparsed window.
    const core = createDocumentCore()
    const revision = core.open(source)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    step(session, start, end, insert, `${JSON.stringify(source)} [${start}, ${end}) ${JSON.stringify(insert)}`)
  })

  const replay = (source: string, edits: ReadonlyArray<readonly [number, number, string]>): void => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    for (const [start, end, insert] of edits) {
      step(session, start, end, insert, `${JSON.stringify(session.revision.source)} [${start}, ${end}) ${JSON.stringify(insert)}`)
    }
  }

  it.each([
    ['a\n\n=', 3, 3, '\n'],
    ['\n\n=', 2, 2, '\n'],
    ['a\n\nb\n', 3, 4, '']
  ] as const)('gives a blank line at a region start to the block before in %j', (source, start, end, insert) => {
    // The previous block's event owns the blank lines after it, so a region
    // may not begin with one.
    replay(source, [[start, end, insert]])
  })

  it('refuses a plain region that starts on a blank line with no block before it to widen to', () => {
    // Splitting `   on.` left a whitespace-only first line, which belongs to
    // the block before; widening found no earlier plain block to start from.
    replay('> quoted line\n\n\t\n\n{++Whole paragraph addition.++}\n',
      [[7, 14, '\n\n'], [12, 17, '\n\n'], [27, 27, '``'], [32, 37, '\n\n'], [39, 39, '\n\n   '], [34, 34, '\n\n   '], [38, 38, '\n']])
  })

  it('splices the unterminated last line out of the reused prefix', () => {
    // The finish that completed the old last line consumed nothing, so the
    // splice kept it with the prefix and lost the new block start.
    replay('Another ordinary sentence with more words.\n\nText {--deleted--} and {~~old~>new~~} too.\n\nPara *em* and `code` here.',
      [[102, 108, '\n\n'], [97, 97, '===']])
  })

  it('moves a plain block start that follows an edit inside the reparsed blocks', () => {
    // Deleting across a block start inside the window moved the next block's
    // start, but the plain index kept its old coordinate and a later edit
    // read past the end of the source.
    replay('Text with {++added++} inside.\n\nPlain words here.\n\nMulti\nline\nparagraph.',
      [[28, 39, '\n\n'], [10, 10, '# '], [57, 58, '\n\n'], [48, 59, '\n\n'], [50, 54, '']])
  })

  it('spells a separator outside any Substitution the same wherever it is', () => {
    // A stray `~>` was escaped in Markup only when some other delimiter
    // appeared anywhere in the view, so a reparse of its own paragraph
    // disagreed with a fresh open of the document.
    replay(' {++d++} {>><<}\n\n`++}`', [[8, 8, '~>']])
    const core = createDocumentCore()
    const markup = core.project(core.open(' {++d++}~> {>><<}\n\n`++}`'), 'markup')
    expect(markup.syntax.ast.root.children.map(node => [node.range.start, node.range.end])).toEqual([[0, 5], [7, 12]])
  })

  it('starts a region after a run of blank lines, not inside it', () => {
    // Which lines of a blank run read as empty paragraphs depends on the whole
    // run, so a region starting inside it misplaced the suggestion's first line.
    const source = 'a\n\n\n\n{++\n\nparagraph.++}\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    step(session, 14, 15, '', 'delete inside a suggestion after a blank run')
    expect(session.regional).toBe(1)
  })

  // Stray closers and unfinished openers are text with a diagnostic; a
  // document holding them is edited regionally like any other.
  const strayBlocks = [
    'Stray ++} closer and --} here.',
    'Unfinished {== opener here.',
    'Both {~~ and <<} marks.',
    'Arrow ~> lone text.',
    'Kept {++ok++} then {== open.',
    '# Head {~~ open',
    '- item ==} x\n- more {== y',
    'Text {--gone--} and ++} stray.',
    '> quoted {== open --}',
    'Open {>> note\n\nlater <<} closes'
  ]
  const strayInsertions = ['++}', '--}', '{==', '==}', 'a ~~} b', '{~~ ']
  it.each(Array.from({ length: 16 }, (_, seed) => seed + 1))('stray seed %i', seed => {
    fuzz(seed, [...strayBlocks, ...wideBlocks], [...strayInsertions, ...wideInsertions])
  })

  it('keeps an opener that a later stray closer can close out of a window', () => {
    // `{==` spelled over an unfinished `{>>` pairs with a stray `==}` beyond
    // the reparsed blocks: the window read the same number of diagnostics,
    // but not the same ones.
    replay('Multi\nline\nparagraph.\n\nOpen {>> note\n\nlater <<} closes\n\nText with {++added++} inside.\n',
      [[46, 58, '\n\n'], [1, 1, '{>>c<<}'], [57, 68, '\n\n'], [67, 67, '==}'], [15, 18, ''], [34, 34, '{==']])
  })

  it('keeps overlapping marker spellings out of a window', () => {
    // `++{++}` reads its `{++` or its `++}` depending on markers far away.
    replay('# Head {~~ open\n\n\n\nPlain words here.\n\n\n\nKept {++ok++} then {== open.\n\nMulti\nline\nparagraph.\n\n# Head {~~ open\n\nText {--gone--} and ++} stray.\n\nKept {++ok++} then {== open.\n\n# Heading\n\n\n\nBoth {~~ and <<} marks.\n',
      [[87, 87, '{++n++}'], [29, 29, '{++n++}'], [100, 100, '{++']])
  })

  it('bounds reference facts by their source offsets, not their view offsets', () => {
    // A definition after an Addition sits earlier in Original than in the
    // source, so removing it looked like an edit past every reference.
    replay('Ref [x] {++y++}.\n\n[x]: http://x.y\n\nArrow ~> lone text.\n\n[^1]: note {++n++}\n\n\n\nText {--gone--} and ++} stray.\n\nRef [x] {++y++}.\n\n[x]: http://x.y\n\n$$\nx {++y++}\n$$\n',
      [[115, 118, '\n\n'], [67, 70, ''], [109, 111, ''], [14, 14, '> '], [38, 38, '\n\n'], [56, 56, '[r]'], [131, 133, '']])
  })

  it('keeps the blocks around a window as they read before the edit', () => {
    // Turning an HTML block into a paragraph drops the empty paragraphs the
    // blank lines before it read as, outside the replaced blocks.
    replay('Another ordinary sentence with more words.\n\nUnfinished {== opener here.\n\n\n\n<div>\n{++html++}\n</div>\n',
      [[73, 73, '\\'], [86, 86, '\n'], [85, 87, ''], [14, 17, ''], [89, 89, '\n\n   '], [97, 97, '   ']])
  })
})
