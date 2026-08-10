import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collectCriticMarkupParityBaseline,
  type CriticMarkupParityDispositionOverlay,
  validateCriticMarkupParityDispositions
} from '../../../../../scripts/criticmarkupParityBaseline'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const baselineCommit = '43bd8b77795fb27b1a9512737c000f7362031ea0'
const baseline = collectCriticMarkupParityBaseline(repoRoot, baselineCommit)

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

    expect(() => validateCriticMarkupParityDispositions(baseline, overlay)).toThrow(
      /829 upstream parity items are undisposed/
    )
  })

  it('rejects stale or unsubstantiated dispositions', () => {
    const dispositions = Object.fromEntries(baseline.items.map(entry => [
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

    expect(() => validateCriticMarkupParityDispositions(baseline, overlay)).toThrow(
      /1 stale parity disposition/
    )

    delete overlay.dispositions['command:removed-upstream-command']
    overlay.dispositions[baseline.items[0].id] = { kind: 'unaffected' }
    expect(() => validateCriticMarkupParityDispositions(baseline, overlay)).toThrow(
      /requires a rationale/
    )
  })
})
