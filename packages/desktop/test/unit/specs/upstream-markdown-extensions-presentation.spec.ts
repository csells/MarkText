import { createDocumentCore, type MarkdownOptions } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { renderMuyaMarkupBinding } from '@/documentAuthority/muyaMarkupPresentation'
import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'
import { tocProjectedDocument } from '@/documentConsumers/documentProjectionConsumers'

// Upstream's opt-in `==highlight==`, GitLab inline diff and `>>>` fence,
// presented from Core's one parse in the editor and in exported HTML.

const on: Partial<MarkdownOptions> = { highlightSyntax: true, inlineDiff: true, multilineBlockquote: true }

const rendered = (source: string, options: Partial<MarkdownOptions>, caret?: number): HTMLDivElement => {
  const core = createDocumentCore()
  const revision = core.open(source, options)
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  const binding = view.bindings[0]!
  const host = document.createElement('div')
  host.innerHTML = renderMuyaMarkupBinding(
    binding,
    view.decorations,
    binding.text,
    {
      renderImage: () => undefined,
      ...(caret === undefined ? {} : { cursor: { anchor: caret, focus: caret } })
    },
    view.comments
  )
  return host
}

const exported = (source: string, options: Partial<MarkdownOptions>): string => {
  const core = createDocumentCore()
  return renderMarkdownProjectionToSafeHtml(core.project(core.open(source, options), 'revised'))
}

const markers = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('span.mu-remove')].map((span) => `${span.className}|${span.textContent}`)

describe('==highlight== from Core', () => {
  it('renders a highlight with markers hidden until the caret is in it, as upstream does', () => {
    const host = rendered('a ==hi== b', on)
    expect(host.textContent).toBe('a ==hi== b')
    expect(host.querySelector('mark.mu-inline-rule')?.textContent).toBe('hi')
    expect(markers(host)).toEqual(['mu-hide mu-remove|==', 'mu-hide mu-remove|=='])
    expect(markers(rendered('a ==hi== b', on, 4))).toEqual(['mu-gray mu-remove|==', 'mu-gray mu-remove|=='])
  })

  it('leaves the text literal while the preference is off', () => {
    const host = rendered('a ==hi== b', {})
    expect(host.querySelector('mark')).toBeNull()
    expect(host.textContent).toBe('a ==hi== b')
  })

  it('exports <mark> with inline Markdown inside', () => {
    expect(exported('a ==hi== b\n', on)).toBe('<p>a <mark>hi</mark> b</p>\n')
    expect(exported('==**bold**==\n', on)).toBe('<p><mark><strong>bold</strong></mark></p>\n')
    expect(exported('a ==hi== b\n', {})).toBe('<p>a ==hi== b</p>\n')
  })
})

describe('GitLab inline diff from Core', () => {
  it('renders additions and deletions with upstream\'s editor classes', () => {
    const host = rendered('{+ add +} [- del -]', on)
    expect(host.textContent).toBe('{+ add +} [- del -]')
    expect(host.querySelector('ins.mu-inline-rule.mu-inline-diff-addition')?.textContent).toBe(' add ')
    expect(host.querySelector('del.mu-inline-rule.mu-inline-diff-deletion')?.textContent).toBe(' del ')
    expect(markers(host)).toEqual([
      'mu-hide mu-remove|{+', 'mu-hide mu-remove|+}', 'mu-hide mu-remove|[-', 'mu-hide mu-remove|-]'
    ])
  })

  it('exports GitLab\'s idiff markup with a literal body', () => {
    expect(exported('{+ add +}\n', on)).toBe('<p><ins class="idiff addition"> add </ins></p>\n')
    expect(exported('[- del -]\n', on)).toBe('<p><del class="idiff deletion"> del </del></p>\n')
    expect(exported('{+ <b>x</b> +}\n', on)).toBe('<p><ins class="idiff addition"> &lt;b&gt;x&lt;/b&gt; </ins></p>\n')
    expect(exported('{+ add +}\n', {})).toBe('<p>{+ add +}</p>\n')
  })
})

describe('upstream spellings beside CriticMarkup', () => {
  // Owner decision, 2026-10-12: CriticMarkup keeps {++x++}, {--x--} and
  // {==x==} with the upstream preferences on.
  it('presents each in one paragraph by its own syntax', () => {
    const host = rendered('{+a+} {++b++} [-c-] {--d--} ==e== {==f==}', on)
    expect(host.querySelector('ins.mu-inline-diff-addition')?.textContent).toBe('a')
    expect(host.querySelector('[data-critic-kind="addition"]')?.textContent).toBe('b')
    expect(host.querySelector('del.mu-inline-diff-deletion')?.textContent).toBe('c')
    expect(host.querySelector('[data-critic-kind="deletion"]')?.textContent).toBe('d')
    expect(host.querySelector('mark.mu-inline-rule')?.textContent).toBe('e')
    expect(host.querySelector('[data-critic-kind="highlight"]')?.textContent).toBe('f')
    expect(host.querySelectorAll('ins, del.mu-inline-diff-deletion, mark.mu-inline-rule')).toHaveLength(3)
  })
})

describe('>>> fenced blockquote from Core', () => {
  const fence = '>>>\nline one\n\nline two\n>>>\n'

  it('exports one <blockquote> when on and the literal fence when off, as upstream does', () => {
    expect(exported(fence, on)).toBe('<blockquote>\n<p>line one</p>\n<p>line two</p>\n</blockquote>\n')
    expect(exported(fence, {})).toBe('<p>&gt;&gt;&gt;\nline one\n\nline two\n&gt;&gt;&gt;</p>\n')
  })
})

describe('>>> fenced blockquote in the editor', () => {
  const source = 'intro\n\n>>>\nline one\n\nline two\n>>>\n\nafter\n'
  const view = (options: Partial<MarkdownOptions>) => {
    const core = createDocumentCore()
    const revision = core.open(source, options)
    return createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  }

  it('shows upstream\'s fenced block-quote state with each paragraph editable at its source', () => {
    const fenced = view(on)
    expect(fenced.state).toEqual([
      { name: 'paragraph', text: 'intro' },
      { name: 'block-quote', meta: { style: 'fenced' }, children: [
        { name: 'paragraph', text: 'line one' },
        { name: 'paragraph', text: 'line two' }
      ] },
      { name: 'paragraph', text: 'after' }
    ])
    expect(fenced.bindings.map((binding) => source.slice(binding.sourceRange.start, binding.sourceRange.end)))
      .toEqual(['intro', 'line one', 'line two', 'after'])
  })

  it('shows the fence as one literal paragraph while the preference is off', () => {
    expect(view({}).state[1]).toEqual({ name: 'paragraph', text: '>>>\nline one\n\nline two\n>>>' })
  })
})

describe('outline HTML from Core (#3110)', () => {
  it('keeps inline styling, highlight and inline diff, and flattens links, images and emoji', () => {
    const core = createDocumentCore()
    const projection = core.project(core.open(
      '# **Bold** ==hi== {+new+}\n\n## Inline `code` and :ok: end\n\n## a [link](https://e.com) and ![alt](https://e.com/i.png)\n',
      on
    ), 'revised')
    expect(tocProjectedDocument(projection).map((entry) => entry.contentHtml)).toEqual([
      '<strong>Bold</strong> <mark>hi</mark> <ins class="idiff addition">new</ins>',
      'Inline <code>code</code> and \u{1F197} end',
      'a link and alt'
    ])
  })
})
