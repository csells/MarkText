import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import codeMirror from 'codemirror'
import { Muya } from '@muyajs/core'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaActiveFormats,
  muyaCodeLanguage,
  muyaInputToModel,
  muyaClipboardCurrentSelection
} from '@/documentAuthority/muyaModelSelection'
import {
  reconcileMuyaDocumentView,
  restoreMuyaDocumentSelection
} from '@/documentAuthority/reconcileMuyaDocumentView'
import type { DocumentSelection } from '@marktext/document-core'
import type { MuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import * as authority from '@/documentAuthority'
import * as teardown from '@/documentAuthority/coreDocumentSessionTeardown'
import * as retirement from '@/documentAuthority/coreDocumentSessionRetirement'
import * as handoff from '@/documentAuthority/coreDocumentViewHandoff'
import * as preferences from '@/documentAuthority/coreMarkdownPreferences'
import * as eol from '@/documentAuthority/canonicalEolIndex'
import * as cursor from '@/util/cursor'
import * as composer from '@/components/editorWithTabs/coreReviewComposer'
import type { CodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import type {
  CoreDocumentSessionManager,
  CoreDocumentViewLease
} from '@/documentAuthority/coreDocumentSessionManager'
import { asMuyaStates } from '../helpers/muyaTypes'

// Compile and mount the real owner SFC. Only native widgets/stores are replaced;
// its watchers, close registration, retirement and remount run unchanged. The
// Source child retains the real CodeMirror document, adapter and session owner.
function loadOwner(deps: Record<string, unknown>): Vue.Component {
  return loadComponent('src/renderer/src/components/editorWithTabs/index.vue', deps)
}

function loadComponent(path: string, deps: Record<string, unknown>): Vue.Component {
  const filename = resolve(path)
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'close-owner', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: { default?: Vue.Component } = {}
   
  new Function('require', 'exports', js)((name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/documentAuthority/canonicalEolIndex') return eol
    if (name === '@/util/cursor') return cursor
    if (name === './coreReviewComposer') return composer
    if (name === '@/i18n') return { t: (key: string) => key }
    if (name in deps) return deps[name]
    throw new Error(`Unexpected owner dependency ${name}`)
  }, exports)
  return exports.default!
}

it('retires the mounted Source input through close and restores its live actor, selection and history on cancellation', async() => {
  let rejectNextLease = false
  let manager!: CoreDocumentSessionManager
  let adapter!: CodeMirrorCoreAdapter
  let doc!: CodeMirror.Doc
  let lease!: CoreDocumentViewLease
  let mounts = 0
  let unmounts = 0
  let mounted!: () => void
  let nextMounted = new Promise<void>((resolve) => {
    mounted = resolve
  })
  const source = Vue.defineComponent({
    props: ['coreLease', 'initialViewState', 'markdown'],
    setup(props, { expose }) {
      Vue.onMounted(() => {
        lease = props.coreLease
        const snapshot = { source: props.markdown }
        doc = new codeMirror.Doc(snapshot.source)
        const initial = props.initialViewState
        if (initial) doc.setSelections(initial.selections)
        adapter = authority.createCodeMirrorCoreAdapter(doc, lease.binding, {
          canonicalSource: snapshot.source,
          canonicalRevision: lease.identity.revision,
          insertedLineEnding: '\n'
        })
        lease.settleView(
          () => adapter.settled(),
          () => adapter.isSettled()
        )
        const ownAdapter = adapter
        lease.onHandoff(() => ownAdapter.dispose())
        mounts++
        mounted()
      })
      expose({
        captureDocumentSelection: () => adapter.documentSelection(),
        assertCloseAllowed: () => {
          if (adapter.isComposing()) {
            throw new Error('Finish text composition before closing the window')
          }
        },
        captureViewState: () => ({
          selections: doc.listSelections(),
          editorScroll: { left: 0, top: 0 },
          containerScroll: { left: 0, top: 0 }
        })
      })
      Vue.onBeforeUnmount(() => {
        unmounts++
      })
      return () => Vue.h('textarea', { 'data-source': '' })
    }
  })
  const blank = Vue.defineComponent({
    setup: (_, { expose }) => {
      expose({ assertCloseAllowed: () => {} })
      return () => Vue.h('span')
    }
  })
  const file = Vue.reactive({ id: 'close-component', markdown: 'seed\n', lineEnding: 'lf' })
  const editorStore = Vue.reactive({
    currentFile: file,
    tabs: [file],
    REGISTER_CORE_SAVE_IDENTITY: vi.fn(),
    REFRESH_CORE_SAVED_STATE: vi.fn(),
    RECONCILE_CORE_SOURCE_AT_HANDOFF: vi.fn()
  })
  const preferencesStore = Vue.reactive({
    superSubScript: false,
    footnote: false,
    texMathDollars: true,
    texMathGfm: false,
    texMathSingleBackslash: false,
    texMathDoubleBackslash: false,
    highlightSyntax: false,
    inlineDiff: false,
    multilineBlockquote: false,
    SET_MODE: vi.fn()
  })
  const electron = window.electron
  Object.assign(window, {
    electron: { process: { env: {} }, ipcRenderer: { invoke: async() => [] } }
  })
  const owner = loadOwner({
    '@/documentAuthority': {
      ...authority,
      createCoreDocumentSessionManager: (
        ...args: Parameters<typeof authority.createCoreDocumentSessionManager>
      ) => {
        manager = authority.createCoreDocumentSessionManager(...args)
        return {
          ...manager,
          lease(documentId: string) {
            if (rejectNextLease) {
              rejectNextLease = false
              throw new Error('Mount lease failed')
            }
            return manager.lease(documentId)
          }
        }
      }
    },
    '@/documentAuthority/coreDocumentSessionTeardown': teardown,
    '@/documentAuthority/coreDocumentSessionRetirement': retirement,
    '@/documentAuthority/coreDocumentViewHandoff': handoff,
    '@/documentAuthority/coreMarkdownPreferences': preferences,
    '@/store/editor': { useEditorStore: () => editorStore },
    '@/store/preferences': { usePreferencesStore: () => preferencesStore },
    '@/store/layout': { useLayoutStore: () => Vue.reactive({ effectiveSideBarWidth: 0 }) },
    pinia: { storeToRefs: Vue.toRefs },
    './editor.vue': blank,
    './sourceCode.vue': source,
    './tabs.vue': blank,
    './notifications.vue': blank,
    './CoreRecoveryDrafts.vue': blank,
    '../recent/index.vue': blank
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = Vue.createApp(owner, {
    markdown: 'seed\n',
    cursor: null,
    sourceCode: true,
    showTabBar: false,
    textDirection: 'ltr',
    platform: 'darwin'
  })
  app.mount(host)
  try {
    await nextMounted
    doc.setSelection({ line: 0, ch: 4 })
    doc.replaceRange(' late', { line: 0, ch: 4 })
    const generation = lease.identity.generation
    const preparation = authority.coreDocumentSaveAuthority.prepareClose()
    await preparation.ready
    expect(host.querySelector('[data-source]')).toBeNull()
    expect(unmounts).toBe(1)
    expect((await manager.saveBarrier(file.id)).source).toBe('seed late\n')
    expect(() => manager.lease(file.id)).toThrow(/clos/i)
    nextMounted = new Promise<void>((resolve) => {
      mounted = resolve
    })
    rejectNextLease = true
    const mountError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(preparation.resume()).rejects.toThrow(/restore/)
    expect(host.querySelector('[data-source]')).toBeNull()
    await preparation.resume()
    mountError.mockRestore()
    await nextMounted
    expect(mounts).toBe(2)
    expect(lease.identity.generation).toBe(generation)
    expect(doc.getValue()).toBe('seed late\n')
    expect(doc.getCursor()).toEqual(expect.objectContaining({ line: 0, ch: 9 }))
    await adapter.history('undo')
    expect(doc.getValue()).toBe('seed\n')
    await adapter.history('redo')
    expect(doc.getValue()).toBe('seed late\n')

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    lease.settleView(async() => {
      throw new Error('Recovery draft is not durable')
    })
    const refusal = authority.coreDocumentSaveAuthority.prepareClose()
    await expect(refusal.ready).rejects.toThrow('Recovery draft is not durable')
    await refusal.resume()
    expect(unmounts).toBe(1)
    expect(mounts).toBe(2)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
    lease.settleView(
      () => adapter.settled(),
      () => adapter.isSettled()
    )

    adapter.compositionStart()
    doc.replaceRange('候', { line: 0, ch: 9 })
    expect(() => authority.coreDocumentSaveAuthority.assertCloseAllowed()).toThrow(/composition/)
    expect(() => authority.coreDocumentSaveAuthority.prepareClose()).toThrow(/composition/)
    expect(doc.getValue()).toBe('seed late候\n')
    expect(mounts).toBe(2)
    expect(unmounts).toBe(1)
    expect(lease.identity.generation).toBe(generation)
    await adapter.compositionEnd()
    expect((await manager.saveBarrier(file.id)).source).toBe('seed late候\n')
  } finally {
    app.unmount()
    await Promise.resolve()
    host.remove()
    Object.assign(window, { electron })
  }
})

it.each([false, true, 'overlap'] as const)(
  'retires real Muya input and restores the same owner and caret before the next native key (background tabs=%s)',
  async(backgroundTabs) => {
    ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
    let manager!: CoreDocumentSessionManager
    let lease!: CoreDocumentViewLease
    let muya!: Muya
    let adapter!: MuyaPlainTextCoreAdapter
    let reconcile!: Parameters<MuyaPlainTextCoreAdapter['history']>[1]
    let mounted!: () => void
    let nextMounted = new Promise<void>((resolve) => {
      mounted = resolve
    })
    let mounts = 0
    let unmounts = 0
    const native = Vue.defineComponent({
      props: ['coreLease', 'corePlainTextView', 'initialDocumentSelection'],
      setup(props, { expose }) {
        const host = Vue.ref<HTMLElement>()
        let ownMuya: Muya | undefined
        let captureDocumentSelection: () => DocumentSelection | undefined = () => undefined
        Vue.onMounted(() => {
          if (!props.coreLease) return
          lease = props.coreLease
          const ownLease = lease
          const view = () => {
            const reply = ownLease.projectAcknowledgedPlainTextView(ownLease.identity.revision)
            if (!('state' in reply.view)) throw new Error('Expected markup view')
            return reply.view
          }
          muya = ownMuya = new Muya(host.value!)
          captureDocumentSelection = () => muyaClipboardCurrentSelection(ownMuya!, view())
          let presentation = createMuyaMarkupPresentationIndex(view())
          const ownReconcile = (outcome: CoreAppliedReply) => {
            const current = view()
            presentation = createMuyaMarkupPresentationIndex(current, presentation)
            ownMuya!.setInlinePresentation(presentation.render)
            reconcileMuyaDocumentView({
              muya: ownMuya!,
              view: current,
              outcome,
              dirtyPaths: presentation.changedPaths,
              applyEditability: () => {}
            })
            return current.bindings
          }
          const ownAdapter = authority.createMuyaPlainTextCoreAdapter(
            view().bindings,
            ownLease.binding
          )
          adapter = ownAdapter
          reconcile = ownReconcile
          muya.setInlinePresentation(presentation.render)
          muya.init()
          muya.setContent(asMuyaStates(structuredClone([...view().state])))
          const unexpected = (): never => {
            throw new Error('Unexpected native command')
          }
          muya.editor.bindDocumentEditing({
            prepareImage: unexpected,
            prepareClipboard: unexpected,
            clipboard: unexpected,
            format: unexpected,
            emojiContext: () => undefined,
            codeLanguage: (point) => muyaCodeLanguage(ownMuya!, view(), point),
            activeFormats: (selection) => muyaActiveFormats(ownMuya!, view(), selection),
            compositionStart: (operation) =>
              ownAdapter.compositionStart(muyaInputToModel(ownMuya!, view(), operation)),
            compositionUpdate: (data) => ownAdapter.compositionUpdate(data),
            compositionEnd(outcome, present) {
              const result = ownAdapter.compositionEnd(outcome, ownReconcile)
              if (!result.accepted) present()
              return result.changed
            },
            input(operation, present) {
              const result = ownAdapter.input(
                muyaInputToModel(ownMuya!, view(), operation),
                ownReconcile
              )
              if (!result.accepted) present()
              return result.changed
            }
          })
          ownLease.settleView(
            async() => {
              ownMuya!.flush()
              await ownAdapter.settled()
            },
            () => {
              ownMuya!.flush()
              return ownAdapter.isSettled()
            }
          )
          ownLease.onHandoff(() => ownAdapter.dispose())
          if (props.initialDocumentSelection) {
            restoreMuyaDocumentSelection(muya, view(), props.initialDocumentSelection)
          }
          mounts++
          mounted()
        })
        expose({
          assertCloseAllowed: () => {
            if (ownMuya && adapter.isComposing()) {
              throw new Error('Finish text composition before closing the window')
            }
          },
          captureDocumentSelection: () => captureDocumentSelection()
        })
        Vue.onBeforeUnmount(() => {
          if (!ownMuya) return
          ownMuya.destroy()
          unmounts++
        })
        return () => Vue.h('div', { 'data-muya': '' }, [Vue.h('div', { ref: host })])
      }
    })
    const blank = Vue.defineComponent({ setup: () => () => Vue.h('span') })
    const file = Vue.reactive({
      id: 'close-native',
      markdown: 'a{++b++}c\n',
      lineEnding: 'lf',
      muyaIndexCursor: { anchor: { line: 0, ch: 9 }, focus: { line: 0, ch: 9 } } as unknown
    })
    const editorStore = Vue.reactive({
      currentFile: file,
      tabs: [file],
      REGISTER_CORE_SAVE_IDENTITY: vi.fn(),
      REFRESH_CORE_SAVED_STATE: vi.fn(),
      RECONCILE_CORE_SOURCE_AT_HANDOFF: vi.fn()
    })
    const preferencesStore = Vue.reactive({
      superSubScript: false,
      footnote: false,
      texMathDollars: true,
      texMathGfm: false,
      texMathSingleBackslash: false,
      texMathDoubleBackslash: false,
      highlightSyntax: false,
      inlineDiff: false,
      multilineBlockquote: false,
      SET_MODE: vi.fn()
    })
    const electron = window.electron
    Object.assign(window, {
      electron: { process: { env: {} }, ipcRenderer: { invoke: async() => [] } }
    })
    const owner = loadOwner({
      '@/documentAuthority': {
        ...authority,
        createCoreDocumentSessionManager: (
          ...args: Parameters<typeof authority.createCoreDocumentSessionManager>
        ) => {
          manager = authority.createCoreDocumentSessionManager(...args)
          return manager
        }
      },
      '@/documentAuthority/coreDocumentSessionTeardown': teardown,
      '@/documentAuthority/coreDocumentSessionRetirement': retirement,
      '@/documentAuthority/coreDocumentViewHandoff': handoff,
      '@/documentAuthority/coreMarkdownPreferences': preferences,
      '@/store/editor': { useEditorStore: () => editorStore },
      '@/store/preferences': { usePreferencesStore: () => preferencesStore },
      '@/store/layout': { useLayoutStore: () => Vue.reactive({ effectiveSideBarWidth: 0 }) },
      pinia: { storeToRefs: Vue.toRefs },
      './editor.vue': native,
      './sourceCode.vue': blank,
      './tabs.vue': blank,
      './notifications.vue': blank,
      './CoreRecoveryDrafts.vue': blank,
      '../recent/index.vue': blank
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = Vue.createApp({
      render: () =>
        Vue.h(owner, {
          markdown: file.markdown,
          muyaIndexCursor: file.muyaIndexCursor,
          cursor: null,
          sourceCode: false,
          showTabBar: false,
          textDirection: 'ltr',
          platform: 'darwin'
        })
    })
    app.mount(host)
    const type = (text: string) => {
      const block = muya.editor.selection.getSelection()?.anchor.block
      if (!block) throw new Error('No native selection')
      block.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          data: text,
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
    }
    try {
      await nextMounted
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 3 } })
      if (backgroundTabs === 'overlap') {
        type('X')
        expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cX\n')
        const originalGeneration = lease.identity.generation
        const priorAdapter = adapter
        let release!: () => void
        let entered!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        const started = new Promise<void>((resolve) => {
          entered = resolve
        })
        lease.settleView(
          async() => {
            entered()
            await held
          },
          () => false
        )
        const background = { ...file, id: 'background-document', markdown: 'Other document\n' }
        editorStore.tabs.push(background)
        await Vue.nextTick()
        await started
        editorStore.currentFile = background
        await Vue.nextTick()
        lease.settleView(
          () => priorAdapter.settled(),
          () => priorAdapter.isSettled()
        )
        release()
        expect((await authority.coreDocumentSaveAuthority.request(background.id))?.source).toBe(
          'Other document\n'
        )
        expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cX\n')
        nextMounted = new Promise<void>((resolve) => {
          mounted = resolve
        })
        editorStore.currentFile = file
        await Vue.nextTick()
        await authority.coreDocumentSaveAuthority.request(file.id)
        await nextMounted
        expect(lease.identity.generation).toBe(originalGeneration)
        await adapter.history('undo', reconcile)
        expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}c\n')
        await adapter.history('redo', reconcile)
        expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cX\n')
        type('Y')
        expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cXY\n')
        return
      }
      if (backgroundTabs) {
        editorStore.tabs.push({ ...file, id: 'background-document', markdown: 'Other document\n' })
        await Vue.nextTick()
        expect((await authority.coreDocumentSaveAuthority.request(file.id))?.source).toBe(
          'a{++b++}c\n'
        )
        expect(lease.projectAcknowledgedPlainTextView(lease.identity.revision)).toBeDefined()
        expect(mounts).toBe(1)
        expect(unmounts).toBe(0)
      }
      type('X')
      expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cX\n')
      if (backgroundTabs) {
        editorStore.tabs = [file]
        await Vue.nextTick()
        expect((await authority.coreDocumentSaveAuthority.request(file.id))?.source).toBe(
          'a{++b++}cX\n'
        )
        expect(lease.projectAcknowledgedPlainTextView(lease.identity.revision)).toBeDefined()
        expect(mounts).toBe(1)
        expect(unmounts).toBe(0)
      }
      vi.spyOn(muya, 'getCursorOffset').mockImplementation(() => {
        throw new Error('Core caret capture must not serialize native Markdown')
      })
      const generation = lease.identity.generation
      const preparation = authority.coreDocumentSaveAuthority.prepareClose()
      await preparation.ready
      expect(unmounts).toBe(1)
      expect(() => manager.lease(file.id)).toThrow(/clos/i)
      nextMounted = new Promise<void>((resolve) => {
        mounted = resolve
      })
      await preparation.resume()
      await nextMounted
      expect(mounts).toBe(2)
      expect(lease.identity.generation).toBe(generation)
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 4 }, focus: { offset: 4 } })
      type('Y')
      expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cXY\n')
      await adapter.history('undo', reconcile)
      expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cX\n')
      await adapter.history('redo', reconcile)
      expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cXY\n')
      lease.settleView(async() => {
        throw new Error('Rejected draft backup failed')
      })
      const refused = authority.coreDocumentSaveAuthority.prepareClose()
      await expect(refused.ready).rejects.toThrow('Rejected draft backup failed')
      await refused.resume()
      expect(unmounts).toBe(1)
      expect(lease.identity.generation).toBe(generation)
      lease.settleView(
        async() => {
          muya.flush()
          await adapter.settled()
        },
        () => {
          muya.flush()
          return adapter.isSettled()
        }
      )
      const block = muya.editor.selection.getSelection()!.anchor.block
      block.domNode!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      block.domNode!.dispatchEvent(
        new CompositionEvent('compositionupdate', { bubbles: true, data: '候' })
      )
      block.domNode!.textContent = 'abcXY候'
      block.setCursor(6, 6)
      block.domNode!.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '候',
          inputType: 'insertCompositionText',
          isComposing: true
        })
      )
      expect(() => authority.coreDocumentSaveAuthority.prepareClose()).toThrow(/composition/)
      expect(block.domNode!.textContent).toBe('abcXY候')
      expect(unmounts).toBe(1)
      block.domNode!.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '候' })
      )
      expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cXY候\n')
    } finally {
      app.unmount()
      await Promise.resolve()
      host.remove()
      document.getSelection()?.removeAllRanges()
      Object.assign(window, { electron })
    }
  }
)

it.each([false, true])(
  'keeps the real window owner through empty states and subsequent documents (source=%s)',
  async(sourceCode) => {
    // Native app listeners are irrelevant to this component lifetime check. The
    // parent template, owner, session manager and close authority stay real.
    function store<T extends object>(state: T): T {
      return new Proxy(Vue.reactive(state) as T, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^(?:[A-Z_]+|listenForNotification)$/.test(key)) {
            return () => {}
          }
          return Reflect.get(target, key, receiver)
        }
      })
    }
    type File = { id: string; markdown: string; lineEnding: string }
    const editorStore = store({ currentFile: null as File | null, tabs: [] as File[] })
    const preferencesStore = store({
      sourceCode,
      theme: 'light',
      customCss: '',
      textDirection: 'ltr',
      zoom: 1,
      superSubScript: false,
      footnote: false,
      texMathDollars: true,
      texMathGfm: false,
      texMathSingleBackslash: false,
      texMathDoubleBackslash: false,
      highlightSyntax: false,
      inlineDiff: false,
      multilineBlockquote: false
    })
    const layoutStore = store({ effectiveSideBarWidth: 0, showTabBar: true })
    const blank = Vue.defineComponent({ setup: () => () => Vue.h('span') })
    const recent = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-empty': '' }) })
    const recovery = Vue.defineComponent({
      setup: () => () => Vue.h('div', { 'data-recovery': '' })
    })
    let renderedLease: CoreDocumentViewLease | undefined
    const input = Vue.defineComponent({
      props: ['coreLease'],
      setup(props, { expose }) {
        Vue.onMounted(() => {
          const lease = props.coreLease as CoreDocumentViewLease | undefined
          if (lease) renderedLease = lease
          lease?.settleView(
            async() => {},
            () => true
          )
        })
        expose({
          assertCloseAllowed: () => {},
          captureDocumentSelection: () => undefined,
          captureViewState: () => undefined
        })
        return () => Vue.h('textarea', { 'data-input': '' })
      }
    })
    let manager!: CoreDocumentSessionManager
    let pauseClose: { documentId: string; started(): void; ready: Promise<void> } | undefined
    let releaseClose: (() => void) | undefined
    const createManager = vi.fn(
      (...args: Parameters<typeof authority.createCoreDocumentSessionManager>) => {
        manager = authority.createCoreDocumentSessionManager(...args)
        return {
          ...manager,
          async close(documentId: string) {
            if (pauseClose?.documentId === documentId) {
              pauseClose.started()
              await pauseClose.ready
            }
            await manager.close(documentId)
          }
        }
      }
    )
    const shared = {
      '@/store/editor': { useEditorStore: () => editorStore },
      '@/store/preferences': { usePreferencesStore: () => preferencesStore },
      '@/store/layout': { useLayoutStore: () => layoutStore },
      pinia: { storeToRefs: Vue.toRefs }
    }
    const owner = loadOwner({
      ...shared,
      '@/documentAuthority': { ...authority, createCoreDocumentSessionManager: createManager },
      '@/documentAuthority/coreDocumentSessionTeardown': teardown,
      '@/documentAuthority/coreDocumentSessionRetirement': retirement,
      '@/documentAuthority/coreDocumentViewHandoff': handoff,
      '@/documentAuthority/coreMarkdownPreferences': preferences,
      './editor.vue': input,
      './sourceCode.vue': input,
      './tabs.vue': blank,
      './notifications.vue': blank,
      './CoreRecoveryDrafts.vue': recovery,
      '../recent/index.vue': recent
    })
    const parent = loadComponent('src/renderer/src/pages/app.vue', {
      ...shared,
      '@/store': {
        useMainStore: () => store({ init: true, windowActive: true, platform: 'darwin' })
      },
      '@/store/project': { useProjectStore: () => store({ projectTree: null }) },
      '@/store/listenForMain': { useListenForMainStore: () => store({}) },
      '@/store/autoUpdates': { useAutoUpdatesStore: () => store({}) },
      '@/store/commandCenter': { useCommandCenterStore: () => store({}) },
      '@/store/notification': { useNotificationStore: () => store({}) },
      '@/util/theme': { addStyles: () => {}, addThemeStyle: () => {}, addCustomStyle: () => {} },
      '@/config': { DEFAULT_STYLE: {} },
      '@/bus': { emit: () => {} },
      '@/components/recent/index.vue': recent,
      '@/components/editorWithTabs/index.vue': owner,
      '@/components/titleBar/index.vue': blank,
      '@/components/sideBar/index.vue': blank,
      '@/components/about/index.vue': blank,
      '@/components/commandPalette/index.vue': blank,
      '@/components/exportSettings/index.vue': blank,
      '@/components/rename/index.vue': blank,
      '@/components/import/index.vue': blank
    })
    const electron = window.electron
    Object.assign(window, {
      electron: { process: { env: {} }, ipcRenderer: { invoke: async() => [] } }
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = Vue.createApp(parent)
    app.mount(host)
    const closeEmpty = async() => {
      expect(host.querySelector('[data-empty]')).not.toBeNull()
      expect(host.querySelector('[data-input]')).toBeNull()
      expect(host.querySelector('[data-recovery]')).not.toBeNull()
      // This is the real authority used by the native close listener, including
      // its missing-owner error. An empty tab list must still have a window owner.
      const close = authority.coreDocumentSaveAuthority.prepareClose()
      await close.ready
      expect(authority.coreDocumentSaveAuthority.isClosing()).toBe(true)
      await close.resume()
      expect(authority.coreDocumentSaveAuthority.isClosing()).toBe(false)
      expect(createManager).toHaveBeenCalledTimes(1)
    }
    const open = async(id: string, markdown: string) => {
      const file = { id, markdown, lineEnding: 'lf' }
      editorStore.tabs = [file]
      editorStore.currentFile = file
      await vi.waitFor(() => expect(host.querySelector('[data-input]')).not.toBeNull())
      await vi.waitFor(async() => {
        expect((await manager.saveBarrier(id)).source).toBe(markdown)
        expect((await authority.coreDocumentSaveAuthority.request(id))?.source).toBe(markdown)
      })
      expect(authority.coreDocumentReloadAuthority.has(id)).toBe(true)
      expect(host.querySelector('[data-empty]')).toBeNull()
      expect(createManager).toHaveBeenCalledTimes(1)
    }
    try {
      await Vue.nextTick()
      await closeEmpty()
      await open('empty-close-first', 'Ordinary Markdown\n')
      const closedLease = renderedLease
      if (!closedLease) throw new Error('Expected the opened document view lease')
      editorStore.currentFile = null
      editorStore.tabs = []
      await Vue.nextTick()
      await closeEmpty()
      expect(authority.coreDocumentSaveAuthority.request('empty-close-first')).toBeUndefined()
      expect(authority.coreDocumentReloadAuthority.has('empty-close-first')).toBe(false)
      expect(
        authority.coreDocumentRecoveryAuthority.recover({
          documentId: 'empty-close-first',
          lease: closedLease,
          error: new Error('Retired view must have no recovery owner')
        })
      ).toBeUndefined()
      await open('empty-close-first', 'Reopened {++CriticMarkup++}\n')
      editorStore.currentFile = null
      editorStore.tabs = []
      await Vue.nextTick()
      await closeEmpty()
      await open('empty-close-second', 'Another Markdown document\n')

      // A user can choose New File while the last actor is still retiring. Its
      // synchronous registrations must survive the earlier empty-tab snapshot.
      let closing!: () => void
      const closeStarted = new Promise<void>((resolve) => {
        closing = resolve
      })
      pauseClose = {
        documentId: 'empty-close-second',
        started: () => closing(),
        ready: new Promise<void>((resolve) => {
          releaseClose = resolve
        })
      }
      editorStore.currentFile = null
      editorStore.tabs = []
      await Vue.nextTick()
      await closeStarted
      const nextFile = { id: 'empty-close-overlap', markdown: 'New {++file++}\n', lineEnding: 'lf' }
      editorStore.tabs = [nextFile]
      editorStore.currentFile = nextFile
      await Vue.nextTick()
      expect(authority.coreDocumentReloadAuthority.has(nextFile.id)).toBe(true)
      releaseClose?.()
      await vi.waitFor(async() => {
        expect((await authority.coreDocumentSaveAuthority.request(nextFile.id))?.source).toBe(
          nextFile.markdown
        )
      })
      expect(authority.coreDocumentReloadAuthority.has(nextFile.id)).toBe(true)
      await vi.waitFor(() => expect(renderedLease?.documentId).toBe(nextFile.id))
      if (!renderedLease) throw new Error('Expected the overlapping document view lease')
      const viewFault = new Error('Verify the overlapping document recovery owner')
      renderedLease.faultView(viewFault)
      const recovery = authority.coreDocumentRecoveryAuthority.recover({
        documentId: nextFile.id,
        lease: renderedLease,
        error: viewFault
      })
      expect(recovery).toBeDefined()
      await recovery
      expect((await authority.coreDocumentSaveAuthority.request(nextFile.id))?.source).toBe(
        nextFile.markdown
      )
    } finally {
      releaseClose?.()
      app.unmount()
      await Promise.resolve()
      host.remove()
      Object.assign(window, { electron })
    }
    expect(() => authority.coreDocumentSaveAuthority.prepareClose()).toThrow(
      'Window close owner is unavailable'
    )
    await vi.waitFor(() => {
      expect(authority.coreDocumentSaveAuthority.request('empty-close-first')).toBeUndefined()
      expect(authority.coreDocumentSaveAuthority.request('empty-close-second')).toBeUndefined()
      expect(authority.coreDocumentSaveAuthority.request('empty-close-overlap')).toBeUndefined()
    })
  }
)
