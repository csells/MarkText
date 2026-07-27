import { describe, it, expect, vi } from 'vitest'
import { type Menu, type MenuItemConstructorOptions } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// `@/store/editor` transitively imports `@/config`, which reads
// `window.path.sep` at module load (normally injected by the preload bridge).
// Stub it before the hoisted imports run so the store graph can load.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
})

// The menu templates pull in `../actions/*` (which register `ipcMain.on` at
// module load), `electron-log`, and the i18n loader (reads locale JSON off
// disk). None of that is exercised here — we only build the menu structure and
// read accelerators — so stub the heavy surfaces to keep the slice hermetic.
vi.mock('electron', () => ({
  ipcMain: { on: () => {}, emit: () => {}, handle: () => {} },
  BrowserWindow: { fromWebContents: () => undefined, getAllWindows: () => [] }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import { createSelectionFormatState } from '@/store/editor'
import { updateFormatMenu } from 'main_renderer/menu/actions/format'
import keybindingsWindows from 'main_renderer/keyboard/keybindingsWindows'
import keybindingsLinux from 'main_renderer/keyboard/keybindingsLinux'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'
import { isEqualAccelerator } from 'common/keybinding'
import paragraphTemplate from 'main_renderer/menu/templates/paragraph'
import editTemplate from 'main_renderer/menu/templates/edit'
import viewTemplate from 'main_renderer/menu/templates/view'

// Mimic the Electron application menu surface `updateFormatMenu` touches:
// `getMenuItemById('formatMenuItem')` returning an object whose
// `submenu.items` are checkbox menu items keyed by `id`.
const makeMenu = (ids: string[]) => {
  const items = ids.map((id) => ({ id, checked: false }))
  return {
    getMenuItemById: (id: string) =>
      id === 'formatMenuItem' ? { submenu: { items } } : undefined,
    items
  }
}

const FORMAT_MENU_IDS = [
  'strongMenuItem',
  'emphasisMenuItem',
  'underlineMenuItem',
  'superscriptMenuItem',
  'subscriptMenuItem',
  'highlightMenuItem',
  'inlineCodeMenuItem',
  'inlineMathMenuItem',
  'strikeMenuItem',
  'hyperlinkMenuItem',
  'imageMenuItem'
]

const checkedIds = (menu: ReturnType<typeof makeMenu>) =>
  menu.items.filter((i) => i.checked).map((i) => i.id)

describe('createSelectionFormatState', () => {
  it('keys parser-owned inline formats for the native menu', () => {
    const state = createSelectionFormatState([
      'underline',
      'superscript',
      'subscript',
      'highlight',
      'strong'
    ])

    expect(state).toEqual({
      strong: true,
      em: false,
      u: true,
      sup: true,
      sub: true,
      mark: true,
      inline_code: false,
      inline_math: false,
      del: false,
      link: false,
      image: false
    })
  })
})

describe('updateFormatMenu', () => {
  it('checks underline/superscript/subscript/highlight when the caret is inside them', () => {
    const menu = makeMenu(FORMAT_MENU_IDS)
    const state = createSelectionFormatState([
      'underline',
      'superscript',
      'subscript',
      'highlight'
    ])

    updateFormatMenu(menu as unknown as Menu, state)

    expect(checkedIds(menu).sort()).toEqual(
      ['highlightMenuItem', 'subscriptMenuItem', 'superscriptMenuItem', 'underlineMenuItem'].sort()
    )
  })

  it('checks strong and emphasis formats', () => {
    const menu = makeMenu(FORMAT_MENU_IDS)
    const state = createSelectionFormatState(['strong', 'emphasis'])

    updateFormatMenu(menu as unknown as Menu, state)

    expect(checkedIds(menu).sort()).toEqual(['emphasisMenuItem', 'strongMenuItem'].sort())
  })

  it('clears checks when the selection carries no formats', () => {
    const menu = makeMenu(FORMAT_MENU_IDS)
    menu.items.forEach((i) => (i.checked = true))

    updateFormatMenu(menu as unknown as Menu, createSelectionFormatState([]))

    expect(checkedIds(menu)).toEqual([])
  })
})

// The Format slice above pins one menu's accelerators. The Paragraph/Edit/View
// templates source their accelerators the same way — `keybindings.getAccelerator(id)`
// off the active platform map — so a hardcoded literal in a template would silently
// diverge from the table. This walks each template with a fake keybindings backed by
// every platform map and asserts the menu items pass the table value through verbatim.
describe('menu template accelerators match the platform keybinding tables (Paragraph/Edit/View)', () => {
  type Template = (kb: { getAccelerator(id: string): string | null }) => MenuItemConstructorOptions

  // Sentinel-id keybindings: records the id of every accelerator the template
  // pulls and returns the id itself so it can be recovered from the menu item.
  const SENTINEL = ''
  const makeIdProbe = () => ({
    getAccelerator: (id: string) => `${SENTINEL}${id}`
  })

  // Mirrors the real `getAccelerator`: empty bindings collapse to null (which the
  // templates turn into `accelerator: undefined`), non-empty bindings pass through.
  const makeMapKeybindings = (map: Map<string, string>) => ({
    getAccelerator: (id: string) => {
      const name = map.get(id)
      return name || null
    }
  })

  // Map lookups are guaranteed present by the "exists in every platform table"
  // tests, so resolve to '' rather than sprinkling non-null assertions.
  const accel = (map: Map<string, string>, id: string): string => map.get(id) ?? ''

  // Walk the submenu tree, collecting every defined `accelerator` in source order.
  const collectAccelerators = (node: MenuItemConstructorOptions): (string | undefined)[] => {
    const out: (string | undefined)[] = []
    const submenu = node.submenu
    if (!Array.isArray(submenu)) return out
    for (const item of submenu) {
      if ('accelerator' in item) out.push(item.accelerator)
      if (item.submenu && Array.isArray(item.submenu)) {
        out.push(...collectAccelerators(item as MenuItemConstructorOptions))
      }
    }
    return out
  }

  // The ids the template actually referenced, in the order items appear.
  const referencedIds = (template: Template): string[] =>
    collectAccelerators(template(makeIdProbe()))
      .filter((a): a is string => typeof a === 'string' && a.startsWith(SENTINEL))
      .map((a) => a.slice(SENTINEL.length))

  const PLATFORMS: ReadonlyArray<readonly [string, Map<string, string>]> = [
    ['Windows', keybindingsWindows],
    ['Linux', keybindingsLinux],
    ['Darwin', keybindingsDarwin]
  ]

  const TEMPLATES: ReadonlyArray<readonly [string, Template]> = [
    ['paragraph', paragraphTemplate as unknown as Template],
    ['edit', editTemplate as unknown as Template],
    ['view', viewTemplate as unknown as Template]
  ]

  for (const [tName, template] of TEMPLATES) {
    it(`${tName} template only references ids that exist in every platform table`, () => {
      const ids = referencedIds(template)
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) {
        for (const [pName, map] of PLATFORMS) {
          expect(`${pName}:${id}=${map.has(id)}`).toBe(`${pName}:${id}=true`)
        }
      }
    })

    for (const [pName, map] of PLATFORMS) {
      it(`${tName} template accelerators equal the ${pName} table values (no hardcoded literal)`, () => {
        const ids = referencedIds(template)
        // Build the same menu with real table values; items line up 1:1 with `ids`
        // because the source order is deterministic.
        const produced = collectAccelerators(template(makeMapKeybindings(map)))
        expect(produced.length).toBe(ids.length)

        produced.forEach((value, i) => {
          const id = ids[i]
          const expected = map.get(id) ?? ''
          if (expected) {
            // Non-empty binding: the item must carry exactly that accelerator.
            expect(typeof value).toBe('string')
            expect(isEqualAccelerator(value as string, expected)).toBe(true)
          } else {
            // Empty binding collapses to `accelerator: undefined`.
            expect(value).toBeUndefined()
          }
        })
      })
    }
  }

  // Spot-check the specific ids the checklist calls out, against the real table
  // values, so a wholesale table edit is caught even if the pass-through holds.
  it('binds the checklist-named ids to their documented platform accelerators', () => {
    expect(referencedIds(paragraphTemplate as unknown as Template)).toContain('paragraph.heading-1')
    expect(referencedIds(paragraphTemplate as unknown as Template)).toContain('paragraph.front-matter')
    expect(referencedIds(editTemplate as unknown as Template)).toContain('edit.duplicate')
    expect(referencedIds(editTemplate as unknown as Template)).toContain('edit.find-next')
    expect(referencedIds(editTemplate as unknown as Template)).toContain('edit.find-previous')
    expect(referencedIds(viewTemplate as unknown as Template)).toContain('view.source-code-mode')
    expect(referencedIds(viewTemplate as unknown as Template)).toContain('view.typewriter-mode')
    expect(referencedIds(viewTemplate as unknown as Template)).toContain('view.focus-mode')

    expect(isEqualAccelerator(accel(keybindingsDarwin, 'paragraph.heading-1'), 'Command+1')).toBe(true)
    expect(keybindingsWindows.get('paragraph.heading-1')).toBe('')
    expect(isEqualAccelerator(accel(keybindingsDarwin, 'edit.duplicate'), 'Command+Option+D')).toBe(true)
    expect(isEqualAccelerator(accel(keybindingsLinux, 'edit.duplicate'), 'Ctrl+Shift+E')).toBe(true)
    expect(isEqualAccelerator(accel(keybindingsLinux, 'edit.find-next'), 'F3')).toBe(true)
    expect(isEqualAccelerator(accel(keybindingsDarwin, 'edit.find-next'), 'Cmd+G')).toBe(true)
    expect(isEqualAccelerator(accel(keybindingsWindows, 'view.source-code-mode'), 'Ctrl+E')).toBe(true)
    expect(isEqualAccelerator(accel(keybindingsDarwin, 'view.source-code-mode'), 'Command+Option+S')).toBe(true)
    expect(isEqualAccelerator(accel(keybindingsWindows, 'view.focus-mode'), 'Ctrl+Shift+J')).toBe(true)
  })

  it('keeps every block-authoring accelerator in the platform keybinding authority', () => {
    const expected = {
      Darwin: {
        'paragraph.paragraph': 'Command+0',
        'paragraph.horizontal-line': 'Command+Option+-',
        'paragraph.front-matter': 'Command+Option+Y',
        'paragraph.heading-1': 'Command+1',
        'paragraph.heading-2': 'Command+2',
        'paragraph.heading-3': 'Command+3',
        'paragraph.heading-4': 'Command+4',
        'paragraph.heading-5': 'Command+5',
        'paragraph.heading-6': 'Command+6',
        'paragraph.table': 'Command+Shift+T',
        'paragraph.math-formula': 'Command+Option+M',
        'paragraph.html-block': 'Command+Option+J',
        'paragraph.code-fence': 'Command+Option+C',
        'paragraph.quote-block': 'Command+Option+Q',
        'paragraph.order-list': 'Command+Option+O',
        'paragraph.bullet-list': 'Command+Option+U',
        'paragraph.task-list': 'Command+Option+X'
      },
      Linux: {
        'paragraph.paragraph': 'Ctrl+Shift+0',
        'paragraph.horizontal-line': 'Ctrl+_',
        'paragraph.front-matter': 'Ctrl+Shift+Y',
        'paragraph.heading-1': 'Ctrl+Alt+1',
        'paragraph.heading-2': 'Ctrl+Alt+2',
        'paragraph.heading-3': 'Ctrl+Alt+3',
        'paragraph.heading-4': 'Ctrl+Alt+4',
        'paragraph.heading-5': 'Ctrl+Alt+5',
        'paragraph.heading-6': 'Ctrl+Alt+6',
        'paragraph.table': 'Ctrl+Shift+T',
        'paragraph.math-formula': 'Ctrl+Alt+M',
        'paragraph.html-block': 'Ctrl+Alt+H',
        'paragraph.code-fence': 'Ctrl+Shift+K',
        'paragraph.quote-block': 'Ctrl+Shift+Q',
        'paragraph.order-list': 'Ctrl+G',
        'paragraph.bullet-list': 'Ctrl+H',
        'paragraph.task-list': 'Ctrl+Shift+X'
      },
      Windows: {
        'paragraph.paragraph': 'Ctrl+Shift+0',
        'paragraph.horizontal-line': 'Ctrl+Shift+U',
        'paragraph.front-matter': 'Ctrl+Alt+Y',
        'paragraph.heading-1': '',
        'paragraph.heading-2': '',
        'paragraph.heading-3': '',
        'paragraph.heading-4': '',
        'paragraph.heading-5': '',
        'paragraph.heading-6': '',
        'paragraph.table': 'Ctrl+Shift+T',
        'paragraph.math-formula': 'Ctrl+Alt+N',
        'paragraph.html-block': 'Ctrl+Alt+H',
        'paragraph.code-fence': 'Ctrl+Shift+K',
        'paragraph.quote-block': 'Ctrl+Shift+Q',
        'paragraph.order-list': 'Ctrl+G',
        'paragraph.bullet-list': 'Ctrl+H',
        'paragraph.task-list': 'Ctrl+Alt+X'
      }
    } as const
    const maps = {
      Darwin: keybindingsDarwin,
      Linux: keybindingsLinux,
      Windows: keybindingsWindows
    } as const

    for (const platform of Object.keys(expected) as Array<keyof typeof expected>) {
      for (const [id, accelerator] of Object.entries(expected[platform])) {
        expect(maps[platform].get(id), `${platform}:${id}`).toBe(accelerator)
      }
    }
  })

  it('documents the actual Windows and Linux heading bindings', () => {
    const docs = resolve(__dirname, '../../../../website/content/docs/end-user')
    const windows = readFileSync(resolve(docs, 'KEYBINDINGS_WINDOWS.md'), 'utf8')
    const linux = readFileSync(resolve(docs, 'KEYBINDINGS_LINUX.md'), 'utf8')

    for (let level = 1; level <= 6; level += 1) {
      expect(windows).toContain(
        `| \`paragraph.heading-${String(level)}\`       | User-defined`
      )
      expect(linux).toContain(
        `| \`paragraph.heading-${String(level)}\`       | ` +
        `<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>${String(level)}</kbd>`
      )
    }
    expect(windows).toContain('AltGr')
    expect(windows).toContain('no Windows default')
  })
})
