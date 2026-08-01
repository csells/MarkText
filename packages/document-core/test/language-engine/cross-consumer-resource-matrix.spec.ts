import { describe, expect, it } from 'vitest'
import {
  consumeTrustedHtml,
  createLanguageEngine,
  createSourceSnapshot,
  materializeClipboardConsumer,
  materializeCleanHtml,
  materializeCount,
  materializeReviewHtml,
  materializeSearchText,
  materializeStaticConsumer,
  viewLength,
  type ParseConfiguration,
  type SyntaxDiagnostic
} from '@marktext/document-core'

const DESKTOP_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

const STATIC_STRUCTURE = Object.freeze({
  headingAnchors: 'github-slug-v1' as const,
  tableOfContents: Object.freeze({
    title: '',
    includeTopHeading: true
  })
})

function nestedAdditions(depth: number): string {
  return `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
}

type CriticMarkupForm =
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'

const FORM_DELIMITERS: Readonly<Record<
  CriticMarkupForm,
  readonly [open: string, close: string]
>> = Object.freeze({
  addition: ['{++', '++}'],
  deletion: ['{--', '--}'],
  substitution: ['{~~', '~>y~~}'],
  highlight: ['{==', '==}'],
  comment: ['{>>', '<<}']
})

function nestedForm(form: CriticMarkupForm, depth: number): string {
  const [open, close] = FORM_DELIMITERS[form]
  return `${open.repeat(depth)}x${close.repeat(depth)}`
}

function mixedForms(depth: number): string {
  const forms: readonly CriticMarkupForm[] = [
    'addition',
    'deletion',
    'substitution',
    'highlight',
    'comment'
  ]
  const selected = Array.from(
    { length: depth },
    (_, ordinal) => forms[ordinal % forms.length] ?? 'addition'
  )
  return selected.map((form) => FORM_DELIMITERS[form][0]).join('') +
    'x' +
    [...selected].reverse().map((form) => FORM_DELIMITERS[form][1]).join('')
}

describe('cross-consumer deterministic resource boundary', () => {
  it(
    'serves every same-kind and mixed form family at the accepted depth',
    () => {
      const cases = [
        ...Object.keys(FORM_DELIMITERS).map((form) => ({
          id: form,
          source: nestedForm(form as CriticMarkupForm, 16_384)
        })),
        { id: 'mixed', source: mixedForms(16_384) }
      ]
      for (const { id, source } of cases) {
        const revision = createLanguageEngine().open(
          createSourceSnapshot(source),
          DESKTOP_CONFIGURATION
        )

        expect(revision.kind).toBe('complete')
        if (revision.kind !== 'complete') {
          continue
        }
        for (const view of ['markup', 'original', 'revised'] as const) {
          expect(() => materializeSearchText(revision, view)).not.toThrow()
          expect(() => materializeCount(revision, view)).not.toThrow()
          expect(
            () => materializeClipboardConsumer(revision, {
              view,
              consumer: 'normal-copy',
              selection: { start: 0, end: viewLength(revision, view) }
            }),
            `${id}/${view}/normal-copy`
          ).not.toThrow()
          for (
            const consumer of
            ['static-html', 'styled-html', 'pdf', 'print'] as const
          ) {
            expect(
              () => materializeStaticConsumer(revision, {
                view,
                consumer,
                structure: STATIC_STRUCTURE
              }),
              `${id}/${view}/${consumer}`
            ).not.toThrow()
          }
        }
        if (id === 'substitution') {
          const html = consumeTrustedHtml(
            materializeReviewHtml(revision, {
              view: 'markup',
              sink: 'static',
              structure: STATIC_STRUCTURE
            }),
            'static'
          )
          expect(html.length).toBeLessThan(source.length * 3)
        }
      }
    },
    240_000
  )

  it(
    'copies a partial projected selection at the accepted depth without overflowing',
    () => {
      const source = `${'{=='.repeat(16_384)}xy${'==}'.repeat(16_384)}`
      const revision = createLanguageEngine().open(
        createSourceSnapshot(source),
        DESKTOP_CONFIGURATION
      )

      expect(revision.kind).toBe('complete')
      expect(() => materializeClipboardConsumer(revision, {
        view: 'original',
        consumer: 'normal-copy',
        selection: { start: 0, end: 1 }
      })).not.toThrow()
    },
    120_000
  )

  it(
    'renders an inner Comment at the accepted mixed-depth boundary without overflowing',
    () => {
      const outerDepth = 16_383
      const source = `${'{++'.repeat(outerDepth)}xy{>>note<<}${'++}'.repeat(outerDepth)}`
      const revision = createLanguageEngine().open(
        createSourceSnapshot(source),
        DESKTOP_CONFIGURATION
      )

      expect(revision.kind).toBe('complete')
      expect(() => materializeReviewHtml(revision, {
        view: 'markup',
        sink: 'static',
        structure: STATIC_STRUCTURE
      })).not.toThrow()
    },
    120_000
  )

  it(
    'serves 16384 and degrades the annotation at 16385 to literal text',
    () => {
      const engine = createLanguageEngine()
      const acceptedSource = nestedAdditions(16_384)
      const accepted = engine.open(
        createSourceSnapshot(acceptedSource),
        DESKTOP_CONFIGURATION
      )

      expect(accepted.kind).toBe('complete')
      if (accepted.kind !== 'complete') {
        throw new Error('Expected the at-limit revision to be complete')
      }
      expect(materializeSearchText(accepted, 'markup').text)
        .toBe(acceptedSource)
      expect(materializeSearchText(accepted, 'original').text).toBe('')
      expect(materializeSearchText(accepted, 'revised').text).toBe('x')
      expect(materializeCount(accepted, 'markup').codeUnits)
        .toBe(acceptedSource.length)
      const originalCount = materializeCount(accepted, 'original')
      const revisedCount = materializeCount(accepted, 'revised')
      expect({
        codeUnits: originalCount.codeUnits,
        lineBreaks: originalCount.lineBreaks,
        words: originalCount.words
      }).toEqual({
        codeUnits: revisedCount.codeUnits,
        lineBreaks: revisedCount.lineBreaks,
        words: revisedCount.words
      })
      expect(consumeTrustedHtml(
        materializeCleanHtml(accepted, {
          view: 'original',
          sink: 'static',
          structure: STATIC_STRUCTURE
        }),
        'static'
      )).not.toContain('x')
      expect(consumeTrustedHtml(
        materializeCleanHtml(accepted, {
          view: 'revised',
          sink: 'print',
          structure: STATIC_STRUCTURE
        }),
        'print'
      )).toContain('x')

      // G18: one level past the accepted-depth limit is not a failure —
      // the over-depth annotation degrades to exact literal text and every
      // consumer keeps serving the still-semantic document.
      const degradedSource = nestedAdditions(16_385)
      const degraded = engine.open(
        createSourceSnapshot(degradedSource),
        DESKTOP_CONFIGURATION
      )

      expect(degraded.kind).toBe('complete')
      if (degraded.kind !== 'complete') {
        throw new Error('Expected the above-limit revision to be complete')
      }
      expect(degraded.source.text).toBe(degradedSource)
      const degradations: SyntaxDiagnostic[] = []
      for (let index = 0; index < degraded.diagnostics.count; index += 1) {
        const diagnostic = degraded.diagnostics.at(index)
        if (diagnostic.code === 'CM_DEPTH_DEGRADED') {
          degradations.push(diagnostic)
        }
      }
      expect(degradations).toEqual([{
        code: 'CM_DEPTH_DEGRADED',
        range: { start: 49_152, end: 49_155 },
        metadata: { limit: '16384', observed: '16385' }
      }])
      expect(materializeSearchText(degraded, 'markup').text)
        .toBe(degradedSource)
      expect(materializeCount(degraded, 'markup').codeUnits)
        .toBe(degradedSource.length)
      expect(materializeSearchText(degraded, 'original').text).toBe('')
      // The degraded annotation reads as its exact literal text.
      expect(materializeSearchText(degraded, 'revised').text)
        .toBe('{++x++}')
      expect(consumeTrustedHtml(
        materializeCleanHtml(degraded, {
          view: 'revised',
          sink: 'print',
          structure: STATIC_STRUCTURE
        }),
        'print'
      )).toContain('x')
    },
    120_000
  )
})
