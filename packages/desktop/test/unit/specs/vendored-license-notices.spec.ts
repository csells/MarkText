import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('vendored document-core license notices', () => {
  it('ships the character-entities notice outside the renderer bundle', async() => {
    const notice = await readFile(
      resolve(process.cwd(), '../document-core/THIRD-PARTY-NOTICES.txt'),
      'utf8'
    )
    const builder = await readFile(
      resolve(process.cwd(), 'electron-builder.yml'),
      'utf8'
    )

    expect(notice).toContain('character-entities 2.0.2')
    expect(notice).toContain('Copyright (c) 2015 Titus Wormer')
    expect(notice).toContain('The MIT License')
    expect(builder).toContain('from: ../document-core/THIRD-PARTY-NOTICES.txt')
    expect(builder).toContain('to: licenses/document-core-THIRD-PARTY-NOTICES.txt')
  })
})
