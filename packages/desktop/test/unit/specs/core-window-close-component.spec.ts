import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import codeMirror from 'codemirror'
import { Muya } from '@muyajs/core'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import { muyaActiveFormats, muyaInputToModel } from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { MuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import * as authority from '@/documentAuthority'
import * as teardown from '@/documentAuthority/coreDocumentSessionTeardown'
import * as retirement from '@/documentAuthority/coreDocumentSessionRetirement'
import * as handoff from '@/documentAuthority/coreDocumentViewHandoff'
import * as preferences from '@/documentAuthority/coreMarkdownPreferences'
import type { CodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import type {
  CoreDocumentSessionManager,
  CoreDocumentViewLease
} from '@/documentAuthority/coreDocumentSessionManager'

// Compile and mount the real owner SFC. Only native widgets/stores are replaced;
// its watchers, close registration, retirement and remount run unchanged. The
// Source child retains the real CodeMirror document, adapter and session owner.
function loadOwner(deps: Record<string, unknown>): Vue.Component {
  const filename = resolve('src/renderer/src/components/editorWithTabs/index.vue')
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'close-owner', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: { default?: Vue.Component } = {}
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', js)((name: string) => {
    if (name === 'vue') return Vue
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
        assertCloseAllowed: () => {
          if (adapter.isComposing()) { throw new Error('Finish text composition before closing the window') }
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
    isGitlabCompatibilityEnabled: false,
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
    './CoreRecoveryDrafts.vue': blank
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

it('retires real Muya input and restores the same owner and caret before the next native key', async() => {
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
    props: ['coreLease', 'corePlainTextView', 'muyaIndexCursor'],
    setup(props, { expose }) {
      const host = Vue.ref<HTMLElement>()
      let ownMuya: Muya | undefined
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
        let presentation = createMuyaMarkupPresentationIndex(view())
        const ownReconcile = (outcome: CoreAppliedReply) => {
          const current = view()
          presentation = createMuyaMarkupPresentationIndex(current, presentation)
          ownMuya!.setInlinePresentation(presentation.render)
          reconcileMuyaDocumentView({
            muya: ownMuya!,
            view: current,
            outcome,
            sourcePosition: ownAdapter.reconciledSourcePosition,
            dirtyPaths: presentation.changedPaths,
            applyEditability: () => {}
          })
          return current.bindings
        }
        const ownAdapter = authority.createMuyaPlainTextCoreAdapter(
          view().bindings,
          ownLease.binding,
          undefined,
          ownReconcile
        )
        adapter = ownAdapter
        reconcile = ownReconcile
        muya.setInlinePresentation(presentation.render)
        muya.init()
        muya.setContent(structuredClone([...view().state]))
        const unexpected = (): never => {
          throw new Error('Unexpected native command')
        }
        muya.editor.bindDocumentEditing({
          prepareImage: unexpected,
          prepareClipboard: unexpected,
          clipboard: unexpected,
          format: unexpected,
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
        if (props.muyaIndexCursor) muya.setCursorByOffset(props.muyaIndexCursor)
        mounts++
        mounted()
      })
      expose({
        assertCloseAllowed: () => {
          if (ownMuya && adapter.isComposing()) { throw new Error('Finish text composition before closing the window') }
        },
        captureViewState: () => ownMuya?.getCursorOffset()
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
    muyaIndexCursor: undefined as unknown
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
    isGitlabCompatibilityEnabled: false,
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
    './CoreRecoveryDrafts.vue': blank
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
    block.domNode.dispatchEvent(
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
    const first = muya.editor.scrollPage!.firstContentInDescendant()!
    first.setCursor(3, 3, true)
    type('X')
    expect((await manager.saveBarrier(file.id)).source).toBe('a{++b++}cX\n')
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
    block.domNode.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    block.domNode.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: '候' })
    )
    block.domNode.textContent = 'abcXY候'
    block.setCursor(6, 6)
    block.domNode.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '候',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    )
    expect(() => authority.coreDocumentSaveAuthority.prepareClose()).toThrow(/composition/)
    expect(block.domNode.textContent).toBe('abcXY候')
    expect(unmounts).toBe(1)
    block.domNode.dispatchEvent(
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
})
