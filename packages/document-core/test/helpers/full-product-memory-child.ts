import { createDocumentCore } from '../../src/index.js'
import { inspectDocumentCore } from '../../src/internal/documentCoreInspection.js'

const regions = Number.parseInt(process.argv[2] ?? '', 10)
const maximumRetainedBytesPerRegion = Number.parseInt(
  process.argv[3] ?? '',
  10
)
const mode = process.argv[4] ?? 'incremental'
if (!Number.isSafeInteger(regions) || regions < 1) {
  throw new RangeError('regions must be a positive safe integer')
}
if (
  !Number.isSafeInteger(maximumRetainedBytesPerRegion) ||
  maximumRetainedBytesPerRegion < 1
) {
  throw new RangeError('memory threshold must be a positive safe integer')
}
if (globalThis.gc === undefined) throw new Error('Run with node --expose-gc')
if (
  mode !== 'incremental' &&
  mode !== 'intrinsic-fallback' &&
  mode !== 'historical' &&
  mode !== 'intrinsic-fallback-historical' &&
  mode !== 'historical-annotations'
) {
  throw new RangeError('unknown memory harness mode')
}

const collect = (): number => {
  globalThis.gc?.()
  globalThis.gc?.()
  return process.memoryUsage().heapUsed
}

const source = mode === 'historical-annotations'
  ? `{>>${'{++'.repeat(regions)}x${'++}'.repeat(regions)}<<}\n\ntail\n`
  : [
    'a {++one++}\n\n',
    'b {--two--}\n\n',
    'c {>>note<<}\n\n',
    'x\n\n'.repeat(regions)
  ].join('')
const editAt = mode === 'historical-annotations'
  ? source.lastIndexOf('tail')
  : source.lastIndexOf('x')
const beforeOpen = collect()
const core = createDocumentCore()
const opened = core.open(source)
const afterOpen = collect()
const beforeApplyInspection = inspectDocumentCore(core)
const commit = core.apply(opened, [{
  start: editAt,
  end: editAt + (mode === 'historical-annotations' ? 4 : 1),
  insert: mode === 'intrinsic-fallback' ||
    mode === 'intrinsic-fallback-historical'
    ? '{++X++}'
    : mode === 'historical-annotations'
      ? 'TAIL'
      : 'X'
}])
if (mode === 'historical' || mode === 'intrinsic-fallback-historical') {
  core.project(opened, 'markup')
}
if (mode === 'historical-annotations' && opened.annotations.length < 1) {
  throw new Error('Expected historical annotations')
}
const afterApply = collect()
const afterApplyInspection = inspectDocumentCore(core)
const retainedBytes = afterApply - beforeOpen
const retainedBytesPerRegion = retainedBytes / regions
const result = Object.freeze({
  regions,
  sourceUnits: source.length,
  openBytes: afterOpen - beforeOpen,
  applyBytes: afterApply - afterOpen,
  retainedBytes,
  retainedBytesPerRegion,
  mode,
  intrinsicSourceUnits:
    afterApplyInspection.intrinsicSourceUnits -
    beforeApplyInspection.intrinsicSourceUnits,
  currentStrongStores: afterApplyInspection.fullProductStoresStrongCurrent,
  peakStrongStores: afterApplyInspection.fullProductStoresStrongPeak,
  projectionScopes: commit.change.projections.map(change => change.scope),
  maximumRetainedBytesPerRegion
})
process.stdout.write(`${JSON.stringify(result)}\n`)
if (retainedBytesPerRegion > maximumRetainedBytesPerRegion) {
  process.exitCode = 1
}
