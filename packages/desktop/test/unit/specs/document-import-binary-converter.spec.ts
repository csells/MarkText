import { describe, expect, it, vi } from 'vitest'
import {
  convertDocumentImportBinary
} from 'main_renderer/import/documentImportBinaryConverter'

describe('main-owned binary document conversion', () => {
  it('writes only to a generated temporary pathname and always removes it', async() => {
    const mkdtemp = vi.fn(async() => '/main-owned/import-123')
    const writeFile = vi.fn(async() => {})
    const remove = vi.fn(async() => {})
    const convertPath = vi.fn(async() => '# Converted')
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

    await expect(convertDocumentImportBinary('docx', bytes, {
      temporaryRoot: '/main-owned',
      mkdtemp,
      writeFile,
      remove,
      convertPath
    })).resolves.toBe('# Converted')

    expect(mkdtemp).toHaveBeenCalledWith('/main-owned/marktext-import-')
    expect(writeFile).toHaveBeenCalledWith(
      '/main-owned/import-123/input.docx',
      bytes,
      { flag: 'wx' }
    )
    expect(convertPath).toHaveBeenCalledWith(
      '/main-owned/import-123/input.docx'
    )
    expect(remove).toHaveBeenCalledWith(
      '/main-owned/import-123',
      { recursive: true, force: true }
    )
  })

  it('removes the generated input after a converter failure', async() => {
    const remove = vi.fn(async() => {})

    await expect(convertDocumentImportBinary(
      'docx',
      new Uint8Array([0x50, 0x4b]),
      {
        temporaryRoot: '/main-owned',
        mkdtemp: vi.fn(async() => '/main-owned/import-failed'),
        writeFile: vi.fn(async() => {}),
        remove,
        convertPath: vi.fn(async() => {
          throw new Error('pandoc rejected input')
        })
      }
    )).rejects.toThrow(/pandoc rejected input/i)

    expect(remove).toHaveBeenCalledWith(
      '/main-owned/import-failed',
      { recursive: true, force: true }
    )
  })
})
