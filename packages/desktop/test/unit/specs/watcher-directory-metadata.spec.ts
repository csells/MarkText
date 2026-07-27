import path from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const watcherMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>()
}))

vi.mock('chokidar', () => ({
  default: {
    watch: () => {
      const watcher = {
        on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
          watcherMock.handlers.set(event, handler)
          return watcher
        }),
        close: vi.fn(),
        add: vi.fn(),
        unwatch: vi.fn()
      }
      return watcher
    }
  }
}))

import Watcher from 'main_renderer/filesystem/watcher'

const temporaryDirectories: string[] = []

afterEach(async() => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { force: true, recursive: true })
    )
  )
})

describe('directory watcher metadata boundary', () => {
  beforeEach(() => {
    watcherMock.handlers.clear()
  })

  it('publishes Markdown identity metadata without reading or sending content', async() => {
    const root = await mkdtemp(path.join(tmpdir(), 'marktext-watcher-metadata-'))
    temporaryDirectories.push(root)
    const pathname = path.join(root, 'note.md')
    await writeFile(pathname, '# private source', 'utf8')
    const send = vi.fn()
    const watcher = new Watcher({
      getItem: vi.fn(() => false)
    } as never)
    watcher.watch({ id: 7, webContents: { send } } as never, root, 'dir')

    const onAdd = watcherMock.handlers.get('add')
    expect(onAdd).toBeTypeOf('function')
    await onAdd?.(pathname as never)

    expect(send).toHaveBeenCalledOnce()
    const [channel, payload] = send.mock.calls[0]
    expect(channel).toBe('mt::update-object-tree')
    expect(payload).toEqual({
      type: 'add',
      change: expect.objectContaining({
        pathname,
        name: 'note.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      })
    })
    expect(payload.change).not.toHaveProperty('data')
    expect(payload.change).not.toHaveProperty('markdown')
    expect(payload.change).not.toHaveProperty('source')
    expect(payload.change).not.toHaveProperty('id')
  })
})
