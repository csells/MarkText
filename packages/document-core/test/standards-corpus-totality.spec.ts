import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createDocumentCore } from '../src/index.js'

interface MarkdownExample {
  readonly example: number
  readonly section: string
  readonly markdown: string
}

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(
    new URL(`fixtures/${name}`, import.meta.url),
    'utf8'
  )) as T
}

function expectExactTotality(
  corpus: string,
  examples: readonly MarkdownExample[]
): void {
  const core = createDocumentCore()

  for (const example of examples) {
    try {
      const revision = core.open(example.markdown)
      expect(revision.source).toBe(example.markdown)
      expect(core.project(revision, 'original').markdown).toBe(example.markdown)
      expect(core.project(revision, 'revised').markdown).toBe(example.markdown)
    } catch (error) {
      throw new Error(
        `${corpus} example ${String(example.example)} (${example.section}) failed`,
        { cause: error }
      )
    }
  }
}

describe('standards corpus totality', () => {
  it('opens every CommonMark 0.31.2 example without source drift', async() => {
    const examples = await fixture<readonly MarkdownExample[]>(
      'commonmark-0.31.2-spec.json'
    )

    expect(examples).toHaveLength(652)
    expectExactTotality('CommonMark', examples)
  })

  it('opens every GFM 0.29 example without source drift', async() => {
    const corpus = await fixture<{
      readonly examples: readonly MarkdownExample[]
    }>('gfm-0.29-spec.json')

    expect(corpus.examples).toHaveLength(672)
    expectExactTotality('GFM', corpus.examples)
  })
})
