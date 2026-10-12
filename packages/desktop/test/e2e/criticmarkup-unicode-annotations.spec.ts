import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown
} from './helpers'
import {
  clickReviewMenu,
  clickText,
  expectSaved,
  hiddenCoreEnv as env,
  nativeKey
} from './reviewGestures'

// Text inside annotations is ordinary document text. Caret
// movement, selection, Delete, Review authoring and resolution never split a
// user-perceived character (grapheme cluster). Backspace inside a line removes
// what Chromium's Backspace removes, as in upstream MarkText: a whole emoji,
// flag or astral character, but only the last code point of a combining
// sequence. Every step is a real key or pointer gesture; the saved file is the
// oracle.

const clusters = [
  { name: 'a ZWJ emoji sequence', text: '\u{1F468}‍\u{1F469}‍\u{1F467}', backspaced: '' },
  { name: 'a regional-indicator flag', text: '\u{1F1EF}\u{1F1F5}', backspaced: '' },
  { name: 'a base letter with a combining accent', text: 'é', backspaced: 'e' },
  { name: 'an astral-plane letter', text: '\u{1D49C}', backspaced: '' }
] as const

// Hebrew shin with its dot and a vowel point: one right-to-left cluster.
// Backspace after it removes only the vowel point.
const RTL = '\u05E9\u05C1\u05B8'
const RTL_BACKSPACED = '\u05E9\u05C1'

const settle = (page: Page) => page.evaluate(() => window.__marktextDocumentCore?.settled())

const press = async(page: Page, key: string, times = 1): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await page.keyboard.press(key)
    await settle(page)
  }
}

const type = async(page: Page, text: string): Promise<void> => {
  await page.keyboard.type(text)
  await settle(page)
}

const expectHealthy = async(app: ElectronApplication, page: Page): Promise<void> => {
  // No edit may fault the session into draft recovery.
  await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  await expectNoRendererErrors(app)
}

test.describe('Unicode inside annotations', () => {
  test.describe.configure({ timeout: 60_000 })

  for (const cluster of clusters) {
    test(`arrows, selection and Delete keep ${cluster.name} whole inside an Addition, and Backspace removes the browser's unit`, async() => {
      const G = cluster.text
      const { app, page, filePath } = await launchWithReviewMarkdown(
        `Start {++pq${G}rs${G}tu${G}vw++} end\n`,
        { suppressErrorDialog: true, env }
      )
      try {
        await clickText(page, 'pq', 1)
        await press(page, 'ArrowRight', 2)
        await type(page, 'X')
        await expectSaved(app, filePath, `Start {++pq${G}Xrs${G}tu${G}vw++} end\n`)

        await press(page, 'ArrowLeft', 2)
        await type(page, 'Y')
        await expectSaved(app, filePath, `Start {++pqY${G}Xrs${G}tu${G}vw++} end\n`)

        await press(page, 'Shift+ArrowRight')
        await type(page, 'Z')
        await expectSaved(app, filePath, `Start {++pqYZXrs${G}tu${G}vw++} end\n`)

        await clickText(page, 'tu', 'start')
        await press(page, 'ArrowLeft')
        await press(page, 'Delete')
        await expectSaved(app, filePath, `Start {++pqYZXrstu${G}vw++} end\n`)

        await clickText(page, 'vw', 'start')
        await press(page, 'Backspace')
        await expectSaved(app, filePath, `Start {++pqYZXrstu${cluster.backspaced}vw++} end\n`)
        await expectHealthy(app, page)
      } finally {
        await app.close()
      }
    })

    test(`tracked deletion, typing, Highlight and Comment keep ${cluster.name} whole`, async() => {
      const G = cluster.text
      const source = `Hi p${G}q end\n`
      const { app, page, filePath } = await launchWithReviewMarkdown(source, {
        suppressErrorDialog: true,
        env
      })
      try {
        await page.getByTestId('critic-review-track-changes').click()
        await clickText(page, 'q end', 'start')
        await press(page, 'Shift+ArrowLeft')
        await press(page, 'Backspace')
        await expectSaved(app, filePath, `Hi p{--${G}--}q end\n`)
        await nativeKey(app, 'Z', ['meta'])
        await expectSaved(app, filePath, source)

        await clickText(page, 'q end', 'start')
        await type(page, 'X')
        await expectSaved(app, filePath, `Hi p${G}{++X++}q end\n`)
        await nativeKey(app, 'Z', ['meta'])
        await expectSaved(app, filePath, source)
        await page.getByTestId('critic-review-track-changes').click()

        await clickText(page, 'q end', 'start')
        await press(page, 'Shift+ArrowLeft')
        await clickReviewMenu(app, 'mark-highlight')
        await expectSaved(app, filePath, `Hi p{==${G}==}q end\n`)
        await nativeKey(app, 'Z', ['meta'])
        await expectSaved(app, filePath, source)

        await clickText(page, 'q end', 'start')
        await press(page, 'Shift+ArrowLeft')
        await clickReviewMenu(app, 'add-comment')
        await page.getByTestId('critic-review-comment-input').fill(`${G} ${RTL} note`)
        await page.getByTestId('critic-review-comment-submit').click()
        await expectSaved(app, filePath, `Hi p{==${G}==}{>>${G} ${RTL} note<<}q end\n`)
        await expectHealthy(app, page)
      } finally {
        await app.close()
      }
    })
  }

  test('Delete removes a right-to-left cluster inside an Addition whole and Backspace its vowel point', async() => {
    const { app, page, filePath } = await launchWithReviewMarkdown(
      `Start {++pq${RTL}rs${RTL}tu++} end\n`,
      { suppressErrorDialog: true, env }
    )
    try {
      await clickText(page, 'pq', 1)
      await press(page, 'ArrowRight')
      await press(page, 'Delete')
      await expectSaved(app, filePath, `Start {++pqrs${RTL}tu++} end\n`)

      await clickText(page, 'tu', 'start')
      await press(page, 'Backspace')
      await expectSaved(app, filePath, `Start {++pqrs${RTL_BACKSPACED}tu++} end\n`)

      await type(page, 'X')
      await expectSaved(app, filePath, `Start {++pqrs${RTL_BACKSPACED}Xtu++} end\n`)
      await expectHealthy(app, page)
    } finally {
      await app.close()
    }
  })

  test('Backspace removes an accent inside a line and the whole letter at the line end, tracked and untracked', async() => {
    const accented = 'e\u0301'
    const source = `mid caf${accented}s | end caf${accented}\n`
    const { app, page, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
    try {
      // Chromium removes the combining accent, as upstream MarkText leaves it to.
      await clickText(page, 's |', 'start')
      await press(page, 'Backspace')
      await expectSaved(app, filePath, `mid cafes | end caf${accented}\n`)

      // Upstream Muya removes the whole last grapheme of a paragraph itself.
      await clickText(page, 'end caf', 'end')
      await press(page, 'ArrowRight')
      await press(page, 'Backspace')
      await expectSaved(app, filePath, 'mid cafes | end caf\n')
      await nativeKey(app, 'Z', ['meta'])
      await nativeKey(app, 'Z', ['meta'])
      await expectSaved(app, filePath, source)

      await page.getByTestId('critic-review-track-changes').click()
      await clickText(page, 's |', 'start')
      await press(page, 'Backspace')
      await expectSaved(app, filePath, `mid cafe{--\u0301--}s | end caf${accented}\n`)
      await nativeKey(app, 'Z', ['meta'])
      await expectSaved(app, filePath, source)
      await expectHealthy(app, page)
    } finally {
      await app.close()
    }
  })

  test('tracked Backspace beside an Addition removes only the accent at its end', async() => {
    const accented = 'e\u0301'
    const { app, page, filePath } = await launchWithReviewMarkdown(
      `Start {++pq${accented}++}rs end\n`,
      { suppressErrorDialog: true, env }
    )
    try {
      await page.getByTestId('critic-review-track-changes').click()
      await clickText(page, 'rs', 'start')
      await press(page, 'Backspace')
      await expectSaved(app, filePath, 'Start {++pqe++}rs end\n')
      await expectHealthy(app, page)
    } finally {
      await app.close()
    }
  })

  test('accepts, rejects and removes annotations whose text is non-ASCII, then undoes each with ⌘Z', async() => {
    const [family, flag, combining, astral] = clusters.map(cluster => cluster.text)
    const source = `x {~~${family}~>${flag}~~} y {--${combining}--} z {++${astral}++} w {==${RTL}==}{>>${RTL}<<} v\n`
    const { app, page, filePath } = await launchWithReviewMarkdown(source, {
      suppressErrorDialog: true,
      env
    })
    const entry = (text: string) =>
      page.getByTestId('critic-review-entry').filter({ hasText: text }).first().locator(':scope > button')
    try {
      const steps = [
        {
          select: flag,
          action: 'critic-review-accept',
          expected: `x ${flag} y {--${combining}--} z {++${astral}++} w {==${RTL}==}{>>${RTL}<<} v\n`
        },
        {
          select: combining,
          action: 'critic-review-reject',
          expected: `x ${flag} y ${combining} z {++${astral}++} w {==${RTL}==}{>>${RTL}<<} v\n`
        },
        {
          select: astral,
          action: 'critic-review-reject',
          expected: `x ${flag} y ${combining} z  w {==${RTL}==}{>>${RTL}<<} v\n`
        },
        {
          select: RTL,
          action: 'critic-review-remove',
          expected: `x ${flag} y ${combining} z  w ${RTL} v\n`
        }
      ]
      const history = [source]
      for (const step of steps) {
        await entry(step.select).click()
        await page.getByTestId(step.action).click()
        await expectSaved(app, filePath, step.expected)
        history.push(step.expected)
      }
      history.pop()
      for (const expected of history.reverse()) {
        await nativeKey(app, 'Z', ['meta'])
        await expectSaved(app, filePath, expected)
      }
      await expectHealthy(app, page)
    } finally {
      await app.close()
    }
  })
})
