import type { TState } from '@muyajs/core'
import type Content from '@muyajs/core/block/base/content'
import type Format from '@muyajs/core/block/base/format'
import type Parent from '@muyajs/core/block/base/parent'
import type { Nullable } from '@muyajs/core/types'
import type { MuyaMarkupState } from '@/documentAuthority/muyaMarkupView'

export type { Content }

// Muya's content-walk methods (`nextContentInContext`, …) return this, which
// also admits `void`; loop variables need it declared to accept reassignment.
export type MaybeContent = Nullable<Content>

// The projected markup state is TState-shaped JSON; Muya's declarations just
// don't know about the desktop's structurally narrower projection type.
export const asMuyaStates = (states: readonly MuyaMarkupState[]): TState[] =>
  states as unknown as TState[]

// `queryBlock` can land on a container; only content leaves carry text.
export const contentText = (block: Parent | Content | undefined): string | undefined =>
  block?.isContent() ? block.text : undefined

// Inline-formatting leaves (paragraph text, headings, …) are `Format`s.
export const isFormat = (block: Content): block is Format =>
  'setEmoji' in block && typeof block.setEmoji === 'function'
