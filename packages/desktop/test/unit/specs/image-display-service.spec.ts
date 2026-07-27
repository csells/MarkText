import path from 'node:path'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveImageDisplayPath
} from 'main_renderer/imageAssets/imageDisplayService'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'marktext-image-display-'))
  roots.push(root)
  return root
}

afterEach(async() => {
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })
  ))
})

function documentAt(pathname: string | null) {
  return Object.freeze({
    documentId: 'document:owned',
    filename: pathname === null ? 'Untitled.md' : path.basename(pathname),
    pathname
  })
}

describe('main-owned image display path resolution', () => {
  it('resolves a document-contained relative reference canonically', async() => {
    const root = await fixture()
    const assets = path.join(root, 'assets')
    await mkdir(assets)
    const image = path.join(assets, 'cat.png')
    await writeFile(image, 'image bytes')
    const document = path.join(root, 'note.md')
    await writeFile(document, '# note')

    await expect(resolveImageDisplayPath(
      documentAt(document),
      'assets/cat.png?cache=one#preview'
    )).resolves.toEqual({
      kind: 'resolved',
      pathname: await realpath(image)
    })
  })

  it('fails closed on lexical traversal outside the document directory', async() => {
    const root = await fixture()
    const notes = path.join(root, 'notes')
    await mkdir(notes)
    const document = path.join(notes, 'note.md')
    await writeFile(document, '# note')
    await writeFile(path.join(root, 'secret.png'), 'secret')

    await expect(resolveImageDisplayPath(
      documentAt(document),
      '../secret.png'
    )).resolves.toEqual({
      kind: 'unavailable',
      reason: 'unsafe-reference'
    })
  })

  it('fails closed when an in-tree symlink escapes the document directory', async() => {
    const root = await fixture()
    const notes = path.join(root, 'notes')
    const outside = path.join(root, 'outside')
    await Promise.all([mkdir(notes), mkdir(outside)])
    const document = path.join(notes, 'note.md')
    await writeFile(document, '# note')
    await writeFile(path.join(outside, 'secret.png'), 'secret')
    await symlink(
      outside,
      path.join(notes, 'assets'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    await expect(resolveImageDisplayPath(
      documentAt(document),
      'assets/secret.png'
    )).resolves.toEqual({
      kind: 'unavailable',
      reason: 'unsafe-reference'
    })
  })

  it('reports an unavailable relative image without revealing a native path', async() => {
    const root = await fixture()
    const document = path.join(root, 'note.md')
    await writeFile(document, '# note')

    await expect(resolveImageDisplayPath(
      documentAt(document),
      'assets/missing.png'
    )).resolves.toEqual({
      kind: 'unavailable',
      reason: 'missing-image'
    })
  })

  it('requires a persisted document before resolving a relative reference', async() => {
    await expect(resolveImageDisplayPath(
      documentAt(null),
      'assets/cat.png'
    )).resolves.toEqual({
      kind: 'unavailable',
      reason: 'untitled-document'
    })
  })

  it('resolves an explicitly authored absolute image path in main only', async() => {
    const root = await fixture()
    const image = path.join(root, 'cat.png')
    await writeFile(image, 'image bytes')

    await expect(resolveImageDisplayPath(
      documentAt(null),
      image
    )).resolves.toEqual({
      kind: 'resolved',
      pathname: await realpath(image)
    })
  })

  it.each([
    'https://example.test/cat.png',
    'data:image/png;base64,AA==',
    'blob:https://example.test/id',
    'file:///tmp/cat.png',
    '%2e%2e/secret.png',
    '..%2fsecret.png',
    '\\\\server\\share\\cat.png'
  ])('rejects a renderer-inappropriate reference %s', async(reference) => {
    const root = await fixture()
    const document = path.join(root, 'note.md')
    await writeFile(document, '# note')

    await expect(resolveImageDisplayPath(
      documentAt(document),
      reference
    )).resolves.toEqual({
      kind: 'unavailable',
      reason: 'unsafe-reference'
    })
  })
})
