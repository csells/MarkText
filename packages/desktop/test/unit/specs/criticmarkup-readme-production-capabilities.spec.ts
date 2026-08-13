import type { MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: { emit } }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  FootnoteTool,
  InlineFormatToolbar,
  MarkdownToHtml,
  Muya,
  de,
  en,
  es,
  fr,
  ja,
  ko,
  pt,
  renderToStaticHTML,
  zhCN,
  zhTW
} from '@muyajs/core'
// @ts-expect-error The published package wildcard exposes deep state modules at runtime.
import HtmlToMarkdown from '@muyajs/core/state/htmlToMarkdown'
// @ts-expect-error The published package wildcard exposes deep state modules at runtime.
import { MarkdownToState } from '@muyajs/core/state/markdownToState'
// @ts-expect-error The published package wildcard exposes deep state modules at runtime.
import StateToMarkdown from '@muyajs/core/state/stateToMarkdown'
// @ts-expect-error The published package wildcard exposes deep state modules at runtime.
import type { TState } from '@muyajs/core/state/types'
import themeMenuTemplate from 'main_renderer/menu/templates/theme'

type StateLike = Readonly<{
  name: string
  meta?: Readonly<{ type?: string }>
}>

type Capability = Readonly<{
  itemId: string
  prove: () => void | Promise<void>
}>

const booted: Muya[] = []

const bootMuya = (markdown: string, options: Record<string, unknown> = {}): Muya => {
  ;(window as unknown as { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.createElement('div')
  document.body.appendChild(host)
  const muya = new Muya(host, {
    markdown,
    ...options
  } as ConstructorParameters<typeof Muya>[1])
  muya.init()
  booted.push(muya)
  return muya
}

const nextFrame = (): Promise<void> => new Promise(resolve => {
  requestAnimationFrame(() => resolve())
})

const parse = (markdown: string): TState[] => new MarkdownToState({
  footnote: true,
  math: true,
  isGitlabCompatibilityEnabled: true,
  trimUnnecessaryCodeBlockEmptyLines: false,
  frontMatter: true
}).generate(markdown)

const renderOptions = {
  footnote: true,
  frontMatter: true,
  isGitlabCompatibilityEnabled: true,
  math: true,
  superSubScript: true
} as const

const capabilities: readonly Capability[] = [
  {
    itemId: 'readme-feature:06d04490689f',
    prove() {
      const html = renderToStaticHTML([
        '---',
        'title: Feature proof',
        '---',
        '',
        'Inline $x^2$, :smile: and H~2~O.'
      ].join('\n'), renderOptions)

      expect(html).toMatch(/front-matter|frontmatter/)
      expect(html).toMatch(/katex|<math/)
      expect(html).toContain('😄')
      expect(html).toContain('<sub>2</sub>')
    }
  },
  {
    itemId: 'readme-feature:3d27e259bc96',
    prove() {
      const menu = themeMenuTemplate({
        getAll: () => ({ theme: 'light', followSystemTheme: false })
      } as never)
      const groups = menu.submenu as MenuItemConstructorOptions[]
      const light = groups.find(item => item.label === 'menu.theme.lightThemes')
      const dark = groups.find(item => item.label === 'menu.theme.darkThemes')
      const cadmium = (light?.submenu as MenuItemConstructorOptions[])
        .find(item => item.label === 'menu.theme.cadmiumLight')
      const material = (dark?.submenu as MenuItemConstructorOptions[])
        .find(item => item.label === 'menu.theme.materialDark')

      expect(cadmium?.id).toBe('light')
      expect(material?.id).toBe('material-dark')
      cadmium?.click?.({} as MenuItem, undefined, {} as KeyboardEvent)
      material?.click?.({} as MenuItem, undefined, {} as KeyboardEvent)
      expect(emit.mock.calls).toEqual([
        ['set-user-preference', { theme: 'light' }],
        ['set-user-preference', { theme: 'material-dark' }]
      ])
    }
  },
  {
    itemId: 'muya-readme-feature:3f2f1ac8d864',
    prove() {
      expect(InlineFormatToolbar).toBeTypeOf('function')
      const html = renderToStaticHTML([
        '---',
        'title: Formats',
        '---',
        '',
        '**strong** *emphasis* ~~strike~~ `code` H~2~O 2^n^ $x^2$.'
      ].join('\n'), renderOptions)

      expect(html).toContain('<strong>strong</strong>')
      expect(html).toContain('<em>emphasis</em>')
      expect(html).toContain('<del>strike</del>')
      expect(html).toContain('<code>code</code>')
      expect(html).toContain('<sub>2</sub>')
      expect(html).toContain('<sup>n</sup>')
      expect(html).toMatch(/front-matter|frontmatter/)
      expect(html).toMatch(/katex|<math/)
    }
  },
  {
    itemId: 'muya-readme-feature:30de6cbcfc7d',
    async prove() {
      expect(FootnoteTool).toBeTypeOf('function')
      const muyaOptions = { options: renderOptions } as unknown as Muya
      const html = await new MarkdownToHtml(
        'A note[^id].\n\n[^id]: Footnote body.\n',
        muyaOptions
      ).renderHtml()

      expect(html).toContain('class="footnote-ref"')
      expect(html).toContain('<section class="footnotes">')
      expect(html).toContain('class="footnote-backref"')
    }
  },
  {
    itemId: 'muya-readme-feature:e447f6844445',
    async prove() {
      const markdown = [
        'Read [the guide][docs] and view ![logo][image].',
        '',
        '[docs]: https://example.test/guide "Guide"',
        '[image]: https://example.test/logo.png "Logo"'
      ].join('\n')
      const states = parse(markdown)
      const roundTrip = new StateToMarkdown().generate(states)
      const html = await new MarkdownToHtml(markdown).renderHtml()

      expect(roundTrip).toContain('[docs]: https://example.test/guide "Guide"')
      expect(roundTrip).toContain('[image]: https://example.test/logo.png "Logo"')
      expect(html).toContain('href="https://example.test/guide"')
      expect(html).toContain('src="https://example.test/logo.png"')
    }
  },
  {
    itemId: 'muya-readme-feature:ac0cb96fc735',
    async prove() {
      const muya = bootMuya('```js\none\ntwo\n```\n', {
        codeBlockLineNumbers: true
      })
      await nextFrame()
      await nextFrame()

      const pre = muya.domNode.querySelector('pre.mu-code-block.mu-line-numbers')
      expect(pre).not.toBeNull()
      expect(pre?.querySelectorAll('.mu-line-numbers-rows > span')).toHaveLength(2)
    }
  },
  {
    itemId: 'muya-readme-feature:422f2e921e62',
    prove() {
      for (const type of ['mermaid', 'vega-lite', 'plantuml'] as const) {
        const states = parse(`\`\`\`${type}\ncontent\n\`\`\`\n`) as StateLike[]
        expect(states[0], type).toMatchObject({ name: 'diagram', meta: { type } })
      }

      const math = renderToStaticHTML('$$\nx^2\n$$', renderOptions)
      const code = renderToStaticHTML('```js\nconst answer = 42\n```', renderOptions)
      expect(math).toMatch(/katex|<math/)
      expect(code).toContain('language-js')
      expect(code).toMatch(/token (?:keyword|number)/)
    }
  },
  {
    itemId: 'muya-readme-feature:9bf7137484d1',
    async prove() {
      const markdown = '## Round trip\n\n- **safe**\n- [link](https://example.test)\n'
      const html = await new MarkdownToHtml(markdown).renderHtml()
      const restored = new HtmlToMarkdown().generate(html)
      const sanitized = await new MarkdownToHtml(
        '<script>globalThis.compromised = true</script>safe'
      ).renderHtml()

      expect(restored).toContain('## Round trip')
      expect(restored).toContain('- **safe**')
      expect(restored).toContain('[link](https://example.test)')
      expect(sanitized).not.toContain('<script')
      expect(sanitized).toContain('&lt;script&gt;globalThis.compromised = true&lt;/script&gt;')
    }
  },
  {
    itemId: 'muya-readme-feature:6618a086adb9',
    async prove() {
      const original = 'item-1 and item-2\n'
      const muya = bootMuya(original)
      const block = muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Search/history proof requires a content block')
      muya.editor.activeContentBlock = block
      block.setCursor(0, 0, true)

      muya.search('item-\\d', { isRegexp: true })
      expect(muya.editor.searchModule.matches).toHaveLength(2)
      muya.replace('matched', { isSingle: false, isRegexp: false })
      await vi.waitFor(() => expect(muya.getMarkdown()).toContain('matched and matched'))
      await vi.waitFor(() => expect(muya.getHistory().stack.undo.length).toBeGreaterThan(0))

      block.setCursor(0, 0, true)
      muya.undo()
      await vi.waitFor(() => expect(muya.getMarkdown()).toContain('item-1 and item-2'))
      muya.redo()
      await vi.waitFor(() => expect(muya.getMarkdown()).toContain('matched and matched'))
    }
  },
  {
    itemId: 'muya-readme-feature:f0ccce744042',
    prove() {
      const locales = [en, zhCN, zhTW, ja, ko, es, fr, de, pt]
      expect(locales.map(locale => locale.name)).toEqual([
        'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt'
      ])
      const englishKeys = Object.keys(en.resource).sort()
      for (const locale of locales) {
        expect(Object.keys(locale.resource).sort(), locale.name).toEqual(englishKeys)
      }
    }
  }
]

afterEach(() => {
  emit.mockClear()
  while (booted.length > 0) booted.pop()?.destroy()
  document.body.replaceChildren()
  delete (window as unknown as { MUYA_VERSION?: string }).MUYA_VERSION
})

describe('CriticMarkup README production capabilities', () => {
  it.each(capabilities)('$itemId proves every objective subclaim at its public production seam', async({ prove }) => {
    await prove()
  })
})
