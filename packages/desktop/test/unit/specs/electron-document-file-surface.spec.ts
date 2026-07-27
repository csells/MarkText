import {
  chmod,
  link,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createElectronDocumentCoreFileSurface,
  resolveMarkdownSavePath
} from 'main_renderer/documentCore/electronDocumentFileSurface'
import {
  decodeDocumentCoreFileCompareExchangeRequest,
  documentCoreFileByteHash
} from 'main_renderer/documentCore/documentFileCompareExchange'

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('main-owned native document save path', () => {
  it('reports closed native identities that join symlink and hard-link names', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-identity-'))
    directories.push(directory)
    const target = join(directory, 'target.md')
    const symbolicAlias = join(directory, 'symbolic.md')
    const hardAlias = join(directory, 'hard.md')
    await writeFile(target, 'identity')
    await symlink('target.md', symbolicAlias)
    await link(target, hardAlias)
    const surface = createElectronDocumentCoreFileSurface()

    const [targetIdentity, symbolicIdentity, hardIdentity] =
      await Promise.all([
        surface.identify(target),
        surface.identify(symbolicAlias),
        surface.identify(hardAlias)
      ])

    expect(targetIdentity).not.toBeNull()
    expect(Reflect.ownKeys(targetIdentity ?? {})).toEqual([
      'schema',
      'canonicalPathname',
      'device',
      'inode'
    ])
    expect(symbolicIdentity).toEqual(targetIdentity)
    expect(hardIdentity).toMatchObject({
      schema: 'document-core-physical-file-identity-1',
      device: targetIdentity?.device,
      inode: targetIdentity?.inode
    })
  })

  it('stores and writes the same resolved Markdown pathname when the dialog omits an extension', () => {
    expect(resolveMarkdownSavePath('/tmp/Release notes'))
      .toBe('/tmp/Release notes.md')
  })

  it('preserves an explicit Markdown extension', () => {
    expect(resolveMarkdownSavePath('/tmp/Release notes.markdown'))
      .toBe('/tmp/Release notes.markdown')
  })

  it('captures and removes a rollback target as exact uninterpreted bytes', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-target-'))
    directories.push(directory)
    const pathname = join(directory, 'target.md')
    const bytes = Uint8Array.from([0x00, 0xff, 0x80, 0x0d, 0x0a])
    await writeFile(pathname, bytes)
    const surface = createElectronDocumentCoreFileSurface()

    expect(Array.from(await surface.readBytes(pathname) ?? []))
      .toEqual(Array.from(bytes))
    await expect(surface.compareExchange({
      schema: 'document-core-file-compare-exchange-1',
      pathname,
      expectedByteHash: documentCoreFileByteHash(bytes),
      bytes: null
    })).resolves.toMatchObject({ kind: 'exchanged' })
    await expect(surface.readBytes(pathname)).resolves.toBeNull()
  })

  it('rejects an existing-file identity mismatch without replacing external bytes', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-target-'))
    directories.push(directory)
    const pathname = join(directory, 'target.md')
    const original = new TextEncoder().encode('original')
    const external = new TextEncoder().encode('external')
    await writeFile(pathname, original)
    const surface = createElectronDocumentCoreFileSurface()
    const expectedByteHash = documentCoreFileByteHash(
      await surface.readBytes(pathname)
    )
    await writeFile(pathname, external)

    await expect(surface.compareExchange({
      schema: 'document-core-file-compare-exchange-1',
      pathname,
      expectedByteHash,
      bytes: new TextEncoder().encode('local')
    })).resolves.toEqual({
      schema: 'document-core-file-compare-exchange-result-1',
      kind: 'conflict',
      actualByteHash: documentCoreFileByteHash(external)
    })
    expect(new TextDecoder().decode(await readFile(pathname))).toBe('external')
  })

  it('rejects a replacement made after local bytes are prepared but before rename', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-target-'))
    directories.push(directory)
    const pathname = join(directory, 'target.md')
    const original = new TextEncoder().encode('original')
    const external = new TextEncoder().encode('external-after-check')
    await writeFile(pathname, original)
    const child = spawn(process.execPath, [
      '-e',
      `
        const fs = require('node:fs')
        const directory = process.argv[1]
        const pathname = process.argv[2]
        process.stdout.write('ready\\n')
        const poll = setInterval(() => {
          const prepared = fs.readdirSync(directory)
            .some(name => name !== 'target.md')
          if (!prepared) return
          clearInterval(poll)
          fs.writeFileSync(pathname, 'external-after-check')
          process.stdout.write('mutated\\n')
        }, 1)
      `,
      directory,
      pathname
    ])
    const exited = once(child, 'exit')
    try {
      const [ready] = await once(child.stdout, 'data')
      expect(String(ready)).toContain('ready')
      const mutated = once(child.stdout, 'data')
      const surface = createElectronDocumentCoreFileSurface()
      const exchanging = surface.compareExchange({
        schema: 'document-core-file-compare-exchange-1',
        pathname,
        expectedByteHash: documentCoreFileByteHash(original),
        bytes: new Uint8Array(32 * 1024 * 1024).fill(0x6c)
      })

      const [message] = await mutated
      expect(String(message)).toContain('mutated')
      await expect(exchanging).resolves.toMatchObject({
        kind: 'conflict',
        actualByteHash: documentCoreFileByteHash(external)
      })
      expect(new TextDecoder().decode(await readFile(pathname)))
        .toBe('external-after-check')
      expect(await readdir(directory)).toEqual(['target.md'])
    } finally {
      if (child.exitCode === null) child.kill()
      await exited
    }
  }, 15_000)

  it('replaces a symlink target while preserving its mode and owner', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-target-'))
    directories.push(directory)
    const targetPathname = join(directory, 'target.md')
    const linkPathname = join(directory, 'linked.md')
    const original = new TextEncoder().encode('original')
    const replacement = new TextEncoder().encode('replacement')
    await writeFile(targetPathname, original)
    await chmod(targetPathname, 0o640)
    await symlink('target.md', linkPathname)
    const before = await stat(targetPathname)
    const surface = createElectronDocumentCoreFileSurface()

    await expect(surface.compareExchange({
      schema: 'document-core-file-compare-exchange-1',
      pathname: linkPathname,
      expectedByteHash: documentCoreFileByteHash(original),
      bytes: replacement
    })).resolves.toMatchObject({ kind: 'exchanged' })

    const after = await stat(targetPathname)
    expect(await readlink(linkPathname)).toBe('target.md')
    expect(new TextDecoder().decode(await readFile(linkPathname)))
      .toBe('replacement')
    expect(after.mode & 0o777).toBe(before.mode & 0o777)
    expect(after.uid).toBe(before.uid)
    expect(after.gid).toBe(before.gid)
  })

  it('rejects expected absence when another process creates the Save As target', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-target-'))
    directories.push(directory)
    const pathname = join(directory, 'new-target.md')
    const external = new TextEncoder().encode('created externally')
    const surface = createElectronDocumentCoreFileSurface()
    await expect(surface.readBytes(pathname)).resolves.toBeNull()
    await writeFile(pathname, external)

    await expect(surface.compareExchange({
      schema: 'document-core-file-compare-exchange-1',
      pathname,
      expectedByteHash: null,
      bytes: new TextEncoder().encode('local')
    })).resolves.toMatchObject({
      kind: 'conflict',
      actualByteHash: documentCoreFileByteHash(external)
    })
    expect(new TextDecoder().decode(await readFile(pathname)))
      .toBe('created externally')
  })

  it('does not restore rollback bytes over a newer external replacement', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-save-target-'))
    directories.push(directory)
    const pathname = join(directory, 'target.md')
    const original = new TextEncoder().encode('original')
    const local = new TextEncoder().encode('local')
    const external = new TextEncoder().encode('newer external')
    await writeFile(pathname, original)
    const surface = createElectronDocumentCoreFileSurface()
    await expect(surface.compareExchange({
      schema: 'document-core-file-compare-exchange-1',
      pathname,
      expectedByteHash: documentCoreFileByteHash(original),
      bytes: local
    })).resolves.toMatchObject({ kind: 'exchanged' })
    await writeFile(pathname, external)

    await expect(surface.compareExchange({
      schema: 'document-core-file-compare-exchange-1',
      pathname,
      expectedByteHash: documentCoreFileByteHash(local),
      bytes: original
    })).resolves.toMatchObject({
      kind: 'conflict',
      actualByteHash: documentCoreFileByteHash(external)
    })
    expect(new TextDecoder().decode(await readFile(pathname)))
      .toBe('newer external')
  })

  it('strictly decodes the one closed native mutation request', () => {
    const valid = {
      schema: 'document-core-file-compare-exchange-1',
      pathname: '/tmp/note.md',
      expectedByteHash: null,
      bytes: new Uint8Array()
    }
    expect(decodeDocumentCoreFileCompareExchangeRequest(valid))
      .toEqual(valid)

    for (const malformed of [
      { ...valid, overwrite: true },
      { ...valid, expectedByteHash: 'not-a-hash' },
      { ...valid, bytes: 'local' },
      { ...valid, pathname: '' },
      { pathname: valid.pathname, bytes: valid.bytes }
    ]) {
      expect(() => decodeDocumentCoreFileCompareExchangeRequest(malformed))
        .toThrow()
    }
  })
})
