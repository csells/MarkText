import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const editorSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/editorWithTabs/editor.vue'),
  'utf8'
)

describe('custom export theme failure routing', () => {
  for (const [type, successCall] of [
    ['styledHtml', 'editorStore.EXPORT'],
    ['pdf', 'editorStore.EXPORT'],
    ['print', 'editorStore.PRINT_RESPONSE']
  ] as const) {
    it(`prepares ${type} CSS inside its canonical failure handler`, () => {
      const start = editorSource.indexOf(`case '${type}':`)
      const end = editorSource.indexOf('\n    case ', start + 1)
      const branch = editorSource.slice(start, end === -1 ? undefined : end)
      const tryAt = branch.indexOf('try {')
      const cssAt = branch.indexOf('await getCssForOptions')
      const successAt = branch.indexOf(successCall)
      const catchAt = branch.indexOf('} catch (err) {')

      expect(start).toBeGreaterThanOrEqual(0)
      expect(tryAt).toBeGreaterThanOrEqual(0)
      expect(cssAt).toBeGreaterThan(tryAt)
      expect(successAt).toBeGreaterThan(cssAt)
      expect(catchAt).toBeGreaterThan(successAt)
      expect(branch.slice(catchAt)).toContain('notice.notify')
    })
  }
})
