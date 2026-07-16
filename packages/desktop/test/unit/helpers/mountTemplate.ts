import fs from 'node:fs'
import * as Vue from 'vue'
import { compileTemplate, parse } from 'vue/compiler-sfc'

/** Render function produced by the template compiler (called by Vue itself). */
export type CompiledRender = (...args: unknown[]) => unknown

export interface TemplateMount {
  el: HTMLElement
  unmount: () => void
}

/**
 * Compiles a single-file component's `<template>` block to a real render
 * function.
 *
 * The desktop unit suite has no SFC transform (no `@vitejs/plugin-vue` and no
 * `@vue/test-utils`), so component specs historically asserted against the
 * template AST only. Compiling the shipped template and rendering it over
 * stubbed script bindings lets a spec drive the actual DOM the component
 * produces — keyboard activation, ARIA attributes, traversal order — while
 * the `<script setup>` logic keeps its own dedicated unit coverage.
 */
export function compileSfcRender(filePath: string): CompiledRender {
  const source = fs.readFileSync(filePath, 'utf8')
  const { descriptor, errors } = parse(source, { filename: filePath })
  if (errors.length > 0) {
    throw new Error(errors.map((error) => String(error)).join('\n'))
  }
  const block = descriptor.template
  if (!block) throw new Error(`${filePath} has no <template> block`)

  const compiled = compileTemplate({
    source: block.content,
    filename: filePath,
    id: 'spec-template'
  })
  if (compiled.errors.length > 0) {
    throw new Error(compiled.errors.map((error) => String(error)).join('\n'))
  }

  // The compiler emits an ES module (`import { … } from "vue"` plus
  // `export function render`). Rewrite it into a plain function body that
  // receives the Vue namespace as a parameter so it can be evaluated here.
  const body = compiled.code
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*(['"])vue\2;?/g,
      (_match, names: string) => `const {${names.replace(/\s+as\s+/g, ': ')}} = Vue;`
    )
    .replace(/\bexport\s+/g, '')

  // Evaluates the template compiler's own output for a repo-local file;
  // there is no SFC transform in this suite to do it at import time.
  // eslint-disable-next-line no-new-func
  return new Function('Vue', `${body}\nreturn render;`)(Vue) as CompiledRender
}

/**
 * Mounts a compiled template over caller-provided script bindings. Extra
 * component stubs (e.g. `el-switch`) can be registered by name.
 */
export function mountTemplate(
  render: CompiledRender,
  bindings: Record<string, unknown>,
  components: Record<string, Vue.Component> = {}
): TemplateMount {
  const host = Vue.defineComponent({
    setup: () => bindings,
    render
  })
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = Vue.createApp(host)
  for (const [name, component] of Object.entries(components)) {
    app.component(name, component)
  }
  app.mount(el)
  return {
    el,
    unmount: () => {
      app.unmount()
      el.remove()
    }
  }
}
