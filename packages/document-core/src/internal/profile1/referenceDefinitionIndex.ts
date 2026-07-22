import type { CriticMarkupNode } from '../../revision.js'
import type { MarkdownLiteralRange } from './markdownTypes.js'
import { markdownReferenceDefinitionLabel } from './markdownLaneState.js'

type SubstitutionArmName = 'old' | 'new'

interface SubstitutionConstraint {
  readonly substitutionStart: number
  readonly arm: SubstitutionArmName
}

interface ReferenceDocumentScope {
  readonly commentStart: number | undefined
  readonly substitutions: readonly SubstitutionConstraint[]
}

interface ScopedReferenceDefinition {
  readonly normalizedLabel: string
  readonly scope: ReferenceDocumentScope
}

export interface Profile1ReferenceDefinitionIndex {
  readonly size: number
  readonly has: (normalizedLabel: string, sourceOffset: number) => boolean
}

function containsOffset(
  range: Readonly<{ start: number; end: number }>,
  offset: number
): boolean {
  return range.start <= offset && offset < range.end
}

function containingNode(
  nodes: readonly CriticMarkupNode[],
  offset: number
): CriticMarkupNode | undefined {
  let low = 0
  let high = nodes.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const node = nodes[middle]
    if (node !== undefined && node.range.start <= offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const candidate = nodes[low - 1]
  return candidate !== undefined && containsOffset(candidate.range, offset)
    ? candidate
    : undefined
}

function referenceScopeAt(
  roots: readonly CriticMarkupNode[],
  sourceOffset: number
): ReferenceDocumentScope {
  let commentStart: number | undefined
  let substitutions: SubstitutionConstraint[] = []
  let siblings = roots
  while (siblings.length > 0) {
    const node = containingNode(siblings, sourceOffset)
    if (node === undefined) {
      break
    }
    const arm = node.arms.find((candidate) =>
      containsOffset(candidate.range, sourceOffset)
    )
    if (arm === undefined) {
      break
    }
    if (node.kind === 'comment') {
      commentStart = node.range.start
      substitutions = []
    } else if (
      node.kind === 'substitution' &&
      (arm.name === 'old' || arm.name === 'new')
    ) {
      substitutions.push(Object.freeze({
        substitutionStart: node.range.start,
        arm: arm.name
      }))
    }
    siblings = arm.children
  }
  return Object.freeze({
    commentStart,
    substitutions: Object.freeze(substitutions)
  })
}

function scopesAreCompatible(
  definition: ReferenceDocumentScope,
  occurrence: ReferenceDocumentScope
): boolean {
  if (definition.commentStart !== occurrence.commentStart) {
    return false
  }
  const occurrenceArms = new Map(
    occurrence.substitutions.map((constraint) => [
      constraint.substitutionStart,
      constraint.arm
    ] as const)
  )
  for (const constraint of definition.substitutions) {
    const occurrenceArm = occurrenceArms.get(constraint.substitutionStart)
    if (occurrenceArm !== undefined && occurrenceArm !== constraint.arm) {
      return false
    }
  }
  return true
}

export function createProfile1ReferenceDefinitionIndex(
  source: string,
  roots: readonly CriticMarkupNode[],
  literals: readonly MarkdownLiteralRange[]
): Profile1ReferenceDefinitionIndex {
  const definitionsByLabel = new Map<string, ScopedReferenceDefinition[]>()
  let size = 0
  for (const literal of literals) {
    if (literal.kind !== 'definition') {
      continue
    }
    const normalizedLabel = markdownReferenceDefinitionLabel(
      source,
      literal.start,
      literal.end
    )
    if (normalizedLabel === undefined) {
      continue
    }
    const definition = Object.freeze({
      normalizedLabel,
      scope: referenceScopeAt(roots, literal.start)
    })
    const matching = definitionsByLabel.get(normalizedLabel)
    if (matching === undefined) {
      definitionsByLabel.set(normalizedLabel, [definition])
    } else {
      matching.push(definition)
    }
    size += 1
  }
  return Object.freeze({
    size,
    has: Object.freeze((normalizedLabel: string, sourceOffset: number): boolean => {
      const definitions = definitionsByLabel.get(normalizedLabel)
      if (definitions === undefined) {
        return false
      }
      const occurrenceScope = referenceScopeAt(roots, sourceOffset)
      return definitions.some((definition) =>
        scopesAreCompatible(definition.scope, occurrenceScope)
      )
    })
  })
}
