import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

describe('plan 0009 superseded-design absence', () => {
  it('proves the superseded design archives absent after fixture import', () => {
    for (const archive of [
      'specs/architecture/archive',
      'specs/plans/archive'
    ]) {
      expect(existsSync(resolve(REPO_ROOT, archive)), archive).toBe(false)
    }
  })
})
