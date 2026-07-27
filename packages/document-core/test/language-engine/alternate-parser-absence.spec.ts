import {
  existsSync,
  readFileSync,
  readdirSync
} from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = process.cwd()
const THIS_FILE = path.resolve(
  PACKAGE_ROOT,
  'test/language-engine/alternate-parser-absence.spec.ts'
)

function typescriptFiles(directory: string): readonly string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...typescriptFiles(absolute))
    } else if (
      entry.isFile() &&
      absolute.endsWith('.ts') &&
      absolute !== THIS_FILE
    ) {
      files.push(absolute)
    }
  }
  return files
}

describe('alternate projected-parser absence gate', () => {
  it('keeps whole-lane parser and clean-verifier entry points out of production and tests', () => {
    const forbidden = [
      'parseMarkdownDocument',
      'planMarkdownArmBoundaryProjectionEdits',
      'parseMarkdownDocumentWithBoundaryEvidence',
      'verifyCleanProjectedMarkdownV1',
      'parsePlainMarkdownLaneReusing',
      'shiftPlainMarkdownLane',
      'PlainMarkdownLaneReuse',
      'laneSafeOffsets',
      'recordProjectedMarkdownTraversalV1',
      'recordProjectedAstTraversalV1',
      'recordProjectedAstCacheReuseV1',
      'recordProjectedBoundaryGrammarTraversalV1',
      'isMarkdownTextTapeRole'
    ]
    const violations = [
      ...typescriptFiles(path.join(PACKAGE_ROOT, 'src')),
      ...typescriptFiles(path.join(PACKAGE_ROOT, 'test'))
    ].flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return forbidden
        .filter(token => source.includes(token))
        .map(token => `${path.relative(PACKAGE_ROOT, file)}:${token}`)
    })

    expect(violations).toEqual([])
  })

  it('does not restore tests for deleted alternate parser seams', () => {
    for (const relative of [
      'test/language-engine/projection-clean-verifier.spec.ts',
      'test/language-engine/lane-reuse.spec.ts',
      'test/language-engine/lane-splice.spec.ts'
    ]) {
      expect(existsSync(path.join(PACKAGE_ROOT, relative)), relative)
        .toBe(false)
    }
  })
})
