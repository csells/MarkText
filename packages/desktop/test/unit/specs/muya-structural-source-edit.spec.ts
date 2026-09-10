import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { sourceEditForMuyaStructuralChange } from '@/documentAuthority/muyaStructuralSourceEdit'
import { advanceMuyaSourceBinding } from '@/documentAuthority/muyaPlainTextSourceEdit'

const viewOf = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  return createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
}

describe('native structural source edits', () => {
  it.each(['{==plain==}', '{~~old~>new~~}', 'before {~~old~>new~~}', '{>>note<<}{++plain++}'])(
    'leaves annotated quote wrapping to its model command for %s',
    (content) => {
      const source = content + '\n'
      const view = viewOf(source)
      const quote = { name: 'block-quote', children: [view.state[0]] }
      expect(
        sourceEditForMuyaStructuralChange(view.bindings, {
          source: 'user',
          prevDoc: view.state,
          doc: [quote],
          op: [0, { r: true, i: quote }]
        })
      ).toBeUndefined()
      const core = createDocumentCore()
      const revision = core.open(source)
      const action = {
        kind: 'command' as const,
        command: 'changeBlockquote' as const,
        change: { type: 'set' as const },
        selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
        options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      }
      const plan = core.planInput(revision, action)
      const edits = core.inputEdits(revision, action, plan, false)
      expect(edits).toBeDefined()
      if (edits === undefined) throw new Error('Expected the quote model command')
      expect(core.apply(revision, edits).revision.source).toBe('> ' + source)
    }
  )

  it.each(['{==plain==}', '{~~old~>new~~}', 'before {~~old~>new~~}', '{>>note<<}{++plain++}'])(
    'wraps %s in a list without rewriting annotation content',
    (source) => {
      const view = viewOf(`${source}\n`)
      const list = {
        name: 'bullet-list',
        meta: { marker: '*', loose: false },
        children: [{ name: 'list-item', children: [view.state[0]] }]
      }
      expect(
        sourceEditForMuyaStructuralChange(view.bindings, {
          source: 'user',
          prevDoc: view.state,
          doc: [list],
          op: [0, { r: true, i: list }]
        })
      ).toEqual({ start: 0, end: 0, insert: '* ' })
    }
  )

  it.each(['{++one\ntwo++}'])(
    'preserves multiline annotation bytes when adding a list prefix for %s',
    (source) => {
      const view = viewOf(`${source}\n`)
      const list = {
        name: 'bullet-list',
        meta: { marker: '-', loose: false },
        children: [{ name: 'list-item', children: [view.state[0]] }]
      }
      expect(
        sourceEditForMuyaStructuralChange(view.bindings, {
          source: 'user',
          prevDoc: view.state,
          doc: [list],
          op: [0, { r: true, i: list }]
        })
      ).toEqual({ start: 0, end: 0, insert: '- ' })
    }
  )

  it('refuses a list conversion that also changes an annotation payload', () => {
    const view = viewOf('{++plain++}\n')
    const list = {
      name: 'bullet-list',
      meta: { marker: '-', loose: false },
      children: [{ name: 'list-item', children: [{ name: 'paragraph', text: 'changed' }] }]
    }
    expect(
      sourceEditForMuyaStructuralChange(view.bindings, {
        source: 'user',
        prevDoc: view.state,
        doc: [list],
        op: [0, { r: true, i: list }]
      })
    ).toBeUndefined()
  })

  for (const endings of [
    ['\r\n', '\r\n'],
    ['\r', '\r'],
    ['\r\n', '\n']
  ] as const) {
    it(`preserves ${JSON.stringify(endings)} while indenting a list item`, () => {
      const source = `- one${endings[0]}- two${endings[1]}- three\r\n\r\nuntouched\r\n`
      const view = viewOf(source)
      const doc = structuredClone(view.state) as unknown as Array<{
        children: Array<{ children: unknown[] }>
      }>
      const second = doc[0].children.splice(1, 1)[0]
      doc[0].children[0].children.push({
        name: 'bullet-list',
        meta: { marker: '-', loose: false },
        children: [second]
      })
      const edit = sourceEditForMuyaStructuralChange(view.bindings, {
        source: 'user',
        prevDoc: view.state,
        doc,
        op: [0, { r: true, i: doc[0] }]
      })
      expect(edit).toBeDefined()
      const core = createDocumentCore()
      const result = core.apply(core.open(source), [edit!])
      expect(result.revision.source).toBe(
        `- one${endings[0]}  - two${endings[1]}- three\r\n\r\nuntouched\r\n`
      )
    })
  }

  for (const ending of ['\r\n', '\r']) {
    it(`uses adjacent ${JSON.stringify(ending)} for new code-block lines`, () => {
      const source = `seed${ending}${ending}untouched${ending}`
      const view = viewOf(source)
      const code = { name: 'code-block', text: 'seed', meta: { type: 'fenced', lang: 'js' } }
      const edit = sourceEditForMuyaStructuralChange(view.bindings, {
        source: 'user',
        prevDoc: view.state,
        doc: [code, view.state[1]],
        op: [0, { r: true, i: code }]
      })
      expect(edit).toEqual({ start: 0, end: 4, insert: `\`\`\`js${ending}seed${ending}\`\`\`` })
      const core = createDocumentCore()
      expect(core.apply(core.open(source), [edit!]).revision.source).toBe(
        `\`\`\`js${ending}seed${ending}\`\`\`${ending}${ending}untouched${ending}`
      )
    })
  }

  it('serializes a paragraph-to-code conversion inside its parser-owned source span', () => {
    const plain = viewOf('before\n\nseed\n\nafter\n')
    const code = { name: 'code-block', text: '', meta: { type: 'fenced', lang: 'js' } }
    const doc = [plain.state[0], code, plain.state[2]]
    expect(
      sourceEditForMuyaStructuralChange(plain.bindings, {
        source: 'user',
        prevDoc: plain.state,
        doc,
        op: [1, { r: true, i: code }]
      })
    ).toEqual({ start: 8, end: 12, insert: '```js\n\n```' })
  })

  it('rejects a document change not produced by its native operation', () => {
    const view = viewOf('one\n\ntwo\n')
    const replacement = { name: 'paragraph', text: 'replacement' }
    expect(
      sourceEditForMuyaStructuralChange(view.bindings, {
        source: 'user',
        prevDoc: view.state,
        doc: [replacement, replacement],
        op: [0, { r: true, i: replacement }]
      })
    ).toBeUndefined()
  })

  it('serializes nested list structure with existing Muya list conventions', () => {
    const view = viewOf('- one\n- two\n\nuntouched\n')
    const doc = structuredClone(view.state)
    const list = doc[0] as unknown as { children: Array<{ children: unknown[] }> }
    const second = list.children.pop()
    list.children[0].children.push({
      name: 'bullet-list',
      meta: { marker: '-', loose: false },
      children: [second]
    })
    expect(
      sourceEditForMuyaStructuralChange(view.bindings, {
        source: 'user',
        prevDoc: view.state,
        doc,
        op: [0, { r: true, i: doc[0] }]
      })
    ).toEqual({ start: 0, end: 11, insert: '- one\n  - two' })
  })

  it('refuses a container with hidden annotations and a stale native previous leaf', () => {
    for (const source of ['- {++one++}\n- two\n', '- one\n- two\n']) {
      const view = viewOf(source)
      const prevDoc = structuredClone(view.state)
      const doc = [{ name: 'paragraph', text: 'replacement' }]
      if (!source.includes('{++')) {
        const list = prevDoc[0] as unknown as {
          children: Array<{ children: Array<{ text: string }> }>
        }
        list.children[0].children[0].text = 'stale'
      }
      expect(
        sourceEditForMuyaStructuralChange(view.bindings, {
          source: 'user',
          prevDoc,
          doc,
          op: [0, { r: true, i: doc[0] }]
        })
      ).toBeUndefined()
    }
  })

  it('rebases the outer block source while a different leaf has an ordinary pending edit', () => {
    const view = viewOf('- one\n- two\n')
    const bindings = view.bindings.map((binding) =>
      advanceMuyaSourceBinding(binding, { start: 11, end: 11, insert: '!' })
    )
    expect(bindings[0].outerBlock).toEqual({
      range: { start: 0, end: 12 },
      source: '- one\n- two!',
      followingSource: '\n'
    })
  })

  it('retains the surviving line endings when removing an item from a mixed-EOL list', () => {
    const source = '- one\r\n- two\n- three\r\n\r\nuntouched\r\n'
    const view = viewOf(source)
    const doc = structuredClone(view.state) as unknown as Array<{ children: unknown[] }>
    doc[0].children.shift()
    const edit = sourceEditForMuyaStructuralChange(view.bindings, {
      source: 'user',
      prevDoc: view.state,
      doc,
      op: [0, { r: true, i: doc[0] }]
    })
    const core = createDocumentCore()
    expect(core.apply(core.open(source), [edit!]).revision.source).toBe(
      '- two\n- three\r\n\r\nuntouched\r\n'
    )
  })

  it('carries mixed source separators into a structural change spanning multiple blocks', () => {
    const source = 'one\r\n\ntwo\r\n\r\nuntouched\r\n'
    const view = viewOf(source)
    const list = {
      name: 'bullet-list',
      meta: { marker: '-', loose: false },
      children: [view.state[0], view.state[1]].map((paragraph) => ({
        name: 'list-item',
        children: [paragraph]
      }))
    }
    const edit = sourceEditForMuyaStructuralChange(view.bindings, {
      source: 'user',
      prevDoc: view.state,
      doc: [list, view.state[2]],
      op: [
        [0, { r: true, i: list }],
        [1, { r: true }]
      ]
    })
    const core = createDocumentCore()
    expect(core.apply(core.open(source), [edit!]).revision.source).toBe(
      '- one\r\n- two\r\n\r\nuntouched\r\n'
    )
  })

  it('rejects unsupported state fields instead of silently dropping them during serialization', () => {
    const view = viewOf('seed\n')
    const replacement = { name: 'paragraph', text: 'changed', surprise: 'must not disappear' }
    expect(
      sourceEditForMuyaStructuralChange(view.bindings, {
        source: 'user',
        prevDoc: view.state,
        doc: [replacement],
        op: [0, { r: true, i: replacement }]
      })
    ).toBeUndefined()
  })

  it('rejects invalid structural positions and respects the remaining native input budget', () => {
    const view = viewOf('seed\n')
    const replacement = { name: 'atx-heading', text: '# seed', meta: { level: 100000000 } }
    expect(
      sourceEditForMuyaStructuralChange(view.bindings, {
        source: 'user',
        prevDoc: view.state,
        doc: [replacement],
        op: [0, { r: true, i: replacement }]
      })
    ).toBeUndefined()
    const paragraph = { name: 'paragraph', text: 'larger than the remaining budget' }
    expect(
      sourceEditForMuyaStructuralChange(
        view.bindings,
        {
          source: 'user',
          prevDoc: view.state,
          doc: [paragraph],
          op: [0, { r: true, i: paragraph }]
        },
        8
      )
    ).toBeUndefined()
  })
})
