import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../..')

describe('renderer coordinate-map authority absence', () => {
  it('keeps coordinate topology in document-core and its wire adapter', () => {
    const remoteSessionSource = readFileSync(path.join(
      desktopRoot,
      'src/renderer/src/components/editorWithTabs/documentCoreRemoteSession.ts'
    ), 'utf8')
    const documentViewSource = readFileSync(path.resolve(
      desktopRoot,
      '../document-view/src/documentCore/documentCoreView.ts'
    ), 'utf8')

    for (const source of [remoteSessionSource, documentViewSource]) {
      for (const forbidden of [
        'mappingRuns',
        'coordinateSpans',
        'interface CoordinateSpan',
        'modelStart:',
        'sourceStart:'
      ]) {
        expect(source).not.toContain(forbidden)
      }
    }

    expect(remoteSessionSource).toContain(
      'modelPositionAtMarkupCoordinateMap'
    )
    expect(remoteSessionSource).not.toContain(
      'sourcePositionAtMarkupCoordinateMap'
    )
    expect(remoteSessionSource).not.toMatch(/\bsourcePositionAt\b/)
    expect(documentViewSource).not.toContain(
      'modelPositionAtMarkupCoordinateMap'
    )
    expect(documentViewSource).not.toContain(
      'sourcePositionAtMarkupCoordinateMap'
    )
    expect(documentViewSource).not.toMatch(/readonly sourcePositionAt:/)
  })
})
