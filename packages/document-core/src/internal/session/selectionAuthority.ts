import type { InitialModelSelection } from '../../documentSession.js'

/**
 * §2 Selection: the session owns the caret and range as session state in
 * both Markup and canonical-source coordinates, and owns settlement.
 * Positions cross this interface; the view reports gestures and never
 * computes a position it then submits. `settled()` is the one public
 * barrier every consumer awaits — production behavior a real user gesture
 * reaches, never a test seam.
 */
export interface SelectionAuthority {
  readonly select: (selection: InitialModelSelection) => void
  readonly selectSource: (selection: InitialModelSelection) => void
  readonly settled: () => Promise<void>
}

export interface SelectionPorts {
  /** Throws when the session is not open; selection needs a live session. */
  readonly requireOpen: () => void
  readonly moveSelection: (selection: InitialModelSelection) => void
  readonly moveSourceSelection: (selection: InitialModelSelection) => void
  /**
   * Republish the snapshot so the caret is visible to the next reader. No
   * revision is committed and no transition is emitted: the document did not
   * change, and retained drafts are untouched.
   */
  readonly republish: () => void
  /**
   * The session mailbox tail at call time. Every operation enqueued before
   * the call has settled — journal, watermark, and publication — when the
   * returned promise resolves; work enqueued afterwards is not awaited.
   */
  readonly mailboxTail: () => Promise<void>
}

export function createSelectionAuthority(
  ports: SelectionPorts
): SelectionAuthority {
  return Object.freeze({
    select: (selection: InitialModelSelection): void => {
      ports.requireOpen()
      ports.moveSelection(selection)
      ports.republish()
    },
    selectSource: (selection: InitialModelSelection): void => {
      ports.requireOpen()
      ports.moveSourceSelection(selection)
      ports.republish()
    },
    settled: async(): Promise<void> => {
      await ports.mailboxTail()
    }
  })
}
