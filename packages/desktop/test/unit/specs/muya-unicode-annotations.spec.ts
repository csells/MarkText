// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Unicode inside annotations through the bound Muya view. Delete removes one
// grapheme. Backspace removes what upstream MarkText removes: inside a line of
// text, Chromium's backspace unit, which is one code point of a combining
// sequence but a whole emoji, flag or astral character; at the end or after
// the first grapheme of a top-level text run, upstream Muya's whole grapheme.
// The saved source never splits a surrogate pair.

type BoundMuya = ReturnType<typeof bootBoundMuya>

// Each sample with what Chromium's Backspace after it leaves of it.
const samples = [
  ['ZWJ family', '\u{1F469}\u200D\u{1F469}\u200D\u{1F467}', ''],
  ['regional-indicator flag', '\u{1F1EF}\u{1F1F5}', ''],
  ['combining acute', 'e\u0301', 'e'],
  ['decomposed Hangul syllable', '\u1100\u1161\u11A8', '\u1100\u1161'],
  ['astral letter', '\u{1D4B3}', ''],
  ['astral emoji', '\u{1F600}', ''],
  ['Hebrew word', '\u05E9\u05DC\u05D5\u05DD', '\u05E9\u05DC\u05D5'],
  ['Arabic word', '\u0633\u0644\u0627\u0645', '\u0633\u0644\u0627']
] as const

const content = (app: BoundMuya) => {
  const block = app.muya.editor.scrollPage?.firstContentInDescendant()
  if (block == null || !block.isContent()) throw new Error('Expected content leaf')
  return block
}

const dispatchInput = ({ muya }: BoundMuya, inputType: string, data: string | null): void => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
}

const press = ({ muya }: BoundMuya, key: string) => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  muya.flush()
}

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

/** Places the caret at the visible-text offset `|` marks in `marked`. */
const withCaret = async(marked: string, tracked: boolean, act: (app: BoundMuya) => Promise<void> | void) => {
  const caretSource = marked.replace('|', '')
  const app = bootBoundMuya(caretSource)
  try {
    app.track(tracked)
    const block = content(app)
    const visible = marked.split('\n')[0]!.replace(/\{\+\+|\+\+\}|\{--|--\}|\{==|==\}|\{>>[^<]*<<\}/g, '')
    const offset = visible.indexOf('|')
    block.setCursor(offset, offset, true)
    await act(app)
    await app.adapter.settled()
    return source(app)
  } finally {
    app.dispose()
  }
}

describe.each(samples)('%s inside annotations in the bound editor', (_label, text, backspaced) => {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
  const last = graphemes.at(-1)!.segment
  const first = graphemes[0]!.segment
  const withoutLast = text.slice(0, -last.length)
  const withoutFirst = text.slice(first.length)
  const removed = text.slice(backspaced.length)
  const backspace = (app: BoundMuya) => dispatchInput(app, 'deleteContentBackward', null)

  it('Backspace at the end of an Addition inside a line removes the browser\'s backspace unit', async() => {
    for (const tracked of [false, true]) {
      expect(await withCaret(`a{++b${text}|++}c\n`, tracked, backspace)).toBe(`a{++b${backspaced}++}c\n`)
      // Upstream reads the closing delimiter as text, so this caret is not at its text run's end.
      expect(await withCaret(`a{++b${text}|++}\n`, tracked, backspace)).toBe(`a{++b${backspaced}++}\n`)
    }
  })

  it('Backspace at the edges of a text run removes the whole grapheme, as upstream Muya does', async() => {
    expect(await withCaret(`a${text}|\n`, false, backspace)).toBe(`a${withoutLast}\n`)
    expect(await withCaret(`${first}|b\n`, false, backspace)).toBe('b\n')
    expect(await withCaret(`a${text}|**b**\n`, false, backspace)).toBe(`a${withoutLast}**b**\n`)
    expect(await withCaret(`{++a++}${text}|\n`, true, backspace)).toBe(`{++a++}${withoutLast}{--${last}--}\n`)
  })

  it('Delete at the start of an Addition removes one grapheme', async() => {
    for (const tracked of [false, true]) {
      expect(await withCaret(`a{++|${text}b++}c\n`, tracked, app => dispatchInput(app, 'deleteContentForward', null)))
        .toBe(`a{++${withoutFirst}b++}c\n`)
    }
  })

  it('tracked Backspace inside a line suggests deleting the browser\'s backspace unit', async() => {
    expect(await withCaret(`{++a++}${text}|c\n`, true, backspace)).toBe(`{++a++}${backspaced}{--${removed}--}c\n`)
    expect(await withCaret(`{++a++}${text}|c\n`, false, backspace)).toBe(`{++a++}${backspaced}c\n`)
  })

  it('types the text beside a Highlight as its own suggestion', async() => {
    expect(await withCaret('a{==b==}{>>n<<}|c\n', true, app => dispatchInput(app, 'insertText', text)))
      .toBe(`a{==b==}{>>n<<}{++${text}++}c\n`)
  })

  it('types after the text inside an Addition and keeps editing that Addition', async() => {
    expect(await withCaret(`a{++${text}|++}c\n`, true, app => dispatchInput(app, 'insertText', 'Z')))
      .toBe(`a{++${text}Z++}c\n`)
  })

  it('enters a leading Addition with ArrowRight before its first grapheme', async() => {
    const app = bootBoundMuya(`{++${text}++} tail\n`)
    try {
      content(app).setCursor(0, 0, true)
      press(app, 'ArrowRight')
      dispatchInput(app, 'insertText', 'y')
      await app.adapter.settled()
      expect(source(app)).toBe(`{++y${text}++} tail\n`)
    } finally {
      app.dispose()
    }
  })

  it('authors a Comment over the selected text and removes it', async() => {
    const app = bootBoundMuya(`a${text}c\n`)
    try {
      const block = content(app)
      await app.adapter.author(
        'comment',
        { anchor: { path: block.path, offset: 1 }, focus: { path: block.path, offset: 1 + text.length } },
        `${text} note`,
        app.reconcile
      )
      const commented = `a{==${text}==}{>>${text} note<<}c\n`
      expect(source(app)).toBe(commented)
      const current = app.binding.sourceAtBarrier()
      if (current.type !== 'source') throw new Error('Expected source')
      const commentStart = commented.indexOf('{>>')
      await app.adapter.resolve(
        {
          kind: 'commented-span',
          range: { start: 1, end: commented.indexOf('<<}') + 3 },
          highlightRange: { start: 1, end: commentStart },
          commentRange: { start: commentStart, end: commented.indexOf('<<}') + 3 }
        },
        current.revision,
        'remove',
        app.reconcile
      )
      expect(source(app)).toBe(`a${text}c\n`)
    } finally {
      app.dispose()
    }
  })

  it('accepts and rejects a Substitution between graphemes', async() => {
    for (const [decision, expected] of [['accept', `a${text}c\n`], ['reject', 'a😀c\n']] as const) {
      const app = bootBoundMuya(`a{~~😀~>${text}~~}c\n`)
      try {
        await app.adapter.resolveAll(decision, app.reconcile)
        expect(source(app)).toBe(expected)
      } finally {
        app.dispose()
      }
    }
  })
})
