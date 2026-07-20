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
const muyaRoot = path.resolve(desktopRoot, '../muya/src')
const canonicalContractPath = path.join(
  muyaRoot,
  'criticMarkup/reviewContract.ts'
)
const muyaPath = path.join(muyaRoot, 'muya.ts')
const muyaShimPath = path.join(desktopRoot, 'src/types/muya-core.d.ts')
const desktopTsconfigPath = path.join(desktopRoot, 'tsconfig.base.json')
const criticPlatformWorkflowPath = path.resolve(
  desktopRoot,
  '../../.github/workflows/critic-review-platforms.yml'
)
const inlineSyntaxPath = path.join(muyaRoot, 'assets/styles/inlineSyntax.css')
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
  it('runs every desktop CriticMarkup unit suite in the platform workflow', () => {
    const workflow = fs.readFileSync(criticPlatformWorkflowPath, 'utf8')
    const specs = fs.readdirSync(path.join(desktopRoot, 'test/unit/specs'))
      .filter((name) => name.startsWith('critic-markup-') && name.endsWith('.spec.ts'))
      .sort()

    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(workflow, `${spec} is absent from the platform workflow`)
        .toContain(`test/unit/specs/${spec}`)
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

    expect(controller).toContain('critic-markup-review-change')
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

  it('consumes the dependency-free, Muya-owned Review contract without local shadows', () => {
    const actions = fs.readFileSync(reviewActionsPath, 'utf8')
    const controller = fs.readFileSync(controllerPath, 'utf8')
    const editor = fs.readFileSync(editorPath, 'utf8')
    const muya = fs.readFileSync(muyaPath, 'utf8')
    const desktopTsconfig = fs.readFileSync(desktopTsconfigPath, 'utf8')

    expect(fs.existsSync(canonicalContractPath)).toBe(true)
    const contract = fs.existsSync(canonicalContractPath)
      ? fs.readFileSync(canonicalContractPath, 'utf8')
      : ''
    expect(contract).toContain('export interface ICriticMarkupReviewEditor')
    expect(contract).not.toMatch(/^import\s/m)
    expect(actions).toContain('ICriticMarkupReviewActions')
    expect(actions).not.toContain('interface CriticMarkupReviewEditor')
    expect(controller).toContain('ICriticMarkupReviewEditor')
    expect(controller).not.toContain('interface CriticMarkupReviewEngine')
    expect(fs.existsSync(muyaShimPath)).toBe(false)
    expect(desktopTsconfig).toContain('"@muyajs/core": ["../muya/src/index.ts"]')
    expect(editor).not.toContain('type MuyaInstance = any')
    expect(muya).toMatch(/export class Muya\s+implements ICriticMarkupReviewEditor/)
  })
})

describe('CriticMarkup Review sidebar interaction semantics', () => {
  it('uses a non-interactive card with sibling focus and action controls', () => {
    const source = fs.readFileSync(reviewPath, 'utf8')
    const root = parse(source).descriptor.template?.ast as TemplateNode | undefined
    expect(root).toBeDefined()

    let card: TemplateNode | undefined
    walk(root!, (node) => {
      const classes = staticAttribute(node, 'class')?.split(/\s+/) ?? []
      if (classes.includes('review-card')) card = node
    })
    expect(card).toBeDefined()
    expect(staticAttribute(card!, 'role')).toBeUndefined()
    expect(staticAttribute(card!, 'tabindex')).toBeUndefined()
    expect(eventExpressions(card!, 'keydown')).toEqual([])

    const directChildren = card!.children ?? []
    const focusControl = directChildren.find((node) =>
      node.tag === 'button' && eventExpressions(node, 'click')
        .some((expression) => expression.includes('activateItem(item)')))
    const actionGroup = directChildren.find((node) =>
      staticAttribute(node, 'class')?.split(/\s+/).includes('card-actions'))

    expect(focusControl, 'the card needs a dedicated activate/edit button').toBeDefined()
    expect(actionGroup, 'focus and decision controls must be siblings').toBeDefined()

    let nestedButton = false
    walk(focusControl!, (node) => {
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
    const source = fs.readFileSync(inlineSyntaxPath, 'utf8')
    expect(source).not.toMatch(
      /\.mu-critic-comment-indicator\s*\{[^}]*cursor:\s*pointer/s
    )
    expect(source).not.toMatch(/\.mu-critic-comment-indicator:focus-visible/)
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

  it('maps the explicit annotation-removal action to the engine decision deliberately', () => {
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
      createCriticMarkup: vi.fn(),
      focusCriticMarkup: vi.fn(),
      navigateCriticMarkup: vi.fn(),
      resolveCriticMarkup: vi.fn(() => true),
      resolveAllCriticMarkup: vi.fn(),
      editCriticMarkupComment: vi.fn(() => true),
      commitAuthoringSelection: vi.fn(),
      getCriticMarkupReviewSnapshot: vi.fn(),
      setOptions: vi.fn()
    }

    expect(executeCriticMarkupSidebarItemAction(editor, {
      fileId: 'file-1',
      action: 'remove-annotation',
      target
    } as never, 'marked', 'file-1')).toBe(true)
    expect(editor.resolveCriticMarkup).toHaveBeenCalledWith('accept', target)
  })
})
