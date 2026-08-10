import type {
  MarkdownDocument,
  MarkdownFootnoteDefinitionFact,
  MarkdownFootnoteReferenceFact,
  MarkdownHeadingFact,
  MarkdownHeadingIndex,
  MarkdownLinkFact,
  MarkdownNode,
  MarkdownReferenceDefinitionFact,
  MarkdownReferenceIndex,
  NodeId
} from '../../revision.js'
import type { ParseExecutionTracker } from '../../parseExecutionControl.js'
import type { Profile1SyntaxIdentityRegistry } from './syntaxIdentity.js'

const AUTOLINK_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function ordinalAt<Value>(
  values: readonly Value[],
  ordinal: number,
  label: string
): Value {
  const value = Number.isInteger(ordinal) ? values[ordinal] : undefined
  if (value === undefined) {
    throw new RangeError(`${label} ordinal is outside the Markdown document`)
  }
  return value
}

function contentFrom(
  source: string,
  owner: MarkdownNode
): Readonly<{ readonly destination: string; readonly title?: string }> {
  const emittedDestination = owner.attributes['destination']
  if (typeof emittedDestination === 'string') {
    const emittedTitle = owner.attributes['title']
    return Object.freeze({
      destination: emittedDestination,
      ...(typeof emittedTitle === 'string' ? { title: emittedTitle } : {})
    })
  }
  const destinationStart = owner.attributes['destinationStart']
  const destinationEnd = owner.attributes['destinationEnd']
  if (
    typeof destinationStart !== 'number' ||
    typeof destinationEnd !== 'number'
  ) {
    throw new Error('Parser link target lost its destination range')
  }
  const titleStart = owner.attributes['titleStart']
  const titleEnd = owner.attributes['titleEnd']
  return Object.freeze({
    destination: source.slice(destinationStart, destinationEnd),
    ...(
      typeof titleStart === 'number' && typeof titleEnd === 'number'
        ? { title: source.slice(titleStart, titleEnd) }
        : {}
    )
  })
}

function autolinkContent(
  source: string,
  node: MarkdownNode
): Readonly<{ readonly destination: string }> {
  const start = Math.min(node.range.end, node.range.start + 1)
  const end = Math.max(start, node.range.end - 1)
  const content = source.slice(start, end)
  return Object.freeze({
    destination: AUTOLINK_EMAIL.test(content) ? `mailto:${content}` : content
  })
}

export function createMarkdownDocumentIndices(
  source: string,
  root: MarkdownNode,
  identity: Pick<
    Profile1SyntaxIdentityRegistry,
    'referenceTargets' | 'resolveFootnoteReference'
  >,
  execution: ParseExecutionTracker
): Pick<MarkdownDocument, 'references' | 'headings'> {
  const nodes: MarkdownNode[] = []
  const pending: MarkdownNode[] = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    execution.examineParserWork(1)
    nodes.push(node)
    for (let ordinal = node.childCount - 1; ordinal >= 0; ordinal -= 1) {
      pending.push(node.childAt(ordinal))
    }
  }

  const definitions: MarkdownReferenceDefinitionFact[] = []
  const definitionByLabel =
    new Map<string, MarkdownReferenceDefinitionFact>()
  const definitionByNode =
    new Map<NodeId, MarkdownReferenceDefinitionFact>()
  const footnoteDefinitions: MarkdownFootnoteDefinitionFact[] = []
  const footnoteDefinitionByLabel =
    new Map<string, MarkdownFootnoteDefinitionFact>()
  const footnoteDefinitionByNode =
    new Map<NodeId, MarkdownFootnoteDefinitionFact>()
  for (const node of nodes) {
    execution.examineParserWork(1)
    const label = node.attributes['label']
    if (node.kind === 'definition' && typeof label === 'string') {
      const fact = Object.freeze({
        label,
        node,
        ...contentFrom(source, node)
      })
      definitions.push(fact)
      definitionByNode.set(node.nodeId, fact)
      if (!definitionByLabel.has(label)) {
        definitionByLabel.set(label, fact)
      }
    } else if (
      node.kind === 'footnote-definition' &&
      typeof label === 'string' &&
      !footnoteDefinitionByLabel.has(label)
    ) {
      const fact = Object.freeze({ label, node })
      footnoteDefinitions.push(fact)
      footnoteDefinitionByLabel.set(label, fact)
      footnoteDefinitionByNode.set(node.nodeId, fact)
    }
  }

  const links: MarkdownLinkFact[] = []
  const linkByNode = new Map<NodeId, MarkdownLinkFact>()
  const footnoteReferences: MarkdownFootnoteReferenceFact[] = []
  const headings: MarkdownHeadingFact[] = []
  const headingByNode = new Map<NodeId, MarkdownHeadingFact>()
  for (const node of nodes) {
    execution.examineParserWork(1)
    if (
      node.kind === 'link' ||
      node.kind === 'image' ||
      node.kind === 'autolink'
    ) {
      const referenceLabel = node.attributes['referenceLabel']
      const firstDefinition = typeof referenceLabel === 'string'
        ? definitionByLabel.get(referenceLabel)
        : undefined
      const emittedTargets = new Set(identity.referenceTargets(node.nodeId))
      const definition =
        firstDefinition !== undefined &&
        emittedTargets.has(firstDefinition.node.nodeId)
          ? firstDefinition
          : [...emittedTargets]
            .map((nodeId) => definitionByNode.get(nodeId))
            .find((candidate) => candidate !== undefined)
      if (
        typeof referenceLabel === 'string' &&
        definition === undefined
      ) {
        // Boundary protection can retain a parser-issued link/image node while
        // excluding its definition from this projection. It is intentionally
        // unresolved here, matching the missing public reference edge.
        continue
      }
      const owner = definition?.node ?? node
      const target = node.kind === 'autolink'
        ? autolinkContent(source, node)
        : contentFrom(source, owner)
      const fact: MarkdownLinkFact = Object.freeze({
        node,
        ...target,
        ...(definition === undefined ? {} : { definition })
      })
      links.push(fact)
      linkByNode.set(node.nodeId, fact)
    } else if (node.kind === 'footnote-reference') {
      const label = node.attributes['label']
      if (typeof label === 'string') {
        const firstDefinition = footnoteDefinitionByLabel.get(label)
        if (firstDefinition !== undefined) {
          identity.resolveFootnoteReference(
            node.nodeId,
            firstDefinition.node.nodeId
          )
        }
        const emittedTargets = identity.referenceTargets(node.nodeId)
        const definition = emittedTargets
          .map((nodeId) => footnoteDefinitionByNode.get(nodeId))
          .find((candidate) => candidate !== undefined)
        footnoteReferences.push(Object.freeze({
          label,
          node,
          ...(definition === undefined ? {} : { definition })
        }))
      }
    } else if (node.kind === 'heading') {
      const fact = Object.freeze({
        node,
        nodeId: node.nodeId,
        level: Number(node.attributes['level'] ?? 1)
      })
      headings.push(fact)
      headingByNode.set(node.nodeId, fact)
    }
  }

  const stableDefinitions = Object.freeze(definitions)
  const stableLinks = Object.freeze(links)
  const stableFootnoteDefinitions = Object.freeze(footnoteDefinitions)
  const stableFootnoteReferences = Object.freeze(footnoteReferences)
  const stableHeadings = Object.freeze(headings)
  const references: MarkdownReferenceIndex = Object.freeze({
    definitionCount: stableDefinitions.length,
    definitionAt: Object.freeze((ordinal: number) =>
      ordinalAt(stableDefinitions, ordinal, 'Reference definition')),
    definitionForLabel: Object.freeze((label: string) =>
      definitionByLabel.get(label)),
    linkCount: stableLinks.length,
    linkAt: Object.freeze((ordinal: number) =>
      ordinalAt(stableLinks, ordinal, 'Link')),
    linkForNode: Object.freeze((nodeId: NodeId) => linkByNode.get(nodeId)),
    footnoteDefinitionCount: stableFootnoteDefinitions.length,
    footnoteDefinitionAt: Object.freeze((ordinal: number) =>
      ordinalAt(
        stableFootnoteDefinitions,
        ordinal,
        'Footnote definition'
      )),
    footnoteDefinitionForLabel: Object.freeze((label: string) =>
      footnoteDefinitionByLabel.get(label)),
    footnoteReferenceCount: stableFootnoteReferences.length,
    footnoteReferenceAt: Object.freeze((ordinal: number) =>
      ordinalAt(stableFootnoteReferences, ordinal, 'Footnote reference'))
  })
  const headingIndex: MarkdownHeadingIndex = Object.freeze({
    count: stableHeadings.length,
    at: Object.freeze((ordinal: number) =>
      ordinalAt(stableHeadings, ordinal, 'Heading')),
    forNode: Object.freeze((nodeId: NodeId) => headingByNode.get(nodeId))
  })
  return Object.freeze({
    references,
    headings: headingIndex
  })
}
