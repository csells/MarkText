import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EditorIntent } from '@marktext/document-core'
import {
  INTENT_PREPARATIONS
} from '../../src/internal/session/intentPreparation.js'

const PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..'
)

// Worker members that are not intent preparers: facts warm-up and the one
// declared table entry point.
const NON_INTENT_PREPARERS = new Set([
  'prepareDocumentFacts',
  'prepareEditorIntent',
  'prepareForMarker',
  'preparePersistence'
])

// G8: adding an intent adds exactly one union arm and one table entry. A
// prepare* call outside the worker and its table would be a fourth reader
// of the intent seam — the dispatch-ladder shape this gap deletes.
describe('intent preparation has one authority', () => {
  it('routes every production prepare* call through the table', () => {
    const tracked = execFileSync('git', ['ls-files', '-z', 'src'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8'
    })
      .split('\0')
      .filter(path => path.endsWith('.ts'))
    const offenders: string[] = []
    for (const path of tracked) {
      if (
        path.endsWith('internal/session/revisionWorker.ts') ||
        path.endsWith('internal/session/intentPreparation.ts')
      ) {
        continue
      }
      const text = readFileSync(resolve(PACKAGE_ROOT, path), 'utf8')
      for (const match of text.matchAll(/\.(prepare[A-Z]\w*)\(/gu)) {
        if (!NON_INTENT_PREPARERS.has(match[1] ?? '')) {
          offenders.push(`${path}: ${match[1] ?? ''}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares a commit class for every union arm', () => {
    const kinds = Object.keys(INTENT_PREPARATIONS) as EditorIntent['kind'][]
    expect(kinds.length).toBeGreaterThanOrEqual(43)
    for (const kind of kinds) {
      const preparation = INTENT_PREPARATIONS[kind]
      if (preparation.commitClass === 'revision') {
        expect(typeof preparation.prepare, kind).toBe('function')
      } else {
        expect(preparation.commitClass, kind).toBe('session-state')
      }
    }
  })
})
