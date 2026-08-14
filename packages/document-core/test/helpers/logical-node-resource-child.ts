import {
  createDocumentCore,
  DOCUMENT_RESOURCE_POLICY_V1,
  DocumentCoreError
} from '../../src/index.js'
import { inspectDocumentCore } from '../../src/internal/documentCoreInspection.js'

const mode = process.argv[2]
const policy = DOCUMENT_RESOURCE_POLICY_V1 as
  typeof DOCUMENT_RESOURCE_POLICY_V1 & Readonly<{
    maximumLogicalNodes?: unknown
  }>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const BOUNDED_HEAP_BYTES = 512 * 1_024 * 1_024
const HEAP_RESERVE_NUMERATOR = 1
const HEAP_RESERVE_DENOMINATOR = 4
const LOGICAL_NODE_ENVELOPE_BYTES = 4_096
const modeledNodeCapacity = Math.floor((
  BOUNDED_HEAP_BYTES * (
    HEAP_RESERVE_DENOMINATOR - HEAP_RESERVE_NUMERATOR
  ) / HEAP_RESERVE_DENOMINATOR -
  2 * policy.maximumSourceUnits
) / LOGICAL_NODE_ENVELOPE_BYTES)
const EXPECTED_LOGICAL_NODE_LIMIT = 2 ** Math.floor(
  Math.log2(modeledNodeCapacity)
)
assert(
  EXPECTED_LOGICAL_NODE_LIMIT === 65_536,
  'The resource-envelope inputs no longer derive 65,536 logical nodes'
)

function logicalNodeError(error: unknown): DocumentCoreError {
  assert(error instanceof DocumentCoreError, 'Expected a DocumentCoreError')
  assert(
    error.code === 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
    `Expected a logical-node rejection, received ${error.code}`
  )
  assert(
    error.metadata.limit === String(EXPECTED_LOGICAL_NODE_LIMIT),
    `Expected limit ${String(EXPECTED_LOGICAL_NODE_LIMIT)}`
  )
  assert(
    error.metadata.observed === String(EXPECTED_LOGICAL_NODE_LIMIT + 1),
    `Expected first observed overflow ${String(EXPECTED_LOGICAL_NODE_LIMIT + 1)}`
  )
  return error
}

assert(
  policy.maximumLogicalNodes === EXPECTED_LOGICAL_NODE_LIMIT,
  'The public document resource policy does not carry the logical-node limit'
)

if (mode === 'edge') {
  // The Profile 1 event algebra for these three plain-document fixtures is
  // independently frozen here: 65,534, 65,536, and 65,537 logical nodes.
  const prefix = 'x\n\n'.repeat(8_191)
  const below = `${prefix}x`
  const at = `${prefix}x\n`
  const above = `${prefix}\n\n#`

  assert(
    createDocumentCore().open(below).sourceLength === below.length,
    'The below-limit document was not admitted'
  )
  assert(
    createDocumentCore().open(at).sourceLength === at.length,
    'The at-limit document was not admitted'
  )

  let rejection: unknown
  try {
    createDocumentCore().open(above)
  } catch (error) {
    rejection = error
  }
  logicalNodeError(rejection)

  process.stdout.write(`${JSON.stringify({
    mode,
    belowSourceUnits: below.length,
    atSourceUnits: at.length,
    aboveSourceUnits: above.length,
    maximumLogicalNodes: policy.maximumLogicalNodes
  })}\n`)
} else if (mode === 'overshoot') {
  const source = 'head\n\nbody\n'
  const core = createDocumentCore()
  const opened = core.open(source)
  const originalProjection = core.project(opened, 'original')
  const before = inspectDocumentCore(core)
  // This source is under 0.6 million UTF-16 units, but would materialize about
  // sixteen times the production limit if admission waited for every product.
  const farAbove = '{++x++}\n\n'.repeat(EXPECTED_LOGICAL_NODE_LIMIT)

  let rejection: unknown
  try {
    core.apply(opened, [{ start: 0, end: source.length, insert: farAbove }])
  } catch (error) {
    rejection = error
  }
  logicalNodeError(rejection)

  const rejected = inspectDocumentCore(core)
  assert(
    rejected.sourceRopeRootsCommitted === before.sourceRopeRootsCommitted,
    'A resource-rejected candidate committed a canonical-source root'
  )
  assert(
    rejected.fullProductStoresStrongPeak <= 1,
    'A resource-rejected candidate retained overlapping full-product stores'
  )
  assert(opened.source === source, 'The rejected candidate changed the prior source')
  assert(
    core.project(opened, 'original') === originalProjection,
    'The rejected candidate changed the prior projection identity'
  )

  const accepted = core.apply(opened, [{
    start: source.indexOf('body'),
    end: source.indexOf('body') + 'body'.length,
    insert: 'BODY'
  }])
  assert(
    accepted.revision.source === 'head\n\nBODY\n',
    'The prior head did not accept a valid edit after resource rejection'
  )
  assert(
    inspectDocumentCore(core).fullProductStoresStrongPeak <= 1,
    'Recovery retained overlapping full-product stores'
  )

  process.stdout.write(`${JSON.stringify({
    mode,
    farAboveSourceUnits: farAbove.length,
    maximumLogicalNodes: policy.maximumLogicalNodes,
    sourceRopeRootsCommittedBefore: before.sourceRopeRootsCommitted,
    sourceRopeRootsCommittedAfterReject: rejected.sourceRopeRootsCommitted
  })}\n`)
} else {
  throw new RangeError(`Unknown logical-node resource child mode: ${String(mode)}`)
}
