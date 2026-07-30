import type { InitialModelSelection } from '../../documentSession.js'
import type { SourceEdit } from './sourceTransaction.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'

/**
 * The section 2 History module: one owner of the undo and redo record —
 * what an entry contains, the one-gesture-one-entry coalescing rule, the
 * cursor, and the exhaustion states. It never re-derives edits, calls the
 * parser, or mints saved identity: recording reports what happened and the
 * caller coordinates the saved-identity ledger from that report.
 */
export interface HistoryEntry {
  readonly forward: readonly SourceEdit[]
  readonly inverse: readonly SourceEdit[]
  readonly beforeSelection: InitialModelSelection
  readonly afterSelection: InitialModelSelection
  readonly beforeSourceSelection: InitialModelSelection
  readonly afterSourceSelection: InitialModelSelection
}

function freezeSourceEdit(edit: SourceEdit): SourceEdit {
  return Object.freeze({
    start: edit.start,
    end: edit.end,
    insert: edit.insert
  })
}

function freezeInitialSelection(
  selection: InitialModelSelection
): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({
      offset: selection.anchor.offset,
      affinity: selection.anchor.affinity
    }),
    focus: Object.freeze({
      offset: selection.focus.offset,
      affinity: selection.focus.affinity
    })
  })
}

export function freezeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  if (
    entry.forward.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction ||
    entry.inverse.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
  ) {
    throw new Error('Revision worker history exceeds the source-edit policy')
  }
  const insertUnits = [...entry.forward, ...entry.inverse].reduce(
    (total, edit) => total + edit.insert.length,
    0
  )
  if (
    insertUnits >
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits
  ) {
    throw new Error('Revision worker history exceeds the insert-unit policy')
  }
  return Object.freeze({
    forward: Object.freeze(entry.forward.map((edit) => freezeSourceEdit(edit))),
    inverse: Object.freeze(entry.inverse.map((edit) => freezeSourceEdit(edit))),
    beforeSelection: freezeInitialSelection(entry.beforeSelection),
    afterSelection: freezeInitialSelection(entry.afterSelection),
    beforeSourceSelection: freezeInitialSelection(entry.beforeSourceSelection),
    afterSourceSelection: freezeInitialSelection(entry.afterSourceSelection)
  })
}

/** The entry's one edit, when it is a pure insertion of one Unicode scalar. */
function singleScalarPureInsert(
  entry: HistoryEntry
): Readonly<{ position: number; scalar: string }> | null {
  const edit = entry.forward[0]
  if (
    entry.forward.length !== 1 ||
    edit === undefined ||
    edit.start !== edit.end ||
    [...edit.insert].length !== 1
  ) {
    return null
  }
  return Object.freeze({ position: edit.start, scalar: edit.insert })
}

/** The open entry's shape when it is one pure insertion run. */
function pureInsertRun(
  entry: HistoryEntry
): Readonly<{ position: number; text: string }> | null {
  const edit = entry.forward[0]
  if (
    entry.forward.length !== 1 ||
    edit === undefined ||
    edit.start !== edit.end ||
    edit.insert.length === 0
  ) {
    return null
  }
  return Object.freeze({ position: edit.start, text: edit.insert })
}

function isWhitespaceScalar(scalar: string): boolean {
  return /^\s$/u.test(scalar)
}

export type HistoryRecordOutcome =
  | Readonly<{ kind: 'extended' }>
  | Readonly<{ kind: 'recorded'; compacted: number }>

export interface HistoryRecordLimits {
  readonly maximumEntries: number
  readonly maximumInsertUnits: number
}

export interface HistoryRecord {
  /**
   * Record one admitted gesture. A coalescible single-scalar insertion that
   * lands at the caret the open typed run left — and does not start a new
   * word after whitespace — extends the open entry in place ('extended');
   * anything else records its own entry ('recorded'), reporting how many
   * oldest entries the retention limits compacted away.
   */
  readonly record: (
    entry: HistoryEntry,
    coalescible: boolean
  ) => HistoryRecordOutcome
  /** The entry an undo would replay, without moving the cursor. */
  readonly undo: () => HistoryEntry | null
  /** The entry a redo would replay, without moving the cursor. */
  readonly redo: () => HistoryEntry | null
  /**
   * Confirm a committed replay. The cursor moves only here, so a rejected
   * replay never desynchronizes it; any confirmation seals the typed run.
   */
  readonly applied: (action: 'undo' | 'redo') => void
  /**
   * Seal the open typed run: a selection move, persistence, or restoration
   * means the next insertion starts its own entry.
   */
  readonly seal: () => void
  readonly state: () => Readonly<{ canUndo: boolean; canRedo: boolean }>
  readonly cursor: () => number
  readonly checkpoint: () => Readonly<{
    entries: readonly HistoryEntry[]
    cursor: number
  }>
}

export function createHistoryRecord(
  limits: HistoryRecordLimits,
  recovered?: Readonly<{
    entries: readonly HistoryEntry[]
    cursor: number
  }>
): HistoryRecord {
  let entries: HistoryEntry[] =
    recovered === undefined
      ? []
      : recovered.entries.map((entry) => freezeHistoryEntry(entry))
  let cursor = recovered?.cursor ?? 0
  let openTypedRun: Readonly<{
    caret: number
    lastScalar: string
  }> | null = null

  const insertUnitsOf = (entry: HistoryEntry): number =>
    [...entry.forward, ...entry.inverse].reduce(
      (total, edit) => total + edit.insert.length,
      0
    )

  const extendTypedRun = (
    entry: HistoryEntry,
    coalescible: boolean
  ): boolean => {
    const run = openTypedRun
    const open = entries[cursor - 1]
    if (
      run === null ||
      open === undefined ||
      !coalescible ||
      cursor !== entries.length
    ) {
      return false
    }
    const single = singleScalarPureInsert(entry)
    const openRun = pureInsertRun(open)
    if (
      single === null ||
      openRun === null ||
      single.position !== run.caret ||
      openRun.position + openRun.text.length !== single.position ||
      (isWhitespaceScalar(run.lastScalar) &&
        !isWhitespaceScalar(single.scalar))
    ) {
      return false
    }
    const text = openRun.text + single.scalar
    entries[cursor - 1] = freezeHistoryEntry(Object.freeze({
      forward: Object.freeze([Object.freeze({
        start: openRun.position,
        end: openRun.position,
        insert: text
      })]),
      inverse: Object.freeze([Object.freeze({
        start: openRun.position,
        end: openRun.position + text.length,
        insert: ''
      })]),
      beforeSelection: open.beforeSelection,
      afterSelection: entry.afterSelection,
      beforeSourceSelection: open.beforeSourceSelection,
      afterSourceSelection: entry.afterSourceSelection
    }))
    openTypedRun = Object.freeze({
      caret: single.position + single.scalar.length,
      lastScalar: single.scalar
    })
    return true
  }

  return Object.freeze({
    record: (
      entry: HistoryEntry,
      coalescible: boolean
    ): HistoryRecordOutcome => {
      if (extendTypedRun(entry, coalescible)) {
        return Object.freeze({ kind: 'extended' as const })
      }
      const single = singleScalarPureInsert(entry)
      openTypedRun = coalescible && single !== null
        ? Object.freeze({
          caret: single.position + single.scalar.length,
          lastScalar: single.scalar
        })
        : null
      entries = entries.slice(0, cursor)
      entries.push(freezeHistoryEntry(entry))
      cursor += 1
      let insertUnits = entries.reduce(
        (total, recorded) => total + insertUnitsOf(recorded),
        0
      )
      let compacted = 0
      while (
        entries.length > limits.maximumEntries ||
        insertUnits > limits.maximumInsertUnits
      ) {
        const removed = entries.shift()
        if (removed === undefined) {
          throw new Error('Revision worker could not compact its history')
        }
        insertUnits -= insertUnitsOf(removed)
        cursor -= 1
        compacted += 1
      }
      return Object.freeze({ kind: 'recorded' as const, compacted })
    },
    undo: (): HistoryEntry | null => entries[cursor - 1] ?? null,
    redo: (): HistoryEntry | null => entries[cursor] ?? null,
    applied: (action: 'undo' | 'redo'): void => {
      openTypedRun = null
      cursor += action === 'undo' ? -1 : 1
      if (cursor < 0 || cursor > entries.length) {
        throw new Error('History replay moved outside the recorded entries')
      }
    },
    seal: (): void => {
      openTypedRun = null
    },
    state: () => Object.freeze({
      canUndo: cursor > 0,
      canRedo: cursor < entries.length
    }),
    cursor: (): number => cursor,
    checkpoint: () => Object.freeze({
      entries: Object.freeze(entries.map((entry) => freezeHistoryEntry(entry))),
      cursor
    })
  })
}
