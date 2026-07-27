import type {
  NodeId,
  Profile1SyntaxEdge,
  Profile1SyntaxEdgeKind,
  Profile1SyntaxGraph,
  Profile1SyntaxNode,
  Profile1SyntaxNodeKind,
  SourceOffset,
  SourceOwner,
  SourceOwnershipIndex,
  SourceOwnershipRun,
  SourceRange
} from '../../revision.js'
import type {
  Profile1SyntaxAccountingEventKindV1,
  Profile1SyntaxAccountingRecorderV1
} from './syntaxAccounting.js'

export interface SyntaxSourceIdentity {
  readonly key: string
  readonly range: SourceRange
}

export interface Profile1SyntaxIdentityRegistry {
  readonly root: NodeId
  readonly emitNode: (
    kind: Profile1SyntaxNodeKind,
    source: SyntaxSourceIdentity,
    semanticKey: string
  ) => NodeId
  readonly emitEdge: (
    kind: Profile1SyntaxEdgeKind,
    from: NodeId,
    to: NodeId,
    role?: string
  ) => void
  readonly internObject: <Value extends object>(
    nodeId: NodeId,
    objectKey: string,
    create: () => Value
  ) => Value
  readonly emitOwnership: (
    range: SourceRange,
    owner: SourceOwner
  ) => void
  readonly emitDefinition: (sourceStart: number, nodeId: NodeId) => void
  readonly emitReference: (
    nodeId: NodeId,
    definitionSourceStart: number
  ) => void
  readonly emitFootnoteDefinition: (nodeId: NodeId, label: string) => void
  readonly emitFootnoteReference: (nodeId: NodeId, label: string) => void
  readonly resolveFootnoteReference: (
    nodeId: NodeId,
    definitionNodeId: NodeId
  ) => void
  readonly referenceTargets: (nodeId: NodeId) => readonly NodeId[]
  readonly finishOwnership: (source: string) => SourceOwnershipIndex
  readonly finish: () => Profile1SyntaxGraph
}

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({
    start: sourceOffset(start),
    end: sourceOffset(end)
  })
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
  return left.start === right.start && left.end === right.end
}

function sameOwner(left: SourceOwner, right: SourceOwner): boolean {
  if (left.kind !== right.kind) {
    return false
  }
  if (left.kind === 'markdown-text' && right.kind === 'markdown-text') {
    return true
  }
  if (left.kind === 'trivia' && right.kind === 'trivia') {
    return left.role === right.role && left.spelling === right.spelling
  }
  if (left.kind === 'markdown-literal' && right.kind === 'markdown-literal') {
    return (
      left.provider === right.provider &&
      sameRange(left.ownerRange, right.ownerRange)
    )
  }
  if (left.kind === 'critic-marker' && right.kind === 'critic-marker') {
    return (
      left.nodeId === right.nodeId &&
      left.form === right.form &&
      left.role === right.role &&
      sameRange(left.nodeRange, right.nodeRange)
    )
  }
  return false
}

/**
 * Defines public revision-bound identity without changing the enumerable shape
 * of long-standing value objects. Existing structural consumers continue to
 * see the language fields they asked for, while direct property access exposes
 * the parser-emitted identity.
 */
export function defineNodeId<Value extends object>(
  value: Value,
  nodeId: NodeId
): Value & Readonly<{ readonly nodeId: NodeId }> {
  Object.defineProperty(value, 'nodeId', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: nodeId
  })
  return value as Value & Readonly<{ readonly nodeId: NodeId }>
}

/**
 * One mutable emission ledger exists only while an immutable revision is being
 * parsed. Nodes and edges enter it at the grammar construction sites; finish()
 * merely freezes the already-emitted sequence.
 */
export function createProfile1SyntaxIdentityRegistry(
  sourceLength: number,
  accounting?: Profile1SyntaxAccountingRecorderV1
): Profile1SyntaxIdentityRegistry {
  const nodes: Profile1SyntaxNode[] = []
  const nodeBySemanticKey = new Map<string, Profile1SyntaxNode>()
  const nodeById = new Map<NodeId, Profile1SyntaxNode>()
  const edges: Profile1SyntaxEdge[] = []
  const edgeKeys = new Set<string>()
  const internedObjects = new Map<string, object>()
  const ownershipFacts: Array<Readonly<{
    readonly range: SourceRange
    readonly owner: SourceOwner
  }>> = []
  const ownershipFactKeys = new Set<string>()
  const definitionBySourceStart = new Map<number, NodeId>()
  const pendingReferences = new Map<number, NodeId[]>()
  const referenceTargetsByNode = new Map<NodeId, NodeId[]>()
  const footnoteDefinitionLabelByNode = new Map<NodeId, string>()
  const footnoteReferenceLabelByNode = new Map<NodeId, string>()
  let finished: Profile1SyntaxGraph | undefined
  let finishedOwnership: SourceOwnershipIndex | undefined

  const emitNode = (
    kind: Profile1SyntaxNodeKind,
    source: SyntaxSourceIdentity,
    semanticKey: string
  ): NodeId => {
    if (finished !== undefined) {
      throw new Error('Profile 1 syntax identity was emitted after finalization')
    }
    if (
      source.range.start < 0 ||
      source.range.end < source.range.start ||
      source.range.end > sourceLength
    ) {
      throw new Error('Profile 1 syntax identity is outside canonical source')
    }
    const key = `${kind}\u0000${semanticKey}`
    const existing = nodeBySemanticKey.get(key)
    if (existing !== undefined) {
      if (existing.kind !== kind || !sameRange(existing.range, source.range)) {
        throw new Error('Profile 1 semantic identity mapped to different syntax')
      }
      return existing.nodeId
    }
    const nodeId = `p1:${String(nodes.length)}` as NodeId
    const node: Profile1SyntaxNode = Object.freeze({
      nodeId,
      kind,
      range: source.range
    })
    nodes.push(node)
    nodeBySemanticKey.set(key, node)
    nodeById.set(nodeId, node)
    const accountingKind: Profile1SyntaxAccountingEventKindV1 =
      kind === 'addition' ||
      kind === 'deletion' ||
      kind === 'substitution' ||
      kind === 'highlight' ||
      kind === 'comment'
        ? 'CriticNode'
        : kind === 'critic-arm'
          ? 'ArmNode'
          : kind === 'source-leaf'
            ? 'MarkerNode'
            : 'MarkdownNode'
    accounting?.emit(accountingKind, source.range, semanticKey)
    return nodeId
  }

  const root = emitNode(
    'document',
    Object.freeze({
      key: 'canonical-document',
      range: sourceRange(0, sourceLength)
    }),
    'canonical-document'
  )

  const emitEdge = (
    kind: Profile1SyntaxEdgeKind,
    from: NodeId,
    to: NodeId,
    role?: string
  ): void => {
    if (finished !== undefined) {
      throw new Error('Profile 1 syntax edge was emitted after finalization')
    }
    if (!nodeById.has(from) || !nodeById.has(to)) {
      throw new Error('Profile 1 syntax edge references an unemitted node')
    }
    const key = `${kind}\u0000${from}\u0000${to}\u0000${role ?? ''}`
    if (edgeKeys.has(key)) {
      return
    }
    edgeKeys.add(key)
    edges.push(Object.freeze({
      kind,
      from,
      to,
      ...(role === undefined ? {} : { role })
    }))
  }

  const internObject = <Value extends object>(
    nodeId: NodeId,
    objectKey: string,
    create: () => Value
  ): Value => {
    if (!nodeById.has(nodeId)) {
      throw new Error('Cannot intern an object for an unemitted syntax node')
    }
    const key = `${nodeId}\u0000${objectKey}`
    const existing = internedObjects.get(key)
    if (existing !== undefined) {
      return existing as Value
    }
    const value = create()
    internedObjects.set(key, value)
    return value
  }

  const emitOwnership = (
    range: SourceRange,
    owner: SourceOwner
  ): void => {
    if (
      range.start < 0 ||
      range.end <= range.start ||
      range.end > sourceLength
    ) {
      throw new Error('Profile 1 ownership fact is outside canonical source')
    }
    if (finishedOwnership !== undefined) {
      throw new Error('Profile 1 ownership fact was emitted after finalization')
    }
    const ownerKey =
      owner.kind === 'critic-marker'
        ? `${owner.kind}:${owner.nodeId}:${owner.role}`
        : owner.kind === 'markdown-literal'
          ? `${owner.kind}:${owner.provider}:${owner.ownerRange.start}:${owner.ownerRange.end}`
          : owner.kind === 'trivia'
            ? `${owner.kind}:${owner.role}:${owner.spelling ?? ''}`
            : owner.kind
    const key = `${range.start}:${range.end}:${ownerKey}`
    if (ownershipFactKeys.has(key)) {
      return
    }
    ownershipFactKeys.add(key)
    ownershipFacts.push(Object.freeze({ range, owner }))
  }

  const emitDefinition = (sourceStart: number, nodeId: NodeId): void => {
    if (!nodeById.has(nodeId)) {
      throw new Error('Markdown definition identity was not emitted')
    }
    const existing = definitionBySourceStart.get(sourceStart)
    if (existing !== undefined && existing !== nodeId) {
      throw new Error('One Markdown definition start emitted two identities')
    }
    definitionBySourceStart.set(sourceStart, nodeId)
    for (const reference of pendingReferences.get(sourceStart) ?? []) {
      emitEdge('reference', reference, nodeId)
      const targets = referenceTargetsByNode.get(reference)
      if (targets === undefined) {
        referenceTargetsByNode.set(reference, [nodeId])
      } else if (!targets.includes(nodeId)) {
        targets.push(nodeId)
      }
    }
    pendingReferences.delete(sourceStart)
  }

  const emitReference = (
    nodeId: NodeId,
    definitionSourceStart: number
  ): void => {
    if (!nodeById.has(nodeId)) {
      throw new Error('Markdown reference identity was not emitted')
    }
    const definition = definitionBySourceStart.get(definitionSourceStart)
    if (definition !== undefined) {
      emitEdge('reference', nodeId, definition)
      const targets = referenceTargetsByNode.get(nodeId)
      if (targets === undefined) {
        referenceTargetsByNode.set(nodeId, [definition])
      } else if (!targets.includes(definition)) {
        targets.push(definition)
      }
      return
    }
    const pending = pendingReferences.get(definitionSourceStart)
    if (pending === undefined) {
      pendingReferences.set(definitionSourceStart, [nodeId])
    } else if (!pending.includes(nodeId)) {
      pending.push(nodeId)
    }
  }

  const emitFootnoteIdentity = (
    identities: Map<NodeId, string>,
    nodeId: NodeId,
    label: string,
    kind: string
  ): void => {
    if (finished !== undefined) {
      throw new Error(`Markdown ${kind} identity was emitted after finalization`)
    }
    if (!nodeById.has(nodeId)) {
      throw new Error(`Markdown ${kind} identity was not emitted`)
    }
    const existing = identities.get(nodeId)
    if (existing !== undefined && existing !== label) {
      throw new Error(`One Markdown ${kind} identity emitted two labels`)
    }
    identities.set(nodeId, label)
  }

  const emitFootnoteDefinition = (
    nodeId: NodeId,
    label: string
  ): void => {
    emitFootnoteIdentity(
      footnoteDefinitionLabelByNode,
      nodeId,
      label,
      'footnote definition'
    )
  }

  const emitFootnoteReference = (
    nodeId: NodeId,
    label: string
  ): void => {
    emitFootnoteIdentity(
      footnoteReferenceLabelByNode,
      nodeId,
      label,
      'footnote reference'
    )
  }

  const resolveFootnoteReference = (
    nodeId: NodeId,
    definitionNodeId: NodeId
  ): void => {
    const referenceLabel = footnoteReferenceLabelByNode.get(nodeId)
    const definitionLabel =
      footnoteDefinitionLabelByNode.get(definitionNodeId)
    if (referenceLabel === undefined || definitionLabel === undefined) {
      throw new Error(
        'Markdown footnote reference resolution lost parser identity'
      )
    }
    if (referenceLabel !== definitionLabel) {
      throw new Error(
        'Markdown footnote reference resolved to a different parser label'
      )
    }
    emitEdge('reference', nodeId, definitionNodeId)
    const targets = referenceTargetsByNode.get(nodeId)
    if (targets === undefined) {
      referenceTargetsByNode.set(nodeId, [definitionNodeId])
    } else if (!targets.includes(definitionNodeId)) {
      targets.push(definitionNodeId)
    }
  }

  const referenceTargets = (nodeId: NodeId): readonly NodeId[] =>
    Object.freeze([...(referenceTargetsByNode.get(nodeId) ?? [])])

  const finishOwnership = (source: string): SourceOwnershipIndex => {
    if (source.length !== sourceLength) {
      throw new Error('Profile 1 ownership source length changed during parse')
    }
    if (finishedOwnership !== undefined) {
      return finishedOwnership
    }
    const boundaries = new Set<number>([0, sourceLength])
    if (source.charCodeAt(0) === 0xfeff) {
      boundaries.add(1)
    }
    for (const fact of ownershipFacts) {
      boundaries.add(fact.range.start)
      boundaries.add(fact.range.end)
    }
    const orderedBoundaries = [...boundaries].sort(
      (left, right) => left - right
    )
    const precedence = (owner: SourceOwner): number =>
      owner.kind === 'trivia'
        ? 3
        : owner.kind === 'critic-marker'
          ? 2
          : owner.kind === 'markdown-literal'
            ? 1
            : 0
    const orderedFacts = [...ownershipFacts].sort(
      (left, right) =>
        left.range.start - right.range.start ||
        right.range.end - left.range.end
    )
    const activeFacts: typeof ownershipFacts = []
    let factCursor = 0
    const runs: SourceOwnershipRun[] = []
    for (let index = 0; index + 1 < orderedBoundaries.length; index += 1) {
      const start = orderedBoundaries[index]
      const end = orderedBoundaries[index + 1]
      if (start === undefined || end === undefined || start === end) {
        continue
      }
      while (
        (orderedFacts[factCursor]?.range.start ?? Number.POSITIVE_INFINITY) <=
          start
      ) {
        const fact = orderedFacts[factCursor]
        if (fact !== undefined && fact.range.end > start) {
          activeFacts.push(fact)
        }
        factCursor += 1
      }
      for (let active = activeFacts.length - 1; active >= 0; active -= 1) {
        if ((activeFacts[active]?.range.end ?? 0) <= start) {
          activeFacts.splice(active, 1)
        }
      }
      let selected:
        | Readonly<{ readonly range: SourceRange; readonly owner: SourceOwner }>
        | undefined
      for (const fact of activeFacts) {
        if (fact.range.end < end) {
          continue
        }
        if (
          selected === undefined ||
          precedence(fact.owner) > precedence(selected.owner) ||
          (
            precedence(fact.owner) === precedence(selected.owner) &&
            fact.range.end - fact.range.start <
              selected.range.end - selected.range.start
          )
        ) {
          selected = fact
        }
      }
      const owner: SourceOwner =
        start === 0 && end <= 1 && source.charCodeAt(0) === 0xfeff
          ? Object.freeze({ kind: 'trivia', role: 'virtual-bom' })
          : selected?.owner ?? Object.freeze({ kind: 'markdown-text' })
      const previous = runs.at(-1)
      if (
        previous !== undefined &&
        previous.range.end === start &&
        sameOwner(previous.owner, owner)
      ) {
        runs[runs.length - 1] = Object.freeze({
          range: sourceRange(previous.range.start, end),
          owner: previous.owner
        })
      } else {
        runs.push(Object.freeze({
          range: sourceRange(start, end),
          owner
        }))
      }
    }
    const stableRuns = Object.freeze(runs)
    finishedOwnership = Object.freeze({
      count: stableRuns.length,
      at: Object.freeze((ordinal: number): SourceOwnershipRun => {
        const run = Number.isInteger(ordinal)
          ? stableRuns[ordinal]
          : undefined
        if (run === undefined) {
          throw new RangeError(
            'Source ownership ordinal is outside the revision'
          )
        }
        return run
      }),
      ownerAt: Object.freeze((offset: number): SourceOwnershipRun => {
        if (
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset >= sourceLength
        ) {
          throw new RangeError('Source offset is outside the revision')
        }
        let low = 0
        let high = stableRuns.length
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2)
          if (
            (stableRuns[middle]?.range.end ?? Number.POSITIVE_INFINITY) <=
              offset
          ) {
            low = middle + 1
          } else {
            high = middle
          }
        }
        const run = stableRuns[low]
        if (run === undefined || offset < run.range.start) {
          throw new Error('Source ownership index invariant failed')
        }
        return run
      })
    })
    return finishedOwnership
  }

  const finish = (): Profile1SyntaxGraph => {
    finished ??= Object.freeze({
      root,
      nodeCount: nodes.length,
      nodeAt: Object.freeze((ordinal: number): Profile1SyntaxNode => {
        const node = Number.isInteger(ordinal) ? nodes[ordinal] : undefined
        if (node === undefined) {
          throw new RangeError('Profile 1 syntax node ordinal is outside the graph')
        }
        return node
      }),
      edgeCount: edges.length,
      edgeAt: Object.freeze((ordinal: number): Profile1SyntaxEdge => {
        const edge = Number.isInteger(ordinal) ? edges[ordinal] : undefined
        if (edge === undefined) {
          throw new RangeError('Profile 1 syntax edge ordinal is outside the graph')
        }
        return edge
      })
    })
    return finished
  }

  return Object.freeze({
    root,
    emitNode: Object.freeze(emitNode),
    emitEdge: Object.freeze(emitEdge),
    internObject: Object.freeze(internObject),
    emitOwnership: Object.freeze(emitOwnership),
    emitDefinition: Object.freeze(emitDefinition),
    emitReference: Object.freeze(emitReference),
    emitFootnoteDefinition: Object.freeze(emitFootnoteDefinition),
    emitFootnoteReference: Object.freeze(emitFootnoteReference),
    resolveFootnoteReference: Object.freeze(resolveFootnoteReference),
    referenceTargets: Object.freeze(referenceTargets),
    finishOwnership: Object.freeze(finishOwnership),
    finish: Object.freeze(finish)
  })
}
