// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SourceCode from '@/components/editorWithTabs/sourceCode.vue'
import {
  registerSourceModeDocumentPort,
  settleSourceModeInput
} from '@/components/editorWithTabs/sourceModeDocumentPort'
import type {
  SourceModeDocumentPort,
  SourceModePublication
} from '@/components/editorWithTabs/sourceModeController'
import bus from '@/bus'
import i18n from '@/i18n'

const composer = i18n.global as unknown as {
  setLocaleMessage: (locale: string, messages: Record<string, unknown>) => void
  locale: { value: string }
}

const history = Object.freeze({
  canUndo: false,
  canRedo: false,
  dirty: false,
  headIdentity: 'document:1:history:0',
  savedIdentity: 'document:1:history:0'
})

let disposePort = (): void => {}

afterEach(() => {
  composer.locale.value = 'en'
  disposePort()
  disposePort = () => {}
  bus.all.clear()
})

describe('source input', () => {
  it('navigates duplicate headings by parser NodeId and canonical source offset', async() => {
    let publication: SourceModePublication
    const select = vi.fn<SourceModeDocumentPort['select']>(
      async(selection) => {
        publication = Object.freeze({ ...publication, selection })
        return publication
      }
    )
    publication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: '# Repeat\r\n\r\n# Repeat\r\n',
      selection: Object.freeze({ anchor: 0, focus: 0 }),
      history,
      outline: Object.freeze([
        Object.freeze({
          nodeId: 'heading:first' as never,
          slug: 'repeat',
          sourceOffset: 0
        }),
        Object.freeze({
          nodeId: 'heading:second' as never,
          slug: 'repeat-1',
          sourceOffset: 12
        })
      ])
    })
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit: async() => publication,
      cut: async() => publication,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()

    bus.emit('scroll-to-header', 'heading:second')
    await flushPromises()

    const input = wrapper.get('textarea').element as HTMLTextAreaElement
    expect(input.selectionStart).toBe(10)
    expect(select).toHaveBeenCalledWith({ anchor: 12, focus: 12 })
    wrapper.unmount()
  })

  it('maps a textarea gesture onto an exact canonical mixed-EOL range', async() => {
    let publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: 'a\r\nb',
      selection: Object.freeze({ anchor: 3, focus: 3 }),
      history,
      outline: Object.freeze([])
    })
    const listeners = new Set<(value: SourceModePublication) => void>()
    const edit = vi.fn<SourceModeDocumentPort['edit']>(async request => {
      publication = Object.freeze({
        ...publication,
        revisionId: 'revision:2',
        source: publication.source.slice(0, request.start) +
          request.text +
          publication.source.slice(request.end),
        selection: request.selection
      })
      for (const listener of listeners) listener(publication)
      return publication
    })
    const port: SourceModeDocumentPort = {
      snapshot: () => publication,
      subscribe: listener => {
        listeners.add(listener)
        return Object.freeze({ dispose: () => listeners.delete(listener) })
      },
      edit,
      cut: edit,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }
    disposePort = registerSourceModeDocumentPort(port).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const input = wrapper.get('textarea').element as HTMLTextAreaElement

    expect(input.value).toBe('a\nb')
    input.setSelectionRange(2, 2)
    const gesture = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'X'
    })
    input.dispatchEvent(gesture)
    await flushPromises()

    expect(gesture.defaultPrevented).toBe(true)
    expect(edit).toHaveBeenCalledWith({
      revisionId: 'revision:1',
      start: 3,
      end: 3,
      text: 'X',
      selection: { anchor: 4, focus: 4 }
    })
    expect(publication.source).toBe('a\r\nXb')
    expect(input.value).toBe('a\nXb')
    wrapper.unmount()
  })

  it('commits IME text from the composition event without diffing textarea DOM', async() => {
    let publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: 'ab',
      selection: Object.freeze({ anchor: 1, focus: 1 }),
      history,
      outline: Object.freeze([])
    })
    const edit = vi.fn<SourceModeDocumentPort['edit']>(async request => {
      publication = Object.freeze({
        ...publication,
        revisionId: 'revision:2',
        source: publication.source.slice(0, request.start) +
          request.text +
          publication.source.slice(request.end),
        selection: request.selection
      })
      return publication
    })
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit,
      cut: edit,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const input = wrapper.get('textarea').element as HTMLTextAreaElement
    input.setSelectionRange(1, 1)

    input.dispatchEvent(new CompositionEvent('compositionstart', {
      bubbles: true
    }))
    input.value = 'aFORGED-DOMb'
    input.setSelectionRange(12, 12)
    const compositionEnd = new CompositionEvent('compositionend', {
      bubbles: true
    })
    Object.defineProperty(compositionEnd, 'data', { value: 'é' })
    input.dispatchEvent(compositionEnd)
    await flushPromises()

    expect(edit).toHaveBeenCalledWith({
      revisionId: 'revision:1',
      start: 1,
      end: 1,
      text: 'é',
      selection: { anchor: 2, focus: 2 }
    })
    expect(publication.source).toBe('aéb')
    expect(input.value).toBe('aéb')
    wrapper.unmount()
  })

  it('surfaces a rejected source gesture and restores the verified source', async() => {
    composer.setLocaleMessage('source-ux-test', {
      editor: {
        sourceCode: {
          label: 'Localized source surface',
          operationFailed: 'Localized failure: {operation}',
          operations: { edit: 'localized edit operation' }
        }
      }
    })
    composer.locale.value = 'source-ux-test'
    const publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: 'ab',
      selection: Object.freeze({ anchor: 0, focus: 0 }),
      history,
      outline: Object.freeze([])
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit: async() => { throw new Error('rejected by main') },
      cut: async() => publication,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const input = wrapper.get('textarea').element as HTMLTextAreaElement
    expect(wrapper.get('textarea').attributes('aria-label'))
      .toBe('Localized source surface')

    input.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'X'
    }))
    await flushPromises()

    expect(input.value).toBe('ab')
    expect(wrapper.get('[role="alert"]').text())
      .toBe('Localized failure: localized edit operation')
    error.mockRestore()
    wrapper.unmount()
  })

  it('routes copy and cut through the main-owned clipboard port', async() => {
    let publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: 'abc',
      selection: Object.freeze({ anchor: 0, focus: 0 }),
      history,
      outline: Object.freeze([])
    })
    const copy = vi.fn<SourceModeDocumentPort['copy']>(async() => {})
    const cut = vi.fn<SourceModeDocumentPort['cut']>(async request => {
      publication = Object.freeze({
        ...publication,
        revisionId: 'revision:2',
        source: 'c',
        selection: request.selection
      })
      return publication
    })
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit: async() => publication,
      cut,
      copy,
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const input = wrapper.get('textarea').element as HTMLTextAreaElement
    input.setSelectionRange(0, 2)

    const copyEvent = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true
    })
    input.dispatchEvent(copyEvent)
    await flushPromises()
    expect(copyEvent.defaultPrevented).toBe(true)
    expect(copy).toHaveBeenCalledWith({
      revisionId: 'revision:1',
      start: 0,
      end: 2
    })

    input.setSelectionRange(0, 2)
    const cutEvent = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true
    })
    input.dispatchEvent(cutEvent)
    await flushPromises()
    expect(cutEvent.defaultPrevented).toBe(true)
    expect(cut).toHaveBeenCalledWith({
      revisionId: 'revision:1',
      start: 0,
      end: 2,
      text: '',
      selection: { anchor: 0, focus: 0 }
    })
    expect(input.value).toBe('c')
    wrapper.unmount()
  })

  it('allows the originating Source pointer event to reach the native menu', async() => {
    const publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: 'abc',
      selection: Object.freeze({ anchor: 0, focus: 0 }),
      history,
      outline: Object.freeze([])
    })
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit: async() => publication,
      cut: async() => publication,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true
    })

    wrapper.get('textarea').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('delegates paste selection without observing renderer event data', async() => {
    let publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: 'abc',
      selection: Object.freeze({ anchor: 1, focus: 2 }),
      history,
      outline: Object.freeze([])
    })
    const pasteClipboard = vi.fn<SourceModeDocumentPort['paste']>(
      async() => {
        publication = Object.freeze({
          ...publication,
          revisionId: 'revision:2',
          source: 'atrustedc',
          selection: Object.freeze({ anchor: 8, focus: 8 })
        })
        return publication
      }
    )
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit: async() => publication,
      cut: async() => publication,
      copy: async() => {},
      paste: pasteClipboard,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const input = wrapper.get('textarea').element as HTMLTextAreaElement
    input.setSelectionRange(1, 2)
    const paste = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'forged renderer text' }
    })

    input.dispatchEvent(paste)
    await flushPromises()

    expect(paste.defaultPrevented).toBe(true)
    expect(pasteClipboard).toHaveBeenCalledWith({
      revisionId: 'revision:1',
      selection: { anchor: 1, focus: 2 }
    })
    expect(publication.source).toBe('atrustedc')
    wrapper.unmount()
  })

  it('exposes a settlement barrier for every admitted source gesture', async() => {
    let publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: '',
      selection: Object.freeze({ anchor: 0, focus: 0 }),
      history,
      outline: Object.freeze([])
    })
    let finishEdit:
      | ((value: SourceModePublication) => void)
      | undefined
    const edit = vi.fn<SourceModeDocumentPort['edit']>(() =>
      new Promise(resolve => {
        finishEdit = value => {
          publication = value
          resolve(value)
        }
      })
    )
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit,
      cut: edit,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const input = wrapper.get('textarea').element as HTMLTextAreaElement

    input.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'X'
    }))
    await Promise.resolve()

    let settled = false
    const barrier = settleSourceModeInput().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    finishEdit?.(Object.freeze({
      ...publication,
      revisionId: 'revision:2',
      source: 'X',
      selection: Object.freeze({ anchor: 1, focus: 1 })
    }))
    await barrier

    expect(edit).toHaveBeenCalledOnce()
    expect(settled).toBe(true)
    wrapper.unmount()
  })

  it('stays disabled across an asynchronous tab attachment', async() => {
    let publication: SourceModePublication = Object.freeze({
      documentId: 'document:1',
      revisionId: 'revision:1',
      source: 'outgoing',
      selection: Object.freeze({ anchor: 0, focus: 0 }),
      history,
      outline: Object.freeze([])
    })
    let releaseAttachment: (() => void) | undefined
    const edit = vi.fn<SourceModeDocumentPort['edit']>(
      async() => publication
    )
    disposePort = registerSourceModeDocumentPort({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit,
      cut: edit,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: () => new Promise(resolve => {
        releaseAttachment = () => resolve()
      })
    }).dispose
    const wrapper = mount(SourceCode, {
      props: { textDirection: 'ltr' }
    })
    await flushPromises()
    const input = wrapper.get('textarea')
    expect(input.attributes('disabled')).toBeUndefined()

    bus.emit('file-changed')
    await Promise.resolve()
    expect(input.attributes('disabled')).toBeDefined()
    input.element.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'X'
    }))
    expect(edit).not.toHaveBeenCalled()

    publication = Object.freeze({
      ...publication,
      documentId: 'document:2',
      revisionId: 'revision:2',
      source: 'incoming'
    })
    releaseAttachment?.()
    await flushPromises()

    expect(input.attributes('disabled')).toBeUndefined()
    expect((input.element as HTMLTextAreaElement).value).toBe('incoming')
    wrapper.unmount()
  })
})
