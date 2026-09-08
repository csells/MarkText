import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'

const loadComponent = (): Vue.Component => {
  const filename = resolve('src/renderer/src/components/editorWithTabs/CoreRecoveryDrafts.vue')
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'recovery-drafts', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: { default?: Vue.Component } = {}
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', js)((name: string) => {
    if (name === 'vue') return Vue
    if (name === 'vue-i18n') return { useI18n: () => ({ t: (key: string) => key }) }
    throw new Error(`Unexpected recovery component dependency ${name}`)
  }, exports)
  if (!exports.default) throw new Error('Recovery component did not compile')
  return exports.default
}

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()))

describe('recovery draft presentation', () => {
  it('updates pending and backed-up text direction without changing draft text or shell direction', async() => {
    const text = 'مرحبا (ABC 123).\nשלום!'
    const props = Vue.reactive({
      textDirection: 'rtl',
      pendingText: text,
      error: 'Backup unavailable',
      drafts: [{ id: 'draft-one', documentId: 'document-one', visibleText: text }]
    })
    const host = document.createElement('div')
    host.dir = 'ltr'
    document.body.append(host)
    const component = loadComponent()
    const app = Vue.createApp({ render: () => Vue.h(component, props) })
    app.mount(host)
    cleanup.push(() => {
      app.unmount()
      host.remove()
    })
    const inputs = [...host.querySelectorAll('textarea')]
    expect(inputs).toHaveLength(2)
    expect(inputs.map((input) => input.dir)).toEqual(['rtl', 'rtl'])
    expect(host.querySelector('section')?.hasAttribute('dir')).toBe(false)
    expect(inputs.map((input) => input.value)).toEqual([text, text])
    props.textDirection = 'ltr'
    await Vue.nextTick()
    expect(inputs.map((input) => input.dir)).toEqual(['ltr', 'ltr'])
    expect(inputs.every((input) => input.readOnly)).toBe(true)
    expect(inputs.map((input) => input.value)).toEqual([text, text])
  })
})
