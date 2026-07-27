import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  completeSnapshot,
  requireCompleteSnapshot
} from '../helpers/completeSnapshot.js'

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

describe('DocumentSession Markup live plan', () => {
  async function mapsAnEofInsertionThroughThePlan(): Promise<void> {
    const session = await createDocumentSession({
      source: createSourceSnapshot('a{++new++}b'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: {
        authoringTextPolicy: 'nearest-owner-eol-v1'
      },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      }
    })

    const opened = completeSnapshot(session)
    expect(opened.livePlan).toMatchObject({
      revision: opened.revision.id,
      view: 'markup',
      editable: true,
      modelLength: 5,
      runs: [
        { marks: [], text: 'a', modelRange: { start: 0, end: 1 } },
        { marks: [{ kind: 'addition' }], text: 'new', modelRange: { start: 1, end: 4 } },
        { marks: [], text: 'b', modelRange: { start: 4, end: 5 } }
      ]
    })

    const target = opened.livePlan.selectionAt({
      anchor: { offset: 5, affinity: 'next' },
      focus: { offset: 5, affinity: 'next' }
    })
    expect(target).toEqual(opened.revision.selection)

    const result = await session.dispatch({
      kind: 'insert-text',
      target,
      text: '!'
    }).completion
    if (result.kind !== 'committed') {
      throw new Error('Expected the plan-authenticated insertion to commit')
    }
    const after = requireCompleteSnapshot(result.transition.after)
    expect(after.livePlan).toMatchObject({
      revision: after.revision.id,
      modelLength: 6
    })
    expect(after.revision.selection).toMatchObject({
      anchor: { offset: 6, affinity: 'next' },
      focus: { offset: 6, affinity: 'next' }
    })

    const flushed = await session.flush('materialize').completion
    if (flushed.kind !== 'flushed') {
      throw new Error('Expected an exact source lease')
    }
    let exactSource = ''
    for await (const chunk of flushed.source.readChunks()) {
      exactSource += chunk.text
    }
    expect(exactSource).toBe('a{++new++}b!')
  }

  it(
    'maps an editable EOF position without exposing CM delimiters',
    mapsAnEofInsertionThroughThePlan
  )

  it('renders every visible CM arm from a generic Markup artifact', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot(
        'A{++i++}{--d--}{~~o~>n~~}{==h==}{>>hidden<<}Z'
      ),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: {
        authoringTextPolicy: 'nearest-owner-eol-v1'
      },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      }
    })

    expect(completeSnapshot(session).livePlan).toMatchObject({
      modelLength: 7,
      runs: [
        { text: 'A', marks: [] },
        { text: 'i', marks: [{ kind: 'addition' }] },
        { text: 'd', marks: [{ kind: 'deletion' }] },
        { text: 'o', marks: [{ kind: 'substitution', arm: 'old' }] },
        { text: 'n', marks: [{ kind: 'substitution', arm: 'new' }] },
        { text: 'h', marks: [{ kind: 'highlight' }] },
        { text: 'Z', marks: [] }
      ]
    })
  })

  it('maps across an elided Comment without joining its neighboring runs into syntax', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('{{>>note<<}++x++}'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: {
        authoringTextPolicy: 'nearest-owner-eol-v1'
      },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      }
    })

    const opened = completeSnapshot(session)
    expect(opened.livePlan).toMatchObject({
      modelLength: 7,
      runs: [
        {
          text: '{',
          marks: [],
          modelRange: { start: 0, end: 1 },
          sourceRange: { start: 0, end: 1 }
        },
        {
          text: '++x++}',
          marks: [],
          modelRange: { start: 1, end: 7 },
          sourceRange: { start: 11, end: 17 }
        }
      ]
    })

    const result = await session.dispatch({
      kind: 'insert-text',
      target: opened.livePlan.selectionAt({
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      }),
      text: 'q'
    }).completion
    if (result.kind !== 'committed') {
      throw new Error('Expected the discontinuity-mapped insertion to commit')
    }
    const after = requireCompleteSnapshot(result.transition.after)
    expect(after.livePlan.runs.map((run) => run.text).join('')).toBe(
      '{q++x++}'
    )

    const flushed = await session.flush('materialize').completion
    if (flushed.kind !== 'flushed') {
      throw new Error('Expected an exact source lease')
    }
    let exactSource = ''
    for await (const chunk of flushed.source.readChunks()) {
      exactSource += chunk.text
    }
    expect(exactSource).toBe('{{>>note<<}q++x++}')
  })
})
