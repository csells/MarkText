import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { codeMirrorThemeFor } from '../../../src/common/theme'

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/editorWithTabs/mergeConflictDialog.vue')

interface SetupBindings {
  acceptMerge: () => void
  closingByAction: { value: boolean }
  createEditor: (parent: HTMLDivElement, value: string, readOnly: boolean) => unknown
  dialogTitle: { value: string }
  resultEditor: { value: null | { getValue: () => string; setValue: (value: string) => void } }
  validationError: { value: string }
}

const loadComponent = (deps: Record<string, unknown>) => {
  const src = readFileSync(vuePath, 'utf8')
  const { descriptor } = parse(src)
  const compiled = compileScript(descriptor, { id: 'test' })
  const noImports = compiled.content.replace(
    /^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,
    ''
  )
  const js = ts.transpileModule(noImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__deps',
    'exports',
    'module',
    `const { _defineComponent, computed, nextTick, onBeforeUnmount, ref, watch,
      storeToRefs, codeMirror, codeMirrorThemeFor, useEditorStore, usePreferencesStore, t } = __deps
    ${js}
    return module.exports`
  ) as (deps: Record<string, unknown>, exports: object, module: object) => {
    default: { setup: (props: unknown, ctx: { expose: () => void }) => SetupBindings }
  }

  const m = { exports: {} as Record<string, unknown> }
  return factory(deps, m.exports, m).default
}

describe('merge conflict dialog', () => {
  it('keeps the result editor mounted when comment validation rejects accept', () => {
    const mergeConflict = ref({
      tabId: 'tab-1',
      pathname: '/tmp/doc.md',
      filename: 'doc.md',
      baseMarkdown: 'base',
      localMarkdown: 'local',
      remoteMarkdown: 'remote',
      resultMarkdown: 'bad',
      conflicts: [],
      fileChange: {},
      validationError: ''
    })
    const setValue = vi.fn()
    const resultEditor = {
      getValue: () => 'bad',
      setValue
    }
    const accept = vi.fn(() => {
      mergeConflict.value = {
        ...mergeConflict.value,
        resultMarkdown: 'bad',
        validationError: 'The merge result introduces invalid MarkText comment syntax.'
      }
    })
    const component = loadComponent({
      _defineComponent: (o: unknown) => o,
      computed,
      nextTick: (fn?: () => void) => {
        fn?.()
        return Promise.resolve()
      },
      onBeforeUnmount: vi.fn(),
      ref,
      watch: vi.fn(),
      storeToRefs: () => ({
        mergeConflict,
        theme: ref('light')
      }),
      codeMirror: vi.fn(),
      useEditorStore: () => ({
        ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT: accept,
        CANCEL_DIRTY_EXTERNAL_MERGE_CONFLICT: vi.fn(),
        RELOAD_DISK_FROM_MERGE_CONFLICT: vi.fn(),
        RESOLVE_MERGE_CONFLICT_MARKER: vi.fn()
      }),
      usePreferencesStore: () => ({}),
      t: (key: string) => key
    })

    const ret = component.setup({}, { expose: vi.fn() })
    ret.resultEditor.value = resultEditor

    // The dialog is a global modal — it must say WHICH file it is resolving.
    expect(ret.dialogTitle.value).toContain('doc.md')

    ret.acceptMerge()

    expect(accept).toHaveBeenCalledWith('bad')
    expect(ret.resultEditor.value).not.toBeNull()
    expect(ret.resultEditor.value?.getValue()).toBe('bad')
    expect(setValue).toHaveBeenCalledWith('bad')
    expect(ret.validationError.value).toContain('invalid MarkText comment syntax')
    expect(ret.closingByAction.value).toBe(false)
  })

  it('maps the app theme to the same CodeMirror theme the source editor uses', () => {
    // 24 of the 25 dark themes are railscasts-family; only the literal 'dark'
    // check regressed the dialog to a light editor under all the others.
    const codeMirrorMock = vi.fn(() => ({}))
    const themeRef = ref('dracula')
    const component = loadComponent({
      _defineComponent: (o: unknown) => o,
      computed,
      nextTick: (fn?: () => void) => {
        fn?.()
        return Promise.resolve()
      },
      onBeforeUnmount: vi.fn(),
      ref,
      watch: vi.fn(),
      storeToRefs: () => ({
        mergeConflict: ref(null),
        theme: themeRef
      }),
      codeMirror: codeMirrorMock,
      codeMirrorThemeFor,
      useEditorStore: () => ({}),
      usePreferencesStore: () => ({}),
      t: (key: string) => key
    })

    const ret = component.setup({}, { expose: vi.fn() })
    const parent = {} as HTMLDivElement

    ret.createEditor(parent, 'text', true)
    expect(codeMirrorMock).toHaveBeenLastCalledWith(parent, expect.objectContaining({ theme: 'railscasts' }))

    themeRef.value = 'one-dark'
    ret.createEditor(parent, 'text', true)
    expect(codeMirrorMock).toHaveBeenLastCalledWith(parent, expect.objectContaining({ theme: 'one-dark' }))

    themeRef.value = 'light'
    ret.createEditor(parent, 'text', true)
    expect(codeMirrorMock).toHaveBeenLastCalledWith(parent, expect.objectContaining({ theme: 'default' }))
  })
})
