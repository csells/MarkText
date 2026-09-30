import { expect, type Locator, type Page } from '@playwright/test'

// Ordinary Markdown documents that both MarkText's warm-session harness and
// the upstream warm-session producer type into, so their echo distributions
// compare one document with itself. The harnesses type at the end of the
// warm editing text, which begins most documents; the `-inside` and `-after`
// documents hold it inside or after their long block instead.

export const WARM_EDITING_PARAGRAPH = 'Warm editing paragraph.'

/** The editable text that can hold the warm editing text: a paragraph's or a code block's. */
const WARM_EDITING_TARGET = '.editor-component :is(span.mu-paragraph-content, .mu-codeblock-content)'

/**
 * Place the caret at the end of the warm editing text, wherever the document
 * holds it, and return the element holding it.
 */
export const placeCaretAfterWarmEditingText = async(page: Page): Promise<Locator> => {
  const target = page.locator(WARM_EDITING_TARGET, { hasText: WARM_EDITING_PARAGRAPH }).first()
  await expect(target).toHaveAttribute('contenteditable', 'true')
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await target.evaluate((element, text) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text)
    const at = nodes.map(node => node.data).join('').indexOf(text)
    if (at < 0) throw new Error('The warm editing text is not rendered')
    let remaining = at + text.length
    for (const node of nodes) {
      if (remaining <= node.data.length) {
        const selection = element.ownerDocument.getSelection()
        selection?.setBaseAndExtent(node, remaining, node, remaining)
        element.ownerDocument.dispatchEvent(new Event('selectionchange'))
        return
      }
      remaining -= node.data.length
    }
  }, WARM_EDITING_PARAGRAPH)
  return target
}

export interface OrdinaryMarkdownWorkload {
  readonly name: string
  readonly source: string
}

const documentOf = (blocks: readonly string[]): string =>
  [WARM_EDITING_PARAGRAPH, ...blocks].join('\n\n') + '\n'

const repeated = (count: number, block: (index: number) => string): string[] =>
  Array.from({ length: count }, (_, index) => block(index))

const plainParagraph = 'Writing a useful document takes careful editing and a clear view of the text.'

// A link and a code span in every paragraph (fixer L's P-md5 paragraph).
const linkAndCodeParagraph =
  'Review **new evidence** alongside *obsolete details*, `old wording` [better wording](https://example.com), and **a claim**.'

// One of each ordinary block kind (the shapes of document-core's
// regional-plain-markdown-keys.spec.ts), repeated in turn.
const mixedBlocks: readonly string[] = [
  'Writing a useful document takes careful editing.',
  '## Section heading for the chapter',
  'Setext heading title\n---',
  'See [the guide](http://example.com/guide) for the details.',
  'Read [the notes] before you start.',
  'Call `render()` once and cache its result.',
  'The area $a^2 + b^2$ grows with each side.',
  '- first item of the list\n- second item here',
  '1. first step\n2. second step to take',
  '> A quoted remark that spans\n> two lines of text.',
  '| Name | Value |\n| --- | --- |\n| alpha | one |',
  '```js\nconst total = values.reduce(add, 0)\n```',
  '    const total = values.reduce(add, 0)',
  '<div>\nsome html text here\n</div>',
  'Some *emphasised words* and **strong words** here.'
]

const looseListItem = (index: number): string => `- List item ${index + 1} with a few words.`
const fenceLine = (index: number): string => `const value${index} = ${index}`
const fenceOf = (line: (index: number) => string): string => ['```js', ...repeated(2000, line), '```'].join('\n')
// The long block after an opening paragraph, with the warm editing text in
// its middle item or line, or in a paragraph after it.
const insideOrAfter = (block: (inside: boolean) => string): Readonly<{ inside: string, after: string }> => ({
  inside: ['Opening paragraph.', block(true)].join('\n\n') + '\n',
  after: ['Opening paragraph.', block(false), WARM_EDITING_PARAGRAPH].join('\n\n') + '\n'
})
const looseList = insideOrAfter(inside => repeated(2000, index =>
  inside && index === 1000 ? `- ${WARM_EDITING_PARAGRAPH}` : looseListItem(index)).join('\n\n'))
const fence = insideOrAfter(inside => fenceOf(index => inside && index === 1000 ? WARM_EDITING_PARAGRAPH : fenceLine(index)))

export const ORDINARY_MARKDOWN_WORKLOADS: readonly OrdinaryMarkdownWorkload[] = Object.freeze([
  { name: 'plain-80', source: documentOf(repeated(80, () => plainParagraph)) },
  { name: 'plain-1000', source: documentOf(repeated(1000, () => plainParagraph)) },
  { name: 'links-code-2000', source: documentOf(repeated(2000, () => linkAndCodeParagraph)) },
  {
    name: 'mixed-blocks-2000',
    source: documentOf([
      ...repeated(2000, index => mixedBlocks[index % mixedBlocks.length] ?? ''),
      '[other]: http://example.com/other'
    ])
  },
  { name: 'loose-list-2000', source: documentOf(repeated(2000, looseListItem)) },
  { name: 'loose-list-2000-inside', source: looseList.inside },
  { name: 'loose-list-2000-after', source: looseList.after },
  { name: 'fence-2000', source: documentOf([fenceOf(fenceLine)]) },
  { name: 'fence-2000-inside', source: fence.inside },
  { name: 'fence-2000-after', source: fence.after }
].map(workload => Object.freeze(workload)))
