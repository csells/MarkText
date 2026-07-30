import { describe, expect, it } from 'vitest'
import * as physicalAccounting
  from '../../src/internal/profile1/physicalTraversalAccounting.js'
import { createDocumentSession } from '../../src/documentSession.js'
import { createLanguageEngine } from '../../src/languageEngine.js'
import type {
  CompleteDocumentRevision,
  ParseConfiguration
} from '../../src/revision.js'
import { createSourceSnapshot } from '../../src/sourceSnapshot.js'

const CONFIGURATION: ParseConfiguration = {
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

function completeOpen(
  engine: ReturnType<typeof createLanguageEngine>,
  source: string
): CompleteDocumentRevision {
  const revision = engine.open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error(`Expected a complete revision, got ${revision.kind}`)
  }
  return revision
}

// G34 §2 execution report: physical parse-work counters are an engine-owned
// record, not a process-global counter bank. Two engines never share counts,
// lazily materialized products attribute their work to the engine that parsed
// them, and no ambient reset seam exists for targets to lean on.
describe('physical work attribution', () => {
  it('attributes physical parse work to the owning engine alone', () => {
    const first = createLanguageEngine()
    const second = createLanguageEngine()
    expect(first.traversalCounts().intrinsicSource).toBe(0)

    completeOpen(first, '# One\n\nBody {++added++} text.\n')
    const firstAfterOpen = first.traversalCounts()
    expect(firstAfterOpen.intrinsicSource).toBeGreaterThan(0)
    expect(firstAfterOpen.intrinsicSourceUnits).toBeGreaterThan(0)
    expect(second.traversalCounts().intrinsicSource).toBe(0)

    completeOpen(second, 'plain paragraph\n')
    expect(first.traversalCounts()).toEqual(firstAfterOpen)
  })

  it('attributes comment display preparation to the engine that parsed it', () => {
    const owner = createLanguageEngine()
    const bystander = createLanguageEngine()
    const revision = completeOpen(
      owner,
      'a {>>*rich* comment payload<<} z\n'
    )
    completeOpen(bystander, 'unrelated *document*\n')

    // The comment display was prepared during the owner's parse — the work is
    // on the owner's record and never on the bystander's, and reading the
    // admitted product later costs neither engine anything.
    expect(owner.traversalCounts().commentProjectionPreparations).toBe(1)
    expect(bystander.traversalCounts().commentProjectionPreparations).toBe(0)
    const ownerBeforeRead = owner.traversalCounts()
    const bystanderBeforeRead = bystander.traversalCounts()
    const comment = revision.criticMarkup.rootAt(0)
    const display = revision.commentDisplay(comment.nodeId)
    expect(display.source).toBe('*rich* comment payload')
    expect(owner.traversalCounts()).toEqual(ownerBeforeRead)
    expect(bystander.traversalCounts()).toEqual(bystanderBeforeRead)
  })

  it('counts marker-bearing recognition and plain-lane units in the engine record', () => {
    const engine = createLanguageEngine()
    completeOpen(engine, 'plain text only\n')
    const plain = engine.traversalCounts()
    expect(plain.markerBearingIntrinsicSource).toBe(0)
    // A CriticMarkup-free document retains its canonical lane facts, so no
    // source units are handed to the fork-lane block phase a second time.
    expect(plain.plainMarkdownLaneUnits).toBe(0)

    completeOpen(engine, 'a {--removed--} z\n')
    const marked = engine.traversalCounts()
    expect(marked.markerBearingIntrinsicSource).toBeGreaterThan(0)
    expect(marked.plainMarkdownLaneUnits).toBeGreaterThan(0)
  })

  it('reports session physical work from the session-owned engine', async() => {
    const first = await createDocumentSession({
      source: createSourceSnapshot('# Session\n\n{==marked==} body\n'),
      parseConfiguration: CONFIGURATION
    })
    const firstWork = first.physicalWork()
    expect(firstWork.intrinsicSource).toBeGreaterThan(0)

    const second = await createDocumentSession({
      source: createSourceSnapshot('other document\n'),
      parseConfiguration: CONFIGURATION
    })
    expect(second.physicalWork().intrinsicSource).toBeGreaterThan(0)
    expect(first.physicalWork()).toEqual(firstWork)
  })

  it('exposes no ambient counter bank or test-only reset seam', () => {
    const testOnlySeams = Object.keys(physicalAccounting)
      .filter((name) => name.startsWith('__'))
    expect(testOnlySeams).toEqual([])
    expect(
      'readProfile1PhysicalTraversalCountsV1' in physicalAccounting
    ).toBe(false)
  })
})
