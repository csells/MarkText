import {
  DOCUMENT_SELECTION_BLOCK_KINDS,
  type DocumentFormatMenuState,
  type DocumentSelectionMenuState,
  type WindowLayoutMenuState
} from '@shared/types/documentSelection'
import type {
  CriticMarkupReviewMenuState
} from '@shared/types/criticMarkup'
export {
  decodeDocumentCapabilityMenuState,
  decodeDocumentClipboardMenuState
} from '@shared/types/documentSurface'

const FORMAT_FIELDS = Object.freeze([
  'strong',
  'em',
  'u',
  'sup',
  'sub',
  'mark',
  'inline_code',
  'inline_math',
  'del',
  'link',
  'image'
] as const satisfies readonly (keyof DocumentFormatMenuState)[])

const SELECTION_BOOLEAN_FIELDS = Object.freeze([
  'isDisabled',
  'isMultiblock',
  'isLooseList',
  'isTaskList',
  'isOrderedList',
  'isUnorderedList',
  'isCodeLike',
  'isCodeBlock',
  'isTable',
  'hasFrontMatter'
] as const satisfies readonly (keyof DocumentSelectionMenuState)[])

const SELECTION_FIELDS = Object.freeze([
  'activeBlockKinds',
  'headingLevel',
  ...SELECTION_BOOLEAN_FIELDS
])

const LAYOUT_FIELDS = Object.freeze([
  'showSideBar',
  'showTabBar',
  'sourceCode',
  'typewriter',
  'focus'
] as const satisfies readonly (keyof WindowLayoutMenuState)[])

const REVIEW_BOOLEAN_FIELDS = Object.freeze([
  'available',
  'canCreateAddition',
  'canCreateDeletion',
  'canCreateSubstitution',
  'canCreateHighlight',
  'canCreateComment',
  'canNavigate',
  'canResolveCurrent',
  'canResolveAll',
  'canRemoveAllAnnotations',
  'trackChanges'
] as const satisfies readonly (keyof CriticMarkupReviewMenuState)[])

const REVIEW_FIELDS = Object.freeze([
  ...REVIEW_BOOLEAN_FIELDS,
  'projection'
] as const satisfies readonly (keyof CriticMarkupReviewMenuState)[])

function record(
  value: unknown,
  label: string
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain closed record`)
  }
  return value as Readonly<Record<string, unknown>>
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  label: string
): void {
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key))
  ) {
    throw new TypeError(`${label} fields are not closed`)
  }
}

export function decodeDocumentFormatMenuState(
  value: unknown
): DocumentFormatMenuState {
  const state = record(value, 'Format menu state')
  exactKeys(state, FORMAT_FIELDS, 'Format menu state')
  if (FORMAT_FIELDS.some(field => typeof state[field] !== 'boolean')) {
    throw new TypeError('Format menu fields must be booleans')
  }
  return Object.freeze({ ...state }) as unknown as DocumentFormatMenuState
}

export function decodeDocumentSelectionMenuState(
  value: unknown
): DocumentSelectionMenuState {
  const state = record(value, 'Selection menu state')
  exactKeys(state, SELECTION_FIELDS, 'Selection menu state')
  if (
    !Array.isArray(state.activeBlockKinds) ||
    state.activeBlockKinds.length > 64 ||
    state.activeBlockKinds.some(
      kind =>
        typeof kind !== 'string' ||
        !DOCUMENT_SELECTION_BLOCK_KINDS.includes(
          kind as (typeof DOCUMENT_SELECTION_BLOCK_KINDS)[number]
        )
    ) ||
    new Set(state.activeBlockKinds).size !== state.activeBlockKinds.length
  ) {
    throw new TypeError('Selection block kinds are invalid or unbounded')
  }
  if (
    state.headingLevel !== null &&
    (
      typeof state.headingLevel !== 'number' ||
      !Number.isInteger(state.headingLevel) ||
      state.headingLevel < 1 ||
      state.headingLevel > 6
    )
  ) {
    throw new TypeError('Selection heading level is invalid')
  }
  if (
    SELECTION_BOOLEAN_FIELDS.some(
      field => typeof state[field] !== 'boolean'
    )
  ) {
    throw new TypeError('Selection menu flags must be booleans')
  }
  return Object.freeze({
    ...state,
    activeBlockKinds: Object.freeze([...state.activeBlockKinds])
  }) as unknown as DocumentSelectionMenuState
}

export function decodeWindowLayoutMenuState(
  value: unknown
): WindowLayoutMenuState {
  const state = record(value, 'Window layout menu state')
  const keys = Reflect.ownKeys(state)
  if (
    keys.length === 0 ||
    keys.length > LAYOUT_FIELDS.length ||
    keys.some(
      key =>
        typeof key !== 'string' ||
        !LAYOUT_FIELDS.includes(key as (typeof LAYOUT_FIELDS)[number]) ||
        typeof state[key] !== 'boolean'
    )
  ) {
    throw new TypeError('Window layout menu state fields are not closed')
  }
  return Object.freeze({ ...state }) as WindowLayoutMenuState
}

export function decodeCriticMarkupReviewMenuState(
  value: unknown
): CriticMarkupReviewMenuState {
  const state = record(value, 'Review menu state')
  exactKeys(state, REVIEW_FIELDS, 'Review menu state')
  if (
    REVIEW_BOOLEAN_FIELDS.some(field => typeof state[field] !== 'boolean') ||
    (
      state.projection !== 'marked' &&
      state.projection !== 'original' &&
      state.projection !== 'revised'
    )
  ) {
    throw new TypeError('Review menu state fields are invalid')
  }
  return Object.freeze({ ...state }) as unknown as CriticMarkupReviewMenuState
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean`)
  }
  return value
}

export const decodeSidebarMenuVisibility = (value: unknown): boolean =>
  boolean(value, 'Sidebar menu visibility')

