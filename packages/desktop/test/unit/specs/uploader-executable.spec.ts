import path from 'node:path'
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectUploaderAvailability,
  resolveMainPicgoExecutable
} from 'main_renderer/uploader/uploaderService'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'marktext-picgo-test-'))
  roots.push(root)
  return root
}

afterEach(async() => {
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })
  ))
})

describe('main-owned uploader executable resolution', () => {
  it('resolves PicGo from the main process PATH as a canonical executable file', async() => {
    const root = await fixture()
    const picgo = path.join(
      root,
      process.platform === 'win32' ? 'picgo.exe' : 'picgo'
    )
    await writeFile(picgo, '#!/bin/sh\n')
    await chmod(picgo, 0o700)

    await expect(resolveMainPicgoExecutable({
      pathEnvironment: root,
      includeStandardLocations: false
    })).resolves.toBe(await realpath(picgo))
  })

  it('does not resolve a directory or non-executable PicGo lookalike', async() => {
    const root = await fixture()
    const filename = process.platform === 'win32' ? 'picgo.exe' : 'picgo'
    await mkdir(path.join(root, filename))

    await expect(resolveMainPicgoExecutable({
      pathEnvironment: root,
      includeStandardLocations: false
    })).resolves.toBeNull()

    await rm(path.join(root, filename), { recursive: true })
    await writeFile(path.join(root, filename), '#!/bin/sh\n')
    await chmod(path.join(root, filename), 0o600)

    if (process.platform !== 'win32') {
      await expect(resolveMainPicgoExecutable({
        pathEnvironment: root,
        includeStandardLocations: false
      })).resolves.toBeNull()
    }
  })

  it('uses the main resolver for PicGo and only validates a custom path', async() => {
    const root = await fixture()
    const custom = path.join(
      root,
      process.platform === 'win32'
        ? 'custom-uploader.exe'
        : 'custom-uploader'
    )
    await writeFile(custom, '#!/bin/sh\n')
    await chmod(custom, 0o700)

    await expect(inspectUploaderAvailability(
      { schema: 'uploader-availability-1', kind: 'picgo' },
      () => ({ kind: 'picgo' }),
      async() => null
    )).resolves.toEqual({
      schema: 'uploader-availability-receipt-1',
      kind: 'picgo',
      available: false
    })
    await expect(inspectUploaderAvailability(
      {
        schema: 'uploader-availability-1',
        kind: 'custom-cli'
      },
      () => ({ kind: 'custom-cli', executablePath: custom }),
      async() => {
        throw new Error('custom validation must not resolve PicGo')
      }
    )).resolves.toEqual({
      schema: 'uploader-availability-receipt-1',
      kind: 'custom-cli',
      available: true
    })
  })
})
