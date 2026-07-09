import { describe, expect, it } from 'vitest'
import {
  initialMergeSessionState,
  reduceMergeSession,
  type MergeSessionEffect,
  type MergeSessionEvent,
  type MergeSessionState
} from '@/store/mergeSession'
import type { FileChangePayload } from '@/store/editorPersistence'
import type { ThreeWayMergeConflict } from '@/util/threeWayMerge'

// The merge-session reducer decision table (external-merge.md §The session
// reducer): every dirty-external-merge behavior restated as pure
// state+event → state+effects transitions, plus the four fuzz invariants.
// The reducer performs no IO and touches no store, so this file needs no
// mocks — that isolation is the point of the shape.

const BASE = 'one\nshared\nthree\n'
const LOCAL = 'one\nlocal\nthree\n'
const REMOTE = 'one\nshared\nTHREE\n'
const MERGED = 'one\nlocal\nTHREE\n'

const SCAFFOLD = '<<<<<<< MARKTEXT_LOCAL c1\nlocal\n=======\nremote\n>>>>>>> MARKTEXT_REMOTE c1\n'

const change = (markdown: string): FileChangePayload =>
  ({
    pathname: '/x/a.md',
    data: { filename: 'a.md', pathname: '/x/a.md', markdown }
  }) as FileChangePayload

const conflictStub: ThreeWayMergeConflict = {
  id: 'c-1',
  baseStartLine: 1,
  baseEndLine: 2,
  baseText: 'shared\n',
  localText: 'local\n',
  remoteText: 'remote\n',
  markerText: SCAFFOLD
}

const metadata = (body: string): string =>
  `data:application/json;base64,${Buffer.from(
    JSON.stringify({
      version: 1,
      status: 'open',
      replies: [{ author: 'Agent', createdAt: '2026-06-30T12:00:00.000Z', body }]
    })
  ).toString('base64')}`

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

// Every reduction in this suite runs on frozen inputs: a reducer that
// mutates its arguments throws instead of passing by accident.
const reduce = (
  state: MergeSessionState,
  event: MergeSessionEvent
): ReturnType<typeof reduceMergeSession> => reduceMergeSession(deepFreeze(state), deepFreeze(event))

const diskChanged = (
  remote: string,
  overrides: Partial<Omit<Extract<MergeSessionEvent, { type: 'disk-changed' }>, 'type'>> = {}
): MergeSessionEvent => ({
  type: 'disk-changed',
  fileChange: change(remote),
  local: LOCAL,
  base: BASE,
  persistenceEqual: true,
  // Default local (LOCAL) !== base (BASE): a dirty tab. Clean-tab cases
  // override both base and dirty.
  dirty: true,
  ...overrides
})

const effectTypes = (effects: MergeSessionEffect[]): string[] => effects.map((e) => e.type)

const only = <T extends MergeSessionEffect['type']>(
  effects: MergeSessionEffect[],
  type: T
): Extract<MergeSessionEffect, { type: T }> => {
  const matches = effects.filter(
    (e): e is Extract<MergeSessionEffect, { type: T }> => e.type === type
  )
  expect(matches, `expected exactly one ${type} effect in [${effectTypes(effects)}]`).toHaveLength(1)
  return matches[0]
}

const asMerging = (state: MergeSessionState): Extract<MergeSessionState, { kind: 'merging' }> => {
  if (state.kind !== 'merging') throw new Error(`expected merging state, got ${state.kind}`)
  return state
}

const asReviewing = (
  state: MergeSessionState
): Extract<MergeSessionState, { kind: 'reviewing' }> => {
  if (state.kind !== 'reviewing') throw new Error(`expected reviewing state, got ${state.kind}`)
  return state
}

const toMerging = (remote = REMOTE): Extract<MergeSessionState, { kind: 'merging' }> =>
  asMerging(reduce(initialMergeSessionState(), diskChanged(remote)).state)

const resolved = (
  requestId: number,
  merged: string,
  conflicts: ThreeWayMergeConflict[] = []
): MergeSessionEvent => ({ type: 'merge-resolved', requestId, merged, conflicts })

const toReviewing = (): Extract<MergeSessionState, { kind: 'reviewing' }> => {
  const merging = toMerging()
  return asReviewing(reduce(merging, resolved(merging.requestId, MERGED, [conflictStub])).state)
}

describe('merge-session reducer — decision table', () => {
  it('byte + persistence identical is absorbed (mark clean, no reload); a persistence diff reloads dirty', () => {
    // The reducer now owns the #1861 absorb decision the watcher used to make:
    // when the incoming disk content is byte-identical to the buffer AND the
    // persistence snapshot matches, mark the tab clean without churning the
    // engine (no reload).
    const absorbed = reduce(initialMergeSessionState(), diskChanged(LOCAL, { local: LOCAL }))
    expect(absorbed.state.kind).toBe('idle')
    expect(only(absorbed.effects, 'absorb')).toMatchObject({
      fileChange: { data: { markdown: LOCAL } }
    })

    // Byte-identical but a persistence diff (encoding/line-ending) is not a
    // no-op: reload to pick it up, and a byte-affecting persistence change
    // must not silently clear a dirty tab.
    const persistenceDiff = reduce(
      initialMergeSessionState(),
      diskChanged(LOCAL, { local: LOCAL, persistenceEqual: false })
    )
    expect(only(persistenceDiff.effects, 'load-disk')).toMatchObject({
      reason: 'local-matches-remote',
      preserveDirty: true
    })
  })

  it('a persistence-only change on a CLEAN tab reloads clean — it must not spuriously dirty', () => {
    // Clean tab (buffer == base == disk text) whose disk copy was re-encoded
    // externally (e.g. LF -> CRLF, same text). The user made no edit, so the
    // tab adopts the new persistence and stays clean; marking it dirty would
    // be a phantom unsaved-changes flag.
    const clean = reduce(
      initialMergeSessionState(),
      diskChanged(LOCAL, { local: LOCAL, base: LOCAL, persistenceEqual: false, dirty: false })
    )
    expect(only(clean.effects, 'load-disk')).toMatchObject({
      reason: 'local-matches-remote',
      preserveDirty: false
    })

    // The flip side: a flag-dirty tab whose buffer matches the base (an
    // edit-then-revert) must STAY dirty through the same persistence change.
    const flagDirty = reduce(
      initialMergeSessionState(),
      diskChanged(LOCAL, { local: LOCAL, base: LOCAL, persistenceEqual: false, dirty: true })
    )
    expect(only(flagDirty.effects, 'load-disk').preserveDirty).toBe(true)
  })

  it('a clean tab (buffer == base, no local edits) reloads the disk change, never merges', () => {
    // The watcher used to pre-filter clean tabs to a plain loadChange; the
    // reducer now owns it: no local divergence from the base means a disk
    // change is a reload, not a three-way merge.
    const { state, effects } = reduce(
      initialMergeSessionState(),
      diskChanged(REMOTE, { local: BASE })
    )
    expect(state.kind).toBe('idle')
    expect(effectTypes(effects)).not.toContain('start-merge')
    expect(only(effects, 'load-disk')).toMatchObject({
      reason: 'clean-tab-reload',
      preserveDirty: false
    })
  })

  it('a clean tab under an explicit review intent merges into a review, never a silent reload', () => {
    // The user clicked Review on a prior session (forceReview carried across a
    // supersede). A clean tab would normally reload, but that would drop the
    // Review click — the change must instead surface the resolver.
    const { state, effects } = reduce(
      initialMergeSessionState(),
      diskChanged(REMOTE, { local: BASE, forceReview: true })
    )
    expect(effectTypes(effects)).not.toContain('load-disk')
    expect(asMerging(state).forceReview).toBe(true)
    expect(only(effects, 'start-merge')).toMatchObject({ base: BASE, local: BASE, remote: REMOTE })
  })

  it('a dirty tab without a recorded base opens the whole-file resolver, never auto-applies', () => {
    const { state, effects } = reduce(
      initialMergeSessionState(),
      diskChanged(REMOTE, { base: undefined })
    )

    const open = only(effects, 'open-resolver')
    expect(effectTypes(effects)).toEqual(['open-resolver'])
    expect(open.withNotification).toBe(true)
    expect(open.session.conflicts.length).toBeGreaterThan(0)
    expect(open.session.paneBase).toBe('')
    expect(open.session.expectedDiskBase).toBeUndefined()
    expect(open.session.result).toContain('local')
    expect(open.session.result).toContain('THREE')
    expect(asReviewing(state).session).toBe(open.session)
  })

  it('remote === base is ignored: disk has nothing new relative to the edit base', () => {
    const idle = reduce(initialMergeSessionState(), diskChanged(BASE))
    expect(idle.state.kind).toBe('idle')
    expect(idle.effects).toEqual([])

    // While merging, a base-echo does not supersede the in-flight request.
    const merging = toMerging()
    const echoed = reduce(merging, diskChanged(BASE))
    expect(asMerging(echoed.state).requestId).toBe(merging.requestId)
    expect(echoed.effects).toEqual([])
  })

  it('a genuinely new remote starts a three-way merge', () => {
    const { state, effects } = reduce(initialMergeSessionState(), diskChanged(REMOTE))

    const merging = asMerging(state)
    expect(only(effects, 'start-merge')).toMatchObject({
      requestId: merging.requestId,
      base: BASE,
      local: LOCAL,
      remote: REMOTE
    })
  })

  it('a newer disk change supersedes the in-flight merge; the stale resolution is a no-op', () => {
    const first = toMerging()
    const newerRemote = 'one\nshared\nNEWEST\n'
    const superseded = reduce(first, diskChanged(newerRemote))

    const second = asMerging(superseded.state)
    expect(second.requestId).not.toBe(first.requestId)
    expect(only(superseded.effects, 'start-merge').remote).toBe(newerRemote)

    const stale = reduce(second, resolved(first.requestId, MERGED))
    expect(stale.state).toBe(second)
    expect(stale.effects).toEqual([])

    const fresh = reduce(second, resolved(second.requestId, 'one\nlocal\nNEWEST\n'))
    expect(fresh.state.kind).toBe('idle')
    expect(only(fresh.effects, 'apply-merge').fileChange.data.markdown).toBe(newerRemote)
  })

  it('request ids stay monotonic across idle round-trips — an abandoned request can never collide', () => {
    const first = toMerging()
    const abandoned = reduce(first, { type: 'buffer-edited', local: 'one\nEDITED\nthree\n' })
    expect(abandoned.state.kind).toBe('idle')

    const second = asMerging(
      reduce(abandoned.state, diskChanged(REMOTE, { local: 'one\nEDITED\nthree\n' })).state
    )
    expect(second.requestId).not.toBe(first.requestId)

    // The abandoned request's resolution finds no matching state.
    const stale = reduce(second, resolved(first.requestId, MERGED))
    expect(stale.effects).toEqual([])
  })

  it('a clean resolution auto-applies the newest remote and returns to idle', () => {
    const merging = toMerging()
    const { state, effects } = reduce(merging, resolved(merging.requestId, MERGED))

    expect(state.kind).toBe('idle')
    expect(only(effects, 'apply-merge')).toMatchObject({
      origin: 'auto',
      merged: MERGED,
      base: BASE,
      local: LOCAL,
      markClean: false
    })
    expect(only(effects, 'apply-merge').fileChange.data.markdown).toBe(REMOTE)
    expect(effectTypes(effects)).not.toContain('open-resolver')
  })

  // The remote subsumed the local edits: the merge output equals the disk
  // bytes, so the tab is truthfully clean after the apply. The reducer owns
  // that decision — the interpreter must not re-derive it.
  it('a clean resolution whose output equals the disk content applies markClean', () => {
    const merging = toMerging()
    const { state, effects } = reduce(merging, resolved(merging.requestId, REMOTE))

    expect(state.kind).toBe('idle')
    expect(only(effects, 'apply-merge')).toMatchObject({
      origin: 'auto',
      merged: REMOTE,
      markClean: true
    })
  })

  it('a clean resolution under forceReview opens the resolver with zero conflict rows', () => {
    const merging = asMerging(
      reduce(initialMergeSessionState(), diskChanged(REMOTE, { forceReview: true })).state
    )
    const { state, effects } = reduce(merging, resolved(merging.requestId, MERGED))

    const open = only(effects, 'open-resolver')
    expect(open.session.conflicts).toEqual([])
    expect(open.session.result).toBe(MERGED)
    expect(open.session.paneBase).toBe(BASE)
    expect(open.session.paneLocal).toBe(LOCAL)
    expect(asReviewing(state).session).toBe(open.session)
    expect(effectTypes(effects)).not.toContain('apply-merge')
  })

  it('escalation gate: a clean merge that introduces comment diagnostics neither side had opens the resolver', () => {
    const localDef = `[MC:x]: ${metadata('Local note.')}`
    const remoteDef = `[MC:x]: ${metadata('Agent note.')}`
    const base = 'aaa\nbbb\nccc\nddd\neee\n'
    const local = `<!--MC:x-->aaa<!--MC:~x-->\n${localDef}\nccc\nddd\neee\n`
    const remote = `aaa\nbbb\nccc\n<!--MC:x-->ddd<!--MC:~x-->\n${remoteDef}\n`
    const merged = `<!--MC:x-->aaa<!--MC:~x-->\n${localDef}\nccc\n<!--MC:x-->ddd<!--MC:~x-->\n${remoteDef}\n`

    const merging = asMerging(
      reduce(initialMergeSessionState(), diskChanged(remote, { local, base })).state
    )
    const { state, effects } = reduce(merging, resolved(merging.requestId, merged))

    expect(effectTypes(effects)).not.toContain('apply-merge')
    const open = only(effects, 'open-resolver')
    expect(open.session.conflicts).toEqual([])
    expect(open.session.result).toBe(merged)
    expect(state.kind).toBe('reviewing')
  })

  it('a pre-existing diagnostic that only shifted offsets still auto-applies', () => {
    const orphan = `[MC:zz]: ${metadata('Stale note.')}`
    const base = `one\nshared\nthree\n\n${orphan}\n`
    const local = `one\nlocal\nthree\n\n${orphan}\n`
    const remote = `zero\none\nshared\nthree\n\n${orphan}\n`
    const merged = `zero\none\nlocal\nthree\n\n${orphan}\n`

    const merging = asMerging(
      reduce(initialMergeSessionState(), diskChanged(remote, { local, base })).state
    )
    const { state, effects } = reduce(merging, resolved(merging.requestId, merged))

    expect(state.kind).toBe('idle')
    expect(only(effects, 'apply-merge').merged).toBe(merged)
  })

  it('a conflicting resolution opens the resolver carrying the conflict rows', () => {
    const merging = toMerging()
    const { state, effects } = reduce(
      merging,
      resolved(merging.requestId, `one\n${SCAFFOLD}three\n`, [conflictStub])
    )

    const open = only(effects, 'open-resolver')
    expect(open.withNotification).toBe(true)
    expect(open.session.conflicts).toEqual([conflictStub])
    expect(open.session.expectedLocal).toBe(LOCAL)
    expect(open.session.expectedDiskBase).toBe(BASE)
    expect(asReviewing(state).session.sessionId).toBe(open.session.sessionId)
  })

  it('a buffer edit abandons the in-flight merge; its late resolution does nothing', () => {
    const merging = toMerging()
    const edited = reduce(merging, { type: 'buffer-edited', local: 'one\nEDITED\nthree\n' })
    expect(edited.state.kind).toBe('idle')
    expect(edited.effects).toEqual([])

    const late = reduce(edited.state, resolved(merging.requestId, MERGED))
    expect(late.effects).toEqual([])
  })

  it('a failed live merge degrades to the whole-file resolver; a stale failure is a no-op', () => {
    const merging = toMerging()
    const failed = reduce(merging, { type: 'merge-failed', requestId: merging.requestId })
    const open = only(failed.effects, 'open-resolver')
    expect(open.session.paneBase).toBe(BASE)
    expect(open.session.conflicts.length).toBeGreaterThan(0)
    expect(open.session.result).toContain('local')
    expect(open.session.result).toContain('THREE')

    const second = asMerging(reduce(toMerging(), diskChanged('one\nshared\nNEWEST\n')).state)
    const stale = reduce(second, { type: 'merge-failed', requestId: second.requestId - 1 })
    expect(stale.state).toBe(second)
    expect(stale.effects).toEqual([])
  })

  it('a newer disk change supersedes an open session: close, re-derive, stay headed for review', () => {
    const reviewing = toReviewing()
    const newerRemote = 'one\nshared\nNEWEST\n'
    const superseded = reduce(reviewing, diskChanged(newerRemote))

    expect(effectTypes(superseded.effects)).toEqual(['close-resolver', 'start-merge'])
    const merging = asMerging(superseded.state)
    expect(merging.remote).toBe(newerRemote)

    // The re-derivation reviews even a clean result, with a fresh session.
    const rederived = reduce(merging, resolved(merging.requestId, 'one\nlocal\nNEWEST\n'))
    const open = only(rederived.effects, 'open-resolver')
    expect(open.session.sessionId).toBeGreaterThan(reviewing.session.sessionId)
    expect(open.session.remote).toBe(newerRemote)
  })

  it('a disk change matching the buffer closes the session and absorbs clean (no reload)', () => {
    const reviewing = toReviewing()
    const { state, effects } = reduce(reviewing, diskChanged(LOCAL, { local: LOCAL }))

    // Byte + persistence identical: supersede the dead session and mark clean
    // without churning the engine — the buffer already holds this content.
    expect(effectTypes(effects)).toEqual(['close-resolver', 'absorb'])
    expect(state.kind).toBe('idle')
  })

  it('accept on a live session validates, applies as accepted, and clears the session', () => {
    const reviewing = toReviewing()
    const correctedResult = MERGED
    const { state, effects } = reduce(reviewing, {
      type: 'accept',
      result: correctedResult,
      persistenceEqual: true
    })

    expect(effectTypes(effects)).toEqual(['close-resolver', 'apply-merge'])
    expect(only(effects, 'apply-merge')).toMatchObject({
      origin: 'accepted',
      merged: correctedResult,
      // Accept keeps the tab dirty even when the result matches disk.
      markClean: false
    })
    expect(state.kind).toBe('idle')
  })

  it('accept refuses unresolved conflict scaffolding and keeps the session open', () => {
    const reviewing = toReviewing()
    const mangled = `one\n${SCAFFOLD}three\n`
    const { state, effects } = reduce(reviewing, {
      type: 'accept',
      result: mangled,
      persistenceEqual: true
    })

    expect(effectTypes(effects)).toEqual(['validation-error'])
    expect(only(effects, 'validation-error')).toMatchObject({
      code: 'unresolved-conflict',
      result: mangled
    })
    expect(state).toBe(reviewing)
  })

  it('accept refuses a result that introduces comment diagnostics neither pane had', () => {
    const reviewing = toReviewing()
    const corrupted = 'one\n<!--MC:missing-->commented<!--MC:~missing-->\nthree\n'
    const { state, effects } = reduce(reviewing, {
      type: 'accept',
      result: corrupted,
      persistenceEqual: true
    })

    expect(only(effects, 'validation-error')).toMatchObject({
      code: 'invalid-comment-syntax',
      result: corrupted
    })
    expect(asReviewing(state).session.sessionId).toBe(reviewing.session.sessionId)
  })

  it('accept after a buffer edit re-derives against the new buffer instead of applying stale content', () => {
    const reviewing = toReviewing()
    const editedLocal = 'one\nlocal EDITED\nthree\n'
    const edited = asReviewing(reduce(reviewing, { type: 'buffer-edited', local: editedLocal }).state)

    const { state, effects } = reduce(edited, {
      type: 'accept',
      result: MERGED,
      persistenceEqual: true
    })

    expect(effectTypes(effects)).toEqual(['close-resolver', 'start-merge'])
    expect(only(effects, 'start-merge')).toMatchObject({
      base: BASE,
      local: editedLocal,
      remote: REMOTE
    })

    // The re-derivation must review, not silently auto-apply.
    const merging = asMerging(state)
    const rederived = reduce(merging, resolved(merging.requestId, 'one\nlocal EDITED\nTHREE\n'))
    expect(effectTypes(rederived.effects)).toContain('open-resolver')
  })

  it('accept after a save closes the dead session without applying or re-deriving', () => {
    const reviewing = toReviewing()
    const saved = asReviewing(reduce(reviewing, { type: 'saved' }).state)

    const { state, effects } = reduce(saved, {
      type: 'accept',
      result: MERGED,
      persistenceEqual: true
    })

    expect(effectTypes(effects)).toEqual(['close-resolver'])
    expect(state.kind).toBe('idle')
  })

  it('accept with no open session is a no-op', () => {
    const { state, effects } = reduce(initialMergeSessionState(), {
      type: 'accept',
      result: MERGED,
      persistenceEqual: true
    })
    expect(state.kind).toBe('idle')
    expect(effects).toEqual([])
  })

  it('cancel keeps the buffer untouched: close the resolver, nothing else', () => {
    const reviewing = toReviewing()
    const { state, effects } = reduce(reviewing, { type: 'cancel' })

    expect(effectTypes(effects)).toEqual(['close-resolver'])
    expect(state.kind).toBe('idle')
  })

  it('reload-disk preserves the buffer in a recovery tab before loading disk', () => {
    const reviewing = toReviewing()
    const { state, effects } = reduce(reviewing, { type: 'reload-disk' })

    // Order matters: the recovery tab must exist before the reload replaces
    // the buffer.
    expect(effectTypes(effects)).toEqual(['close-resolver', 'create-recovery-tab', 'load-disk'])
    expect(only(effects, 'load-disk')).toMatchObject({
      reason: 'reload-disk',
      fileChange: reviewing.session.fileChange
    })
    expect(state.kind).toBe('idle')
  })

  it('reload-disk on a stale session closes it without loading dead disk bytes', () => {
    const reviewing = toReviewing()
    const edited = reduce(reviewing, { type: 'buffer-edited', local: 'one\nEDITED\nthree\n' }).state

    const { state, effects } = reduce(edited, { type: 'reload-disk' })
    expect(effectTypes(effects)).toEqual(['close-resolver'])
    expect(state.kind).toBe('idle')
  })

  it('review-requested with an unchanged buffer reopens the resolver silently with a fresh session id', () => {
    const reviewing = toReviewing()
    const cancelled = reduce(reviewing, { type: 'cancel' }).state
    const { session } = reviewing

    const { state, effects } = reduce(cancelled, {
      type: 'review-requested',
      paneBase: session.paneBase,
      paneLocal: session.paneLocal,
      expectedLocal: session.expectedLocal,
      expectedDiskBase: session.expectedDiskBase,
      result: session.result,
      conflicts: session.conflicts,
      fileChange: session.fileChange,
      currentLocal: session.expectedLocal,
      currentBase: session.expectedDiskBase,
      persistenceEqual: true
    })

    const open = only(effects, 'open-resolver')
    expect(open.withNotification).toBe(false)
    expect(open.session.sessionId).toBeGreaterThan(session.sessionId)
    expect(open.session.result).toBe(session.result)
    expect(state.kind).toBe('reviewing')
  })

  it('review-requested with a moved buffer re-derives against current reality', () => {
    const reviewing = toReviewing()
    const cancelled = reduce(reviewing, { type: 'cancel' }).state
    const { session } = reviewing
    const editedLocal = 'one\nlocal EDITED\nthree\n'

    const { state, effects } = reduce(cancelled, {
      type: 'review-requested',
      paneBase: session.paneBase,
      paneLocal: session.paneLocal,
      expectedLocal: session.expectedLocal,
      expectedDiskBase: session.expectedDiskBase,
      result: session.result,
      conflicts: session.conflicts,
      fileChange: session.fileChange,
      currentLocal: editedLocal,
      currentBase: session.expectedDiskBase,
      persistenceEqual: true
    })

    expect(only(effects, 'start-merge')).toMatchObject({ local: editedLocal, remote: REMOTE })
    expect(asMerging(state).forceReview).toBe(true)
  })

  it('review-requested while a re-derivation is in flight forces its result into review', () => {
    // The user clicked Review on an earlier notification while a newer merge
    // is in flight. The click must not be discarded: the in-flight merge is
    // upgraded to forceReview so even a clean resolution opens the resolver
    // ("an explicit review request never silently auto-applies").
    const merging = toMerging()
    expect(merging.forceReview).toBe(false)

    const { state, effects } = reduce(merging, {
      type: 'review-requested',
      paneBase: BASE,
      paneLocal: LOCAL,
      expectedLocal: LOCAL,
      expectedDiskBase: BASE,
      result: MERGED,
      conflicts: [],
      fileChange: change(REMOTE),
      currentLocal: LOCAL,
      currentBase: BASE,
      persistenceEqual: true
    })

    expect(effects).toEqual([])
    const upgraded = asMerging(state)
    expect(upgraded.forceReview).toBe(true)
    expect(upgraded.requestId).toBe(merging.requestId)

    const done = reduce(upgraded, resolved(upgraded.requestId, REMOTE))
    expect(effectTypes(done.effects)).not.toContain('apply-merge')
    const open = only(done.effects, 'open-resolver')
    expect(open.session.conflicts).toEqual([])
    expect(done.state.kind).toBe('reviewing')
  })

  it('a supersede preserves the upgraded review intent of the in-flight merge', () => {
    // Review clicked while merge #1 is in flight (upgrades forceReview),
    // then agent write #2 supersedes before #1 resolves. The explicit
    // review click must survive onto merge #2 — "an explicit review
    // request never silently auto-applies".
    const merging = toMerging()
    const upgraded = asMerging(
      reduce(merging, {
        type: 'review-requested',
        paneBase: BASE,
        paneLocal: LOCAL,
        expectedLocal: LOCAL,
        expectedDiskBase: BASE,
        result: MERGED,
        conflicts: [],
        fileChange: change(REMOTE),
        currentLocal: LOCAL,
        currentBase: BASE,
        persistenceEqual: true
      }).state
    )
    expect(upgraded.forceReview).toBe(true)

    const remote2 = 'one\nshared\nTHREE AGAIN\n'
    const superseded = asMerging(reduce(upgraded, diskChanged(remote2)).state)
    expect(superseded.forceReview).toBe(true)

    const done = reduce(superseded, resolved(superseded.requestId, remote2))
    expect(effectTypes(done.effects)).not.toContain('apply-merge')
    only(done.effects, 'open-resolver')
    expect(done.state.kind).toBe('reviewing')
  })

  it('tab-closed closes any open resolver and goes permanently dead', () => {
    const reviewing = toReviewing()
    const closed = reduce(reviewing, { type: 'tab-closed' })
    expect(effectTypes(closed.effects)).toEqual(['close-resolver'])
    expect(closed.state.kind).toBe('closed')

    const fromMerging = reduce(toMerging(), { type: 'tab-closed' })
    expect(fromMerging.effects).toEqual([])
    expect(fromMerging.state.kind).toBe('closed')

    // No event resurrects a closed tab's session.
    const afterwards = [
      diskChanged(REMOTE),
      resolved(1, MERGED),
      { type: 'accept', result: MERGED, persistenceEqual: true } as MergeSessionEvent,
      { type: 'reload-disk' } as MergeSessionEvent
    ]
    for (const event of afterwards) {
      const dead = reduce(closed.state, event)
      expect(dead.state.kind).toBe('closed')
      expect(dead.effects).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Property fuzz — random event sequences driven through the reducer with a
// model interpreter (tab buffer, disk base, notification slot, dialog), the
// four invariants from external-merge.md §The session reducer asserted on
// every transition.
// ---------------------------------------------------------------------------

const mulberry32 = (seed: number): (() => number) => {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rnd: () => number, items: T[]): T => items[Math.floor(rnd() * items.length)]

const DOC_LINES = ['aaa', 'bbb', 'ccc', 'ddd', 'eee']

const randomDoc = (rnd: () => number): string => {
  const count = 1 + Math.floor(rnd() * 3)
  const lines: string[] = []
  for (let i = 0; i < count; i += 1) lines.push(pick(rnd, DOC_LINES))
  return `${lines.join('\n')}\n`
}

interface OutstandingMerge {
  requestId: number
  base: string
  local: string
  remote: string
}

type NotificationSlot =
  | { kind: 'auto'; paneBase: string; paneLocal: string; merged: string; fileChange: FileChangePayload }
  | { kind: 'conflict'; session: Extract<MergeSessionEffect, { type: 'open-resolver' }>['session'] }
  | null

describe('merge-session reducer — property fuzz', () => {
  it('holds the four session invariants across random event sequences', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const rnd = mulberry32(seed * 7919)

      let state = initialMergeSessionState()
      let tabMarkdown = LOCAL
      let tabBase: string | undefined = BASE
      let closedSeen = false
      // Mutated from inside dispatch(); an object property (unlike a `let`)
      // is re-narrowed at every read, so the loop below sees the updates.
      const ui: {
        dialog: Extract<MergeSessionEffect, { type: 'open-resolver' }>['session'] | null
        notification: NotificationSlot
      } = { dialog: null, notification: null }
      let newestEnteredPayload: FileChangePayload | null = null
      let maxSessionId = 0
      const outstanding: OutstandingMerge[] = []

      const dispatch = (event: MergeSessionEvent): void => {
        const before = state
        const { state: next, effects } = reduceMergeSession(deepFreeze(before), deepFreeze(event))

        // Determinism: the same frozen inputs reduce identically.
        const again = reduceMergeSession(before, event)
        expect(JSON.stringify({ state: again.state, effects: again.effects })).toBe(
          JSON.stringify({ state: next, effects })
        )

        // Invariant 3: a closed tab emits nothing, ever.
        if (closedSeen) {
          expect(effects, `closed tab emitted effects for ${event.type} (seed ${seed})`).toEqual([])
          expect(next.kind).toBe('closed')
        }

        // Newest tracking is EVENT-content based, never effect based: a
        // reducer that wrongly ignores a merge-relevant disk change must
        // not thereby exempt itself from invariant 2.
        if (
          event.type === 'disk-changed' &&
          event.fileChange.data.markdown !== event.local &&
          (event.base === undefined || event.fileChange.data.markdown !== event.base)
        ) {
          newestEnteredPayload = event.fileChange
        }

        for (const effect of effects) {
          switch (effect.type) {
            case 'start-merge':
              outstanding.push({
                requestId: effect.requestId,
                base: effect.base,
                local: effect.local,
                remote: effect.remote
              })
              break
            case 'apply-merge': {
              // Invariant 1: an accepted apply only ever comes from accept.
              if (effect.origin === 'accepted') {
                expect(event.type, `accepted apply from ${event.type} (seed ${seed})`).toBe('accept')
              }
              // Invariant 2: an AUTO apply references only the newest
              // merge-relevant payload seen (accepted applies are pinned to
              // their session's content above; the reducer supersedes
              // sessions on newer disk changes).
              if (effect.origin === 'auto') {
                expect(effect.fileChange, `superseded payload applied (seed ${seed})`).toBe(
                  newestEnteredPayload
                )
              }
              // The clean-after-apply decision is the reducer's, carried on
              // the effect; the model just executes it.
              expect(effect.markClean).toBe(
                effect.origin === 'auto' && effect.merged === effect.fileChange.data.markdown
              )
              // Content pin: an apply must carry exactly the content the
              // triggering event delivered — a reducer substituting raw
              // disk bytes (or anything else) for the merge output fails.
              if (event.type === 'merge-resolved') {
                expect(effect.merged, `apply content @seed ${seed}`).toBe(event.merged)
              } else if (event.type === 'accept') {
                expect(effect.merged, `accepted content @seed ${seed}`).toBe(event.result)
              }
              tabMarkdown = effect.merged
              tabBase = effect.fileChange.data.markdown
              if (effect.origin === 'auto') {
                // The buffer visibly changed (local === remote never reaches
                // apply-merge), so Undo/Review is offered even when markClean.
                ui.notification = {
                  kind: 'auto',
                  paneBase: effect.base,
                  paneLocal: effect.local,
                  merged: effect.merged,
                  fileChange: effect.fileChange
                }
              } else {
                ui.notification = null
              }
              break
            }
            case 'load-disk':
              // Invariant 1: only an explicit reload-disk discards a DIRTY
              // buffer (recovery tab first). A clean-tab-reload also replaces
              // the buffer with different disk content, but safely — it fires
              // only when the buffer was clean (=== base), so nothing unsaved
              // is lost. local-matches-remote never discards: buffer === disk.
              if (effect.reason === 'reload-disk') {
                expect(event.type, `reload without reload-disk event (seed ${seed})`).toBe(
                  'reload-disk'
                )
                expect(
                  effectTypes(effects).indexOf('create-recovery-tab'),
                  `reload without a preceding recovery tab (seed ${seed})`
                ).toBeLessThan(effectTypes(effects).indexOf('load-disk'))
              } else if (effect.reason === 'clean-tab-reload') {
                expect(
                  tabMarkdown,
                  `clean-tab-reload discarded unsaved edits (seed ${seed})`
                ).toBe(tabBase)
              } else {
                expect(tabMarkdown).toBe(effect.fileChange.data.markdown)
              }
              tabMarkdown = effect.fileChange.data.markdown
              tabBase = effect.fileChange.data.markdown
              if (effect.reason === 'reload-disk') ui.notification = null
              break
            case 'absorb':
              // Byte + persistence identical: mark clean without reloading.
              // The buffer already equals the incoming disk content, and any
              // standing notification is deliberately preserved.
              expect(tabMarkdown).toBe(effect.fileChange.data.markdown)
              tabBase = effect.fileChange.data.markdown
              break
            case 'open-resolver':
              expect(
                effect.session.sessionId,
                `session ids must stay monotonic (seed ${seed})`
              ).toBeGreaterThan(maxSessionId)
              maxSessionId = effect.session.sessionId
              ui.dialog = effect.session
              if (effect.withNotification) {
                ui.notification = { kind: 'conflict', session: effect.session }
              }
              break
            case 'close-resolver':
              ui.dialog = null
              break
            case 'create-recovery-tab':
            case 'validation-error':
              break
          }
        }

        // The dialog is open exactly while the reducer is reviewing.
        if (ui.dialog) {
          expect(next.kind, `dialog open outside reviewing (seed ${seed})`).toBe('reviewing')
        }

        if (next.kind === 'closed') closedSeen = true
        state = next
      }

      const steps = 12 + Math.floor(rnd() * 18)
      for (let step = 0; step < steps; step += 1) {
        const roll = rnd()

        if (roll < 0.3) {
          dispatch(diskChanged(randomDoc(rnd), {
            fileChange: change(randomDoc(rnd)),
            local: tabMarkdown,
            base: tabBase,
            persistenceEqual: rnd() < 0.8,
            // This model never forges an edit-then-revert, so content
            // divergence is the tab's dirtiness.
            dirty: tabMarkdown !== tabBase
          }))
        } else if (roll < 0.5 && outstanding.length > 0) {
          // Resolve or fail a random (possibly superseded) request.
          const request = pick(rnd, outstanding)
          if (rnd() < 0.75) {
            const merged = pick(rnd, [
              request.remote,
              request.local,
              `${request.local}${request.remote}`,
              `zzz\n${request.remote}`
            ])
            const conflicts = rnd() < 0.3 ? [conflictStub] : []
            dispatch(resolved(request.requestId, merged, conflicts))
          } else {
            dispatch({ type: 'merge-failed', requestId: request.requestId })
          }
        } else if (roll < 0.6) {
          tabMarkdown = randomDoc(rnd)
          dispatch({ type: 'buffer-edited', local: tabMarkdown })
        } else if (roll < 0.68) {
          tabBase = tabMarkdown
          dispatch({ type: 'saved' })
        } else if (roll < 0.72 && !closedSeen) {
          dispatch({ type: 'tab-closed' })
        } else if (roll < 0.8 && ui.notification && !closedSeen) {
          // A notification click, with the interpreter's own guards modeled.
          const slot = ui.notification
          ui.notification = null
          if (slot.kind === 'auto') {
            // Mirrors the interpreter's notification guard: buffer and base
            // still hold the merge outcome. isSaved is deliberately absent —
            // a markClean apply sets it, and Undo must stay live there.
            const guardHolds =
              tabMarkdown === slot.merged && tabBase === slot.fileChange.data.markdown
            if (guardHolds) {
              dispatch({
                type: 'review-requested',
                paneBase: slot.paneBase,
                paneLocal: slot.paneLocal,
                expectedLocal: slot.merged,
                expectedDiskBase: slot.fileChange.data.markdown,
                result: slot.merged,
                conflicts: [],
                fileChange: slot.fileChange,
                currentLocal: tabMarkdown,
                currentBase: tabBase,
                persistenceEqual: rnd() < 0.8
              })
            }
          } else {
            const { session } = slot
            dispatch({
              type: 'review-requested',
              paneBase: session.paneBase,
              paneLocal: session.paneLocal,
              expectedLocal: session.expectedLocal,
              expectedDiskBase: session.expectedDiskBase,
              result: session.result,
              conflicts: session.conflicts,
              fileChange: session.fileChange,
              currentLocal: tabMarkdown,
              currentBase: tabBase,
              persistenceEqual: rnd() < 0.8
            })
          }
        } else {
          const dialog = ui.dialog
          if (dialog) {
            const action = rnd()
            if (action < 0.5) {
              const result = pick(rnd, [
                dialog.result,
                `${dialog.result}${SCAFFOLD}`,
                randomDoc(rnd)
              ])
              dispatch({ type: 'accept', result, persistenceEqual: rnd() < 0.8 })
            } else if (action < 0.75) {
              dispatch({ type: 'cancel' })
            } else {
              dispatch({ type: 'reload-disk' })
            }
          }
        }
      }

      // Invariant 4: drain the in-flight request — nothing wedges in merging.
      if (state.kind === 'merging') {
        const merging = asMerging(state)
        const pending = outstanding.find((request) => request.requestId === merging.requestId)
        if (!pending) throw new Error(`merging with no outstanding request (seed ${seed})`)
        dispatch(resolved(merging.requestId, pending.remote))
      }
      expect(['idle', 'reviewing', 'closed']).toContain(state.kind)
    }
  })
})
