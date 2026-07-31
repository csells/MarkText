import { describe, expect, it, vi } from 'vitest'
import {
  heading1,
  orderedList,
  paragraph,
  table
} from 'main_renderer/menu/actions/paragraph'

describe('paragraph menu actions', () => {
  it('sends the same command ids used by the command palette', () => {
    const send = vi.fn()
    const win = { webContents: { send } }

    heading1(win as never)
    orderedList(win as never)
    paragraph(win as never)
    table(win as never)

    expect(send.mock.calls).toEqual([
      ['mt::editor-command', 'heading-1'],
      ['mt::editor-command', 'ordered-list'],
      ['mt::editor-command', 'paragraph'],
      ['mt::editor-command', 'insert-table']
    ])
  })
})
