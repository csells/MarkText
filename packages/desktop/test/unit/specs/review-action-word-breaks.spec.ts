import { describe, expect, it } from 'vitest'
import { reviewActionWordBreaks } from '../../e2e/helpers/reviewActionWordBreaks'

describe('review action geometry readiness', () => {
  it.each(['', '<div class="core-review-item-actions"></div>'])(
    'rejects an unpopulated review panel instead of passing: %s',
    (html) => {
      const panel = document.createElement('section')
      panel.innerHTML = html
      expect(() => reviewActionWordBreaks(panel)).toThrow('No review actions to measure')
    }
  )
})
