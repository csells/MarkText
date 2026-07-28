import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __markdownDocumentParsesV1,
  __resetMarkdownDocumentParsesV1
} from '../../src/internal/profile1/markdownParser.js'
import {
  __referenceDefinitionIndexBuildsV1,
  __resetReferenceDefinitionIndexBuildsV1
} from '../../src/internal/profile1/markdownLaneState.js'
import {
  __profile1PhysicalTraversalCountsV1,
  __resetProfile1PhysicalTraversalCountsV1
} from '../../src/internal/profile1/physicalTraversalAccounting.js'

/**
 * ADR 0013: parse each document once and read every view off it.
 *
 * The counter records the physical intrinsic grammar traversal and AST-region
 * work, so a logical wrapper cannot hide duplicated parser work.
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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function parsesFor(source: string): number {
  __resetMarkdownDocumentParsesV1()
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  expect(revision.kind).toBe('complete')
  return __markdownDocumentParsesV1()
}

function containsKind(node: MarkdownNode, kind: string): boolean {
  if (node.kind === kind) {
    return true
  }
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    if (containsKind(node.childAt(ordinal), kind)) {
      return true
    }
  }
  return false
}

describe('one intrinsic Markdown parse', () => {
  it('accounts for one intrinsic parse of marker-bearing canonical source', () => {
    expect(parsesFor('a{++new++}b\n')).toBe(1)
  })

  it('parses a CriticMarkup-free document exactly once', () => {
    // The invariant, now actually true and honestly counted: no markers, no
    // per-view divergence, no boundary edits to plan — one authoritative parse.
    expect(parsesFor('# Title\n\nHello *world*.\n')).toBe(1)
  })

  it('admits Comment display ASTs without another Markdown parse', () => {
    // Highlights show in both Original and Revised, and Comment bodies are
    // hidden in both, so an annotated-but-unchanged document is byte-identical
    // across views. The Comment alternative is emitted within the same
    // intrinsic grammar admission.
    expect(parsesFor('Hello {==world==}{>>check this<<}.\n')).toBe(1)
  })

  it('keeps every Comment alternative inside the one intrinsic parse', () => {
    // Adding Comment alternatives adds emitted graph structure, not separate
    // Markdown grammar admissions.
    const one = parsesFor('a {==x==}{>>one<<} b\n')
    const three = parsesFor('a {==x==}{>>one<<} {==y==}{>>two<<} {==z==}{>>three<<} b\n')
    expect(three - one).toBe(0)
  })

  it('keeps annotation-only documents to one parse', () => {
    expect(parsesFor('Hello {==world==}{>>check this<<}.\n')).toBe(1)
  })

  it('admits all unary-form forks to one intrinsic parse', () => {
    expect(parsesFor('a{++x++}{--y--}{==h==}b\n')).toBe(1)
  })

  it('reads the editing block AST without re-parsing when a view already matches', () => {
    // The editing view shows addition, deletion and highlight content and hides
    // comments. With no deletions and no Substitutions it is therefore
    // byte-identical to Revised, so mounting the editor's block AST must reuse
    // that parse rather than run another one over the same text.
    __resetMarkdownDocumentParsesV1()
    const revision = createLanguageEngine().open(
      createSourceSnapshot('a{++x++}b and {==h==}{>>note<<} here.\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    const afterOpen = __markdownDocumentParsesV1()
    revision.projection('editing')
    expect(__markdownDocumentParsesV1()).toBe(afterOpen)
  })

  it('admits Substitution boundary branches to the same intrinsic parse', () => {
    expect(parsesFor('a{~~old~>new~~}b\n')).toBe(1)
  })

  it('accounts source admission and intrinsic AST alternatives separately', () => {
    __resetProfile1PhysicalTraversalCountsV1()
    const revision = createLanguageEngine().open(
      createSourceSnapshot('a{~~old~>new~~}b\n'),
      TEST_CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    expect(__profile1PhysicalTraversalCountsV1()).toEqual({
      intrinsicSource: 1,
      total: 1,
      intrinsicSourceUnits: 17,
      forkAstRegionEmissions: 6,
      forkAstRegionUnits: 42,
      forkAstRegionReuses: 0,
      commentProjectionPreparations: 0,
      commentProjectionPreparationUnits: 0
    })
  })

  it('reads every fork from the emitted AST without projected grammar traversal', () => {
    const stablePrefix = Array.from(
      { length: 64 },
      (_, ordinal) => `# unchanged ${String(ordinal)}\n\n`
    ).join('')
    const forkRegion = 'before {~~old~>new~~} after {>>note<<}\n'
    const source = `${stablePrefix}${forkRegion}`
    __resetProfile1PhysicalTraversalCountsV1()
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    const afterOpen = __profile1PhysicalTraversalCountsV1()
    expect(revision.projection('original').markdown.root.childCount)
      .toBeGreaterThan(0)
    expect(revision.projection('revised').markdown.root.childCount)
      .toBeGreaterThan(0)
    expect(revision.projection('editing').markdown.root.childCount)
      .toBeGreaterThan(0)
    expect(__profile1PhysicalTraversalCountsV1()).toEqual(afterOpen)
    const comment = revision.criticMarkup.rootAt(1)
    expect(revision.commentDisplay(comment.nodeId).markdown.root.childCount)
      .toBeGreaterThan(0)

    const work = __profile1PhysicalTraversalCountsV1()
    expect(work.forkAstRegionEmissions)
      .toBe(afterOpen.forkAstRegionEmissions)
    expect(work.forkAstRegionEmissions).toBeGreaterThan(0)
    expect(work.forkAstRegionUnits).toBeLessThan(
      source.length + forkRegion.length * 3
    )
    expect(work.forkAstRegionReuses).toBeGreaterThan(0)
  })

  it('emits every Comment AST alternative before admission and reads it without work', () => {
    const sourceWith = (count: number): string =>
      `a${Array.from({ length: count }, (_, ordinal) =>
        `{>>comment ${String(ordinal)} **body**<<}`).join('')}b\n`
    const openWork = (count: number) => {
      __resetProfile1PhysicalTraversalCountsV1()
      const revision = createLanguageEngine().open(
        createSourceSnapshot(sourceWith(count)),
        TEST_CONFIGURATION
      )
      if (revision.kind !== 'complete') {
        throw new Error('Expected a complete document revision')
      }
      return { revision, work: __profile1PhysicalTraversalCountsV1() }
    }

    const one = openWork(1)
    const many = openWork(16)
    expect(many.work.forkAstRegionEmissions)
      .toBeGreaterThan(one.work.forkAstRegionEmissions)
    expect(many.work.forkAstRegionUnits).toBeGreaterThan(
      one.work.forkAstRegionUnits
    )
    expect(many.work.commentProjectionPreparations).toBe(16)
    expect(many.work.commentProjectionPreparationUnits)
      .toBeGreaterThan(one.work.commentProjectionPreparationUnits)

    const beforeRead = __profile1PhysicalTraversalCountsV1()
    const first = many.revision.criticMarkup.rootAt(0)
    const display = many.revision.commentDisplay(first.nodeId)
    expect(display.source).toBe('comment 0 **body**')
    expect(containsKind(display.markdown.root, 'strong')).toBe(true)
    const afterRead = __profile1PhysicalTraversalCountsV1()
    expect(afterRead).toEqual(beforeRead)
    expect(many.revision.commentDisplay(first.nodeId)).toBe(display)
    expect(__profile1PhysicalTraversalCountsV1()).toEqual(afterRead)
  })

  it('builds no selected-lane reference index from projected text', () => {
    __resetReferenceDefinitionIndexBuildsV1()
    const revision = createLanguageEngine().open(
      createSourceSnapshot(
        'See [r].\n\n{~~old [r]~>new [r]~~}\n\n[r]: /destination\n'
      ),
      TEST_CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    for (const view of ['original', 'revised', 'editing'] as const) {
      expect(containsKind(
        revision.projection(view).markdown.root,
        'link'
      )).toBe(true)
    }
    expect(__referenceDefinitionIndexBuildsV1()).toBe(0)
  })

  it('emits unchanged link and definition regions once across root views', () => {
    __resetProfile1PhysicalTraversalCountsV1()
    const revision = createLanguageEngine().open(
      createSourceSnapshot(
        'See [r].\n\n{~~old~>new~~}\n\n[r]: /destination\n'
      ),
      TEST_CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    const work = __profile1PhysicalTraversalCountsV1()
    expect(work.forkAstRegionEmissions).toBe(8)
    expect(work.forkAstRegionReuses).toBe(10)
  })

  it('stages later reference definitions in the same physical traversal', () => {
    expect(parsesFor('See {++[r]++}.\n\n[r]: /url\n')).toBe(1)
  })

  it('preserves projected Markdown structure while skipping the tautology', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('# T\n\n- a\n- b\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    const revised = revision.projection('revised')
    expect(revised.source).toBe('# T\n\n- a\n- b\n')
    expect(revised.markdown.root.childAt(0).kind).toBe('heading')
  })
})
