import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(__dirname, '../../../../..')
const PACKAGE_SOURCE = 'packages/desktop/src'
const AUTHORITY = 'packages/desktop/src/shared/types/closedRecord.ts'

/**
 * Modules that still decide record shape themselves. Both reject unknown keys
 * without requiring declared ones, so migrating them is not a rename: each
 * record has to state which of its fields are required, and the wire surface
 * carries fields where absent means the default. This list only shrinks.
 */
const DECLARES_ITS_OWN_SHAPE: readonly string[] = [
  'packages/desktop/src/main/ipc/documentCoreRuntimeCodec.ts',
  'packages/desktop/src/main/ipc/projectSearchRuntimeCodec.ts'
]

const trackedSources = (): readonly string[] =>
  execFileSync('git', ['ls-files', '-z', PACKAGE_SOURCE], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(path => path.endsWith('.ts') || path.endsWith('.vue'))

const definesItsOwnDecoder = (path: string): boolean => {
  const text = readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8')
  const declares =
    text.includes('function closedRecord(') ||
    text.includes('const closedRecord = ')
  return declares && !text.includes('decodeClosedRecord(')
}

// G20: a second decoder is how the two strengths diverged in the first place —
// one rejected unknown keys but let a missing one through, the other could not
// express an optional field at all, and nothing made them agree.
describe('closed record decoding has one authority', () => {
  it('routes every codec through the shared decoder', () => {
    const offenders = trackedSources()
      .filter(path => path !== AUTHORITY)
      .filter(definesItsOwnDecoder)
      .filter(path => !DECLARES_ITS_OWN_SHAPE.includes(path))
    expect(offenders).toEqual([])
  })

  it('keeps the unmigrated list honest', () => {
    const stillLocal = trackedSources()
      .filter(path => path !== AUTHORITY)
      .filter(definesItsOwnDecoder)
    expect([...stillLocal].sort())
      .toEqual([...DECLARES_ITS_OWN_SHAPE].sort())
  })
})
