import { describe, expect, it } from 'vitest'
import {
  decodeBufferedState,
  decodeWindowUiCheckpointIntent
} from '@shared/types/bufferedState'

const valid = () => ({
  schema: 'document-core-window-ui-1',
  currentDocumentId: 'document:1',
  tabs: [{
    documentId: 'document:1',
    scrollTop: 42
  }],
  project: {
    rootDirectory: '/tmp/project'
  },
  layout: {
    rightColumn: 'files',
    showSideBar: true,
    showTabBar: true,
    sideBarWidth: 280
  }
})

describe('window UI state codec', () => {
  it('admits the exact source-free presentation record', () => {
    expect(decodeBufferedState(valid())).toEqual(valid())
  })

  it.each([
    ['document source', { markdown: 'forged' }],
    ['file state', { isSaved: true }],
    ['parser state', { parseConfiguration: {} }],
    ['durability state', { durabilityKey: 'forged' }]
  ])('rejects a tab carrying %s', (_label, extra) => {
    const value = valid()
    value.tabs[0] = { ...value.tabs[0], ...extra }
    expect(() => decodeBufferedState(value)).toThrow(/closed/)
  })

  it('rejects duplicate identities and a current identity outside the tab set', () => {
    const duplicate = valid()
    duplicate.tabs.push({ ...duplicate.tabs[0] })
    expect(() => decodeBufferedState(duplicate)).toThrow(/duplicate/i)

    const missingCurrent = valid()
    missingCurrent.currentDocumentId = 'document:other'
    expect(() => decodeBufferedState(missingCurrent)).toThrow(/current/i)
  })

  it('rejects extra top-level, project, and layout fields', () => {
    expect(() => decodeBufferedState({
      ...valid(),
      source: 'forged'
    })).toThrow(/closed/)
    expect(() => decodeBufferedState({
      ...valid(),
      project: {
        ...valid().project,
        markdown: 'forged'
      }
    })).toThrow(/closed/)
    expect(() => decodeBufferedState({
      ...valid(),
      layout: {
        ...valid().layout,
        arbitrary: true
      }
    })).toThrow(/closed/)
  })
})

describe('renderer window UI checkpoint intent codec', () => {
  const validIntent = () => ({
    schema: 'document-core-window-ui-intent-1',
    currentDocumentId: 'document:1',
    tabs: [{
      documentId: 'document:1',
      scrollTop: 42
    }],
    layout: {
      rightColumn: 'files',
      showSideBar: true,
      showTabBar: true,
      sideBarWidth: 280
    }
  })

  it('admits presentation fields without a renderer-authored project root', () => {
    expect(decodeWindowUiCheckpointIntent(validIntent()))
      .toEqual(validIntent())
  })

  it('rejects a renderer attempt to contribute project identity', () => {
    expect(() => decodeWindowUiCheckpointIntent({
      ...validIntent(),
      project: {
        rootDirectory: '/forged/project'
      }
    })).toThrow(/closed/)
  })

  it('rejects duplicate and unselected document references', () => {
    const duplicate = validIntent()
    duplicate.tabs.push({ ...duplicate.tabs[0] })
    expect(() => decodeWindowUiCheckpointIntent(duplicate))
      .toThrow(/duplicate/i)

    expect(() => decodeWindowUiCheckpointIntent({
      ...validIntent(),
      currentDocumentId: 'document:forged'
    })).toThrow(/current/i)
  })
})
