import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'
import { inHistory, keepsTyping, resolveAll } from './support/resolvedSuggestions.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

// Owner rule: with Track Changes on, every edit untracked mode accepts is
// accepted tracked. Rejecting every suggestion after a tracked key gives the
// source rejecting them gave before it, except after a keystroke no record
// holds, which is applied as typed and which Reject All cannot remove (owner
// decision, 9 October 2026: always apply). Typing into deleted or replaced text
// survives accepting them all (G34); otherwise, where the key touches no
// suggestion, accepting them all gives the untracked result's. Keys are
// typed, broken and deleted in documents of literal blocks, literal
// Substitutions and Deletions, where suggestions hold fences and math.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const dense = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
const lines = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n')
const blocks = [
  dense, 'Plain words here.', 'Text {==marked *text*==}{>>see **this** {++and that++}<<} end.', '- item {++one++}\n- item {--two--}',
  '> quoted {~~a~>b~~} line', '# Heading {++added++}', '```js\n' + lines(4, index => `const v${index} = ${index}`) + '\n```',
  '$$\n' + lines(3, index => `x_{${index}} + y`) + '\n$$', '<div>\n' + lines(3, index => `html ${index}`) + '\n</div>',
  lines(3, index => `    indented ${index}`), '{++```js\nconst added = 1\n```\n++}', '{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}',
  '{~~$$\nx_0\n$$\n~>$$\ny_0 + 1\n$$\n~~}', '{~~<div>\nold html\n</div>\n~><div>\nnew html\n</div>\n~~}', '{--```\ngone\n```\n--}',
  'x{~~```\nold\n```\n~>```\nnq\nqqw\n```\n~~}'
]
const keys = ['insertText', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward'] as const
const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

function untracked(source: string, input: DocumentInputAction): readonly DocumentSourceEdit[] | undefined {
  const core = createDocumentCore()
  const revision = core.open(source)
  try {
    return core.inputEdits(revision, input, core.planInput(revision, input, { tracked: false }), false)
  } catch {
    return undefined
  }
}

const seeds = Number(process.env.MARKTEXT_INPUT_ACCEPT_SEEDS ?? 40)
const first = Number(process.env.MARKTEXT_INPUT_ACCEPT_FIRST ?? 1)

describe('tracked input accepts every key untracked input accepts', () => {
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('seed %i', seed => {
    const random = lcg(seed * 4441)
    const source = Array.from({ length: 3 + Math.floor(random() * 5) }, () => blocks[Math.floor(random() * blocks.length)] ?? '').join('\n\n') + '\n'
    const core = createDocumentCore()
    let revision: DocumentRevision = core.open(source)
    for (let press = 0; press < 12; press += 1) {
      const caret = Math.floor(random() * (revision.sourceLength + 1))
      const key = keys[Math.floor(random() * keys.length)] ?? 'insertText'
      const range = key === 'deleteContentBackward'
        ? { start: Math.max(0, caret - 1), end: caret }
        : key === 'deleteContentForward' ? { start: caret, end: Math.min(revision.sourceLength, caret + 1) } : { start: caret, end: caret }
      const input = { range, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, inputType: key, data: key === 'insertText' ? 'x' : null, options } as DocumentInputAction
      const plain = untracked(revision.source, input)
      if (plain === undefined || plain.length === 0) continue
      const label = `${JSON.stringify(revision.source)} @${caret} ${key}`
      const asTyped = inspectDocumentCore(core).keystrokesAppliedAsTyped
      const edits = core.inputEdits(revision, input, core.planInput(revision, input, { tracked: true }), true)
      expect(edits, `refused tracked: ${label}`).toBeDefined()
      if (edits === undefined || edits.length === 0) continue
      const next = core.apply(revision, edits).revision
      if (inspectDocumentCore(core).keystrokesAppliedAsTyped > asTyped) {
        expect(edits, `applied otherwise than typed: ${label}`).toEqual(plain)
        revision = next
        continue
      }
      expect(resolveAll(next.source, 'reject'), `Reject differs: ${label}`).toBe(resolveAll(revision.source, 'reject'))
      const typing = plain.map(edit => edit.insert).join('')
      const touchesSuggestion = revision.annotations.some(annotation =>
        plain.some(edit => edit.start <= annotation.range.end && annotation.range.start <= edit.end))
      if (typing.length > 0 && plain.every(edit => inHistory(revision.annotations, edit.start, edit.end))) {
        // Owner ruling G34: typing into deleted or replaced text survives
        // Accept All, which is otherwise as before.
        expect(keepsTyping(resolveAll(next.source, 'accept'), resolveAll(revision.source, 'accept'), typing), `Accept drops typing: ${label}`).toBe(true)
      } else if (!touchesSuggestion) {
        const plainCore = createDocumentCore()
        const plainNext = plainCore.apply(plainCore.open(revision.source), plain).revision
        // G46: an untracked edit that turns other suggestions' markers into
        // text, as a fence it breaks swallowing them, has no Accept All to
        // match; a tracked spelling keeps those suggestions. Reject All is
        // still exact for it, as checked above.
        if (plainNext.annotations.length === revision.annotations.length) {
          expect(resolveAll(next.source, 'accept'), `Accept differs: ${label}`).toBe(resolveAll(plainNext.source, 'accept'))
        }
      }
      revision = next
    }
  }, 120_000)
})
