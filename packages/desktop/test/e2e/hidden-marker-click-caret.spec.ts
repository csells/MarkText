import { expect, test, type Page } from '@playwright/test'
import { expectNoRendererErrors, launchWithMarkdown } from './helpers'
import { expectSaved, hiddenCoreEnv as env, nextFrame } from './reviewGestures'

// A heading's leading `## ` is hidden until the caret enters the heading. Its
// space is drawn just left of the first letter, so a click at the left edge
// of the heading's text can land on either side of the hidden `##`, and a
// newly opened document used to put its caret before them. Typing there
// turned the heading into a paragraph (`Z## Heading`, `##Z Heading`), as it
// still does in upstream MarkText 0c33241b. A caret placed where the user sees
// the start of a heading's text now lands after its syntax, while a click on
// the `#`s once they show still edits them, as upstream does.
//
// Block quote and list markers are not part of their paragraph's text, and an
// inline marker at a paragraph's start already takes the caret inside, as in
// upstream; those cases guard against a fix that overreaches.

const DOC = `## Third heading

Intro paragraph here.

## Other heading

# Title one

### Level three

###### Level six

> ## Quoted heading

- ## Item heading

> Quoted words

- List item words

1. Ordered words

*Emph start* then plain.

**Strong start** then plain.

[Link start](https://example.com) then plain.

\`Code start\` then plain.
`

/**
 * `leaf`: the left edge of the first character with a box in the editable
 * leaf holding `text`, as the real-document gesture sweep aims; for a
 * heading that is its hidden syntax's space. `letter`: the leftmost point of
 * the left half of the first character of `letter` (by default `text`) in
 * that leaf that block chrome, such as the drag handle, does not cover once
 * the pointer hovers there.
 */
type Aim = 'leaf' | 'letter'

const pointFor = async(page: Page, text: string, aim: Aim, letter = text): Promise<{ x: number, y: number }> => {
  const locate = (): Promise<{ left: number, width: number, y: number } | null> =>
    page.evaluate(({ text, aim, letter }) => {
      const leaf = [...document.querySelectorAll<HTMLElement>('.editor-component .mu-content[contenteditable="true"]')]
        .find(element => element.textContent!.includes(text))
      if (!leaf) return null
      leaf.scrollIntoView({ block: 'center' })
      const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const from = aim === 'letter' ? node.data.indexOf(letter) : 0
        if (from < 0) continue
        for (let offset = from; offset < node.length; offset++) {
          range.setStart(node, offset)
          range.setEnd(node, offset + 1)
          const rect = range.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) return { left: rect.left, width: rect.width, y: rect.top + rect.height / 2 }
          if (aim === 'letter') break
        }
      }
      return null
    }, { text, aim, letter })
  const char = await locate()
  if (!char) throw new Error(`Rendered text not found: ${text}`)
  if (aim === 'leaf') return { x: char.left + 0.5, y: char.y }
  await page.mouse.move(char.left + 0.5, char.y)
  await nextFrame(page)
  const x = await page.evaluate(({ text, char }) => {
    for (let x = char.left + 0.5; x < char.left + char.width / 2; x += 0.5) {
      if (document.elementFromPoint(x, char.y)?.closest('.mu-content')?.textContent?.includes(text)) return x
    }
    return null
  }, { text, char })
  if (x === null) throw new Error(`The left half of "${letter[0]}" is covered`)
  return { x, y: char.y }
}

const click = async(page: Page, text: string, aim: Aim, letter?: string): Promise<void> => {
  const point = await pointFor(page, text, aim, letter)
  await page.mouse.click(point.x, point.y)
  await nextFrame(page)
}

interface Case {
  name: string
  clicks: Array<[text: string, aim: Aim]>
  from: string
  to: string
}

const cases: Case[] = [
  // Upstream saves `Z## Third heading` for both.
  { name: 'typing straight after opening a document that starts with a heading', clicks: [], from: '## Third heading', to: '## ZThird heading' },
  { name: 'a click at the left edge of that first heading after opening', clicks: [['Third heading', 'leaf']], from: '## Third heading', to: '## ZThird heading' },
  // Upstream saves `##Z Other heading` and so on.
  { name: 'a click at the left edge of a heading after a click in a paragraph', clicks: [['Intro paragraph', 'letter'], ['Other heading', 'leaf']], from: '## Other heading', to: '## ZOther heading' },
  { name: 'a click at the left edge of an h1', clicks: [['Intro paragraph', 'letter'], ['Title one', 'leaf']], from: '# Title one', to: '# ZTitle one' },
  { name: 'a click at the left edge of an h3', clicks: [['Intro paragraph', 'letter'], ['Level three', 'leaf']], from: '### Level three', to: '### ZLevel three' },
  { name: 'a click at the left edge of an h6', clicks: [['Intro paragraph', 'letter'], ['Level six', 'leaf']], from: '###### Level six', to: '###### ZLevel six' },
  { name: 'a click at the left edge of a heading in a block quote', clicks: [['Intro paragraph', 'letter'], ['Quoted heading', 'leaf']], from: '> ## Quoted heading', to: '> ## ZQuoted heading' },
  { name: 'a click at the left edge of a heading in a list item', clicks: [['Intro paragraph', 'letter'], ['Item heading', 'leaf']], from: '- ## Item heading', to: '- ## ZItem heading' },
  // Upstream saves the same as these.
  { name: 'a click on the first letter of a heading', clicks: [['Other heading', 'letter']], from: '## Other heading', to: '## ZOther heading' },
  { name: 'a click on the first letter of a block quote', clicks: [['Quoted words', 'leaf']], from: '> Quoted words', to: '> ZQuoted words' },
  { name: 'a click on the first letter of a bullet item', clicks: [['List item words', 'leaf']], from: '- List item words', to: '- ZList item words' },
  { name: 'a click on the first letter of an ordered item', clicks: [['Ordered words', 'leaf']], from: '1. Ordered words', to: '1. ZOrdered words' },
  { name: 'a click on the first letter of emphasis starting a paragraph', clicks: [['Emph start', 'letter']], from: '*Emph start*', to: '*ZEmph start*' },
  { name: 'a click on the first letter of strong text starting a paragraph', clicks: [['Strong start', 'letter']], from: '**Strong start**', to: '**ZStrong start**' },
  { name: 'a click on the first letter of a link starting a paragraph', clicks: [['Link start', 'letter']], from: '[Link start]', to: '[ZLink start]' },
  { name: 'a click on the first letter of inline code starting a paragraph', clicks: [['Code start', 'letter']], from: '`Code start`', to: '`ZCode start`' }
]

for (const { name, clicks, from, to } of cases) {
  test(`${name} types into the visible text`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(DOC, { suppressErrorDialog: true, env })
    try {
      for (const [text, aim] of clicks) await click(page, text, aim)
      await page.keyboard.type('Z')
      await expectSaved(app, filePath, DOC.replace(from, to))
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

test('a click on a heading\'s shown `#`s still edits them', async() => {
  const { app, page, filePath } = await launchWithMarkdown(DOC, { suppressErrorDialog: true, env })
  try {
    // Arrowing into the `#`s shows them; a click on them then means them.
    await click(page, 'Other heading', 'letter')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.mu-atxheading-content', { hasText: 'Other heading' }).locator('.mu-gray').first()).toHaveText('##')
    await click(page, 'Other heading', 'letter', '#')
    await page.keyboard.type('Z')
    await expectSaved(app, filePath, DOC.replace('## Other heading', 'Z## Other heading'))
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

// Keys move the caret into the `#`s and show them, as in upstream, even when
// pressed before the frame that settles a click.
const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
const otherHeading = (page: Page) => page.locator('.mu-atxheading-content', { hasText: 'Other heading' })

test('the line-start key pressed straight after a click on a heading\'s text reaches its `#`s', async() => {
  const { app, page, filePath } = await launchWithMarkdown(DOC, { suppressErrorDialog: true, env })
  try {
    await otherHeading(page).click()
    await page.keyboard.press(lineStart)
    await expect(otherHeading(page).locator('.mu-gray').first()).toHaveText('##')
    await page.keyboard.type('Z')
    await expectSaved(app, filePath, DOC.replace('## Other heading', 'Z## Other heading'))
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the line-start key pressed straight after a click at a heading\'s left edge reaches its `#`s', async() => {
  const { app, page, filePath } = await launchWithMarkdown(DOC, { suppressErrorDialog: true, env })
  try {
    await click(page, 'Intro paragraph', 'letter')
    const point = await pointFor(page, 'Other heading', 'leaf')
    await page.mouse.click(point.x, point.y)
    await page.keyboard.press(lineStart)
    await expect(otherHeading(page).locator('.mu-gray').first()).toHaveText('##')
    await page.keyboard.type('Z')
    await expectSaved(app, filePath, DOC.replace('## Other heading', 'Z## Other heading'))
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('ArrowLeft after a click at a heading\'s left edge enters its `#`s', async() => {
  const { app, page, filePath } = await launchWithMarkdown(DOC, { suppressErrorDialog: true, env })
  try {
    await click(page, 'Intro paragraph', 'letter')
    await click(page, 'Other heading', 'leaf')
    await page.keyboard.press('ArrowLeft')
    await expect(otherHeading(page).locator('.mu-gray').first()).toHaveText('##')
    await page.keyboard.type('Z')
    await expectSaved(app, filePath, DOC.replace('## Other heading', '##Z Other heading'))
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
