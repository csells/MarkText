import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import { createDocumentCore } from '@marktext/document-core'

import * as projectionRenderer from '@/documentConsumers/markdownProjectionHtml'

const loadComponent = (): Vue.Component => {
  const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/renderer/src/components/editorWithTabs/CoreDocumentProjection.vue')
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'core-document-projection', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: { default?: Vue.Component } = {}
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', js)((name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/documentConsumers/markdownProjectionHtml') return projectionRenderer
    throw new Error(`Unexpected projection component dependency ${name}`)
  }, exports)
  if (exports.default === undefined) throw new Error('Projection component did not compile')
  return exports.default
}

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).forEach(dispose => dispose()))

describe('Core read-only projection component', () => {
  it('updates real rendered Original and Revised views without making document content editable', async() => {
    const core = createDocumentCore()
    const revision = core.open('## Review\n\n{~~**old**~>*new*~~} {--gone--}')
    const props = Vue.reactive({ projection: { ast: core.project(revision, 'original').ast }, kind: 'original', label: 'Original' })
    const component = loadComponent()
    const host = document.createElement('div')
    document.body.append(host)
    const app = Vue.createApp({ render: () => Vue.h(component, props) })
    app.mount(host)
    cleanup.push(() => { app.unmount(); host.remove() })

    expect(host.querySelector('h2')?.textContent).toBe('Review')
    expect(host.querySelector('strong')?.textContent).toBe('old')
    expect(host.textContent).toContain('gone')
    expect(host.querySelector('[data-projection="original"]')?.getAttribute('aria-label')).toBe('Original')
    expect(host.querySelector('[contenteditable]')?.getAttribute('contenteditable')).toBe('false')
    expect(host.querySelector('textarea, input:not([disabled])')).toBeNull()

    props.kind = 'revised'
    props.label = 'Revised'
    props.projection = { ast: core.project(revision, 'revised').ast }
    await Vue.nextTick()
    expect(host.querySelector('em')?.textContent).toBe('new')
    expect(host.querySelector('strong')).toBeNull()
    expect(host.textContent).not.toContain('gone')
    expect(host.querySelector('[data-projection="revised"]')?.getAttribute('aria-label')).toBe('Revised')
  })

  it('renders an isolated multiline Comment safely through the same mounted component', () => {
    const core = createDocumentCore()
    const revision = core.open('{>>## Comment\n\n- **first**\n- [bad](javascript:alert(1))\n\n<script>window.pwned=true</script>\n<<}')
    const comment = revision.annotations[0]
    const projection = { ast: core.projectComment(revision, comment).ast }
    const component = loadComponent()
    const host = document.createElement('div')
    document.body.append(host)
    const app = Vue.createApp({ render: () => Vue.h(component, { projection, kind: 'comment', label: 'Comment' }) })
    app.mount(host)
    cleanup.push(() => { app.unmount(); host.remove() })

    expect(host.querySelector('h2')?.textContent).toBe('Comment')
    expect(host.querySelectorAll('li')).toHaveLength(2)
    expect(host.querySelector('strong')?.textContent).toBe('first')
    expect(host.querySelector('script, [onclick], [onerror]')).toBeNull()
    expect(host.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(host.querySelector('[data-projection="comment"]')?.getAttribute('contenteditable')).toBe('false')
  })
})
