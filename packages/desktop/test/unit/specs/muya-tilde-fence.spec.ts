// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Upstream MarkText #5600: a tilde-fenced code block keeps its fence
// character in Muya's state, so the active block draws `~~~` in its marker.
describe('fence character in the Markup view', () => {
  it.each([
    { markdown: '~~~js\nconst x = 1\n~~~\n', tilde: true },
    { markdown: '~~~\nplain\n~~~\n', tilde: true },
    { markdown: '> ~~~~ py\n> x\n> ~~~~\n', tilde: true },
    { markdown: '```js\nconst x = 1\n```\n', tilde: false },
    { markdown: '    indented\n', tilde: false }
  ])('marks $markdown', ({ markdown, tilde }) => {
    const app = bootBoundMuya(markdown)
    try {
      const root = app.muya.editor.scrollPage?.domNode
      if (!(root instanceof HTMLElement)) throw new Error('Expected rendered document')
      const block = root.querySelector('pre.mu-code-block')
      expect(block).not.toBeNull()
      expect(block?.classList.contains('mu-tilde-fence')).toBe(tilde)
      const reply = app.binding.sourceAtBarrier()
      expect(reply.type === 'source' ? reply.source : undefined).toBe(markdown)
    } finally {
      app.dispose()
    }
  })
})
