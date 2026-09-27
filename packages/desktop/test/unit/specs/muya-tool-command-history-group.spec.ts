// @vitest-environment jsdom
import { CodeBlockLanguageSelector, FootnoteTool } from '@muyajs/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { isFormat } from '../helpers/muyaTypes'

// Upstream History records every tool's json change like typing: none marks an
// input boundary, so each tool command joins the undo step opened within the
// last second, and a later one (after a pause) starts its own step.

let clock = 0

beforeEach(() => {
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type App = ReturnType<typeof bootBoundMuya>

const source = (app: App): string => {
  const barrier = app.binding.sourceAtBarrier()
  if (!('source' in barrier) || typeof barrier.source !== 'string') {
    throw new Error('Expected a settled source')
  }
  return barrier.source
}

const target = (app: App) => {
  const block = app.muya.editor.scrollPage?.firstContentInDescendant()
  if (!block) throw new Error('Expected the tool target block')
  return block
}

const formatTarget = (app: App) => {
  const block = target(app)
  if (!isFormat(block)) throw new Error('Expected formattable text')
  return block
}

interface ImagePicker {
  imageInfo: unknown
  block: {
    replaceImage(info: unknown, value: { alt: string; src: string; title: string }): void
    updateImage(info: unknown, attr: string, value: string): void
    deleteImage(info: unknown): void
  }
}

const imagePicker = (app: App, caret: number): ImagePicker => {
  let picker: ImagePicker | undefined
  const listener = (event: ImagePicker) => {
    picker = event
  }
  app.muya.on('muya-image-selector', listener)
  target(app).setCursor(caret, caret, true)
  expect(app.muya.showImageSelectorAtSelection()).toBe(true)
  app.muya.off('muya-image-selector', listener)
  if (!picker) throw new Error('Image picker did not receive the current image')
  return picker
}

const image = '![a](old.png)'
const cases: ReadonlyArray<{
  name: string
  fixture: string
  options?: Parameters<typeof bootBoundMuya>[1]
  command: (app: App) => void | Promise<void>
}> = [
  {
    name: 'emoji pick',
    fixture: 'x :smi y',
    command: (app) => {
      formatTarget(app).setCursor(6, 6, true)
      formatTarget(app).setEmoji('smiley')
    }
  },
  {
    name: 'image replacement',
    fixture: image,
    command: (app) => {
      const picker = imagePicker(app, image.length)
      picker.block.replaceImage(picker.imageInfo, { alt: 'a', src: 'new.png', title: '' })
    }
  },
  {
    name: 'image properties',
    fixture: image,
    command: (app) => {
      const picker = imagePicker(app, image.length)
      picker.block.updateImage(picker.imageInfo, 'width', '120')
    }
  },
  {
    name: 'image deletion',
    fixture: `x ${image} y`,
    command: (app) => {
      const picker = imagePicker(app, 2 + image.length)
      picker.block.deleteImage(picker.imageInfo)
    }
  },
  {
    name: 'image insertion',
    fixture: 'x y',
    command: (app) => {
      target(app).setCursor(1, 1, true)
      app.muya.insertImage({ src: 'new.png', alt: 'n' })
    }
  },
  {
    name: 'unlink',
    fixture: 'x [name](https://example.com) y',
    command: (app) => {
      let tools:
        | { reference: HTMLElement; linkInfo: unknown; block: { unlink(info: unknown, reference?: HTMLElement): void } }
        | undefined
      app.muya.eventCenter.on('muya-link-tools', (value: typeof tools) => {
        if (value?.block) tools = value
      })
      app.muya.domNode
        .querySelector<HTMLElement>('.mu-link')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      if (!tools) throw new Error('Link tools did not open')
      tools.block.unlink(tools.linkInfo, tools.reference)
    }
  },
  {
    name: 'spelling replacement',
    fixture: 'x wrod y',
    command: (app) => {
      const block = target(app)
      app.muya.editor.activeContentBlock = block
      block.setCursor(2, 6, true)
      expect(app.muya.replaceCurrentWordInlineUnsafe('wrod', 'word')).toBe(true)
    }
  },
  {
    name: 'code-language pick',
    fixture: '```js\ncode\n```',
    command: (app) => {
      const picker = new CodeBlockLanguageSelector(app.muya)
      if (picker.container) picker.container.scrollTo = () => {}
      try {
        const language = target(app)
        language.setCursor(language.text.length, language.text.length, true)
        app.muya.eventCenter.emit('content-change', { block: language })
        picker.selectItem({ name: 'typescript' })
      } finally {
        picker.destroy()
      }
    }
  },
  {
    name: 'code-language typing',
    fixture: '```js\ncode\n```',
    command: (app) => {
      const language = target(app) as unknown as { updateLanguage(lang: string): void }
      language.updateLanguage('ts')
    }
  },
  {
    name: 'footnote creation',
    fixture: 'x[^fresh] y',
    options: { footnotes: true },
    command: async(app) => {
      const tool = new FootnoteTool(app.muya)
      try {
        const block = target(app)
        block.setCursor(2, 2, true)
        ;(block.domNode!.querySelector('#noteref-fresh a') as HTMLElement).click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        ;(tool.container!.querySelector('a.btn') as HTMLAnchorElement).click()
      } finally {
        tool.destroy()
      }
    }
  }
]

const typeAtEnd = (app: App, data: string): void => {
  const block = app.muya.editor.scrollPage?.lastContentInDescendant()
  if (!block?.domNode?.isConnected) throw new Error('Expected the typing paragraph')
  if (block.text !== 'para') throw new Error(`Expected the typing paragraph, got ${block.text}`)
  app.muya.editor.activeContentBlock = block
  block.setCursor(4, 4, true)
  block.domNode.dispatchEvent(
    new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true })
  )
}

for (const { name, fixture, options, command } of cases) {
  for (const gap of [100, 1500]) {
    it(`groups the ${name} with typing ${gap}ms before it as upstream does`, async() => {
      const app = bootBoundMuya(`${fixture}\n\npara\n`, options)
      try {
        const original = source(app)
        typeAtEnd(app, 'a')
        await app.adapter.settled()
        const typed = source(app)
        expect(typed).not.toBe(original)
        clock += gap
        await command(app)
        await app.adapter.settled()
        app.muya.flush()
        const commanded = source(app)
        expect(commanded).not.toBe(typed)
        expect(app.legacyChanges).toEqual([])

        await app.adapter.history('undo', app.reconcile)
        expect(source(app)).toBe(gap < 1000 ? original : typed)
        while (source(app) !== commanded) {
          const before = source(app)
          await app.adapter.history('redo', app.reconcile)
          expect(source(app)).not.toBe(before)
        }
      } finally {
        app.dispose()
      }
    })
  }
}
