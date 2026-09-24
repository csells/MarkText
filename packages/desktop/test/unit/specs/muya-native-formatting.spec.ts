// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { expect, it, vi } from 'vitest'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaInputToModel,
  muyaFormatToModel,
  muyaClipboardToModel,
  muyaActiveFormats,
  muyaCodeLanguage
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'

const { tokenize } = vi.hoisted(() => ({ tokenize: vi.fn() }))
vi.mock('../../../../muya/src/inlineRenderer/lexer', async(importOriginal) => {
  const original = await importOriginal<{ tokenizer: (...args: unknown[]) => unknown }>()
  tokenize.mockImplementation(original.tokenizer)
  return { ...original, tokenizer: tokenize }
})

const unexpectedComposition = () => {
  throw new Error('Unexpected composition in the formatting fixture')
}

it.each(
  [
    { type: 'strong', marker: '**' },
    { type: 'em', marker: '*' },
    { type: 'del', marker: '~~' },
    { type: 'inline_code', marker: '`' }
  ].flatMap((format) =>
    [false, true].flatMap((annotated) =>
      [false, true].flatMap((whole) =>
        ['menu', 'toolbar'].flatMap((route) =>
          (annotated && !whole ? [false, true] : [false]).flatMap((innerDOM) =>
            [false, true].map((tracked) => ({
              ...format,
              annotated,
              whole,
              route,
              innerDOM,
              tracked
            }))
          )
        )
      )
    )
  )
)(
  'formats the selected repeated text through Muya.format($type), annotated: $annotated, whole: $whole, route: $route, inner DOM: $innerDOM, tracked: $tracked',
  async({ type, marker, annotated, whole, route, innerDOM, tracked }) => {
    ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    const source = annotated ? 'a{++a++}a\n' : 'aaa\n'
    const formatted = whole
      ? type === 'inline_code' && annotated
        ? '`a`{++`a`++}`a`\n'
        : `${marker}${source.slice(0, -1)}${marker}\n`
      : annotated
        ? `a{++${marker}a${marker}++}a\n`
        : `a${marker}a${marker}a\n`
    const expected =
      !tracked || (annotated && !whole)
        ? formatted
        : whole
          ? `{~~${source.slice(0, -1)}~>${formatted.slice(0, -1)}~~}\n`
          : `a{~~a~>${marker}a${marker}~~}a\n`
    const typed = whole
      ? `${marker}X${marker}\n`
      : annotated
        ? `a{++${marker}X${marker}++}a\n`
        : `a${marker}X${marker}a\n`
    const expectedTyped =
      !tracked || (annotated && !whole)
        ? typed
        : whole
          ? `{~~${source.slice(0, -1)}~>${typed.slice(0, -1)}~~}\n`
          : `a{~~a~>${marker}X${marker}~~}a\n`
    binding.open({ documentId: 'native-formatting.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) {
        throw new Error('Missing model view')
      }
      return reply.view
    }
    const initial = view()
    const host = document.body.appendChild(document.createElement('div'))
    const muya = new Muya(host)
    let presentation = createMuyaMarkupPresentationIndex(initial)
    const reconcile = (outcome: CoreAppliedReply) => {
      const current = view()
      presentation = createMuyaMarkupPresentationIndex(current, presentation)
      muya.setInlinePresentation(presentation.render)
      reconcileMuyaDocumentView({
        muya,
        view: current,
        outcome,
        dirtyPaths: presentation.changedPaths,
        applyEditability: () => {}
      })
      return current.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding)
    const results: string[] = []
    muya.eventCenter.on('json-change', (change: unknown) => {
      if (
        change !== null &&
        typeof change === 'object' &&
        (change as { source?: unknown }).source === 'user'
      ) {
        results.push('native-bypass')
      }
    })
    try {
      muya.setInlinePresentation(presentation.render)
      muya.init()
      muya.setContent(structuredClone([...initial.state]))
      muya.editor.bindDocumentEditing({
        prepareImage() {
          throw new Error('Unexpected image upload preparation in the formatting fixture')
        },
        prepareClipboard() {
          throw new Error('Unexpected async clipboard preparation in this test')
        },
        emojiContext: () => undefined,
        codeLanguage: (point) => muyaCodeLanguage(muya, view(), point),
        activeFormats: (selection) => muyaActiveFormats(muya, view(), selection),
        clipboard() {
          throw new Error('Unexpected clipboard action in this input test')
        },
        compositionStart: unexpectedComposition,
        compositionUpdate: unexpectedComposition,
        compositionEnd: unexpectedComposition,
        format(operation) {
          const result = adapter.format(
            muyaFormatToModel(muya, view(), operation, tracked),
            reconcile
          )
          expect(result).toEqual({ accepted: true, changed: true })
          return result.changed
        },
        input(operation, present) {
          const result = adapter.input(
            muyaInputToModel(muya, view(), operation),
            reconcile,
            tracked
          )
          if (!result.accepted) present()
          return result.changed
        }
      })
      const block = muya.editor.scrollPage?.firstContentInDescendant()
      if (block === undefined) throw new Error('Missing native paragraph')
      if (annotated && !whole && innerDOM) {
        const span = block.domNode?.querySelector('[data-critic-kind="addition"]')
        if (span === null || span === undefined) throw new Error('Missing rendered addition')
        const text = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode()
        if (text === null) throw new Error('Missing rendered addition payload')
        muya.editor.selection.setDOMSelection({ node: text, offset: 0 }, { node: text, offset: 1 })
      } else block.setCursor(whole ? 0 : 1, whole ? 3 : 2, true)
      expect(muya.getSelection()).toMatchObject({
        anchor: { offset: whole ? 0 : 1 },
        focus: { offset: whole ? 3 : 2 }
      })
      if (route === 'menu') muya.format(type)
      else {
        if (!('format' in block) || typeof block.format !== 'function') {
          throw new Error('Missing toolbar format receiver')
        }
        block.format(type)
      }
      muya.flush()
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      const selection = muya.editor.selection.getDOMSelection()
      if (selection === undefined) throw new Error('Formatting lost the native selection')
      const currentSelection = muyaFormatToModel(
        muya,
        view(),
        { format: type as 'strong' | 'em' | 'del' | 'inline_code', selection },
        tracked
      ).selection
      const shift = tracked && !(annotated && !whole) ? (whole ? source.length - 1 + 5 : 6) : 0
      const expectedStart = (whole ? marker.length : (annotated ? 4 : 1) + marker.length) + shift
      const expectedEnd =
        (whole ? formatted.length - 1 - marker.length : (annotated ? 4 : 1) + marker.length + 1) +
        shift
      expect(currentSelection).toEqual({
        ranges: [{ anchor: expectedStart, focus: expectedEnd }],
        primary: 0
      })
      const target = muya.getSelection()?.focus.block.domNode
      if (target === undefined) throw new Error('Formatting lost the typing target')
      const input = new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
      target.dispatchEvent(input)
      expect(input.defaultPrevented).toBe(true)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expectedTyped })
      await adapter.settled()
      expect(results).toEqual([])
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      if (annotated) {
        expect(view().decorations.some((decoration) => decoration.mark.kind === 'addition')).toBe(
          true
        )
      }
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      const reopenedBinding = createEditorCoreBinding(createLocalCoreOwner())
      try {
        reopenedBinding.open({ documentId: 'reopened.md', source: expected })
        expect(reopenedBinding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopenedBinding.dispose()
      }
    } finally {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  }
)

const bootFormatting = (source: string, tracked = false) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'format-controls.md', source })
  const view = () => {
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) {
      throw new Error('Missing model view')
    }
    return reply.view
  }
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  let presentation = createMuyaMarkupPresentationIndex(view())
  const reconcile = (outcome: CoreAppliedReply) => {
    const current = view()
    presentation = createMuyaMarkupPresentationIndex(current, presentation)
    muya.setInlinePresentation(presentation.render)
    reconcileMuyaDocumentView({
      muya,
      view: current,
      outcome,
      dirtyPaths: presentation.changedPaths,
      applyEditability: () => {}
    })
    return current.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(view().bindings, binding)
  const formatResults: ReturnType<typeof adapter.format>[] = []
  const legacyChanges: unknown[] = []
  muya.eventCenter.on('json-change', (change: unknown) => {
    if (
      change !== null &&
      typeof change === 'object' &&
      (change as { source?: unknown }).source === 'user'
    ) {
      legacyChanges.push(change)
    }
  })
  muya.setInlinePresentation(presentation.render)
  muya.init()
  muya.setContent(structuredClone([...view().state]))
  muya.editor.bindDocumentEditing({
    prepareImage() {
      throw new Error('Unexpected image upload preparation in the formatting fixture')
    },
    prepareClipboard() {
      throw new Error('Unexpected async clipboard preparation in this test')
    },
    emojiContext: () => undefined,
    codeLanguage: (point) => muyaCodeLanguage(muya, view(), point),
    activeFormats: (selection) => muyaActiveFormats(muya, view(), selection),
    clipboard(operation, present) {
      const result = adapter.clipboard(
        muyaClipboardToModel(muya, view(), operation, tracked),
        reconcile
      )
      if (!result.accepted) present()
      return result.changed
    },
    compositionStart: unexpectedComposition,
    compositionUpdate: unexpectedComposition,
    compositionEnd: unexpectedComposition,
    format: (operation) => {
      const result = adapter.format(muyaFormatToModel(muya, view(), operation, tracked), reconcile)
      formatResults.push(result)
      return result.changed
    },
    input(operation, present) {
      const result = adapter.input(muyaInputToModel(muya, view(), operation), reconcile, tracked)
      if (!result.accepted) present()
      return result.changed
    }
  })
  return {
    muya,
    binding,
    adapter,
    reconcile,
    view,
    formatResults,
    legacyChanges,
    dispose() {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  }
}

it.each([
  {
    source: ' word \n',
    format: 'strong',
    start: 0,
    end: 6,
    expected: ' **word** \n',
    caret: { start: 3, end: 7 },
    typed: ' **X** \n'
  },
  {
    source: '***word***\n',
    format: 'em',
    start: 5,
    end: 5,
    expected: '**word**\n',
    caret: { start: 4, end: 4 },
    typed: '**woXrd**\n'
  },
  {
    source: 'word\n',
    format: 'strong',
    start: 2,
    end: 2,
    expected: 'wo****rd\n',
    caret: { start: 4, end: 4 },
    typed: 'wo**X**rd\n'
  }
] as const)('keeps the native formatting cursor and next input for $source', async(fixture) => {
  const test = bootFormatting(fixture.source)
  try {
    const block = test.muya.editor.scrollPage?.firstContentInDescendant()
    if (block === undefined) throw new Error('Missing native paragraph')
    block.setCursor(fixture.start, fixture.end, true)
    test.muya.format(fixture.format)
    expect(test.binding.sourceAtBarrier()).toMatchObject({ source: fixture.expected })
    const selection = test.muya.editor.selection.getDOMSelection()
    if (selection === undefined) throw new Error('Missing formatted selection')
    expect(
      muyaFormatToModel(test.muya, test.view(), { format: fixture.format, selection }, false)
        .selection
    ).toEqual({ ranges: [{ anchor: fixture.caret.start, focus: fixture.caret.end }], primary: 0 })
    const target = test.muya.getSelection()?.focus.block.domNode
    if (target === undefined) throw new Error('Missing next typing target')
    const input = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'X',
      bubbles: true,
      cancelable: true
    })
    target.dispatchEvent(input)
    expect(input.defaultPrevented).toBe(true)
    expect(test.binding.sourceAtBarrier()).toMatchObject({ source: fixture.typed })
    expect(test.legacyChanges).toEqual([])
    await test.adapter.history('undo', test.reconcile)
    await test.adapter.history('undo', test.reconcile)
    expect(test.binding.sourceAtBarrier()).toMatchObject({ source: fixture.source })
  } finally {
    test.dispose()
  }
})

it('formats a real cross-block selection without formatting the heading prefix', async() => {
  const test = bootFormatting('# one\n\ntwo\n')
  try {
    const first = test.muya.editor.scrollPage?.queryBlock([0, 'text'])
    const last = test.muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!first?.isContent() || !last?.isContent()) throw new Error('Missing native content blocks')
    test.muya.editor.selection.setSelection(
      { block: first, path: first.path, offset: 0 },
      { block: last, path: last.path, offset: 3 }
    )
    test.muya.format('strong')
    expect(test.binding.sourceAtBarrier()).toMatchObject({ source: '# **one**\n\n**two**\n' })
    const selection = test.muya.editor.selection.getDOMSelection()
    if (selection === undefined) throw new Error('Missing cross-block result selection')
    expect(
      muyaFormatToModel(test.muya, test.view(), { format: 'strong', selection }, false).selection
    ).toEqual({ ranges: [{ anchor: 4, focus: 16 }], primary: 0 })
    expect(test.legacyChanges).toEqual([])
    await test.adapter.history('undo', test.reconcile)
    expect(test.binding.sourceAtBarrier()).toMatchObject({ source: '# one\n\ntwo\n' })
  } finally {
    test.dispose()
  }
})

it('keeps literal block formatting as an accepted no-op with no undo entry', async() => {
  const source = '```\nword\n```\n'
  const test = bootFormatting(source)
  try {
    const block = test.muya.editor.scrollPage?.firstContentInDescendant()
    if (block === undefined) throw new Error('Missing native code block')
    block.setCursor(0, 4, true)
    test.muya.format('strong')
    expect(test.formatResults).toEqual([{ accepted: true, changed: false }])
    expect(test.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(await test.adapter.history('undo', test.reconcile)).toBeUndefined()
    expect(test.legacyChanges).toEqual([])
  } finally {
    test.dispose()
  }
})

it.each(
  [
    { format: 'strong', formatted: '**a{++a++}a**' },
    { format: 'em', formatted: '*a{++a++}a*' },
    { format: 'del', formatted: '~~a{++a++}a~~' },
    { format: 'inline_code', formatted: '`a`{++`a`++}`a`' }
  ].flatMap((fixture) => [false, true].map((tracked) => ({ ...fixture, tracked })))
)(
  'toggles native $format across the whole annotation and undoes both decisions (Track: $tracked)',
  async({ format, formatted, tracked }) => {
    const source = 'a{++a++}a\n'
    const test = bootFormatting(source, tracked)
    try {
      const block = test.muya.editor.scrollPage?.firstContentInDescendant()
      if (block === undefined) throw new Error('Missing native paragraph')
      block.setCursor(0, 3, true)
      test.muya.format(format)
      const expected = tracked ? `{~~a{++a++}a~>${formatted}~~}\n` : formatted + '\n'
      expect(test.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      test.muya.format(format)
      expect(test.binding.sourceAtBarrier()).toMatchObject({
        source: tracked ? '{~~a{++a++}a~>a{++a++}a~~}\n' : source
      })
      expect(test.formatResults).toEqual([
        { accepted: true, changed: true },
        { accepted: true, changed: true }
      ])
      expect(test.legacyChanges).toEqual([])
      await test.adapter.history('undo', test.reconcile)
      expect(test.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await test.adapter.history('undo', test.reconcile)
      expect(test.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      test.dispose()
    }
  }
)

it.each([
  { source: '`a`{++`a`++}`a`\n', start: 0, end: 9, expected: [] },
  { source: '`a`{++`a`++}`a`\n', start: 1, end: 2, expected: ['inline_code'] },
  { source: '`a``a``a`\n', start: 0, end: 9, expected: ['inline_code'] },
  { source: '**_x_**\n', start: 3, end: 4, expected: ['strong', 'em'] },
  { source: 'a <u>x</u> b\n', start: 5, end: 6, expected: ['html_tag'] },
  { source: 'a <mark>x</mark> b\n', start: 8, end: 9, expected: ['html_tag'] }
])(
  'uses rendered model syntax for active formats in $source at $start..$end',
  ({ source, start, end, expected }) => {
    ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    binding.open({ documentId: 'active-formats.md', source })
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) {
      throw new Error('Missing model view')
    }
    const view = reply.view
    const host = document.body.appendChild(document.createElement('div'))
    const muya = new Muya(host)
    try {
      muya.setInlinePresentation(createMuyaMarkupPresentationIndex(view).render)
      muya.init()
      muya.setContent(structuredClone([...view.state]))
      muya.editor.bindDocumentEditing({
        prepareImage() {
          throw new Error('Unexpected image upload preparation in the formatting fixture')
        },
        prepareClipboard() {
          throw new Error('Unexpected async clipboard preparation in this test')
        },
        emojiContext: () => undefined,
        codeLanguage: (point) => muyaCodeLanguage(muya, view, point),
        activeFormats: (selection) => muyaActiveFormats(muya, view, selection),
        clipboard: unexpectedComposition,
        compositionStart: unexpectedComposition,
        compositionUpdate: unexpectedComposition,
        compositionEnd: unexpectedComposition,
        format: unexpectedComposition,
        input: unexpectedComposition
      })
      let active: string[] = []
      muya.on('selection-change', (event: { formats: Array<{ type: string }> }) => {
        active = event.formats.map((item) => item.type)
      })
      const block = muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native block')
      block.setCursor(start, end, true)
      expect(active).toEqual(expected)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      muya.destroy()
      host.remove()
      binding.dispose()
    }
  }
)

it.each([
  { source: '**aaa**\n', expected: 'aaa\n' },
  { source: '**a{++a++}a**\n', expected: 'a{++a++}a\n' },
  { source: '**_aaa_**\n', expected: 'aaa\n' },
  { source: '[**aaa**](https://example.com)\n', expected: 'aaa\n' },
  { source: '`aaa`\n', expected: 'aaa\n' },
  { source: '$aaa$\n', expected: 'aaa\n' },
  { source: '<u>aaa</u>\n', expected: 'aaa\n' }
])(
  'clears formatting through the native command without replacing annotation payload in $source',
  async({ source, expected }) => {
    const setup = bootFormatting(source)
    try {
      const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native format block')
      block.setCursor(0, block.text.length, true)
      setup.muya.format('clear')
      setup.muya.flush()
      expect(setup.legacyChanges).toEqual([])
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(setup.muya.getSelection()).toMatchObject({
        anchor: { offset: 0 },
        focus: { offset: 3 }
      })
      const target = setup.muya.getSelection()?.focus.block.domNode
      if (!target) throw new Error('Clear formatting lost native selection')
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: 'X\n' })
      await setup.adapter.settled()
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      await setup.adapter.history('redo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      const saved = setup.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing saved source')
      const reopened = bootFormatting(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopened.dispose()
      }
    } finally {
      setup.dispose()
    }
  }
)

it.each([
  { format: 'u', open: '<u>', close: '</u>' },
  { format: 'mark', open: '<mark>', close: '</mark>' },
  { format: 'sub', open: '<sub>', close: '</sub>' },
  { format: 'sup', open: '<sup>', close: '</sup>' },
  { format: 'inline_math', open: '$', close: '$' }
] as const)(
  'formats $format through the common owner with native selection and retained suggestions',
  async({ format, open, close }) => {
    const source = 'a{++a++}a\n'
    const setup = bootFormatting(source)
    try {
      const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native block')
      block.setCursor(0, 3, true)
      setup.muya.format(format)
      setup.muya.flush()
      const expected =
        format === 'inline_math' ? `$a$${'{++$a$++}'}$a$\n` : `${open}a{++a++}a${close}\n`
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(setup.legacyChanges).toEqual([])
      const selected = setup.muya.editor.selection.getDOMSelection()
      if (!selected) throw new Error('Formatting lost model selection')
      expect(
        muyaFormatToModel(setup.muya, setup.view(), { format, selection: selected }, false)
          .selection
      ).toEqual({
        ranges: [{ anchor: open.length, focus: expected.length - close.length - 1 }],
        primary: 0
      })
      const target = setup.muya.getSelection()?.focus.block.domNode
      if (!target) throw new Error('Formatting lost next input target')
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: `${open}X${close}\n` })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      setup.muya.format(format)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      await setup.adapter.history('redo', setup.reconcile)
      const saved = setup.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing save source')
      const reopened = bootFormatting(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopened.dispose()
      }
    } finally {
      setup.dispose()
    }
  }
)

it('creates a link without replacing the selected suggestion, then edits its destination', async() => {
  const source = 'a{++a++}a\n'
  const setup = bootFormatting(source)
  try {
    const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Missing native link creation block')
    block.setCursor(0, 3, true)
    setup.muya.format('link')
    setup.muya.flush()
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: '[a{++a++}a]()\n' })
    expect(setup.muya.getSelection()).toMatchObject({ anchor: { offset: 6 }, focus: { offset: 6 } })
    const target = setup.muya.getSelection()?.focus.block.domNode
    if (!target) throw new Error('Link creation lost destination caret')
    target.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'url',
        bubbles: true,
        cancelable: true
      })
    )
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: '[a{++a++}a](url)\n' })
    expect(setup.legacyChanges).toEqual([])
    await setup.adapter.history('undo', setup.reconcile)
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: '[a{++a++}a]()\n' })
    await setup.adapter.history('undo', setup.reconcile)
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    setup.dispose()
  }
})

it('unlinks the actual hovered link through the model without consuming its suggestion', async() => {
  const source = '[a{++a++}a](url)\n'
  const setup = bootFormatting(source)
  type LinkTool = {
    reference: HTMLElement
    linkInfo: { range: { start: number; end: number }; text: string }
    block: {
      unlink: (
        info: { range: { start: number; end: number }; text: string },
        reference?: HTMLElement
      ) => void
    }
  }
  let tools: LinkTool | undefined
  setup.muya.on('muya-link-tools', (event: LinkTool) => {
    if (event.reference) tools = event
  })
  try {
    const anchor = setup.muya.domNode.querySelector('a')
    expect(anchor).not.toBeNull()
    anchor?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    if (!tools) throw new Error('Missing native link widget')
    tools.block.unlink(tools.linkInfo, tools.reference)
    setup.muya.flush()
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: 'a{++a++}a\n' })
    expect(setup.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 3 } })
    expect(setup.legacyChanges).toEqual([])
    const target = setup.muya.getSelection()?.focus.block.domNode
    if (!target) throw new Error('Unlink lost native caret')
    target.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: 'a{++a++}aX\n' })
    await setup.adapter.history('undo', setup.reconcile)
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: 'a{++a++}a\n' })
    await setup.adapter.history('undo', setup.reconcile)
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    setup.dispose()
  }
})

it('creates an image without replacing the selected suggestion, then preserves the next document input', async() => {
  const source = 'a{++a++}a\n'
  const setup = bootFormatting(source)
  const picker: unknown[] = []
  setup.muya.on('muya-image-selector', (event: unknown) => picker.push(event))
  try {
    const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Missing native link creation block')
    block.setCursor(0, 3, true)
    setup.muya.format('image')
    setup.muya.flush()
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: '![a{++a++}a]()\n' })
    expect(setup.muya.getSelection()).toMatchObject({ anchor: { offset: 8 }, focus: { offset: 8 } })
    expect(picker).toHaveLength(1)
    expect(setup.muya.domNode.querySelectorAll('.mu-inline-image')).toHaveLength(1)
    const target = setup.muya.getSelection()?.focus.block.domNode
    if (!target) throw new Error('Link creation lost destination caret')
    target.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: '![a{++a++}a]()X\n' })
    expect(setup.legacyChanges).toEqual([])
    await setup.adapter.history('undo', setup.reconcile)
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: '![a{++a++}a]()\n' })
    await setup.adapter.history('undo', setup.reconcile)
    expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    setup.dispose()
  }
})

it('observes the standalone image creation selection control', async() => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  try {
    muya.init()
    muya.setContent('aaa\n')
    muya.editor.scrollPage?.firstContentInDescendant()?.setCursor(0, 3, true)
    muya.format('image')
    muya.flush()
    expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    expect(muya.getMarkdown()).toBe('![aaa]()\n')
  } finally {
    muya.destroy()
    host.remove()
  }
})

it.each([
  {
    source: '<img src="old.png" alt="aaa" width="120" data-align="center">\n',
    cursor: 61,
    alt: 'aaa',
    expected:
      '<img src="https://example.com/image.png" alt="aaa" width="120" data-align="center" />\n'
  },
  {
    source: '<img src="old.png" alt="aaa">\n',
    cursor: 29,
    alt: 'aaa',
    expected: '<img src="https://example.com/image.png" alt="aaa" />\n'
  },
  {
    source: '<img src="old.png" alt="a{++a++}a">\n',
    cursor: 35,
    alt: 'a{++a++}a',
    expected: '<img src="https://example.com/image.png" alt="a{++a++}a" />\n'
  },
  {
    source: '![a{++a++}a]()\n',
    cursor: 8,
    expected: '![a{++a++}a](https://example.com/image.png)\n'
  },
  {
    source: '![a{++a++}a][ref]\n\n[ref]: old.png\n',
    cursor: 11,
    expected: '![a{++a++}a](https://example.com/image.png)\n\n[ref]: old.png\n'
  },
  {
    source: '![aaa][ref]\n\n[ref]: old.png\n',
    cursor: 11,
    expected: '![aaa](https://example.com/image.png)\n\n[ref]: old.png\n'
  },
  {
    source: '![a{++a++}a](old.png){width=120 height=50% data-align=center}\n',
    cursor: '![aaa](old.png){width=120 height=50% data-align=center}'.length,
    expected:
      '![a{++a++}a](https://example.com/image.png){width=120 height=50% data-align=center}\n'
  },
  {
    source: '![a{++a++}a][ref]{width=120}\n\n[ref]: old.png\n',
    cursor: '![aaa][ref]{width=120}'.length,
    expected: '![a{++a++}a](https://example.com/image.png){width=120}\n\n[ref]: old.png\n'
  }
])(
  'changes the actual native image destination without rewriting its label or shared definition: $source',
  async(example) => {
    const { source, cursor, expected } = example
    const alt = 'alt' in example && typeof example.alt === 'string' ? example.alt : 'aaa'
    const setup = bootFormatting(source)
    let picker:
      | {
        imageInfo: unknown
        block: {
          replaceImage: (
            info: unknown,
            value: { alt: string; src: string; title: string }
          ) => void
        }
      }
      | undefined
    setup.muya.on('muya-image-selector', (event: typeof picker) => {
      picker = event
    })
    try {
      setup.muya.editor.scrollPage?.firstContentInDescendant()?.setCursor(cursor, cursor, true)
      expect(setup.muya.showImageSelectorAtSelection()).toBe(true)
      if (!picker) throw new Error('Image picker did not receive the current image')
      picker.block.replaceImage(picker.imageInfo, {
        alt,
        src: 'https://example.com/image.png',
        title: ''
      })
      setup.muya.flush()
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(setup.legacyChanges).toEqual([])
      const target = setup.muya.getSelection()?.focus.block.domNode
      if (!target) throw new Error('Image update lost native caret')
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(setup.binding.sourceAtBarrier()).toMatchObject({
        source: expected.replace('\n', 'X\n')
      })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      await setup.adapter.history('redo', setup.reconcile)
      const saved = setup.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing saved image')
      const reopened = bootFormatting(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopened.dispose()
      }
    } finally {
      setup.dispose()
    }
  }
)

it.each([
  {
    source: '![cat](image.png)\n',
    attr: 'width',
    value: '120',
    expected: '![cat](image.png){width=120}\n'
  },
  {
    source: '<img src="image.png" alt="cat" width=90 data-align=left>\n',
    attr: 'width',
    value: '120',
    expected: '<img src="image.png" alt="cat" width="120" data-align=left />\n'
  },
  {
    source: '![cat][ref] ![cat][ref]\n\n[ref]: image.png\n',
    attr: 'width',
    value: '120',
    expected: '![cat][ref] ![cat][ref]{width=120}\n\n[ref]: image.png\n'
  },
  {
    source: '![cat](image.png) ![cat](image.png)\n',
    attr: 'data-align',
    value: 'center',
    expected: '![cat](image.png) ![cat](image.png){data-align=center}\n'
  },
  {
    source: '![A {++sunny ++}{++sandy ++}beach{>>keep<<}](image.png)\n',
    attr: 'width',
    value: '120',
    expected: '![A {++sunny ++}{++sandy ++}beach{>>keep<<}](image.png){width=120}\n'
  },
  {
    source: '![A {++sunny ++}{++sandy ++}beach{>>keep<<}][ref]{width=120}\n\n[ref]: image.png\n',
    attr: 'data-align',
    value: 'center',
    expected:
      '![A {++sunny ++}{++sandy ++}beach{>>keep<<}][ref]{width=120 data-align=center}\n\n[ref]: image.png\n'
  }
])(
  'authors the actual selected native image layout through Core: $source',
  async({ source, attr, value, expected }) => {
    const setup = bootFormatting(source)
    let picker:
      | {
        imageInfo: unknown
        block: { updateImage: (info: unknown, attr: string, value: string) => void }
      }
      | undefined
    setup.muya.on('muya-image-selector', (event: typeof picker) => {
      picker = event
    })
    try {
      const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing image paragraph')
      block.setCursor(block.text.length, block.text.length, true)
      expect(setup.muya.showImageSelectorAtSelection()).toBe(true)
      if (!picker) throw new Error('Missing actual selected image')
      picker.block.updateImage(picker.imageInfo, attr, value)
      setup.muya.flush()
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(setup.legacyChanges).toEqual([])
      const target = setup.muya.getSelection()?.focus.block.domNode
      if (!target) throw new Error('Image layout lost native caret')
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(setup.binding.sourceAtBarrier()).toMatchObject({
        source: expected.replace('\n', 'X\n')
      })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      await setup.adapter.history('redo', setup.reconcile)
      const saved = setup.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing saved image')
      const reopened = bootFormatting(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopened.dispose()
      }
    } finally {
      setup.dispose()
    }
  }
)

it.each([
  { sunny: 'accept', sandy: 'accept', label: 'A sunny sandy beach' },
  { sunny: 'accept', sandy: 'reject', label: 'A sunny beach' },
  { sunny: 'reject', sandy: 'accept', label: 'A sandy beach' },
  { sunny: 'reject', sandy: 'reject', label: 'A beach' }
] as const)(
  'keeps resized alt suggestions independently reviewable: $sunny/$sandy',
  async({ sunny, sandy, label }) => {
    const source = '![A {++sunny ++}{++sandy ++}beach{>>keep<<}](image.png)\n'
    const resized = source.replace(')\n', '){width=120}\n')
    const setup = bootFormatting(source)
    let picker:
      | {
        imageInfo: unknown
        block: { updateImage(info: unknown, attr: string, value: string): void }
      }
      | undefined
    setup.muya.on('muya-image-selector', (event: typeof picker) => {
      picker = event
    })
    try {
      const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native image paragraph')
      block.setCursor(block.text.length, block.text.length, true)
      expect(setup.muya.showImageSelectorAtSelection()).toBe(true)
      if (!picker) throw new Error('Missing selected image')
      picker.block.updateImage(picker.imageInfo, 'width', '120')
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: resized })
      for (const [text, decision] of [
        ['sunny ', sunny],
        ['sandy ', sandy]
      ] as const) {
        const current = setup.binding.sourceAtBarrier()
        if (current.type !== 'source') throw new Error('Missing review source')
        const annotation = `{++${text}++}`
        const start = current.source.indexOf(annotation)
        expect(start).toBeGreaterThan(0)
        await setup.adapter.resolve(
          { kind: 'addition', range: { start, end: start + annotation.length } },
          current.revision,
          decision,
          setup.reconcile
        )
        expect(setup.binding.sourceAtBarrier()).toMatchObject({
          source: current.source.replace(annotation, decision === 'accept' ? text : '')
        })
      }
      const expected = `![${label}{>>keep<<}](image.png){width=120}\n`
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(setup.legacyChanges).toEqual([])
      await setup.adapter.history('undo', setup.reconcile)
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: resized })
      await setup.adapter.history('redo', setup.reconcile)
      await setup.adapter.history('redo', setup.reconcile)
      const saved = setup.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing saved resized image')
      const reopened = bootFormatting(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        reopened.dispose()
      }
    } finally {
      setup.dispose()
    }
  }
)

it.each([
  { suffix: '', decision: 'accept', annotation: '{++{width=120}++}', reviewed: '{width=120}' },
  { suffix: '', decision: 'reject', annotation: '{++{width=120}++}', reviewed: '' },
  {
    suffix: '{width=90}',
    decision: 'accept',
    annotation: '{~~90~>120~~}',
    reviewed: '{width=120}'
  },
  { suffix: '{width=90}', decision: 'reject', annotation: '{~~90~>120~~}', reviewed: '{width=90}' }
] as const)(
  'reviews a tracked native resize independently from alt suggestions: $suffix/$decision',
  async({ suffix, decision, annotation, reviewed }) => {
    const image = '![A {++sunny ++}{++sandy ++}beach{>>keep<<}](image.png)'
    const source = `${image}${suffix}\n`
    const resized = `${image}${suffix ? `{width=${annotation}}` : annotation}\n`
    const setup = bootFormatting(source, true)
    let picker:
      | {
        imageInfo: unknown
        block: { updateImage(info: unknown, attr: string, value: string): void }
      }
      | undefined
    setup.muya.on('muya-image-selector', (event: typeof picker) => {
      picker = event
    })
    try {
      const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native image paragraph')
      block.setCursor(block.text.length, block.text.length, true)
      expect(setup.muya.showImageSelectorAtSelection()).toBe(true)
      if (!picker) throw new Error('Missing selected image')
      picker.block.updateImage(picker.imageInfo, 'width', '120')
      const current = setup.binding.sourceAtBarrier()
      expect(current).toMatchObject({ source: resized })
      if (current.type !== 'source') throw new Error('Missing resized source')
      const start = resized.indexOf(annotation)
      await setup.adapter.resolve(
        {
          kind: suffix ? 'substitution' : 'addition',
          range: { start, end: start + annotation.length }
        },
        current.revision,
        decision,
        setup.reconcile
      )
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: `${image}${reviewed}\n` })
      expect(setup.legacyChanges).toEqual([])
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: resized })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      await setup.adapter.history('redo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: resized })
    } finally {
      setup.dispose()
    }
  }
)

it.each([false, true].flatMap((tracked) => [false, true].map((height) => ({ tracked, height }))))(
  'resizes, clears and resizes the same native image without consuming its label suggestions (tracked=$tracked, height=$height)',
  async({ tracked, height }) => {
    const image = '![A {++sunny ++}{++sandy ++}beach{>>keep<<}](image.png)'
    const source = `${image}{width=120${height ? ' height=80' : ''}}\n`
    const steps: ReadonlyArray<readonly [string, string]> = tracked
      ? height
        ? [
          ['200', '{width={~~120~>200~~} height=80}'],
          ['240', '{width={~~120~>240~~} height=80}'],
          ['', '{{--width={~~120~>240~~}--} height=80}'],
          ['180', '{~~{{--width={~~120~>240~~}--} height=80}~>{width=180 height=80}~~}']
        ]
        : [
          ['200', '{width={~~120~>200~~}}'],
          ['240', '{width={~~120~>240~~}}'],
          ['', '{--{width={~~120~>240~~}}--}'],
          ['180', '{--{width={~~120~>240~~}}--}{++{width=180}++}']
        ]
      : height
        ? [
          ['200', '{width=200 height=80}'],
          ['240', '{width=240 height=80}'],
          ['', '{ height=80}'],
          ['180', '{ height=80 width=180}']
        ]
        : [
          ['200', '{width=200}'],
          ['240', '{width=240}'],
          ['', ''],
          ['180', '{width=180}']
        ]
    const setup = bootFormatting(source, tracked)
    let picker:
      | {
        imageInfo: unknown
        block: { updateImage(info: unknown, attr: string, value: string): void }
      }
      | undefined
    setup.muya.on('muya-image-selector', (event: typeof picker) => {
      picker = event
    })
    const history = [source]
    try {
      for (const [width, suffix] of steps) {
        const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
        if (!block) throw new Error('Missing native image paragraph')
        block.setCursor(block.text.length, block.text.length, true)
        expect(setup.muya.showImageSelectorAtSelection()).toBe(true)
        if (!picker) throw new Error('Missing selected image')
        picker.block.updateImage(picker.imageInfo, 'width', width)
        setup.muya.flush()
        const expected = `${image}${suffix}\n`
        history.push(expected)
        expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
        const target = setup.muya.getSelection()?.focus.block.domNode
        if (!target) throw new Error('Repeated image layout lost native caret')
        target.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'X',
            bubbles: true,
            cancelable: true
          })
        )
        const typed =
          tracked && width === '180'
            ? height
              ? `${image}{~~{{--width={~~120~>240~~}--} height=80}~>{width=180 height=80}X~~}\n`
              : `${image}{--{width={~~120~>240~~}}--}{++{width=180}X++}\n`
            : `${image}${suffix}${tracked ? '{++X++}' : 'X'}\n`
        expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        await setup.adapter.history('undo', setup.reconcile)
        expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      }
      expect(setup.legacyChanges).toEqual([])
      for (const expected of history.slice(0, -1).reverse()) {
        await setup.adapter.history('undo', setup.reconcile)
        expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      }
      for (const expected of history.slice(1)) {
        await setup.adapter.history('redo', setup.reconcile)
        expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      }
      const saved = setup.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing saved image layout')
      const reopened = bootFormatting(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: history.at(-1) })
      } finally {
        reopened.dispose()
      }
    } finally {
      setup.dispose()
    }
  }
)

it.each(['A sunny beach', 'A {++sunny ++}beach{>>keep<<}'])(
  'deletes the selected sized native image while preserving hidden comments: %s',
  async(label) => {
    const source = `before ![${label}](image.png){width=120} after\n`
    const comment = label.includes('{>>keep<<}') ? '{>>keep<<}' : ''
    const deleted = `before ${comment} after\n`
    const setup = bootFormatting(source)
    let picker: { imageInfo: unknown; block: { deleteImage(info: unknown): void } } | undefined
    setup.muya.on('muya-image-selector', (event: typeof picker) => {
      picker = event
    })
    try {
      const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native image paragraph')
      const end = 'before ![A sunny beach](image.png){width=120}'.length
      block.setCursor(end, end, true)
      expect(setup.muya.showImageSelectorAtSelection()).toBe(true)
      if (!picker) throw new Error('Missing selected image')
      picker.block.deleteImage(picker.imageInfo)
      setup.muya.flush()
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: deleted })
      expect(setup.muya.getSelection()).toMatchObject({
        anchor: { offset: 7 },
        focus: { offset: 7 }
      })
      expect(setup.legacyChanges).toEqual([])
      const target = setup.muya.getSelection()?.focus.block.domNode
      if (!target) throw new Error('Image deletion lost native caret')
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(setup.binding.sourceAtBarrier()).toMatchObject({
        source: `before X${comment} after\n`
      })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source: deleted })
      await setup.adapter.history('undo', setup.reconcile)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      await setup.adapter.history('redo', setup.reconcile)
      const saved = setup.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing saved image deletion')
      const reopened = bootFormatting(saved.source)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: deleted })
      } finally {
        reopened.dispose()
      }
    } finally {
      setup.dispose()
    }
  }
)

it.each(['plain\n', '{++**word**++}\n'])(
  'refreshes the owned presentation on blur without native syntax recognition: %s',
  (source) => {
    const setup = bootFormatting(source)
    const block = setup.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block?.domNode) throw new Error('Missing owned paragraph')
    block.setCursor(3, 3, true)
    const html = block.domNode.innerHTML
    tokenize.mockClear()
    try {
      setup.muya.blur()
      expect(tokenize).not.toHaveBeenCalled()
      expect(block.domNode.innerHTML).toBe(html)
      expect(setup.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(setup.legacyChanges).toEqual([])
    } finally {
      tokenize.mockClear()
      setup.dispose()
    }
  }
)
