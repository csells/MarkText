import {
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  createElectronDocumentCoreFileSurface
} from 'main_renderer/documentCore/electronDocumentFileSurface'
import {
  documentCoreFileByteHash
} from 'main_renderer/documentCore/documentFileCompareExchange'
import type {
  documentFileNativeFilesystem
} from 'main_renderer/documentCore/documentFileNativeFilesystem'

const renameBarrier = vi.hoisted(() => ({
  activeCommits: 0,
  enabled: false,
  arrivals: 0,
  maxConcurrentCommits: 0,
  waiters: [] as Array<() => void>
}))

vi.mock(
  'main_renderer/documentCore/documentFileNativeFilesystem',
  async importOriginal => {
    const actual = await importOriginal<{
      documentFileNativeFilesystem: typeof documentFileNativeFilesystem
    }>()
    return {
      ...actual,
      documentFileNativeFilesystem: {
        ...actual.documentFileNativeFilesystem,
        rename: async(
          ...arguments_: Parameters<
            typeof actual.documentFileNativeFilesystem.rename
          >
        ) => {
          if (renameBarrier.enabled) {
            renameBarrier.arrivals += 1
            renameBarrier.activeCommits += 1
            renameBarrier.maxConcurrentCommits = Math.max(
              renameBarrier.maxConcurrentCommits,
              renameBarrier.activeCommits
            )
            try {
              if (renameBarrier.arrivals === 2) {
                for (const release of renameBarrier.waiters.splice(0)) release()
              } else {
                await new Promise<void>(resolve => {
                  let released = false
                  const release = (): void => {
                    if (released) return
                    released = true
                    resolve()
                  }
                  renameBarrier.waiters.push(release)
                  setTimeout(release, 1_000)
                })
              }
              await actual.documentFileNativeFilesystem.rename(...arguments_)
            } finally {
              renameBarrier.activeCommits -= 1
            }
            return
          }
          await actual.documentFileNativeFilesystem.rename(...arguments_)
        }
      }
    }
  }
)

const directories: string[] = []

afterEach(async() => {
  renameBarrier.activeCommits = 0
  renameBarrier.enabled = false
  renameBarrier.arrivals = 0
  renameBarrier.maxConcurrentCommits = 0
  for (const release of renameBarrier.waiters.splice(0)) release()
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('native document CAS alias identity', () => {
  it.each([
    ['case', 'Target.md', 'target.md'],
    ['Unicode normalization', 'Café.md', 'Cafe\u0301.md']
  ])('serializes absent targets across %s spellings', async(
    _spellingKind,
    firstFilename,
    secondFilename
  ) => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-canonical-'))
    directories.push(directory)
    const firstPathname = join(directory, firstFilename)
    const secondPathname = join(directory, secondFilename)
    const original = new TextEncoder().encode('probe')
    const firstBytes = new TextEncoder().encode('first')
    const secondBytes = new TextEncoder().encode('second')
    await writeFile(firstPathname, original)
    let spellingsAlias = false
    try {
      spellingsAlias = new TextDecoder().decode(
        await readFile(secondPathname)
      ) === 'probe'
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error
      }
    } finally {
      await rm(firstPathname, { force: true })
      await rm(secondPathname, { force: true })
    }
    renameBarrier.enabled = true
    const surface = createElectronDocumentCoreFileSurface()

    const [first, second] = await Promise.all([
      surface.compareExchange({
        schema: 'document-core-file-compare-exchange-1',
        pathname: firstPathname,
        expectedByteHash: null,
        bytes: firstBytes
      }),
      surface.compareExchange({
        schema: 'document-core-file-compare-exchange-1',
        pathname: secondPathname,
        expectedByteHash: null,
        bytes: secondBytes
      })
    ])

    expect(renameBarrier.maxConcurrentCommits).toBe(1)
    if (spellingsAlias) {
      expect(renameBarrier.arrivals).toBe(1)
      expect([first.kind, second.kind].sort()).toEqual([
        'conflict',
        'exchanged'
      ])
      const expectedWinner = first.kind === 'exchanged' ? 'first' : 'second'
      expect(new TextDecoder().decode(await readFile(firstPathname)))
        .toBe(expectedWinner)
      expect(new TextDecoder().decode(await readFile(secondPathname)))
        .toBe(expectedWinner)
    } else {
      expect(renameBarrier.arrivals).toBe(2)
      expect([first.kind, second.kind]).toEqual(['exchanged', 'exchanged'])
      expect(new TextDecoder().decode(await readFile(firstPathname)))
        .toBe('first')
      expect(new TextDecoder().decode(await readFile(secondPathname)))
        .toBe('second')
    }
  })

  it('allows exactly one exchange through two symlinks to one target', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-alias-'))
    directories.push(directory)
    const targetPathname = join(directory, 'target.md')
    const firstAlias = join(directory, 'first.md')
    const secondAlias = join(directory, 'second.md')
    const original = new TextEncoder().encode('original')
    const firstBytes = new TextEncoder().encode('first')
    const secondBytes = new TextEncoder().encode('second')
    await writeFile(targetPathname, original)
    await symlink('target.md', firstAlias)
    await symlink('target.md', secondAlias)
    renameBarrier.enabled = true
    const surface = createElectronDocumentCoreFileSurface()

    const [first, second] = await Promise.all([
      surface.compareExchange({
        schema: 'document-core-file-compare-exchange-1',
        pathname: firstAlias,
        expectedByteHash: documentCoreFileByteHash(original),
        bytes: firstBytes
      }),
      surface.compareExchange({
        schema: 'document-core-file-compare-exchange-1',
        pathname: secondAlias,
        expectedByteHash: documentCoreFileByteHash(original),
        bytes: secondBytes
      })
    ])

    expect(renameBarrier.arrivals).toBe(1)
    expect(renameBarrier.maxConcurrentCommits).toBe(1)
    expect([first.kind, second.kind].sort()).toEqual([
      'conflict',
      'exchanged'
    ])
    const expectedWinner = first.kind === 'exchanged' ? 'first' : 'second'
    expect(new TextDecoder().decode(await readFile(targetPathname)))
      .toBe(expectedWinner)
    expect(new TextDecoder().decode(await readFile(firstAlias)))
      .toBe(expectedWinner)
    expect(new TextDecoder().decode(await readFile(secondAlias)))
      .toBe(expectedWinner)
  })

  it('serializes hard-link commits before atomic rename separates the names', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-hardlink-'))
    directories.push(directory)
    const firstPathname = join(directory, 'first.md')
    const secondPathname = join(directory, 'second.md')
    const original = new TextEncoder().encode('original')
    const firstBytes = new TextEncoder().encode('first')
    const secondBytes = new TextEncoder().encode('second')
    await writeFile(firstPathname, original)
    await link(firstPathname, secondPathname)
    renameBarrier.enabled = true
    const surface = createElectronDocumentCoreFileSurface()

    const [first, second] = await Promise.all([
      surface.compareExchange({
        schema: 'document-core-file-compare-exchange-1',
        pathname: firstPathname,
        expectedByteHash: documentCoreFileByteHash(original),
        bytes: firstBytes
      }),
      surface.compareExchange({
        schema: 'document-core-file-compare-exchange-1',
        pathname: secondPathname,
        expectedByteHash: documentCoreFileByteHash(original),
        bytes: secondBytes
      })
    ])

    expect(renameBarrier.arrivals).toBe(2)
    expect(renameBarrier.maxConcurrentCommits).toBe(1)
    expect([first.kind, second.kind]).toEqual(['exchanged', 'exchanged'])
    expect([
      new TextDecoder().decode(await readFile(firstPathname)),
      new TextDecoder().decode(await readFile(secondPathname))
    ].sort()).toEqual(['first', 'second'])
  })
})
