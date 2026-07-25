// Spike tests: @lezer/markdown vs Profile 1 (research 0006 §9, spike 2).
// Rule IDs (R2, R4, C1, C2, N1, L1, L2…) refer to
// specs/language/marktext-markdown-profile-1.md. Containment is asserted on
// cursor ranges (tree-util.js), not toString() regexes — the adversarial
// review (wf_94bf082a) showed those are sibling-blind.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TreeFragment } from '@lezer/common'
import { pairedParser, atomParser, blockParser_ } from './lezer-critic.js'
import { find, contains } from './tree-util.js'

const has = (doc, name) => find(pairedParser, doc, name).length > 0
const within = (doc, outer, inner) => contains(pairedParser, doc, outer, inner)

// --- Design A: paired delimiters ------------------------------------------

test('L1: all five forms parse single-block', () => {
  const doc = 'a {++add++} b {--del--} c {==hi==} d {>>note<<} e {~~old~>new~~} f'
  for (const name of [
    'CriticAddition',
    'CriticDeletion',
    'CriticHighlight',
    'CriticComment',
    'CriticSubstitution',
    'CriticSubDivider'
  ]) {
    assert.ok(has(doc, name), `${name} missing`)
  }
})

test('L1b: markdown inside an arm parses arm-locally', () => {
  assert.ok(within('{++has *emph* inside++}', 'CriticAddition', 'Emphasis'))
})

test('N1: nesting, including same-form, for addition', () => {
  assert.ok(within('{++a{--b--}c++}', 'CriticAddition', 'CriticDeletion'))
  assert.ok(within('{++a{++b++}c++}', 'CriticAddition', 'CriticAddition'))
})

test('N1: same-form nesting for substitution (review regression)', () => {
  const doc = '{~~a{~~b~>c~~}d~>e~~}'
  const subs = find(pairedParser, doc, 'CriticSubstitution')
  assert.equal(subs.length, 2, `expected outer+inner substitutions, got ${JSON.stringify(subs)}`)
  const [outer, inner] = subs
  assert.ok(inner.from > outer.from && inner.to < outer.to, 'inner not contained')
  // The inner substitution belongs to the outer OLD arm.
  const oldArms = find(pairedParser, doc, 'CriticSubOldArm')
  assert.ok(oldArms.some((a) => inner.from >= a.from && inner.to <= a.to))
})

test('R4: divider inside a nested annotation is payload, not a hijack (review regression)', () => {
  const doc = '{~~x{++y~>z++}w~>v~~}'
  assert.ok(within(doc, 'CriticSubstitution', 'CriticAddition'), 'addition destroyed')
  const div = find(pairedParser, doc, 'CriticSubDivider')
  assert.equal(div.length, 1)
  assert.equal(div[0].from, doc.indexOf('w~>v') + 1, 'divider hijacked by nested ~>')
})

test('R4: first top-level divider wins; later ~> is new-arm payload', () => {
  const doc = '{~~a~>b~>c~~}'
  const div = find(pairedParser, doc, 'CriticSubDivider')
  assert.equal(div.length, 1)
  assert.equal(div[0].from, 4)
  const newArm = find(pairedParser, doc, 'CriticSubNewArm')[0]
  assert.equal(newArm.from, 6)
  assert.equal(newArm.to, 10)
})

test('R4: substitution with no top-level divider does not form', () => {
  assert.ok(!has('{~~just old~~}', 'CriticSubstitution'))
  // Divider owned by a code span is not top-level (L2 + R4):
  assert.ok(!has('{~~a `x~>y` b~~}', 'CriticSubstitution'))
  assert.ok(has('{~~a `x~>y` b~~}', 'InlineCode'))
})

test('R2: unclosed substitution leaves no phantom nodes and blocks nothing (review regression)', () => {
  const doc = '{~~ *b ~> c* d'
  assert.ok(!has(doc, 'CriticSubstitution'))
  assert.ok(!has(doc, 'CriticSubOldArm'), 'phantom old arm')
  assert.ok(!has(doc, 'CriticSubDivider'), 'phantom divider')
  assert.ok(has(doc, 'Emphasis'), 'emphasis killed by dangling substitution state')
})

test('R2: stray ~> after a failed substitution is literal', () => {
  const doc = '{~~old~~} and ~> arrow'
  assert.ok(!has(doc, 'CriticSubDivider'))
  assert.ok(!has(doc, 'CriticSubOldArm'))
})

test('R2: unclosed opener degrades to literal, affects nothing later', () => {
  const doc = 'a {++unclosed and *emph* still works'
  assert.ok(!has(doc, 'CriticAddition'))
  assert.ok(has(doc, 'Emphasis'))
})

test('R2: closer with no opener is literal', () => {
  assert.ok(!has('a ++} b', 'CriticAddition'))
})

test('CM2: empty payloads form', () => {
  assert.ok(has('{++++}', 'CriticAddition'))
  assert.ok(has('{====}', 'CriticHighlight'))
  assert.ok(has('{~~~>~~}', 'CriticSubstitution'))
})

test('C1: emphasis opened inside an arm cannot close outside (and vice versa)', () => {
  const t1 = '{++ *bold ++} rest*'
  assert.ok(has(t1, 'CriticAddition'))
  assert.ok(!has(t1, 'Emphasis'), 'emphasis leaked across closer')
  const t2 = '*a {++b* c++}'
  assert.ok(has(t2, 'CriticAddition'))
  assert.ok(!has(t2, 'Emphasis'), 'emphasis leaked across opener')
})

test('C2: emphasis fully outside may enclose a whole annotation', () => {
  assert.ok(within('*a {++b++} c*', 'Emphasis', 'CriticAddition'))
})

test('C1-divider: emphasis cannot cross the ~> divider', () => {
  const doc = '{~~a *b~>c* d~~}'
  assert.ok(has(doc, 'CriticSubstitution'))
  assert.ok(!has(doc, 'Emphasis'), 'emphasis leaked across divider')
})

test('C1-links: a link opened inside an arm cannot close outside it', () => {
  const doc = '{++ [label ++}](url)'
  assert.ok(has(doc, 'CriticAddition'))
  assert.ok(!has(doc, 'Link'), 'link leaked across closer')
})

test('C2-links: annotation inside a link label is fine', () => {
  assert.ok(within('[label {++a++} more](url)', 'Link', 'CriticAddition'))
})

test('PINNED — overlap: link opened OUTSIDE, closed inside the would-be arm: link wins', () => {
  // lezer's LinkEnd resolves eagerly at `]`, destroying the pending critic
  // opener, so the link forms and the annotation never does. Profile 1 §9.1
  // under-determines this overlap direction (C1 presupposes the annotation
  // exists). Recorded as a spec question in research 0007; this test pins
  // the host behavior so a change is noticed.
  const doc = '[label {++ a](url) b++}'
  assert.ok(has(doc, 'Link'))
  assert.ok(!has(doc, 'CriticAddition'))
})

test('R2-consistency: a dangling opener does NOT block emphasis around it', () => {
  // Profile 1 R2: an unmatched opener is literal and MUST NOT affect later
  // constructs. Also the demonstration of why post-parse cross-block
  // "joining" is unsound: this emphasis decision would retroactively violate
  // C1 if a later pass paired the opener with a closer in another block.
  const doc = '*a {++ b* and no closer anywhere'
  assert.ok(has(doc, 'Emphasis'))
  assert.ok(!has(doc, 'CriticAddition'))
})

test('L2: a code span inside an arm owns a closer-lookalike; annotation closes later', () => {
  const doc = '{++a `x++}` b++}'
  assert.ok(within(doc, 'CriticAddition', 'InlineCode'))
  const addition = find(pairedParser, doc, 'CriticAddition')[0]
  assert.equal(addition.to, doc.length)
})

test('L1(spec §7): markers inside code spans and fences are data', () => {
  const t1 = 'a `{++` b ++} c'
  assert.ok(has(t1, 'InlineCode'))
  assert.ok(!has(t1, 'CriticAddition'))
  const t2 = '```\n{++not an annotation++}\n```\n'
  assert.ok(has(t2, 'FencedCode'))
  assert.ok(!has(t2, 'CriticAddition'))
})

test('adjacent annotations do not cross-pair', () => {
  const doc = '{++a++}{--b--} {==c==}{>>d<<}'
  assert.equal(find(pairedParser, doc, 'CriticAddition').length, 1)
  assert.equal(find(pairedParser, doc, 'CriticDeletion').length, 1)
  assert.equal(find(pairedParser, doc, 'CriticHighlight').length, 1)
  assert.equal(find(pairedParser, doc, 'CriticComment').length, 1)
})

test('GO/NO-GO — R3: annotation spanning a blank line does NOT pair in the parse', () => {
  assert.ok(!has('{++first paragraph\n\nsecond paragraph++}', 'CriticAddition'))
})

test('R3 within one paragraph: soft line breaks inside an annotation are fine', () => {
  assert.ok(has('{++line one\nline two++}', 'CriticAddition'))
})

// --- Design B: marker atoms + projection-layer pairing ---------------------

test('GO/NO-GO — atom design violates C1: emphasis pairs across a closer atom', () => {
  const doc = '{++ *bold ++} rest*'
  assert.ok(contains(atomParser, doc, 'Emphasis', 'CriticCloseAtom'),
    'expected the C1 violation to be demonstrable')
})

// --- Block-level container: markers on their own lines ---------------------

test('composite block: markers on their own lines can enclose whole blocks', () => {
  const doc = '{++\n\npara one\n\n> a quote\n\n++}\n'
  assert.ok(contains(blockParser_, doc, 'CriticBlockAddition', 'Paragraph'))
  assert.ok(contains(blockParser_, doc, 'CriticBlockAddition', 'Blockquote'))
})

test('composite block CANNOT start mid-paragraph (block parsers are line-anchored)', () => {
  const doc = 'text before {++\n\npara\n\n++}\n'
  assert.equal(find(blockParser_, doc, 'CriticBlockAddition').length, 0)
})

// --- Incrementality: fragment reuse must survive the extension -------------

test('fragment reuse works with the CriticMarkup extension and reuses nodes', () => {
  const para = 'Some *markdown* with {++an addition++} and {--a deletion--} in it.\n\n'
  const doc = para.repeat(2000)
  const t0 = performance.now()
  const full = pairedParser.parse(doc)
  const tFull = performance.now() - t0

  const p = doc.length - 40
  const doc2 = doc.slice(0, p) + 'X' + doc.slice(p)
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(full), [
    { fromA: p, toA: p, fromB: p, toB: p + 1 }
  ])
  const t1 = performance.now()
  const incremental = pairedParser.parse(doc2, fragments)
  const tIncr = performance.now() - t1

  assert.equal(incremental.length, doc2.length)
  // Structural reuse: unchanged inner Trees are the same objects. (Top-level
  // children are rebuilt wrappers, so the check must recurse. The review
  // verified this metric against a two-independent-parses control: 0 shared.)
  const collect = (t, set) => {
    set.add(t)
    for (const c of t.children) if (c.children) collect(c, set)
    return set
  }
  const oldTrees = collect(full, new Set())
  let shared = 0
  let visited = 0
  const count = (t) => {
    visited++
    if (oldTrees.has(t)) {
      shared++
      return
    }
    for (const c of t.children) if (c.children) count(c)
  }
  for (const c of incremental.children) if (c.children) count(c)
  console.log(
    `    full parse ${tFull.toFixed(1)}ms, incremental ${tIncr.toFixed(1)}ms, ` +
      `${shared}/${visited} inner trees shared`
  )
  assert.ok(shared > 1000, `expected extensive structural sharing, saw ${shared}`)
  assert.ok(tIncr < tFull / 3, `incremental (${tIncr}ms) not much faster than full (${tFull}ms)`)
})

// Host-level hazards found by the review (stock @lezer/markdown, not the
// extension): quadratic emphasis resolution on adversarial delimiter runs,
// and a stack-overflow RangeError on ~6000-deep nesting. Not asserted here —
// they are documented with repro in research 0007 §hazards.
