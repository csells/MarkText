import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  mkdtemp as makeTemporaryDirectory,
  rm,
  writeFile
} from 'node:fs/promises'
import { PANDOC_EXTENSIONS } from '../config'
import pandoc from '../utils/pandoc'

export interface DocumentImportBinaryConverterDependencies {
  readonly temporaryRoot: string
  readonly mkdtemp: (prefix: string) => Promise<string>
  readonly writeFile: (
    pathname: string,
    bytes: Uint8Array,
    options: Readonly<{ flag: 'wx' }>
  ) => Promise<unknown>
  readonly remove: (
    pathname: string,
    options: Readonly<{ recursive: true; force: true }>
  ) => Promise<unknown>
  readonly convertPath: (pathname: string) => Promise<string>
}

const productionDependencies: DocumentImportBinaryConverterDependencies =
  Object.freeze({
    temporaryRoot: tmpdir(),
    mkdtemp: makeTemporaryDirectory,
    writeFile,
    remove: rm,
    convertPath: async(pathname: string) =>
      await pandoc(pathname, 'markdown')()
  })

export async function convertDocumentImportBinary(
  extension: string,
  bytes: Uint8Array,
  dependencies: DocumentImportBinaryConverterDependencies =
  productionDependencies
): Promise<string> {
  if (
    !PANDOC_EXTENSIONS.includes(extension) ||
    extension !== extension.toLowerCase()
  ) {
    throw new TypeError('Unsupported document import extension')
  }
  const directory = await dependencies.mkdtemp(
    path.join(dependencies.temporaryRoot, 'marktext-import-')
  )
  try {
    const input = path.join(directory, `input.${extension}`)
    await dependencies.writeFile(input, bytes, { flag: 'wx' })
    return await dependencies.convertPath(input)
  } finally {
    await dependencies.remove(directory, {
      recursive: true,
      force: true
    })
  }
}
