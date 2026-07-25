// Spike tests: micromark direct-tokenizer design vs Profile 1
// (research 0006 §9, spike 1). Assertions are on compiled HTML.
// See micromark-flow.test.js for the flow-level enclosure design and
// micromark-resolve.test.js for the attention-style design.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { micromark } from 'micromark'
import { criticSyntax, criticHtml } from './micromark-critic.js'

const md = (doc) =>
  micromark(doc, { extensions: [criticSyntax], htmlExtensions: [criticHtml] })

test('M1: single-paragraph addition compiles, payload is real markdown', () => {
  assert.equal(md('x {++a *em* b++} y'), '<p>x <ins>a <em>em</em> b</ins> y</p>')
})

test('M1b: interior single + is payload, not a closer', () => {
  assert.equal(md('{++a+b++}'), '<p><ins>a+b</ins></p>')
})

test('M1c: literal precedence — marker inside a code span is data', () => {
  const out = md('a `{++` b ++} c')
  assert.ok(out.includes('<code>{++</code>'), out)
  assert.ok(!out.includes('<ins>'), out)
})

test('C1 by construction: emphasis cannot pair across the annotation boundary', () => {
  const out = md('{++ *bold ++} rest*')
  assert.ok(out.includes('<ins>'), out)
  assert.ok(!out.includes('<em>'), `emphasis leaked across the boundary: ${out}`)
})

test('C2: emphasis fully outside encloses the whole annotation', () => {
  assert.equal(md('*a {++b++} c*'), '<p><em>a <ins>b</ins> c</em></p>')
})

test('R2/M4: unclosed opener degrades to literal, rest of document intact', () => {
  const out = md('x {++never closed\n\nnext *para* works')
  assert.ok(!out.includes('<ins>'), out)
  assert.ok(out.includes('{++never closed'), out)
  assert.ok(out.includes('<em>para</em>'), out)
})

test('N1: mixed-form nesting — a brace form inside an addition subtokenizes', () => {
  assert.equal(md('{++a {++b++} c++}'), '<p><ins>a <ins>b</ins> c</ins></p>')
})

test('N1: same-form nesting pairs innermost (MMD-6 oracle semantics)', () => {
  assert.equal(md('{++x{++y++}z++} tail'), '<p><ins>x<ins>y</ins>z</ins> tail</p>')
})

test('review fix: inline constructs span soft line breaks inside a payload', () => {
  // Payload chunk tokens are now linked (previous/next), so the text
  // subtokenizer sees one stream. Unlinked chunks made this fail silently.
  assert.equal(md('{++a *em\nem* b++}'), '<p><ins>a <em>em\nem</em> b</ins></p>')
})

test('review fix — E1: an escaped closer is payload, not a closer', () => {
  const out = md('{++a \\++} b++}')
  assert.ok(out.includes('<ins>'), out)
  assert.ok(!out.includes('b++}'), `closed at the escaped closer: ${out}`)
})

test('PINNED GAP — L2: raw closer scan does not respect code spans inside the arm', () => {
  // Profile 1 L2 says the code span (earlier start) owns `x++}`, so the
  // annotation should close at the SECOND ++}. This design's private
  // character scan is blind to sibling constructs and closes at the FIRST.
  // The resolveTo design (micromark-critic-resolve.js) gets this right.
  const out = md('{++a `x++}` b++}')
  assert.ok(!out.includes('<code>x++}</code>'), out)
  assert.ok(out.includes('<ins>'), out)
})

test('PINNED GAP — X1: quadratic on unclosed-opener runs (review measurement)', () => {
  // Every '{' triggers a scan to the block-end EOF then backtracks: O(n²).
  // Review measured 6.5s at 24KB of '{++' runs (baseline micromark: 1.5ms).
  // The resolveTo design has no lookahead scan and no such blowup.
  const time = (n) => {
    const doc = '{++'.repeat(n)
    const t = performance.now()
    md(doc)
    return performance.now() - t
  }
  time(200) // warm
  const t1 = time(400)
  const t2 = time(800)
  assert.ok(t2 / t1 > 2.5, `expected super-linear scaling, got ${t1.toFixed(1)}ms → ${t2.toFixed(1)}ms`)
})

test('soft line break inside an annotation (same paragraph) works', () => {
  assert.ok(md('{++line one\nline two++}').includes('<ins>'))
})

test('GO/NO-GO — R3: annotation spanning a blank line does NOT form (text-context EOF wall)', () => {
  // Verified in source by the review: chunk chains are per content block;
  // the text tokenizer receives a synthetic EOF at the block's end, so no
  // text construct can see the next paragraph.
  const out = md('x {++first\n\nsecond++} y')
  assert.ok(!out.includes('<ins>'), out)
  assert.ok(out.includes('{++first'), out)
  assert.ok(out.includes('second++}'), out)
})

test('R3 enclosure does not form in THIS design (see micromark-flow.test.js)', () => {
  // A text-level construct cannot claim block-enclosing markers. The
  // flow-level design forms this same input; the mid-inline R3 case forms
  // in neither.
  const out = md('{++\n\n> quoted\n\n++}')
  assert.ok(!out.includes('<ins>'), out)
  assert.ok(out.includes('<blockquote>'), out)
})
