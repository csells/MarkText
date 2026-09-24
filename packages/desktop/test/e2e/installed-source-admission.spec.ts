import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import type { CoreDocumentViewLease } from '../../src/renderer/src/documentAuthority/coreDocumentSessionManager'
import {
  enterSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

interface PresentationObservation {
  readonly visible: string
  readonly source: string
  readonly revision: number
}

interface AdmissionProbe {
  sourceAdmission: PresentationObservation[]
}

async function observeSourcePresentation(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface VNode {
      component?: {
        type?: { __name?: string }
        props?: { coreLease?: CoreDocumentViewLease }
        subTree?: VNode
      }
      children?: VNode[]
      ssContent?: VNode
      ssFallback?: VNode
    }
    const root = document.querySelector('#app') as Element & { _vnode?: VNode }
    let lease: CoreDocumentViewLease | undefined
    const visited = new Set<VNode>()
    const visit = (node: VNode | undefined): void => {
      if (!node || visited.has(node)) return
      visited.add(node)
      if (node.component?.type?.__name === 'sourceCode') lease = node.component.props?.coreLease
      visit(node.component?.subTree)
      if (Array.isArray(node.children)) node.children.forEach(visit)
      visit(node.ssContent)
      visit(node.ssFallback)
    }
    visit(root._vnode)
    if (!lease) throw new Error('Expected the mounted Source view lease')
    const sourceLease = lease
    const probe = window as unknown as AdmissionProbe
    probe.sourceAdmission = []
    // Observe real DOM writes against the existing read-only acknowledged
    // projection. No save barrier may settle the input before this observation.
    for (const name of ['appendChild', 'insertBefore', 'replaceChild'] as const) {
      const original = Node.prototype[name]
      Object.defineProperty(Node.prototype, name, {
        configurable: true,
        writable: true,
        value(this: Node, ...args: Node[]) {
          const result = Reflect.apply(original, this, args)
          if (this instanceof Element && this.closest('.CodeMirror-code')) {
            const canonical = sourceLease.projectAcknowledgedPlainTextView(
              sourceLease.identity.revision
            )
            probe.sourceAdmission.push({
              visible: document.querySelector('.CodeMirror-code')?.textContent ?? '',
              source: canonical.source,
              revision: canonical.revision
            })
          }
          return result
        }
      })
    }
  })
}

async function typeNative(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, text) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    for (const character of text) {
      contents.sendInputEvent({ type: 'keyDown', keyCode: character })
      contents.sendInputEvent({ type: 'char', keyCode: character })
      contents.sendInputEvent({ type: 'keyUp', keyCode: character })
    }
  }, text)
}

async function menu(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, label) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win.isVisible() || win.isFocused()) throw new Error('Expected a hidden test window')
    const item = Menu.getApplicationMenu()
      ?.items.flatMap((section) => section.submenu?.items ?? [])
      .find((item) => item.label === label)
    if (!item?.enabled) throw new Error(`Unavailable menu: ${label}`)
    item.click(undefined, win, win.webContents)
  }, label)
}

for (const content of ['**word**', '{++word++}']) {
  test(`Source admits native typing before DOM presentation and retains history/save: ${content}`, async() => {
    const source = `seed ${content}\n`
    const { app, page, filePath } = await launchWithMarkdown(source, {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_E2E_HIDDEN_WINDOW: '1',
        MARKTEXT_DOCUMENT_CORE_MODE: undefined,
        MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
      }
    })
    try {
      await waitForEditor(page)
      await waitForMenuReady(app)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectInstalledArtifactCommit(page)
      await expectDefaultCoreAuthority(page)
      await enterSourceMode(page, app)
      await page.evaluate(() => {
        const cm = (
          document.querySelector('.source-code .CodeMirror') as Element & {
            CodeMirror: { focus(): void; setCursor(position: { line: number; ch: number }): void }
          }
        ).CodeMirror
        cm.focus()
        cm.setCursor({ line: 0, ch: 0 })
      })
      await observeSourcePresentation(page)
      await typeNative(app, 'X')
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as AdmissionProbe).sourceAdmission.some((row) =>
              row.visible.includes('Xseed')
            )
          )
        )
        .toBe(true)
      const observations = await page.evaluate(
        () => (window as unknown as AdmissionProbe).sourceAdmission
      )
      await test.info().attach('source-admission.json', {
        contentType: 'application/json',
        body: JSON.stringify(observations, null, 2)
      })
      expect(
        observations
          .filter((row) => row.visible.includes('Xseed'))
          .every((row) => row.source === `X${source}` && row.revision === 2)
      ).toBe(true)
      await menu(app, 'Undo')
      await expect
        .poll(() => page.evaluate(() => window.__marktextDocumentCore?.authoritySource?.()))
        .toBe(source)
      await menu(app, 'Redo')
      await expect
        .poll(() => page.evaluate(() => window.__marktextDocumentCore?.authoritySource?.()))
        .toBe(`X${source}`)
      await typeNative(app, 'Y')
      await expect
        .poll(() => page.evaluate(() => window.__marktextDocumentCore?.authoritySource?.()))
        .toBe(`XY${source}`)
      await menu(app, 'Save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(`XY${source}`)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}
