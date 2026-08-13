import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  type StandardsFixtureRow,
  normalizePinnedGfmVisibleTabs,
  standardsSemanticCoverage,
  validatePinnedStandardsOracle
} from './support/standardsSemanticOracle.js'

interface DocumentCoreFixtureRow {
  readonly example: number
  readonly section: string
  readonly markdown: string
  readonly html?: string
}

interface MuyaGfmFixtureRow {
  readonly number: number
  readonly section: string
  readonly markdown: string
  readonly html: string
}

const fixture = async <T>(url: URL): Promise<T> =>
  JSON.parse(await readFile(url, 'utf8')) as T

const rowOf = (row: DocumentCoreFixtureRow): StandardsFixtureRow => ({
  id: row.example,
  section: row.section,
  markdown: row.markdown,
  ...(row.html === undefined ? {} : { html: row.html })
})

describe('pinned standards semantic oracles', () => {
  it('restores visible-tab tokens in both GFM input and expected HTML', () => {
    expect(normalizePinnedGfmVisibleTabs('a→b')).toBe('a\tb')
    expect(normalizePinnedGfmVisibleTabs('<p>→foo</p>\n'))
      .toBe('<p>\tfoo</p>\n')
  })

  it('reports totality-only rows as missing semantic coverage by exact GFM ID', async() => {
    const commonMark = await fixture<readonly DocumentCoreFixtureRow[]>(
      new URL('fixtures/commonmark-0.31.2-spec.json', import.meta.url)
    )
    const gfm = await fixture<{
      readonly examples: readonly DocumentCoreFixtureRow[]
    }>(new URL('fixtures/gfm-0.29-spec.json', import.meta.url))

    expect(standardsSemanticCoverage(
      'CommonMark',
      '0.31.2',
      commonMark.map(rowOf)
    )).toMatchObject({ totalRows: 652, semanticRows: 652 })
    expect(standardsSemanticCoverage(
      'GFM',
      '0.29',
      gfm.examples.map(rowOf)
    )).toMatchObject({ totalRows: 672, semanticRows: 0 })

    expect(() => validatePinnedStandardsOracle({
      standard: 'GFM',
      version: '0.29',
      expectedRows: 672,
      oracleSource: 'packages/document-core/test/fixtures/gfm-0.29-spec.json',
      inputs: gfm.examples.map(rowOf),
      oracle: gfm.examples.map(rowOf)
    })).toThrow(/GFM 0\.29 is missing official html for 672 rows: 1, 2, 3, .* 672/u)
  })

  it('accepts the repository-pinned external CommonMark and GFM HTML oracles', async() => {
    const commonMark = await fixture<readonly DocumentCoreFixtureRow[]>(
      new URL('fixtures/commonmark-0.31.2-spec.json', import.meta.url)
    )
    const gfm = await fixture<{
      readonly examples: readonly DocumentCoreFixtureRow[]
    }>(new URL('fixtures/gfm-0.29-spec.json', import.meta.url))
    const gfmOracle = await fixture<readonly MuyaGfmFixtureRow[]>(new URL(
      '../../muya/test/spec/fixtures/gfm-spec-0.29-gfm.json',
      import.meta.url
    ))

    expect(validatePinnedStandardsOracle({
      standard: 'CommonMark',
      version: '0.31.2',
      expectedRows: 652,
      oracleSource: 'CommonMark 0.31.2 spec.txt',
      inputs: commonMark.map(rowOf),
      oracle: commonMark.map(rowOf)
    })).toMatchObject({ totalRows: 652, semanticRows: 652 })
    expect(validatePinnedStandardsOracle({
      standard: 'GFM',
      version: '0.29',
      expectedRows: 672,
      oracleSource: 'packages/muya/test/spec/fixtures/gfm-spec-0.29-gfm.json',
      inputs: gfm.examples.map(rowOf),
      oracle: gfmOracle.map(row => ({
        id: row.number,
        section: row.section,
        markdown: normalizePinnedGfmVisibleTabs(row.markdown),
        html: normalizePinnedGfmVisibleTabs(row.html)
      }))
    })).toMatchObject({ totalRows: 672, semanticRows: 672 })
  })
})
