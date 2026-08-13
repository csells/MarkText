export interface StandardsFixtureRow {
  readonly id: number
  readonly section: string
  readonly markdown: string
  readonly html?: string
}

export interface PinnedStandardsOracle {
  readonly standard: 'CommonMark' | 'GFM'
  readonly version: string
  readonly expectedRows: number
  readonly oracleSource: string
  readonly inputs: readonly StandardsFixtureRow[]
  readonly oracle: readonly StandardsFixtureRow[]
}

export interface StandardsSemanticCoverage {
  readonly standard: PinnedStandardsOracle['standard']
  readonly version: string
  readonly totalRows: number
  readonly semanticRows: number
}

/**
 * The repository-pinned GFM extraction renders U+0009 as U+2192 so tabs stay
 * visible in JSON review. Restore the machine-readable standard value before
 * comparing either Markdown input or expected HTML.
 */
export const normalizePinnedGfmVisibleTabs = (value: string): string =>
  value.replaceAll('→', '\t')

export const standardsSemanticCoverage = (
  standard: PinnedStandardsOracle['standard'],
  version: string,
  rows: readonly StandardsFixtureRow[]
): StandardsSemanticCoverage => ({
  standard,
  version,
  totalRows: rows.length,
  semanticRows: rows.filter(row => typeof row.html === 'string').length
})

export const validatePinnedStandardsOracle = (
  fixture: PinnedStandardsOracle
): StandardsSemanticCoverage => {
  if (!fixture.oracleSource.trim()) {
    throw new Error(`${fixture.standard} ${fixture.version} has no external oracle source`)
  }
  if (fixture.inputs.length !== fixture.expectedRows) {
    throw new Error(
      `${fixture.standard} ${fixture.version} has ${String(fixture.inputs.length)}` +
      ` input rows; expected ${String(fixture.expectedRows)}`
    )
  }

  const inputs = rowsById(fixture, 'input', fixture.inputs)
  const oracle = rowsById(fixture, 'oracle', fixture.oracle)
  const expectedIds = Array.from(
    { length: fixture.expectedRows },
    (_, index) => index + 1
  )
  const missingHtml = expectedIds.filter(id => {
    const row = oracle.get(id)
    return row === undefined || typeof row.html !== 'string'
  })

  if (missingHtml.length > 0) {
    throw new Error(
      `${fixture.standard} ${fixture.version} is missing official html for ` +
      `${String(missingHtml.length)} rows: ${missingHtml.join(', ')}`
    )
  }

  const unexpectedIds = [...oracle.keys()].filter(id => !inputs.has(id)).sort((a, b) => a - b)
  if (unexpectedIds.length > 0) {
    throw new Error(
      `${fixture.standard} ${fixture.version} has stale oracle IDs: ${unexpectedIds.join(', ')}`
    )
  }

  for (const id of expectedIds) {
    const input = inputs.get(id)
    const expected = oracle.get(id)
    if (input === undefined) {
      throw new Error(`${fixture.standard} ${fixture.version} is missing input ID ${String(id)}`)
    }
    if (expected === undefined) {
      // The missing-html diagnostic above owns absent oracle rows.
      continue
    }
    if (expected.section !== input.section) {
      throw new Error(
        `${fixture.standard} ${fixture.version} row ${String(id)} section does not match the pinned input`
      )
    }
    if (expected.markdown !== input.markdown) {
      throw new Error(
        `${fixture.standard} ${fixture.version} row ${String(id)} markdown does not match the pinned input`
      )
    }
  }

  return {
    standard: fixture.standard,
    version: fixture.version,
    totalRows: fixture.expectedRows,
    semanticRows: fixture.expectedRows
  }
}

const rowsById = (
  fixture: PinnedStandardsOracle,
  role: 'input' | 'oracle',
  rows: readonly StandardsFixtureRow[]
): ReadonlyMap<number, StandardsFixtureRow> => {
  const byId = new Map<number, StandardsFixtureRow>()
  for (const row of rows) {
    if (!Number.isInteger(row.id) || row.id < 1) {
      throw new Error(
        `${fixture.standard} ${fixture.version} ${role} has invalid ID ${String(row.id)}`
      )
    }
    if (byId.has(row.id)) {
      throw new Error(
        `${fixture.standard} ${fixture.version} ${role} duplicates ID ${String(row.id)}`
      )
    }
    byId.set(row.id, row)
  }
  return byId
}
