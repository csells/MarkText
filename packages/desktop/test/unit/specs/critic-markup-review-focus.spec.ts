import fs from 'node:fs'
import path from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, shallowRef, type App } from 'vue'

import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewItem,
  ICriticMarkupReviewSnapshot
} from '@muyajs/core'

// The controller publishes menu state through the preload IPC surface.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.electron ??= { ipcRenderer: { send: () => {} } }
})

import bus from '@/bus'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import { useCriticMarkupReviewController } from '@/components/editorWithTabs/useCriticMarkupReviewController'

const reviewItem = (id: string, offset: number): ICriticMarkupReviewItem => ({
  id,
  type: 'addition',
  path: [0, 'text'],
  start: offset,
  end: offset + 9,
  sourceStart: offset,
  sourceEnd: offset + 9,
  raw: '{++new++}',
  content: 'new'
})

const itemA = reviewItem('critic-a', 0)
const itemB = reviewItem('critic-b', 20)

const capabilities = {
  canCreateAddition: true,
  canCreateDeletion: true,
  canCreateSubstitution: true,
  canCreateHighlight: true,
  canCreateComment: true,
  canResolveCurrent: true,
  canResolveAll: true,
  trackChanges: true,
  projection: 'marked' as const
}

/**
 * Engine stand-in honoring the Review contract this flow relies on: a
 * resolution reseats the caret inside the editor (the engine's job — see the
 * muya resolve/`setCursor` path and its specs) and then publishes the next
 * snapshot, in that order. The desktop layer must ride that flow and never
 * touch DOM focus itself.
 */
class FakeReviewEngine {
  snapshot: ICriticMarkupReviewSnapshot = {
    ...capabilities,
    items: [itemA, itemB],
    currentItemId: itemA.id
  }

  caretReseatCount = 0

  private readonly listeners = new Set<(snapshot: ICriticMarkupReviewSnapshot) => void>()

  on = vi.fn((_event: string, listener: (snapshot: ICriticMarkupReviewSnapshot) => void) => {
    this.listeners.add(listener)
  })

  off = vi.fn((_event: string, listener: (snapshot: ICriticMarkupReviewSnapshot) => void) => {
    this.listeners.delete(listener)
  })

  getCriticMarkupReviewSnapshot = vi.fn(() => this.snapshot)

  resolveCriticMarkup = vi.fn((_decision: 'accept' | 'reject', _target?: { raw: string }) => {
    this.caretReseatCount += 1
    const remaining = this.snapshot.items.filter((item) => item !== itemA)
    this.snapshot = {
      ...this.snapshot,
      items: remaining,
      currentItemId: remaining[0]?.id ?? null
    }
    this.listeners.forEach((listener) => listener(this.snapshot))
    return true
  })

  createCriticMarkup = vi.fn(() => true)
  focusCriticMarkup = vi.fn(() => itemA)
  navigateCriticMarkup = vi.fn(() => itemA)
  resolveAllCriticMarkup = vi.fn(() => 0)
  editCriticMarkupComment = vi.fn(() => true)
  setOptions = vi.fn()
}

const mountController = (engine: FakeReviewEngine): App => {
  // One pinia serves both the controller (via app injection) and the
  // assertions below (via the active-pinia fallback).
  const pinia = createPinia()
  setActivePinia(pinia)
  const app = createApp(
    defineComponent({
      setup() {
        useCriticMarkupReviewController({
          editor: shallowRef(engine as unknown as ICriticMarkupReviewEditor),
          fileId: ref('file-1'),
          sourceCode: ref(false),
          requestText: async() => null,
          cancelTextRequest: () => {}
        })
        return () => h('div')
      }
    })
  )
  app.use(pinia)
  app.mount(document.createElement('div'))
  return app
}

// Flushes the controller's queued snapshot republish (queueMicrotask).
const flushMicrotasks = async(): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('CriticMarkup Review focus restoration (desktop flow)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('routes accept of the focused item through the caret-reseating engine resolve and follows its snapshot', async() => {
    const engine = new FakeReviewEngine()
    const app = mountController(engine)
    try {
      await flushMicrotasks()
      const store = useCriticMarkupReviewStore()
      expect(store.snapshot.currentItemId).toBe(itemA.id)

      bus.emit('critic-markup-review-item', {
        fileId: 'file-1',
        action: 'accept',
        target: itemA
      })
      await flushMicrotasks()

      expect(engine.resolveCriticMarkup).toHaveBeenCalledWith('accept', itemA)
      expect(engine.caretReseatCount).toBe(1)
      // The sidebar follows the engine's post-resolution focus; it never
      // fabricates its own current item.
      expect(store.snapshot.currentItemId).toBe(itemB.id)
      expect(store.snapshot.items).toEqual([itemB])
    } finally {
      app.unmount()
    }
  })

  it('keeps DOM focus in the editor across accept and reject — the desktop layer never grabs it', async() => {
    const engine = new FakeReviewEngine()
    // Stand-in for the focused contenteditable editor surface.
    const editorSurface = document.createElement('button')
    document.body.appendChild(editorSurface)
    editorSurface.focus()
    expect(document.activeElement).toBe(editorSurface)

    const app = mountController(engine)
    const elementFocus = vi.spyOn(HTMLElement.prototype, 'focus')
    const windowFocus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    try {
      await flushMicrotasks()

      // Sidebar pointer/keyboard path: accept the focused item by target.
      bus.emit('critic-markup-review-item', {
        fileId: 'file-1',
        action: 'accept',
        target: itemA
      })
      // Menu/keybinding path: reject the current (focused) item.
      bus.emit('critic-markup-review', 'reject-current')
      await flushMicrotasks()

      expect(engine.resolveCriticMarkup.mock.calls).toEqual([
        ['accept', itemA],
        ['reject']
      ])
      expect(elementFocus).not.toHaveBeenCalled()
      expect(windowFocus).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(editorSurface)
    } finally {
      app.unmount()
      elementFocus.mockRestore()
      windowFocus.mockRestore()
    }
  })

  it('routes a sidebar comment edit to the engine editCriticMarkupComment', async() => {
    const engine = new FakeReviewEngine()
    const app = mountController(engine)
    try {
      await flushMicrotasks()

      const target = { ...itemA, type: 'comment' as const, raw: '{>>old<<}', content: 'old' }
      bus.emit('critic-markup-comment-edit', { target, text: 'new note' })
      await flushMicrotasks()

      expect(engine.editCriticMarkupComment).toHaveBeenCalledWith(target, 'new note')
    } finally {
      app.unmount()
    }
  })

  it('has no DOM focus writes anywhere on the desktop Review resolution path', () => {
    const rendererRoot = path.resolve(__dirname, '../../../src/renderer/src')
    // The resolution surfaces (accept/reject/focus a review item, snapshot
    // publish, store) must never touch DOM focus — the engine reseats the caret
    // and the desktop layer rides that flow.
    const resolutionFiles = [
      'components/editorWithTabs/useCriticMarkupReviewController.ts',
      'components/editorWithTabs/criticMarkupReview.ts',
      'store/criticMarkupReview.ts'
    ]

    for (const file of resolutionFiles) {
      const source = fs.readFileSync(path.join(rendererRoot, file), 'utf8')
      expect(source, file).not.toMatch(/\.focus\(|autofocus/)
    }

    // The sidebar's ONLY DOM focus writes are its own compose and edit
    // textareas — composing or editing a comment is a deliberate focus move
    // into the sidebar. It never focuses the editor, and never uses a bare
    // autofocus.
    const review = fs.readFileSync(path.join(rendererRoot, 'components/sideBar/review.vue'), 'utf8')
    expect(review).not.toMatch(/autofocus/)
    const focusTargets = [...review.matchAll(/(\w+)\.value\?\.focus\(/g)].map(match => match[1])
    expect(focusTargets.length).toBeGreaterThan(0)
    expect(focusTargets.every(name => name === 'composeInput' || name === 'editInput')).toBe(true)

    // The sidebar only scrolls the focused card into view inside its own
    // pane; it must not scroll-jack or refocus the editor.
    expect(review).toContain("scrollIntoView({ block: 'nearest' })")
  })
})
