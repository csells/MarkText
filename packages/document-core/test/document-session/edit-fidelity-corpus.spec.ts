import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type ParseConfiguration
} from '@marktext/document-core'
import { completeSnapshot } from '../helpers/completeSnapshot.js'

/**
 * Edit fidelity over real documents.
 *
 * Reproducing a document read-only is a weaker claim than owning every edit to
 * it, and owning edits is what moving editing authority to this engine actually
 * risks. So this applies long sequences of inserts, deletions and replacements
 * to real documents from this repository and checks the engine's source against
 * an independently computed expectation after every single one.
 *
 * Undo is checked to land on the exact original bytes, because an editor that
 * cannot get back to where the user started is worse than one that never let
 * them leave.
 *
 * Edits are driven by a seeded generator so a failure is reproducible: a fidelity
 * bug that only appears under one edit ordering is exactly the kind that would
 * otherwise be dismissed as flaky.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

const repoRoot = path.resolve(__dirname, '../../../..')

function collectMarkdown(directory: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) collectMarkdown(full, found)
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(full)
  }
  return found
}

/** Deterministic generator: a failing case must be reproducible, not flaky. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function modelText(session: DocumentSession): string {
  return completeSnapshot(session).livePlan.runs.map((run) => run.text).join('')
}

async function settle(
  ticket: ReturnType<DocumentSession['dispatch']>
): Promise<boolean> {
  const admission = await ticket.admission
  if (admission.kind !== 'admitted') return false
  const completion = await ticket.completion
  // 'committed' is the engine's name for a settled revision. Checking for the
  // wrong kind here makes every row below pass vacuously, which is exactly what
  // it did on the first run.
  return completion.kind === 'committed'
}

/** Documents small enough to edit many times without a slow suite. */
const corpus = collectMarkdown(repoRoot)
  .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
  .filter(({ source }) => source.length > 200 && source.length < 20000)
  .slice(0, 20)

describe('edit fidelity over real documents', () => {
  it('has real documents to edit', () => {
    expect(corpus.length).toBeGreaterThan(5)
  })

  it('actually applies edits, rather than passing vacuously', async() => {
    // The guard this suite needed: if no edit commits, every fidelity row below
    // compares an unchanged document to an unchanged expectation and reports
    // success without testing anything.
    const first = corpus[0]
    if (first === undefined) throw new Error('no corpus')
    const session = await createDocumentSession({
      source: createSourceSnapshot(first.source),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      }
    })
    const selection = session.snapshot().revision.selection
    if (selection === null) throw new Error('no selection')
    const caret = { offset: 1, affinity: 'next' } as const
    expect(await settle(session.dispatch({
      kind: 'insert-text',
      target: { ...selection, anchor: caret, focus: caret },
      text: 'PROOF'
    }))).toBe(true)
    expect(session.snapshot().revision.source).toContain('PROOF')
  })

  it('keeps the document exact through long edit sequences', async() => {
    const failures: string[] = []
    for (const [index, { file, source }] of corpus.entries()) {
      const session = await createDocumentSession({
        source: createSourceSnapshot(source),
        parseConfiguration: TEST_CONFIGURATION,
        configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
        initialView: 'markup',
        trackChanges: false,
        initialSelection: {
          anchor: { offset: 0, affinity: 'next' },
          focus: { offset: 0, affinity: 'next' }
        }
      })
      // Documents carrying CriticMarkup render a different model text than
      // their source; the plain ones let source and model be compared directly.
      if (session.snapshot().revision.source !== modelText(session)) continue

      const random = seededRandom(1000 + index)
      let expected = modelText(session)
      for (let step = 0; step < 12; step += 1) {
        const selection = session.snapshot().revision.selection
        if (selection === null) break
        const at = Math.floor(random() * expected.length)
        const kind = random()
        let applied = false
        if (kind < 0.5) {
          const text = `x${step}`
          applied = await settle(session.dispatch({
            kind: 'insert-text',
            target: {
              ...selection,
              anchor: { offset: at, affinity: 'next' },
              focus: { offset: at, affinity: 'next' }
            },
            text
          }))
          if (applied) expected = expected.slice(0, at) + text + expected.slice(at)
        } else {
          const end = Math.min(expected.length, at + 1 + Math.floor(random() * 5))
          if (end <= at) continue
          const text = kind < 0.8 ? '' : `y${step}`
          applied = await settle(session.dispatch({
            kind: 'replace-text',
            target: {
              ...selection,
              anchor: { offset: at, affinity: 'next' },
              focus: { offset: end, affinity: 'previous' }
            },
            text
          }))
          if (applied) expected = expected.slice(0, at) + text + expected.slice(end)
        }
        if (applied && session.snapshot().revision.source !== expected) {
          failures.push(
            `${path.relative(repoRoot, file)} diverged at step ${step}`
          )
          break
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('undoes back to the exact original bytes', async() => {
    const failures: string[] = []
    for (const [index, { file, source }] of corpus.slice(0, 10).entries()) {
      const session = await createDocumentSession({
        source: createSourceSnapshot(source),
        parseConfiguration: TEST_CONFIGURATION,
        configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
        initialView: 'markup',
        trackChanges: false,
        initialSelection: {
          anchor: { offset: 0, affinity: 'next' },
          focus: { offset: 0, affinity: 'next' }
        }
      })
      const original = session.snapshot().revision.source
      const random = seededRandom(7000 + index)
      let applied = 0
      for (let step = 0; step < 6; step += 1) {
        const selection = session.snapshot().revision.selection
        if (selection === null) break
        const at = Math.floor(random() * modelText(session).length)
        const committed = await settle(session.dispatch({
          kind: 'insert-text',
          target: {
            ...selection,
            anchor: { offset: at, affinity: 'next' },
            focus: { offset: at, affinity: 'next' }
          },
          text: `z${step}`
        }))
        if (committed) applied += 1
      }
      for (let step = 0; step < applied; step += 1) {
        await settle(session.dispatch({ kind: 'undo' }))
      }
      if (session.snapshot().revision.source !== original) {
        failures.push(path.relative(repoRoot, file))
      }
    }
    expect(failures).toEqual([])
  })
})
