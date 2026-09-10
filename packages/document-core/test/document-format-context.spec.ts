import { describe, expect, it } from 'vitest'
import { createDocumentCore, documentActiveFormats } from '../src/index.js'

describe('active formatting from the owned Markdown and CriticMarkup syntax', () => {
  it.each([
    { source: '**_x_**\n', start: 3, end: 4, expected: [{ type: 'strong' }, { type: 'em' }] },
    { source: '`a`{++`a`++}`a`\n', start: 0, end: 9, expected: [] },
    { source: '`a``a``a`\n', start: 0, end: 9, expected: [{ type: 'inline_code' }] },
    { source: 'a <u>x</u> b\n', start: 5, end: 6, expected: [{ type: 'html_tag', tag: 'u' }] },
    { source: 'a <mark>x</mark> b\n', start: 8, end: 9, expected: [{ type: 'html_tag', tag: 'mark' }] },
    { source: 'a <sub>x</sub> b\n', start: 7, end: 8, expected: [{ type: 'html_tag', tag: 'sub' }] },
    { source: 'a <sup>x</sup> b\n', start: 7, end: 8, expected: [{ type: 'html_tag', tag: 'sup' }] },
    { source: 'a `<u>x</u>` b\n', start: 6, end: 7, expected: [{ type: 'inline_code' }] },
    { source: 'a <u/>x b\n', start: 6, end: 7, expected: [] },
    { source: 'a <!-- <u> -->x<!-- </u> --> b\n', start: 13, end: 14, expected: [] }
  ])('reads $source without recognizing projected text again', ({ source, start, end, expected }) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const syntax = core.project(revision, 'markup').syntax
    expect(documentActiveFormats(syntax.ast.root, { start, end })).toEqual(expected)
    expect(revision.source).toBe(source)
  })
})
