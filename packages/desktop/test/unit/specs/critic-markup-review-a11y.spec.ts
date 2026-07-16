import fs from 'node:fs'
import path from 'node:path'
import { defineComponent, h } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  REVIEW_COMMAND_DESCRIPTORS,
  type ReviewCommandDescriptor
} from 'common/commands/review'
import { executeCriticMarkupReviewAction } from '@/components/editorWithTabs/criticMarkupReview'
import type {
  CriticMarkupSidebarItem,
  CriticMarkupSidebarState
} from '@shared/types/criticMarkup'
import { compileSfcRender, mountTemplate, type TemplateMount } from '../helpers/mountTemplate'

// ---------------------------------------------------------------------------
// Template AST helpers (same shape as critic-markup-review-architecture.spec)
// ---------------------------------------------------------------------------

interface TemplateNode {
  type: number
  tag?: string
  props?: Array<{
    type: number
    name: string
    value?: { content: string }
    arg?: { type: number; content?: string }
    exp?: { content?: string }
  }>
  children?: TemplateNode[]
}

const desktopRoot = path.resolve(__dirname, '../../..')
const reviewPath = path.join(desktopRoot, 'src/renderer/src/components/sideBar/review.vue')
const reviewSource = fs.readFileSync(reviewPath, 'utf8')

const walk = (node: TemplateNode, visit: (node: TemplateNode) => void): void => {
  visit(node)
  node.children?.forEach((child) => walk(child, visit))
}

const templateRoot = (): TemplateNode => {
  const root = parse(reviewSource).descriptor.template?.ast as TemplateNode | undefined
  if (!root) throw new Error('review.vue has no template AST')
  return root
}

const staticAttribute = (node: TemplateNode, name: string): string | undefined =>
  node.props?.find((prop) => prop.type === 6 && prop.name === name)?.value?.content

const directiveArgs = (node: TemplateNode, directive: string): string[] =>
  node.props
    ?.filter((prop) => prop.type === 7 && prop.name === directive)
    .map((prop) => prop.arg?.content ?? '') ?? []

// ---------------------------------------------------------------------------
// Rendered-DOM harness: the shipped template compiled to a real render
// function, mounted over stubbed script bindings. Keyboard activation of a
// native <button> dispatches `click` (a UA guarantee this spec pins by also
// proving click is the template's only activation binding), so `focus()` +
// `click()` is the keyboard path and a bubbling MouseEvent the pointer path.
// ---------------------------------------------------------------------------

const item = (
  overrides: Partial<CriticMarkupSidebarItem> &
    Pick<CriticMarkupSidebarItem, 'id' | 'type' | 'raw'>
): CriticMarkupSidebarItem => ({
  path: [0, 'text'],
  start: 0,
  end: overrides.raw.length,
  sourceStart: 0,
  sourceEnd: overrides.raw.length,
  ...overrides
})

const addition = item({ id: 'critic-add', type: 'addition', raw: '{++new++}', content: 'new' })
const substitution = item({
  id: 'critic-sub',
  type: 'substitution',
  raw: '{~~old~>new~~}',
  oldContent: 'old',
  newContent: 'new'
})
const comment = item({ id: 'critic-note', type: 'comment', raw: '{>>note<<}', content: 'note' })

const snapshot: CriticMarkupSidebarState = {
  fileId: 'file-1',
  available: true,
  items: [addition, substitution, comment],
  currentItemId: addition.id,
  trackChanges: true,
  projection: 'marked'
}

const reviewCommand = (action: string) => {
  const descriptor = REVIEW_COMMAND_DESCRIPTORS.find((candidate) => candidate.action === action)
  if (!descriptor) throw new TypeError(`Unknown Review action: ${action}`)
  return descriptor
}

const projectionOptions = REVIEW_COMMAND_DESCRIPTORS
  .filter((descriptor) => descriptor.group === 'projection')
  .map((descriptor) => {
    const metadata: ReviewCommandDescriptor = descriptor
    return {
      projection: metadata.projection,
      commandId: descriptor.id,
      label: metadata.menuLabelKey
    }
  })

// Minimal el-switch stand-in exposing the same focusable switch input the
// real Element Plus component renders inside the wrapping <label>.
const switchStub = defineComponent({
  // `size` is declared only to keep the template's fallthrough attribute off
  // the native input (where "small" is not a valid HTML size).
  props: {
    modelValue: { type: Boolean, default: false },
    disabled: Boolean,
    size: { type: String, default: '' }
  },
  emits: ['change'],
  setup: (props) => () =>
    h('input', { type: 'checkbox', role: 'switch', disabled: props.disabled })
})

const mounted: TemplateMount[] = []

const mountReview = (state: CriticMarkupSidebarState) => {
  const actOnItem = vi.fn()
  const selectProjection = vi.fn()
  const toggleTrackChanges = vi.fn()
  const render = compileSfcRender(reviewPath)
  const mount = mountTemplate(render, {
    t: (key: string) => key,
    snapshot: state,
    trackChangesCommand: reviewCommand('toggle-track-changes'),
    acceptCurrentCommand: reviewCommand('accept-current'),
    rejectCurrentCommand: reviewCommand('reject-current'),
    projectionOptions,
    typeLabel: (type: string) => `sideBar.review.types.${type}`,
    isChange: (type: string) => ['addition', 'deletion', 'substitution'].includes(type),
    actOnItem,
    selectProjection,
    toggleTrackChanges
  }, { 'el-switch': switchStub })
  mounted.push(mount)
  return { ...mount, actOnItem, selectProjection, toggleTrackChanges }
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex], [contenteditable]'

describe('Review sidebar keyboard-only traversal', () => {
  it('renders every interactive control as a natively focusable element in DOM order', () => {
    const { el } = mountReview(snapshot)
    const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))

    const signature = focusables.map((element) => {
      if (element.matches('input[role="switch"]')) return 'track-changes-switch'
      if (element.matches('.projection-picker button')) return 'projection'
      if (element.matches('button.review-card-focus')) return 'card-focus'
      if (element.matches('.card-actions button.accept')) return 'accept'
      if (element.matches('.card-actions button')) return 'card-action'
      return element.tagName.toLowerCase()
    })

    expect(signature).toEqual([
      'track-changes-switch',
      'projection', 'projection', 'projection',
      'card-focus', 'accept', 'card-action',
      'card-focus', 'accept', 'card-action',
      'card-focus', 'card-action'
    ])

    for (const element of focusables) {
      expect(element.hasAttribute('tabindex'), element.outerHTML).toBe(false)
    }
    expect(el.querySelector('[tabindex]')).toBeNull()
  })

  it('gives every control an accessible name and every group a localized label', () => {
    const { el } = mountReview(snapshot)

    for (const button of Array.from(el.querySelectorAll('button'))) {
      const name = button.textContent?.trim() || button.getAttribute('aria-label')
      expect(name, button.outerHTML).toBeTruthy()
    }

    const picker = el.querySelector('.projection-picker')
    expect(picker?.getAttribute('role')).toBe('group')
    expect(picker?.getAttribute('aria-label')).toBe('menu.review.display')

    const list = el.querySelector('.review-list')
    expect(list?.getAttribute('role')).toBe('group')
    expect(list?.getAttribute('aria-label')).toBe('sideBar.review.title')

    // The Track Changes switch takes its accessible name from the wrapping
    // <label> text (label association with the switch input).
    const trackChanges = el.querySelector('label.track-changes')
    expect(trackChanges?.textContent).toContain('sideBar.review.trackChanges')
  })

  it('exposes pressed state on projection toggles and current state on the active card', () => {
    const { el } = mountReview(snapshot)

    const pressed = Array.from(el.querySelectorAll('.projection-picker button'))
      .map((button) => button.getAttribute('aria-pressed'))
    expect(pressed).toEqual(['true', 'false', 'false'])

    const current = Array.from(el.querySelectorAll('.review-card'))
      .map((card) => card.getAttribute('aria-current'))
    expect(current).toEqual(['true', null, null])
  })

  it('nests no interactive element inside another interactive element', () => {
    const { el } = mountReview(snapshot)

    for (const button of Array.from(el.querySelectorAll('button'))) {
      expect(button.querySelector(FOCUSABLE), button.outerHTML).toBeNull()
    }
  })

  it('invokes the same handler for keyboard activation and pointer clicks', () => {
    const { el, actOnItem, selectProjection } = mountReview(snapshot)
    const keyboardActivate = (element: HTMLElement) => {
      element.focus()
      expect(document.activeElement).toBe(element)
      element.click()
    }
    const pointerActivate = (element: HTMLElement) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    const cards = Array.from(el.querySelectorAll<HTMLElement>('.review-card'))
    const focusButton = cards[0].querySelector<HTMLElement>('button.review-card-focus')
    const acceptButton = cards[0].querySelector<HTMLElement>('.card-actions button.accept')
    const rejectButton = cards[0].querySelector<HTMLElement>(
      '.card-actions button:not(.accept)'
    )
    const removeButton = cards[2].querySelector<HTMLElement>('.card-actions button')
    const originalProjection = el.querySelectorAll<HTMLElement>('.projection-picker button')[1]
    if (!focusButton || !acceptButton || !rejectButton || !removeButton || !originalProjection) {
      throw new Error('Review sidebar controls are missing from the rendered template')
    }

    for (const activate of [keyboardActivate, pointerActivate]) {
      actOnItem.mockClear()
      selectProjection.mockClear()

      activate(focusButton)
      activate(acceptButton)
      activate(rejectButton)
      activate(removeButton)
      activate(originalProjection)

      expect(actOnItem.mock.calls).toEqual([
        ['focus', addition],
        ['accept', addition],
        ['reject', addition],
        ['remove-annotation', comment]
      ])
      // Identity, not just deep equality: the exact snapshot item flows into
      // the action, so the store resolves the same engine target either way.
      expect(actOnItem.mock.calls[0][1]).toBe(addition)
      expect(selectProjection.mock.calls).toEqual([['review.show-original']])
    }
  })

  it('keeps activation click-driven — no key/mouse interception or positive tabindex', () => {
    const root = templateRoot()
    const eventNames: string[] = []
    walk(root, (node) => {
      eventNames.push(...directiveArgs(node, 'on'))

      const boundNames = directiveArgs(node, 'bind')
      expect(boundNames, node.tag ?? '').not.toContain('tabindex')
      expect(staticAttribute(node, 'tabindex'), node.tag ?? '').toBeUndefined()

      if (node.tag === 'button') {
        expect(staticAttribute(node, 'type')).toBe('button')
      }
    })

    expect(eventNames.length).toBeGreaterThan(0)
    expect([...new Set(eventNames)].sort()).toEqual(['change', 'click'])
  })

  it('routes card activation into the shared sidebar action bus event', () => {
    // The template hands actOnItem the action + item (proven above); the
    // script forwards exactly that pair with the active file to the bus,
    // where the Review controller executes the engine command.
    expect(reviewSource).toMatch(
      /bus\.emit\('critic-markup-review-item',\s*\{ fileId, action, target \}\)/
    )
    expect(reviewSource).not.toMatch(/\.focus\(/)
  })

  it('drives previous/next/accept/reject through one engine command for keyboard and pointer sources', async() => {
    // Menu accelerators (keyboard) and menu/sidebar clicks dispatch the same
    // command ids (critic-markup-review.spec.ts); this pins the shared
    // executor those ids land in, so both input modalities end in the same
    // native engine call.
    const engine = {
      createCriticMarkup: vi.fn(() => true),
      focusCriticMarkup: vi.fn(() => null),
      navigateCriticMarkup: vi.fn(() => null),
      resolveCriticMarkup: vi.fn(() => true),
      resolveAllCriticMarkup: vi.fn(() => 0),
      getCriticMarkupReviewSnapshot: vi.fn(),
      setOptions: vi.fn()
    }

    await executeCriticMarkupReviewAction(engine as never, 'previous')
    await executeCriticMarkupReviewAction(engine as never, 'next')
    await executeCriticMarkupReviewAction(engine as never, 'accept-current')
    await executeCriticMarkupReviewAction(engine as never, 'reject-current')

    expect(engine.navigateCriticMarkup.mock.calls).toEqual([['previous'], ['next']])
    expect(engine.resolveCriticMarkup.mock.calls).toEqual([['accept'], ['reject']])
  })
})
