import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchElectron } from './helpers'

// End-to-end smoke for the streaming ripgrep IPC (mt::rg::start /
// mt::rg::match / mt::rg::done). Writes a small fixture tree, drives the
// search directly through the closed window.ripgrep intent bridge so we don't
// depend on the sidebar being open + focused. Main obtains the fixture path
// solely from the project root opened at launch.

const writeFixtureTree = (): string => {
  const dir = path.join(os.tmpdir(), 'mt-rg-' + Math.random().toString(36).slice(2, 8))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'one.md'), '# Hello\n\nmagic-needle-XYZ in body.\n')
  fs.writeFileSync(path.join(dir, 'two.md'), '# Other\n\nnothing here.\n')
  fs.writeFileSync(path.join(dir, 'three.md'), '# Third\nanother magic-needle-XYZ.\n')
  return dir
}

test.describe('Ripgrep IPC streaming', () => {
  let app: ElectronApplication
  let page: Page
  let fixtureDir: string | null = null

  test.beforeAll(async() => {
    fixtureDir = writeFixtureTree()
    const launched = await launchElectron([fixtureDir])
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close().catch(() => {})
    if (fixtureDir) {
      try {
        fs.rmSync(fixtureDir, { recursive: true, force: true })
      } catch {}
    }
  })

  test('text search streams matches and resolves', async() => {
    interface RgMatch {
      filePath: string
    }
    const matches = await page.evaluate<RgMatch[]>(() => {
      return new Promise<RgMatch[]>((resolve, reject) => {
        let searchId: string | null = null
        const earlyEvents: Array<() => void> = []
        const captured: RgMatch[] = []
        const offMatch = window.ripgrep.onMatch((raw) => {
          const deliver = (): void => {
            if (raw.searchId === searchId && typeof raw.payload !== 'string' && raw.payload) {
              captured.push(raw.payload as RgMatch)
            }
          }
          if (searchId === null) earlyEvents.push(deliver)
          else deliver()
        })
        const cleanup = () => offMatch()
        const offDone = window.ripgrep.onDone((raw) => {
          const deliver = (): void => {
            if (raw.searchId !== searchId) return
            cleanup()
            offDone()
            offError()
            resolve(captured)
          }
          if (searchId === null) earlyEvents.push(deliver)
          else deliver()
        })
        const offError = window.ripgrep.onError((raw) => {
          const deliver = (): void => {
            if (raw.searchId !== searchId) return
            cleanup()
            offDone()
            offError()
            reject(new Error(raw.error))
          }
          if (searchId === null) earlyEvents.push(deliver)
          else deliver()
        })
        window.ripgrep
          .start({
            schema: 'project-search-request-1',
            mode: 'text',
            pattern: 'magic-needle-XYZ',
            options: { isCaseSensitive: true, inclusions: ['*.md'] }
          })
          .then(receipt => {
            searchId = receipt.searchId
            for (const deliver of earlyEvents.splice(0)) deliver()
          })
          .catch(reject)
      })
    })

    expect(matches.length).toBeGreaterThanOrEqual(2)
    const paths = matches.map((m) => m.filePath).sort()
    expect(paths.some((p) => p.endsWith('one.md'))).toBe(true)
    expect(paths.some((p) => p.endsWith('three.md'))).toBe(true)
  })

  test('file search (--files) streams paths', async() => {
    const files = await page.evaluate<string[]>(() => {
      return new Promise<string[]>((resolve, reject) => {
        let searchId: string | null = null
        const earlyEvents: Array<() => void> = []
        const seen: string[] = []
        const offMatch = window.ripgrep.onMatch((raw) => {
          const deliver = (): void => {
            if (raw.searchId === searchId && typeof raw.payload === 'string') {
              seen.push(raw.payload)
            }
          }
          if (searchId === null) earlyEvents.push(deliver)
          else deliver()
        })
        const offDone = window.ripgrep.onDone((raw) => {
          const deliver = (): void => {
            if (raw.searchId !== searchId) return
            offMatch()
            offDone()
            offError()
            resolve(seen)
          }
          if (searchId === null) earlyEvents.push(deliver)
          else deliver()
        })
        const offError = window.ripgrep.onError((raw) => {
          const deliver = (): void => {
            if (raw.searchId !== searchId) return
            offMatch()
            offDone()
            offError()
            reject(new Error(raw.error))
          }
          if (searchId === null) earlyEvents.push(deliver)
          else deliver()
        })
        window.ripgrep
          .start({
            schema: 'project-search-request-1',
            mode: 'files',
            pattern: '',
            options: { inclusions: ['*.md'] }
          })
          .then(receipt => {
            searchId = receipt.searchId
            for (const deliver of earlyEvents.splice(0)) deliver()
          })
          .catch(reject)
      })
    })

    expect(files.length).toBeGreaterThanOrEqual(3)
  })
})
