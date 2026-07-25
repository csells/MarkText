import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Exact round-trip over every real document in this repository.
 *
 * "The engine preserves exact source" (ADR-0005, ADR-0007) is a claim about
 * every document a user has, not about the fixtures written to test it. Before
 * editing authority moves to this engine, the claim needs evidence from
 * documents nobody wrote for it — and this repository is full of them: specs,
 * ADRs, changelogs, READMEs, generated release notes, with CRLF, tabs, HTML,
 * code fences, tables, footnotes and unicode.
 *
 * A document that fails to round trip here is a document that would be silently
 * rewritten on save, which is the failure that matters most.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

const repoRoot = path.resolve(__dirname, '../../../..')

function collectMarkdown(directory: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue
    }
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectMarkdown(full, found)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      found.push(full)
    }
  }
  return found
}

const documents = collectMarkdown(repoRoot)

describe('real document corpus', () => {
  it('found a corpus worth testing against', () => {
    // Guards the suite itself: if collection ever broke, the rows below would
    // pass vacuously and report evidence that was never gathered.
    expect(documents.length).toBeGreaterThan(100)
  })

  it('reproduces every document byte for byte', () => {
    const engine = createLanguageEngine()
    const failures: string[] = []
    for (const file of documents) {
      const source = fs.readFileSync(file, 'utf8')
      const revision = engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
      if (revision.kind !== 'complete') {
        failures.push(`${path.relative(repoRoot, file)}: source-only`)
        continue
      }
      if (revision.source.text !== source) {
        failures.push(`${path.relative(repoRoot, file)}: source changed`)
      }
    }
    expect(failures).toEqual([])
  })

  it('reproduces every document through the editing view the editor mounts', () => {
    // The editing view is what a WYSIWYG tab renders, so it has to describe the
    // same document — not merely parse without error.
    const engine = createLanguageEngine()
    const failures: string[] = []
    for (const file of documents) {
      const source = fs.readFileSync(file, 'utf8')
      const revision = engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
      if (revision.kind !== 'complete') {
        continue
      }
      const editing = revision.projection('editing')
      // With no CriticMarkup the editing view IS the source; these documents
      // are ordinary Markdown, so any difference is the engine changing text it
      // was asked only to read.
      if (revision.criticMarkup.rootCount === 0 && editing.source !== source) {
        failures.push(path.relative(repoRoot, file))
      }
    }
    expect(failures).toEqual([])
  })
})
