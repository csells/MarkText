import {
  createLanguageEngine,
  createSourceSnapshot,
  createTransformationKernel,
  type ParseConfiguration
} from '../../src/index.js'

const MAXIMUM_SOURCE_UNITS = 32_000_000
const change = '{++A++}'
// Keep the changed node in its own parser region and the large unchanged tail
// in one literal. This exercises sparse transformation of the admitted 32M
// source without turning the fixture into a test of paragraph lookahead.
const prefix = `${change}\n\n\``
const suffix = '`'
const source = prefix +
  'x'.repeat(MAXIMUM_SOURCE_UNITS - prefix.length - suffix.length) +
  suffix
const configuration: ParseConfiguration = {
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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

const engine = createLanguageEngine()
const revision = engine.open(createSourceSnapshot(source), configuration)
if (revision.kind !== 'complete') {
  throw new Error('Maximum transformation fixture did not open Complete')
}
const target = revision.criticMarkup.rootAt(0)
const result = createTransformationKernel(engine).apply(revision, {
  kind: 'resolve-change',
  target: target.nodeId,
  decision: 'accept'
})
if (result.kind !== 'committed') {
  throw new Error(`Maximum transformation was rejected: ${result.reason}`)
}
const expectedLength = MAXIMUM_SOURCE_UNITS - change.length + 1
if (
  result.revision.source.text.length !== expectedLength ||
  !result.revision.source.text.startsWith('A\n\n') ||
  !result.revision.source.text.endsWith(suffix) ||
  result.edits.length !== 1
) {
  throw new Error('Maximum transformation did not preserve exact source')
}
process.stdout.write(`${JSON.stringify({
  kind: result.kind,
  sourceLength: result.revision.source.text.length,
  editCount: result.edits.length,
  maxRssKiB: process.resourceUsage().maxRSS
})}\n`)
