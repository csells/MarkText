import { describe, expect, it } from 'vitest'
import { exportedDocumentText } from '../../e2e/helpers/exportedDocumentText'

describe('export document content assertions', () => {
  it('allows Mermaid custom properties while preserving its diagram labels', () => {
    const html =
      '<article>Export Authority<svg><style>:root{--mermaid-font-family:verdana;}</style>' +
      '<foreignObject><div>MT_DIAGRAM_118</div></foreignObject></svg></article>'
    const text = exportedDocumentText(html)
    expect(text).toContain('Export Authority')
    expect(text).toContain('MT_DIAGRAM_118')
    expect(text).not.toContain('{--')
  })

  it.each([
    '<p>{--deleted--}</p>',
    '<p>&#123;--deleted--}</p>',
    '<p><span>{</span><span>--deleted--}</span></p>',
    '<svg><foreignObject><div>{--deleted--}</div></foreignObject></svg>'
  ])('still fails the delimiter assertion for a real CM leak: %s', (html) => {
    expect(() => expect(exportedDocumentText(html)).not.toContain('{--')).toThrow()
  })
})
