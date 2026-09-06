import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import path from 'node:path'
import { tmpdir } from 'node:os'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler)
  }
}))
import { registerFsHandlers } from 'main_renderer/ipc/fs'

let root: string
beforeEach(async() => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'marktext-image-publication-'))
  registerFsHandlers()
})
afterEach(async() => {
  handlers.clear()
  await fs.remove(root)
})

it.each(['copy', 'write'] as const)('publishes only one concurrent %s without replacing its destination', async(kind) => {
  const first = path.join(root, 'first.png')
  const second = path.join(root, 'second.png')
  const target = path.join(root, 'published.png')
  await fs.writeFile(first, 'first image')
  await fs.writeFile(second, 'second image')
  const handler = handlers.get(kind === 'copy' ? 'mt::fs::copy' : 'mt::fs::write-file')
  if (!handler) throw new Error('Missing registered filesystem handler')
  const outcomes = await Promise.allSettled(kind === 'copy'
    ? [handler({}, first, target, { overwrite: false, errorOnExist: true }), handler({}, second, target, { overwrite: false, errorOnExist: true })]
    : [handler({}, target, 'first image', { flag: 'wx' }), handler({}, target, 'second image', { flag: 'wx' })])
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(await fs.readFile(target, 'utf8')).toBe(outcomes[0].status === 'fulfilled' ? 'first image' : 'second image')
})
