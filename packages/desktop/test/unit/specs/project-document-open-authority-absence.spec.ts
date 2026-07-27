import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const desktopRoot = path.resolve(__dirname, '../../..')
const source = (relative: string): string =>
  readFileSync(path.join(desktopRoot, relative), 'utf8')

describe('project-document admission authority absence', () => {
  it('has no renderer path/window-id file-open channel', () => {
    const ipc = source('src/shared/types/ipc.ts')
    const renderer = [
      'src/renderer/src/components/sideBar/treeFile.vue',
      'src/renderer/src/components/sideBar/searchResultItem.vue',
      'src/renderer/src/commands/quickOpen.ts'
    ].map(source).join('\n')
    const main = [
      'src/main/app/index.ts',
      'src/main/app/windowManager.ts'
    ].map(source).join('\n')

    for (const retiredChannel of [
      'mt::open-file',
      'mt::open-file-by-window-id'
    ]) {
      expect(ipc).not.toContain(`'${retiredChannel}'`)
      expect(renderer).not.toContain(`'${retiredChannel}'`)
      expect(main).not.toContain(`'${retiredChannel}'`)
    }
    expect(ipc).toContain("'mt::project::open-document'")
  })
})
