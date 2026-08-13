import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collectCriticMarkupParityBaseline,
  type CriticMarkupParityDisposition,
  type CriticMarkupParityDispositionOverlay,
  type CriticMarkupParityRowManifest,
  validateCriticMarkupParityDispositions
} from '../../../../../scripts/criticmarkupParityBaseline'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const baselineCommit = '43bd8b77795fb27b1a9512737c000f7362031ea0'
const baseline = collectCriticMarkupParityBaseline(repoRoot, baselineCommit)
const emptyRows = {
  schema: 'marktext-criticmarkup-parity-rows-v1' as const,
  baselineCommit,
  rows: []
}
const artifactSchemaCases = [
  {
    artifact: 'baseline',
    validate: (schema?: string) => validateCriticMarkupParityDispositions(
      {
        ...(schema === undefined ? {} : { schema }),
        baselineCommit,
        sources: [],
        items: []
      },
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions: {}
      },
      emptyRows
    ),
    expected: /CriticMarkup parity baseline schema is invalid/
  },
  {
    artifact: 'disposition overlay',
    validate: (schema?: string) => validateCriticMarkupParityDispositions(
      baseline,
      {
        ...(schema === undefined ? {} : { schema }),
        baselineCommit,
        dispositions: {}
      },
      emptyRows
    ),
    expected: /Parity disposition overlay schema is invalid/
  },
  {
    artifact: 'row manifest',
    validate: (schema?: string) => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions: {}
      },
      {
        ...(schema === undefined ? {} : { schema }),
        baselineCommit,
        rows: []
      }
    ),
    expected: /Parity row manifest schema is invalid/
  }
]

const completeParityRowFixture = (): {
  overlay: CriticMarkupParityDispositionOverlay
  validRow: CriticMarkupParityRowManifest['rows'][number]
} => {
  const dispositions: Record<string, CriticMarkupParityDisposition> =
    Object.fromEntries(baseline.items.map(entry => [
      entry.id,
      {
        kind: 'unaffected' as const,
        rationale: 'The item does not cross the document authority seam.'
      }
    ]))
  dispositions['command:edit.undo'] = {
    kind: 'parity-row',
    ref: 'editing.undo'
  }
  return {
    overlay: {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions
    },
    validRow: {
      id: 'editing.undo',
      upstreamBehavior: 'Undo restores the previous editor state.',
      existingOracle: 'packages/desktop/test/e2e/editor-undo.spec.ts',
      productionPathTest: 'planned: installed Core-mode undo/redo parity',
      status: 'planned'
    }
  }
}

describe('CriticMarkup upstream parity baseline', () => {
  it('derives a finite denominator from every recorded upstream surface', () => {
    const counts = Object.fromEntries(
      baseline.sources.map(source => [source.kind, source.count])
    )

    expect(counts).toEqual({
      command: 99,
      preference: 72,
      editorPlugin: 17,
      route: 11,
      menuEntry: 146,
      readmeFeature: 8,
      muyaReadmeFeature: 11,
      desktopUnitTest: 50,
      desktopE2eTest: 59,
      muyaUnitTest: 216,
      muyaE2eTest: 70,
      deferredTest: 25,
      backlogItem: 39,
      manualParityCase: 4,
      disabledCommand: 2
    })
    expect(baseline.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'command:edit.undo' }),
      expect.objectContaining({ id: 'preference:endOfLine' }),
      expect.objectContaining({ id: 'editor-plugin:TableChessboard' }),
      expect.objectContaining({ id: 'route:/editor' }),
      expect.objectContaining({ id: 'menu-entry:menu.file.save' }),
      expect.objectContaining({
        id: 'test:packages/muya/e2e/tests/typing/ime.spec.ts'
      })
    ]))
  })

  it('rejects an inventory until every upstream item has a disposition', () => {
    const overlay: CriticMarkupParityDispositionOverlay = {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions: {}
    }

    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, emptyRows)).toThrow(
      /829 upstream parity items are undisposed/
    )
  })

  it('rejects stale or unsubstantiated dispositions', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    const overlay: CriticMarkupParityDispositionOverlay = {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions: {
        ...dispositions,
        'command:removed-upstream-command': {
          kind: 'parity-row',
          ref: 'specs/parity/removed-upstream-command.md'
        }
      }
    }

    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, emptyRows)).toThrow(
      /1 stale parity disposition/
    )

    delete overlay.dispositions['command:removed-upstream-command']
    overlay.dispositions[baseline.items[0].id] = { kind: 'unaffected' }
    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, emptyRows)).toThrow(
      /requires a rationale/
    )
  })

  it('rejects a parity-row disposition whose human-owned row does not exist', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    dispositions[baseline.items[0].id] = {
      kind: 'parity-row' as const,
      ref: 'phase-0-core-source-edit'
    }
    const overlay: CriticMarkupParityDispositionOverlay = {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: []
      }
    )).toThrow(/unresolved parity row phase-0-core-source-edit/)
  })

  it('rejects a human-owned row that does not name the upstream behavior', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    dispositions['command:edit.undo'] = {
      kind: 'parity-row',
      ref: 'editing.undo'
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions
      },
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          id: 'editing.undo',
          upstreamBehavior: '',
          existingOracle: 'packages/desktop/test/e2e/editor-undo.spec.ts',
          productionPathTest: 'planned: installed Core-mode undo/redo parity',
          status: 'planned'
        }]
      }
    )).toThrow(/Parity row editing.undo requires an upstream behavior/)
  })

  it('rejects parity rows frozen for a different upstream baseline', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    const rows: CriticMarkupParityRowManifest = {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit: 'different-upstream-baseline',
      rows: []
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions
      },
      rows
    )).toThrow(/Parity row manifest targets a different upstream baseline/)
  })

  it('accepts a complete human-owned row referenced by an upstream item', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    dispositions['command:edit.undo'] = {
      kind: 'parity-row',
      ref: 'editing.undo'
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions
      },
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          id: 'editing.undo',
          upstreamBehavior: 'Undo restores the previous editor state.',
          existingOracle: 'packages/desktop/test/e2e/editor-undo.spec.ts',
          productionPathTest: 'planned: installed Core-mode undo/redo parity',
          status: 'planned'
        }]
      }
    )).not.toThrow()
  })

  it.each(artifactSchemaCases)(
    'rejects a wrong $artifact schema',
    ({ validate, expected }) => {
      expect(() => validate('wrong-schema')).toThrow(expected)
    }
  )

  it.each(artifactSchemaCases)(
    'rejects a missing $artifact schema',
    ({ validate, expected }) => {
      expect(() => validate()).toThrow(expected)
    }
  )

  it.each([
    {
      artifact: 'baseline',
      validate: () => validateCriticMarkupParityDispositions(
        null as unknown as typeof baseline,
        {
          schema: 'marktext-criticmarkup-parity-dispositions-v1',
          baselineCommit,
          dispositions: {}
        },
        emptyRows
      ),
      expected: /CriticMarkup parity baseline schema is invalid/
    },
    {
      artifact: 'disposition overlay',
      validate: () => validateCriticMarkupParityDispositions(
        baseline,
        null as unknown as CriticMarkupParityDispositionOverlay,
        emptyRows
      ),
      expected: /Parity disposition overlay schema is invalid/
    },
    {
      artifact: 'row manifest',
      validate: () => validateCriticMarkupParityDispositions(
        baseline,
        {
          schema: 'marktext-criticmarkup-parity-dispositions-v1',
          baselineCommit,
          dispositions: {}
        },
        null as unknown as CriticMarkupParityRowManifest
      ),
      expected: /Parity row manifest schema is invalid/
    }
  ])('rejects a missing $artifact at the runtime boundary', ({ validate, expected }) => {
    expect(validate).toThrow(expected)
  })

  it.each([
    {
      violation: 'duplicate human-owned row IDs',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [validRow, validRow],
      expected: /Parity row ID is missing or duplicated/
    },
    {
      violation: 'an orphan human-owned row',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [
        validRow,
        { ...validRow, id: 'orphan.row' }
      ],
      expected: /Parity row orphan.row is not referenced/
    },
    {
      violation: 'a missing existing oracle',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [
        { ...validRow, existingOracle: '' }
      ],
      expected: /requires an existing oracle/
    },
    {
      violation: 'a missing production-path test',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [
        { ...validRow, productionPathTest: '' }
      ],
      expected: /requires a production-path test/
    },
    {
      violation: 'an invalid row status',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [{
        ...validRow,
        status: 'greenish'
      }],
      expected: /has invalid status greenish/
    }
  ])('rejects $violation', ({ rows, expected }) => {
    const { overlay, validRow } = completeParityRowFixture()
    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit,
      rows: rows(validRow)
    })).toThrow(expected)
  })

  it('rejects an invalid parity disposition kind', () => {
    const { overlay, validRow } = completeParityRowFixture()
    overlay.dispositions['command:edit.undo'] = {
      kind: 'bogus',
      ref: 'editing.undo'
    } as unknown as CriticMarkupParityDisposition
    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit,
      rows: [validRow]
    })).toThrow(/has invalid kind bogus/)
  })
})
