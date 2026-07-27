import path from 'node:path'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_IMAGE_ASSET_BYTES
} from 'main_renderer/ipc/imageAssetRuntimeCodec'
import {
  createImageAssetService,
  type ImageAssetDocumentDescription,
  type ImageAssetMaterializationRequest,
  type ImageAssetService
} from 'main_renderer/imageAssets/imageAssetService'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d
])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'marktext-image-assets-'))
  roots.push(root)
  return root
}

afterEach(async() => {
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })
  ))
})

function ownedDocument(
  root: string,
  overrides: Partial<ImageAssetDocumentDescription> = {}
): ImageAssetDocumentDescription {
  return {
    documentId: 'document:owned',
    filename: 'draft.md',
    pathname: path.join(root, 'notes', 'draft.md'),
    ...overrides
  }
}

async function materialize(
  service: ImageAssetService,
  request: ImageAssetMaterializationRequest
) {
  const prepared = await service.prepare(request)
  prepared.commit()
  return prepared.receipt
}

describe('main-owned image asset service', () => {
  it('stores clipboard bytes in a main-resolved document-relative folder', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const service = createImageAssetService({
      describeDocument: documentId => {
        expect(documentId).toBe('document:owned')
        return ownedDocument(root)
      },
      readSettings: () => ({
        configuredFolderPath: path.join(root, 'configured'),
        relativeDirectoryName: '$' + '{filename}-assets/nested'
      }),
      hashBytes: async() => 'content-id'
    })

    const receipt = await materialize(service, {
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes: PNG
      },
      storage: 'document-relative'
    })

    expect(receipt).toEqual({
      schema: 'image-asset-receipt-1',
      kind: 'stored',
      documentId: 'document:owned',
      reference: 'draft-assets/nested/content-id.png',
      mediaType: 'image/png',
      byteLength: PNG.byteLength
    })
    expect(
      new Uint8Array(await readFile(
        path.join(
          root,
          'notes',
          'draft-assets',
          'nested',
          'content-id.png'
        )
      ))
    ).toEqual(PNG)
    expect(Object.isFrozen(receipt)).toBe(true)
  })

  it('resolves project-relative storage from the main-retained project root', async() => {
    const root = await fixture()
    const projectRoot = path.join(root, 'project')
    await mkdir(path.join(projectRoot, 'guides'), { recursive: true })
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root, {
        pathname: path.join(projectRoot, 'guides', 'draft.md'),
        projectRoot
      }),
      readSettings: () => ({
        configuredFolderPath: path.join(root, 'configured'),
        relativeDirectoryName: 'assets',
        relativeDirectoryBase: 'project'
      }),
      hashBytes: async() => 'project-content'
    })

    const receipt = await materialize(service, {
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes: PNG
      },
      storage: 'document-relative'
    })

    expect(receipt.reference).toBe('../assets/project-content.png')
    expect(await readFile(
      path.join(projectRoot, 'assets', 'project-content.png')
    )).toEqual(Buffer.from(PNG))
  })

  it('copies a verified local image into the main-configured folder', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const source = path.join(root, 'picked.jpg')
    await writeFile(source, JPEG)
    const configured = path.join(root, 'only-main-knows-this')
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: configured,
        relativeDirectoryName: 'assets'
      }),
      resolveNativeSource: token => {
        expect(token).toBe('image-capability:picked')
        return source
      },
      hashBytes: async() => 'jpeg-content'
    })

    const receipt = await materialize(service, {
      documentId: 'document:owned',
      source: {
        kind: 'native-capability',
        token: 'image-capability:picked'
      },
      storage: 'configured-folder'
    })

    expect(receipt).toMatchObject({
      kind: 'stored',
      reference: path.join(configured, 'jpeg-content.jpg'),
      mediaType: 'image/jpeg',
      byteLength: JPEG.byteLength
    })
    expect(await readFile(path.join(configured, 'jpeg-content.jpg')))
      .toEqual(Buffer.from(JPEG))
  })

  it('authenticates the opaque document before any filesystem effect', async() => {
    const root = await fixture()
    const configured = path.join(root, 'must-not-exist')
    const service = createImageAssetService({
      describeDocument: () => {
        throw new Error('Unknown or foreign document')
      },
      readSettings: vi.fn(() => ({
        configuredFolderPath: configured,
        relativeDirectoryName: 'assets'
      }))
    })

    await expect(materialize(service, {
      documentId: 'document:spoofed',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      },
      storage: 'configured-folder'
    })).rejects.toThrow(/foreign/)
    await expect(lstat(configured)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reuses identical content but never overwrites a hash collision', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const configured = path.join(root, 'configured')
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: configured,
        relativeDirectoryName: 'assets'
      }),
      hashBytes: async() => 'same-id'
    })
    const request = {
      documentId: 'document:owned',
      source: {
        kind: 'binary' as const,
        name: 'cat.png',
        mediaType: 'image/png' as const,
        bytes: PNG
      },
      storage: 'configured-folder' as const
    }

    expect((await materialize(service, request)).kind).toBe('stored')
    expect((await materialize(service, request)).kind).toBe('reused')
    await writeFile(path.join(configured, 'same-id.png'), JPEG)

    await expect(materialize(service, request)).rejects.toMatchObject({
      code: 'IMAGE_ASSET_COLLISION'
    })
    expect(await readFile(path.join(configured, 'same-id.png')))
      .toEqual(Buffer.from(JPEG))
  })

  it.each([
    {
      label: 'extension and declared type disagree',
      name: 'cat.jpg',
      mediaType: 'image/png' as const,
      bytes: PNG
    },
    {
      label: 'declared type and content disagree',
      name: 'cat.png',
      mediaType: 'image/png' as const,
      bytes: JPEG
    },
    {
      label: 'content is not an image',
      name: 'cat.png',
      mediaType: 'image/png' as const,
      bytes: new Uint8Array([1, 2, 3, 4])
    }
  ])('rejects binary input when $label', async({ name, mediaType, bytes }) => {
    const root = await fixture()
    const configured = path.join(root, 'configured')
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: configured,
        relativeDirectoryName: 'assets'
      })
    })

    await expect(materialize(service, {
      documentId: 'document:owned',
      source: { kind: 'binary', name, mediaType, bytes },
      storage: 'configured-folder'
    })).rejects.toThrow(/image|media|extension/i)
    await expect(lstat(configured)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a local image over the size boundary before creating its destination', async() => {
    const root = await fixture()
    const source = path.join(root, 'huge.png')
    await writeFile(source, PNG)
    await truncate(source, MAX_IMAGE_ASSET_BYTES + 1)
    const configured = path.join(root, 'configured')
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: configured,
        relativeDirectoryName: 'assets'
      }),
      resolveNativeSource: token => {
        expect(token).toBe('image-capability:huge')
        return source
      }
    })

    await expect(materialize(service, {
      documentId: 'document:owned',
      source: {
        kind: 'native-capability',
        token: 'image-capability:huge'
      },
      storage: 'configured-folder'
    })).rejects.toThrow(/size/i)
    await expect(lstat(configured)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    '../escape',
    '/tmp/absolute',
    'assets/../../escape',
    'assets\u0000escape'
  ])('rejects hostile main settings relative directory %s', async(relativeDirectoryName) => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: path.join(root, 'configured'),
        relativeDirectoryName
      })
    })

    await expect(materialize(service, {
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      },
      storage: 'document-relative'
    })).rejects.toThrow(/relative|directory|segment/i)
  })

  it('rejects a symlinked image-directory ancestor without creating anything outside the document tree', async() => {
    const root = await fixture()
    const notes = path.join(root, 'notes')
    const outside = path.join(root, 'outside')
    await mkdir(notes)
    await mkdir(outside)
    await symlink(outside, path.join(notes, 'assets'))
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: path.join(root, 'configured'),
        relativeDirectoryName: 'assets/nested'
      }),
      hashBytes: async() => 'content-id'
    })

    await expect(materialize(service, {
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: PNG
      },
      storage: 'document-relative'
    })).rejects.toThrow(/escape|document/i)
    await expect(lstat(path.join(outside, 'nested')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(path.join(outside, 'nested', 'content-id.png')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns a verified local source without mutation for reference policy', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const source = path.join(root, 'notes', 'cat.png')
    await writeFile(source, PNG)
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: path.join(root, 'configured'),
        relativeDirectoryName: 'assets'
      }),
      resolveNativeSource: token => {
        expect(token).toBe('image-capability:reference')
        return source
      }
    })

    const receipt = await materialize(service, {
      documentId: 'document:owned',
      source: {
        kind: 'native-capability',
        token: 'image-capability:reference'
      },
      storage: 'reference'
    })

    expect(receipt).toMatchObject({
      kind: 'referenced',
      reference: source,
      mediaType: 'image/png',
      byteLength: PNG.byteLength
    })
    await expect(lstat(path.join(root, 'configured')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes a newly staged file when the document transaction rolls back', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const configured = path.join(root, 'configured')
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: configured,
        relativeDirectoryName: 'assets'
      }),
      hashBytes: async() => 'rollback-content'
    })
    const prepared = await service.prepare({
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes: PNG
      },
      storage: 'configured-folder'
    })
    const pathname = path.join(configured, 'rollback-content.png')
    expect(await readFile(pathname)).toEqual(Buffer.from(PNG))

    await prepared.rollback()

    await expect(lstat(pathname)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps shared content when a reused concurrent lease commits', async() => {
    const root = await fixture()
    await mkdir(path.join(root, 'notes'))
    const configured = path.join(root, 'configured')
    const service = createImageAssetService({
      describeDocument: () => ownedDocument(root),
      readSettings: () => ({
        configuredFolderPath: configured,
        relativeDirectoryName: 'assets'
      }),
      hashBytes: async() => 'shared-content'
    })
    const request: ImageAssetMaterializationRequest = {
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes: PNG
      },
      storage: 'configured-folder'
    }
    const first = await service.prepare(request)
    const second = await service.prepare(request)
    expect(first.receipt.kind).toBe('stored')
    expect(second.receipt.kind).toBe('reused')

    second.commit()
    await first.rollback()

    expect(await readFile(
      path.join(configured, 'shared-content.png')
    )).toEqual(Buffer.from(PNG))
  })
})
