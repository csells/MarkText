import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it, vi } from 'vitest'

import { executeCriticMarkupSidebarItemAction } from '@/components/editorWithTabs/criticMarkupReview'

interface TemplateNode {
  type: number
  tag?: string
  props?: Array<{
    type: number
    name: string
    value?: { content: string }
    arg?: { type: number; content?: string }
    exp?: { content?: string }
  }>
  children?: TemplateNode[]
}

const desktopRoot = path.resolve(__dirname, '../../..')
const rendererRoot = path.join(desktopRoot, 'src/renderer/src')
const editorPath = path.join(rendererRoot, 'components/editorWithTabs/editor.vue')
const controllerPath = path.join(
  rendererRoot,
  'components/editorWithTabs/useCriticMarkupReviewController.ts'
)
const reviewActionsPath = path.join(
  rendererRoot,
  'components/editorWithTabs/criticMarkupReview.ts'
)
const reviewPath = path.join(rendererRoot, 'components/sideBar/review.vue')
const documentViewRoot = path.resolve(desktopRoot, '../document-view/src')
const canonicalContractPath = path.join(
  documentViewRoot,
  'criticMarkup/reviewContract.ts'
)
const directDesktopViewPath = path.join(
  rendererRoot,
  'components/editorWithTabs/documentCoreDesktopEditor.ts'
)
const desktopTsconfigPath = path.join(desktopRoot, 'tsconfig.base.json')
const criticPlatformWorkflowPath = path.resolve(
  desktopRoot,
  '../../.github/workflows/document-core-platform.yml'
)
const criticPlatformE2ePath = path.join(
  desktopRoot,
  'test/e2e/document-core-review-workflow.spec.ts'
)
const criticPlatformE2eHelpersPath = path.join(
  desktopRoot,
  'test/e2e/documentCoreReviewE2e.ts'
)
const p8RealInputE2ePaths = [
  'document-core-review-cards.spec.ts',
  'document-core-comment-draft.spec.ts',
  'document-core-comment-crud.spec.ts',
  'document-core-comment-gestures.spec.ts',
  'document-core-passive-selection.spec.ts',
  'document-core-review-context-menu.spec.ts',
  'document-core-review-navigation.spec.ts',
  'document-core-review-command-surfaces.spec.ts',
  'document-core-review-pointer.spec.ts'
].map(name => path.join(desktopRoot, 'test/e2e', name))
const viewStylePath = path.join(
  documentViewRoot,
  'styles/documentView.css'
)
const packagedSmokePath = path.join(desktopRoot, 'test/e2e/packaged-smoke.spec.ts')

const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, {
  withFileTypes: true
}).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name)
  if (entry.isDirectory()) return sourceFiles(fullPath)
  return /\.(?:ts|vue)$/.test(entry.name) ? [fullPath] : []
})

const walk = (node: TemplateNode, visit: (node: TemplateNode, parent: TemplateNode | null) => void,
  parent: TemplateNode | null = null): void => {
  visit(node, parent)
  node.children?.forEach((child) => walk(child, visit, node))
}

const staticAttribute = (node: TemplateNode, name: string): string | undefined =>
  node.props?.find((prop) => prop.type === 6 && prop.name === name)?.value?.content

const eventExpressions = (node: TemplateNode, event: string): string[] =>
  node.props
    ?.filter((prop) =>
      prop.type === 7 && prop.name === 'on' && prop.arg?.content === event)
    .map((prop) => prop.exp?.content ?? '') ?? []

describe('one CriticMarkup Review snapshot/controller protocol', () => {
  it('runs the real Review workflow on every supported platform', () => {
    const workflow = fs.readFileSync(criticPlatformWorkflowPath, 'utf8')
    const e2e = fs.readFileSync(criticPlatformE2ePath, 'utf8')
    const helpers = fs.readFileSync(criticPlatformE2eHelpersPath, 'utf8')
    expect(workflow).toContain('document-core-review-workflow.spec.ts')
    expect(workflow).toContain('macos-15')
    expect(workflow).toContain('windows-2025')
    expect(workflow).toContain('ubuntu-22.04')
    expect(workflow).not.toMatch(/(?:macos|windows|ubuntu)-latest/u)
    expect(workflow).not.toMatch(/^ {4}paths:/mu)
    expect(e2e).toContain('selectTextByKeyboard')
    expect(e2e).toContain('pressApplicationMenuAccelerator')
    expect(e2e).toContain("{ button: 'right' }")
    expect(e2e).not.toMatch(
      /selectDomText|clickMenuById|sendIpcToRenderer|document\.createRange|dispatchEvent/
    )
    const keyboardSelection = helpers.slice(
      helpers.indexOf('export async function selectTextByKeyboard'),
      helpers.indexOf('const toPlaywrightAccelerator')
    )
    expect(keyboardSelection).toContain('line.click()')
    expect(keyboardSelection).toContain('page.keyboard.press')
    expect(keyboardSelection).not.toMatch(
      /page\.evaluate|document\.createRange|dispatchEvent/
    )
    const layeredAcceleratorInput = helpers.slice(
      helpers.indexOf('interface ObservedElectronKeyInput'),
      helpers.indexOf('export async function placeCaretAfter')
    )
    expect(layeredAcceleratorInput).toContain('page.keyboard.press')
    expect(layeredAcceleratorInput).toContain("'before-input-event'")
    expect(layeredAcceleratorInput).toContain('isBackgroundTestRun')
    expect(layeredAcceleratorInput).toContain('assertBackgroundRuntimePolicy')
    expect(layeredAcceleratorInput).toContain('webContents.sendInputEvent')
    expect(layeredAcceleratorInput).toContain("await emit('keyDown')")
    expect(layeredAcceleratorInput).toContain("await emit('keyUp')")
    expect(layeredAcceleratorInput).toContain(
      'CDP event to the DOM without emitting Electron'
    )
    expect(layeredAcceleratorInput).toContain(
      'No command callback is invoked'
    )
    const modeBranch = layeredAcceleratorInput.indexOf(
      'if (isBackgroundTestRun)'
    )
    expect(modeBranch).toBeGreaterThanOrEqual(0)
    expect(modeBranch).toBeLessThan(
      layeredAcceleratorInput.indexOf('page.keyboard.press')
    )
    expect(modeBranch).toBeLessThan(
      layeredAcceleratorInput.indexOf('webContents.sendInputEvent')
    )
    expect(layeredAcceleratorInput).toContain(
      "toEqual(['keyDown', 'keyUp'])"
    )
    expect(layeredAcceleratorInput).not.toContain(
      '.some(input => matchesStroke'
    )
    expect(layeredAcceleratorInput).not.toMatch(
      /item\.click|Reflect\.apply|sendIpcToRenderer|commandManager|cmd::execute|mt::execute-command-by-id/
    )
  })

  it('keeps every P8 Review target on real browser and application input paths', () => {
    const forbiddenActionPath =
      /selectDomText|clickMenuById|sendIpcToRenderer|MARKTEXT_E2E_BACKGROUND_MENU_ITEM_ID|selection\.addRange|removeAllRanges|dispatchEvent|new KeyboardEvent/
    for (const file of p8RealInputE2ePaths) {
      const source = fs.readFileSync(file, 'utf8')
      expect(
        source,
        `${path.basename(file)} contains a synthetic or callback-only action`
      ).not.toMatch(forbiddenActionPath)
    }

    const helpers = fs.readFileSync(criticPlatformE2eHelpersPath, 'utf8')
    for (const [name, next] of [
      ['openReviewSidebar', 'reviewMenuEnabled'],
      ['authorComment', 'undo']
    ]) {
      const body = helpers.slice(
        helpers.indexOf(`export async function ${name}`),
        helpers.indexOf(`export function ${next}`) >= 0
          ? helpers.indexOf(`export function ${next}`)
          : helpers.indexOf(`export const ${next}`)
      )
      expect(body, `${name} must emit only real user input`).not.toMatch(
        forbiddenActionPath
      )
    }
  })

  it('subscribes once in a dedicated controller instead of manually polling in editor.vue', () => {
    expect(fs.existsSync(controllerPath)).toBe(true)

    const editor = fs.readFileSync(editorPath, 'utf8')
    const controller = fs.existsSync(controllerPath)
      ? fs.readFileSync(controllerPath, 'utf8')
      : ''

    expect(editor).toContain('useCriticMarkupReviewController')
    expect(editor).not.toContain('pushReviewMenuState')
    expect(editor).not.toMatch(
      /getCriticMarkupItems|getCriticMarkupCommandState|getCurrentCriticMarkupItem/
    )
    expect(editor).not.toContain('useCriticMarkupReviewStore')
    expect(editor).not.toContain("'mt::update-review-menu'")

    expect(controller).toContain('subscribeReview')
    expect(controller).not.toContain('critic-markup-review-change')
    expect(controller).toContain('useCriticMarkupReviewStore')
    expect(controller).toContain("'mt::update-review-menu'")
  })

  it('has no manual Review push helper or bespoke Review action IPC in production', () => {
    const production = sourceFiles(path.join(desktopRoot, 'src'))
      .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))

    expect(production
      .filter(({ source }) => source.includes('pushReviewMenuState'))
      .map(({ file }) => path.relative(desktopRoot, file))).toEqual([])
    expect(production
      .filter(({ source }) => source.includes('mt::editor-review-action'))
      .map(({ file }) => path.relative(desktopRoot, file))).toEqual([])
  })

  it('consumes the target-owned Review contract without local shadows', () => {
    const actions = fs.readFileSync(reviewActionsPath, 'utf8')
    const controller = fs.readFileSync(controllerPath, 'utf8')
    const editor = fs.readFileSync(editorPath, 'utf8')
    const directView = fs.readFileSync(directDesktopViewPath, 'utf8')
    const desktopTsconfig = fs.readFileSync(desktopTsconfigPath, 'utf8')

    expect(fs.existsSync(canonicalContractPath)).toBe(true)
    const contract = fs.existsSync(canonicalContractPath)
      ? fs.readFileSync(canonicalContractPath, 'utf8')
      : ''
    expect(contract).toContain('export interface ICriticMarkupReviewEditor')
    expect(contract).toContain('export interface ICriticMarkupCommandTarget')
    expect(contract).toMatch(
      /interface ICriticMarkupCommandTarget\s*\{[^}]*revisionId:\s*string[^}]*nodeId:\s*string/s
    )
    expect(contract).toMatch(
      /interface ICriticMarkupReviewSnapshot[\s\S]*revisionId:\s*string/
    )
    expect(contract).not.toContain('ICriticMarkupTarget')
    expect(contract).not.toContain('TCriticMarkupFocusTarget')
    expect(contract).not.toMatch(/^import\s/m)
    expect(actions).toContain('ICriticMarkupReviewActions')
    expect(actions).not.toContain('interface CriticMarkupReviewEditor')
    expect(controller).toContain('ICriticMarkupReviewEditor')
    expect(controller).not.toContain('interface CriticMarkupReviewEngine')
    expect(desktopTsconfig).toContain(
      '"@marktext/document-view": ["../document-view/src/index.ts"]'
    )
    expect(editor).not.toContain('type MuyaInstance = any')
    expect(directView).toContain('DocumentEditorHost')
    expect(directView).toContain('ICriticMarkupReviewSnapshot')
    const targetResolver = directView.slice(
      directView.indexOf('const targetReviewItem'),
      directView.indexOf('const resolveAllReviewChanges')
    )
    expect(targetResolver).toContain('target.revisionId')
    expect(targetResolver).toContain('target.nodeId')
    expect(targetResolver).not.toContain('sourceStart')
    expect(targetResolver).not.toContain('sourceEnd')
    expect(targetResolver).not.toMatch(/\bas NodeId\b/)
    expect(fs.existsSync(path.resolve(desktopRoot, '../muya'))).toBe(false)
    expect(fs.existsSync(path.resolve(desktopRoot, '../muyajs'))).toBe(false)
  })
})

describe('CriticMarkup Review sidebar interaction semantics', () => {
  it('uses a labelled non-interactive card group with sibling focus and action controls', () => {
    const source = fs.readFileSync(reviewPath, 'utf8')
    const root = parse(source).descriptor.template?.ast as TemplateNode | undefined
    expect(root).toBeDefined()
    if (root === undefined) throw new TypeError('Expected the Review template root')

    let card: TemplateNode | undefined
    walk(root, (node) => {
      const classes = staticAttribute(node, 'class')?.split(/\s+/) ?? []
      if (classes.includes('review-card')) card = node
    })
    expect(card).toBeDefined()
    if (card === undefined) throw new TypeError('Expected a Review card')
    expect(staticAttribute(card, 'role')).toBe('group')
    expect(staticAttribute(card, 'tabindex')).toBeUndefined()
    expect(eventExpressions(card, 'keydown')).toEqual([])

    const directChildren = card.children ?? []
    const focusControl = directChildren.find((node) =>
      node.tag === 'button' && eventExpressions(node, 'click')
        .some((expression) => expression.includes('activateItem(item)')))
    const actionGroup = directChildren.find((node) =>
      staticAttribute(node, 'class')?.split(/\s+/).includes('card-actions'))

    expect(focusControl, 'the card needs a dedicated activate/edit button').toBeDefined()
    expect(actionGroup, 'focus and decision controls must be siblings').toBeDefined()
    if (focusControl === undefined) {
      throw new TypeError('Expected a Review card focus control')
    }

    let nestedButton = false
    walk(focusControl, (node) => {
      if (node !== focusControl && node.tag === 'button') nestedButton = true
    })
    expect(nestedButton).toBe(false)
  })

  it('emits an explicit remove-annotation action instead of pretending removal is acceptance', () => {
    const source = fs.readFileSync(reviewPath, 'utf8')
    expect(source).toContain("actOnItem('remove-annotation', item)")
    expect(source).not.toMatch(
      /<button\s+v-else[\s\S]{0,240}?actOnItem\('accept', item\)/
    )
  })

  it('styles the passive comment indicator without interactive affordances', () => {
    const source = fs.readFileSync(viewStylePath, 'utf8')
    expect(source).not.toMatch(
      /\.document-view-critic-comment-indicator\s*\{[^}]*cursor:\s*pointer/s
    )
    expect(source).not.toMatch(/\.document-view-critic-comment-indicator:focus-visible/)
  })

  it('overrides global outline suppression for every custom Review keyboard control', () => {
    const source = fs.readFileSync(reviewPath, 'utf8')
    for (const selector of [
      '.side-bar-review:focus-visible',
      '.projection-picker button:focus-visible',
      '.comment-compose-input:focus-visible',
      '.comment-compose-actions button:focus-visible',
      '.review-card-focus:focus-visible',
      '.card-actions button:focus-visible'
    ]) {
      expect(source).toContain(selector)
    }
    expect(source).toMatch(
      /:focus-visible[\s\S]{0,500}?outline:\s*2px solid var\(--themeColor\);/
    )
    expect(source).toMatch(
      /:focus-visible[\s\S]{0,500}?outline-offset:\s*2px;/
    )
  })

  it('makes the packaged smoke prove a folded anchored comment in an isolated profile', () => {
    const source = fs.readFileSync(packagedSmokePath, 'utf8')
    expect(source).toContain('with {==marked==}{>>remember this<<}')
    expect(source).toMatch(/args:\s*\[[^\]]*'--user-data-dir'[^\]]*userDataDir/s)
    expect(source).toContain("page.locator('.side-bar-review')")
    expect(source).toContain("page.locator('.review-card')")
    expect(source).toContain("page.locator('.review-card.type-comment')")
    expect(source).toContain("page.locator('.review-card.type-highlight')")
    expect(source).toContain("page.locator('.comment-anchor')")
    expect(source).toMatch(/finally\s*\{[\s\S]*fs\.rmSync\(dir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/)
  })

  it('maps the explicit annotation-removal action to the engine decision deliberately', async() => {
    const target = {
      id: 'critic-0-10',
      type: 'comment' as const,
      path: [0],
      start: 0,
      end: 10,
      sourceStart: 0,
      sourceEnd: 10,
      raw: '{>>note<<}',
      content: 'note'
    }
    const editor = {
      createCriticMarkup: vi.fn(async() => false),
      focusCriticMarkup: vi.fn(),
      navigateCriticMarkup: vi.fn(),
      resolveCriticMarkup: vi.fn(async() => true),
      resolveAllCriticMarkup: vi.fn(async() => 0),
      editCriticMarkupComment: vi.fn(async() => true),
      commitAuthoringSelection: vi.fn(),
      getCriticMarkupReviewSnapshot: vi.fn(),
      configure: vi.fn(async() => {})
    }

    await expect(executeCriticMarkupSidebarItemAction(editor, {
      documentId: 'document:1',
      action: 'remove-annotation',
      target: {
        revisionId: 'revision:1',
        nodeId: target.id
      }
    }, 'marked', 'document:1')).resolves.toEqual({ kind: 'executed' })
    expect(editor.resolveCriticMarkup).toHaveBeenCalledWith('accept', {
      revisionId: 'revision:1',
      nodeId: target.id
    })
  })
})
