import { describe, expect, it } from 'vitest'
import {
  decodeDocumentClipboardMenuState,
  decodeDocumentFormatMenuState,
  decodeDocumentSelectionMenuState,
  decodeSidebarMenuVisibility,
  decodeWindowLayoutMenuState
} from 'main_renderer/menu/menuStateRuntimeCodec'

const formatState = {
  strong: true,
  em: false,
  u: false,
  sup: false,
  sub: false,
  mark: false,
  inline_code: false,
  inline_math: false,
  del: false,
  link: false,
  image: false
}

const selectionState = {
  activeBlockKinds: ['paragraph'],
  headingLevel: null,
  isDisabled: false,
  isMultiblock: false,
  isLooseList: false,
  isTaskList: false,
  isOrderedList: false,
  isUnorderedList: false,
  isCodeLike: false,
  isCodeBlock: false,
  isTable: false,
  hasFrontMatter: false
}

describe('closed native-menu state codecs', () => {
  it('decodes bounded format, selection, layout, and boolean states', () => {
    expect(decodeDocumentFormatMenuState(formatState)).toEqual(formatState)
    expect(decodeDocumentSelectionMenuState(selectionState))
      .toEqual(selectionState)
    expect(decodeWindowLayoutMenuState({
      showSideBar: true,
      sourceCode: false
    })).toEqual({
      showSideBar: true,
      sourceCode: false
    })
    expect(decodeSidebarMenuVisibility(true)).toBe(true)
    expect(decodeDocumentClipboardMenuState({
      surface: 'revised',
      hasSelection: true
    })).toEqual({
      surface: 'revised',
      hasSelection: true
    })
  })

  it.each([
    { ...formatState, executablePath: '/tmp/attacker' },
    { ...formatState, strong: 1 },
    { ...selectionState, windowId: 9 },
    { ...selectionState, activeBlockKinds: ['process'] },
    { ...selectionState, activeBlockKinds: Array(65).fill('paragraph') },
    { showSideBar: true, root: '/tmp' },
    { showSideBar: 'yes' },
    { surface: 'revised', hasSelection: true, windowId: 9 },
    { surface: 'preview', hasSelection: true },
    {},
    null
  ])('rejects open, wrong, or unbounded menu state %#', value => {
    const attempts = [
      () => decodeDocumentFormatMenuState(value),
      () => decodeDocumentSelectionMenuState(value),
      () => decodeWindowLayoutMenuState(value)
    ]
    expect(attempts.some(attempt => {
      try {
        attempt()
        return true
      } catch {
        return false
      }
    })).toBe(false)
  })

  it.each([0, 1, 'true', {}, null, undefined])(
    'rejects non-boolean scalar state %#',
    value => {
      expect(() => decodeSidebarMenuVisibility(value)).toThrow()
    }
  )
})
