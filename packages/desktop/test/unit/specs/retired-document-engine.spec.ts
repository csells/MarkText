import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Core is the only document engine. The launch switches that restored
// Muya-owned parsing, the diagnostic Shadow parser that ran beside it, the
// Muya view variant that carried Markdown for Muya to parse, and the
// HTML-to-Markdown libraries the retired engine used are gone rather than
// kept as fallbacks (unified-stack contract: retire superseded paths).

const desktopRoot = resolve(import.meta.dirname, '../../..')
const authority = (name: string): string =>
  resolve(desktopRoot, 'src/renderer/src/documentAuthority', name)

describe('the retired document engine', () => {
  it('ships no Shadow parser', () => {
    for (const module of [
      'shadowActor.ts',
      'shadowDocumentAuthority.ts',
      'workerShadowPort.ts',
      'editorShadowBinding.ts',
      'inMemoryShadowPort.ts',
      'protocol.ts'
    ]) {
      expect(existsSync(authority(module)), module).toBe(false)
    }
    expect(
      existsSync(resolve(desktopRoot, 'src/renderer/src/workers/shadowDocumentAuthority.worker.ts'))
    ).toBe(false)
  })

  it('hands Muya only Core-projected state, never Markdown to parse', () => {
    // Its only view is the Core Markup view with projected block state.
    expect(existsSync(authority('muyaPlainTextView.ts'))).toBe(false)
  })

  it('declares none of the retired engine’s HTML-to-Markdown dependencies', () => {
    const manifest = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const declared = { ...manifest.dependencies, ...manifest.devDependencies }
    for (const name of [
      'turndown',
      '@types/turndown',
      'joplin-turndown-plugin-gfm',
      'html-tags',
      'underscore'
    ]) {
      expect(declared, name).not.toHaveProperty(name)
    }
  })
})
