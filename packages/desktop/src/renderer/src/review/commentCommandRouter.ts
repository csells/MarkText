import bus from '../bus'

// One subscription per comment command, dispatched to the ACTIVE editing
// surface. The WYSIWYG editor and the source-mode overlay used to each
// subscribe to all eight events and open every handler with a mirror-image
// mode guard ('if (sourceCode) return' vs 'if (!sourceCode) return') —
// sixteen bus registrations for eight commands, with the mode split
// re-decided per handler. Surfaces now register here instead: the overlay
// mounts only in source mode, so a mount/unmount stack IS the mode.

export interface ICommentSurface {
  addComment(): void
  reply(payload: unknown): void
  discard(id: unknown): void
  edit(payload: unknown): void
  resolve(id: unknown): void
  reopen(id: unknown): void
  focus(id: unknown): void
  focusDiagnostic(id: unknown): void
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

let initialized = false

export const initCommentCommandRouter = (): void => {
  if (initialized) return
  initialized = true

  bus.on('comment:add', () => active()?.addComment())
  bus.on('comment:reply', (payload: unknown) => active()?.reply(payload))
  bus.on('comment:discard', (id: unknown) => active()?.discard(id))
  bus.on('comment:edit', (payload: unknown) => active()?.edit(payload))
  bus.on('comment:resolve', (id: unknown) => active()?.resolve(id))
  bus.on('comment:reopen', (id: unknown) => active()?.reopen(id))
  bus.on('comment:focus', (id: unknown) => active()?.focus(id))
  bus.on('comment:diagnostic-focus', (id: unknown) => active()?.focusDiagnostic(id))
}
