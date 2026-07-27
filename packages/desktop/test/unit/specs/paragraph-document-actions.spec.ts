import { describe, expect, it, vi } from 'vitest'
import {
  heading1,
  orderedList,
  paragraph,
  table
} from 'main_renderer/menu/actions/paragraph'

describe('paragraph document actions', () => {
  it('sends the same closed semantic payloads used by the command palette', () => {
    const send = vi.fn()
    const win = { webContents: { send } }

    heading1(win as never)
    orderedList(win as never)
    paragraph(win as never)
    table(win as never)

    expect(send.mock.calls).toEqual([
      ['mt::editor-paragraph-action', {
        kind: 'convert-block',
        conversion: { kind: 'heading', level: 1 }
      }],
      ['mt::editor-paragraph-action', {
        kind: 'convert-block',
        conversion: { kind: 'ordered-list' }
      }],
      ['mt::editor-paragraph-action', {
        kind: 'convert-block',
        conversion: { kind: 'paragraph' }
      }],
      ['mt::editor-paragraph-action', { kind: 'request-table' }]
    ])
  })
})
