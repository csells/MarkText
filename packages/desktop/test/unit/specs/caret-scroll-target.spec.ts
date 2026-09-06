import { expect, it } from 'vitest'
import { caretScrollTarget } from '@/util/caretScrollTarget'

it('compares viewport caret coordinates with the editor viewport rather than its height alone', () => {
  expect(caretScrollTarget({ top: 150, height: 300, scrollTop: 0 }, 300)).toBe(0)
  expect(caretScrollTarget({ top: 150, height: 300, scrollTop: 0 }, 420)).toBe(70)
  expect(caretScrollTarget({ top: 150, height: 300, scrollTop: 200 }, 170)).toBe(120)
})
