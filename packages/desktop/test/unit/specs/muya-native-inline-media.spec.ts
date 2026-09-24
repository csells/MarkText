// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { Muya } from '@muyajs/core'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { muyaClipboardSelection } from '@/documentAuthority/muyaModelSelection'

it.each([false, true])(
  'renders and edits native inline math without losing source or review (annotated=%s)',
  async(annotated) => {
    const source = annotated ? 'before {++$x^2$++} after\n' : 'before $x^2$ after\n'
    const edited = annotated ? 'before {++$y$++} after\n' : 'before $y$ after\n'
    const app = bootBoundMuya(source)
    try {
      const content = app.muya.editor.scrollPage!.firstContentInDescendant()!
      content.setCursor(0, 0, true)
      const preview = content.domNode!.querySelector('.mu-math-render') as HTMLElement | null
      expect(preview?.querySelector('.katex')).not.toBeNull()
      expect(preview).not.toBeNull()
      expect(content.domNode!.querySelector('.mu-hide.mu-math')).not.toBeNull()
      if (annotated) expect(preview?.closest('[data-critic-kind="addition"]')).not.toBeNull()
      preview!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: 8 },
        focus: { offset: 11 }
      })
      expect(content.domNode!.querySelector('.mu-math:not(.mu-hide)')).not.toBeNull()
      content.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'y',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: edited })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: edited })
    } finally {
      app.dispose()
    }
  }
)

it('preserves native inline HTML attribute policy in standalone and common-model editors', () => {
  const source =
    'before <kbd title="A &amp; B" onclick="alert(1)">key</kbd> and <a href="javascript:alert(1)">link</a> after\n'
  const app = bootBoundMuya(source)
  const host = document.body.appendChild(document.createElement('div'))
  const native = new Muya(host)
  native.init()
  native.setContent(source)
  try {
    for (const muya of [app.muya, native]) {
      const root = muya.domNode
      expect(root.querySelector('kbd')?.textContent).toBe('key')
      expect(root.querySelector('kbd')?.getAttribute('title')).toBe('A & B')
      expect(root.querySelector('[onclick]')).toBeNull()
      expect(root.querySelector('a')?.getAttribute('href')).toBeNull()
    }
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
    native.destroy()
    native.domNode.remove()
    host.remove()
  }
})

it('keeps escaped, code-owned and malformed media literal and uses native formula errors', () => {
  const source =
    'before `<kbd>x</kbd>` \\<u>escaped</u> <kbd title="unfinished and `$x$` $\\frac{1}{$ after\n'
  const app = bootBoundMuya(source)
  try {
    const content = app.muya.editor.scrollPage!.firstContentInDescendant()!
    expect(content.domNode!.querySelector('kbd,u')).toBeNull()
    expect(content.domNode!.querySelectorAll('.mu-math-render')).toHaveLength(1)
    expect(content.domNode!.querySelector('.mu-math-error')?.getAttribute('title')).toContain(
      'KaTeX parse error'
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})

it('keeps native-disallowed HTML tags literal rather than introducing active controls', () => {
  const source =
    'before <textarea>text</textarea> <script>alert(1)</script> <style>body{color:red}</style> <iframe src="https://example.com">frame</iframe> after\n'
  const app = bootBoundMuya(source)
  try {
    const content = app.muya.editor.scrollPage!.firstContentInDescendant()!
    expect(content.domNode!.querySelector('textarea,script,style,iframe')).toBeNull()
    expect(content.domNode!.textContent).toBe(source.trimEnd())
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})

it.each([false, true])(
  'renders and edits owned inline HTML with native attributes and review (annotated=%s)',
  async(annotated) => {
    const html = '<kbd title="A &amp; B">key</kbd> and <u>underlined</u>'
    const source = `before ${annotated ? `{++${html}++}` : html} after\n`
    const app = bootBoundMuya(source)
    try {
      const content = app.muya.editor.scrollPage!.firstContentInDescendant()!
      content.setCursor(0, 0, true)
      const key = content.domNode!.querySelector('kbd')
      expect(key?.textContent).toBe('key')
      expect(key?.getAttribute('title')).toBe('A & B')
      expect(content.domNode!.querySelector('u')?.textContent).toBe('underlined')
      if (annotated) expect(key?.closest('[data-critic-kind="addition"]')).not.toBeNull()
      const at = content.text.indexOf('key') + 1
      content.setCursor(at, at, true)
      content.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: source.replace('key', 'kXey') })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: source.replace('key', 'kXey') })
    } finally {
      app.dispose()
    }
  }
)

it.each([false, true])(
  'projects a native formula selection for the selection clipboard (annotated=%s)',
  (annotated) => {
    const source = annotated ? 'before {++$x^2$++} after\n' : 'before $x^2$ after\n'
    const app = bootBoundMuya(source)
    try {
      const content = app.muya.editor.scrollPage!.firstContentInDescendant()!
      content.setCursor(0, 0, true)
      const preview = content.domNode!.querySelector('.mu-math-render') as HTMLElement
      preview.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      expect(document.getSelection()?.toString()).toBe('x^2')
      const range = muyaClipboardSelection(app.muya, app.view())
      expect(range).toBeDefined()
      const reply = app.binding.selectionProjectionAtBarrier(range!)
      expect(reply).toMatchObject({ type: 'selection-projection', projection: { markdown: 'x^2' } })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)
