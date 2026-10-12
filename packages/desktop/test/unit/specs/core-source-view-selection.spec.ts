// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as lodash from 'lodash'
import * as codeMirror from '@/codeMirror'
import * as authority from '@/documentAuthority'
import * as syntax from '@/documentAuthority/codeMirrorSourceSyntax'
import * as capture from '@/documentAuthority/codeMirrorRecoveryDraftCapture'
import * as adapterOptions from '@/documentAuthority/sourceCodeCoreAdapterOptions'
import * as viewState from '@/documentAuthority/codeMirrorViewState'
import * as toc from '@/documentAuthority/coreHeadingToc'
import bus from '@/bus'
import type { DocumentSelection } from '@marktext/document-core'
import type CodeMirror from 'codemirror'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { muyaClipboardCurrentSelection } from '@/documentAuthority/muyaModelSelection'
import { matchString, buildRegexValue, wordCount } from '@muyajs/core'
import { countProjectedText } from '@/documentConsumers/documentProjectionConsumers'
import { scrollSourceEditorToLine } from '@/util/sourceModeToc'

const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => {} })
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 10, 20) },
    getClientRects: { configurable: true, value: () => [new DOMRect(0, 0, 10, 20)] }
  })
})
afterEach(() => {
  if (scrollTo === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  else Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollTo)
  for (const [name, descriptor] of [
    ['getBoundingClientRect', rect],
    ['getClientRects', rects]
  ] as const) {
    if (descriptor === undefined) Reflect.deleteProperty(Range.prototype, name)
    else Object.defineProperty(Range.prototype, name, descriptor)
  }
})

// The real Source component, native CodeMirror and session execute unchanged.
// Shell stores and services have no filesystem or native-window effects here.
async function mountSource(source: string, selection: DocumentSelection) {
  const file = Vue.reactive({ id: 'source-view-selection', markdown: source })
  const store = Vue.reactive({
    currentFile: file,
    listToc: [],
    LISTEN_FOR_CORE_CONTENT_CHANGE: vi.fn(),
    LISTEN_FOR_CORE_CURSOR_CHANGE: vi.fn(),
    REFRESH_CORE_SAVED_STATE: vi.fn(),
    UPDATE_CORE_CONSUMER_TOC: vi.fn(),
    UPDATE_CORE_CONSUMER_SEARCH: vi.fn(),
    selectionWordCount: null as unknown,
    SET_SELECTION_WORD_COUNT: vi.fn((count: unknown) => {
      store.selectionWordCount = count
    })
  })
  const preferences = Vue.reactive({
    theme: 'light',
    sourceCode: true,
    sourceCodeLineNumbers: true
  })
  const dependencies: Record<string, unknown> = {
    vue: Vue,
    lodash,
    pinia: { storeToRefs: Vue.toRefs },
    '@/store/editor': { useEditorStore: () => store },
    '@/store/preferences': { usePreferencesStore: () => preferences },
    '../../codeMirror': { __esModule: true, ...codeMirror },
    '@muyajs/core': { matchString, buildRegexValue },
    '@/documentConsumers/documentProjectionConsumers': { countProjectedText },
    '../../bus': { __esModule: true, default: bus },
    '@/config': { oneDarkThemes: [], railscastsThemes: [] },
    '@/documentAuthority': authority,
    '@/documentAuthority/coreHeadingToc': toc,
    '@/util/sourceModeToc': { scrollSourceEditorToLine },
    '../search/index.vue': { __esModule: true, default: { render: () => null } },
    '@/documentAuthority/codeMirrorSourceSyntax': syntax,
    '@/documentAuthority/codeMirrorRecoveryDraftCapture': capture,
    '@/documentAuthority/sourceCodeCoreAdapterOptions': adapterOptions,
    '@/documentAuthority/codeMirrorViewState': viewState
  }
  const filename = resolve('src/renderer/src/components/editorWithTabs/sourceCode.vue')
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'source-view-selection', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: { default?: Vue.Component } = {}
   
  new Function('require', 'exports', js)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected Source dependency ${name}`)
  }, exports)
  const manager = authority.createCoreDocumentSessionManager({
    createBinding: () => authority.createEditorCoreBinding(authority.createLocalCoreOwner())
  })
  manager.open({ documentId: file.id, source, lineEnding: '\r\n', options: { texMathGfm: true } })
  await manager.activate(file.id)
  const lease = manager.lease(file.id)
  const exposed = Vue.ref<{ captureDocumentSelection(): DocumentSelection }>()
  const host = document.body.appendChild(document.createElement('div'))
  const electron = window.electron
  Object.assign(window, { electron: { process: { env: {} } } })
  const faults: unknown[] = []
  const app = Vue.createApp({
    render: () =>
      Vue.h(exports.default!, {
        ref: exposed,
        markdown: source,
        coreLease: lease,
        textDirection: 'ltr',
        initialDocumentSelection: selection,
        onCoreFault: (error: unknown) => faults.push(error)
      })
  })
  app.mount(host)
  await Vue.nextTick()
  const editor = (
    host.querySelector('.CodeMirror') as HTMLElement & { CodeMirror: CodeMirror.Editor }
  ).CodeMirror
  return {
    editor,
    capture: () => exposed.value!.captureDocumentSelection(),
    faults,
    search: store.UPDATE_CORE_CONSUMER_SEARCH,
    selectionCount: store.SET_SELECTION_WORD_COUNT,
    save: () => manager.saveBarrier(file.id),
    async dispose() {
      await manager.handoff(lease)
      app.unmount()
      await manager.close(file.id)
      host.remove()
      Object.assign(window, { electron })
    }
  }
}

it('Source mounts the directed canonical selection with CRLF save metadata and preserves replacement history', async() => {
  // The desktop renderer owns LF source; CRLF remains host save metadata.
  const source = 'a{++b++}c\nnext'
  const selection = { ranges: [{ anchor: 14, focus: 8 }], primary: 0 }
  const app = await mountSource(source, selection)
  try {
    expect(app.editor.listSelections()).toEqual([
      { anchor: { line: 1, ch: 4 }, head: { line: 0, ch: 8 } }
    ])
    expect(app.capture()).toEqual(selection)
    app.editor.replaceSelection('X', 'end', '+input')
    expect((await app.save()).source).toBe('a{++b++}X')
    expect(app.capture()).toEqual({ ranges: [{ anchor: 9, focus: 9 }], primary: 0 })
    bus.emit('undo')
    expect((await app.save()).source).toBe(source)
    expect(app.editor.listSelections()).toEqual([
      { anchor: { line: 1, ch: 4 }, head: { line: 0, ch: 8 } }
    ])
    expect(app.faults).toEqual([])
  } finally {
    await app.dispose()
  }
})

it('Source search navigates canonical raw matches, replaces captures atomically and preserves subsequent input/history', async() => {
  const source = 'cat-12 {++cat-34++}\n{--cat-56--} cat-78\n'
  const replaced = '12:cat {++34:cat++}\n{--56:cat--} 78:cat\n'
  const app = await mountSource(source, { ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
  try {
    bus.emit('searchValue', { value: '(cat)\\-(\\d+)', opt: { isRegexp: true } })
    await vi.waitFor(() =>
      expect(app.search.mock.lastCall?.[2]).toMatchObject({ index: 0, matches: { length: 4 } })
    )
    bus.emit('find-action', 'next')
    expect(app.editor.getSelection()).toBe('cat-34')
    expect(app.capture()).toEqual({ ranges: [{ anchor: 10, focus: 16 }], primary: 0 })
    bus.emit('replaceValue', { value: '$2:$1', opt: { isSingle: false, isRegexp: true } })
    await vi.waitFor(async() => expect((await app.save()).source).toBe(replaced))
    expect(app.editor.getValue()).toBe(replaced)
    bus.emit('searchValue', { value: '', opt: { selectHighlight: true } })
    bus.emit('undo')
    expect((await app.save()).source).toBe(source)
    bus.emit('redo')
    expect((await app.save()).source).toBe(replaced)
    bus.emit('searchValue', { value: 'cat', opt: {} })
    await vi.waitFor(() =>
      expect(app.search.mock.lastCall?.[2]).toMatchObject({ index: 0, matches: { length: 4 } })
    )
    bus.emit('find-action', 'next')
    bus.emit('searchValue', { value: '', opt: { selectHighlight: true } })
    app.editor.replaceSelection('X', 'end', '+input')
    expect((await app.save()).source).toBe('12:cat {++34:X++}\n{--56:cat--} 78:cat\n')
    expect(app.faults).toEqual([])
  } finally {
    await app.dispose()
  }
})

it('Source counts the selected words Revised shows, not the CriticMarkup source', async() => {
  const source = 'Keep {--gone--} {++new++} {~~old~>fresh~~} text{>>a note<<}\r\nnext\r\n'
  const app = await mountSource(source, { ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
  try {
    app.editor.execCommand('selectAll')
    await vi.waitFor(() =>
      expect(app.selectionCount.mock.lastCall?.[0]).toEqual(
        wordCount('Keep  new fresh text\nnext\n')
      )
    )
    app.editor.setCursor({ line: 0, ch: 0 })
    await vi.waitFor(() => expect(app.selectionCount.mock.lastCall?.[0]).toBeNull())
    expect(app.faults).toEqual([])
  } finally {
    await app.dispose()
  }
})

it('Source search refresh does not move the native caret after typing while the bar remains open', async() => {
  const source = 'cat cat\n'
  const app = await mountSource(source, { ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
  try {
    bus.emit('searchValue', { value: 'cat', opt: {} })
    await vi.waitFor(() =>
      expect(app.search.mock.lastCall?.[2]).toMatchObject({ index: 0, matches: { length: 2 } })
    )
    app.editor.setCursor({ line: 0, ch: 7 })
    app.editor.replaceSelection('X', 'end', '+input')
    await vi.waitFor(() =>
      expect(app.search.mock.lastCall?.[2]).toMatchObject({ matches: { length: 2 } })
    )
    await app.save()
    expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 8 })
    expect(app.faults).toEqual([])
  } finally {
    await app.dispose()
  }
})

it('Source preserves the intrinsic caret while unchanged and captures an explicit new source caret', async() => {
  const source = '  ```math\n\tx\n  ```\n'
  const native = bootBoundMuya(source, { texMathGfm: true })
  let selection: DocumentSelection
  try {
    native.muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(1, 1, true)
    selection = muyaClipboardCurrentSelection(native.muya, native.view())!
    expect(selection).toMatchObject({ kind: 'model-text' })
  } finally {
    native.dispose()
  }
  const app = await mountSource(source, selection)
  try {
    expect(app.editor.listSelections()).toEqual([
      { anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 1 } }
    ])
    expect(app.capture()).toEqual(selection)
    expect((await app.save()).source).toBe(source)
    app.editor.setCursor({ line: 1, ch: 2 })
    expect(app.capture()).toEqual({ ranges: [{ anchor: 12, focus: 12 }], primary: 0 })
    expect(app.faults).toEqual([])
  } finally {
    await app.dispose()
  }
})
