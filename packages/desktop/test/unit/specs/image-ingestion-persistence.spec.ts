import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getHash, moveImageToFolder, normalizeImageInput } from '@/util/fileSystem'

type ImagePersistenceFileUtils = Pick<
  typeof window.fileUtils,
  'ensureDir' | 'isImageFile' | 'copy' | 'readFile' | 'writeFile'
>

let root: string
beforeEach(async() => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'marktext-image-persistence-'))
  window.path = path as typeof window.path
  const fileUtils: ImagePersistenceFileUtils = {
    ensureDir: (target: string) => fs.ensureDir(target),
    isImageFile: (target: string) => fs.pathExists(target),
    copy: (source: string, target: string, options?: fs.CopyOptions) =>
      fs.copy(source, target, options),
    readFile: (target: string) => fs.readFile(target),
    writeFile: (target: string, bytes: string | Uint8Array, options?: { flag: 'wx' }) =>
      fs.writeFile(target, bytes, options)
  }
  const testWindow = window as unknown as { fileUtils: ImagePersistenceFileUtils }
  testWindow.fileUtils = fileUtils
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
})
afterEach(async() => {
  vi.useRealTimers()
  await fs.remove(root)
})

it.each(['bitmap', 'path'] as const)(
  'preserves both imports when the same %s name supplies different bytes',
  async(kind) => {
    const document = path.join(root, 'note.md')
    const directory = path.join(root, 'assets')
    const image = path.join(root, 'same.png')
    const firstBytes = new Uint8Array([1, 2, 3])
    const secondBytes = new Uint8Array([4, 5, 6])
    await fs.writeFile(image, firstBytes)
    const first = await moveImageToFolder(
      document,
      kind === 'path' ? image : new File([firstBytes], 'same.png', { type: 'image/png' }),
      directory
    )
    await fs.writeFile(image, secondBytes)
    const second = await moveImageToFolder(
      document,
      kind === 'path' ? image : new File([secondBytes], 'same.png', { type: 'image/png' }),
      directory
    )
    expect(await fs.readFile(first)).toEqual(Buffer.from(firstBytes))
    expect(await fs.readFile(second)).toEqual(Buffer.from(secondBytes))
    expect(second).not.toBe(first)
  }
)

it('persists a bitmap data URL as a portable PNG asset', async() => {
  const document = path.join(root, 'note.md')
  const directory = path.join(root, 'assets')
  const source = await moveImageToFolder(
    document,
    'data:image/png;base64,AQID',
    directory,
    true,
    document
  )
  expect(await fs.readdir(directory)).toHaveLength(1)
  expect(source).toMatch(/^assets\/[^/]+\.png$/)
  expect(await fs.readFile(path.join(root, source))).toEqual(Buffer.from([1, 2, 3]))
})

it.each([
  [
    'data:image/png,%89PNG%0D%0A%1A%0A',
    'image/png',
    'pasted-image.png',
    [137, 80, 78, 71, 13, 10, 26, 10]
  ],
  ['data:image/jpeg;base64,AQID', 'image/jpeg', 'pasted-image.jpeg', [1, 2, 3]],
  [
    'data:image/svg+xml,%3Csvg%2F%3E',
    'image/svg+xml',
    'pasted-image.svg',
    [60, 115, 118, 103, 47, 62]
  ]
] as const)(
  'preserves image MIME and bytes before preference dispatch (%s)',
  async(source, type, name, bytes) => {
    const image = normalizeImageInput(source)
    expect(image).toBeInstanceOf(File)
    if (typeof image === 'string') throw new Error('Expected a decoded image File')
    expect(image.type).toBe(type)
    expect(image.name).toBe(name)
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(bytes))
  }
)

it('reuses identical bitmap bytes without rewriting the existing asset', async() => {
  const directory = path.join(root, 'assets')
  const bytes = new Uint8Array([1, 2, 3])
  const file = new File([bytes], 'same.png', { type: 'image/png' })
  const first = await moveImageToFolder(path.join(root, 'note.md'), file, directory)
  const write = vi.spyOn(window.fileUtils, 'writeFile')
  const second = await moveImageToFolder(path.join(root, 'note.md'), file, directory)
  expect(second).toBe(first)
  expect(await fs.readdir(directory)).toHaveLength(1)
  expect(write).toHaveBeenCalledWith(first, bytes, { flag: 'wx' })
  expect(await fs.readFile(first)).toEqual(Buffer.from(bytes))
})

it('preserves an edited asset occupying the bitmap hash filename', async() => {
  const directory = path.join(root, 'assets')
  const bytes = new Uint8Array([1, 2, 3])
  const editedBytes = new Uint8Array([9, 8, 7])
  await fs.ensureDir(directory)
  const existing = path.join(directory, `${await getHash(bytes, 'binary', 'sha1')}.png`)
  await fs.writeFile(existing, editedBytes)
  const imported = await moveImageToFolder(
    path.join(root, 'note.md'),
    new File([bytes], 'same.png', { type: 'image/png' }),
    directory
  )
  expect(imported).not.toBe(existing)
  expect(await fs.readFile(existing)).toEqual(Buffer.from(editedBytes))
  expect(await fs.readFile(imported)).toEqual(Buffer.from(bytes))
})

it('reports bitmap write failures other than a filename collision', async() => {
  const failure = new Error('EACCES: permission denied')
  const write = vi.spyOn(window.fileUtils, 'writeFile').mockRejectedValueOnce(failure)
  await expect(
    moveImageToFolder(
      path.join(root, 'note.md'),
      new File([new Uint8Array([1, 2, 3])], 'same.png'),
      path.join(root, 'assets')
    )
  ).rejects.toBe(failure)
  expect(write).toHaveBeenCalledTimes(1)
})
