import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'

import {
  countProjectedDocument,
  createProjectedClipboardPayload,
  createProjectedSearchReplacementPlan,
  renderProjectedDocumentHtml,
  searchProjectedDocument,
  tocProjectedDocument
} from '@/documentConsumers/documentProjectionConsumers'

const revisedProjectionOf = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  return core.project(revision, 'revised')
}

describe('document projection search and count consumers', () => {
  it('searches and counts the declared Revised projection without source or DOM authority', () => {
    const projection = revisedProjectionOf(
      '# Alpha\n\nKeep {~~old words~>new words~~}; drop {--gone--}; add {++fresh++}.\n\n' +
      '{>>private note<<}\n'
    )

    expect(searchProjectedDocument(projection, 'new words')).toMatchObject({
      index: 0,
      value: 'new words',
      matches: [{ start: 5, end: 14, match: 'new words' }]
    })
    expect(searchProjectedDocument(projection, 'old words').matches).toEqual([])
    expect(searchProjectedDocument(projection, 'gone').matches).toEqual([])
    expect(searchProjectedDocument(projection, 'private note').matches).toEqual([])
    expect(searchProjectedDocument(projection, 'fresh').matches).toHaveLength(1)

    expect(countProjectedDocument(projection)).toEqual({
      paragraph: 2,
      word: 9,
      character: 33,
      all: 45
    })
  })

  it('renders safe HTML directly from the declared projection AST', () => {
    const projection = revisedProjectionOf(
      '# Alpha\n\nKeep {~~legacy~>new~~} and {++**bold**++}. ' +
      '{--gone--}{>>private note<<}<script>alert(1)</script>\n'
    )

    const html = renderProjectedDocumentHtml(projection)

    expect(html).toContain('<h1 id="alpha">Alpha</h1>')
    expect(html).toContain(
      '<p>Keep new and <strong>bold</strong>. &lt;script&gt;alert(1)&lt;/script&gt;</p>'
    )
    expect(html).not.toContain('legacy')
    expect(html).not.toContain('gone')
    expect(html).not.toContain('private note')
    expect(html).not.toContain('<script')
  })

  it('derives export TOC text and levels from Revised heading semantics', () => {
    const projection = revisedProjectionOf([
      '# Keep {~~old~>current~~}',
      '',
      '## Use **bold** and [a link](https://example.com)',
      '',
      '### Drop {--gone--} add {++fresh++}'
    ].join('\n'))

    expect(tocProjectedDocument(projection)).toEqual([
      { lvl: 1, content: 'Keep current' },
      { lvl: 2, content: 'Use bold and a link' },
      { lvl: 3, content: 'Drop  add fresh' }
    ])
  })

  it('builds every shipped clipboard flavor from one projection', () => {
    const projection = revisedProjectionOf(
      'Keep {~~legacy~>current~~}, {++fresh++}, {--gone--}. {>>note<<}\n'
    )

    expect(createProjectedClipboardPayload(
      projection,
      'markdown',
      { kind: 'document' }
    )).toEqual({
      text: 'Keep current, fresh, . \n',
      html: ''
    })
    expect(createProjectedClipboardPayload(
      projection,
      'html',
      { kind: 'document' }
    )).toEqual({
      text: '<p>Keep current, fresh, .</p>\n',
      html: ''
    })
    expect(createProjectedClipboardPayload(
      projection,
      'rich',
      { kind: 'document' }
    )).toEqual({
      text: 'Keep current, fresh, . \n',
      html: '<p>Keep current, fresh, .</p>\n'
    })
  })

  it('fails closed when a selection-scoped projection has not been proven', () => {
    const documentProjection = revisedProjectionOf('alpha **beta** gamma\n')

    expect(createProjectedClipboardPayload(
      documentProjection,
      'rich',
      { kind: 'selection' }
    )).toBeUndefined()

    const selectionProjection = revisedProjectionOf('**beta**')
    expect(createProjectedClipboardPayload(
      documentProjection,
      'rich',
      { kind: 'selection', projection: selectionProjection }
    )).toEqual({
      text: '**beta**',
      html: '<p><strong>beta</strong></p>\n'
    })
  })

  it('preserves upstream case, whole-word, regex, and invalid-regex behavior', () => {
    const projection = revisedProjectionOf('cat scatter CAT 123\n')

    expect(searchProjectedDocument(projection, 'cat').matches).toHaveLength(3)
    expect(searchProjectedDocument(projection, 'cat', {
      isCaseSensitive: true
    }).matches).toHaveLength(2)
    expect(searchProjectedDocument(projection, 'cat', {
      isWholeWord: true
    }).matches).toHaveLength(2)
    expect(searchProjectedDocument(projection, '(cat|123)', {
      isRegexp: true
    }).matches.map(match => match.match)).toEqual(['cat', 'cat', 'CAT', '123'])
    expect(searchProjectedDocument(projection, '[', {
      isRegexp: true
    }).matches).toEqual([])
  })

  it('plans replace-current from one exact projected search identity', () => {
    const result = searchProjectedDocument(
      revisedProjectionOf('cat cat\n'),
      'cat'
    )

    expect(createProjectedSearchReplacementPlan(result, 'dog', {
      isSingle: true,
      isRegexp: false
    })).toEqual([{
      match: { path: [0], start: 0, end: 3, match: 'cat' },
      insert: 'dog'
    }])
  })

  it('plans regex replace-all with each match\'s captured groups', () => {
    const result = searchProjectedDocument(
      revisedProjectionOf('cat-12 cat-34\n'),
      '(cat)-(\\d+)',
      { isRegexp: true }
    )

    expect(createProjectedSearchReplacementPlan(result, '$2:$1:$0', {
      isSingle: false,
      isRegexp: true
    })).toEqual([
      {
        match: { path: [0], start: 0, end: 6, match: 'cat-12' },
        insert: '12:cat:cat-12'
      },
      {
        match: { path: [0], start: 7, end: 13, match: 'cat-34' },
        insert: '34:cat:cat-34'
      }
    ])
  })
})
