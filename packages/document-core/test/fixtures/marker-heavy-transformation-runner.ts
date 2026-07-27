import {
  createLanguageEngine,
  createSourceSnapshot,
  createTransformationKernel,
  DOCUMENT_RESOURCE_POLICY_V1,
  type ParseConfiguration
} from '../../src/index.js'

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

const changeCount =
  DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
// Accepting each inner addition supplies the final `}` of the outer-looking
// `{++body++}`. The candidate therefore contains one accidental close marker
// per edit; protection must escape all 16,384 changed joins in one ordered pass.
const sourcePattern = '{++body++{++}++}\n'
const expectedPattern = '{++body++\\}\n'
const source = sourcePattern.repeat(changeCount)
const engine = createLanguageEngine()
const revision = engine.open(createSourceSnapshot(source), configuration)
if (
  revision.kind !== 'complete' ||
  revision.criticMarkup.rootCount !== changeCount
) {
  throw new Error('Marker-heavy fixture did not open the expected changes')
}
const result = createTransformationKernel(engine).apply(revision, {
  kind: 'resolve-all-changes',
  decision: 'accept'
})
if (
  result.kind !== 'committed' ||
  result.edits.length !== changeCount ||
  result.revision.source.text !== expectedPattern.repeat(changeCount)
) {
  throw new Error(
    result.kind === 'committed'
      ? 'Marker-heavy transformation did not preserve exact source'
      : `Marker-heavy transformation was rejected: ${result.reason}`
  )
}

process.stdout.write(`${JSON.stringify({
  kind: result.kind,
  editCount: result.edits.length,
  sourceLength: result.revision.source.text.length,
  maxRssKiB: process.resourceUsage().maxRSS
})}\n`)
