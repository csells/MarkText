import { expect, it } from 'vitest'
import { HTML_TAGS, VOID_HTML_TAGS, htmlBlockTemplate, htmlBlockTemplateTag } from '../src/index'

it('shares the html-tags element tables', () => {
  expect(HTML_TAGS).toContain('div')
  expect(VOID_HTML_TAGS).toContain('br')
})

it.each([
  ['<div>', 'div'],
  ['<section>', 'section'],
  ['<div class="x">', 'div'],
  ['<span>', 'span'],
  ['<br>', undefined],
  ['<DIV>', undefined],
  ['<custom-el>', undefined],
  ['<div>x', undefined],
  ['hello', undefined]
])('matches %s as an Enter template opener', (text, tag) => {
  expect(htmlBlockTemplateTag(text)).toBe(tag)
})

it('spells the template with container continuations on every new line', () => {
  expect(htmlBlockTemplate('div', '\n', '')).toEqual({ markdown: '<div>\n\n</div>', caret: 6 })
  expect(htmlBlockTemplate('section', '\r\n', '> ')).toEqual({ markdown: '<section>\r\n> \r\n> </section>', caret: 13 })
})
