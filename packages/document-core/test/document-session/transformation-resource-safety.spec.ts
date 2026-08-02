import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  DOCUMENT_RESOURCE_POLICY_V1,
  DocumentExecutionCancelledError,
  type ParseConfiguration,
  type ParseExecutionControl
} from '@marktext/document-core'
import { hostedRunnerTimeout } from '../helpers/hostedRunnerTimeout.js'

const markerHeavyRunner = fileURLToPath(
  new URL('../fixtures/marker-heavy-transformation-runner.ts', import.meta.url)
)

const DESKTOP_CONFIGURATION: ParseConfiguration = {
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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('DocumentSession transformation resource safety', () => {
  it('rejects an oversized resolve-all transaction before candidate parsing', async() => {
    const changeCount =
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction + 1
    const source = '{++x++}\n\n'.repeat(changeCount)
    let cancellationArmed = false
    let candidateCheckpoints = 0
    const executionControl: ParseExecutionControl = Object.freeze({
      checkpoint: Object.freeze((): void => {
        if (!cancellationArmed) return
        candidateCheckpoints += 1
        throw new DocumentExecutionCancelledError()
      })
    })
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: DESKTOP_CONFIGURATION,
      executionControl
    })
    expect(session.snapshot().kind).toBe('complete')
    const before = session.snapshot().revision

    cancellationArmed = true
    const result = await session.dispatch({
      kind: 'resolve-all-changes',
      decision: 'accept'
    }).completion

    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'invalid-command-argument'
    })
    expect(candidateCheckpoints).toBe(0)
    expect(session.snapshot().revision).toBe(before)
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.historyState()).toMatchObject({
      canUndo: false,
      canRedo: false
    })
  }, hostedRunnerTimeout(30_000))

  it('commits the maximum marker-heavy edit/protection set without quadratic join scans', () => {
    const child = spawnSync(process.execPath, [
      '--max-old-space-size=1024',
      '--import=tsx',
      markerHeavyRunner
    ], {
      encoding: 'utf8',
      maxBuffer: 4 * 1_024 * 1_024,
      // Hosted runners execute the same bounded work about four times
      // slower than the owner hardware this guard was sized on.
      timeout: process.env.CI === 'true' ? 240_000 : 60_000
    })

    expect(child.error, child.stderr).toBeUndefined()
    expect(child.signal, child.stderr).toBeNull()
    expect(child.status, child.stderr).toBe(0)
    const proof = JSON.parse(child.stdout.trim()) as {
      readonly kind: string
      readonly editCount: number
      readonly sourceLength: number
      readonly maxRssKiB: number
    }
    expect(proof).toMatchObject({
      kind: 'committed',
      editCount: DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction,
      sourceLength: 196_608
    })
    expect(proof.maxRssKiB).toBeLessThan(1_280 * 1_024)
  }, hostedRunnerTimeout(70_000))
})
