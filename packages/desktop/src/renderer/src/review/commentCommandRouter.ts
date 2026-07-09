import type { ICommentReplyInput, TUpdateCommentThreadPatch } from '@muyajs/core'
import bus from '../bus'

// One subscription per comment command, dispatched to the ACTIVE editing
// surface. The WYSIWYG editor and the source-mode overlay used to each
// subscribe to all eight events and open every handler with a mirror-image
// mode guard ('if (sourceCode) return' vs 'if (!sourceCode) return') —
// sixteen bus registrations for eight commands, with the mode split
// re-decided per handler. Surfaces now register here instead: the overlay
// mounts only in source mode, so a mount/unmount stack IS the mode. Payloads
// are narrowed ONCE here (a malformed payload is a caller bug, thrown, never
// swallowed), so the surfaces receive typed inputs.
export interface ICommentReplyCommand {
  id: string
  reply: ICommentReplyInput
}

export interface ICommentEditCommand {
  id: string
  patch: TUpdateCommentThreadPatch
}

export interface ICommentSurface {
  addComment(): void
  reply(command: ICommentReplyCommand): void
  discard(id: string): void
  edit(command: ICommentEditCommand): void
  resolve(id: string): void
  reopen(id: string): void
  focus(id: string): void
  focusDiagnostic(id: string): void
  focusEditor(): void
}

const surfaces: ICommentSurface[] = []

const active = (): ICommentSurface | null => surfaces[surfaces.length - 1] ?? null

export const pushCommentSurface = (surface: ICommentSurface): void => {
  surfaces.push(surface)
}

export const popCommentSurface = (surface: ICommentSurface): void => {
  const index = surfaces.lastIndexOf(surface)
  if (index !== -1) surfaces.splice(index, 1)
}

const asId = (id: unknown): string => {
  if (typeof id !== 'string' || !id) throw new Error('comment command: expected a non-empty id')
  return id
}

const asReplyCommand = (payload: unknown): ICommentReplyCommand => {
  const { id, reply } = (payload ?? {}) as { id?: unknown; reply?: unknown }
  if (typeof reply !== 'object' || reply === null || typeof (reply as ICommentReplyInput).body !== 'string') {
    throw new Error('comment:reply command: expected { id, reply: { body } }')
  }
  return { id: asId(id), reply: reply as ICommentReplyInput }
}

const asEditCommand = (payload: unknown): ICommentEditCommand => {
  const { id, patch } = (payload ?? {}) as { id?: unknown; patch?: unknown }
  if (typeof patch !== 'object' || patch === null) {
    throw new Error('comment:edit command: expected { id, patch }')
  }
  return { id: asId(id), patch: patch as TUpdateCommentThreadPatch }
}

let initialized = false

export const initCommentCommandRouter = (): void => {
  if (initialized) return
  initialized = true

  bus.on('comment:add', () => active()?.addComment())
  bus.on('comment:reply', (payload: unknown) => active()?.reply(asReplyCommand(payload)))
  bus.on('comment:discard', (id: unknown) => active()?.discard(asId(id)))
  bus.on('comment:edit', (payload: unknown) => active()?.edit(asEditCommand(payload)))
  bus.on('comment:resolve', (id: unknown) => active()?.resolve(asId(id)))
  bus.on('comment:reopen', (id: unknown) => active()?.reopen(asId(id)))
  bus.on('comment:focus', (id: unknown) => active()?.focus(asId(id)))
  bus.on('comment:diagnostic-focus', (id: unknown) => active()?.focusDiagnostic(asId(id)))
  // Return focus to the ACTIVE surface's document — no longer a second
  // both-surfaces-listen dispatch whose winner depended on mitt order.
  bus.on('editor-focus', () => active()?.focusEditor())
}
