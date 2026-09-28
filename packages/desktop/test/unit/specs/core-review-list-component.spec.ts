import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import { createDocumentCore } from '@marktext/document-core'

import * as projectionRenderer from '@/documentConsumers/markdownProjectionHtml'
import { createReviewOverviewTracker } from '@/documentAuthority/coreReviewOverview'
import type { CoreReviewOverviewEntry } from '@/documentAuthority/coreProtocol'

// Plan 0012 G35: refreshing the Review overview after an edit renders only
// the entries the edit changed; every other card keeps its element.

const loadComponent = (): Vue.Component => {
  const filename = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../src/renderer/src/components/editorWithTabs/CoreReviewList.vue'
  )
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'core-review-list', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: { default?: Vue.Component } = {}
  const projection = Vue.defineComponent({ render: () => Vue.h('div', { class: 'comment-stub' }) })
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', js)((name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/i18n') return { t: (key: string) => key }
    if (name === '../../documentConsumers/markdownProjectionHtml') return projectionRenderer
    if (name === './CoreDocumentProjection.vue') return { default: projection }
    throw new Error(`Unexpected review list dependency ${name}`)
  }, exports)
  if (exports.default === undefined) throw new Error('Review list component did not compile')
  return exports.default
}

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()))

describe('Core review list', () => {
  it('keeps unchanged cards and selects a kept card at its entry’s current position', async() => {
    const paragraph = 'Text {++added++} and {==marked==}{>>note<<} here.'
    const core = createDocumentCore()
    let revision = core.open(['Opening.', paragraph, paragraph, paragraph].join('\n\n') + '\n')
    const tracker = createReviewOverviewTracker()
    const state = Vue.shallowReactive({ entries: tracker.overview(core, revision) as readonly CoreReviewOverviewEntry[] })
    const selected: number[] = []
    const List = loadComponent()
    const host = document.createElement('div')
    document.body.append(host)
    const app = Vue.createApp({
      render: () => Vue.h(List, {
        entries: state.entries,
        busy: false,
        textDirection: 'ltr',
        onSelect: (start: number) => selected.push(start)
      })
    })
    app.mount(host)
    cleanup.push(() => {
      app.unmount()
      host.remove()
    })
    const cards = () => [...host.querySelectorAll<HTMLElement>('[data-testid="critic-review-entry"]')]
    const before = cards()
    expect(before).toHaveLength(6)

    // Typing in the opening paragraph moves every entry but changes none.
    const commit = core.apply(revision, [{ start: 3, end: 3, insert: 'xyz' }], { projections: ['markup'] })
    tracker.committed(revision, commit.revision, commit.change)
    revision = commit.revision
    state.entries = tracker.overview(core, revision)
    await Vue.nextTick()
    const after = cards()
    expect(after).toHaveLength(6)
    after.forEach((card, index) => expect(card).toBe(before[index]))

    after[2]?.querySelector('button')?.click()
    expect(selected).toEqual([state.entries[2]?.item.range.start])
    const second = revision.source.indexOf(paragraph, revision.source.indexOf(paragraph) + 1)
    expect(selected[0]).toBe(second + 'Text '.length)
  })
})
