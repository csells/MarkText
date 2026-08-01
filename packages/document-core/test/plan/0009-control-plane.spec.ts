import { listRepositoryFiles } from '../helpers/repositoryFiles.js'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type Status = 'red' | 'green'
type TargetKind = 'test' | 'workflow'

interface Target {
  readonly kind: TargetKind
  readonly path: string
  readonly title: string
}

interface Phase {
  readonly id: string
  readonly status: Status
  readonly dependsOn: readonly string[]
  readonly requirements: readonly string[]
  readonly target: Target
}

interface Closure {
  readonly id: string
  readonly phase: string
  readonly status: Status
  readonly target: Target
}

interface ExitGates {
  readonly schema: string
  readonly plan: string
  readonly phases: readonly Phase[]
  readonly closure: readonly Closure[]
}

interface Acceptance {
  readonly id: string
  readonly requirement: string
  readonly phase: string
  readonly status: Status
  readonly target: Target
  readonly auxiliaryTargets?: readonly Target[]
}

interface AcceptanceManifest {
  readonly schema: string
  readonly plan: string
  readonly acceptance: readonly Acceptance[]
}

interface TsvRow {
  readonly [column: string]: string
}

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)
const MIGRATION_ROOT = resolve(REPO_ROOT, 'specs/migration')
const VITEST_CLI = resolve(REPO_ROOT, 'node_modules/vitest/vitest.mjs')
const PLAYWRIGHT_CLI = resolve(
  REPO_ROOT,
  'node_modules/@playwright/test/cli.js'
)

const EXACT_PHASE_DAG: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    P0: Object.freeze([]),
    'P0.5': Object.freeze(['P0']),
    P1: Object.freeze(['P0.5']),
    P2: Object.freeze(['P1']),
    P3: Object.freeze(['P2']),
    P4: Object.freeze(['P3']),
    P5: Object.freeze(['P4']),
    P6: Object.freeze(['P5']),
    P7: Object.freeze(['P6']),
    P8: Object.freeze(['P7']),
    P9: Object.freeze(['P8']),
    P11: Object.freeze(['P9']),
    P10: Object.freeze(['P9', 'P11'])
  })

const rangeIds = (prefix: string, count: number): readonly string[] =>
  Object.freeze(
    Array.from(
      { length: count },
      (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`
    )
  )

const EXACT_ACCEPTANCE_IDS = rangeIds('A', 42)
const EXACT_CLOSURE_IDS = rangeIds('D', 11)
const EXACT_ACCEPTANCE_AUXILIARY_TARGET_COUNTS:
Readonly<Record<string, number>> = Object.freeze({
  A21: 1
})

const EXACT_RETIRED_AUTHORITY_SEEDS: Readonly<Record<string, string>> = Object.freeze({
  L01: 'packages/muya/src/state/rebindCriticMarkupStateBindings.ts',
  L02: 'packages/muya/src/state/criticMarkupSerialization.ts',
  L03: 'packages/muya/src/state/mutationCapture.ts',
  L04: 'packages/muya/src/mutation/commentAnchorDeletion.ts',
  L05: 'packages/muya/src/criticMarkup/documentService.ts',
  L06: 'packages/muya/src/utils/marked/criticMarkupDocument.ts',
  L07: 'packages/muya/src/utils/marked/extensions/nativeCriticMarkup.ts',
  L08: 'packages/muya/src/history/index.ts',
  L09: 'packages/document-core/src/internal/session/revisionKernel.ts',
  L10: 'packages/document-core/src/internal/session/revisionTransition.ts'
})

const EXACT_SCRATCH_TESTS = Object.freeze([
  'packages/document-core/test/language-engine/__scratch-census.spec.ts',
  'packages/document-core/test/language-engine/__scratch-dbg.spec.ts'
])

const RETAINED_DOCUMENT_VIEW_TEST_ROOTS = Object.freeze([
  'packages/document-view/e2e/tests',
  'packages/document-view/src/documentCore/__tests__'
])

const REQUIRED_JSON_ARTIFACTS: Readonly<Record<string, string>> = Object.freeze({
  '0009-acceptance.yml': 'marktext-0009-acceptance-v1',
  '0009-exit-gates.yml': 'marktext-0009-exit-gates-v1',
  'authoring-eol-vectors.yml': 'marktext-authoring-eol-vectors-v1',
  'cm-diagnostics.yml': 'marktext-cm-diagnostics-v1',
  'cm-standard.yml': 'marktext-language-corpus-v1',
  'consumer-policy.yml': 'marktext-consumer-policy-v1',
  'file-corpus.yml': 'marktext-file-corpus-v1',
  'hash-vectors.yml': 'marktext-hash-vectors-v1',
  'malformed-recovery.yml': 'marktext-language-corpus-v1',
  'markdown-profile-1.yml': 'marktext-markdown-profile-manifest-v1',
  'performance-reuse-decision.yml':
    'marktext-performance-reuse-decision-v1',
  'profile1-corpora.yml': 'marktext-profile1-corpora-v1',
  'profile1-rulings.yml': 'marktext-language-corpus-v1',
  'syntax-accounting-1.yml': 'marktext-syntax-accounting-v1',
  'wire-envelope-v1.yml': 'marktext-wire-envelope-v1'
})

const REQUIRED_TSV_ARTIFACTS = Object.freeze([
  '0009-test-disposition.tsv',
  'criticmarkup-retired-authority-deletion.tsv',
  'track-changes-interactions.tsv'
])

const CONSUMER_VIEWS = Object.freeze(['markup', 'original', 'revised'])
const CONSUMERS = Object.freeze([
  'normal-copy',
  'copy-rich',
  'copy-html',
  'copy-markdown',
  'cut',
  'paste',
  'search',
  'replace',
  'count',
  'static-html',
  'styled-html',
  'pdf',
  'print',
  'persistence'
])

function readJsonYaml<T>(name: string): T {
  const path = resolve(MIGRATION_ROOT, name)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function readTsv(name: string): readonly TsvRow[] {
  const path = resolve(MIGRATION_ROOT, name)
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
  const header = lines[0]?.split('\t')
  if (header === undefined || new Set(header).size !== header.length) {
    throw new Error(`${name} needs one unique TSV header row`)
  }
  return Object.freeze(lines.slice(1).map((line): TsvRow => {
    const fields = line.split('\t')
    if (fields.length !== header.length) {
      throw new Error(`${name} has a row with ${String(fields.length)} fields`)
    }
    return Object.freeze(Object.fromEntries(
      header.map((column, index) => [column, fields[index] ?? ''])
    ))
  }))
}

function documentViewTestSuites(): readonly string[] {
  return listRepositoryFiles(
    REPO_ROOT,
    ['packages/document-view'],
    ['*.spec.ts', '*.test.ts']
  )
}

function expectExactIds(actual: readonly string[], expected: readonly string[]): void {
  expect(new Set(actual).size).toBe(actual.length)
  expect([...actual].sort()).toEqual([...expected].sort())
}

function expectTargetShape(target: Target): void {
  expect(['test', 'workflow']).toContain(target.kind)
  expect(target.path).toMatch(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+/)
  expect(target.path).toMatch(
    target.kind === 'test' ? /\.spec\.ts$/ : /\.ya?ml$/
  )
  expect(target.title.trim()).toBe(target.title)
  expect(target.title.length).toBeGreaterThan(0)
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = callName(expression.expression)
    return owner === undefined ? undefined : `${owner}.${expression.name.text}`
  }
  return undefined
}

function literalText(node: ts.Node | undefined): string | undefined {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined
}

function disabledAncestor(node: ts.Node): string | undefined {
  for (let cursor = node.parent; cursor !== undefined; cursor = cursor.parent) {
    if (!ts.isCallExpression(cursor)) {
      continue
    }
    const name = callName(cursor.expression)
    if (
      name !== undefined &&
      /\.(?:skip|fails?|fixme|todo|only)$/.test(name)
    ) {
      return name
    }
  }
  return undefined
}

interface RunnerCollectedTest {
  readonly file: string
  readonly title: string
}

interface PlaywrightSuite {
  readonly file?: string
  readonly specs?: readonly { readonly title?: string }[]
  readonly suites?: readonly PlaywrightSuite[]
}

const collectionCache = new Map<string, readonly RunnerCollectedTest[]>()

function commandJson(
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>> = {}
): unknown {
  try {
    return JSON.parse(execFileSync(
      process.execPath,
      [...args],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...environment },
        maxBuffer: 16 * 1024 * 1024
      }
    )) as unknown
  } catch {
    return []
  }
}

function vitestCollection(
  targetPath: string,
  packageRoot: string,
  configPath: string
): readonly RunnerCollectedTest[] {
  const absoluteTarget = resolve(REPO_ROOT, targetPath)
  const listed = commandJson(
    [
      VITEST_CLI,
      'list',
      relative(packageRoot, absoluteTarget),
      '--root',
      packageRoot,
      '--config',
      configPath,
      '--json',
      '--staticParse',
      '--allowOnly=false'
    ],
    packageRoot
  )
  if (!Array.isArray(listed)) return Object.freeze([])
  return Object.freeze(listed.flatMap((entry): RunnerCollectedTest[] => {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !('file' in entry) ||
      !('name' in entry) ||
      typeof entry.file !== 'string' ||
      typeof entry.name !== 'string'
    ) {
      return []
    }
    return [{
      file: resolve(entry.file),
      title: entry.name.split(' > ').at(-1) ?? entry.name
    }]
  }))
}

function playwrightCollection(
  targetPath: string,
  packageRoot: string,
  configPath: string,
  project: 'evidence-unpacked' | 'installed' | 'unpacked'
): readonly RunnerCollectedTest[] {
  const absoluteTarget = resolve(REPO_ROOT, targetPath)
  const listed = commandJson(
    [
      PLAYWRIGHT_CLI,
      'test',
      relative(packageRoot, absoluteTarget),
      '--config',
      configPath,
      '--list',
      '--forbid-only',
      `--project=${project}`,
      '--reporter=json'
    ],
    packageRoot,
    { MARKTEXT_TEST_BACKGROUND: '1' }
  ) as { readonly suites?: readonly PlaywrightSuite[] }
  const collected: RunnerCollectedTest[] = []
  const visit = (suite: PlaywrightSuite, inheritedFile?: string): void => {
    const file = suite.file ?? inheritedFile
    for (const spec of suite.specs ?? []) {
      if (file !== undefined && typeof spec.title === 'string') {
        collected.push({
          file: resolve(
            dirname(configPath),
            file
          ),
          title: spec.title
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child, file)
  }
  for (const suite of listed.suites ?? []) visit(suite)
  return Object.freeze(collected)
}

function configuredCollection(targetPath: string): readonly RunnerCollectedTest[] {
  const cached = collectionCache.get(targetPath)
  if (cached !== undefined) return cached

  let collected: readonly RunnerCollectedTest[]
  if (targetPath.startsWith('packages/document-core/')) {
    const packageRoot = resolve(REPO_ROOT, 'packages/document-core')
    collected = vitestCollection(
      targetPath,
      packageRoot,
      resolve(packageRoot, 'vitest.config.ts')
    )
  } else if (targetPath.startsWith('packages/desktop/test/unit/')) {
    const packageRoot = resolve(REPO_ROOT, 'packages/desktop')
    collected = vitestCollection(
      targetPath,
      packageRoot,
      resolve(packageRoot, 'vitest.config.ts')
    )
  } else if (targetPath.startsWith('packages/desktop/test/e2e/')) {
    const packageRoot = resolve(REPO_ROOT, 'packages/desktop')
    const specialist = new Set([
      'packages/desktop/test/e2e/document-core-hostile-sinks.spec.ts',
      'packages/desktop/test/e2e/export-pdf.spec.ts',
      'packages/desktop/test/e2e/xss.spec.ts',
      'packages/desktop/test/e2e/context-isolation.spec.ts',
      'packages/desktop/test/e2e/critic-markup-perf.spec.ts',
      'packages/desktop/test/e2e/document-core-max-document-perf.spec.ts'
    ])
    const project = targetPath.includes('/installed-')
      ? 'installed'
      : specialist.has(targetPath)
        ? 'unpacked'
        : 'evidence-unpacked'
    collected = playwrightCollection(
      targetPath,
      packageRoot,
      resolve(packageRoot, 'test/e2e/playwright.config.ts'),
      project
    )
  } else {
    throw new Error(`${targetPath} has no configured ordinary test runner`)
  }
  collectionCache.set(targetPath, collected)
  return collected
}

function expectOrdinaryCollectedTest(target: Target): void {
  const absolutePath = resolve(REPO_ROOT, target.path)
  expect(existsSync(absolutePath), `${target.path} must exist`).toBe(true)
  const source = readFileSync(absolutePath, 'utf8')
  const syntax = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const matches: Array<Readonly<{
    call: string
    disabledBy: string | undefined
  }>> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && literalText(node.arguments[0]) === target.title) {
      const name = callName(node.expression)
      if (name === 'it' || name === 'test' || name?.startsWith('it.') === true ||
        name?.startsWith('test.') === true) {
        matches.push(Object.freeze({
          call: name,
          disabledBy: disabledAncestor(node)
        }))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
  expect(matches, `${target.path} must collect exactly "${target.title}"`).toHaveLength(1)
  expect(matches[0]?.call).toMatch(/^(?:it|test)$/)
  expect(matches[0]?.disabledBy).toBeUndefined()
  const configuredMatches = configuredCollection(target.path).filter(
    (candidate) =>
      candidate.file === absolutePath &&
      candidate.title === target.title
  )
  expect(
    configuredMatches,
    `${target.path} must be selected by its configured runner`
  ).toHaveLength(1)
}

function expectResolvedGreenTarget(target: Target): void {
  expectTargetShape(target)
  if (target.kind === 'test') {
    expectOrdinaryCollectedTest(target)
    return
  }
  const absolutePath = resolve(REPO_ROOT, target.path)
  expect(existsSync(absolutePath), `${target.path} must exist`).toBe(true)
  const source = readFileSync(absolutePath, 'utf8')
  expect(source).toContain(`name: ${target.title}`)
  expect(source).not.toMatch(/\b(?:skip|xfail|fixme)\b/i)
}

describe('plan 0009 machine-checked control plane', () => {
  it('encodes the exact phase DAG and rejects orphan requirement IDs', () => {
    const exits = readJsonYaml<ExitGates>('0009-exit-gates.yml')
    const acceptance = readJsonYaml<AcceptanceManifest>('0009-acceptance.yml')

    expect(exits.schema).toBe('marktext-0009-exit-gates-v1')
    expect(acceptance.schema).toBe('marktext-0009-acceptance-v1')
    expect(exits.plan).toBe('0009')
    expect(acceptance.plan).toBe('0009')
    expectExactIds(exits.phases.map((phase) => phase.id), Object.keys(EXACT_PHASE_DAG))
    expectExactIds(
      acceptance.acceptance.map((item) => item.id),
      EXACT_ACCEPTANCE_IDS
    )
    expectExactIds(exits.closure.map((item) => item.id), EXACT_CLOSURE_IDS)

    const knownRequirements = new Set([
      ...EXACT_ACCEPTANCE_IDS,
      ...EXACT_CLOSURE_IDS
    ])
    const requirementById = new Map(
      [...acceptance.acceptance, ...exits.closure].map((item) => [item.id, item])
    )
    const referencedRequirements = exits.phases.flatMap(
      (phase) => phase.requirements
    )
    expectExactIds(referencedRequirements, [...knownRequirements])

    const phaseIds = new Set(exits.phases.map((phase) => phase.id))
    for (const phase of exits.phases) {
      expect(phase.dependsOn).toEqual(EXACT_PHASE_DAG[phase.id])
      expect(['red', 'green']).toContain(phase.status)
      expectTargetShape(phase.target)
      // P0 promises that every phase target is already a real, ordinarily
      // collected test or workflow even while its behavioral status is red.
      // A manifest-only placeholder would make the execution DAG fiction.
      expectResolvedGreenTarget(phase.target)
      for (const requirement of phase.requirements) {
        expect(knownRequirements.has(requirement)).toBe(true)
      }
      if (phase.status === 'green') {
        for (const dependency of phase.dependsOn) {
          expect(
            exits.phases.find((candidate) => candidate.id === dependency)?.status
          ).toBe('green')
        }
        for (const requirement of phase.requirements) {
          expect(requirementById.get(requirement)?.status).toBe('green')
        }
      }
    }

    for (const item of [...acceptance.acceptance, ...exits.closure]) {
      expect(phaseIds.has(item.phase)).toBe(true)
      expect(['red', 'green']).toContain(item.status)
      expectTargetShape(item.target)
      // Red means the named behavior is not yet satisfied; it does not permit
      // an absent file, an uncollected title, or a disabled test.
      expectResolvedGreenTarget(item.target)
      expect(
        exits.phases.find((phase) => phase.id === item.phase)?.requirements
      ).toContain(item.id)
      if (item.status === 'green') {
        expect(
          exits.phases.find((phase) => phase.id === item.phase)?.status
        ).toBe('green')
      }
    }

    for (const item of acceptance.acceptance) {
      const auxiliaryTargets = item.auxiliaryTargets ?? []
      expect(
        auxiliaryTargets,
        `${item.id} auxiliary target count`
      ).toHaveLength(EXACT_ACCEPTANCE_AUXILIARY_TARGET_COUNTS[item.id] ?? 0)
      for (const target of auxiliaryTargets) {
        expectResolvedGreenTarget(target)
      }
    }
  }, 30_000)

  it('rejects an expected failure as green acceptance evidence', () => {
    expect(() => {
      expectResolvedGreenTarget({
        kind: 'test',
        path: 'packages/document-core/test/language-engine/' +
          'one-criticmarkup-authority.spec.ts',
        title: 'step 2 target: exactly one recognition per open'
      })
    }).toThrow()
  })

  it('rejects a target excluded by its configured test runner', () => {
    const fixtureRoot = mkdtempSync(
      resolve(REPO_ROOT, 'packages/document-core/.plan-control-')
    )
    const fixturePath = resolve(fixtureRoot, 'excluded.spec.ts')
    writeFileSync(
      fixturePath,
      "import { it } from 'vitest'\nit('excluded target', () => {})\n",
      'utf8'
    )
    try {
      expect(() => {
        expectResolvedGreenTarget({
          kind: 'test',
          path: relative(REPO_ROOT, fixturePath),
          title: 'excluded target'
        })
      }).toThrow()
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('tracks every retired authority seed deletion', () => {
    const rows = readTsv('criticmarkup-retired-authority-deletion.tsv')
    expectExactIds(
      rows.map((row) => row.id ?? ''),
      Object.keys(EXACT_RETIRED_AUTHORITY_SEEDS)
    )
    for (const row of rows) {
      expect(row.path).toBe(EXACT_RETIRED_AUTHORITY_SEEDS[row.id ?? ''])
      expect(row.unreachable_phase).toBe('P9')
      expect(row.deletion_phase).toBe('P9')
      expect(['present', 'absent']).toContain(row.status)
      const exists = existsSync(resolve(REPO_ROOT, row.path ?? ''))
      expect(exists).toBe(row.status === 'present')
    }
  })

  it('gives every retired and retained suite one checked disposition', () => {
    const rows = readTsv('0009-test-disposition.tsv')
    const paths = rows.map((row) => row.path ?? '')
    expect(new Set(paths).size).toBe(paths.length)

    for (const row of rows) {
      expect(row.path).toMatch(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+/)
      expect(['delete', 'convert', 'retain', 'supersede'])
        .toContain(row.disposition)
      expect(Object.keys(EXACT_PHASE_DAG)).toContain(row.phase)
      expect(['pending', 'complete']).toContain(row.status)
      expect(row.reason?.trim().length).toBeGreaterThan(0)
      const exists = existsSync(resolve(REPO_ROOT, row.path ?? ''))
      if (row.disposition === 'delete') {
        expect(exists, row.path).toBe(row.status === 'pending')
      } else {
        expect(exists, row.path).toBe(true)
      }
    }

    for (const scratchPath of EXACT_SCRATCH_TESTS) {
      const row = rows.find((candidate) => candidate.path === scratchPath)
      expect(row, scratchPath).toMatchObject({
        disposition: 'delete',
        phase: 'P0',
        status: 'complete'
      })
    }

    for (const suite of documentViewTestSuites()) {
      const matchingRows = rows.filter((row) =>
        suite === row.path || suite.startsWith(`${row.path}/`)
      )
      expect(matchingRows, suite).toHaveLength(1)
      const retained = RETAINED_DOCUMENT_VIEW_TEST_ROOTS.some(
        (root) => suite.startsWith(`${root}/`)
      )
      expect(matchingRows[0]?.disposition, suite)
        .toBe(retained ? 'retain' : 'delete')
      expect(matchingRows[0]?.phase, suite).toBe('P9')
      expect(matchingRows[0]?.status, suite).toBe('complete')
    }
  })

  it('validates every normative migration artifact instead of trusting a filename', () => {
    for (const [name, schema] of Object.entries(REQUIRED_JSON_ARTIFACTS)) {
      expect(existsSync(resolve(MIGRATION_ROOT, name)), `${name} must exist`).toBe(true)
      expect(readJsonYaml<{ readonly schema: string }>(name).schema).toBe(schema)
    }
    for (const name of REQUIRED_TSV_ARTIFACTS) {
      expect(existsSync(resolve(MIGRATION_ROOT, name)), `${name} must exist`).toBe(true)
      expect(readTsv(name).length, `${name} must contain normative rows`).toBeGreaterThan(0)
    }

    const policy = readJsonYaml<{
      readonly cells: readonly {
        readonly view: string
        readonly consumer: string
        readonly behavior: string
      }[]
      readonly sourceMode: readonly {
        readonly consumer: string
        readonly behavior: string
      }[]
      readonly commentPolicy: readonly string[]
    }>('consumer-policy.yml')
    expectExactIds(
      policy.cells.map((cell) => `${cell.view}:${cell.consumer}`),
      CONSUMER_VIEWS.flatMap(
        (view) => CONSUMERS.map((consumer) => `${view}:${consumer}`)
      )
    )
    for (const cell of policy.cells) {
      expect(cell.behavior.trim().length).toBeGreaterThan(0)
    }
    expect(policy.sourceMode.map((cell) => cell.consumer).sort()).toEqual(
      [...CONSUMERS].sort()
    )
    expect(policy.commentPolicy.length).toBeGreaterThanOrEqual(4)

    const files = readJsonYaml<{
      readonly cases: readonly { readonly id: string }[]
    }>('file-corpus.yml')
    expectExactIds(
      files.cases.map((item) => item.id),
      [
        'utf8-no-bom-lf-no-final-eol',
        'utf8-bom-crlf',
        'utf16le-bom-cr',
        'utf16be-bom-mixed-eol',
        'astral-and-lone-surrogate'
      ]
    )

    const eol = readJsonYaml<{
      readonly vectors: readonly { readonly id: string }[]
    }>('authoring-eol-vectors.yml')
    expectExactIds(
      eol.vectors.map((item) => item.id),
      [
        'preceding-owner-wins',
        'following-owner-fallback',
        'document-majority',
        'document-tie-first-occurrence',
        'empty-document-lf',
        'crlf-is-one-token',
        'comment-payload-is-owner'
      ]
    )

    const diagnostics = readJsonYaml<{
      readonly diagnostics: readonly { readonly code: string }[]
    }>('cm-diagnostics.yml')
    expectExactIds(
      diagnostics.diagnostics.map((item) => item.code),
      [
        'CM_UNMATCHED_CLOSER',
        'CM_NON_TOP_CLOSER',
        'CM_UNTERMINATED_OPENER',
        'CM_SUBSTITUTION_SEPARATOR_MISSING'
      ]
    )

    const wire = readJsonYaml<{
      readonly maxChunkBytes: number
      readonly memberOrder: readonly string[]
      readonly vectors: readonly { readonly id: string }[]
    }>('wire-envelope-v1.yml')
    expect(wire.maxChunkBytes).toBe(262_144)
    expect(wire.memberOrder).toEqual([
      'livePlanDelta',
      'reviewDelta',
      'sessionDelta',
      'terminalOutcomeDelta'
    ])
    expectExactIds(
      wire.vectors.map((item) => item.id),
      [
        'empty-member',
        'below-boundary',
        'exact-boundary',
        'two-chunk',
        'all-members',
        'outcome-only'
      ]
    )

    const interactions = readTsv('track-changes-interactions.tsv')
    expect(new Set(interactions.map((row) => row.intent))).toEqual(
      new Set(['insert', 'delete', 'replace', 'format', 'structure', 'paste', 'ime'])
    )
    for (const row of interactions) {
      expect(row.expected_transform?.trim().length).toBeGreaterThan(0)
      expect(row.expected_undo?.trim().length).toBeGreaterThan(0)
    }
  })

  it('defines Comment as a lossless isolated subdocument rather than opaque text', () => {
    const specification = readFileSync(
      resolve(REPO_ROOT, 'specs/language/marktext-markdown-profile-1.md'),
      'utf8'
    )
    const commentRule = specification.match(
      /- \*\*R5\b[\s\S]*?(?=\n- \*\*R6\b)/
    )?.[0]

    expect(commentRule).toMatch(/isolated inline Profile 1 subdocument/i)
    expect(commentRule).toMatch(/preserved byte-exact/i)
    expect(commentRule).toMatch(/Inline Markdown/i)
    expect(commentRule).toMatch(/properly nested CriticMarkup/i)
    expect(specification).not.toMatch(/R5\s+—\s+Comment opacity/i)
    expect(specification).not.toMatch(/N2\b[^\n]*Nothing nests/i)
    expect(specification).not.toMatch(/Comments? (?:fully )?opaque/i)
  })
})
