import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const desktopRoot = path.resolve(__dirname, '../../..')
const source = (relative: string): string =>
  readFileSync(path.join(desktopRoot, relative), 'utf8')

const SURFACE_MODULES = [
  'src/main/documentCore/documentCorePerformanceSurface.ts',
  'src/main/documentCore/staticSinkAcceptanceSurface.ts'
]

const walkSources = (relative: string): string[] => {
  const absolute = path.join(desktopRoot, relative)
  const collected: string[] = []
  for (const entry of readdirSync(absolute)) {
    const child = path.join(relative, entry)
    if (statSync(path.join(desktopRoot, child)).isDirectory()) {
      collected.push(...walkSources(child))
    } else if (/\.(ts|vue)$/.test(entry)) {
      collected.push(child)
    }
  }
  return collected
}

/**
 * G6: the PERF_TESTING branch in production main installs observation and
 * orchestration surfaces only. This sweep pins that ratifiable form: the
 * surfaces construct no session, no parser, and no private document state
 * of their own — every document answer they return is read or orchestrated
 * through the same production hosts the product uses.
 */
describe('observation surfaces construct nothing of their own', () => {
  it('never constructs an engine, session, or source snapshot', () => {
    for (const module of SURFACE_MODULES) {
      const text = source(module)
      for (const constructor of [
        'createLanguageEngine',
        'createDocumentSession',
        'createSourceSnapshot',
        'createMarkupView'
      ]) {
        expect(text, `${module} must not call ${constructor}`)
          .not.toContain(constructor)
      }
    }
  })

  it('imports only verification codecs and types from document-core', () => {
    const [performanceModule, staticSinkModule] = SURFACE_MODULES
    if (performanceModule === undefined || staticSinkModule === undefined) {
      throw new Error('The surface module list is incomplete')
    }
    const valueImport = source(performanceModule).match(
      /import \{[^}]*\} from '@marktext\/document-core'/
    )?.[0]
    if (valueImport === undefined) {
      throw new Error('The performance surface lost its codec import')
    }
    const imported = valueImport
      .replace(/import \{|\} from '@marktext\/document-core'/g, '')
      .split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0)
    // Wire verification decodes what production already committed; it can
    // reconstruct nothing the session did not publish.
    expect(imported.sort()).toEqual([
      'WireEnvelopeCodecV1',
      'decodeFileSnapshot'
    ])
    expect(source(staticSinkModule)).not.toContain(
      "from '@marktext/document-core'"
    )
  })

  it('receives production hosts as arguments instead of building them', () => {
    for (const module of SURFACE_MODULES) {
      const text = source(module)
      for (const hostConstructor of [
        'createDocumentCoreMainSessionHost',
        'createDocumentCoreFileHost',
        'createDocumentCoreStaticSinkHost('
      ]) {
        expect(text, `${module} must not construct ${hostConstructor}`)
          .not.toContain(hostConstructor)
      }
    }
  })

  it('keeps PERF_TESTING confined to the one production install site', () => {
    const installSite = 'src/main/ipc/documentCore.ts'
    const install = source(installSite)
    // The recorder guard plus the two idempotent surface installs.
    expect(install.match(/process\.env\.PERF_TESTING/g)).toHaveLength(3)

    for (const file of [
      ...walkSources('src/main'),
      ...walkSources('src/renderer'),
      ...walkSources('src/preload'),
      ...walkSources('src/shared')
    ]) {
      if (file === installSite) continue
      expect(source(file), `${file} must not read PERF_TESTING`)
        .not.toContain('PERF_TESTING')
    }
  })
})
