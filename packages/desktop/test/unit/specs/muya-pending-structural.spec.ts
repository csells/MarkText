// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each([
  { source: '\n', previous: { name: 'paragraph', text: '' }, markers: ['#'] },
  { source: '#\n', previous: { name: 'atx-heading', meta: { level: 1 }, text: '#' }, markers: ['##'] },
  { source: '\n', previous: { name: 'paragraph', text: '' }, markers: ['#', '##'] }
])('preserves native $markers spelling before queued text', async({ source, previous, markers }) => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'typed-heading.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  let before: unknown = previous
  const headings = markers.map(marker => ({ name: 'atx-heading', meta: { level: marker.length }, text: marker }))
  for (const heading of headings) {
    expect(adapter.accept({
      source: 'user',
      prevDoc: [before],
      doc: [heading],
      op: [0, { r: true, i: heading }]
    })).toBe('accepted')
    before = heading
  }
  const heading = headings.at(-1)!
  const marker = heading.text
  expect(adapter.accept({
    source: 'user',
    prevDoc: [heading],
    doc: [{ ...heading, text: `${marker} Hello` }],
    op: [0, 'text', { es: [marker.length, ' Hello'] }]
  })).toBe('accepted')
  await adapter.settled()
  expect(await binding.sourceAtBarrier()).toMatchObject({ source: `${marker} Hello\n` })
  adapter.dispose()
  binding.dispose()
})

it.each([
  { label: 'heading 1', seed: 'seed' },
  { label: 'ul-bullet', seed: 'seed' },
  { label: 'heading 1', seed: '' }
])('retains native typing and history before $label of "$seed" is acknowledged', async({ label, seed }) => {
  const actor = createCoreActor()
  let release: (() => void) | undefined
  let held = false
  const binding = createEditorCoreBinding({
    request: request => {
      if (request.type === 'apply' && !held) {
        held = true
        return new Promise(resolve => {
          release = () => {
            release = undefined
            resolve(actor.handle(request))
          }
        })
      }
      return Promise.resolve(actor.handle(request))
    },
    dispose: () => {}
  })
  await binding.open({ documentId: 'pending-structural.md', source: `${seed}\n` })
  const initial = await binding.plainTextViewAtBarrier()
  if (initial.type !== 'plain-text-view' || !('state' in initial.view)) throw new Error('Expected typed view')
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host)
  muya.init()
  muya.setContent(structuredClone([...initial.view.state]) as Parameters<Muya['setContent']>[0])
  const reconcile = async() => {
    const next = await binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view' || !('state' in next.view)) throw new Error('Expected typed view')
    if (!adapter.hasPendingEdits()) muya.setContent(structuredClone([...next.view.state]) as Parameters<Muya['setContent']>[0])
    return next.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(initial.view.bindings, binding, undefined, reconcile)
  const admissions: string[] = []
  muya.eventCenter.on('json-change', (change: unknown) => { admissions.push(adapter.accept(change)) })
  try {
    const paragraph = muya.editor.scrollPage?.firstContentInDescendant()
    if (paragraph == null) throw new Error('Expected paragraph')
    muya.editor.activeContentBlock = paragraph
    paragraph.setCursor(seed.length, seed.length)
    muya.updateParagraph(label)
    muya.flush()
    for (const character of '!x') {
      const content = muya.editor.scrollPage?.firstContentInDescendant()
      if (content == null) throw new Error('Expected content leaf')
      muya.editor.activeContentBlock = content
      const text = content.text + character
      content.domNode.textContent = text
      content.setCursor(text.length, text.length)
      content.inputHandler(new InputEvent('input', { data: character, inputType: 'insertText', bubbles: true }))
      muya.flush()
    }
    expect(admissions).toEqual(['accepted', 'accepted', 'accepted'])
    release?.()
    await adapter.settled()
    const prefix = label === 'heading 1' ? '# ' : '- '
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `${prefix}${seed}!x\n` })
    expect(muya.domNode.querySelector(label === 'heading 1' ? 'h1' : 'ul li')).not.toBeNull()
    for (const source of [`${prefix}${seed}!\n`, `${prefix}${seed}\n`, `${seed}\n`]) {
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    }
    for (const source of [`${prefix}${seed}\n`, `${prefix}${seed}!\n`, `${prefix}${seed}!x\n`]) {
      await adapter.history('redo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    }
  } finally {
    release?.()
    adapter.dispose()
    muya.destroy()
    muya.domNode.remove()
  }
})

it.each(['ordinary', 'tracked'].flatMap(lane => [1, 2].map(undoCount => ({ lane, undoCount }))))('rebases $lane typing across $undoCount undo acknowledgements and subsequent reconciliation', async({ lane, undoCount }) => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'pending-undo.md', source: 'A\n' })
  await binding.submit({ edits: [{ start: 1, end: 1, insert: ' B' }], projections: [] }).acknowledged
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  if (undoCount === 2) {
    await binding.submit({ edits: [{ start: 3, end: 3, insert: ' D' }], projections: [] }).acknowledged
  }
  const beforeUndo = undoCount === 2 ? 'A B D' : 'A B'
  let release: (() => void) | undefined
  let reached: (() => void) | undefined
  let reconciliation = new Promise<void>(resolve => { reached = resolve })
  const reconcile = async() => {
    reached?.()
    await new Promise<void>(resolve => { release = resolve })
    return view()
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, reconcile, 2)
  const history = adapter.history('undo', reconcile)
  const secondHistory = undoCount === 2 ? adapter.history('undo', reconcile) : undefined
  // This first character arrives before the acknowledgement.
  const type = (before: string, insert: string) => {
    const change = {
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: before }],
      doc: [{ name: 'paragraph', text: before + insert }],
      op: [0, 'text', { es: [before.length, insert] }]
    }
    return lane === 'tracked' ? adapter.acceptTracked(change, reconcile) : adapter.accept(change)
  }
  try {
    expect(type(beforeUndo, ' ')).toBe('accepted')
    await reconciliation
    expect(type(beforeUndo + ' ', 'C')).toBe('accepted')
    reconciliation = new Promise<void>(resolve => { reached = resolve })
    release?.()
    await history
    await reconciliation
    // The native view still includes B while the first re-edit is rendering.
    expect(type(beforeUndo + ' C', '!')).toBe('accepted')
    reached = undefined
    const drain = setInterval(() => release?.(), 1)
    try { await adapter.settled() } finally { clearInterval(drain) }
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: lane === 'ordinary' ? 'A C!\n' : 'A{++ C!++}\n' })
    expect(adapter.state()).toMatchObject({ status: 'ready' })
  } finally {
    release?.()
    history.catch(() => {})
    secondHistory?.catch(() => {})
    adapter.dispose()
    binding.dispose()
  }
})

it('keeps literal suggestion delimiters literal inside an addition while undo is pending', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'pending-markup-undo.md', source: '{++A++}\n' })
  await binding.submit({ edits: [{ start: 4, end: 4, insert: ' B' }], projections: [] }).acknowledged
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view, 2)
  const history = adapter.history('undo', view)
  try {
    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'A B' }],
      doc: [{ name: 'paragraph', text: 'A B{--X--}' }],
      op: [0, 'text', { es: [3, '{--X--}'] }]
    })).toBe('accepted')
    await history
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: '{++A\\{--X\\--}++}\n' })
  } finally {
    history.catch(() => {})
    adapter.dispose()
    binding.dispose()
  }
})

it.each([false, true])('preserves source while backspaces remove every list item (settled: %s)', async(settleEach) => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'backspace-list.md', source: '# Doc\n\n- a\n- b\n- c\n' })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  const paragraph = (text: string) => ({ name: 'paragraph', text })
  const item = (...texts: string[]) => ({ name: 'list-item', children: texts.map(paragraph) })
  const heading = { name: 'atx-heading', meta: { level: 1 }, text: '# Doc' }
  const document = (...items: unknown[]) => [heading, { name: 'bullet-list', meta: { loose: false, marker: '-' }, children: items }]
  const states = [
    document(item('a'), item('b'), item('c')),
    document(item('a'), item('b'), item('')),
    document(item('a'), item('b', '')),
    document(item('a'), item('b')),
    document(item('a'), item('')),
    document(item('a', '')),
    document(item('a')),
    document(item('')),
    [heading, paragraph('')],
    [heading]
  ]
  const operations = [[1, 'children', 2, 'children', 0, 'text', { es: [{ d: 'c' }] }], [1, 'children', [1, 'children', 1, { i: { name: 'paragraph', text: '' } }], [2, { r: true }]], [1, 'children', 1, 'children', 1, { r: true }], [1, 'children', 1, 'children', 0, 'text', { es: [{ d: 'b' }] }], [1, 'children', [0, 'children', 1, { i: { name: 'paragraph', text: '' } }], [1, { r: true }]], [1, 'children', 0, 'children', 1, { r: true }], [1, 'children', 0, 'children', 0, 'text', { es: [{ d: 'a' }] }], [1, { i: { name: 'paragraph', text: '' }, r: true }], [1, { r: true }]]
  try {
    for (let index = 0; index < operations.length; index += 1) {
      expect(adapter.accept({ source: 'user', prevDoc: states[index], doc: states[index + 1], op: operations[index] })).toBe('accepted')
      if (settleEach) await adapter.settled()
    }
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: '# Doc\n' })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each(['\n', '\r\n', '\r'])('inserts a rule before an unchanged empty paragraph and keeps following typing (%j)', async eol => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'insert-rule.md', source: eol })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  const paragraph = { name: 'paragraph', text: '' }
  const rule = { name: 'thematic-break', text: '---' }
  try {
    expect(adapter.accept({ source: 'user', prevDoc: [paragraph], doc: [rule, paragraph], op: [0, { i: rule }] })).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [rule, paragraph], doc: [rule, { ...paragraph, text: 'after' }], op: [1, 'text', { es: ['after'] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `---${eol}${eol}after${eol}` })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each(['\n', '\r\n', '\r'])('appends a native code block at EOF and preserves queued input (%j)', async eol => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'append-code.md', source: `sample text${eol}` })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  const paragraph = { name: 'paragraph', text: 'sample text' }
  const code = { name: 'code-block', meta: { type: 'fenced', lang: '' }, text: '' }
  try {
    expect(adapter.accept({ source: 'user', prevDoc: [paragraph], doc: [paragraph, code], op: [1, { i: code }] })).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [paragraph, code], doc: [paragraph, { ...code, text: 'after' }], op: [1, 'text', { es: ['after'] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `sample text${eol}${eol}\`\`\`${eol}after${eol}\`\`\`${eol}` })
    await adapter.history('undo', view)
    await adapter.history('undo', view)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `sample text${eol}` })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each(['\n', '\r\n', '\r'])('appends after an annotated final paragraph without consuming its markers (%j)', async eol => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'append-code.md', source: `{~~old~>new~~}${eol}` })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  const paragraph = { name: 'paragraph', text: 'oldnew' }
  const code = { name: 'code-block', meta: { type: 'fenced', lang: '' }, text: '' }
  try {
    expect(adapter.accept({ source: 'user', prevDoc: [paragraph], doc: [paragraph, code], op: [1, { i: code }] })).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [paragraph, code], doc: [paragraph, { ...code, text: 'after' }], op: [1, 'text', { es: ['after'] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `{~~old~>new~~}${eol}${eol}\`\`\`${eol}after${eol}\`\`\`${eol}` })
    await adapter.history('undo', view)
    await adapter.history('undo', view)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `{~~old~>new~~}${eol}` })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it('appends a heading beyond queued tracked text and its new EOF closer', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'queued-append-heading.md', source: 'plain' })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  const paragraph = { name: 'paragraph', text: 'plain' }
  const typed = { ...paragraph, text: 'plainX' }
  const heading = { name: 'atx-heading', meta: { level: 1 }, text: '#' }
  try {
    expect(adapter.acceptTracked({ source: 'user', prevDoc: [paragraph], doc: [typed], op: [0, 'text', { es: [5, 'X'] }] }, view)).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [typed], doc: [typed, heading], op: [1, { i: heading }] })).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [typed, heading], doc: [typed, { ...heading, text: '# Heading' }], op: [1, 'text', { es: [1, ' Heading'] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'plain{++X++}\n\n# Heading\n' })
    await adapter.history('undo', view)
    await adapter.history('undo', view)
    await adapter.history('undo', view)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'plain' })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it('keeps a queued replacement domain while adding a heading and editing both leaves', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'queued-append-heading.md', source: 'plain' })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  const paragraph = { name: 'paragraph', text: 'plain' }
  const typed = { ...paragraph, text: 'Xlain' }
  const heading = { name: 'atx-heading', meta: { level: 1 }, text: '#' }
  try {
    expect(adapter.acceptTracked({ source: 'user', prevDoc: [paragraph], doc: [typed], op: [0, 'text', { es: [{ d: 'p' }, 'X'] }] }, view)).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [typed], doc: [typed, heading], op: [1, { i: heading }] })).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [typed, heading], doc: [typed, { ...heading, text: '# Heading' }], op: [1, 'text', { es: [1, ' Heading'] }] })).toBe('accepted')
    expect(adapter.accept({ source: 'user', prevDoc: [typed, { ...heading, text: '# Heading' }], doc: [{ ...typed, text: 'XlainZ' }, { ...heading, text: '# Heading' }], op: [0, 'text', { es: [5, 'Z'] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: '{~~p~>X~~}lainZ\n\n# Heading\n' })
    await adapter.history('undo', view)
    await adapter.history('undo', view)
    await adapter.history('undo', view)
    await adapter.history('undo', view)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'plain' })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
