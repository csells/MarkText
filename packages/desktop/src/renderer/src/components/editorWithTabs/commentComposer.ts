// Sidebar-backed replacement for the CriticMarkup comment prompt modal.
//
// The Review executor acquires a comment's text through a
// `requestText('comment')` promise; the modal used to satisfy it. This
// composer satisfies the same promise from the sidebar instead: `request()`
// opens the compose box and resolves once the box submits (or cancels).
// muya persists the editor selection across the focus change, so the resolved
// text still wraps the originally selected span when the executor calls
// `createCriticMarkup`.

export interface ICommentComposer {
  /** Begin composing; resolves with the submitted text, or null if cancelled. */
  request: () => Promise<string | null>
  /** Resolve the in-flight composition with the box's text. */
  submit: (text: string) => void
  /** Abandon the in-flight composition. */
  cancel: () => void
  /** Whether a composition is currently awaiting the box. */
  readonly active: boolean
}

export function createCommentComposer(
  onActiveChange: (active: boolean) => void
): ICommentComposer {
  let pending: ((value: string | null) => void) | null = null

  const settle = (value: string | null): void => {
    if (!pending) return
    const resolve = pending
    pending = null
    onActiveChange(false)
    resolve(value)
  }

  return {
    request(): Promise<string | null> {
      // Starting a new comment abandons any half-composed one rather than
      // stranding its promise.
      settle(null)
      onActiveChange(true)
      return new Promise<string | null>((resolve) => {
        pending = resolve
      })
    },
    submit(text: string): void {
      settle(text)
    },
    cancel(): void {
      settle(null)
    },
    get active(): boolean {
      return pending !== null
    }
  }
}
