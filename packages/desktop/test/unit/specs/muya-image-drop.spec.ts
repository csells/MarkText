// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

function dropFile(element: HTMLElement, clientY = 1): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: {
      value: {
        files: [new File(['image'], 'shot.png', { type: 'image/png' })],
        items: [{ kind: 'file', type: 'image/png' }]
      }
    }
  })
  element.dispatchEvent(event)
  return event
}

it.each([
  { name: 'plain quote', source: '> same\n\ntail\n' },
  { name: 'annotated quote', source: '> s{++a++}me{>>keep<<}\n\ntail\n' },
  { name: 'code', source: '```js\nx\n```\n\ntail\n' },
  { name: 'math', source: '$$\nx+y\n$$\n\ntail\n' },
  { name: 'table', source: '| h |\n|---|\n| a |\n\ntail\n' }
])('native image drop inserts beside its $name model block', async({ source }) => {
  const inserted = source.replace('\n\ntail', '\n\n![shot.png](/tmp/shot.png)\n\ntail')
  const app = bootBoundMuya(source)
  try {
    app.muya.options.getPathForFile = () => '/tmp/shot.png'
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph?.domNode) throw new Error('Missing drop target')
    const prior = app.muya.editor.scrollPage?.lastContentInDescendant()
    if (!prior) throw new Error('Missing original caret')
    prior.setCursor(4, 1, true)
    const event = dropFile(paragraph.domNode)
    await app.adapter.settled()
    expect(event.defaultPrevented).toBe(true)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
    expect(app.legacyChanges).toEqual([])
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const image = app.muya.editor.selection.getSelection()?.anchor.block
    if (!image) throw new Error('Missing inserted image selection')
    image.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    const typed = inserted.replace('![shot.png]', 'x![shot.png]')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: 4, path: [1, 'text'] },
      focus: { offset: 1, path: [1, 'text'] }
    })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const reopened = bootBoundMuya(typed)
    try {
      expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it('pending native image drop holds settlement and retains newer input and its caret', async() => {
  const source = '> s{++a++}me{>>keep<<}\n\ntail\n'
  const app = bootBoundMuya(source)
  let finish!: (source: string) => void
  try {
    app.muya.options.getPathForFile = () => '/tmp/shot.png'
    app.muya.options.imageAction = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Missing drop target')
    dropFile(paragraph.domNode)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(JSON.stringify(app.adapter.recoveryDraft())).toContain('/tmp/shot.png')
    let settled = false
    const barrier = app.adapter.settled().then(() => {
      settled = true
    })
    const tail = paragraph.nextContentInContext()
    if (!tail) throw new Error('Missing later paragraph')
    tail.setCursor(0, 0, true)
    tail.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    finish('/assets/shot.png')
    await barrier
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '> s{++a++}me{>>keep<<}\n\n![shot.png](/assets/shot.png)\n\nxtail\n'
    })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    expect(app.muya.editor.selection.getSelection()?.anchor.block.text).toBe('xtail')
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it('native image drop retains its resource draft when newer input removes the target', async() => {
  const app = bootBoundMuya('> same\n\ntail\n')
  let finish!: (source: string) => void
  try {
    app.muya.options.getPathForFile = () => '/tmp/shot.png'
    app.muya.options.imageAction = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Missing drop target')
    dropFile(paragraph.domNode)
    app.adapter.input(
      {
        selection: { ranges: [{ anchor: 0, focus: 6 }], primary: 0 },
        range: { start: 0, end: 6 },
        inputType: 'insertText',
        data: 'changed',
        options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
      },
      app.reconcile
    )
    finish('/assets/shot.png')
    await expect(app.adapter.settled()).rejects.toThrow('overlaps')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'changed\n\ntail\n' })
    expect(JSON.stringify(app.adapter.recoveryDraft())).toContain('/assets/shot.png')
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it('an ignored web-image payload leaves the original directed selection unchanged', async() => {
  const app = bootBoundMuya('target\n\ntail\n')
  try {
    const target = app.muya.editor.scrollPage?.firstContentInDescendant()
    const prior = app.muya.editor.scrollPage?.lastContentInDescendant()
    if (!target || !prior) throw new Error('Missing drop paragraphs')
    prior.setCursor(4, 1, true)
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      clientY: { value: 1 },
      dataTransfer: {
        value: {
          files: [],
          items: [
            {
              kind: 'string',
              type: 'text/uri-list',
              getAsString: (read: (text: string) => void) => read('not-a-url')
            },
            {
              kind: 'string',
              type: 'text/html',
              getAsString: (read: (text: string) => void) => read('<span>not an image</span>')
            }
          ]
        }
      }
    })
    target.domNode.dispatchEvent(event)
    await app.adapter.settled()
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'target\n\ntail\n' })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: 4, path: [1, 'text'] },
      focus: { offset: 1, path: [1, 'text'] }
    })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it('a native image drop with no browser selection still owns its explicit target', async() => {
  const app = bootBoundMuya('target\n\ntail\n')
  try {
    app.muya.options.getPathForFile = () => '/tmp/shot.png'
    const target = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!target) throw new Error('Missing drop target')
    document.getSelection()?.removeAllRanges()
    dropFile(target.domNode)
    await app.adapter.settled()
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: 'target\n\n![shot.png](/tmp/shot.png)\n\ntail\n'
    })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: 0, path: [1, 'text'] },
      focus: { offset: 0, path: [1, 'text'] }
    })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it('a pending drop with no browser selection rebases its target through preceding input', async() => {
  const app = bootBoundMuya('before\n\ntarget\n\ntail\n')
  let finish!: (source: string) => void
  try {
    app.muya.options.getPathForFile = () => '/tmp/shot.png'
    app.muya.options.imageAction = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const target = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!target) throw new Error('Missing drop target')
    document.getSelection()?.removeAllRanges()
    dropFile(target.domNode)
    app.adapter.input(
      {
        selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
        range: { start: 0, end: 0 },
        inputType: 'insertText',
        data: 'new\n\n',
        options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
      },
      app.reconcile
    )
    document.getSelection()?.removeAllRanges()
    finish('/assets/shot.png')
    await app.adapter.settled()
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: 'new\n\nbefore\n\ntarget\n\n![shot.png](/assets/shot.png)\n\ntail\n'
    })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: 0, path: [3, 'text'] },
      focus: { offset: 0, path: [3, 'text'] }
    })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})
