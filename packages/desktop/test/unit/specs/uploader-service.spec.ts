import path from 'node:path'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createUploaderService,
  type UploaderDocumentDescription
} from 'main_renderer/uploader/uploaderService'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d
])
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10
])
const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'marktext-uploader-test-'))
  roots.push(root)
  return root
}

afterEach(async() => {
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })
  ))
})

function ownedDocument(root: string): UploaderDocumentDescription {
  return Object.freeze({
    documentId: 'document:owned',
    pathname: path.join(root, 'notes', 'draft.md')
  })
}

async function executable(root: string, name: string): Promise<string> {
  const executableName = process.platform === 'win32' &&
    path.extname(name).length === 0
    ? `${name}.exe`
    : name
  const pathname = path.join(root, executableName)
  await writeFile(pathname, '#!/bin/sh\n')
  await chmod(pathname, 0o700)
  return pathname
}

describe('main-owned uploader service', () => {
  it('uploads verified binary bytes through PicGo argv and removes its temp file', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const picgo = await executable(root, 'picgo')
    const canonicalPicgo = await realpath(picgo)
    let temporaryPath = ''
    const executeFile = vi.fn(async(
      executablePath: string,
      args: readonly string[]
    ) => {
      expect(executablePath).toBe(canonicalPicgo)
      expect(args).toHaveLength(2)
      expect(args[0]).toBe('u')
      temporaryPath = args[1] ?? ''
      expect(new Uint8Array(await readFile(temporaryPath))).toEqual(PNG)
      return Object.freeze({
        stdout: '[PicGo SUCCESS]: https://cdn.example/cat.png\n',
        stderr: ''
      })
    })
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({ kind: 'picgo' }),
      resolvePicgoExecutable: async() => picgo,
      executeFile,
      temporaryRoot: root
    })

    const receipt = await service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes: PNG
      }
    })

    expect(receipt).toEqual({
      schema: 'uploader-upload-receipt-1',
      documentId: 'document:owned',
      url: 'https://cdn.example/cat.png',
      deletionClipboard: null
    })
    expect(executeFile).toHaveBeenCalledOnce()
    await expect(access(temporaryPath)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(access(path.dirname(temporaryPath))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('uses only the main-retained custom executable for bounded image bytes', async() => {
    const root = await fixture()
    const notes = path.join(root, 'notes')
    await mkdir(notes)
    const custom = await executable(root, 'custom-uploader')
    let stagedPath = ''
    const executeFile = vi.fn(async(
      executablePath: string,
      args: readonly string[]
    ) => {
      expect(executablePath).toBe(await realpath(custom))
      stagedPath = args[0] ?? ''
      expect(new Uint8Array(await readFile(stagedPath))).toEqual(JPEG)
      return Object.freeze({
        stdout: 'https://cdn.example/custom.jpg\n',
        stderr: ''
      })
    })
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        kind: 'custom-cli',
        executablePath: custom
      }),
      executeFile,
      temporaryRoot: root
    })

    await expect(service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.jpg',
        mediaType: 'image/jpeg',
        bytes: JPEG
      }
    })).resolves.toEqual({
      schema: 'uploader-upload-receipt-1',
      documentId: 'document:owned',
      url: 'https://cdn.example/custom.jpg',
      deletionClipboard: null
    })
    expect(executeFile).toHaveBeenCalledOnce()
    await expect(access(stagedPath)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(access(path.dirname(stagedPath))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('retains a structured custom deletion URL behind an opaque capability', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const custom = await executable(root, 'custom-uploader')
    const retainDeletionUrl = vi.fn(() => Object.freeze({
      schema: 'uploader-deletion-clipboard-capability-1' as const,
      token: 'token:retained'
    }))
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        kind: 'custom-cli',
        executablePath: custom
      }),
      executeFile: async() => Object.freeze({
        stdout: JSON.stringify({
          url: 'https://cdn.example/custom.jpg',
          deletionUrl: 'https://cdn.example/delete/secret'
        }),
        stderr: ''
      }),
      retainDeletionUrl,
      temporaryRoot: root
    })

    const receipt = await service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.jpg',
        mediaType: 'image/jpeg',
        bytes: JPEG
      }
    })

    expect(retainDeletionUrl)
      .toHaveBeenCalledWith('https://cdn.example/delete/secret')
    expect(receipt).toEqual({
      schema: 'uploader-upload-receipt-1',
      documentId: 'document:owned',
      url: 'https://cdn.example/custom.jpg',
      deletionClipboard: {
        schema: 'uploader-deletion-clipboard-capability-1',
        token: 'token:retained'
      }
    })
    expect(receipt).not.toHaveProperty('deletionUrl')
  })

  it('rejects malformed persisted uploader settings before filesystem or process effects', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const resolvePicgoExecutable = vi.fn(async() =>
      await executable(root, 'must-not-resolve')
    )
    const executeFile = vi.fn()
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        kind: 'picgo',
        executablePath: '/renderer/injected'
      }) as never,
      resolvePicgoExecutable,
      executeFile,
      temporaryRoot: root
    })

    await expect(service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      }
    })).rejects.toThrow(/setting|closed|field/i)

    expect(resolvePicgoExecutable).not.toHaveBeenCalled()
    expect(executeFile).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['notes'])
  })

  it('stops at document ownership before settings, files, temp data, or processes', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const readSettings = vi.fn(() => ({ kind: 'picgo' as const }))
    const resolvePicgoExecutable = vi.fn()
    const executeFile = vi.fn()
    const service = createUploaderService({
      describeDocument: () => Object.freeze({
        documentId: 'document:foreign',
        pathname: path.join(root, 'notes', 'draft.md')
      }),
      readSettings,
      resolvePicgoExecutable,
      executeFile,
      temporaryRoot: root
    })

    await expect(service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:forged',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      }
    })).rejects.toThrow(/identity|document/i)

    expect(readSettings).not.toHaveBeenCalled()
    expect(resolvePicgoExecutable).not.toHaveBeenCalled()
    expect(executeFile).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['notes'])
  })

  it.each([
    {
      name: 'cat.jpg',
      mediaType: 'image/png' as const,
      bytes: PNG
    },
    {
      name: 'cat.png',
      mediaType: 'image/jpeg' as const,
      bytes: PNG
    }
  ])('rejects mismatched binary identity before executable or temp effects', async(source) => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const resolvePicgoExecutable = vi.fn()
    const executeFile = vi.fn()
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({ kind: 'picgo' }),
      resolvePicgoExecutable,
      executeFile,
      temporaryRoot: root
    })

    await expect(service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: { kind: 'binary', ...source }
    })).rejects.toThrow(/match/i)

    expect(resolvePicgoExecutable).not.toHaveBeenCalled()
    expect(executeFile).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['notes'])
  })

  it.each([
    ['relative', 'renderer-uploader'],
    ['directory', 'notes'],
    ['non-executable', 'not-executable']
  ])('rejects a %s custom executable before temp or process effects', async(
    kind,
    configuredPath
  ) => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    if (kind === 'non-executable') {
      await writeFile(path.join(root, configuredPath), '#!/bin/sh\n')
    }
    const executeFile = vi.fn()
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        kind: 'custom-cli',
        executablePath: kind === 'relative'
          ? configuredPath
          : path.join(root, configuredPath)
      }),
      executeFile,
      temporaryRoot: root
    })

    await expect(service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      }
    })).rejects.toThrow(/absolute|regular file|permission|access|executable/i)

    expect(executeFile).not.toHaveBeenCalled()
    expect((await readdir(root)).every(
      name => !name.startsWith('marktext-upload-')
    )).toBe(true)
  })

  it('removes bounded temp data when the uploader process fails', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const picgo = await executable(root, 'picgo')
    let temporaryPath = ''
    const executeFile = vi.fn(async(
      _executablePath: string,
      args: readonly string[]
    ) => {
      temporaryPath = args[1] ?? ''
      throw new Error('uploader process failed')
    })
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({ kind: 'picgo' }),
      resolvePicgoExecutable: async() => picgo,
      executeFile,
      temporaryRoot: root
    })

    await expect(service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      }
    })).rejects.toThrow(/process failed/i)

    expect(executeFile).toHaveBeenCalledOnce()
    await expect(access(temporaryPath)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(access(path.dirname(temporaryPath))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it.each([
    [
      'JSON imgUrl',
      '{"success":true,"imgUrl":"https://cdn.example/json.png"}\n',
      ''
    ],
    [
      'JSON result',
      '[PicGo INFO] done\n',
      '{"success":true,"result":["https://cdn.example/result.png"]}\n'
    ],
    [
      'success line',
      'uploaded: https://cdn.example/line.png\n',
      ''
    ]
  ])('preserves PicGo %s output behavior without a shell', async(
    _label,
    stdout,
    stderr
  ) => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const picgo = await executable(root, 'picgo')
    const executeFile = vi.fn(async() => ({ stdout, stderr }))
    const service = createUploaderService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({ kind: 'picgo' }),
      resolvePicgoExecutable: async() => picgo,
      executeFile,
      temporaryRoot: root
    })

    const receipt = await service.upload({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      }
    })

    expect(receipt.url).toMatch(/^https:\/\/cdn\.example\//)
    expect(executeFile).toHaveBeenCalledOnce()
  })
})
