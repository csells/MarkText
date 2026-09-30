import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const PROFILE_PATH = 'specs/language/marktext-markdown-profile-1.md'
const PROFILE_2_PATHS = [
  'specs/language/marktext-criticmarkup-profile-2.md',
  'specs/language/marktext-markdown-profile-2.md'
] as const
// A test that executes a Profile 2 rule is a unit spec a gate runs.
const PROFILE_2_TEST_FILE = /^packages\/(?:document-core\/test|desktop\/test\/unit\/specs)\/[\w.-]+\.spec\.ts$/u
const GOVERNANCE_ONLY_RULES = new Set(['P5', 'E3', 'Y2', 'Y3'])
const CASE_OPERATIONS = new Set([
  'parse',
  'parse-and-round-trip',
  'parse-and-project-revised',
  'project-original-and-revised',
  'project-comment',
  'parse-with-resource-limit',
  'parse-and-project',
  'project-then-read-source',
  'project-with-coordinates',
  'accept-and-reject',
  'derive-review-presentation',
  'parse-every-prefix',
  'parse-with-diagnostics',
  'open-with-profile-identifiers'
])

const recordOf = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const nonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

const markdownHeadingAnchors = (source: string): Set<string> => {
  const anchors = new Set<string>()
  const occurrences = new Map<string, number>()
  for (const line of source.split(/\r?\n/u)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/u)?.[1]
    if (heading === undefined) continue
    const base = heading
      .toLocaleLowerCase('en')
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .trim()
      .replace(/\s+/gu, '-')
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)
    anchors.add(occurrence === 0 ? base : `${base}-${occurrence}`)
  }
  return anchors
}

const repoMarkdownReferenceResolves = (repoRoot: string, ref: string): boolean => {
  const separator = ref.indexOf('#')
  if (separator <= 0 || separator === ref.length - 1 || ref.indexOf('#', separator + 1) >= 0) {
    return false
  }
  const path = ref.slice(0, separator)
  const anchor = ref.slice(separator + 1)
  if (isAbsolute(path)) return false
  const absolutePath = resolve(repoRoot, path)
  const pathWithinRepo = relative(repoRoot, absolutePath)
  if (pathWithinRepo.startsWith('..') || isAbsolute(pathWithinRepo)) return false
  try {
    return markdownHeadingAnchors(readFileSync(absolutePath, 'utf8')).has(anchor)
  } catch {
    return false
  }
}

export const extractCriticMarkupProfileRuleIds = (profile: string): string[] => {
  const ids = new Set<string>()
  for (const line of profile.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*-\s+\*\*((?:CM|[A-Z])[0-9]+[a-z]?)(?:\.|\s| —)/u
    )
    const id = match?.[1]
    if (id !== undefined && !id.startsWith('D')) {
      if (ids.has(id)) throw new Error(`Profile 1 has duplicate normative rule ID ${id}`)
      ids.add(id)
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
}

/** Profile 2 documents name each rule in a heading: `## L2c — …` or `### IL1 — …`. */
export const extractProfile2RuleIds = (document: string): string[] => {
  const ids: string[] = []
  for (const line of document.split(/\r?\n/u)) {
    const id = line.match(/^#{2,3} ([A-Z]+[0-9]+[a-z]?) — /u)?.[1]
    if (id === undefined) continue
    if (ids.includes(id)) throw new Error(`Profile 2 document has duplicate rule ID ${id}`)
    ids.push(id)
  }
  return ids
}

const quotedTitles = (source: string): Set<string> => {
  const titles = new Set<string>()
  for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/gu)) {
    titles.add((match[2] ?? '').replace(/\\(.)/gu, '$1'))
  }
  return titles
}

function validateProfile2Documents(repoRoot: string, value: unknown): void {
  if (!Array.isArray(value)) throw new Error('Profile 2 documents must be an array')
  const documents = value.map((item, index) => recordOf(item, `Profile 2 document ${index}`))
  const paths = documents.map((document, index) => nonEmptyString(document.path, `Profile 2 document ${index} path`))
  if (paths.length !== PROFILE_2_PATHS.length || PROFILE_2_PATHS.some(path => !paths.includes(path))) {
    throw new Error(`Profile 2 documents must be exactly ${PROFILE_2_PATHS.join(' and ')}`)
  }
  const titlesByFile = new Map<string, Set<string>>()
  for (const [index, document] of documents.entries()) {
    const path = nonEmptyString(document.path, `Profile 2 document ${index} path`)
    const text = readFileSync(resolve(repoRoot, path), 'utf8')
    if (document.sha256 !== createHash('sha256').update(text).digest('hex')) {
      throw new Error(`Profile conformance map targets a different revision of ${path}`)
    }
    const expectedIds = extractProfile2RuleIds(text)
    if (expectedIds.length === 0) throw new Error(`${path} names no rules`)
    if (!Array.isArray(document.rules)) throw new Error(`${path} rule mappings must be an array`)
    const rules = document.rules.map((value, ruleIndex) => {
      const rule = recordOf(value, `${path} rule mapping ${ruleIndex}`)
      return { id: nonEmptyString(rule.id, `${path} rule mapping ${ruleIndex} id`), rule }
    })
    const mappedIds = rules.map(({ id }) => id)
    if (new Set(mappedIds).size !== mappedIds.length) throw new Error(`${path} rule mappings contain duplicates`)
    const missing = expectedIds.filter(id => !mappedIds.includes(id))
    if (missing.length > 0) throw new Error(`${missing.length} missing ${path} rule mappings: ${missing.join(', ')}`)
    const stale = mappedIds.filter(id => !expectedIds.includes(id))
    if (stale.length > 0) throw new Error(`${stale.length} stale ${path} rule mappings: ${stale.join(', ')}`)
    for (const { id, rule } of rules) {
      if (!Array.isArray(rule.tests) || rule.tests.length === 0) {
        throw new Error(`${path} rule ${id} requires a test that executes it`)
      }
      for (const [testIndex, testValue] of rule.tests.entries()) {
        const test = recordOf(testValue, `${path} rule ${id} test ${testIndex}`)
        const file = nonEmptyString(test.file, `${path} rule ${id} test file`)
        const name = nonEmptyString(test.name, `${path} rule ${id} test name`)
        if (!PROFILE_2_TEST_FILE.test(file) || !existsSync(resolve(repoRoot, file))) {
          throw new Error(`${path} rule ${id} test file ${file} is not a gated unit spec`)
        }
        let titles = titlesByFile.get(file)
        if (titles === undefined) {
          titles = quotedTitles(readFileSync(resolve(repoRoot, file), 'utf8'))
          titlesByFile.set(file, titles)
        }
        if (!titles.has(name)) throw new Error(`${path} rule ${id} names a test ${file} does not define: ${name}`)
      }
    }
  }
}

/**
 * Validate only the pinned draft map's structure and evidence links.
 * This function neither reviews expected results nor executes conformance cases.
 * Historical tooling: plan 0011 supersedes this packet as a completion gate.
 */
export function validateCriticMarkupProfileConformance(
  repoRoot: string,
  value: unknown
): void {
  const manifest = recordOf(value, 'Profile conformance map')
  if (manifest.schema !== 'marktext-criticmarkup-profile-conformance-v2') {
    throw new Error('Profile conformance map schema is unsupported')
  }
  if (manifest.status !== 'structural-draft-unratified') {
    throw new Error('Profile conformance map must remain structural-draft-unratified')
  }
  const profileRecord = recordOf(manifest.profile, 'Profile identity')
  if (profileRecord.path !== PROFILE_PATH) {
    throw new Error(`Profile conformance map must target ${PROFILE_PATH}`)
  }
  const profile = readFileSync(resolve(repoRoot, PROFILE_PATH), 'utf8')
  const digest = createHash('sha256').update(profile).digest('hex')
  if (profileRecord.sha256 !== digest) {
    throw new Error('Profile conformance map targets a different Profile 1 revision')
  }
  const expectedIds = extractCriticMarkupProfileRuleIds(profile)
  if (expectedIds.length !== 44) {
    throw new Error(`Profile 1 rule extractor found ${expectedIds.length} rules instead of 44`)
  }

  if (!Array.isArray(manifest.rules)) throw new Error('Profile rule mappings must be an array')
  const rules = manifest.rules.map((value, index) => {
    const rule = recordOf(value, `Profile rule mapping ${index}`)
    return { id: nonEmptyString(rule.id, `Profile rule mapping ${index} id`), rule }
  })
  const mappedIds = new Set(rules.map(({ id }) => id))
  if (mappedIds.size !== rules.length) throw new Error('Profile rule mappings contain duplicates')
  const missing = expectedIds.filter(id => !mappedIds.has(id))
  if (missing.length > 0) {
    throw new Error(`${missing.length} missing Profile 1 rule mappings: ${missing.join(', ')}`)
  }
  const stale = [...mappedIds].filter(id => !expectedIds.includes(id))
  if (stale.length > 0) {
    throw new Error(`${stale.length} stale Profile 1 rule mappings: ${stale.join(', ')}`)
  }

  if (!Array.isArray(manifest.cases)) throw new Error('Profile cases must be an array')
  const cases = new Map<string, Record<string, unknown>>()
  for (const [index, value] of manifest.cases.entries()) {
    const candidate = recordOf(value, `Profile case ${index}`)
    const id = nonEmptyString(candidate.id, `Profile case ${index} id`)
    if (cases.has(id)) throw new Error(`Duplicate Profile case ${id}`)
    const operation = nonEmptyString(candidate.operation, `Profile case ${id} operation`)
    if (!CASE_OPERATIONS.has(operation)) {
      throw new Error(`Profile case ${id} operation is unsupported`)
    }
    nonEmptyString(candidate.input, `Profile case ${id} input`)
    nonEmptyString(candidate.provenance, `Profile case ${id} provenance`)
    if (
      candidate.status !== 'proposed-unreviewed' &&
      candidate.status !== 'reviewed'
    ) {
      throw new Error(`Profile case ${id} status is unsupported`)
    }
    if (candidate.status === 'reviewed') {
      if (candidate.reviewEvidence === undefined) {
        throw new Error(`Reviewed Profile case ${id} requires independent review evidence`)
      }
      const review = recordOf(
        candidate.reviewEvidence,
        `Reviewed Profile case ${id} independent review evidence`
      )
      nonEmptyString(review.reviewer, `Reviewed Profile case ${id} reviewer`)
      const reviewedAt = nonEmptyString(review.reviewedAt, `Reviewed Profile case ${id} review date`)
      if (Number.isNaN(Date.parse(reviewedAt))) {
        throw new Error(`Reviewed Profile case ${id} review date is invalid`)
      }
      const reviewRef = nonEmptyString(
        review.ref,
        `Reviewed Profile case ${id} review reference`
      )
      if (!repoMarkdownReferenceResolves(repoRoot, reviewRef)) {
        throw new Error(`Reviewed Profile case ${id} review reference does not resolve`)
      }
    }
    const observable = recordOf(
      candidate.expectedObservable,
      `Profile case ${id} expectedObservable`
    )
    if (Object.keys(observable).length === 0) {
      throw new Error(`Profile case ${id} expectedObservable must name at least one result`)
    }
    try {
      if (JSON.stringify(observable) === undefined) throw new Error('undefined')
      structuredClone(observable)
    } catch {
      throw new Error(`Profile case ${id} expectedObservable must be a detached literal object`)
    }
    cases.set(id, candidate)
  }

  const referencedCases = new Set<string>()
  for (const { id, rule } of rules) {
    const caseIds = Array.isArray(rule.cases) ? rule.cases : []
    const evidence = Array.isArray(rule.governanceEvidence)
      ? rule.governanceEvidence
      : []
    if (!GOVERNANCE_ONLY_RULES.has(id) && caseIds.length === 0) {
      throw new Error(`Semantic Profile rule ${id} requires a conformance case`)
    }
    if (caseIds.length === 0 && evidence.length === 0) {
      throw new Error(`Profile rule ${id} requires a case or governance evidence`)
    }
    for (const caseIdValue of caseIds) {
      const caseId = nonEmptyString(caseIdValue, `Profile rule ${id} case reference`)
      if (!cases.has(caseId)) throw new Error(`Profile rule ${id} references missing case ${caseId}`)
      referencedCases.add(caseId)
    }
    for (const [index, value] of evidence.entries()) {
      const item = recordOf(value, `Profile rule ${id} governance evidence ${index}`)
      const ref = nonEmptyString(item.ref, `Profile rule ${id} governance evidence ref`)
      if (!repoMarkdownReferenceResolves(repoRoot, ref)) {
        throw new Error(`Profile rule ${id} governance evidence ref does not resolve`)
      }
      nonEmptyString(item.rationale, `Profile rule ${id} governance evidence rationale`)
    }
  }
  const unreferenced = [...cases.keys()].filter(id => !referencedCases.has(id))
  if (unreferenced.length > 0) {
    throw new Error(`Unreferenced Profile cases: ${unreferenced.join(', ')}`)
  }
  validateProfile2Documents(repoRoot, manifest.profile2)
}
