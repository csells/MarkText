import { describe, expect, it } from 'vitest'
import { createDocumentSession } from '../../src/documentSession.js'
import { createLanguageEngine } from '../../src/languageEngine.js'
import {
  renderMarkdownReviewHtml
} from '../../src/materialize/htmlRender.js'
import {
  consumeTrustedHtml,
  materializeCleanHtml
} from '../../src/materialize/trustedHtml.js'
import {
  acknowledgeClipboardWrite,
  authorizeCut,
  classifyPasteConsumer,
  materializeClipboardConsumer,
  materializePersistenceConsumer,
  materializeStaticConsumer,
  planReplaceConsumer,
  routeLiveConsumer,
  viewLength
} from '../../src/materialize/consumerPolicy.js'
import type {
  ClipboardConsumerRequest
} from '../../src/materialize/consumerPolicy.js'
import {
  materializeCount,
  materializeSearchText
} from '../../src/materialize/textMaterializers.js'
import type {
  CompleteDocumentRevision,
  NodeId,
  ParseConfiguration
} from '../../src/revision.js'
import { createSourceSnapshot } from '../../src/sourceSnapshot.js'

const CONFIGURATION: ParseConfiguration = {
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

const SOURCE = [
  '# Review',
  '',
  'A {++new++} {--old--} {~~before~>after~~} ' +
    '{==mark==}{>>note *rich* {++yes++} <script>bad()</script><<} Z'
].join('\n')

function complete(source = SOURCE): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete consumer-policy fixture')
  }
  return revision
}

describe('frozen consumer policy', () => {
  it('materializes parser-authenticated heading links with document-order deduplication', () => {
    const revision = complete([
      '# Intro',
      '# Intro',
      '# Hello *World*',
      '# 你好 世界',
      '# {++New++}{--Old--}',
      ''
    ].join('\n'))
    const headings = (view: 'editing' | 'original' | 'revised') => {
      const root = revision.projection(view).markdown.root
      return Array.from(
        { length: root.childCount },
        (_, ordinal) => root.childAt(ordinal)
      ).filter(node => node.kind === 'heading')
    }
    const editing = headings('editing')

    expect(editing).toHaveLength(5)
    expect(materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: editing[0]!.nodeId
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '#intro'
    })
    expect(materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: editing[1]!.nodeId
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '#intro-1'
    })
    expect(materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: editing[2]!.nodeId
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '#hello-world'
    })
    expect(materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: editing[3]!.nodeId
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '#你好-世界'
    })

    const criticHeadingId = editing[4]!.nodeId
    expect(materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: criticHeadingId
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '#newold'
    })
    expect(materializeClipboardConsumer(revision, {
      view: 'original',
      consumer: 'copy-heading-link',
      targetNodeId: headings('original')[4]!.nodeId
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '#old'
    })
    expect(materializeClipboardConsumer(revision, {
      view: 'revised',
      consumer: 'copy-heading-link',
      targetNodeId: headings('revised')[4]!.nodeId
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '#new'
    })
  })

  it('rejects forged, stale, non-heading, and Source heading-link targets', () => {
    const revision = complete('# Heading\n\nBody\n')
    const root = revision.projection('editing').markdown.root
    const heading = root.childAt(0)
    const paragraph = root.childAt(1)

    for (const targetNodeId of [
      'forged:heading' as NodeId,
      paragraph.nodeId
    ]) {
      expect(() => materializeClipboardConsumer(revision, {
        view: 'markup',
        consumer: 'copy-heading-link',
        targetNodeId
      })).toThrow(/heading|target/i)
    }
    const hostileSourceTarget = {
      view: 'source',
      consumer: 'copy-heading-link',
      targetNodeId: heading.nodeId
    } as unknown as ClipboardConsumerRequest
    expect(() => materializeClipboardConsumer(
      revision,
      hostileSourceTarget
    )).toThrow(/source/i)
  })

  it('keeps semantic Review roles around atomic Markdown leaves', () => {
    const document = complete('`code`').projection('revised').markdown

    expect(renderMarkdownReviewHtml(document, {
      runs: [{ start: 0, end: 6, elements: ['ins'] }],
      annotations: []
    })).toBe('<p><ins><code>code</code></ins></p>\n')
  })

  it('implements every frozen view consumer cell', async() => {
    const revision = complete()
    const selections = {
      markup: { start: 0, end: viewLength(revision, 'markup') },
      original: { start: 0, end: viewLength(revision, 'original') },
      revised: { start: 0, end: viewLength(revision, 'revised') }
    } as const
    const projectedText = {
      markup: 'Review\nA new old beforeafter mark Z',
      original: 'Review\nA  old before mark Z',
      revised: 'Review\nA new  after mark Z'
    } as const

    const normalCopy = materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'normal-copy',
      selection: selections.markup
    })
    expect(normalCopy.kind).toBe('clipboard-bundle')
    if (normalCopy.kind !== 'clipboard-bundle') return

    expect(normalCopy.plainText).toBe(SOURCE)
    expect(normalCopy.privateSource).toEqual({
      text: SOURCE
    })
    expect(normalCopy.html).toBeDefined()
    if (normalCopy.html === undefined) return
    const html = consumeTrustedHtml(normalCopy.html, 'clipboard')
    expect(html).toContain('<ins>new</ins>')
    expect(html).toContain('<del>old</del>')
    expect(html).toContain('<mark>mark</mark>')
    expect(html).toContain('role="doc-noteref"')
    expect(html).toContain('<aside role="note"')
    expect(html).toContain('<em>rich</em>')
    expect(html).not.toContain('<script>')

    for (const view of ['original', 'revised'] as const) {
      const cleanCopy = materializeClipboardConsumer(revision, {
        view,
        consumer: 'normal-copy',
        selection: selections[view]
      })
      expect(cleanCopy).toMatchObject({
        kind: 'clipboard-bundle',
        plainText: projectedText[view]
      })
      if (cleanCopy.kind !== 'clipboard-bundle') continue
      expect(cleanCopy.privateSource).toBeUndefined()
      expect(cleanCopy.html).toBeDefined()
      if (cleanCopy.html === undefined) continue
      const clean = consumeTrustedHtml(cleanCopy.html, 'clipboard')
      expect(clean).not.toContain('role="doc-noteref"')
      expect(clean).not.toContain('note *rich*')
      expect(clean).not.toContain('{++')
      if (view === 'original') {
        expect(clean).toContain('old before mark')
        expect(clean).not.toContain('new')
        expect(clean).not.toContain('after')
      } else {
        expect(clean).toContain('new  after mark')
        expect(clean).not.toContain('old')
        expect(clean).not.toContain('before')
      }
    }

    for (const view of ['markup', 'original', 'revised'] as const) {
      const rich = materializeClipboardConsumer(revision, {
        view,
        consumer: 'copy-rich',
        selection: selections[view]
      })
      expect(rich).toMatchObject({
        kind: 'clipboard-bundle',
        plainText: projectedText[view]
      })
      if (rich.kind !== 'clipboard-bundle' || rich.html === undefined) {
        throw new Error(`Expected ${view} rich HTML`)
      }
      expect(rich.privateSource).toBeUndefined()

      const serialized = materializeClipboardConsumer(revision, {
        view,
        consumer: 'copy-html',
        selection: selections[view]
      })
      expect(serialized).toEqual({
        kind: 'clipboard-text',
        plainText: consumeTrustedHtml(rich.html, 'clipboard')
      })

      expect(materializeClipboardConsumer(revision, {
        view,
        consumer: 'copy-markdown',
        selection: selections[view]
      })).toEqual({
        kind: 'clipboard-text',
        plainText: SOURCE
      })
    }

    const cut = materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'cut',
      selection: selections.markup
    })
    expect(cut.kind).toBe('cut-preparation')
    if (cut.kind !== 'cut-preparation') {
      throw new Error('Expected a Markup cut preparation')
    }
    const receipt = acknowledgeClipboardWrite(cut.bundle)
    expect(authorizeCut(cut, receipt)).toMatchObject({
      kind: 'semantic-cut-authorization',
      view: 'markup',
      selection: selections.markup,
      semanticHash: revision.semanticHash
    })
    expect(() => authorizeCut(cut, receipt)).toThrow(/already authorized/i)

    const sourceSelection = { start: 2, end: 9 } as const
    const sourceCut = materializeClipboardConsumer(revision, {
      view: 'source',
      consumer: 'cut',
      selection: sourceSelection
    })
    expect(sourceCut).toMatchObject({
      kind: 'cut-preparation',
      view: 'source',
      selection: sourceSelection,
      bundle: {
        kind: 'clipboard-bundle',
        plainText: SOURCE.slice(
          sourceSelection.start,
          sourceSelection.end
        ),
        privateSource: {
          text: SOURCE.slice(
            sourceSelection.start,
            sourceSelection.end
          )
        }
      }
    })
    if (sourceCut.kind !== 'cut-preparation') {
      throw new Error('Expected a Source cut preparation')
    }
    expect(authorizeCut(
      sourceCut,
      acknowledgeClipboardWrite(sourceCut.bundle)
    )).toMatchObject({
      kind: 'semantic-cut-authorization',
      view: 'source',
      selection: sourceSelection,
      semanticHash: revision.semanticHash
    })
    for (const view of ['markup', 'source'] as const) {
      expect(() => materializeClipboardConsumer(revision, {
        view,
        consumer: 'cut',
        selection: { start: 1, end: 1 }
      })).toThrow(/collapsed/i)
    }

    for (const view of ['original', 'revised'] as const) {
      expect(materializeClipboardConsumer(revision, {
        view,
        consumer: 'cut',
        selection: selections[view]
      })).toEqual({
        kind: 'disabled',
        view,
        consumer: 'cut',
        reason: 'read-only-view'
      })
    }

    expect(classifyPasteConsumer(revision, {
      view: 'markup',
      payload: { kind: 'private-source', text: '{++raw++}' }
    })).toEqual({
      kind: 'raw-syntax-import',
      source: 'private-source',
      text: '{++raw++}'
    })
    expect(classifyPasteConsumer(revision, {
      view: 'markup',
      payload: { kind: 'markdown', text: '**raw**' }
    })).toEqual({
      kind: 'raw-syntax-import',
      source: 'markdown',
      text: '**raw**'
    })
    expect(classifyPasteConsumer(revision, {
      view: 'markup',
      payload: { kind: 'external-text', text: '<b>meaning</b>' }
    })).toEqual({
      kind: 'semantic-text-edit',
      text: '<b>meaning</b>'
    })
    expect(classifyPasteConsumer(revision, {
      view: 'markup',
      payload: { kind: 'safe-html', html: normalCopy.html }
    })).toMatchObject({
      kind: 'semantic-html-edit',
      html: normalCopy.html
    })
    for (const view of ['original', 'revised'] as const) {
      expect(classifyPasteConsumer(revision, {
        view,
        payload: { kind: 'external-text', text: 'no' }
      })).toEqual({
        kind: 'disabled',
        view,
        consumer: 'paste',
        reason: 'read-only-view'
      })
    }

    const editing = revision.projection('editing').source
    const markupNew = editing.indexOf('new')
    const selectedMarkup = materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'normal-copy',
      selection: { start: markupNew, end: markupNew + 3 }
    })
    expect(selectedMarkup).toMatchObject({
      kind: 'clipboard-bundle',
      plainText: '{++new++}',
      privateSource: {
        text: '{++new++}'
      }
    })
    if (
      selectedMarkup.kind !== 'clipboard-bundle' ||
      selectedMarkup.html === undefined
    ) {
      throw new Error('Expected selected Markup Review HTML')
    }
    const selectedMarkupHtml = consumeTrustedHtml(
      selectedMarkup.html,
      'clipboard'
    )
    expect(selectedMarkupHtml).toContain('<ins>new</ins>')
    expect(selectedMarkupHtml).not.toContain('<h1>Review</h1>')
    expect(selectedMarkupHtml).not.toContain('old')

    const original = revision.projection('original').source
    const originalOld = original.indexOf('old')
    expect(materializeClipboardConsumer(revision, {
      view: 'original',
      consumer: 'copy-markdown',
      selection: { start: originalOld, end: originalOld + 3 }
    })).toEqual({
      kind: 'clipboard-text',
      plainText: '{--old--}'
    })
    const rawSubstitution = '{~~before~>after~~}'
    const rawStart = SOURCE.indexOf(rawSubstitution)
    expect(materializeClipboardConsumer(revision, {
      view: 'source',
      consumer: 'copy-markdown',
      selection: {
        start: rawStart,
        end: rawStart + rawSubstitution.length
      }
    })).toEqual({
      kind: 'clipboard-text',
      plainText: rawSubstitution
    })
    const selectedOriginal = materializeClipboardConsumer(revision, {
      view: 'original',
      consumer: 'normal-copy',
      selection: { start: originalOld, end: originalOld + 3 }
    })
    expect(selectedOriginal).toMatchObject({
      kind: 'clipboard-bundle',
      plainText: 'old'
    })
    if (
      selectedOriginal.kind !== 'clipboard-bundle' ||
      selectedOriginal.html === undefined
    ) {
      throw new Error('Expected selected Original clean HTML')
    }
    expect(consumeTrustedHtml(selectedOriginal.html, 'clipboard'))
      .toBe('<p>old</p>\n')

    for (const view of ['markup', 'original', 'revised'] as const) {
      expect(materializeSearchText(revision, view).text).toBe(
        view === 'markup' ? SOURCE : projectedText[view]
      )
      expect(materializeCount(revision, view)).toMatchObject({
        kind: 'count',
        view,
        codeUnits: SOURCE.length
      })
    }

    const visibleStart = SOURCE.indexOf('new')
    expect(planReplaceConsumer(revision, {
      view: 'markup',
      replacement: 'fresh',
      hits: [{
        start: visibleStart,
        end: visibleStart + 3,
        expected: 'new'
      }]
    })).toEqual({
      kind: 'replace-plan',
      view: 'markup',
      semanticHash: revision.semanticHash,
      edits: [{
        start: visibleStart,
        end: visibleStart + 3,
        text: 'fresh'
      }]
    })
    const markerStart = SOURCE.indexOf('{++')
    expect(planReplaceConsumer(revision, {
      view: 'markup',
      replacement: 'x',
      hits: [
        {
          start: visibleStart,
          end: visibleStart + 3,
          expected: 'new'
        },
        {
          start: markerStart,
          end: markerStart + 3,
          expected: '{++'
        }
      ]
    })).toEqual({
      kind: 'replace-rejected',
      view: 'markup',
      reason: 'non-editable-hit',
      edits: []
    })
    expect(planReplaceConsumer(revision, {
      view: 'markup',
      replacement: 'x',
      hits: [{
        start: 0,
        end: 1,
        expected: '#'
      }]
    })).toEqual({
      kind: 'replace-rejected',
      view: 'markup',
      reason: 'non-editable-hit',
      edits: []
    })
    const boundaryProtected = materializeStaticConsumer(
      complete('[{~~q~>[x]~~}[x]'),
      {
        view: 'markup',
        consumer: 'static-html',
        structure: STATIC_STRUCTURE
      }
    )
    expect(consumeTrustedHtml(boundaryProtected.html, 'static')).toContain(
      '<del>q</del><ins>[x]</ins>'
    )
    for (const view of ['original', 'revised'] as const) {
      expect(planReplaceConsumer(revision, {
        view,
        replacement: 'x',
        hits: []
      })).toEqual({
        kind: 'disabled',
        view,
        consumer: 'replace',
        reason: 'read-only-view'
      })
    }

    const staticConsumers = [
      ['static-html', 'static-html', 'static'],
      ['styled-html', 'styled-html', 'styled'],
      ['pdf', 'pdf-render-input', 'pdf'],
      ['print', 'print-render-input', 'print']
    ] as const
    for (const view of ['markup', 'original', 'revised'] as const) {
      for (const [consumer, kind, sink] of staticConsumers) {
        const result = materializeStaticConsumer(revision, {
          view,
          consumer,
          structure: STATIC_STRUCTURE
        })
        expect(result).toMatchObject({ kind, view })
        const output = consumeTrustedHtml(result.html, sink)
        if (view === 'markup') {
          expect(output).toContain('<ins>new</ins>')
          expect(output).toContain('<aside role="note"')
        } else {
          expect(output).not.toContain('role="doc-noteref"')
          expect(output).not.toContain('note *rich*')
        }
        if (consumer === 'static-html') {
          expect(output).not.toContain('<!doctype html>')
        } else {
          expect(output).toContain('<!doctype html>')
          expect(output).toContain('<style data-marktext-export>')
        }
      }
    }

    const session = await createDocumentSession({
      source: createSourceSnapshot(SOURCE),
      parseConfiguration: CONFIGURATION
    })
    const prepared = await session.preparePersistence('save').completion
    if (prepared.kind !== 'flushed') {
      throw new Error('Expected a pinned persistence lease')
    }
    for (const view of ['markup', 'original', 'revised'] as const) {
      expect(await materializePersistenceConsumer(prepared.source, view))
        .toMatchObject({
          kind: 'canonical-persistence-source',
          view,
          revision: prepared.revision.id,
          sourceHash: prepared.source.sourceHash,
          text: SOURCE
        })
    }
    expect(await prepared.source.release('consumer-finished').completion)
      .toMatchObject({ kind: 'released' })

    const sourceOnly = createLanguageEngine().open(
      createSourceSnapshot(`${'> '.repeat(129)}blocked\n`),
      {
        ...CONFIGURATION,
        executionBudget: {
          limitsProfile: 'desktop-v1',
          accountingSchema: 'syntax-accounting-1'
        }
      }
    )
    expect(sourceOnly.kind).toBe('source-only')
    expect(() => materializeClipboardConsumer(sourceOnly, {
      view: 'markup',
      consumer: 'normal-copy',
      selection: { start: 0, end: 0 }
    })).toThrow(/SourceOnly/i)
    expect(() => materializeStaticConsumer(sourceOnly, {
      view: 'original',
      consumer: 'static-html',
      structure: STATIC_STRUCTURE
    })).toThrow(/SourceOnly/i)
    expect(() => planReplaceConsumer(sourceOnly, {
      view: 'markup',
      replacement: 'x',
      hits: []
    })).toThrow(/SourceOnly/i)
    expect(() => materializeSearchText(sourceOnly, 'original'))
      .toThrow(/SourceOnly/i)
  })

  it('materializes a table rectangle from parser-owned cell ranges', () => {
    const revision = complete([
      '| a | b | c |',
      '| --- | --- | --- |',
      '| one | two | three |',
      '| four | five | six |',
      ''
    ].join('\n'))
    const editing = revision.projection('editing').source
    const selection = {
      start: editing.indexOf('two'),
      end: editing.indexOf('six') + 'six'.length
    }

    expect(materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'copy-table',
      selection
    })).toEqual({
      kind: 'clipboard-text',
      plainText: 'two\tthree\nfive\tsix'
    })
    expect(materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'cut-table',
      selection
    })).toMatchObject({
      kind: 'cut-preparation',
      view: 'markup',
      selection,
      bundle: {
        kind: 'clipboard-bundle',
        plainText: 'two\tthree\nfive\tsix'
      }
    })
  })

  it('rejects an impossible clipboard discriminator instead of copying rich text', () => {
    const revision = complete()
    expect(() => materializeClipboardConsumer(revision, {
      view: 'markup',
      consumer: 'copy-rich-and-run',
      selection: { start: 0, end: 1 }
    } as never)).toThrow(/clipboard consumer|impossible|unknown/i)
  })

  it(
    'routes live static and persistence consumers through their sole seams',
    async() => {
      const session = await createDocumentSession({
        source: createSourceSnapshot(SOURCE),
        parseConfiguration: CONFIGURATION
      })
      const snapshot = session.snapshot()
      if (snapshot.kind !== 'complete') {
        throw new Error('Expected a complete live consumer snapshot')
      }

      const live = routeLiveConsumer(snapshot.livePlan)
      expect(live).toEqual({
        kind: 'live-render-plan',
        plan: snapshot.livePlan
      })
      expect(live.plan).toBe(snapshot.livePlan)
      expect(live).not.toHaveProperty('html')

      const pdf = materializeStaticConsumer(complete(), {
        view: 'markup',
        consumer: 'pdf',
        structure: STATIC_STRUCTURE
      })
      expect(pdf).toMatchObject({
        kind: 'pdf-render-input',
        view: 'markup',
        html: {
          kind: 'trusted-html',
          sink: 'pdf',
          view: 'markup'
        }
      })
      expect(() => consumeTrustedHtml(pdf.html, 'print')).toThrow(/sink/i)
      expect(() => Reflect.apply(materializeCleanHtml, undefined, [
        complete(),
        { view: 'revised', sink: 'live-dom' }
      ])).toThrow(/LiveRenderPlan/i)
      expect(() => Reflect.apply(materializeStaticConsumer, undefined, [
        complete(),
        { view: 'markup', consumer: 'archive' }
      ])).toThrow(/static consumer/i)
      expect(() => materializeStaticConsumer(complete(), {
        view: 'markup',
        consumer: 'pdf'
      } as never)).toThrow(/structure/i)
      expect(() => materializeStaticConsumer(
        snapshot.livePlan as unknown as CompleteDocumentRevision,
        {
          view: 'markup',
          consumer: 'static-html',
          structure: STATIC_STRUCTURE
        }
      )).toThrow(/DocumentRevision/i)

      const prepared = await session.preparePersistence('save').completion
      if (prepared.kind !== 'flushed') {
        throw new Error('Expected live session persistence to flush')
      }
      expect(await materializePersistenceConsumer(prepared.source, 'markup'))
        .toMatchObject({
          kind: 'canonical-persistence-source',
          text: SOURCE,
          revision: snapshot.revision.id
        })
      const forgedLease = Object.freeze({ ...prepared.source })
      await expect(materializePersistenceConsumer(
        forgedLease,
        'markup'
      )).rejects.toThrow(/authentic|pinned canonical source lease/i)
      await expect(materializePersistenceConsumer(
        prepared.source,
        'archive' as never
      )).rejects.toThrow(/persistence view/i)
      await expect(materializePersistenceConsumer(
        snapshot.revision as never,
        'markup'
      )).rejects.toThrow(/pinned canonical source lease/i)
      await prepared.source.release('consumer-finished').completion

      const source = `${'> '.repeat(129)}source only\r\n`
      const sourceSession = await createDocumentSession({
        source: createSourceSnapshot(source),
        parseConfiguration: {
          ...CONFIGURATION,
          executionBudget: {
            limitsProfile: 'desktop-v1',
            accountingSchema: 'syntax-accounting-1'
          }
        }
      })
      const sourceSnapshot = sourceSession.snapshot()
      expect(sourceSnapshot.kind).toBe('source-only')
      expect('livePlan' in sourceSnapshot).toBe(false)
      expect(() => routeLiveConsumer(sourceSnapshot as never))
        .toThrow(/LiveRenderPlan/i)

      const sourcePrepared =
        await sourceSession.preparePersistence('save').completion
      if (sourcePrepared.kind !== 'flushed') {
        throw new Error('Expected SourceOnly persistence to flush')
      }
      expect(await materializePersistenceConsumer(
        sourcePrepared.source,
        'source'
      )).toMatchObject({
        kind: 'canonical-persistence-source',
        view: 'source',
        text: source
      })
      await sourcePrepared.source.release('consumer-finished').completion
    }
  )
})
