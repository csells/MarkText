import { FORM_DEFINITIONS, type FormDefinition, type Profile1CriticKind } from './internal/profile1/sourceTape.js'

/** Every marker spelling: each form's opener, closer, and Substitution's divider. */
export const CRITIC_MARKERS: readonly string[] = Object.freeze(FORM_DEFINITIONS.flatMap(({ open, separator, close }) =>
  separator === undefined ? [open, close] : [open, separator, close]))

/**
 * A regular-expression alternation, ungrouped, matching any one marker. No
 * two markers can start at the same offset, so its order never decides a match.
 */
export const CRITIC_MARKER_ALTERNATION = CRITIC_MARKERS
  .map(marker => marker.replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&'))
  .join('|')

/** Every marker, matched globally: replacing with it rewrites each marker in a text. */
export const CRITIC_MARKER = new RegExp(CRITIC_MARKER_ALTERNATION, 'gu')

const ANY_CRITIC_MARKER = new RegExp(CRITIC_MARKER_ALTERNATION, 'u')

export const containsCriticMarker = (text: string): boolean => ANY_CRITIC_MARKER.test(text)

export const CRITIC_FORM_SPELLING: Readonly<Record<Profile1CriticKind, FormDefinition>> = Object.freeze(
  Object.fromEntries(FORM_DEFINITIONS.map(definition => [definition.kind, definition])) as Record<Profile1CriticKind, FormDefinition>
)

export const CRITIC_FORM_BY_OPENER: Readonly<Record<string, Profile1CriticKind>> = Object.freeze(
  Object.fromEntries(FORM_DEFINITIONS.map(({ open, kind }) => [open, kind]))
)

export const CRITIC_FORM_BY_CLOSER: Readonly<Record<string, Profile1CriticKind>> = Object.freeze(
  Object.fromEntries(FORM_DEFINITIONS.map(({ close, kind }) => [close, kind]))
)

export const CRITIC_CLOSER_BY_OPENER: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(FORM_DEFINITIONS.map(({ open, close }) => [open, close]))
)

/** A `kind` suggestion around `text`; a Substitution proposes `proposed` after its divider. */
export function spellSuggestion(kind: Profile1CriticKind, text: string, proposed = ''): string {
  const { open, separator, close } = CRITIC_FORM_SPELLING[kind]
  return separator === undefined ? `${open}${text}${close}` : `${open}${text}${separator}${proposed}${close}`
}

/**
 * `text` as a suggestion holds it: an odd run of trailing backslashes would
 * escape the closer after it (E1), so one more backslash makes the last one
 * literal, rendering the backslash typed.
 */
export function completeTrailingEscape(text: string): string {
  let run = 0
  while (run < text.length && text[text.length - 1 - run] === '\\') run += 1
  return run % 2 === 1 ? `${text}\\` : text
}

/** A Deletion of `old` then an Addition of `next`: two suggestions in place of one Substitution. */
export function spellSuggestionPair(old: string, next: string): string {
  return spellSuggestion('deletion', old) + spellSuggestion('addition', next)
}
