// Ordinary Markdown documents that both MarkText's warm-session harness and
// the upstream warm-session producer type into, so their echo distributions
// compare one document with itself. Every document begins with the paragraph
// the harnesses type at the end of.

export const WARM_EDITING_PARAGRAPH = 'Warm editing paragraph.'

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
  { name: 'loose-list-2000', source: documentOf(repeated(2000, index => `- List item ${index + 1} with a few words.`)) },
  {
    name: 'fence-2000',
    source: documentOf([['```js', ...repeated(2000, index => `const value${index} = ${index}`), '```'].join('\n')])
  }
].map(workload => Object.freeze(workload)))
