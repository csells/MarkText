import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'

// Compile the real SFC with its template, then mount using the real Vue runtime.
// The existing desktop unit runner does not install a Vue SFC transform plugin.
const loadComponent = (): Vue.Component => {
  const filename = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../src/renderer/src/components/editorWithTabs/CoreReviewCommentEditor.vue'
  )
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, {
    id: 'core-review-comment-editor',
    inlineTemplate: true
  })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: { default?: Vue.Component } = {}
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', js)((name: string) => {
    if (name !== 'vue') throw new Error(`Unexpected component dependency ${name}`)
    return Vue
  }, exports)
  if (exports.default === undefined) throw new Error('Comment component did not compile')
  return exports.default
}

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()))

const mountEditor = () => {
  const props = Vue.reactive({
    modelValue: true,
    targetId: 'comment:one',
    defaultText: 'Existing',
    submitting: false,
    error: '',
    textDirection: 'rtl'
  })
  const submit = vi.fn()
  const cancel = vi.fn()
  const component = loadComponent()
  const app = Vue.createApp({
    render: () =>
      Vue.h(component, {
        ...props,
        onSubmit: submit,
        onCancel: cancel,
        'onUpdate:modelValue': (value: boolean) => {
          props.modelValue = value
        }
      })
  })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  cleanup.push(() => {
    app.unmount()
    host.remove()
  })
  const textarea = (): HTMLTextAreaElement => {
    const element = host.querySelector('textarea')
    if (element === null) throw new Error('Comment textarea is not rendered')
    return element
  }
  const type = async(value: string): Promise<void> => {
    textarea().value = value
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
    await Vue.nextTick()
  }
  return { props, host, submit, cancel, textarea, type }
}

describe('Core Review comment composer', () => {
  it('returns keyboard focus after cancellation and successful closure, while failures retain the draft', async() => {
    const opener = document.createElement('button')
    document.body.append(opener)
    cleanup.push(() => opener.remove())
    opener.focus()
    const editor = mountEditor()
    await Vue.nextTick()
    await Vue.nextTick()
    expect(document.activeElement).toBe(editor.textarea())
    editor
      .textarea()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    await Vue.nextTick()
    await Vue.nextTick()
    expect(document.activeElement).toBe(opener)
    editor.props.modelValue = true
    await Vue.nextTick()
    await Vue.nextTick()
    await editor.type('Preserved')
    editor.props.submitting = true
    await Vue.nextTick()
    editor.props.submitting = false
    editor.props.error = 'Save failed'
    await Vue.nextTick()
    await Vue.nextTick()
    expect(editor.textarea().value).toBe('Preserved')
    expect(document.activeElement).toBe(editor.textarea())
    editor.props.error = ''
    editor.props.modelValue = false
    await Vue.nextTick()
    await Vue.nextTick()
    expect(document.activeElement).toBe(opener)
  })

  it('keeps mixed-direction text and does not submit or cancel an IME composition', async() => {
    const editor = mountEditor()
    await editor.type('ملاحظة (ABC 123).')
    expect(editor.textarea().getAttribute('dir')).toBe('rtl')
    for (const key of ['Enter', 'Escape']) {
      editor.textarea().dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          metaKey: true,
          isComposing: true,
          bubbles: true,
          cancelable: true
        })
      )
    }
    expect(editor.submit).not.toHaveBeenCalled()
    expect(editor.cancel).not.toHaveBeenCalled()
    expect(editor.textarea().value).toBe('ملاحظة (ABC 123).')
  })

  it('submits a multiline draft from the actual form and retains it after failure', async() => {
    const editor = mountEditor()
    await editor.type('First line\nSecond line')
    editor.host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(editor.submit).toHaveBeenCalledWith({
      targetId: 'comment:one',
      text: 'First line\nSecond line'
    })
    editor.props.submitting = true
    await Vue.nextTick()
    expect(editor.textarea().disabled).toBe(true)
    editor.props.submitting = false
    editor.props.error = 'The document changed. Try again.'
    await Vue.nextTick()
    expect(editor.textarea().value).toBe('First line\nSecond line')
    expect(editor.host.querySelector('[role="alert"]')?.textContent).toContain(
      'The document changed. Try again.'
    )
  })

  it('never silently retargets or discards a draft when review selection changes', async() => {
    const editor = mountEditor()
    await editor.type('Keep my draft')
    editor.props.targetId = 'comment:two'
    editor.props.defaultText = 'Other comment'
    await Vue.nextTick()
    expect(editor.textarea().value).toBe('Keep my draft')
    expect(editor.host.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(true)
    expect(editor.host.querySelector('[role="alert"]')?.textContent).toContain('selection changed')
    editor.host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(editor.submit).not.toHaveBeenCalled()
    editor.host
      .querySelector<HTMLButtonElement>('[data-testid="critic-review-comment-cancel"]')
      ?.click()
    await Vue.nextTick()
    expect(editor.cancel).toHaveBeenCalledWith({ targetId: 'comment:one', text: 'Keep my draft' })
    expect(editor.host.querySelector('textarea')).toBeNull()
    editor.props.modelValue = true
    await Vue.nextTick()
    expect(editor.textarea().value).toBe('Other comment')
    expect(editor.host.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(false)
  })

  it('uses Cmd/Ctrl+Enter to submit, keeps plain Enter multiline, and Escape cancels', async() => {
    const editor = mountEditor()
    await editor.type('Draft')
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    editor.textarea().dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(editor.submit).not.toHaveBeenCalled()
    editor
      .textarea()
      .dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true,
          cancelable: true
        })
      )
    expect(editor.submit).toHaveBeenCalledWith({ targetId: 'comment:one', text: 'Draft' })
    editor.props.submitting = true
    await Vue.nextTick()
    editor
      .textarea()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    expect(editor.cancel).not.toHaveBeenCalled()
    editor.props.submitting = false
    await Vue.nextTick()
    editor
      .textarea()
      .dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      )
    expect(editor.submit).toHaveBeenCalledTimes(2)
    editor
      .textarea()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    expect(editor.cancel).toHaveBeenCalledWith({ targetId: 'comment:one', text: 'Draft' })
  })
})
