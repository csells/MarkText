import type { MarkdownLiteralRange } from './markdownTypes.js'
import {
  markdownReferenceDefinitionLabel,
  stagedMarkdownReferenceDefinitionAt,
  type MarkdownReferenceDefinitionLookup
} from './markdownLaneState.js'

type SubstitutionArmName = 'old' | 'new'

interface SubstitutionConstraint {
  readonly substitutionStart: number
  readonly arm: SubstitutionArmName
}

interface ReferenceDocumentScope {
  readonly commentStart: number | undefined
  readonly substitutions: readonly SubstitutionConstraint[]
}

export interface Profile1ReferenceDefinitionFact {
  readonly normalizedLabel: string
  readonly sourceStart: number
  readonly sourceEnd: number
}

export interface Profile1CanonicalReferenceDefinitionLookup
  extends MarkdownReferenceDefinitionLookup {
  readonly finalizeAcceptedDefinitions: (
    literals: readonly MarkdownLiteralRange[]
  ) => void
  readonly definitionFacts: () => readonly Profile1ReferenceDefinitionFact[]
  readonly definitionStartMatching: (
    normalizedLabel: string,
    sourceOffset: number,
    accepts: (definitionStart: number) => boolean
  ) => number | undefined
}

/**
 * One accepted document-scope boundary. The staged lookup derives these from
 * the intrinsic delimiter identities that remain standing after the Markdown
 * lane rejects unconditional literal owners; it never walks a completed
 * CriticMarkup forest.
 */
export type Profile1ReferenceScopeRegion =
  | Readonly<{
    readonly kind: 'comment'
    readonly ownerStart: number
    readonly start: number
    readonly end: number
  }>
  | Readonly<{
    readonly kind: 'substitution'
    readonly ownerStart: number
    readonly arm: SubstitutionArmName
    readonly start: number
    readonly end: number
  }>

export interface Profile1ReferenceDefinitionIndex {
  readonly size: number
  readonly definitionFacts: () => readonly Profile1ReferenceDefinitionFact[]
  readonly definitionStartMatching: (
    normalizedLabel: string,
    sourceOffset: number,
    accepts: (definitionStart: number) => boolean
  ) => number | undefined
  readonly has: (normalizedLabel: string, sourceOffset: number) => boolean
  readonly hasAny: (normalizedLabel: string) => boolean
  readonly definitionStart: (
    normalizedLabel: string,
    sourceOffset: number
  ) => number | undefined
  readonly rejectDelimiterCandidate: (candidateStart: number) => void
}

export interface Profile1ReferenceLaneRegion {
  readonly kind:
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'
  readonly ownerStart: number
  readonly start: number
  readonly end: number
  readonly arm?: SubstitutionArmName
}

export interface Profile1ReferenceDelimiterCandidate {
  readonly kind:
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'
  readonly role: 'open' | 'separator' | 'close'
  readonly start: number
  readonly end: number
}

interface CandidateLaneFrame {
  readonly kind: Profile1ReferenceDelimiterCandidate['kind']
  readonly ownerStart: number
  readonly contentStart: number
  separatorStart?: number
  separatorEnd?: number
}

function deriveStandingLaneRegions(
  candidates: readonly Profile1ReferenceDelimiterCandidate[],
  rejectedCandidates: ReadonlySet<number>
): Readonly<{
    readonly regions: readonly Profile1ReferenceLaneRegion[]
    readonly virtualStarts: readonly number[]
  }> {
  const regions: Profile1ReferenceLaneRegion[] = []
  const virtualStarts: number[] = []
  const frames: CandidateLaneFrame[] = []
  for (const candidate of candidates) {
    if (rejectedCandidates.has(candidate.start)) {
      continue
    }
    const frame = frames.at(-1)
    if (candidate.role === 'open') {
      frames.push({
        kind: candidate.kind,
        ownerStart: candidate.start,
        contentStart: candidate.end
      })
      continue
    }
    if (
      candidate.role === 'separator' &&
      frame?.kind === 'substitution' &&
      frame.separatorStart === undefined
    ) {
      frame.separatorStart = candidate.start
      frame.separatorEnd = candidate.end
      continue
    }
    if (candidate.role !== 'close' || frame?.kind !== candidate.kind) {
      continue
    }
    frames.pop()
    if (
      frame.kind === 'substitution' &&
      frame.separatorStart !== undefined &&
      frame.separatorEnd !== undefined
    ) {
      regions.push(
        Object.freeze({
          kind: 'substitution',
          ownerStart: frame.ownerStart,
          arm: 'old',
          start: frame.contentStart,
          end: frame.separatorStart
        }),
        Object.freeze({
          kind: 'substitution',
          ownerStart: frame.ownerStart,
          arm: 'new',
          start: frame.separatorEnd,
          end: candidate.start
        })
      )
      virtualStarts.push(frame.contentStart, frame.separatorEnd)
    } else {
      regions.push(Object.freeze({
        kind: frame.kind,
        ownerStart: frame.ownerStart,
        start: frame.contentStart,
        end: candidate.start
      }))
      virtualStarts.push(frame.contentStart)
    }
  }
  regions.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.ownerStart - right.ownerStart
  )
  virtualStarts.sort((left, right) => left - right)
  return Object.freeze({
    regions: Object.freeze(regions),
    virtualStarts: Object.freeze(virtualStarts)
  })
}

function followsBlockBoundary(source: string, start: number): boolean {
  if (start === 0) {
    return true
  }
  let previousEnd = start
  if (source.charCodeAt(previousEnd - 1) === 10) {
    previousEnd -= 1
    if (previousEnd > 0 && source.charCodeAt(previousEnd - 1) === 13) {
      previousEnd -= 1
    }
  } else if (source.charCodeAt(previousEnd - 1) === 13) {
    previousEnd -= 1
  }
  let previousStart = previousEnd
  while (
    previousStart > 0 &&
    source.charCodeAt(previousStart - 1) !== 10 &&
    source.charCodeAt(previousStart - 1) !== 13
  ) {
    previousStart -= 1
  }
  return source.slice(previousStart, previousEnd).trim().length === 0
}

function innermostLaneEnd(
  regions: readonly Profile1ReferenceLaneRegion[],
  start: number,
  sourceEnd: number
): number {
  let laneEnd = sourceEnd
  for (const region of regions) {
    if (
      region.start <= start &&
      start < region.end &&
      region.end < laneEnd
    ) {
      laneEnd = region.end
    }
  }
  return laneEnd
}

/**
 * Stage exact block-definition facts before the inline portion of the single
 * intrinsic traversal. Delimiter candidates and the parser share source
 * identities. Whenever the Markdown lane rejects an opener, this lookup
 * re-derives standing pairs from those same identities, so a raw candidate
 * stack never becomes an independent scope topology.
 */
export function createStagedProfile1ReferenceDefinitionLookup(
  source: string,
  delimiterCandidates: readonly Profile1ReferenceDelimiterCandidate[],
  physicalStarts: readonly number[],
  hasDefinitionCandidate: boolean
): Profile1CanonicalReferenceDefinitionLookup {
  if (!hasDefinitionCandidate) {
    return Object.freeze({
      finalizeAcceptedDefinitions: Object.freeze((): void => {}),
      definitionFacts: Object.freeze(
        (): readonly Profile1ReferenceDefinitionFact[] => Object.freeze([])
      ),
      definitionStartMatching: Object.freeze(
        (): number | undefined => undefined
      ),
      has: Object.freeze((): boolean => false)
    })
  }
  const rejectedCandidates = new Set<number>()
  let cachedIndex: Profile1ReferenceDefinitionIndex | undefined
  let acceptedDefinitions: readonly MarkdownLiteralRange[] | undefined
  const currentIndex = (): Profile1ReferenceDefinitionIndex => {
    if (cachedIndex !== undefined) {
      return cachedIndex
    }
    const standing = deriveStandingLaneRegions(
      delimiterCandidates,
      rejectedCandidates
    )
    const starts = new Set<number>([
      ...physicalStarts.filter((start) =>
        followsBlockBoundary(source, start)
      ),
      ...standing.virtualStarts
    ])
    const definitions: MarkdownLiteralRange[] = acceptedDefinitions === undefined
      ? []
      : [...acceptedDefinitions]
    if (acceptedDefinitions === undefined) {
      for (const start of [...starts].sort((left, right) => left - right)) {
        const staged = stagedMarkdownReferenceDefinitionAt(
          source,
          start,
          innermostLaneEnd(standing.regions, start, source.length)
        )
        if (staged !== undefined) {
          definitions.push(Object.freeze({
            kind: 'definition',
            start: staged.start,
            end: staged.end
          }))
        }
      }
    }
    definitions.sort(
      (left, right) => left.start - right.start || left.end - right.end
    )
    const scopeRegions = standing.regions.flatMap(
      (region): readonly Profile1ReferenceScopeRegion[] => {
        if (region.kind === 'comment') {
          return Object.freeze([Object.freeze({
            kind: 'comment',
            ownerStart: region.ownerStart,
            start: region.start,
            end: region.end
          })])
        }
        return region.kind === 'substitution' && region.arm !== undefined
          ? Object.freeze([Object.freeze({
            kind: 'substitution',
            ownerStart: region.ownerStart,
            arm: region.arm,
            start: region.start,
            end: region.end
          })])
          : Object.freeze([])
      }
    )
    cachedIndex = createProfile1ReferenceDefinitionIndex(
      source,
      definitions,
      scopeRegions
    )
    return cachedIndex
  }
  return Object.freeze({
    finalizeAcceptedDefinitions: Object.freeze((
      literals: readonly MarkdownLiteralRange[]
    ): void => {
      acceptedDefinitions = Object.freeze(literals.filter(
        (literal) => literal.kind === 'definition'
      ))
      cachedIndex = undefined
    }),
    definitionFacts: Object.freeze(
      (): readonly Profile1ReferenceDefinitionFact[] =>
        currentIndex().definitionFacts()
    ),
    definitionStartMatching: Object.freeze((
      normalizedLabel: string,
      sourceOffset: number,
      accepts: (definitionStart: number) => boolean
    ): number | undefined =>
      currentIndex().definitionStartMatching(
        normalizedLabel,
        sourceOffset,
        accepts
      )),
    hasAny: Object.freeze((normalizedLabel: string): boolean =>
      currentIndex().hasAny(normalizedLabel)),
    definitionStart: Object.freeze((
      normalizedLabel: string,
      sourceOffset: number
    ): number | undefined =>
      currentIndex().definitionStart(normalizedLabel, sourceOffset)),
    has: Object.freeze((
      normalizedLabel: string,
      sourceOffset: number
    ): boolean => currentIndex().has(normalizedLabel, sourceOffset)),
    rejectDelimiterCandidate: Object.freeze((candidateStart: number): void => {
      if (!rejectedCandidates.has(candidateStart)) {
        rejectedCandidates.add(candidateStart)
        cachedIndex = undefined
      }
    })
  })
}

function referenceScopeAt(
  regions: readonly Profile1ReferenceScopeRegion[],
  sourceOffset: number,
  rejectedScopeOwners: ReadonlySet<number>
): ReferenceDocumentScope {
  let commentStart: number | undefined
  let substitutions: SubstitutionConstraint[] = []
  for (const region of regions) {
    if (rejectedScopeOwners.has(region.ownerStart)) {
      continue
    }
    if (!(region.start <= sourceOffset && sourceOffset < region.end)) {
      continue
    }
    if (region.kind === 'comment') {
      commentStart = region.ownerStart
      substitutions = []
    } else {
      substitutions.push(Object.freeze({
        substitutionStart: region.ownerStart,
        arm: region.arm
      }))
    }
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
    if (occurrenceArm !== constraint.arm) {
      return false
    }
  }
  return true
}

export function createProfile1ReferenceDefinitionIndex(
  source: string,
  literals: readonly MarkdownLiteralRange[],
  scopeRegions: readonly Profile1ReferenceScopeRegion[]
): Profile1ReferenceDefinitionIndex {
  const regions = Object.freeze([...scopeRegions].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.ownerStart - right.ownerStart
  ))
  const definitionsByLabel = new Map<
    string,
    Profile1ReferenceDefinitionFact[]
  >()
  const rejectedScopeOwners = new Set<number>()
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
      sourceStart: literal.start,
      sourceEnd: literal.end
    })
    const matching = definitionsByLabel.get(normalizedLabel)
    if (matching === undefined) {
      definitionsByLabel.set(normalizedLabel, [definition])
    } else {
      matching.push(definition)
    }
    size += 1
  }
  const definitionFacts = Object.freeze(
    [...definitionsByLabel.values()]
      .flat()
      .sort(
        (left, right) =>
          left.sourceStart - right.sourceStart ||
          left.sourceEnd - right.sourceEnd
      )
  )
  const definitionStartMatching = (
    normalizedLabel: string,
    sourceOffset: number,
    accepts: (definitionStart: number) => boolean
  ): number | undefined => {
    const occurrenceScope = referenceScopeAt(
      regions,
      sourceOffset,
      rejectedScopeOwners
    )
    return definitionsByLabel.get(normalizedLabel)?.find((definition) =>
      accepts(definition.sourceStart) &&
      scopesAreCompatible(
        referenceScopeAt(
          regions,
          definition.sourceStart,
          rejectedScopeOwners
        ),
        occurrenceScope
      )
    )?.sourceStart
  }
  return Object.freeze({
    size,
    definitionFacts: Object.freeze(() => definitionFacts),
    definitionStartMatching: Object.freeze(definitionStartMatching),
    hasAny: Object.freeze((normalizedLabel: string): boolean =>
      definitionsByLabel.has(normalizedLabel)),
    definitionStart: Object.freeze((
      normalizedLabel: string,
      sourceOffset: number
    ): number | undefined =>
      definitionStartMatching(
        normalizedLabel,
        sourceOffset,
        () => true
      )),
    has: Object.freeze((normalizedLabel: string, sourceOffset: number): boolean => {
      return definitionStartMatching(
        normalizedLabel,
        sourceOffset,
        () => true
      ) !== undefined
    }),
    rejectDelimiterCandidate: Object.freeze((candidateStart: number): void => {
      rejectedScopeOwners.add(candidateStart)
    })
  })
}
