import { describe, expect, it } from 'vitest'
import { createDocumentCore, type CriticMarkupAnnotation, type DocumentAuthorForm } from '../src/index.js'

// Every review form can be authored inside any arm of any
// annotation, a Comment's payload included (Profile 1 N1, N2), and over whole
// annotations, as Google Docs lets you highlight, suggest on or comment on
// text that is itself a suggestion or highlighted. Pairing is properly nested,
// so a form that would cross an annotation's delimiters is refused; only a
// Comment widens to enclose highlighted text it overlaps (Docs' overlapping
// comments).

const containers = [
  { name: 'an Addition', source: 'Lead {++alpha beta gamma++} tail.' },
  { name: 'a Deletion', source: 'Lead {--alpha beta gamma--} tail.' },
  { name: "a Substitution's old arm", source: 'Lead {~~alpha beta gamma~>other~~} tail.' },
  { name: "a Substitution's new arm", source: 'Lead {~~other~>alpha beta gamma~~} tail.' },
  { name: 'commented text', source: 'Lead {==alpha beta gamma==}{>>note<<} tail.' },
  { name: "a Comment's payload", source: 'Lead {>>alpha beta gamma<<} tail.' }
]
const forms: Array<{ form: DocumentAuthorForm, spelled: (text: string) => string }> = [
  { form: 'highlight', spelled: text => `{==${text}==}` },
  { form: 'addition', spelled: text => `{++${text}++}` },
  { form: 'substitution', spelled: text => `{~~${text}~>new~~}` },
  { form: 'comment', spelled: text => `{==${text}==}{>>new<<}` }
]

const plan = (source: string, form: DocumentAuthorForm, start: number, end: number) => {
  const core = createDocumentCore()
  const revision = core.open(`${source}\n`)
  const planned = core.planAuthor(revision, { form, range: { start, end }, text: 'new' })
  if (planned === undefined) return undefined
  const result = core.apply(revision, [planned.edit]).revision
  return { result, selected: result.source.slice(planned.selection.start, planned.selection.end) }
}

const kinds = (annotations: readonly CriticMarkupAnnotation[]): string[] =>
  annotations.flatMap(annotation =>
    [annotation.kind, ...annotation.arms.flatMap(arm => kinds(arm.annotations).map(kind => `${annotation.kind}>${kind}`))])

describe('Review forms nested in and around existing annotations', () => {
  describe.each(containers)('in $name', ({ source }) => {
    const inner = source.indexOf('beta')

    it.each(forms)('authors $form inside it, nested in its arm', ({ form, spelled }) => {
      const planned = plan(source, form, inner, inner + 4)
      if (planned === undefined) throw new Error(`${form} was refused`)
      expect(planned.result.source).toBe(`${source.replace('beta', spelled('beta'))}\n`)
      expect(planned.result.diagnostics).toEqual([])
      expect(planned.result.annotations).toHaveLength(createDocumentCore().open(source).annotations.length)
      expect(kinds(planned.result.annotations).some(kind => kind.includes('>'))).toBe(true)
      expect(planned.selected).toBe(form === 'substitution' ? 'new' : 'beta')
    })

    it.each(forms)('authors $form over all of it, keeping it whole', ({ form }) => {
      const start = source.indexOf('Lead')
      const end = source.indexOf('tail') + 4
      const planned = plan(source, form, start, end)
      if (planned === undefined) throw new Error(`${form} was refused`)
      expect(planned.result.diagnostics).toEqual([])
      expect(planned.result.source).toContain(source.slice(5, source.indexOf(' tail')))
    })

    it.each(forms.filter(({ form }) => form !== 'comment'))(
      'refuses $form that crosses its delimiters',
      ({ form }) => {
        expect(plan(source, form, source.indexOf('Lead') + 2, inner + 4)).toBeUndefined()
        expect(plan(source, form, inner, source.indexOf('tail') + 2)).toBeUndefined()
      })
  })

  it('widens only a Comment over highlighted text it partly overlaps', () => {
    const source = 'Lead {==alpha beta gamma==} tail.'
    expect(plan(source, 'comment', 2, source.indexOf('beta') + 4)?.result.source)
      .toBe('Le{==ad {==alpha beta gamma==}==}{>>new<<} tail.\n')
    expect(plan(source, 'highlight', 2, source.indexOf('beta') + 4)).toBeUndefined()
  })

  it('nests the same form inside itself, as N1 allows', () => {
    const source = 'Lead {++alpha beta gamma++} tail.'
    const planned = plan(source, 'addition', source.indexOf('beta'), source.indexOf('beta') + 4)
    expect(kinds(planned?.result.annotations ?? [])).toEqual(['addition', 'addition>addition'])
  })
})
