import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { ref } from 'vue'

const here = dirname(fileURLToPath(import.meta.url))
const tabsPath = resolve(here, '../../../src/renderer/src/components/editorWithTabs/tabs.vue')

interface TabsBindings {
  closeOthers: (tabId: unknown) => void | Promise<void>
  closeSaved: () => void | Promise<void>
  closeAll: () => void | Promise<void>
}

const loadTabs = (
  editorStore: Record<string, unknown>,
  tabValues: readonly Record<string, unknown>[] = []
): TabsBindings => {
  const source = readFileSync(tabsPath, 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'tabs-close-authority' })
  const noImports = compiled.content
    .split('\n')
    .filter(line => !/^\s*import\s/.test(line))
    .join('\n')
  const js = ts.transpileModule(noImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__deps',
    'exports',
    'module',
    `const { _defineComponent, ref, watch, nextTick, onMounted, onBeforeUnmount,
      useEditorStore, useLayoutStore, storeToRefs, autoScroll, dragula,
      Plus, Close, showContextMenu, bus } = __deps
    ${js}
    return module.exports`
  ) as (deps: Record<string, unknown>, exports: object, module: object) => {
    default: { setup: (props: unknown, context: { expose: () => void }) => TabsBindings }
  }
  const module = { exports: {} as Record<string, unknown> }
  const component = factory({
    _defineComponent: (value: unknown) => value,
    ref,
    watch: () => {},
    nextTick: () => Promise.resolve(),
    onMounted: () => {},
    onBeforeUnmount: () => {},
    useEditorStore: () => editorStore,
    useLayoutStore: () => ({}),
    storeToRefs: () => ({ currentFile: ref(tabValues[0] ?? null), tabs: ref(tabValues) }),
    autoScroll: () => ({ down: false, destroy: () => {} }),
    dragula: () => ({ on: () => ({}) }),
    Plus: {},
    Close: {},
    showContextMenu: () => {},
    bus: { on: () => {}, off: () => {} }
  }, module.exports, module).default
  return component.setup({}, { expose: () => {} })
}

describe('editor tabs — aggregate close authority', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns and handles the aggregate close-all rejection', async() => {
    let rejectClose: ((error: Error) => void) | undefined
    const aggregateClose = new Promise<void>((_resolve, reject) => {
      rejectClose = reject
    })
    const bindings = loadTabs({ CLOSE_ALL_TABS: () => aggregateClose })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const closing = bindings.closeAll()

    expect(closing).toBeInstanceOf(Promise)
    rejectClose?.(new Error('aggregate Core close failed'))
    await expect(closing).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to close documents through their authority barriers',
      expect.objectContaining({ message: 'aggregate Core close failed' })
    )
  })

  it('returns and handles the aggregate close-saved rejection', async() => {
    let rejectClose: ((error: Error) => void) | undefined
    const aggregateClose = new Promise<void>((_resolve, reject) => {
      rejectClose = reject
    })
    const bindings = loadTabs({ CLOSE_SAVED_TABS: () => aggregateClose })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const closing = bindings.closeSaved()

    expect(closing).toBeInstanceOf(Promise)
    rejectClose?.(new Error('saved Core close failed'))
    await expect(closing).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to close documents through their authority barriers',
      expect.objectContaining({ message: 'saved Core close failed' })
    )
  })

  it('returns and handles the aggregate close-others rejection', async() => {
    let rejectClose: ((error: Error) => void) | undefined
    const aggregateClose = new Promise<void>((_resolve, reject) => {
      rejectClose = reject
    })
    const keptTab = { id: 'kept-tab' }
    const bindings = loadTabs(
      { CLOSE_OTHER_TABS: () => aggregateClose },
      [keptTab]
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const closing = bindings.closeOthers('kept-tab')

    expect(closing).toBeInstanceOf(Promise)
    rejectClose?.(new Error('other Core close failed'))
    await expect(closing).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to close documents through their authority barriers',
      expect.objectContaining({ message: 'other Core close failed' })
    )
  })
})
