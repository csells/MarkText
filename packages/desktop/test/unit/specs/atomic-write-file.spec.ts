import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeFile } from 'main_renderer/filesystem'

// Document saves must be atomic: an interrupted write (crash, ENOSPC, power
// loss) must never leave the user's file truncated or half-written — the old
// bytes stay on disk until the new bytes are durably written, then the file
// is swapped in one rename. These specs run on the real filesystem in a
// throwaway temp dir and pin the behavioral contract: readers never observe
// a torn file, symlinks still write through to their target (a naive
// temp+rename would replace the link itself), permissions survive, and
// missing parent directories are still created (#3509).

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-atomic-write-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('writeFile — atomic document saves', () => {
  it('round-trips content to a new and an existing file', async() => {
    const target = path.join(dir, 'a.md')
    await writeFile(target, 'first', '.md', undefined)
    expect(fs.readFileSync(target, 'utf8')).toBe('first')

    await writeFile(target, 'second', '.md', undefined)
    expect(fs.readFileSync(target, 'utf8')).toBe('second')
  })

  it('creates missing parent directories (#3509)', async() => {
    const target = path.join(dir, 'moved', 'away', 'a.md')
    await writeFile(target, 'content', '.md', undefined)
    expect(fs.readFileSync(target, 'utf8')).toBe('content')
  })

  it('a concurrent reader never observes a truncated file during an overwrite', async() => {
    const target = path.join(dir, 'big.md')
    const oldContent = Buffer.alloc(4 * 1024 * 1024, 0x41) // 4MB of 'A'
    const newContent = Buffer.alloc(4 * 1024 * 1024, 0x42) // 4MB of 'B'
    fs.writeFileSync(target, oldContent)

    const observedSizes: number[] = []
    const writePromise = writeFile(target, newContent, '.md', undefined)
    const done = Symbol('write settled')
    for (;;) {
      observedSizes.push(fs.statSync(target).size)
      const raced = await Promise.race([
        writePromise.then(() => done),
        new Promise((resolve) => setImmediate(resolve))
      ])
      if (raced === done) break
    }
    observedSizes.push(fs.statSync(target).size)

    // Every observation is a complete file — old or new — never truncated.
    const torn = observedSizes.filter((size) => size !== oldContent.length)
    expect(torn, `observed torn sizes: ${[...new Set(torn)].join(', ')}`).toEqual([])
    expect(fs.readFileSync(target).equals(newContent)).toBe(true)
  })

  it('writing to a symlink updates the target and keeps the link a link', async() => {
    const realTarget = path.join(dir, 'real.md')
    const link = path.join(dir, 'link.md')
    fs.writeFileSync(realTarget, 'original')
    fs.symlinkSync(realTarget, link)

    await writeFile(link, 'updated', '.md', undefined)

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(realTarget, 'utf8')).toBe('updated')
  })

  it('preserves the existing file mode across an overwrite', async() => {
    const target = path.join(dir, 'private.md')
    fs.writeFileSync(target, 'secret')
    fs.chmodSync(target, 0o600)

    await writeFile(target, 'still secret', '.md', undefined)

    expect(fs.statSync(target).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(target, 'utf8')).toBe('still secret')
  })

  it('preserves a hard link — the other name sees the new content, not stale bytes', async() => {
    // A note hard-linked to a second path (nlink > 1). An atomic temp+rename
    // would give `a` a fresh inode and freeze `b` at the old content, silently
    // severing the link. Writing through the shared inode keeps them in sync.
    const a = path.join(dir, 'a.md')
    const b = path.join(dir, 'b.md')
    fs.writeFileSync(a, 'original')
    fs.linkSync(a, b)
    expect(fs.statSync(a).nlink).toBe(2)

    await writeFile(a, 'edited', '.md', undefined)

    expect(fs.readFileSync(a, 'utf8')).toBe('edited')
    expect(fs.readFileSync(b, 'utf8'), 'the hard-linked name must see the edit').toBe('edited')
    expect(fs.statSync(a).ino).toBe(fs.statSync(b).ino)
    expect(fs.statSync(a).nlink).toBe(2)
  })

  it('writes through a dangling symlink to (re)create its target, not replace the link', async() => {
    // A symlink whose target was deleted. The old in-place write followed the
    // link and recreated the target; an atomic rename would drop a regular
    // file where the symlink was.
    const missingTarget = path.join(dir, 'target.md')
    const link = path.join(dir, 'link.md')
    fs.symlinkSync(missingTarget, link)
    expect(fs.existsSync(missingTarget)).toBe(false)

    await writeFile(link, 'content', '.md', undefined)

    expect(fs.lstatSync(link).isSymbolicLink(), 'the link must stay a symlink').toBe(true)
    expect(fs.readFileSync(missingTarget, 'utf8')).toBe('content')
  })

  it('propagates write failures instead of swallowing them', async() => {
    // A parent path component that is a FILE makes directory creation (and
    // the write) impossible — the failure must surface to the caller.
    const blocker = path.join(dir, 'blocker')
    fs.writeFileSync(blocker, 'i am a file')
    const target = path.join(blocker, 'child', 'a.md')

    await expect(writeFile(target, 'content', '.md', undefined)).rejects.toThrow()
  })

  it('rejects an empty pathname loudly', async() => {
    await expect(writeFile('', 'content', '.md', undefined)).rejects.toThrow(
      'Cannot save file without path'
    )
  })
})
