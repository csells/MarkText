import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createCoreRecoveryDraftStore } from '../../../src/main/coreRecoveryDraftStore'

it.each([true, false])('discovers a backup interrupted before publication (complete=%s) without changing its bytes', complete => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-pending-draft-'))
  try {
    const id = '00000000-0000-0000-0000-000000000000'
    const pending = join(root, `${id}.json.pending`)
    const content = complete
      ? JSON.stringify({
        id,
        createdAt: '2026-09-05T00:00:00.000Z',
        documentId: 'draft.md',
        generation: 1,
        revision: 2,
        reason: 'Worker failure',
        visibleText: 'unsaved draft'
      })
      : '{"visibleText":"unsaved dra'
    writeFileSync(pending, content, { flag: 'wx' })
    const store = createCoreRecoveryDraftStore(root)
    const records = store.list()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id, artifactPath: pending })
    if (complete) expect(records[0].visibleText).toBe('unsaved draft')
    else expect(records[0].readError).toBeTruthy()
    store.archive(id)
    expect(createCoreRecoveryDraftStore(root).list()).toEqual([])
    expect(readFileSync(pending, 'utf8')).toBe(content)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it.each(['incomplete JSON', JSON.stringify({
  id: '00000000-0000-0000-0000-000000000000',
  visibleText: 'recover this text',
  createdAt: 42
})])('keeps other drafts accessible and preserves an unreadable record for manual recovery: %s', badContent => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-draft-corrupt-'))
  try {
    const store = createCoreRecoveryDraftStore(root)
    const record = store.preserve({
      documentId: 'draft.md',
      generation: 1,
      revision: 1,
      reason: 'failure',
      visibleText: 'recoverable text',
      nativeState: [],
      nativeIntent: {},
      acknowledgedView: {}
    })
    const badPath = join(root, '00000000-0000-0000-0000-000000000000.json')
    writeFileSync(badPath, badContent)
    const listed = store.list()
    expect(listed.find(item => item.id === record.id)?.visibleText).toBe('recoverable text')
    expect(listed.find(item => item.artifactPath === badPath)?.readError).toBeTruthy()
    expect(readFileSync(badPath, 'utf8')).toBe(badContent)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('reports an unavailable backup directory without replacing its existing bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-draft-store-blocked-'))
  try {
    const obstruction = join(root, 'backups')
    writeFileSync(obstruction, 'preserve this existing file')
    expect(() => createCoreRecoveryDraftStore(obstruction).preserve({
      documentId: 'draft.md',
      generation: 1,
      revision: 1,
      reason: 'queue full',
      visibleText: 'pending text',
      nativeState: [],
      nativeIntent: {},
      acknowledgedView: {}
    })).toThrow()
    expect(readFileSync(obstruction, 'utf8')).toBe('preserve this existing file')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('retains unique draft artifacts across restart and archives without removing any bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-draft-store-'))
  try {
    const input = {
      documentId: 'draft.md',
      pathname: '/documents/draft.md',
      generation: 1,
      revision: 3,
      reason: 'pending queue full',
      visibleText: 'all 129 typed characters',
      nativeState: [{ name: 'paragraph', text: 'all 129 typed characters' }],
      nativeIntent: { commands: [{ kind: 'edit', edit: { start: 4, end: 4, insert: 'x' } }] },
      acknowledgedView: { bindings: [] }
    }
    const store = createCoreRecoveryDraftStore(root)
    const first = store.preserve(input)
    const originalBytes = readFileSync(first.artifactPath)
    const second = store.preserve(input)
    expect(second.id).not.toBe(first.id)
    expect(readFileSync(first.artifactPath)).toEqual(originalBytes)
    const restarted = createCoreRecoveryDraftStore(root)
    expect(restarted.list().map(record => record.id).sort()).toEqual([first.id, second.id].sort())
    restarted.archive(first.id)
    expect(restarted.list().map(record => record.id)).toEqual([second.id])
    expect(readFileSync(first.artifactPath)).toEqual(originalBytes)
    expect(JSON.parse(originalBytes.toString())).toMatchObject(input)
    expect(() => restarted.archive('../outside')).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
