import { describe, expect, it, vi } from 'vitest'
import type {
  DocumentSelectionContext,
  IDocumentSelectionNode
} from '@marktext/document-view'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (value: string) => string }
      marktext?: { env: { windowId: number } }
      electron?: {
        clipboard: { writeText: (value: string) => void }
        ipcRenderer: {
          send: (...args: unknown[]) => void
          on: (...args: unknown[]) => void
        }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: value => value }
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

const { createApplicationMenuState } = await import('@/store/editor')

const node = (
  kind: IDocumentSelectionNode['kind'],
  attributes: Readonly<Record<string, string | number | boolean>> = {}
): IDocumentSelectionNode => ({
  key: `${kind}-${JSON.stringify(attributes)}`,
  kind,
  attributes,
  range: { start: 0, end: 1 }
})

const context = (
  blockPath: readonly IDocumentSelectionNode[],
  flags: Partial<DocumentSelectionContext['flags']> = {}
): DocumentSelectionContext => ({
  anchor: { offset: 0, path: blockPath },
  focus: { offset: 0, path: blockPath },
  selectedText: '',
  activeInlineFormats: [],
  blockPath,
  flags: {
    hasFrontMatter: false,
    isMultiblock: false,
    isCodeLike: false,
    isCodeBlock: false,
    isTable: false,
    isList: false,
    isTaskList: false,
    isLooseList: false,
    ...flags
  },
  cursor: null
})

describe('createApplicationMenuState', () => {
  it('publishes parser-owned code-like and table facts directly', () => {
    expect(createApplicationMenuState(context(
      [node('math-block')],
      { isCodeLike: true }
    ))).toMatchObject({
      activeBlockKinds: ['math-block'],
      isCodeLike: true,
      isCodeBlock: false,
      isTable: false
    })

    expect(createApplicationMenuState(context(
      [node('table'), node('table-cell')],
      { isTable: true }
    ))).toMatchObject({
      activeBlockKinds: ['table', 'table-cell'],
      isDisabled: true,
      isTable: true,
      isCodeLike: false
    })
  })

  it('retains every nested list kind from parser attributes', () => {
    const state = createApplicationMenuState(context([
      node('list', { ordered: true }),
      node('list-item'),
      node('list', { taskList: true }),
      node('list-item'),
      node('list', { ordered: false }),
      node('list-item'),
      node('paragraph')
    ], {
      isList: true,
      isTaskList: true
    }))

    expect(state).toMatchObject({
      isOrderedList: true,
      isTaskList: true,
      isUnorderedList: true
    })
  })

  it('distinguishes a top-level paragraph from one inside a container', () => {
    const bare = createApplicationMenuState(context([node('paragraph')]))
    const inList = createApplicationMenuState(context([
      node('list', { ordered: false }),
      node('list-item'),
      node('paragraph')
    ], { isList: true }))
    const inQuote = createApplicationMenuState(context([
      node('blockquote'),
      node('paragraph')
    ]))

    expect(bare.activeBlockKinds).toEqual(['paragraph'])
    expect(inList.activeBlockKinds).toEqual(['list', 'list-item', 'paragraph'])
    expect(inList.isUnorderedList).toBe(true)
    expect(inQuote.activeBlockKinds).toEqual(['blockquote', 'paragraph'])
  })

  it('derives the checked heading level from parser attributes', () => {
    const state = createApplicationMenuState(context([
      node('heading', { level: 3 }),
      node('text')
    ]))

    expect(state.headingLevel).toBe(3)
  })
})
