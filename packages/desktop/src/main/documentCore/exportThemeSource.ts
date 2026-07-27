import {
  lstat,
  readFile,
  readdir
} from 'node:fs/promises'
import path from 'node:path'
import academicTheme from '../../renderer/src/assets/themes/export/academic.theme.css?inline'
import liberTheme from '../../renderer/src/assets/themes/export/liber.theme.css?inline'
import type {
  DocumentCoreExportTheme,
  DocumentCoreExportThemeDescriptor
} from '../../shared/types/documentCore'
import type {
  DocumentCoreExportThemeSource
} from './exportDecorator'

const MAXIMUM_THEME_BYTES = 1024 * 1024
const SAFE_THEME_FILENAME = /^[\p{L}\p{N}_. -]+\.css$/u

export interface DocumentCoreExportThemeCatalog
  extends DocumentCoreExportThemeSource {
  readonly listCustomThemes: () =>
  Promise<readonly DocumentCoreExportThemeDescriptor[]>
}

function safeThemeFilename(name: string): boolean {
  return (
    SAFE_THEME_FILENAME.test(name) &&
    name !== '.css' &&
    !name.includes('..') &&
    path.basename(name) === name
  )
}

async function regularThemeCss(
  directory: string,
  name: string
): Promise<string> {
  if (!safeThemeFilename(name)) {
    throw new TypeError('Export theme filename is not safe')
  }
  const filename = path.join(directory, name)
  const information = await lstat(filename)
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new TypeError('Export theme must be a regular file')
  }
  if (information.size > MAXIMUM_THEME_BYTES) {
    throw new TypeError('Export theme exceeds the size limit')
  }
  return await readFile(filename, 'utf8')
}

function themeLabel(name: string, css: string): string {
  const comment = /^\s*\/\*+\s*([^*][\s\S]*?)\s*\*+\//.exec(css)
  const label = comment?.[1]?.trim()
  return label === undefined || label.length === 0 ? name : label
}

export function createFileDocumentCoreExportThemeSource(
  directory: string
): DocumentCoreExportThemeCatalog {
  const cssFor = async(theme: DocumentCoreExportTheme): Promise<string> => {
    if (theme.kind === 'built-in') {
      switch (theme.name) {
        case 'default':
          return ''
        case 'academic':
          return academicTheme
        case 'liber':
          return liberTheme
      }
    }
    return await regularThemeCss(directory, theme.name)
  }

  const listCustomThemes = async(): Promise<
    readonly DocumentCoreExportThemeDescriptor[]
  > => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error: unknown) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return Object.freeze([])
      }
      throw error
    }
    const descriptors = await Promise.all(entries
      .filter(entry =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        safeThemeFilename(entry.name)
      )
      .map(async entry => {
        try {
          const css = await regularThemeCss(directory, entry.name)
          return Object.freeze({
            name: entry.name,
            label: themeLabel(entry.name, css)
          })
        } catch {
          return null
        }
      }))
    return Object.freeze(descriptors
      .filter((
        descriptor
      ): descriptor is Readonly<DocumentCoreExportThemeDescriptor> =>
        descriptor !== null
      )
      .sort((left, right) => left.label.localeCompare(right.label)))
  }

  return Object.freeze({ cssFor, listCustomThemes })
}
