import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type MarkdownDocument,
  type MarkdownNode,
  type NodeId,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  captureProfileParseTraceV1,
  type ProfileParseTraceEventV1
} from '../../src/internal/profileParseTraceV1.js'
import { runsOf } from '../helpers/collections.js'

/**
 * The Phase 0.5 architecture gate.
 *
 * Plan 0009 requires the Profile 1 Markdown parser to own canonical source
 * progression and to emit CriticMarkup as native grammar productions, with every
 * derived product built from parser-created identity. Until 2026-07-22 no test
 * could observe whether that was true, so nine tranches grew the opposite
 * architecture while the suite stayed green.
 *
 * This gate makes the architecture executable. It asserts over
 * `ProfileParseTraceV1`, which records what actually consumed canonical source
 * and what each authoritative CST was built from.
 *
 * Every row is ordinary: the trace vocabulary itself contains only the
 * intrinsic ownership and canonical fork inputs that production permits.
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

const CRITIC_FREE_SOURCE = '# Title\n\nHello *world* and `code`.\n'
const CRITIC_SOURCE = 'a{++new++}b\n'

function traceOf(source: string): readonly ProfileParseTraceEventV1[] {
  const engine = createLanguageEngine()
  const captured = captureProfileParseTraceV1(engine, () =>
    engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
  )
  expect(captured.value.kind).toBe('complete')
  return captured.trace.events
}

const admissions = (
  events: readonly ProfileParseTraceEventV1[]
): readonly ProfileParseTraceEventV1[] =>
  events.filter((event) => event.kind === 'canonical-source-admission')

const progressionOwners = (
  events: readonly ProfileParseTraceEventV1[]
): readonly string[] =>
  events.flatMap((event) =>
    event.kind === 'source-progression' ? [event.owner] : []
  )

const authoritativeInputs = (
  events: readonly ProfileParseTraceEventV1[]
): readonly string[] =>
  events.flatMap((event) =>
    event.kind === 'authoritative-markdown-parse' ? [event.input] : []
  )

describe('Phase 0 intrinsic-parser architecture gate', () => {
  it('all revision products retain parser-created identity', () => {
    const source =
      'A{++new++}{--old--}{~~before~>after~~}{==focus==}' +
      '{>>note **bold**<<}\n\nSee [r].\n\n[r]: /destination\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }

    const criticNodes: CriticMarkupNode[] = []
    const pendingCritic = Array.from(
      { length: revision.criticMarkup.rootCount },
      (_, ordinal) => revision.criticMarkup.rootAt(ordinal)
    )
    while (pendingCritic.length > 0) {
      const node = pendingCritic.pop()
      if (node === undefined) {
        continue
      }
      criticNodes.push(node)
      for (const arm of node.arms) {
        pendingCritic.push(...arm.children)
      }
    }
    const comment = criticNodes.find((node) => node.kind === 'comment')
    if (comment === undefined) {
      throw new Error('Identity fixture lost its Comment')
    }
    const documents: MarkdownDocument[] = [
      revision.projection('original').markdown,
      revision.projection('revised').markdown,
      revision.projection('editing').markdown,
      revision.commentDisplay(comment.nodeId).markdown
    ]

    // Read every admitted parser product before enumerating the immutable graph.
    const syntaxIds = new Set<NodeId>(
      Array.from(
        { length: revision.syntax.nodeCount },
        (_, ordinal) => revision.syntax.nodeAt(ordinal).nodeId
      )
    )
    expect(syntaxIds.has(revision.syntax.root)).toBe(true)

    for (const node of criticNodes) {
      expect(syntaxIds.has(node.nodeId), node.kind).toBe(true)
      for (const arm of node.arms) {
        expect(syntaxIds.has(arm.nodeId), `${node.kind}:${arm.name}`).toBe(true)
      }
    }
    for (const document of documents) {
      const pending: MarkdownNode[] = [document.root]
      while (pending.length > 0) {
        const node = pending.pop()
        if (node === undefined) {
          continue
        }
        expect(syntaxIds.has(node.nodeId), node.kind).toBe(true)
        for (let ordinal = node.childCount - 1; ordinal >= 0; ordinal -= 1) {
          pending.push(node.childAt(ordinal))
        }
      }
    }
    for (const run of runsOf(revision.markup)) {
      for (const mark of run.marks) {
        expect(syntaxIds.has(mark.nodeId), mark.kind).toBe(true)
      }
    }
    for (let offset = 0; offset < source.length; offset += 1) {
      const owner = revision.ownership.ownerAt(offset).owner
      const nodeId = Reflect.get(owner, 'nodeId') as NodeId | undefined
      if (nodeId !== undefined) {
        expect(syntaxIds.has(nodeId), owner.kind).toBe(true)
      }
    }
    for (let ordinal = 0; ordinal < revision.syntax.edgeCount; ordinal += 1) {
      const edge = revision.syntax.edgeAt(ordinal)
      expect(syntaxIds.has(edge.from), `${edge.kind}:from`).toBe(true)
      expect(syntaxIds.has(edge.to), `${edge.kind}:to`).toBe(true)
    }
  })

  it('marker-bearing source is emitted by one intrinsic grammar', () => {
    const events = traceOf(
      '# Shared\n\nSee [r].\n\n{~~old [r]~>new [r]~~}\n\n[r]: /url\n'
    )

    expect(admissions(events)).toHaveLength(1)
    expect(progressionOwners(events)).toEqual(['markdown-kernel'])
    expect(authoritativeInputs(events)).toEqual(['canonical-source'])
  })

  describe('canonical source admission', () => {
    it('admits canonical source exactly once for a CriticMarkup-free document', () => {
      expect(admissions(traceOf(CRITIC_FREE_SOURCE))).toHaveLength(1)
    })

    it('admits canonical source exactly once for a CriticMarkup document', () => {
      expect(admissions(traceOf(CRITIC_SOURCE))).toHaveLength(1)
    })
  })

  describe('CriticMarkup-free documents — the intrinsic kernel beachhead', () => {
    it('gives the Markdown kernel ownership of source progression', () => {
      expect(progressionOwners(traceOf(CRITIC_FREE_SOURCE)))
        .toEqual(['markdown-kernel'])
    })

    it('builds every authoritative CST from canonical source', () => {
      expect(authoritativeInputs(traceOf(CRITIC_FREE_SOURCE)))
        .toEqual(['canonical-source'])
    })

    it('admits one authoritative fork parse from canonical source', () => {
      expect(authoritativeInputs(traceOf(CRITIC_FREE_SOURCE)))
        .toEqual(['canonical-source'])
    })
  })

  describe('CriticMarkup documents', () => {
    it(
      'gives marker-bearing source progression to the Markdown kernel',
      () => {
        expect(progressionOwners(traceOf(CRITIC_SOURCE)))
          .toEqual(['markdown-kernel'])
      }
    )

    it(
      'reads authoritative CST forks from canonical parser input',
      () => {
        expect(authoritativeInputs(traceOf(CRITIC_SOURCE)))
          .toEqual(['canonical-source'])
      }
    )

    it('uses only intrinsic parse event kinds', () => {
      expect(new Set(traceOf(CRITIC_SOURCE).map((event) => event.kind))).toEqual(
        new Set([
          'canonical-source-admission',
          'source-progression',
          'authoritative-markdown-parse'
        ])
      )
    })
  })
})
