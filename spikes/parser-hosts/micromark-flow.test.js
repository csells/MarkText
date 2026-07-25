// Spike tests: the flow-level enclosure design (adversarial-review find).
// Expresses the R3 block-enclosure SUBSET — markers alone on their own lines
// enclosing whole blocks — on micromark's public API. This is micromark's
// parallel to the lezer composite-block design and to Penney's proposed
// markers-on-own-lines block syntax (research 0005 F2). The headline R3 case
// (mid-inline open/close) remains impossible in both hosts' parses.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { micromark } from 'micromark'
import { criticFlowSyntax, criticFlowHtml } from './micromark-critic-flow.js'

const md = (doc) =>
  micromark(doc, { extensions: [criticFlowSyntax], htmlExtensions: [criticFlowHtml] })

test('enclosure of a blockquote forms (the inline design GO/NO-GO input)', () => {
  const out = md('{++\n\n> quoted\n\n++}')
  assert.ok(out.includes('<ins>'), out)
  assert.ok(out.includes('<blockquote>'), out)
  assert.ok(out.indexOf('<ins>') < out.indexOf('<blockquote>'), out)
  assert.ok(out.indexOf('</blockquote>') < out.indexOf('</ins>'), out)
})

test('enclosure of two paragraphs (blank line inside) forms', () => {
  const out = md('{++\n\nfirst para\n\nsecond para\n\n++}')
  assert.ok(out.includes('<ins>'), out)
  assert.ok((out.match(/<p>/g) || []).length >= 2, out)
})

test('interior parses as real block structure (fenced code stays literal, R3a)', () => {
  const out = md('{++\n```\n{++ raw ++}\n```\n++}')
  assert.ok(out.includes('<ins>'), out)
  assert.ok(out.includes('<code>'), out)
  assert.ok(out.includes('{++ raw ++}'), out)
})

test('R2: unclosed opener line degrades; rest of document intact', () => {
  const out = md('{++\nabc\n\nnext *para*')
  assert.ok(!out.includes('<ins>'), out)
  assert.ok(out.includes('<em>para</em>'), out)
})

test('closer with trailing text is not a closer line', () => {
  const out = md('{++\nabc\n++} tail\n++}')
  assert.ok(out.includes('<ins>'), out)
  assert.ok(out.includes('++} tail'), out)
})

test('GO/NO-GO stands: a mid-inline opener is not claimed by the flow design', () => {
  // Flow constructs are only attempted at line starts; 'text {++' cannot
  // open a block annotation, so the headline R3 case still does not form.
  const out = md('text {++\n\npara\n\n++}')
  assert.ok(!out.includes('<ins>'), out)
})
